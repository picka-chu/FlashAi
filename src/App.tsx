import { useEffect, useState } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { TabType } from "./components/layout/BottomNav";
import { Home } from "./pages/Home";
import { Matches } from "./pages/Matches";
import { Analyze } from "./pages/Analyze";
import { History } from "./pages/History";
import { Profile } from "./pages/Profile";
import { Admin } from "./pages/Admin";
import { useTelegram } from "./hooks/useTelegram";
import { useUserStore } from "./store/useUserStore";
import { supabase } from "./lib/supabase";
import { motion, AnimatePresence } from "motion/react";
import { useMarketingBot } from "./hooks/useMarketingBot";

import { init, retrieveLaunchParams } from '@telegram-apps/sdk-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const { user: tgUser, isReady, setHeaderColor, setBackgroundColor } = useTelegram();
  const { user, setUser, isLoading, setLoading } = useUserStore();
  
  const [lp, setLp] = useState<any>(null);

  useMarketingBot();

  useEffect(() => {
    try {
      // Initialize Telegram SDK and attempt to retrieve launch params
      init();
      const params = retrieveLaunchParams();
      setLp(params);
      console.log('Telegram SDK & Analytics Initialized', params);
    } catch (e) {
      console.warn('Telegram SDK initialization skipped or failed:', e);
    }
  }, []);

  useEffect(() => {
    if (isReady) {
      setHeaderColor("#000000");
      setBackgroundColor("#000000");
    }
  }, [isReady, setHeaderColor, setBackgroundColor]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!tgUser?.id || !supabase) {
        setLoading(false);
        return;
      }

      try {
        const profileQuery = supabase
          .from('users')
          .select('*')
          .eq('telegram_id', tgUser.id)
          .single();

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Profile request timeout")), 12000)
        );

        const { data, error } = await Promise.race([profileQuery, timeoutPromise]) as any;

        if (error && error.code === 'PGRST116') {
          console.warn("User not found in 'users' table.");
          return;
        }

        if (error) {
          console.error("Profile fetch error:", error);
          return;
        } else if (data) {
          setUser({
            id: data.id,
            telegram_id: data.telegram_id,
            name: data.name,
            phone: data.phone,
            credits: data.credits || 0,
            plan: data.plan || "free",
            role: data.role || "user",
            photo_url: data.photo_url
          });
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
      } finally {
        setLoading(false);
      }
    };

    if (tgUser?.id) {
      fetchProfile();
    } else if (isReady && !tgUser) {
      setLoading(false);
    }
  }, [tgUser, isReady, setUser, setLoading]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (!requestedTab) return;

    const validTabs: TabType[] = ["home", "matches", "analyze", "history", "profile", "admin"];
    if (!validTabs.includes(requestedTab as TabType)) return;

    setActiveTab(requestedTab as TabType);
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <Home onTabChange={setActiveTab} />;
      case "matches": return <Matches onTabChange={setActiveTab} />;
      case "analyze": return <Analyze />;
      case "history": return <History />;
      case "profile": return <Profile />;
      case "admin": return <Admin />;
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
