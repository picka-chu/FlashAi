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
  Clock
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { getLiveMatches, getUpcomingMatches, getTrendingPicks, recordMatchClick } from '../services/footballService';

const TOP_PICKS_FALLBACK = [
  { 
    id: 'tp1', 
    home: 'Real Madrid', 
    away: 'Man City', 
    homeShort: 'RMA',
    awayShort: 'MCI',
    league: 'Champions League', 
    confidence: 94, 
    time: '21:00',
    date: 'Today',
    gradient: 'from-white/10 via-zinc-900 to-sky-500/20'
  },
  { 
    id: 'tp2', 
    home: 'Arsenal', 
    away: 'Bayern', 
    homeShort: 'ARS',
    awayShort: 'BAY',
    league: 'Champions League', 
    confidence: 88, 
    time: '21:00',
    date: 'Today',
    gradient: 'from-red-500/20 via-zinc-900 to-red-600/10'
  },
  { 
    id: 'tp3', 
    home: 'PSG', 
    away: 'Barcelona', 
    homeShort: 'PSG',
    awayShort: 'BAR',
    league: 'Champions League', 
    confidence: 91, 
    time: '21:00',
    date: 'Today',
    gradient: 'from-blue-600/20 via-zinc-900 to-red-600/20'
  },
];

const LIVE_OPPORTUNITIES = [
  { id: 'l1', home: 'Liverpool', away: 'Chelsea', homeShort: 'LIV', awayShort: 'CHE', score: '1-1', minute: '72\'', status: 'Goal Likely', intensity: 'High Pressure', league: 'Premier League' },
  { id: 'l2', home: 'PSG', away: 'Barcelona', homeShort: 'PSG', awayShort: 'BAR', score: '2-2', minute: '85\'', status: 'Late Drama', intensity: 'Extreme Pressure', league: 'Champions League' },
];

const TRENDING_MATCHES = [
  { id: 1, teams: 'Inter vs AC Milan', activity: '24.5k analyzing', trend: '+12%' },
  { id: 2, teams: 'Dortmund vs Atletico', activity: '18.2k analyzing', trend: '+8%' },
  { id: 3, teams: 'Leverkusen vs West Ham', activity: '15.1k analyzing', trend: '+5%' },
];

const MOCK_LIVE = [
  {
    id: 'm1',
    home: 'Real Madrid',
    away: 'Barcelona',
    homeShort: 'RMA',
    awayShort: 'BAR',
    homeLogo: 'https://media.api-sports.io/football/teams/541.png',
    awayLogo: 'https://media.api-sports.io/football/teams/529.png',
    score: '2-1',
    minute: '65\'',
    status: 'Live',
    intensity: 'High Pressure',
    league: 'La Liga'
  },
  {
    id: 'm2',
    home: 'Liverpool',
    away: 'Man City',
    homeShort: 'LIV',
    awayShort: 'MCI',
    homeLogo: 'https://media.api-sports.io/football/teams/40.png',
    awayLogo: 'https://media.api-sports.io/football/teams/50.png',
    score: '0-0',
    minute: '12\'',
    status: 'Live',
    intensity: 'Tactical Battle',
    league: 'Premier League'
  },
  {
    id: 'm3',
    home: 'Bayern Munich',
    away: 'Dortmund',
    homeShort: 'BAY',
    awayShort: 'DOR',
    homeLogo: 'https://media.api-sports.io/football/teams/157.png',
    awayLogo: 'https://media.api-sports.io/football/teams/165.png',
    score: '3-1',
    minute: '82\'',
    status: 'Live',
    intensity: 'Goal Likely',
    league: 'Bundesliga'
  }
];

