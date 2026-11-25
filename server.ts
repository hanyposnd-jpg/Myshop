import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';

type ProductCategory = 'phones' | 'laptops' | 'accessories';

interface ProductRecord {
  id: number;
  name: string;
  category: ProductCategory;
  price: number;
  description: string;
  image: string;
  keywords?: string[];
}

interface ClaimedCredential {
  salt: string;
  hashHex: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, '.data');
const PRODUCTS_FILE = path.resolve(DATA_DIR, 'products.json');
const DEFAULT_PRODUCTS_FILE = path.resolve(
  __dirname,
  'src/data/defaultProducts.json'
);

// Session signing secret: use environment secret if provided, else ephemeral in-memory random bytes
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET?.trim() ||
  crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// In-memory claimed passcode hash for preview before ADMIN_PASSCODE is configured
let claimedCredential: ClaimedCredential | null = null;
const loginAttempts = new Map<string, RateLimitEntry>();

function isPathInsideBase(targetPath: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(targetPath);
  return (
    normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(normalizedBase + path.sep)
  );
}

function getEnvPasscode(): string | null {
  const val = process.env.ADMIN_PASSCODE?.trim();
  return val && val.length > 0 ? val : null;
}

function getAuthMode(): 'env' | 'claimed' | 'unclaimed' {
  if (getEnvPasscode()) return 'env';
  if (claimedCredential) return 'claimed';
  return 'unclaimed';
}

function hashPasscode(passcode: string, salt?: string): ClaimedCredential {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, actualSalt, 64);
  return {
    salt: actualSalt,
    hashHex: derived.toString('hex'),
  };
}

function verifyEnvPasscode(input: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function verifyClaimedPasscode(
  input: string,
  stored: ClaimedCredential
): boolean {
  const derived = crypto.scryptSync(input, stored.salt, 64);
  const storedBuf = Buffer.from(stored.hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function signAdminToken(): string {
  const payloadObj = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString(
    'base64url'
  );
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAdminToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as { role?: string; exp?: number };
    return (
      parsed.role === 'admin' &&
      typeof parsed.exp === 'number' &&
      parsed.exp > Date.now()
    );
  } catch {
    return false;
  }
}

function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'يجب تسجيل الدخول بكلمة مرور الإدارة لتنفيذ هذا الإجراء.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!verifyAdminToken(token)) {
    res.status(401).json({
      error: 'انتهت صلاحية جلسة الإدارة أو الرمز غير صالح. سجل الدخول مجدداً.',
    });
    return;
  }

  next();
}

function readDefaultProducts(): ProductRecord[] {
  try {
    const raw = fs.readFileSync(DEFAULT_PRODUCTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProductRecord[]) : [];
  } catch {
    return [];
  }
}

function readProductsStore(): ProductRecord[] {
  try {
    if (
      isPathInsideBase(PRODUCTS_FILE, DATA_DIR) &&
      fs.existsSync(PRODUCTS_FILE)
    ) {
      const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ProductRecord[];
      }
    }
  } catch {
    // Fallback to defaults if stored file is unreadable
  }
  return readDefaultProducts();
}

