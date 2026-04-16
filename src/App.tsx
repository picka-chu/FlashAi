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
import { supabase } from "./lib/supabase";
import { motion, AnimatePresence } from "motion/react";
import { useMarketingBot } from "./hooks/useMarketingBot";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const { user: tgUser, isReady, setHeaderColor, setBackgroundColor } = useTelegram();
  const { setUser, isLoading, setLoading } = useUserStore();

  useMarketingBot();

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
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('telegram_id', tgUser.id)
          .single();

        if (error && error.code === 'PGRST116') {
          console.warn("User not found in 'users' table.");
          setLoading(false);
        } else if (data) {
          setUser({
            id: data.id,
            telegram_id: data.telegram_id,
            name: data.name,
            phone: data.phone,
            credits: data.credits || 0,
            plan: data.plan || "free",
            photo_url: data.photo_url
          });
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setLoading(false);
      }
    };

    if (tgUser?.id) {
      fetchProfile();
    } else if (isReady && !tgUser) {
      setLoading(false);
    }
  }, [tgUser, isReady, setUser, setLoading]);

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
