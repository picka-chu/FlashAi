import { useEffect, useState } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { TabType } from "./components/layout/BottomNav";
import { Home } from "./pages/Home";
import { Matches } from "./pages/Matches";
import { Analyze } from "./pages/Analyze";
import { History } from "./pages/History";
import { Profile } from "./pages/Profile";
import { useTelegram } from "./hooks/useTelegram";
import { useUserStore } from "./store/useUserStore";
import { motion, AnimatePresence } from "motion/react";
import { useMarketingBot } from "./hooks/useMarketingBot";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const { initData, isReady, setHeaderColor, setBackgroundColor } = useTelegram();
  const { setUser, isLoading, setLoading } = useUserStore();

  useMarketingBot();

  useEffect(() => {
    if (isReady) {
      setHeaderColor("#000000");
      setBackgroundColor("#000000");
    }
  }, [isReady, setHeaderColor, setBackgroundColor]);

  useEffect(() => {
    const authenticateTelegramUser = async () => {
      if (!initData) {
        setLoading(false);
        return;
      }

      try {
        const authRes = await fetch("/api/auth/telegram/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!authRes.ok) {
          console.error("Telegram auth exchange failed");
          setLoading(false);
          return;
        }

        const authData = await authRes.json();
        if (authData?.accessToken) {
          localStorage.setItem("flash_ai_access_token", authData.accessToken);
        }
        if (authData?.refreshToken) {
          localStorage.setItem("flash_ai_refresh_token", authData.refreshToken);
        }

        if (authData?.user) {
          setUser(authData.user);
          return;
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setLoading(false);
      }
    };

    if (isReady && initData) {
      authenticateTelegramUser();
    } else if (isReady && !initData) {
      setLoading(false);
    }
  }, [initData, isReady, setUser, setLoading]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const refreshToken = localStorage.getItem("flash_ai_refresh_token");
      if (!refreshToken) return;
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.accessToken) {
          localStorage.setItem("flash_ai_access_token", data.accessToken);
        }
      } catch {
        // Silent refresh errors are non-fatal for UI rendering.
      }
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <Home onTabChange={setActiveTab} />;
      case "matches": return <Matches onTabChange={setActiveTab} />;
      case "analyze": return <Analyze />;
      case "history": return <History />;
      case "profile": return <Profile />;
      default: return <Home onTabChange={setActiveTab} />;
    }
  };

  if (isLoading) {
    return (
      <div className="h-[100dvh] bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#ccff00]/20 border-t-[#ccff00] rounded-full animate-spin" />
          <p className="text-zinc-500 text-xs font-black uppercase tracking-widest">Loading Flash AI</p>
        </div>
      </div>
    );
  }

  return (
    <MainLayout 
      activeTab={activeTab} 
      onTabChange={setActiveTab}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          {renderPage()}
        </motion.div>
      </AnimatePresence>
    </MainLayout>
  );
}
