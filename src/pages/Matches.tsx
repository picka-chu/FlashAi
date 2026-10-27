import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, Zap, Radio, Lock } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { Skeleton } from '../components/ui/Skeleton';
import { getLiveMatches, getLiveMatchPreview, getUpcomingMatches, recordMatchClick } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { ModernMatchCard } from '../components/ModernMatchCard';
import { formatMatch } from '../lib/matchUtils';

type MatchType = 'live' | 'prematch';

interface MatchesProps {
  onTabChange: (tab: any) => void;
}

export const Matches: React.FC<MatchesProps> = ({ onTabChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [activeMatchType, setActiveMatchType] = useState<MatchType>('prematch');
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const { setSelectedMatch, setIsAnalyzing, setAnalysisResult, user, setLivePreviewMatch } = useUserStore();
  const { hapticFeedback, initData, showAlert } = useTelegram();

  const isSubscribed = Boolean(user?.plan && user.plan !== 'free');

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      try {
        const upcoming = await getUpcomingMatches(initData || '');
        setMatches(upcoming.map(formatMatch));
      } catch (error) {
        console.error('Failed to fetch matches:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, [initData]);

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

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredUpcomingMatches = useMemo(() => matches.filter((m) =>
    m.home.toLowerCase().includes(normalizedQuery) ||
    m.away.toLowerCase().includes(normalizedQuery) ||
    m.league.toLowerCase().includes(normalizedQuery)
  ), [matches, normalizedQuery]);

  const filteredLiveMatches = useMemo(() => liveMatches.filter((m) =>
    m.home.toLowerCase().includes(normalizedQuery) ||
    m.away.toLowerCase().includes(normalizedQuery) ||
    m.league.toLowerCase().includes(normalizedQuery)
  ), [liveMatches, normalizedQuery]);

  const handleAnalyzePrematch = (match: any) => {
    if (!user?.phone) {
      hapticFeedback('medium');
      setIsSignUpOpen(true);
      return;
    }
    hapticFeedback('light');
    if (match?.id) recordMatchClick(String(match.id), `${match.home} vs ${match.away}`);
    setSelectedMatch(match);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    onTabChange('analyze');
  };

  const handleOpenLivePreview = async (match: any) => {
    if (!isSubscribed) {
      showAlert('Live matches are for subscribed users only.');
      return;
    }
    if (!match?.id) {
      showAlert('This live match is missing a valid fixture id. Please refresh and try another match.');
      return;
    }
    hapticFeedback('light');

    // Optimistic navigation: open the page immediately with whatever data we have.
    // The page will auto-refresh every 20s for live stats.
    setLivePreviewMatch(formatMatch(match));
    onTabChange('livePreview');

    // Then try to enrich with fresh data from the backend (non-blocking).
    try {
      const preview = await getLiveMatchPreview(String(match.id), initData || '');
      if (preview) setLivePreviewMatch(formatMatch(preview));
    } catch {
      // Silently ignore — user is already on the live preview page with the snapshot data.
    }
  };

  const activeList = activeMatchType === 'live' ? filteredLiveMatches : filteredUpcomingMatches;

  return (
    <div className="h-full flex flex-col bg-black relative">
      <div className="flex justify-between items-center px-4 pt-6 pb-2 z-50">
        <h1 className="text-lg font-black text-white">Matches</h1>
        {user?.phone && (
          <div className={`backdrop-blur-md border px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)] ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
            <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
            <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
          </div>
        )}
      </div>

      <div className="flex-none p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <button onClick={() => setActiveMatchType('prematch')} className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider ${activeMatchType === 'prematch' ? 'bg-[#ccff00] text-black' : 'text-zinc-400'}`}>Prematch</button>
          <button onClick={() => setActiveMatchType('live')} className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 ${activeMatchType === 'live' ? 'bg-red-500 text-white' : 'text-zinc-400'}`}><Radio className="w-3.5 h-3.5" /> Live</button>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search teams or leagues..." className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ccff00]/50 transition-all" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-24">
        {(loading || (activeMatchType === 'live' && liveLoading)) ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-[24px] p-5 space-y-4">
                <Skeleton className="w-24 h-5 rounded-full" />
                <Skeleton className="w-full h-32 rounded-2xl" />
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

            <AnimatePresence mode="popLayout">
              {activeList.length > 0 ? (
                activeList.map((match: any, i) => (
                  <motion.div key={match.id || i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                    <ModernMatchCard
                      match={match}
                      variant={activeMatchType === 'live' ? 'live' : 'prematch'}
                      onClick={() => (activeMatchType === 'live' ? handleOpenLivePreview(match) : handleAnalyzePrematch(match))}
                    />
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

      <SignUpSheet isOpen={isSignUpOpen} onClose={() => setIsSignUpOpen(false)} />
    </div>
  );
};
