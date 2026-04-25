import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, Clock, Flame, TrendingUp, Zap, UserPlus, Radio, Lock, Sparkles } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { Skeleton } from '../components/ui/Skeleton';
import { analyzeLiveMatch, getLiveMatches, getLiveMatchPreview, getUpcomingMatches, recordMatchClick } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { MatchPreviewModal } from '../components/ui/MatchPreviewModal';

type MatchType = 'live' | 'prematch';

interface MatchesProps {
  onTabChange: (tab: any) => void;
}

export const Matches: React.FC<MatchesProps> = ({ onTabChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMatch, setPreviewMatch] = useState<any | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [activeMatchType, setActiveMatchType] = useState<MatchType>('prematch');
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [analyzingLive, setAnalyzingLive] = useState(false);
  
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const { setSelectedMatch, setIsAnalyzing, setAnalysisResult, user, setUser } = useUserStore();
  const { hapticFeedback, initData, showAlert } = useTelegram();

  const isSubscribed = Boolean(user?.plan && user.plan !== 'free');

  const formatMatch = (m: any) => {
    const elapsed = Number(m?.fixture?.status?.elapsed || 0);
    let displayMinute = m?.fixture?.status?.short || '--';
    if (elapsed > 0) {
      displayMinute = `${Math.floor(elapsed)}'`;
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
      score: m.goals?.home !== null && m.goals?.away !== null ? `${m.goals.home}-${m.goals.away}` : null,
      minute: displayMinute,
      league: m.league?.name || 'Football',
      time: new Date(m.fixture.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      date: (() => {
        const matchDate = new Date(m.fixture.date);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        
        const matchDateStr = matchDate.toDateString();
        if (matchDateStr === today.toDateString()) return 'Today';
        if (matchDateStr === tomorrow.toDateString()) return 'Tomorrow';
        
        return matchDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      })(),
      xG: m.xG || { home: 0, away: 0 },
      stats: m.stats || {},
      status: m.fixture.status.state === 'pre' ? 'Upcoming' : 'Live',
      provider: m.provider || 'espn',
    };
  };

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      try {
        const upcoming = await getUpcomingMatches();
        setMatches(upcoming.map(formatMatch));
      } catch (error) {
        console.error('Failed to fetch matches:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, []);

  useEffect(() => {
    const fetchLive = async () => {
      if (!isSubscribed) {
        setLiveMatches([]);
        return;
      }
      setLiveLoading(true);
      try {
        const live = await getLiveMatches(initData || '');
        setLiveMatches((Array.isArray(live) ? live : []).map(formatMatch));
      } catch (error) {
        console.error('Failed to fetch live matches:', error);
        setLiveMatches([]);
      } finally {
        setLiveLoading(false);
      }
    };

    fetchLive();
  }, [isSubscribed, initData]);

  const filteredUpcomingMatches = matches.filter((m) =>
    m.home.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.away.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.league.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLiveMatches = liveMatches.filter((m) =>
    m.home.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.away.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.league.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAnalyzePrematch = (match: any) => {
    if (!user?.phone) {
      hapticFeedback('medium');
      setIsSignUpOpen(true);
      return;
    }
    hapticFeedback('light');
    recordMatchClick(match.id, `${match.home} vs ${match.away}`);
    setSelectedMatch(match);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setPreviewMatch(null);
    onTabChange('analyze');
  };

  const handleOpenLivePreview = async (match: any) => {
    if (!isSubscribed) {
      showAlert('Live matches are for subscribed users only.');
      return;
    }
    try {
      hapticFeedback('light');
      const preview = await getLiveMatchPreview(String(match.id), initData || '');
      setPreviewMatch(formatMatch(preview));
    } catch (error: any) {
      showAlert(error?.message || 'Failed to open live match preview');
    }
  };

  const handleAnalyzeLive = async (match: any) => {
    if (!isSubscribed) {
      showAlert('Live analysis is available on paid plans only.');
      return;
    }
    setAnalyzingLive(true);
    try {
      const payload = await analyzeLiveMatch({ fixtureId: String(match.id), liveSnapshot: match }, initData || '');
      setSelectedMatch({ ...match, liveSnapshot: payload?.liveData || match, analysisType: 'live' });
      setAnalysisResult(payload?.result || null);
      setIsAnalyzing(true);
      setPreviewMatch(null);
      if (typeof payload?.newCredits === 'number' && user) {
        setUser({ ...user, credits: payload.newCredits });
      }
      onTabChange('analyze');
    } catch (error: any) {
      showAlert(error?.message || 'Failed to analyze live match');
    } finally {
      setAnalyzingLive(false);
    }
  };

  const activeList = activeMatchType === 'live' ? filteredLiveMatches : filteredUpcomingMatches;

  return (
    <div className="h-full flex flex-col bg-black relative">
      <div className="flex justify-between items-center px-4 pt-6 pb-2 z-50">
        <h1 className="text-lg font-black text-white">Matches</h1>
        <div className="flex items-center gap-3">
          {user?.phone && (
            <div className={`backdrop-blur-md border px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)] ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
              <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
              <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-none p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <button
            onClick={() => setActiveMatchType('prematch')}
            className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider ${activeMatchType === 'prematch' ? 'bg-[#ccff00] text-black' : 'text-zinc-400'}`}
          >
            Prematch
          </button>
          <button
            onClick={() => setActiveMatchType('live')}
            className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 ${activeMatchType === 'live' ? 'bg-red-500 text-white' : 'text-zinc-400'}`}
          >
            <Radio className="w-3.5 h-3.5" /> Live
          </button>
        </div>

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

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-24">
        {(loading || (activeMatchType === 'live' && liveLoading)) ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-5 space-y-6">
                <div className="flex justify-between items-center">
                  <Skeleton className="w-24 h-6 rounded-full" />
                  <Skeleton className="w-16 h-6 rounded-full" />
                </div>
                <div className="flex justify-between items-center">
                  <Skeleton className="w-16 h-16 rounded-full" />
                  <Skeleton className="w-12 h-8" />
                  <Skeleton className="w-16 h-16 rounded-full" />
                </div>
                <Skeleton className="w-full h-10 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {activeMatchType === 'live' && !isSubscribed ? (
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-[28px] p-6 text-center space-y-3">
                <Lock className="w-8 h-8 mx-auto text-[#ccff00]" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Live matches are premium only</h3>
                <p className="text-xs text-zinc-500">Upgrade to Monthly Basic or Monthly Pro to view live match cards and run live AI analysis.</p>
              </div>
            ) : null}

            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-[10px] font-black text-zinc-500 tracking-widest uppercase">
                {activeMatchType === 'live' ? `Live fixtures (${activeList.length})` : `Upcoming fixtures (${activeList.length})`}
              </h3>
            </div>

            <AnimatePresence mode="popLayout">
              {activeList.length > 0 ? (
                activeList.map((match: any, i) => (
                  <motion.div
                    key={match.id || i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => (activeMatchType === 'live' ? handleOpenLivePreview(match) : handleAnalyzePrematch(match))}
                    className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-5 relative overflow-hidden group cursor-pointer shadow-lg active:shadow-none transition-all"
                  >
                    <div className="flex justify-between items-start mb-6 relative z-10">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-black text-white tracking-widest bg-white/10 px-3 py-1 rounded-full w-fit">{match.league}</span>
                        {activeMatchType === 'live' ? (
                          <span className="text-[9px] font-black text-red-500 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit">
                            <Radio className="w-2.5 h-2.5" /> LIVE {match.minute}
                          </span>
                        ) : i < 3 ? (
                          <span className="text-[9px] font-black text-red-500 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit">
                            <Flame className="w-2.5 h-2.5" /> Hot
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#ccff00]/10 px-2 py-1 rounded-full border border-[#ccff00]/20">
                        <Clock className="w-3 h-3 text-[#ccff00]" />
                        <span className="text-[10px] font-black text-[#ccff00] tracking-tighter">{match.time}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex flex-col items-center gap-2 w-1/3">
                        <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                          {match.homeLogo ? <img src={match.homeLogo} alt={match.homeShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" /> : <span className="text-xl font-black text-white">{match.homeShort}</span>}
                        </div>
                        <span className="text-xs font-black text-white text-center truncate w-full">{match.home}</span>
                      </div>

                      <div className="flex flex-col items-center justify-center w-1/3">
                        <span className="text-[10px] font-bold text-zinc-500 mb-1">vs</span>
                        <span className="text-2xl font-black text-white">{match.score || 'VS'}</span>
                        <span className="text-[10px] font-bold text-zinc-500 mt-1">{match.date}</span>
                      </div>

                      <div className="flex flex-col items-center gap-2 w-1/3">
                        <div className="w-14 h-14 bg-zinc-800 rounded-full p-2 shadow-lg flex items-center justify-center overflow-hidden">
                          {match.awayLogo ? <img src={match.awayLogo} alt={match.awayShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" /> : <span className="text-xl font-black text-white">{match.awayShort}</span>}
                        </div>
                        <span className="text-xs font-black text-white text-center truncate w-full">{match.away}</span>
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-zinc-800/50 flex items-center justify-between text-[10px] font-black tracking-widest">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                        {activeMatchType === 'live' ? 'Open live preview' : `${Math.floor(Math.random() * 5000) + 1000} analyzing`}
                      </span>
                      <span className="text-[#ccff00] flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {activeMatchType === 'live' ? 'Tap for live AI' : 'AI insights available'}
                      </span>
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
                    <p className="text-zinc-500 text-xs mt-1 max-w-[240px] mx-auto leading-relaxed">
                      {activeMatchType === 'live' ? 'No live matches are available right now.' : 'No upcoming matches found for the selected criteria.'}
                    </p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      <MatchPreviewModal
        isOpen={Boolean(previewMatch)}
        onClose={() => setPreviewMatch(null)}
        match={previewMatch}
        onAnalyze={handleAnalyzeLive}
      />

      {previewMatch && (
        <button
          onClick={() => !analyzingLive && handleAnalyzeLive(previewMatch)}
          className="fixed bottom-24 right-5 z-[130] w-14 h-14 rounded-full bg-[#ccff00] text-black shadow-[0_10px_30px_rgba(204,255,0,0.4)] flex items-center justify-center active:scale-95"
          aria-label="Analyze live match"
        >
          {analyzingLive ? <span className="text-xs font-black">...</span> : <Zap className="w-6 h-6" />}
        </button>
      )}

      <SignUpSheet 
        isOpen={isSignUpOpen} 
        onClose={() => setIsSignUpOpen(false)} 
      />
    </div>
  );
};