function writeProductsStore(products: ProductRecord[]): void {
  if (!isPathInsideBase(PRODUCTS_FILE, DATA_DIR)) {
    throw new Error('Invalid products store path.');
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
}

function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Allow bundled local assets
  if (
    trimmed.startsWith('/src/assets/images/') &&
    !trimmed.includes('..')
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) {
    return false;
  }
  entry.count += 1;
  return true;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Admin status endpoint
  app.get('/api/admin/status', (_req: Request, res: Response) => {
    const mode = getAuthMode();
    res.json({
      configured: mode !== 'unclaimed',
      mode,
    });
  });

  // First-run admin password setup (locks automatically once claimed or env configured)
  app.post('/api/admin/setup', (req: Request, res: Response) => {
    if (getAuthMode() !== 'unclaimed') {
      res.status(409).json({
        error: 'تم تعيين كلمة مرور الإدارة مسبقاً.',
      });
      return;
    }

    const passcode =
      typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (passcode.length < 6 || passcode.length > 128) {
      res.status(400).json({
        error: 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.',
      });
      return;
    }

    claimedCredential = hashPasscode(passcode);
    const token = signAdminToken();
    res.status(201).json({ token, mode: 'claimed' });
  });

  // Admin login verification
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({
        error: 'عدد كبير من محاولات الدخول الخاطئة. يرجى الانتظار بضع دقائق.',
      });
      return;
    }

    const mode = getAuthMode();
    if (mode === 'unclaimed') {
      res.status(400).json({
        error: 'لم يتم إعداد كلمة مرور الإدارة بعد. قم بتعيينها أولاً.',
      });
      return;
    }

    const passcode =
      typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (!passcode) {
      res.status(400).json({ error: 'يرجى إدخال كلمة المرور.' });
      return;
    }

    let valid = false;
    const envPass = getEnvPasscode();
    if (envPass) {
      valid = verifyEnvPasscode(passcode, envPass);
    } else if (claimedCredential) {
      valid = verifyClaimedPasscode(passcode, claimedCredential);
    }

    if (!valid) {
      res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
      return;
    }

    loginAttempts.delete(ip);
    const token = signAdminToken();
    res.json({ token, mode });
  });

  // Public product catalog read
  app.get('/api/products', (_req: Request, res: Response) => {
    const products = readProductsStore();
    res.json({ products });
  });

  // Protected: Add new product
  app.post('/api/products', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const category = body?.category;
    const price = Number(body?.price);
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';
    const safeImage = sanitizeImageUrl(body?.image);

    if (name.length < 2 || name.length > 80) {
      res.status(400).json({
        error: 'اسم المنتج يجب أن يكون بين حرفين و80 حرفاً.',
      });
      return;
    }

    if (
      category !== 'phones' &&
      category !== 'laptops' &&
      category !== 'accessories'
    ) {
      res.status(400).json({
        error: 'يرجى اختيار فئة صحيحة للمنتج (موبايلات، لابتوبات، أو إكسسوارات).',
      });
      return;
    }

    if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
      res.status(400).json({
        error: 'يرجى إدخال سعر صحيح أكبر من صفر.',
      });
      return;
    }

    if (description.length < 3 || description.length > 200) {
      res.status(400).json({
        error: 'وصف المنتج يجب أن يكون بين 3 و200 حرف.',
      });
      return;
    }

    if (safeImage === null) {
      res.status(400).json({
        error: 'رابط الصورة غير صالح. استخدم رابط https:// صحيح أو صورة جاهزة.',
      });
      return;
    }

    let keywords: string[] | undefined;
    if (Array.isArray(body?.keywords)) {
      keywords = body.keywords
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 40)
        .slice(0, 15);
    }

    const current = readProductsStore();
    const nextId =
      current.reduce((max, item) => Math.max(max, item.id), 0) + 1;

    const newProduct: ProductRecord = {
      id: nextId,
      name,
      category,
      price: Math.round(price),
      description,
      image: safeImage,
      ...(keywords && keywords.length > 0 ? { keywords } : {}),
    };

    const updated = [newProduct, ...current];
    writeProductsStore(updated);

    res.status(201).json({ product: newProduct, products: updated });
  });

  // Protected: Delete product
  app.delete(
    '/api/products/:id',
    requireAdminAuth,
    (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'معرف المنتج غير صالح.' });
        return;
      }

      const current = readProductsStore();
      const exists = current.some((p) => p.id === id);
      if (!exists) {
        res.status(404).json({ error: 'المنتج غير موجود.' });
        return;
      }

      const updated = current.filter((p) => p.id !== id);
      writeProductsStore(updated);
      res.json({ products: updated });
    }
  );

  // Vite middleware in dev, static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HANY TECH server running on http://0.0.0.0:${PORT}`);
  });
}

void createServer();
