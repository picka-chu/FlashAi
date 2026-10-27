import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, Zap, Radio, Lock, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { Skeleton } from '../components/ui/Skeleton';
import { getLiveMatches, getLiveMatchPreview, getUpcomingMatches, recordMatchClick } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { ModernMatchCard } from '../components/ModernMatchCard';
import { formatMatch, localDateKey, dateFromKey } from '../lib/matchUtils';

type MatchType = 'live' | 'prematch';

interface MatchesProps {
  onTabChange: (tab: any) => void;
}

export const Matches: React.FC<MatchesProps> = ({ onTabChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [activeMatchType, setActiveMatchType] = useState<MatchType>('prematch');
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
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
        setMatches((Array.isArray(upcoming) ? upcoming : []).map(formatMatch).filter(Boolean));
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
        setLiveMatches((Array.isArray(live) ? live : []).map(formatMatch).filter(Boolean));
      } catch (error) {
        console.error('Failed to fetch live matches:', error);
        setLiveMatches([]);
      } finally {
        setLiveLoading(false);
      }
    };

    fetchLive();
  }, [isSubscribed, initData]);

  const todayKey = localDateKey(new Date());
  const dateOptions = useMemo(() => Array.from({ length: 8 }, (_, offset) => {
    const date = dateFromKey(todayKey);
    date.setDate(date.getDate() + offset);
    const key = localDateKey(date);
    return {
      key,
      dayName: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : date.toLocaleDateString('en-GB', { weekday: 'short' }),
      dayNumber: date.getDate(),
      month: date.toLocaleDateString('en-GB', { month: 'short' }),
      count: matches.filter((match) => match.dateKey === key).length,
    };
  }), [matches, todayKey]);

  useEffect(() => {
    if (selectedDate < todayKey || selectedDate > dateOptions[dateOptions.length - 1]?.key) {
      setSelectedDate(todayKey);
    }
  }, [selectedDate, todayKey, dateOptions]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredUpcomingMatches = useMemo(() => matches.filter((m) =>
    m.dateKey === selectedDate && (
      m.home.toLowerCase().includes(normalizedQuery) ||
      m.away.toLowerCase().includes(normalizedQuery) ||
      m.league.toLowerCase().includes(normalizedQuery)
    )
  ), [matches, normalizedQuery, selectedDate]);

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
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="z-10 flex items-center justify-between px-5 pb-3 pt-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Football centre</p>
          <h1 className="mt-1 text-[25px] font-semibold tracking-tight text-[var(--text-strong)]">Matches</h1>
        </div>
        {user?.phone && (
          <div className={`backdrop-blur-md border px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)] ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
            <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
            <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
          </div>
        )}
      </div>

      <div className="flex-none space-y-4 px-5 pb-4 pt-2">
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1">
          <button onClick={() => setActiveMatchType('prematch')} className={`rounded-xl py-3 text-[13px] font-semibold transition-colors ${activeMatchType === 'prematch' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'}`}>Prematch</button>
          <button onClick={() => setActiveMatchType('live')} className={`flex items-center justify-center gap-1.5 rounded-xl py-3 text-[13px] font-semibold transition-colors ${activeMatchType === 'live' ? 'bg-[var(--surface-3)] text-[var(--text-strong)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'}`}><Radio className="w-3.5 h-3.5" /> Live</button>
        </div>

        {activeMatchType === 'prematch' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[var(--primary)]" />
                <span className="text-[13px] font-semibold text-[var(--text-strong)]">Choose match day</span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">{dateOptions.find((day) => day.key === selectedDate)?.count || 0} fixtures</span>
            </div>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {dateOptions.map((day) => {
                const active = day.key === selectedDate;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => { hapticFeedback('light'); setSelectedDate(day.key); }}
                    aria-pressed={active}
                    className={`flex min-w-[66px] shrink-0 flex-col items-center gap-1 rounded-2xl border px-3 py-3 transition-all active:scale-95 ${
                      active ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_6px_20px_rgba(204,255,0,0.12)]' : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:border-[var(--text-subtle)]'
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide">{day.dayName}</span>
                    <span className="tabular text-[20px] font-bold leading-none">{day.dayNumber}</span>
                    <span className="text-[10px] opacity-75">{day.month}</span>
                    <span className={`mt-0.5 h-1 w-1 rounded-full ${day.count ? (active ? 'bg-current' : 'bg-[var(--primary)]') : 'bg-transparent'}`} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-subtle)]" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search teams or leagues" className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] py-3.5 pl-11 pr-4 text-[14px] text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-colors focus:border-[var(--primary)]/50" />
        </div>
      </div>

      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-5 pb-28">
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
              <div className="space-y-3 rounded-[24px] border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center">
                <Lock className="mx-auto h-8 w-8 text-[var(--primary)]" />
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
                    <p className="text-[15px] font-semibold tracking-tight text-[var(--text-strong)]">No matches found</p>
                    <p className="text-zinc-500 text-xs mt-1 max-w-[240px] mx-auto leading-relaxed">
                      {activeMatchType === 'live' ? 'There are no live fixtures at the moment. Try again shortly.' : (matches.some((match) => match.dateKey === selectedDate) ? 'No fixtures match your search. Try another team or league.' : 'No fixtures are scheduled for this day. Choose another date above.')}
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
