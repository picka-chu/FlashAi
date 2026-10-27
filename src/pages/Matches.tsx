import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Search, X, Zap, Lock } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { Skeleton } from '../components/ui/Skeleton';
import { getLiveMatches, getLiveMatchPreview, getUpcomingMatches, recordMatchClick } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { FixtureRow } from '../components/matches/FixtureRow';
import { formatMatch, localDateKey, dateFromKey } from '../lib/matchUtils';
import { compareByPriority } from '../lib/leaguePriority';

type MatchType = 'live' | 'prematch';

interface MatchesProps {
  onTabChange: (tab: any) => void;
}

const DAYS_AHEAD = 8;

export const Matches: React.FC<MatchesProps> = ({ onTabChange }) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [activeMatchType, setActiveMatchType] = useState<MatchType>('prematch');
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const todayKey = localDateKey(new Date());

  const dateOptions = useMemo(
    () =>
      Array.from({ length: DAYS_AHEAD }, (_, offset) => {
        const date = dateFromKey(todayKey);
        date.setDate(date.getDate() + offset);
        return {
          key: localDateKey(date),
          label:
            offset === 0
              ? 'Today'
              : offset === 1
                ? 'Tomorrow'
                : date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        };
      }),
    [todayKey],
  );

  const dayLabelFor = (key: string) => dateOptions.find((d) => d.key === key)?.label || key;

  useEffect(() => {
    const lastKey = dateOptions[dateOptions.length - 1]?.key;
    if (!selectedDate || selectedDate < todayKey || (lastKey && selectedDate > lastKey)) {
      setSelectedDate(todayKey);
    }
  }, [selectedDate, todayKey, dateOptions]);

  const query = searchQuery.trim().toLowerCase();
  const isSearching = searchOpen && query.length > 0;

  const matchesQuery = (m: any) =>
    !query ||
    String(m.home).toLowerCase().includes(query) ||
    String(m.away).toLowerCase().includes(query) ||
    String(m.league).toLowerCase().includes(query);

  const upcomingList = useMemo(
    () =>
      matches
        .filter((m) => (isSearching ? true : m.dateKey === selectedDate))
        .filter(matchesQuery)
        .sort((a, b) => (isSearching ? a.dateKey.localeCompare(b.dateKey) : 0) || compareByPriority(a, b)),
    [matches, selectedDate, query, isSearching],
  );

  const liveList = useMemo(
    () => liveMatches.filter(matchesQuery).sort(compareByPriority),
    [liveMatches, query],
  );

  const activeList = activeMatchType === 'live' ? liveList : upcomingList;

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: any[] }>();
    for (const m of activeList) {
      const league = m.league || 'Other competitions';
      const key = isSearching && activeMatchType === 'prematch' ? `${m.dateKey}|${league}` : league;
      const label = isSearching && activeMatchType === 'prematch' ? `${dayLabelFor(m.dateKey)} · ${league}` : league;
      if (!map.has(key)) map.set(key, { label, rows: [] });
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.values());
  }, [activeList, isSearching, activeMatchType, todayKey]);

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
    setLivePreviewMatch(formatMatch(match));
    onTabChange('livePreview');
    try {
      const preview = await getLiveMatchPreview(String(match.id), initData || '');
      if (preview) setLivePreviewMatch(formatMatch(preview));
    } catch {
      // The snapshot already on screen is enough; the preview refreshes itself.
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  const isLoading = loading || (activeMatchType === 'live' && liveLoading);
  const showLiveGate = activeMatchType === 'live' && !isSubscribed;
  const selectedLabel = dayLabelFor(selectedDate);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex-none space-y-4 px-5 pb-0 pt-5">
        <div className="flex h-10 items-center gap-3">
          {searchOpen ? (
            <>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teams or leagues"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-1)] pl-9 pr-3 text-[14px] text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-colors focus:border-[var(--primary)]/50"
                />
              </div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-strong)]"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <h1 className="min-w-0 flex-1 truncate text-[22px] font-semibold tracking-tight text-[var(--text-strong)]">Matches</h1>
              {user?.phone && (
                <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                  <Zap className={`h-3.5 w-3.5 ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--primary)]'}`} fill="currentColor" />
                  <span className={`tabular font-medium ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'}`}>{user.credits}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => { hapticFeedback('light'); setSearchOpen(true); }}
                aria-label="Search matches"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text-strong)]"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
            </>
          )}
        </div>

        <div role="tablist" className="flex gap-6 border-b border-[var(--border)]">
          {([
            ['prematch', 'Upcoming'],
            ['live', 'Live'],
          ] as const).map(([value, label]) => {
            const active = activeMatchType === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveMatchType(value)}
                className={`-mb-px border-b-2 pb-3 text-[14px] font-medium transition-colors ${
                  active ? 'border-[var(--primary)] text-[var(--text-strong)]' : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-muted)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeMatchType === 'prematch' && !isSearching && (
          <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-4">
            {dateOptions.map((day) => {
              const active = day.key === selectedDate;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => { hapticFeedback('light'); setSelectedDate(day.key); }}
                  aria-pressed={active}
                  className={`h-9 shrink-0 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--surface-3)] text-[var(--text-strong)] ring-1 ring-[var(--primary)]/50'
                      : 'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text-strong)]'
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[72px] w-full rounded-2xl" />
            <Skeleton className="h-[72px] w-full rounded-2xl" />
            <Skeleton className="h-[72px] w-full rounded-2xl" />
          </div>
        ) : showLiveGate ? (
          <div className="space-y-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-6">
            <Lock className="h-5 w-5 text-[var(--text-muted)]" />
            <h3 className="text-[15px] font-semibold text-[var(--text-strong)]">Live matches are on paid plans</h3>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              Upgrade to view live scores and run live analysis.
            </p>
          </div>
        ) : groups.length > 0 ? (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.label} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text-muted)]">{group.label}</p>
                  <span className="tabular text-[12px] text-[var(--text-subtle)]">{group.rows.length}</span>
                </div>
                <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                  {group.rows.map((match: any, idx: number) => (
                    <FixtureRow
                      key={match.id || `${group.label}-${idx}`}
                      match={match}
                      isLast={idx === group.rows.length - 1}
                      onClick={() => (activeMatchType === 'live' ? handleOpenLivePreview(match) : handleAnalyzePrematch(match))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="text-[15px] font-semibold text-[var(--text-strong)]">
              {activeMatchType === 'live' ? 'No live matches' : isSearching ? 'No results' : `No fixtures on ${selectedLabel}`}
            </p>
            <p className="mx-auto mt-1 max-w-[260px] text-[13px] leading-relaxed text-[var(--text-muted)]">
              {activeMatchType === 'live'
                ? 'There are no live fixtures right now. Check back shortly.'
                : isSearching
                  ? `Nothing matches “${searchQuery.trim()}”. Try a different team or league.`
                  : 'Choose another day above.'}
            </p>
          </div>
        )}
      </div>

      <SignUpSheet isOpen={isSignUpOpen} onClose={() => setIsSignUpOpen(false)} />
    </div>
  );
};
