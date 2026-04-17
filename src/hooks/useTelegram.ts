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
  const [tg, setTg] = useState<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let disposed = false;
    let attempts = 0;
    const maxAttempts = 30; // ~6 seconds

    const syncTelegram = () => {
      const webApp = window.Telegram?.WebApp;
      if (!webApp) {
        attempts += 1;
        if (attempts >= maxAttempts && !disposed) {
          setIsReady(true); // graceful fallback so app never hangs
        }
        return;
      }

      setTg(webApp);
      webApp.ready();
      webApp.expand();
      setUser(webApp.initDataUnsafe?.user);
      setTheme(webApp.themeParams);
      setIsReady(true);
    };

    syncTelegram();
    const poll = setInterval(syncTelegram, 200);

    return () => {
      disposed = true;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!tg) return;
    const handleThemeChange = () => {
      setTheme(tg.themeParams);
    };

    tg.onEvent("themeChanged", handleThemeChange);
    return () => {
      tg.offEvent("themeChanged", handleThemeChange);
    };
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
    initData: tg?.initData || "",
    theme,
    hapticFeedback,
    showAlert,
    showConfirm,
    setHeaderColor,
    setBackgroundColor,
    isReady,
  };
};