const MOCK_UPCOMING = [
  {
    id: 'u1',
    home: 'Arsenal',
    away: 'Chelsea',
    homeShort: 'ARS',
    awayShort: 'CHE',
    homeLogo: 'https://media.api-sports.io/football/teams/42.png',
    awayLogo: 'https://media.api-sports.io/football/teams/49.png',
    league: 'Premier League',
    confidence: 88,
    time: '20:00',
    date: 'Today',
    gradient: 'from-red-500/20 via-zinc-900 to-red-600/10'
  },
  {
    id: 'u2',
    home: 'Inter Milan',
    away: 'Juventus',
    homeShort: 'INT',
    awayShort: 'JUV',
    homeLogo: 'https://media.api-sports.io/football/teams/505.png',
    awayLogo: 'https://media.api-sports.io/football/teams/496.png',
    league: 'Serie A',
    confidence: 92,
    time: '21:45',
    date: 'Today',
    gradient: 'from-blue-600/20 via-zinc-900 to-black'
  },
  {
    id: 'u3',
    home: 'PSG',
    away: 'Lyon',
    homeShort: 'PSG',
    awayShort: 'LYO',
    homeLogo: 'https://media.api-sports.io/football/teams/85.png',
    awayLogo: 'https://media.api-sports.io/football/teams/80.png',
    league: 'Ligue 1',
    confidence: 95,
    time: '21:00',
    date: 'Today',
    gradient: 'from-blue-900 via-zinc-900 to-red-900/20'
  },
  {
    id: 'u4',
    home: 'Benfica',
    away: 'Porto',
    homeShort: 'BEN',
    awayShort: 'POR',
    homeLogo: 'https://media.api-sports.io/football/teams/211.png',
    awayLogo: 'https://media.api-sports.io/football/teams/212.png',
    league: 'Primeira Liga',
    confidence: 84,
    time: '22:15',
    date: 'Today',
    gradient: 'from-red-600/20 via-zinc-900 to-blue-600/20'
  },
  {
    id: 'u5',
    home: 'Ajax',
    away: 'PSV',
    homeShort: 'AJA',
    awayShort: 'PSV',
    homeLogo: 'https://media.api-sports.io/football/teams/194.png',
    awayLogo: 'https://media.api-sports.io/football/teams/197.png',
    league: 'Eredivisie',
    confidence: 81,
    time: '18:45',
    date: 'Today',
    gradient: 'from-red-500/10 via-zinc-900 to-white/10'
  }
];

