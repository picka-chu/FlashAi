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
  const [trendingMatches, setTrendingMatches] = useState<any[]>([]);
  const [dynamicAds, setDynamicAds] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const topPicksRef = useRef<HTMLDivElement>(null);
  const adsRef = useRef<HTMLDivElement>(null);

  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const { user, setSelectedMatch, setIsAnalyzing, setAnalysisResult } = useUserStore();
  const { hapticFeedback, tg } = useTelegram();

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
       if (ad.link.startsWith('http')) {
         tg.openLink(ad.link);
       } else {
         onTabChange(ad.link.replace('/', ''));
       }
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [upcoming, trending, adsRes, activitiesRes] = await Promise.all([
          getUpcomingMatches(),
          getTrendingPicks(),
          fetch('/api/common/ads', { headers: { 'X-TG-Init-Data': tg?.initData || '' } }).then(r => r.json()),
          fetch('/api/user/activities', { headers: { 'X-TG-Init-Data': tg?.initData || '' } }).then(r => r.ok ? r.json() : [])
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
        setActivities(Array.isArray(activitiesRes) ? activitiesRes : []);
      } catch (error) {
        console.error("Failed to fetch matches:", error);
        setUpcomingMatches([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
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
    if (!user) {
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
              <div className="relative">
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
              </div>
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
            <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
              <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
              <span className="text-xs font-black text-white">{user.credits}</span>
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
            <h3 className="text-sm font-black text-white tracking-wider">Top prematch</h3>
            <span className="text-[10px] font-bold text-zinc-500">View all</span>
          </div>

          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4 snap-x">
            {upcomingMatches.length > 0 ? upcomingMatches.map((match) => (
              <motion.div 
                key={match.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleAnalyze(match)}
                className="shrink-0 w-[85vw] max-w-[320px] snap-center bg-zinc-900 border border-zinc-800 rounded-[32px] p-5 relative overflow-hidden cursor-pointer"
              >
                <div className="flex justify-between items-start mb-6 relative z-10">
                  <span className="text-xs font-black text-white tracking-widest bg-white/10 px-3 py-1 rounded-full">
                    {match.league}
                  </span>
                  <span className="text-[10px] font-black text-[#ccff00] bg-[#ccff00]/10 px-2 py-1 rounded-full backdrop-blur-sm">
                    {match.date}
                  </span>
                </div>

                <div className="flex items-center justify-between relative z-10">
                  <div className="flex flex-col items-center gap-2 w-1/3">
                    <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                      {match.homeLogo ? (
                        <img src={match.homeLogo} alt={match.homeShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xl font-black text-white">{match.homeShort}</span>
                      )}
                    </div>
                    <span className="text-xs font-black text-white text-center">{match.home}</span>
                  </div>

                  <div className="flex flex-col items-center justify-center w-1/3">
                    <span className="text-[10px] font-bold text-zinc-500 mb-1">{match.time}</span>
                    <span className="text-2xl font-black text-white">VS</span>
                    <span className="text-[10px] font-bold text-zinc-500 mt-1">{match.date}</span>
                  </div>

                  <div className="flex flex-col items-center gap-2 w-1/3">
                    <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                      {match.awayLogo ? (
                        <img src={match.awayLogo} alt={match.awayShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xl font-black text-white">{match.awayShort}</span>
                      )}
                    </div>
                    <span className="text-xs font-black text-white text-center">{match.away}</span>
                  </div>
                </div>
              </motion.div>
            )) : (
              <div className="w-full py-8 flex flex-col items-center justify-center bg-white/5 rounded-[32px] border border-white/10">
                <span className="text-zinc-500 text-sm font-bold">No upcoming matches</span>
              </div>
            )}
          </div>
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

        {/* Recent Activities Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white tracking-wider">Recent activities</h3>
            <span className="text-[10px] font-bold text-zinc-500">History</span>
          </div>

          <div className="space-y-3">
            {activities.length === 0 ? (
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-3 text-center text-xs text-zinc-500">
                No recent activities yet.
              </div>
            ) : activities.slice(0, 5).map((activity) => (
              <div key={activity.id} className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-[#ccff00]" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-white">{activity.endpoint}</p>
                    <p className="text-[10px] font-bold text-zinc-500">{new Date(activity.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-white/5 text-zinc-400">
                  {activity.status}
                </span>
              </div>
            ))}
          </div>
        </section>
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
