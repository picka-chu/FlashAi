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
          fullLabel: date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
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

  const upcomingList = useMemo(() => {
    if (searchOpen && !query) return [];
    return matches
      .filter((m) => (searchOpen ? true : m.dateKey === selectedDate))
      .filter(matchesQuery)
      .sort((a, b) => (searchOpen ? a.dateKey.localeCompare(b.dateKey) : 0) || compareByPriority(a, b));
  }, [matches, selectedDate, query, searchOpen]);

  const liveList = useMemo(
    () => liveMatches.filter(matchesQuery).sort(compareByPriority),
    [liveMatches, query],
  );

  const activeList = searchOpen ? upcomingList : activeMatchType === 'live' ? liveList : upcomingList;

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: any[] }>();
    for (const m of activeList) {
      const league = m.league || 'Other competitions';
      const key = searchOpen ? `${m.dateKey}|${league}` : league;
      const label = searchOpen ? `${dayLabelFor(m.dateKey)} · ${league}` : league;
      if (!map.has(key)) map.set(key, { label, rows: [] });
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.values());
  }, [activeList, searchOpen, dateOptions]);

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

  const isLoading = loading || (!searchOpen && activeMatchType === 'live' && liveLoading);
  const showLiveGate = !searchOpen && activeMatchType === 'live' && !isSubscribed;
  const selectedLabel = dayLabelFor(selectedDate);
  const emptyTitle = searchOpen
    ? query
      ? 'No results'
      : 'Search fixtures'
    : activeMatchType === 'live'
      ? 'No live matches'
      : `No fixtures on ${selectedLabel}`;
  const emptyText = searchOpen
    ? query
      ? `Nothing matches “${searchQuery.trim()}”. Try another team or league.`
      : 'Find a team or competition across the next 8 days.'
    : activeMatchType === 'live'
      ? 'There are no live fixtures right now. Check back shortly.'
      : 'Choose another day above.';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="relative z-10 flex-none border-b border-[var(--border)] bg-[var(--background)] px-5 pt-3">
        <div className="flex h-9 items-center gap-2">
          {searchOpen ? (
            <>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teams or leagues"
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] pl-9 pr-9 text-[13px] text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-colors focus:border-[var(--primary)]/50"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-subtle)] hover:text-[var(--text-strong)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeSearch}
                className="h-9 shrink-0 px-1 text-[13px] font-medium text-[var(--primary)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-[var(--text-strong)]">Matches</h1>
              {user?.phone && (
                <span className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                  <Zap className={`h-3.5 w-3.5 ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--primary)]'}`} fill="currentColor" />
                  <span className={`tabular font-medium ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'}`}>{user.credits}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => { hapticFeedback('light'); setSearchOpen(true); }}
                aria-label="Search matches"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text-strong)]"
              >
                <Search className="h-[17px] w-[17px]" />
              </button>
            </>
          )}
        </div>

        {!searchOpen && (
          <>
            <div role="tablist" className="mt-1 flex gap-5 border-b border-[var(--border)]">
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
                    className={`-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors ${
                      active ? 'border-[var(--primary)] text-[var(--text-strong)]' : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-muted)]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeMatchType === 'prematch' && (
              <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 py-2.5">
                {dateOptions.map((day) => {
                  const active = day.key === selectedDate;
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => { hapticFeedback('light'); setSelectedDate(day.key); }}
                      aria-pressed={active}
                      aria-label={day.fullLabel}
                      className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors ${
                        active
                          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                          : 'border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-3">
        {isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : showLiveGate ? (
          <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
            <Lock className="h-5 w-5 text-[var(--text-muted)]" />
            <h3 className="text-[15px] font-semibold text-[var(--text-strong)]">Live matches are on paid plans</h3>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              Upgrade to view live scores and run live analysis.
            </p>
          </div>
        ) : groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.label} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">{group.label}</p>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="tabular text-[11px] text-[var(--text-subtle)]">{group.rows.length}</span>
                </div>
                <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
                  {group.rows.map((match: any, idx: number) => (
                    <FixtureRow
                      key={match.id || `${group.label}-${idx}`}
                      match={match}
                      isLast={idx === group.rows.length - 1}
                      onClick={() => (activeMatchType === 'live' && !searchOpen ? handleOpenLivePreview(match) : handleAnalyzePrematch(match))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="text-[15px] font-semibold text-[var(--text-strong)]">{emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-[260px] text-[13px] leading-relaxed text-[var(--text-muted)]">{emptyText}</p>
          </div>
        )}
      </div>

      <SignUpSheet isOpen={isSignUpOpen} onClose={() => setIsSignUpOpen(false)} />
    </div>
  );
};
