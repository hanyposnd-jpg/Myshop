import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorHandler } from '../errors/ErrorContext';
import { tryCatchSync } from '../errors/tryCatch';

export type VoiceSearchLang = 'ar-EG' | 'en-US';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEventLike) => void)
    | null;
  onerror:
    | ((
        this: SpeechRecognitionInstance,
        ev: SpeechRecognitionErrorEventLike
      ) => void)
    | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

const SPEECH_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    'تم رفض إذن الميكروفون. يرجى السماح بالوصول إلى الميكروفون من إعدادات المتصفح.',
  'service-not-allowed':
    'خدمة التعرف على الصوت غير متاحة حالياً في هذا المتصفح أو الإطار.',
  'no-speech':
    'لم يتم التقاط أي صوت. تحدث بوضوح بالقرب من الميكروفون وحاول مرة أخرى.',
  'audio-capture':
    'تعذر العثور على ميكروفون متصل بجهازك. تأكد من توصيل الميكروفون.',
  network:
    'حدثت مشكلة في الاتصال أثناء معالجة الصوت. تحقق من اتصال الإنترنت وأعد المحاولة.',
  'language-not-supported':
    'لغة البحث الصوتي المحددة غير مدعومة على هذا الجهاز.',
};

export interface UseVoiceSearchOptions {
  initialLang?: VoiceSearchLang;
  onTranscript: (text: string) => void;
}

export function useVoiceSearch({
  initialLang = 'ar-EG',
  onTranscript,
}: UseVoiceSearchOptions) {
  const { reportError } = useErrorHandler();
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [lang, setLang] = useState<VoiceSearchLang>(initialLang);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const isSupported = getSpeechRecognitionCtor() !== null;

  const stopListening = useCallback(() => {
    const instance = recognitionRef.current;
    if (!instance) {
      setIsListening(false);
      setInterimTranscript('');
      return;
    }

    tryCatchSync(() => {
      instance.stop();
    });
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      reportError(new Error('Web Speech API is not supported in this browser'), {
        code: 'ERR_VOICE_UNSUPPORTED',
        source: 'البحث الصوتي',
        severity: 'warning',
        userMessage:
          'المتصفح الحالي لا يدعم البحث الصوتي. يمكنك استخدام متصفح Chrome أو Edge أو الكتابة في خانة البحث.',
      });
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    // Abort any lingering instance before creating a fresh session
    if (recognitionRef.current) {
      tryCatchSync(() => recognitionRef.current?.abort());
      recognitionRef.current = null;
    }

    const startResult = tryCatchSync(
      () => {
        const recognition = new Ctor();
        recognition.lang = lang;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsListening(true);
          setInterimTranscript('');
        };

        recognition.onresult = (event) => {
          let finalText = '';
          let interimText = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0]?.transcript ?? '';
            if (result.isFinal) {
              finalText += transcript;
            } else {
              interimText += transcript;
            }
          }

          if (interimText.trim()) {
            setInterimTranscript(interimText.trim());
            onTranscriptRef.current(interimText.trim());
          }

          if (finalText.trim()) {
            const cleaned = finalText.trim().replace(/[。.؟?]+$/g, '');
            setInterimTranscript('');
            onTranscriptRef.current(cleaned);
          }
        };

        recognition.onerror = (event) => {
          setIsListening(false);
          setInterimTranscript('');

          if (event.error === 'aborted') {
            return;
          }

          const friendly =
            SPEECH_ERROR_MESSAGES[event.error] ??
            'تعذر إتمام البحث الصوتي حالياً. يرجى المحاولة مرة أخرى.';

          reportError(new Error(`SpeechRecognition error: ${event.error}`), {
            code: `ERR_VOICE_${event.error.toUpperCase().replace(/-/g, '_')}`,
            source: 'البحث الصوتي',
            severity: 'warning',
            userMessage: friendly,
          });
        };

        recognition.onend = () => {
          setIsListening(false);
          setInterimTranscript('');
          recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
      },
      {
        onError: (err) => reportError(err),
        errorOptions: {
          source: 'البحث الصوتي',
          severity: 'warning',
          userMessage:
            'تعذر تشغيل الميكروفون للبحث الصوتي. تأكد من صلاحيات المتصفح وحاول مجدداً.',
        },
      }
    );

    if (!startResult.ok) {
      setIsListening(false);
      setInterimTranscript('');
    }
  }, [isListening, lang, reportError, stopListening]);

  const toggleLanguage = useCallback(() => {
    setLang((prev) => (prev === 'ar-EG' ? 'en-US' : 'ar-EG'));
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        tryCatchSync(() => recognitionRef.current?.abort());
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    interimTranscript,
    lang,
    toggleLanguage,
    startListening,
    stopListening,
  };
}
