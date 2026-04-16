import { useEffect, useState, useCallback } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

export const useTelegram = () => {
  const [user, setUser] = useState<any>(null);
  const [theme, setTheme] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [initData, setInitData] = useState<string>('');

  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      setUser(tg.initDataUnsafe?.user);
      setInitData(tg.initData || '');
      setTheme(tg.themeParams);
      setIsReady(true);

      const handleThemeChange = () => {
        setTheme(tg.themeParams);
      };

      tg.onEvent("themeChanged", handleThemeChange);
      return () => {
        tg.offEvent("themeChanged", handleThemeChange);
      };
    }
  }, [tg]);

  const hapticFeedback = useCallback((type: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium") => {
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred(type);
    }
  }, [tg]);

  const showAlert = useCallback((message: string) => {
    try {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) {
        tg.showAlert(message);
      } else {
        alert(message);
      }
    } catch (e) {
      alert(message);
    }
  }, [tg]);

  const showConfirm = useCallback((message: string, callback: (ok: boolean) => void) => {
    try {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) {
        tg.showConfirm(message, callback);
      } else {
        callback(confirm(message));
      }
    } catch (e) {
      callback(confirm(message));
    }
  }, [tg]);

  const setHeaderColor = useCallback((color: string) => {
    try {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) {
        tg.setHeaderColor(color);
      }
    } catch (e) {
      console.warn('setHeaderColor not supported', e);
    }
  }, [tg]);

  const setBackgroundColor = useCallback((color: string) => {
    try {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) {
        tg.setBackgroundColor(color);
      }
    } catch (e) {
      console.warn('setBackgroundColor not supported', e);
    }
  }, [tg]);

  return {
    tg,
    user,
    initData,
    theme,
    hapticFeedback,
    showAlert,
    showConfirm,
    setHeaderColor,
    setBackgroundColor,
    isReady,
  };
};
