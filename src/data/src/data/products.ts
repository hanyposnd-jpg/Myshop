import defaultProductsJson from './defaultProducts.json';
import { safeJsonParse, tryCatchSync, Result } from '../errors/tryCatch';
import { AppError } from '../errors/types';

export type ProductCategory = 'phones' | 'laptops' | 'accessories';

export interface Product {
  id: number;
  name: string;
  category: ProductCategory;
  price: number;
  description: string;
  image: string;
  keywords?: string[];
}

export interface CartItem {
  id: number;
  quantity: number;
}

export type ThemeMode = 'light' | 'dark';

export const MAX_ITEM_QUANTITY = 99;
export const CART_STORAGE_KEY = 'hanyCart';
export const THEME_STORAGE_KEY = 'hanyTheme';
export const STORE_WHATSAPP_NUMBER = '201070274572';
export const STORE_WHATSAPP_DISPLAY = '01070274572';

export const CATEGORY_NAMES: Record<ProductCategory, string> = {
  phones: 'موبايلات',
  laptops: 'لابتوبات',
  accessories: 'إكسسوارات',
};

export const PRODUCTS: Product[] = defaultProductsJson as Product[];

export const PRESET_PRODUCT_IMAGES: Array<{ label: string; url: string }> = [
  {
    label: 'هاتف ذكي (iPhone)',
    url: '/src/assets/images/product_iphone_pro_1795550260645.jpg',
  },
  {
    label: 'هاتف ذكي (Galaxy)',
    url: '/src/assets/images/product_samsung_galaxy_1795550261933.jpg',
  },
  {
    label: 'لابتوب (MacBook)',
    url: '/src/assets/images/product_macbook_pro_1795550262238.jpg',
  },
  {
    label: 'لابتوب ألعاب (Gaming)',
    url: '/src/assets/images/product_gaming_laptop_1795550262471.jpg',
  },
  {
    label: 'سماعات لاسلكية',
    url: '/src/assets/images/product_wireless_headphones_1795550263346.jpg',
  },
  {
    label: 'ساعة ذكية',
    url: '/src/assets/images/product_smart_watch_1795550263747.jpg',
  },
  {
    label: 'لوحة مفاتيح ميكانيكية',
    url: '/src/assets/images/product_mechanical_keyboard_1795550262834.jpg',
  },
  {
    label: 'ماوس لاسلكي',
    url: '/src/assets/images/product_wireless_mouse_1795550264076.jpg',
  },
  {
    label: 'تابلت',
    url: '/src/assets/images/product_tablet_pro_1795550264206.jpg',
  },
];

export function formatMoney(value: number): string {
  const result = tryCatchSync(() => {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Invalid price value: ${value}`);
    }
    return new Intl.NumberFormat('ar-EG').format(value) + ' جنيه';
  });
  return result.ok ? result.data : '0 جنيه';
}

export function loadCartSafely(
  catalog: Product[] = PRODUCTS,
  onError?: (error: AppError) => void
): CartItem[] {
  const rawResult = tryCatchSync(
    () => window.localStorage.getItem(CART_STORAGE_KEY),
    {
      onError,
      errorOptions: {
        source: 'سلة التسوق',
        userMessage:
          'تعذر الوصول إلى السلة المحفوظة في المتصفح. يمكنك التسوق بشكل طبيعي الآن.',
      },
    }
  );

  if (!rawResult.ok || !rawResult.data) {
    return [];
  }

  const parsed = safeJsonParse<unknown>(rawResult.data, {
    onError,
    errorOptions: {
      source: 'سلة التسوق',
      userMessage:
        'كانت بيانات السلة المحفوظة غير صالحة، وتمت تهيئتها تلقائياً لحماية المتجر.',
    },
  });

  if (!parsed.ok || !Array.isArray(parsed.data)) {
    return [];
  }

  return parsed.data.filter(
    (item): item is CartItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as CartItem).id === 'number' &&
      catalog.some((p) => p.id === (item as CartItem).id) &&
      Number.isInteger((item as CartItem).quantity) &&
      (item as CartItem).quantity > 0 &&
      (item as CartItem).quantity <= MAX_ITEM_QUANTITY
  );
}

export function saveCartSafely(
  items: CartItem[],
  onError?: (error: AppError) => void
): Result<void> {
  return tryCatchSync(
    () => {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    },
    {
      onError,
      errorOptions: {
        source: 'حفظ السلة',
        severity: 'warning',
        userMessage:
          'تعذر حفظ السلة في ذاكرة المتصفح، لكن طلبك الحالي ما زال متاحاً في هذه الجلسة.',
      },
    }
  );
}

export function loadThemeSafely(): ThemeMode {
  const result = tryCatchSync(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  return result.ok ? result.data : 'dark';
}

export function saveThemeSafely(
  theme: ThemeMode,
  onError?: (error: AppError) => void
): void {
  tryCatchSync(
    () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    },
    {
      onError,
      errorOptions: {
        source: 'إعدادات المظهر',
        severity: 'info',
        userMessage: 'تم تغيير المظهر، لكن تعذر حفظ التفضيل في المتصفح.',
      },
    }
  );
}
