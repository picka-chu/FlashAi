import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Skeleton } from '../components/ui/Skeleton';
import { 
  Zap, 
  TrendingUp, 
  ShieldCheck, 
  Sparkles, 
  Flame, 
  Activity, 
  ChevronRight,
  Trophy,
  Target,
  AlertCircle,
  Star,
  Rocket,
  Info,
  Search,
  Calendar,
  CalendarDays,
  Users,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  History as HistoryIcon,
  UserPlus,
  Megaphone,
  Newspaper
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { getLiveMatches, getUpcomingMatches, getTrendingPicks, getFootballNews, recordMatchClick, type FootballNewsArticle } from '../services/footballService';
import { FootballNewsFeed } from '../components/FootballNewsFeed';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { ModernMatchCard } from '../components/ModernMatchCard';
import { FeaturedMatchCard } from '../components/FeaturedMatchCard';
import { dateFromKey, formatMatch, localDateKey } from '../lib/matchUtils';

const CountdownBadge: React.FC<{ expiresAt: string, color: string }> = ({ expiresAt, color }) => {
  const [timeLeft, setTimeLeft] = useState('');
  
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(expiresAt).getTime();
      const diff = end - now;
      
      if (diff <= 0) {
        setTimeLeft('EXPIRED');
        clearInterval(timer);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      
      if (hours > 24) {
        setTimeLeft(`${Math.floor(hours/24)}d ${hours%24}h`);
      } else {
        setTimeLeft(`${hours}h ${mins}m ${secs}s`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (timeLeft === 'EXPIRED') return null;

  return (
    <div 
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10"
      style={{ backgroundColor: `${color}20` }}
    >
      <Clock className="w-3 h-3" style={{ color }} />
      <span className="text-[9px] font-black uppercase tracking-tighter" style={{ color }}>
        {timeLeft}
      </span>
    </div>
  );
};

const ADS: any[] = [];

interface HomeProps {
  onTabChange: (tab: any) => void;
}

export const Home: React.FC<HomeProps> = ({ onTabChange }) => {
  const [topPickIndex, setTopPickIndex] = useState(0);
  const [adIndex, setAdIndex] = useState(0);
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [trendingMatches, setTrendingMatches] = useState<any[]>([]);
  const [dynamicAds, setDynamicAds] = useState<any[]>([]);
  const [recentAnalysis, setRecentAnalysis] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [news, setNews] = useState<FootballNewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  
  const topPicksRef = useRef<HTMLDivElement>(null);
  const adsRef = useRef<HTMLDivElement>(null);

  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const { user, setSelectedMatch, setIsAnalyzing, setAnalysisResult } = useUserStore();
  const { hapticFeedback, tg, initData } = useTelegram();

  const getAnalysisStatusUi = (status: string) => {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'won') {
      return {
        label: 'Won',
        className: 'text-green-300 bg-green-500/10 border-green-500/30',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
      };
    }
    if (normalized === 'lost') {
      return {
        label: 'Lost',
        className: 'text-red-300 bg-red-500/10 border-red-500/30',
        icon: <XCircle className="w-3.5 h-3.5 text-red-400" />
      };
    }
    return {
      label: 'Pending',
      className: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
      icon: <Clock className="w-3.5 h-3.5 text-amber-400" />
    };
  };

  const formatRelativeTime = (date: string) => {
    const now = Date.now();
    const then = new Date(date).getTime();
    const diff = Math.max(0, now - then);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return 'Just now';
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    return `${Math.floor(diff / day)}d ago`;
  };

  useEffect(() => {
    const activeAd = dynamicAds[adIndex];
    if (activeAd?.id && typeof activeAd.id === 'string') {
       fetch(`/api/common/ads/${activeAd.id}/track`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ type: 'view' })
       }).catch(() => {});
    }
  }, [adIndex, dynamicAds]);

  const handleAdClick = (ad: any) => {
    hapticFeedback('light');
    if (ad.id && typeof ad.id === 'string') {
       fetch(`/api/common/ads/${ad.id}/track`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ type: 'click' })
       }).catch(() => {});
    }

    const normalizeInternalTab = (raw: string) => {
      const compact = String(raw || '').trim().replace(/^internal:/i, '').replace(/^\/+/, '').toLowerCase().replace(/[\s_-]+/g, '');
      const map: Record<string, string> = {
        home: 'home',
        matches: 'matches',
        analyze: 'analyze',
        analysis: 'analyze',
        history: 'history',
        profile: 'profile',
        admin: 'admin',
        livepreview: 'livePreview',
        livematchpreview: 'livePreview',
        live: 'livePreview',
      };
      return map[compact] || null;
    };

    if (ad.is_internal && ad.internal_target) {
       const tab = normalizeInternalTab(ad.internal_target);
       if (tab) onTabChange(tab);
    } else if (ad.link) {
       if (ad.link.startsWith('internal:')) {
         const tab = normalizeInternalTab(ad.link);
         if (tab) onTabChange(tab);
       } else if (ad.link.startsWith('http')) {
         tg.openLink(ad.link);
       } else {
         const tab = normalizeInternalTab(ad.link);
         if (tab) onTabChange(tab);
       }
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const authInitData = initData || tg?.initData || '';
        setHistoryLoading(Boolean(authInitData));
        const [upcoming, trending, adsRes, historyRes, live] = await Promise.all([
          getUpcomingMatches(authInitData),
          getTrendingPicks(),
          fetch('/api/common/ads', { headers: { 'X-TG-Init-Data': authInitData } }).then(r => r.json()),
          authInitData
            ? fetch('/api/user/history', { headers: { 'X-TG-Init-Data': authInitData } }).then(r => r.ok ? r.json() : [])
            : Promise.resolve([]),
          user?.plan && user.plan !== 'free'
            ? getLiveMatches(authInitData).catch(() => [])
            : Promise.resolve([])
        ]);
        
        if (adsRes && adsRes.length > 0) {
           setDynamicAds(adsRes);
        }
        
        const mappedUpcoming = upcoming.map((m: any, i: number) => {
          const formatted = formatMatch(m);
          return {
            ...formatted,
            confidence: m.confidence || null,
            gradient: i % 2 === 0 ? 'from-white/10 via-zinc-900 to-sky-500/20' : 'from-red-500/20 via-zinc-900 to-red-600/10'
          };
        });

        const mappedLive = (Array.isArray(live) ? live : []).map((m: any) => formatMatch(m));
        setLiveMatches(mappedLive.slice(0, 20));

        if (trending && trending.length > 0) {
          setTrendingMatches(trending.map((t: any) => {
            return {
              id: t.id,
              teams: t.teams,
              activity: String(t.clicks || 0),
            };
          }));
        } else {
          setTrendingMatches(mappedUpcoming.slice(0, 3).map((m: any) => {
            const hash = String(m.id || `${m.home}-${m.away}`).split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
            return {
              id: m.id,
              teams: `${m.home} vs ${m.away}`,
              activity: String(10 + (hash % 90)),
            };
          }));
        }

        setUpcomingMatches(mappedUpcoming.slice(0, 200));
        const normalizedHistory = (Array.isArray(historyRes) ? historyRes : []).map((item: any) => ({
          id: String(item.id),
          match: item.match || `${item.home || 'Home'} vs ${item.away || 'Away'}`,
          predictionMarket: item.predictionMarket || 'Unknown market',
          confidence: Number(item.confidence || 0),
          status: String(item.status || 'pending').toLowerCase(),
          created_at: item.created_at || new Date().toISOString()
        }));
        setRecentAnalysis(normalizedHistory.slice(0, 5));
      } catch (error) {
        console.error("Failed to fetch matches:", error);
        setUpcomingMatches([]);
        setLiveMatches([]);
        setRecentAnalysis([]);
      } finally {
        setHistoryLoading(false);
        setIsLoading(false);
      }
    };
    fetchData();
  }, [initData, tg?.initData, user?.phone, user?.plan]);

  // Football news feed is loaded independently so it never delays the home page.
  useEffect(() => {
    let cancelled = false;
    setNewsLoading(true);
    getFootballNews(12)
      .then((articles) => {
        if (!cancelled) setNews(articles);
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll for Top Picks
  useEffect(() => {
    const interval = setInterval(() => {
      if (topPicksRef.current && upcomingMatches.length > 0) {
        const nextIndex = (topPickIndex + 1) % upcomingMatches.length;
        const width = topPicksRef.current.offsetWidth;
        topPicksRef.current.scrollTo({
          left: nextIndex * width,
          behavior: 'smooth'
        });
        setTopPickIndex(nextIndex);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [topPickIndex, upcomingMatches]);

  // Auto-scroll for Ads
  useEffect(() => {
    const adsToScroll = dynamicAds;
    if (!adsToScroll.length) return;
    const interval = setInterval(() => {
      if (adsRef.current) {
        const nextIndex = (adIndex + 1) % adsToScroll.length;
        const width = adsRef.current.offsetWidth;
        adsRef.current.scrollTo({
          left: nextIndex * width,
          behavior: 'smooth'
        });
        setAdIndex(nextIndex);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [adIndex, dynamicAds]);

  const handleScroll = (ref: React.RefObject<HTMLDivElement>, setIndex: (i: number) => void) => {
    if (ref.current) {
      const scrollLeft = ref.current.scrollLeft;
      const width = ref.current.offsetWidth;
      const index = Math.round(scrollLeft / width);
      setIndex(index);
    }
  };

  const handleAnalyze = (match: any) => {
    if (!user?.phone) {
      hapticFeedback('medium');
      setIsSignUpOpen(true);
      return;
    }
    const matchName = match.teams || `${match.home} vs ${match.away}`;
    recordMatchClick(match.id, matchName);
    setSelectedMatch(match);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    onTabChange('analyze');
  };

  const todayKey = localDateKey(new Date());
  const selectedDay = dateFromKey(selectedDate || todayKey);
  const isToday = selectedDate === todayKey;
  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const selectedLabel = selectedDay.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.phone ? String(user?.name || 'there').split(' ')[0] : 'Guest';

  const countByDate = useMemo(() => upcomingMatches.reduce((counts: Record<string, number>, match: any) => {
    if (match?.dateKey) counts[match.dateKey] = (counts[match.dateKey] || 0) + 1;
    return counts;
  }, {}), [upcomingMatches]);

  const dayOptions = useMemo(() => {
    const base = dateFromKey(todayKey);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(base);
      date.setDate(base.getDate() + offset);
      const key = localDateKey(date);
      return {
        key,
        date,
        dayName: date.toLocaleDateString('en-GB', { weekday: 'short' }),
        dayNumber: date.getDate(),
        isToday: key === todayKey,
        count: countByDate[key] || 0,
      };
    });
  }, [countByDate, todayKey]);

  useEffect(() => {
    const firstKey = localDateKey(new Date());
    const lastKey = localDateKey(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));
    setSelectedDate((current) => (!current || current < firstKey || current > lastKey ? firstKey : current));
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0);
    const timer = window.setTimeout(() => {
      setSelectedDate(localDateKey(new Date()));
    }, Math.max(1000, midnight.getTime() - now.getTime()));
    return () => window.clearTimeout(timer);
  }, [todayKey]);

  const selectedMatches = useMemo(
    () => upcomingMatches.filter((match: any) => match?.dateKey === selectedDate),
    [selectedDate, upcomingMatches],
  );
  const nextMatch = upcomingMatches.find((match: any) => match?.dateKey >= selectedDate) || null;
  const featuredMatch = selectedMatches[0] || nextMatch;
  const listMatches = selectedMatches.length
    ? selectedMatches
    : upcomingMatches.filter((match: any) => match?.dateKey >= selectedDate).slice(0, 10);
  const selectedCount = selectedMatches.length;
  const featuredIsNext = selectedCount === 0;

  return (
    <div className="h-full relative overflow-hidden bg-[#0a0a0a] text-white flex flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_right,rgba(204,255,0,0.09),transparent_66%)]" />

      <header className="relative z-10 flex-none px-4 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#ccff00] flex items-center justify-center shadow-[0_0_24px_rgba(204,255,0,0.18)]">
              <Zap className="w-4 h-4 text-black" fill="currentColor" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] text-[#ccff00]">Flash AI</p>
              <p className="text-[10px] font-semibold text-zinc-500">Smart match intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user?.phone ? (
              <div className={`border px-3 py-1.5 rounded-full flex items-center gap-1.5 backdrop-blur-md ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
                <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
                <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
              </div>
            ) : (
              <button
                onClick={() => { hapticFeedback('light'); setIsSignUpOpen(true); }}
                className="flex items-center gap-1.5 bg-[#ccff00] text-black px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Sign up
              </button>
            )}

            {user?.phone && (
              <button
                type="button"
                onClick={() => {
                  hapticFeedback('light');
                  onTabChange('profile');
                }}
                className="relative active:scale-95 transition-transform"
                aria-label="Open profile"
              >
                {user.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt="User"
                    className="w-9 h-9 rounded-full border-2 border-[#ccff00]/50 object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full border-2 border-[#ccff00]/50 bg-zinc-800 flex items-center justify-center">
                    <Users className="w-4 h-4 text-zinc-400" />
                  </div>
                )}
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#ccff00] rounded-full border-2 border-[#0a0a0a]" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              {user?.phone ? greeting : 'Live match intelligence'}
            </p>
            <h1 className="text-[22px] font-black leading-tight text-white mt-0.5 truncate">
              {user?.phone ? firstName : 'Welcome to Flash AI'}
            </h1>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1.5">
            <CalendarDays className="w-3 h-3 text-[#ccff00]" />
            {todayLabel}
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 space-y-7 pb-24">
        {isLoading ? (
          <div className="space-y-7">
            <Skeleton className="w-full h-20 rounded-2xl" />
            <div className="space-y-3">
              <div className="flex justify-between">
                <Skeleton className="w-32 h-4" />
                <Skeleton className="w-16 h-4" />
              </div>
              <Skeleton className="w-full h-48 rounded-[32px]" />
            </div>
            <Skeleton className="w-full h-32 rounded-[28px]" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-[#ccff00]" />
                  <h2 className="text-sm font-black text-white tracking-wide">Match centre</h2>
                </div>
                <button
                  onClick={() => onTabChange('matches')}
                  className="flex items-center gap-0.5 text-[10px] font-black text-[#ccff00] uppercase tracking-wider"
                >
                  All matches
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
                {dayOptions.map((day) => {
                  const active = day.key === selectedDate;
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => {
                        hapticFeedback('light');
                        setSelectedDate(day.key);
                      }}
                      className={`shrink-0 w-[64px] rounded-2xl border px-2 py-2.5 text-center transition-all active:scale-95 ${
                        active
                          ? 'bg-[#ccff00] border-[#ccff00] text-black shadow-[0_8px_24px_rgba(204,255,0,0.16)]'
                          : 'bg-white/[0.03] border-white/[0.07] text-zinc-300'
                      }`}
                    >
                      <span className={`block text-[9px] font-black uppercase tracking-wider ${active ? 'text-black/60' : 'text-zinc-500'}`}>
                        {day.isToday ? 'Today' : day.dayName}
                      </span>
                      <span className="block text-lg font-black leading-6">{day.dayNumber}</span>
                      <span className={`block text-[8px] font-bold uppercase tracking-wide ${active ? 'text-black/60' : 'text-zinc-600'}`}>
                        {day.count ? `${day.count} ${day.count === 1 ? 'match' : 'matches'}` : 'No games'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedCount === 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
                <div className="w-8 h-8 shrink-0 rounded-xl bg-[#ccff00]/10 border border-[#ccff00]/20 flex items-center justify-center">
                  <Info className="w-4 h-4 text-[#ccff00]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-white">
                    {isToday ? 'No fixtures left today' : `No fixtures on ${selectedLabel}`}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
                    {nextMatch ? `Next scheduled: ${nextMatch.home} vs ${nextMatch.away} · ${nextMatch.date} ${nextMatch.time}` : 'New fixtures will appear here as soon as they are scheduled.'}
                  </p>
                </div>
              </div>
            )}

            {featuredMatch ? (
              <FeaturedMatchCard
                match={featuredMatch}
                eyebrow={featuredIsNext ? 'Next up' : isToday ? "Today's headline" : 'Selected fixture'}
                badge={featuredIsNext ? 'Scheduled' : 'Top pick'}
                showHot={!featuredIsNext}
                onClick={() => handleAnalyze(featuredMatch)}
              />
            ) : (
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/40 p-7 text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-800/60 flex items-center justify-center mx-auto mb-3">
                  <CalendarDays className="w-5 h-5 text-zinc-600" />
                </div>
                <p className="text-sm font-black text-white">No fixtures available</p>
                <p className="text-[10px] text-zinc-500 mt-1">Check back soon for the next round of matches.</p>
              </div>
            )}

        {/* Ad Carousel */}
        <div className="relative group">
          <div 
            ref={adsRef}
            onScroll={() => handleScroll(adsRef, setAdIndex)}
            className="flex gap-3 overflow-x-auto no-scrollbar snap-x py-1 px-0.5"
          >
            {dynamicAds.map((ad: any, i: number) => {
              const gradientFrom = ad?.primary_color || '#3b82f6';
              const gradientTo = ad?.gradient_to ?? '#8b5cf6';
              const heroColor = ad?.hero_color || '#ffffff';
              const subColor = ad?.sub_color || '#e4e4e7';
              const buttonBg = ad?.button_color || '#ffffff';
              const buttonText = ad?.button_text_color || '#111827';
              const heroSize = Number(ad?.hero_size ?? 32);
              const subSize = Number(ad?.sub_size ?? 18);
              const btnTextSize = Number(ad?.button_text_size ?? 14);
              const btnRadius = Number(ad?.button_radius ?? 999);
              const btnPadX = Number(ad?.button_pad_x ?? 20);
              const btnPadY = Number(ad?.button_pad_y ?? 8);
              return (
                <div key={ad.id || i} className={`shrink-0 w-[272px] snap-center ${i === adIndex ? 'opacity-100' : 'opacity-70'}`}>
                  <div className="relative h-[152px] rounded-[22px] overflow-hidden border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
                    style={{ background: `linear-gradient(100deg, ${gradientFrom} 0%, ${gradientTo} 75%)` }}>
                    {ad?.image_url ? <img src={ad.image_url} alt="" className="absolute right-2 top-1/2 -translate-y-1/2 h-[78%] w-[36%] object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.22)]" referrerPolicy="no-referrer" /> : null}
                    <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-black/5" />
                    <div className="relative z-10 h-full p-4 pr-20 flex flex-col justify-between">
                      <div>
                        <h4 className="font-black leading-[1.05] line-clamp-2" style={{ color: heroColor, fontSize: `${heroSize}px` }}>{ad.title || 'Promotion'}</h4>
                        <p className="mt-1.5 font-semibold leading-tight line-clamp-2" style={{ color: subColor, fontSize: `${subSize}px` }}>{ad.sub || ad.subtitle || 'Limited-time offer'}</p>
                      </div>
                      <button onClick={() => handleAdClick(ad)} className="self-start font-black active:scale-95 transition-transform" style={{ backgroundColor: buttonBg, color: buttonText, fontSize: `${btnTextSize}px`, borderRadius: `${btnRadius}px`, padding: `${btnPadY}px ${btnPadX}px` }}>
                        {String(ad?.cta ?? '').trim() || 'Check Out'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Pagination Dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            {dynamicAds.map((_, i) => (
              <div 
                key={i} 
                className={`h-1 rounded-full transition-all duration-300 ${i === adIndex ? 'w-6 bg-[#ccff00]' : 'w-1.5 bg-white/20'}`} 
              />
            ))}
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white tracking-wide">
                {selectedCount ? (isToday ? "Today's fixtures" : `${selectedLabel} fixtures`) : 'Next fixtures'}
              </h3>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {selectedCount
                  ? `${selectedCount} ${selectedCount === 1 ? 'match' : 'matches'} scheduled`
                  : 'Showing the next scheduled matches'}
              </p>
            </div>
            <button
              onClick={() => onTabChange('matches')}
              className="flex items-center gap-0.5 text-[10px] font-black text-[#ccff00] uppercase tracking-wider"
            >
              View all
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {listMatches.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2">
              {listMatches.map((match: any) => (
                <motion.div key={match.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="shrink-0 w-[320px] snap-center">
                  <ModernMatchCard match={match} variant="prematch" onClick={() => handleAnalyze(match)} compact />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-center">
              <p className="text-xs font-black text-zinc-300">No fixtures scheduled</p>
              <p className="text-[10px] text-zinc-500 mt-1">Check back later for new matches.</p>
            </div>
          )}
        </section>

        {/* Top Live Matches */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em]">Top live matches</h3>
            <button
              onClick={() => onTabChange('matches')}
              className="text-[10px] font-black text-[#ccff00] uppercase tracking-wider"
            >
              Open live
            </button>
          </div>

          {user?.plan && user.plan !== 'free' ? (
            <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2">
              {liveMatches.length > 0 ? (
                liveMatches.slice(0, 10).map((match) => (
                  <motion.div key={match.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="shrink-0 w-[320px] snap-center">
                    <ModernMatchCard match={match} variant="live" onClick={() => onTabChange('matches')} compact />
                  </motion.div>
                ))
              ) : (
                <div className="w-full bg-[#141414] border border-white/[0.03] rounded-2xl p-4 text-center text-xs text-zinc-500">
                  No live fixtures right now.
                </div>
              )}
            </div>
          ) : (
            <div className="w-full bg-[#141414] border border-zinc-800 rounded-2xl p-4 text-center">
              <p className="text-xs font-black text-white uppercase tracking-wider">Premium only</p>
              <p className="text-[11px] text-zinc-500 mt-1">Upgrade to Monthly Basic or Pro to unlock live match feed and live AI analysis.</p>
            </div>
          )}
        </section>

        {/* Football News Feed */}
        {(newsLoading || news.length > 0) && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-[#ccff00]" />
                <h3 className="text-sm font-black text-white tracking-wider">Football feed</h3>
              </div>
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">ESPN</span>
            </div>

            <FootballNewsFeed
              articles={news}
              loading={newsLoading}
              onOpen={(url) => {
                hapticFeedback('light');
                if (tg?.openLink) tg.openLink(url);
                else window.open(url, '_blank', 'noopener,noreferrer');
              }}
            />
          </section>
        )}

        {/* Live & Trending Matches (Glassmorphism) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white tracking-wider">Live & trending</h3>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-[#ccff00] animate-pulse"></div>
            </div>
          </div>

          <div className="space-y-3">
            {trendingMatches.slice(0, 3).map((match, i) => (
              <motion.div
                key={match.id || i}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleAnalyze(match)}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[24px] p-4 relative overflow-hidden cursor-pointer group"
              >
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Flame className="w-3.5 h-3.5 text-[#ccff00]" />
                    <span className="text-[10px] font-bold text-zinc-400 tracking-wider">Trending now</span>
                  </div>
                  <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Activity className="w-3 h-3 text-[#ccff00]" />
                    <span className="text-[10px] font-black text-[#ccff00]">{match.activity}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h4 className="text-sm font-black text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{match.teams}</h4>
                  </div>
                  <button className="w-8 h-8 rounded-full bg-[#ccff00] flex items-center justify-center shadow-[0_0_10px_rgba(204,255,0,0.3)] group-hover:scale-110 transition-transform">
                    <ChevronRight className="w-4 h-4 text-black" />
                  </button>
                </div>

                {/* Social Proof Stack */}
                <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-white/5">
                  <span className="text-[10px] font-black text-[#ccff00] bg-[#ccff00]/10 px-1.5 py-0.5 rounded">
                    {match.activity}
                  </span>
                  <span className="text-[10px] font-bold text-zinc-500">Recent interactions</span>
                </div>
                
                {/* Subtle glow behind card */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#ccff00]/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Recent Analysis Section - Only for registered users */}
        {user?.phone && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-black text-white tracking-wider flex items-center gap-2">
              <HistoryIcon className="w-4 h-4 text-[#ccff00]" />
              Recent analysis
            </h3>
            <button 
              onClick={() => onTabChange('history')}
              className="text-[10px] font-black text-[#ccff00] hover:text-white transition-colors"
            >
              View all
            </button>
          </div>

          <div className="space-y-2">
            {historyLoading ? (
              [1, 2, 3].map((idx) => (
                <div key={idx} className="h-[92px] rounded-[20px] bg-gradient-to-r from-zinc-900/40 to-zinc-800/20 border border-zinc-800/50 animate-pulse" />
              ))
            ) : recentAnalysis.length === 0 ? (
              <div className="bg-gradient-to-r from-zinc-900/50 to-zinc-800/30 border border-zinc-800/50 rounded-[24px] p-6 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-zinc-800/50 flex items-center justify-center mx-auto">
                  <HistoryIcon className="w-5 h-5 text-zinc-600" />
                </div>
                <p className="text-xs font-bold text-zinc-500">No analysis history yet</p>
                <p className="text-[10px] text-zinc-600">Analyze matches to build your track record</p>
              </div>
            ) : recentAnalysis.map((analysis, idx) => {
              const status = getAnalysisStatusUi(analysis.status);

              return (
                <motion.div 
                  key={analysis.id} 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => onTabChange('history')}
                  className="bg-gradient-to-r from-zinc-900/40 to-zinc-800/20 border border-zinc-800/50 rounded-[20px] p-4 hover:border-[#ccff00]/30 transition-all group cursor-pointer"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs font-black text-white truncate">{analysis.match}</p>
                        <p className="text-[10px] font-bold text-zinc-400 truncate">{analysis.predictionMarket}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9px] font-black tracking-wide ${status.className}`}>
                        {status.icon}
                        {status.label}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-zinc-300">
                        <Percent className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-black">{analysis.confidence}% confidence</span>
                      </div>
                      <span className="text-[10px] font-bold text-zinc-500">{formatRelativeTime(analysis.created_at)}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
        )}
      </>
    )}
  </div>
      <SignUpSheet 
        isOpen={isSignUpOpen} 
        onClose={() => setIsSignUpOpen(false)} 
      />
    </div>
  );
};
