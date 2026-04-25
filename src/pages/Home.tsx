import React, { useState, useRef, useEffect } from 'react';
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
  Users,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  History as HistoryIcon,
  UserPlus,
  Megaphone
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { getLiveMatches, getUpcomingMatches, getTrendingPicks, recordMatchClick } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';

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

const generateDates = () => {
  const dates = [];
  for (let i = -2; i <= 4; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const weekDates = generateDates();

export const Home: React.FC<HomeProps> = ({ onTabChange }) => {
  const [topPickIndex, setTopPickIndex] = useState(0);
  const [adIndex, setAdIndex] = useState(0);
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [trendingMatches, setTrendingMatches] = useState<any[]>([]);
  const [dynamicAds, setDynamicAds] = useState<any[]>([]);
  const [recentAnalysis, setRecentAnalysis] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
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
    if (ad.link) {
       if (ad.link.startsWith('internal:')) {
         onTabChange(ad.link.replace('internal:', '').replace('/', ''));
       } else if (ad.link.startsWith('http')) {
         tg.openLink(ad.link);
       } else {
         onTabChange(ad.link.replace('/', ''));
       }
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const authInitData = initData || tg?.initData || '';
        setHistoryLoading(Boolean(authInitData));
        const [upcoming, trending, adsRes, historyRes, live] = await Promise.all([
          getUpcomingMatches(),
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
          const leagueName = m.league?.name || m.league?.displayName || m.competition?.name || 'Unknown League';
          return {
            ...m,
            id: m.fixture.id,
            home: m.teams.home.name,
            away: m.teams.away.name,
            homeShort: m.teams.home.name.substring(0, 3).toUpperCase(),
            awayShort: m.teams.away.name.substring(0, 3).toUpperCase(),
            homeLogo: m.teams.home.logo,
            awayLogo: m.teams.away.logo,
            league: leagueName,
            confidence: m.confidence || null,
            time: new Date(m.fixture.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            date: (() => {
              const matchDate = new Date(m.fixture.date);
              const today = new Date();
              const tomorrow = new Date();
              tomorrow.setDate(today.getDate() + 1);
              
              if (matchDate.toDateString() === today.toDateString()) return 'Today';
              if (matchDate.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
              return matchDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
            })(),
            gradient: i % 2 === 0 ? 'from-white/10 via-zinc-900 to-sky-500/20' : 'from-red-500/20 via-zinc-900 to-red-600/10'
          };
        });

        const mappedLive = (Array.isArray(live) ? live : []).map((m: any, i: number) => ({
          ...m,
          id: m.fixture?.id || `live_${i}`,
          home: m.teams?.home?.name || 'Home',
          away: m.teams?.away?.name || 'Away',
          homeShort: (m.teams?.home?.name || 'H').substring(0, 3).toUpperCase(),
          awayShort: (m.teams?.away?.name || 'A').substring(0, 3).toUpperCase(),
          homeLogo: m.teams?.home?.logo,
          awayLogo: m.teams?.away?.logo,
          league: m.league?.name || 'Live Football',
          score: `${m.goals?.home ?? 0}-${m.goals?.away ?? 0}`,
          minute: `${Math.floor(Number(m.fixture?.status?.elapsed || 0))}'`,
          status: 'Live'
        }));
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

  return (
    <div className="h-full relative overflow-hidden bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="flex justify-between items-center px-4 pt-6 pb-4">
        <div className="flex items-center gap-3">
          {user?.phone ? (
            <>
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
                    className="w-10 h-10 rounded-full border-2 border-[#ccff00]/50 object-cover" 
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full border-2 border-[#ccff00]/50 bg-zinc-800 flex items-center justify-center">
                    <Users className="w-4 h-4 text-zinc-400" />
                  </div>
                )}
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#ccff00] rounded-full border-2 border-[#0a0a0a]"></div>
              </button>
              <div>
                <p className="text-[10px] text-zinc-400 tracking-wider font-bold">Good morning!</p>
                <p className="text-sm font-black text-white">{user.name}</p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => { hapticFeedback('light'); setIsSignUpOpen(true); }}
                className="flex items-center gap-2 bg-[#ccff00] text-black px-4 py-2 rounded-xl text-xs font-black shadow-[0_0_15px_rgba(204,255,0,0.1)] active:scale-95 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                Sign up
              </button>
              <div className="w-px h-4 bg-zinc-800 mx-1" />
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Guest access</p>
            </div>
          )}
        </div>
        
        {user?.phone && (
          <div className="flex items-center gap-3">
            <div className={`backdrop-blur-md border px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)] ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
              <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
              <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
            </div>
          </div>
        )}
      </div>

      <div className="h-[calc(100%-80px)] overflow-y-auto no-scrollbar px-4 space-y-8 pb-24">
        {isLoading ? (
          <div className="space-y-8">
            {/* Featured Match Skeleton */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <Skeleton className="w-32 h-4" />
                <Skeleton className="w-16 h-4" />
              </div>
              <Skeleton className="w-full h-48 rounded-[32px]" />
            </div>

            {/* Ads Skeleton */}
            <Skeleton className="w-full h-32 rounded-[28px]" />
          </div>
        ) : (
          <>
            {/* Featured Match */}
            {upcomingMatches.length > 0 && (
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black tracking-widest text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00]" />
                Featured match
              </h3>
              <div className="flex items-center gap-2">
                <div className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center gap-1">
                  <Flame className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-black text-red-500">Hot</span>
                </div>
                <div className="px-2 py-0.5 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20">
                  <span className="text-[10px] font-bold text-[#ccff00]">Top pick</span>
                </div>
              </div>
            </div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => handleAnalyze(upcomingMatches[0])}
              className="relative overflow-hidden rounded-[32px] bg-[#ccff00] p-6 group cursor-pointer shadow-[0_20px_50px_rgba(204,255,0,0.2)]"
            >
              {/* Background Effects */}
              <div className="absolute top-0 right-0 w-48 h-48 bg-white/20 blur-[80px]"></div>
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-black/5 blur-[60px]"></div>
              
              {/* FOMO Overlay */}
              <div className="absolute top-4 right-4 z-20">
                <div className="bg-black/10 backdrop-blur-md border border-black/10 px-3 py-1 rounded-full flex items-center gap-2">
                  <Clock className="w-3 h-3 text-black" />
                  <span className="text-[9px] font-black text-black tracking-tighter">Analysis expires soon</span>
                </div>
              </div>

              <div className="relative z-10">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center">
                      <Trophy className="w-3 h-3 text-black" />
                    </div>
                    <span className="text-[10px] font-black text-black/60 tracking-tighter">
                      {upcomingMatches[0].league}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mr-24">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                    <span className="text-[10px] font-black text-black tracking-widest">
                      {upcomingMatches[0].time}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col items-center gap-3 flex-1">
                    <div className="w-20 h-20 rounded-3xl bg-white p-4 shadow-xl group-hover:scale-110 transition-transform duration-500">
                      <img src={upcomingMatches[0].homeLogo} alt={upcomingMatches[0].home} className="w-full h-full object-contain" />
                    </div>
                    <span className="text-xs font-black text-black text-center line-clamp-1">{upcomingMatches[0].home}</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-3xl font-black text-black/10 italic tracking-tighter">VS</div>
                    {upcomingMatches[0].confidence ? (
                      <div className="px-4 py-1.5 rounded-full bg-black shadow-lg">
                        <span className="text-[11px] font-black text-[#ccff00]">{upcomingMatches[0].confidence}% win</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-center gap-3 flex-1">
                    <div className="w-20 h-20 rounded-3xl bg-white p-4 shadow-xl group-hover:scale-110 transition-transform duration-500">
                      <img src={upcomingMatches[0].awayLogo} alt={upcomingMatches[0].away} className="w-full h-full object-contain" />
                    </div>
                    <span className="text-xs font-black text-black text-center line-clamp-1">{upcomingMatches[0].away}</span>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-black/10 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-black/60">Real-time fixture insights</span>
                  <button className="bg-black text-white px-4 py-2 rounded-2xl transition-colors active:scale-95">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-[#ccff00]" />
                      <span className="text-[10px] font-black tracking-widest">Unlock</span>
                    </div>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Ad Carousel */}
        <div className="relative group px-1">
          <div 
            ref={adsRef}
            onScroll={() => handleScroll(adsRef, setAdIndex)}
            className="flex gap-4 overflow-x-auto no-scrollbar snap-x py-2"
          >
            {dynamicAds.map((ad: any, i: number) => {
              const Icon = ad.icon || Megaphone;
              const Deco = ad.deco || Sparkles;
              const primaryColor = ad.primary_color || '#ccff00';
              
              return (
                <div 
                  key={ad.id || i}
                  className={`shrink-0 w-full snap-center relative overflow-hidden rounded-[40px] p-6 min-h-[220px] transition-all transform duration-500 ${i === adIndex ? 'scale-100' : 'scale-[0.97] opacity-50'}`}
                  style={{ 
                    backgroundColor: ad.image_url ? '#09090b' : undefined,
                    boxShadow: i === adIndex ? `0 20px 40px -20px ${primaryColor}40` : 'none',
                    border: i === adIndex ? `1px solid ${primaryColor}30` : '1px solid #27272a'
                  }}
                >
                  {ad.image_url ? (
                     <>
                       <img 
                        src={ad.image_url} 
                        alt="" 
                        className="absolute inset-0 w-full h-full object-cover opacity-40 transition-transform duration-1000 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                       />
                       <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-80" />
                       <div 
                         className="absolute inset-0 opacity-20 transition-opacity duration-1000"
                         style={{ background: `radial-gradient(circle at center, ${primaryColor}20, transparent 70%)` }}
                       />
                     </>
                  ) : (
                    <div className={`absolute inset-0 bg-gradient-to-br ${ad.bg || 'from-zinc-800 to-zinc-900'}`} />
                  )}

                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-2">
                         <div 
                          className={`${ad.darkText ? 'bg-black/10' : 'bg-white/10'} backdrop-blur-xl p-3 rounded-[20px]`}
                          style={{ border: `1px solid ${primaryColor}40` }}
                         >
                           <Icon className="w-5 h-5" style={{ color: primaryColor }} />
                         </div>
                      </div>
                      
                      {ad.expires_at && <CountdownBadge expiresAt={ad.expires_at} color={primaryColor} />}
                    </div>
                    
                    <div className="mt-auto space-y-4">
                      <div>
                        <h4 className={`text-xl font-black leading-tight ${ad.darkText ? 'text-black' : 'text-white'}`}>
                          {ad.title}
                        </h4>
                        <p className={`text-[11px] font-bold mt-1 opacity-70 tracking-wide uppercase line-clamp-2 ${ad.darkText ? 'text-black' : 'text-zinc-400'}`}>
                          {ad.sub || ad.subtitle}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleAdClick(ad)}
                          className="text-[10px] font-black tracking-[0.15em] px-6 py-3 rounded-2xl shadow-2xl active:scale-95 transition-all uppercase"
                          style={{ 
                            backgroundColor: primaryColor,
                            color: ad.darkText ? 'black' : (primaryColor === '#ccff00' ? 'black' : 'white')
                          }}
                        >
                          {ad.cta || 'Claim Now'}
                        </button>
                        
                        {ad.clicks && (
                          <div className="flex items-center gap-1 opacity-40">
                             <TrendingUp className="w-3 h-3 text-white" />
                             <span className="text-[9px] font-bold text-white uppercase">{ad.clicks} users</span>
                          </div>
                        )}
                      </div>
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

        {/* Top Prematch */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em]">Top prematch</h3>
            <button 
              onClick={() => onTabChange('matches')}
              className="text-[10px] font-black text-[#ccff00] uppercase tracking-wider"
            >
              View all
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2">
            {upcomingMatches.length > 0 ? (
              upcomingMatches.slice(0, 10).map((match) => (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => handleAnalyze(match)}
                  className="shrink-0 w-[280px] snap-center relative bg-[#141414] border border-white/[0.03] rounded-2xl p-4 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <div className="flex flex-col gap-3">
                    {/* League & Time */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.1em] line-clamp-1 max-w-[150px]">{match.league}</span>
                      </div>
                      <span className="text-[9px] font-medium text-zinc-400">{match.time}</span>
                    </div>
                    
                    {/* Teams side-by-side */}
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-zinc-800/50 flex items-center justify-center overflow-hidden border border-white/5">
                          {match.homeLogo ? (
                            <img src={match.homeLogo} alt="" className="w-5 h-5 object-contain" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-[8px] font-bold text-zinc-500">{match.homeShort}</span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-zinc-100 truncate">{match.home}</span>
                      </div>
                      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">VS</div>
                      <div className="flex items-center justify-end gap-2 min-w-0">
                        <span className="text-sm font-bold text-zinc-100 truncate text-right">{match.away}</span>
                        <div className="w-7 h-7 rounded-lg bg-zinc-800/50 flex items-center justify-center overflow-hidden border border-white/5">
                          {match.awayLogo ? (
                            <img src={match.awayLogo} alt="" className="w-5 h-5 object-contain" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-[8px] font-bold text-zinc-500">{match.awayShort}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer Info */}
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.03]">
                      <span className="text-[9px] font-medium text-zinc-500">{match.date}</span>
                      <div className="flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-[#ccff00] fill-[#ccff00]" />
                        <span className="text-[9px] font-black text-[#ccff00] uppercase tracking-tighter">Click to analyze</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              [1, 2, 3].map((i) => (
                <div key={i} className="shrink-0 w-[280px] h-36 bg-[#141414] border border-white/[0.03] rounded-2xl animate-pulse" />
              ))
            )}
          </div>
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
                  <motion.div
                    key={match.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => onTabChange('matches')}
                    className="shrink-0 w-[260px] snap-center relative bg-[#141414] border border-red-500/20 rounded-2xl p-4 active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.1em] line-clamp-1 max-w-[150px]">{match.league}</span>
                      <span className="text-[9px] font-black text-red-500">{match.minute || 'LIVE'}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <span className="text-sm font-bold text-zinc-100 truncate">{match.home}</span>
                      <div className="text-center">
                        <div className="text-lg font-black text-white leading-none">{match.score || '0-0'}</div>
                        <div className="text-[9px] font-bold text-red-500 mt-1">LIVE</div>
                      </div>
                      <span className="text-sm font-bold text-zinc-100 truncate text-right">{match.away}</span>
                    </div>
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