const ADS = [
  { 
    id: 1, 
    title: 'Unlock Elite AI Insights', 
    sub: 'Get 95%+ confidence picks daily.', 
    cta: 'Upgrade Now', 
    icon: ShieldCheck, 
    bg: 'from-[#ccff00] to-[#aacc00]',
    deco: Target,
    darkText: true
  },
  { 
    id: 2, 
    title: 'Join VIP Channel', 
    sub: 'Get instant alerts on Telegram.', 
    cta: 'Join Now', 
    icon: Star, 
    bg: 'from-blue-500 to-blue-700',
    deco: Rocket
  },
  { 
    id: 3, 
    title: 'Refer & Earn Credits', 
    sub: 'Get 50 credits for every friend.', 
    cta: 'Invite Friends', 
    icon: Zap, 
    bg: 'from-purple-500 to-purple-700',
    deco: Sparkles
  }
];

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
  const [isLoading, setIsLoading] = useState(true);
  
  const topPicksRef = useRef<HTMLDivElement>(null);
  const adsRef = useRef<HTMLDivElement>(null);

  const { setSelectedMatch, setIsAnalyzing, setAnalysisResult } = useUserStore();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [upcoming, trending] = await Promise.all([
          getUpcomingMatches(),
          getTrendingPicks()
        ]);
        
        const mappedUpcoming = upcoming.map((m: any, i: number) => {
          const leagueName = m.league?.name || m.league?.displayName || 'Soccer';
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
            confidence: Math.floor(Math.random() * 15) + 80, // Simulated confidence for UI
            time: new Date(m.fixture.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            date: 'Today',
            gradient: i % 2 === 0 ? 'from-white/10 via-zinc-900 to-sky-500/20' : 'from-red-500/20 via-zinc-900 to-red-600/10'
          };
        });

        if (trending && trending.length > 0) {
          setTrendingMatches(trending.map((t: any, i: number) => {
            const clicks = t.clicks;
            const activityStr = `${clicks}`;
              
            return {
              id: t.id,
              teams: t.teams,
              activity: activityStr,
              trend: `+${Math.floor(Math.random() * 10) + 2}%`
            };
          }));
        } else if (mappedUpcoming.length > 0) {
          // Fallback to real upcoming matches if no trending data yet
          setTrendingMatches(mappedUpcoming.slice(0, 3).map((m: any) => ({
            id: m.id,
            teams: `${m.home} vs ${m.away}`,
            activity: `${Math.floor(Math.random() * 20) + 5}`,
            trend: `+${Math.floor(Math.random() * 5) + 1}%`
          })));
        }

        setUpcomingMatches(mappedUpcoming.slice(0, 20));
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
    const interval = setInterval(() => {
      if (adsRef.current) {
        const nextIndex = (adIndex + 1) % ADS.length;
        const width = adsRef.current.offsetWidth;
        adsRef.current.scrollTo({
          left: nextIndex * width,
          behavior: 'smooth'
        });
        setAdIndex(nextIndex);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [adIndex]);

  const handleScroll = (ref: React.RefObject<HTMLDivElement>, setIndex: (i: number) => void) => {
    if (ref.current) {
      const scrollLeft = ref.current.scrollLeft;
      const width = ref.current.offsetWidth;
      const index = Math.round(scrollLeft / width);
      setIndex(index);
    }
  };

  const handleAnalyze = (match: any) => {
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
          <div className="relative">
            <img src="https://i.pravatar.cc/150?img=11" alt="User" className="w-10 h-10 rounded-full border-2 border-[#ccff00]/50" />
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#ccff00] rounded-full border-2 border-[#0a0a0a]"></div>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Good Morning!</p>
            <p className="text-sm font-black text-white">Guest User</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
            <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
            <span className="text-xs font-black text-white">240</span>
          </div>
        </div>
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
              <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00]" />
                Featured Match
              </h3>
              <div className="flex items-center gap-2">
                <div className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center gap-1">
                  <Flame className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-black text-red-500 uppercase">Hot</span>
                </div>
                <div className="px-2 py-0.5 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20">
                  <span className="text-[10px] font-bold text-[#ccff00]">TOP PICK</span>
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
                  <span className="text-[9px] font-black text-black uppercase tracking-tighter">Analysis Expires Soon</span>
                </div>
              </div>

              <div className="relative z-10">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center">
                      <Trophy className="w-3 h-3 text-black" />
                    </div>
                    <span className="text-[10px] font-black text-black/60 uppercase tracking-tighter">
                      {upcomingMatches[0].league}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mr-24">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                    <span className="text-[10px] font-black text-black uppercase tracking-widest">
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
                    <div className="px-4 py-1.5 rounded-full bg-black shadow-lg">
                      <span className="text-[11px] font-black text-[#ccff00]">{upcomingMatches[0].confidence}% WIN</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-3 flex-1">
                    <div className="w-20 h-20 rounded-3xl bg-white p-4 shadow-xl group-hover:scale-110 transition-transform duration-500">
                      <img src={upcomingMatches[0].awayLogo} alt={upcomingMatches[0].away} className="w-full h-full object-contain" />
                    </div>
                    <span className="text-xs font-black text-black text-center line-clamp-1">{upcomingMatches[0].away}</span>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-black/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {[1, 2, 3].map((i) => (
                        <img key={i} src={`https://i.pravatar.cc/100?img=${i + 20}`} className="w-6 h-6 rounded-full border-2 border-[#ccff00]" />
                      ))}
                    </div>
                    <span className="text-[10px] font-bold text-black/60">
                      <span className="text-black font-black">{Math.floor(Math.random() * 500) + 1200}</span> users analyzing
                    </span>
                  </div>
                  <button className="bg-black text-white px-4 py-2 rounded-2xl transition-colors active:scale-95">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-[#ccff00]" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Unlock</span>
                    </div>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Ad Carousel */}
        <div className="relative group">
          <div 
            ref={adsRef}
            onScroll={() => handleScroll(adsRef, setAdIndex)}
            className="flex gap-4 overflow-x-auto no-scrollbar snap-x"
          >
            {ADS.map((ad) => (
              <div 
                key={ad.id}
                className={`shrink-0 w-full snap-center bg-gradient-to-br ${ad.bg} rounded-[28px] p-4 relative overflow-hidden shadow-xl`}
              >
                <div className="relative z-10 flex flex-col h-full justify-between">
                  <div className="flex justify-between items-start">
                    <div className={`${ad.darkText ? 'bg-black/10' : 'bg-black/20'} backdrop-blur-md p-2 rounded-2xl`}>
                      <ad.icon className={`w-4.5 h-4.5 ${ad.darkText ? 'text-black' : 'text-white'}`} />
                    </div>
                    <ad.deco className={`w-8 h-8 ${ad.darkText ? 'text-black/10' : 'text-white/10'} absolute -top-1 -right-1 rotate-12`} />
                  </div>
                  
                  <div className="mt-2">
                    <h4 className={`text-base font-black leading-tight ${ad.darkText ? 'text-black' : 'text-white'}`}>{ad.title}</h4>
                    <p className={`text-[10px] font-bold mt-0.5 ${ad.darkText ? 'text-black/70' : 'text-white/80'}`}>{ad.sub}</p>
                  </div>

                  <button className={`mt-3 ${ad.darkText ? 'bg-black text-white' : 'bg-white text-black'} text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full self-start shadow-lg active:scale-95 transition-transform`}>
                    {ad.cta}
                  </button>
                </div>

                {/* Decorative background elements */}
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
                <div className="absolute -top-10 -left-10 w-32 h-32 bg-black/10 rounded-full blur-2xl"></div>
              </div>
            ))}
          </div>
          
          {/* Pagination Dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            {ADS.map((_, i) => (
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
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Top Prematch</h3>
            <span className="text-[10px] font-bold text-zinc-500">View All</span>
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
                  <span className="text-xs font-black text-white uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full">
                    {match.league}
                  </span>
                  <span className="text-[10px] font-black text-[#ccff00] bg-[#ccff00]/10 px-2 py-1 rounded-full backdrop-blur-sm">
                    Upcoming
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
                    <span className="text-[10px] font-bold text-zinc-500 uppercase mb-1">{match.time}</span>
                    <span className="text-2xl font-black text-white">VS</span>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase mt-1">Today</span>
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
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Live & Trending</h3>
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
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Trending Now</span>
                  </div>
                  <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Activity className="w-3 h-3 text-[#ccff00]" />
                    <span className="text-[10px] font-black text-[#ccff00]">{match.trend}</span>
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
                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/5">
                  <div className="flex -space-x-2">
                    <img className="w-6 h-6 rounded-full border-2 border-[#0a0a0a]" src={`https://i.pravatar.cc/100?img=${i*3 + 1}`} alt="User" />
                    <img className="w-6 h-6 rounded-full border-2 border-[#0a0a0a]" src={`https://i.pravatar.cc/100?img=${i*3 + 2}`} alt="User" />
                    <img className="w-6 h-6 rounded-full border-2 border-[#0a0a0a]" src={`https://i.pravatar.cc/100?img=${i*3 + 3}`} alt="User" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-[#ccff00] bg-[#ccff00]/10 px-1.5 py-0.5 rounded">
                      {match.activity}
                    </span>
                    <span className="text-[10px] font-bold text-zinc-500">People analyzing</span>
                  </div>
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
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Recent Activities</h3>
            <span className="text-[10px] font-bold text-zinc-500">History</span>
          </div>

          <div className="space-y-3">
            {[
              { id: 1, type: 'Analysis', match: 'Real Madrid vs Man City', time: '2 mins ago', status: 'Completed', icon: Target },
              { id: 2, type: 'Prediction', match: 'Arsenal vs Bayern', time: '15 mins ago', status: 'Won', icon: Trophy },
              { id: 3, type: 'Credit', match: 'Daily Reward', time: '1 hour ago', status: '+50 Credits', icon: Zap },
            ].map((activity) => (
              <div key={activity.id} className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                    <activity.icon className="w-5 h-5 text-[#ccff00]" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-white">{activity.match}</p>
                    <p className="text-[10px] font-bold text-zinc-500">{activity.type} • {activity.time}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${activity.status.includes('+') ? 'bg-[#ccff00]/10 text-[#ccff00]' : 'bg-white/5 text-zinc-400'}`}>
                  {activity.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </>
    )}
  </div>
    </div>
  );
};


