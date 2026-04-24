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

import { init, retrieveLaunchParams } from '@telegram-apps/sdk-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const { user: tgUser, isReady, initData, setHeaderColor, setBackgroundColor } = useTelegram();
  const { setUser, isLoading, setLoading } = useUserStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  
  const [lp, setLp] = useState<any>(null);

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
      if (!tgUser?.id) {
        setLoading(false);
        return;
      }

      setLoadError(null);
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 10_000);

      try {
        const mapUser = (data: any) => ({
          id: data.id,
          telegram_id: data.telegram_id,
          name: data.name,
          username: data.username,
          phone: data.phone,
          credits: data.credits || 0,
          plan: data.plan || "free",
          role: data.role || "user",
          photo_url: data.photo_url,
        });

        // Primary path: ask backend for the authenticated profile.
        // This handles legacy schema fallbacks (registration cache) and keeps frontend logic simple.
        if (initData) {
          const res = await fetch('/api/auth/me', {
            headers: { 'X-TG-Init-Data': initData },
            signal: abortController.signal,
          });

          if (res.ok) {
            const payload = await res.json();
            const profile = payload?.user;
            if (profile?.phone) {
              setUser(mapUser(profile));
            } else {
              setUser(null);
            }
            return;
          }
        }

        // Fallback to direct Supabase read for local/dev environments
        if (supabase) {
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', tgUser.id)
            .single();

          if (!error && data?.phone) {
            setUser(mapUser(data));
          } else {
            setUser(null);
          }
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setLoadError("We couldn't load your profile. Check your connection and try again.");
        setUser(null);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    if (tgUser?.id) {
      fetchProfile();
    } else if (isReady && !tgUser) {
      setUser(null);
      setLoading(false);
    }
  }, [tgUser, isReady, initData, setUser, setLoading, retryNonce]);

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
      case "analyze": return <Analyze onTabChange={setActiveTab} />;
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

  if (loadError) {
    return (
      <div className="h-[100dvh] bg-black flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 text-center space-y-4">
          <p className="text-sm font-black text-white">Connection issue</p>
          <p className="text-xs font-bold text-zinc-400">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setRetryNonce((v) => v + 1);
            }}
            className="w-full py-3 rounded-2xl bg-[#ccff00] text-black font-black text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === "admin") {
    return <Admin />;
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
