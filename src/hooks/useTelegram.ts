import { useEffect, useState, useCallback } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

/** Push Telegram safe-area insets into CSS variables used by the layout. */
function syncSafeAreaCssVars(webApp: any) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  // Full device safe area (notch / home indicator)
  const safe = webApp.safeAreaInset || {};
  // Content safe area — accounts for Telegram native chrome (close X, etc.)
  const content = webApp.contentSafeAreaInset || {};

  const top = Math.max(Number(content.top) || 0, Number(safe.top) || 0);
  const bottom = Math.max(Number(content.bottom) || 0, Number(safe.bottom) || 0);
  const left = Math.max(Number(content.left) || 0, Number(safe.left) || 0);
  const right = Math.max(Number(content.right) || 0, Number(safe.right) || 0);

  // Extra top padding in fullscreen so content never sits under the close button.
  // Telegram contentSafeAreaInset.top is the correct value when available;
  // fall back to a sensible minimum when the API is missing.
  const headerOffset = top > 0 ? top : 0;

  root.style.setProperty("--tg-safe-top", `${headerOffset}px`);
  root.style.setProperty("--tg-safe-bottom", `${bottom}px`);
  root.style.setProperty("--tg-safe-left", `${left}px`);
  root.style.setProperty("--tg-safe-right", `${right}px`);

  // Also mirror into standard env()-compatible custom props used by CSS
  root.style.setProperty("--sat", `${headerOffset}px`);
  root.style.setProperty("--sab", `${bottom}px`);
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

      // Fullscreen when supported (Bot API 8.0+) — reduces sheet chrome
      try {
        if (typeof webApp.requestFullscreen === "function") {
          webApp.requestFullscreen();
        }
      } catch {
        // Older clients ignore this
      }

      // Disable vertical swipes that can conflict with scroll in fullscreen
      try {
        if (typeof webApp.disableVerticalSwipes === "function") {
          webApp.disableVerticalSwipes();
        }
      } catch {
        /* no-op */
      }

      syncSafeAreaCssVars(webApp);

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

    const handleSafeArea = () => {
      syncSafeAreaCssVars(tg);
    };

    tg.onEvent("themeChanged", handleThemeChange);
    // Keep insets in sync when entering/leaving fullscreen or rotating
    try {
      tg.onEvent("safeAreaChanged", handleSafeArea);
      tg.onEvent("contentSafeAreaChanged", handleSafeArea);
      tg.onEvent("fullscreenChanged", handleSafeArea);
      tg.onEvent("viewportChanged", handleSafeArea);
    } catch {
      /* older clients */
    }

    // Initial + delayed re-sync (insets often arrive after ready)
    syncSafeAreaCssVars(tg);
    const t1 = window.setTimeout(() => syncSafeAreaCssVars(tg), 100);
    const t2 = window.setTimeout(() => syncSafeAreaCssVars(tg), 500);

    return () => {
      tg.offEvent("themeChanged", handleThemeChange);
      try {
        tg.offEvent("safeAreaChanged", handleSafeArea);
        tg.offEvent("contentSafeAreaChanged", handleSafeArea);
        tg.offEvent("fullscreenChanged", handleSafeArea);
        tg.offEvent("viewportChanged", handleSafeArea);
      } catch {
        /* no-op */
      }
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [tg]);

  const hapticFeedback = useCallback(
    (type: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium") => {
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred(type);
      }
    },
    [tg]
  );

  const showAlert = useCallback(
    (message: string) => {
      try {
        if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.2")) {
          tg.showAlert(message);
        } else {
          alert(message);
        }
      } catch {
        alert(message);
      }
    },
    [tg]
  );

  const showConfirm = useCallback((message: string, callback: (ok: boolean) => void) => {
    try {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.2")) {
        tg.showConfirm(message, callback);
      } else {
        callback(confirm(message));
      }
    } catch {
      callback(confirm(message));
    }
  }, [tg]);

  const setHeaderColor = useCallback(
    (color: string) => {
      try {
        if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.1")) {
          tg.setHeaderColor(color);
        }
      } catch (e) {
        console.warn("setHeaderColor not supported", e);
      }
    },
    [tg]
  );

  const setBackgroundColor = useCallback(
    (color: string) => {
      try {
        if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.1")) {
          tg.setBackgroundColor(color);
        }
      } catch (e) {
        console.warn("setBackgroundColor not supported", e);
      }
    },
    [tg]
  );

  return {
    tg,
    user,
    initData: tg?.initData || window?.Telegram?.WebApp?.initData || "",
    theme,
    hapticFeedback,
    showAlert,
    showConfirm,
    setHeaderColor,
    setBackgroundColor,
    isReady,
  };
};
