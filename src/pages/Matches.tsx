import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, Clock, Activity, ChevronRight, Sparkles, Info, Loader2, Flame, TrendingUp, Zap } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { Skeleton } from '../components/ui/Skeleton';
import { getUpcomingMatches, recordMatchClick } from '../services/footballService';

type MatchType = 'live' | 'prematch';

interface MatchesProps {
  onTabChange: (tab: any) => void;
}

export const Matches: React.FC<MatchesProps> = ({ onTabChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMatch, setPreviewMatch] = useState<any | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { setSelectedMatch, setIsAnalyzing, setAnalysisResult, user } = useUserStore();

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      try {
        const upcoming = await getUpcomingMatches();

        const formatMatch = (m: any) => {
          const elapsed = m.fixture.status.elapsed;
          let displayMinute = m.fixture.status.short;
          if (typeof elapsed === 'number' && elapsed > 0) {
            const mins = Math.floor(elapsed / 60);
            const secs = Math.floor(elapsed % 60);
            displayMinute = `${mins}:${secs.toString().padStart(2, '0')}`;
          }

          return {
            ...m,
            id: m.fixture.id,
            home: m.teams.home.name,
            away: m.teams.away.name,
            homeShort: m.teams.home.name.substring(0, 3).toUpperCase(),
            awayShort: m.teams.away.name.substring(0, 3).toUpperCase(),
            homeLogo: m.teams.home.logo,
            awayLogo: m.teams.away.logo,
            score: m.goals.home !== null ? `${m.goals.home}-${m.goals.away}` : null,
            minute: displayMinute,
            league: m.league.name,
            time: new Date(m.fixture.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            date: new Date(m.fixture.date).toLocaleDateString() === new Date().toLocaleDateString() ? 'Today' : 'Upcoming',
            hype: 'High',
            confidence: 85,
            homeProb: 45,
            awayProb: 35,
            drawProb: 20,
            xG: m.xG || { home: 0, away: 0 },
            odds: { home: '2.10', draw: '3.20', away: '3.40' },
            status: m.fixture.status.state === 'pre' ? 'Upcoming' : 'Live'
          };
        };

        setMatches(upcoming.map(formatMatch));
      } catch (error) {
        console.error("Failed to fetch matches:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, []);

  const filteredMatches = matches.filter(m => 
    m.home.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.away.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.league.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAnalyze = (match: any) => {
    recordMatchClick(match.id, `${match.home} vs ${match.away}`);
    setSelectedMatch(match);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setPreviewMatch(null);
    onTabChange('analyze');
  };

  return (
    <div className="h-full flex flex-col bg-black relative">
      {/* Header */}
      <div className="flex justify-between items-center px-4 pt-6 pb-2 z-50">
        <h1 className="text-lg font-black text-white">Matches</h1>
        <div className="flex items-center gap-3">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
            <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
            <span className="text-xs font-black text-white">{user?.credits || 240}</span>
          </div>
        </div>
      </div>

      {/* Header Controls */}
      <div className="flex-none p-4 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teams or leagues..."
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ccff00]/50 transition-all"
          />
        </div>
      </div>

      {/* Match List */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-24">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-5 space-y-6">
                <div className="flex justify-between items-center">
                  <Skeleton className="w-24 h-6 rounded-full" />
                  <Skeleton className="w-16 h-6 rounded-full" />
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col items-center gap-2">
                    <Skeleton className="w-14 h-14 rounded-full" />
                    <Skeleton className="w-20 h-4" />
                  </div>
                  <Skeleton className="w-12 h-8" />
                  <div className="flex flex-col items-center gap-2">
                    <Skeleton className="w-14 h-14 rounded-full" />
                    <Skeleton className="w-20 h-4" />
                  </div>
                </div>
                <div className="pt-4 border-t border-zinc-800/50">
                  <Skeleton className="w-full h-10 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                Upcoming Fixtures ({filteredMatches.length})
              </h3>
            </div>

            <AnimatePresence mode="popLayout">
              {filteredMatches.length > 0 ? (
                filteredMatches.map((match: any, i) => (
                <motion.div 
                  key={match.id || i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleAnalyze(match)}
                  className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-5 relative overflow-hidden group cursor-pointer shadow-lg active:shadow-none transition-all"
                >
                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-black text-white uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full w-fit">
                        {match.league}
                      </span>
                      {i < 3 && (
                        <span className="text-[9px] font-black text-red-500 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse w-fit">
                          <Flame className="w-2.5 h-2.5" /> HOT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 bg-[#ccff00]/10 px-2 py-1 rounded-full border border-[#ccff00]/20">
                      <Clock className="w-3 h-3 text-[#ccff00]" />
                      <span className="text-[10px] font-black text-[#ccff00] uppercase tracking-tighter">{match.time}</span>
                    </div>
                  </div>

                  {/* Teams & Score */}
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex flex-col items-center gap-2 w-1/3">
                      <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                        {match.homeLogo ? (
                          <img src={match.homeLogo} alt={match.homeShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-xl font-black text-white">{match.homeShort}</span>
                        )}
                      </div>
                      <span className="text-xs font-black text-white text-center truncate w-full">{match.home}</span>
                    </div>

                    <div className="flex flex-col items-center justify-center w-1/3">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase mb-1">VS</span>
                      <span className="text-2xl font-black text-white">VS</span>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase mt-1">{match.date}</span>
                    </div>

                    <div className="flex flex-col items-center gap-2 w-1/3">
                      <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                        {match.awayLogo ? (
                          <img src={match.awayLogo} alt={match.awayShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-xl font-black text-white">{match.awayShort}</span>
                        )}
                      </div>
                      <span className="text-xs font-black text-white text-center truncate w-full">{match.away}</span>
                    </div>
                  </div>

                  {/* Footer Stats / Odds */}
                  <div className="mt-6 pt-4 border-t border-zinc-800/50 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                        {Math.floor(Math.random() * 5000) + 1000} Analyzing
                      </span>
                      <span className="text-[#ccff00] flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {match.confidence}% Confidence
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <div className="bg-zinc-800/50 px-3 py-2 rounded-xl border border-zinc-700/30 text-center min-w-[60px] relative overflow-hidden group-hover:border-[#ccff00]/30 transition-colors">
                          <p className="text-[8px] font-bold text-zinc-500 uppercase">1</p>
                          <p className="text-[11px] font-black text-white">{match.odds.home}</p>
                        </div>
                        <div className="bg-zinc-800/50 px-3 py-2 rounded-xl border border-zinc-700/30 text-center min-w-[60px]">
                          <p className="text-[8px] font-bold text-zinc-500 uppercase">X</p>
                          <p className="text-[11px] font-black text-white">{match.odds.draw}</p>
                        </div>
                        <div className="bg-zinc-800/50 px-3 py-2 rounded-xl border border-zinc-700/30 text-center min-w-[60px]">
                          <p className="text-[8px] font-bold text-zinc-500 uppercase">2</p>
                          <p className="text-[11px] font-black text-white">{match.odds.away}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-black text-[#ccff00] uppercase tracking-tighter bg-[#ccff00]/10 px-3 py-1.5 rounded-xl border border-[#ccff00]/20">
                        Unlock <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </motion.div>
            ))
          ) : (
            <div className="py-20 text-center space-y-4">
              <div className="w-16 h-16 bg-zinc-900/50 rounded-full flex items-center justify-center mx-auto border border-zinc-800">
                <Trophy className="w-8 h-8 text-zinc-600" />
              </div>
              <div>
                <p className="text-white text-sm font-black tracking-wide">No Matches Found</p>
                <p className="text-zinc-500 text-xs mt-1 max-w-[200px] mx-auto leading-relaxed">
                  No upcoming matches found for the selected criteria.
                </p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </>
    )}
  </div>
    </div>
  );
};

