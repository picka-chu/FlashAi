import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Zap,
  ChevronRight,
  Info,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  History as HistoryIcon,
  UserPlus,
  Flame,
  Newspaper,
  Radio,
  Lock,
} from 'lucide-react';
import { Skeleton } from '../components/ui/Skeleton';
import { useUserStore } from '../store/useUserStore';
import { getLiveMatches, getUpcomingMatches, getTrendingPicks, getFootballNews, recordMatchClick, type FootballNewsArticle } from '../services/footballService';
import { FootballNewsFeed } from '../components/FootballNewsFeed';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';
import { TeamLogo } from '../components/TeamLogo';
import { dateFromKey, formatMatch, localDateKey } from '../lib/matchUtils';

interface HomeProps {
  onTabChange: (tab: any) => void;
}

/* ---------- Small presentational pieces ---------- */

const SectionHeader: React.FC<{ title: string; action?: string; onAction?: () => void; icon?: React.ReactNode }> = ({ title, action, onAction, icon }) => (
  <div className="flex items-center justify-between gap-3">
    <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--text-strong)]">
      {icon}
      {title}
    </h2>
    {action && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="flex items-center gap-0.5 text-[13px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
      >
        {action}
        <ChevronRight className="h-4 w-4" />
      </button>
    )}
  </div>
);

const StatusPill: React.FC<{ tone: 'live' | 'upcoming' | 'final'; children: React.ReactNode; dark?: boolean }> = ({ tone, children, dark }) => {
  const styles = {
    live: dark ? 'bg-black/15 text-black' : 'bg-[var(--accent-soft)] text-[var(--primary)]',
    upcoming: dark ? 'bg-black/15 text-black' : 'bg-white/[0.06] text-[var(--text-muted)]',
    final: dark ? 'bg-black/15 text-black' : 'bg-white/[0.06] text-[var(--text-muted)]',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${styles}`}>
      {tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
};

const OddsChip: React.FC<{ label: string; value?: number | null }> = ({ label, value }) => (
  <div className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-white/[0.04] py-2">
    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">{label}</span>
    <span className="tabular text-[13px] font-semibold text-[var(--text-strong)]">{value ? value.toFixed(2) : '–'}</span>
  </div>
);

/* ---------- Match-level components ---------- */

const FeaturedMatch: React.FC<{
  match: any;
  eyebrow: string;
  onClick: () => void;
}> = ({ match, eyebrow, onClick }) => {
  const isLive = match.status === 'Live' || match?.fixture?.status?.state === 'in';
  const hasScore = match.score && match.score !== '--';
  const odds = match.odds;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-[24px] bg-[var(--primary)] p-5 text-left text-[var(--primary-foreground)] transition-transform duration-200 active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] opacity-70 truncate">{match.league}</span>
        <StatusPill tone={isLive ? 'live' : 'upcoming'} dark>{isLive ? match.minute : eyebrow}</StatusPill>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamLogo name={match.home} logo={match.homeLogo} className="h-14 w-14 rounded-full bg-black/10" textClassName="text-base" />
          <span className="line-clamp-1 text-[13px] font-semibold">{match.home}</span>
        </div>
        <div className="flex flex-col items-center">
          {hasScore ? (
            <span className="tabular text-[30px] font-semibold leading-none tracking-tight">{match.score}</span>
          ) : (
            <>
              <span className="tabular text-[22px] font-semibold leading-none">{match.time}</span>
              <span className="mt-1.5 text-[11px] font-medium opacity-70">{match.date}</span>
            </>
          )}
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamLogo name={match.away} logo={match.awayLogo} className="h-14 w-14 rounded-full bg-black/10" textClassName="text-base" />
          <span className="line-clamp-1 text-[13px] font-semibold">{match.away}</span>
        </div>
      </div>

      {odds && (odds.home || odds.draw || odds.away) && (
        <div className="mt-5 flex gap-2">
          <OddsChip label="1" value={odds.home} />
          <OddsChip label="X" value={odds.draw} />
          <OddsChip label="2" value={odds.away} />
        </div>
      )}

      <div className="mt-5 flex items-center justify-between rounded-2xl bg-black/85 px-4 py-3 text-[14px] font-medium text-white transition-colors group-hover:bg-black">
        <span>Analyze match</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </button>
  );
};

const FixtureRow: React.FC<{ match: any; onClick: () => void; isLast: boolean }> = ({ match, onClick, isLast }) => {
  const started = match?.fixture?.status?.state && match.fixture.status.state !== 'pre';
  const isLive = match?.fixture?.status?.state === 'in';
  const hasScore = match.score && match.score !== '--';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] active:bg-white/[0.04] ${isLast ? '' : 'border-b border-[var(--border)]'}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <TeamLogo name={match.home} logo={match.homeLogo} className="h-7 w-7 shrink-0 rounded-full" textClassName="text-[10px]" />
          <span className="truncate text-[14px] font-medium text-[var(--text-strong)]">{match.home}</span>
        </div>
        <div className="flex items-center gap-2.5 min-w-0">
          <TeamLogo name={match.away} logo={match.awayLogo} className="h-7 w-7 shrink-0 rounded-full" textClassName="text-[10px]" />
          <span className="truncate text-[14px] font-medium text-[var(--text-strong)]">{match.away}</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2.5 tabular">
        {started && hasScore ? (
          <>
            <span className="text-[14px] font-semibold text-[var(--text-strong)]">{match.score.split('-')[0]}</span>
            <span className="text-[14px] font-semibold text-[var(--text-strong)]">{match.score.split('-')[1]}</span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-semibold text-[var(--text-strong)]">{match.time}</span>
            <span className="text-[12px] text-[var(--text-subtle)]">{match.date}</span>
          </>
        )}
      </div>

      {started && (
        <div className="shrink-0 w-14 text-right">
          <span className={`text-[11px] font-medium ${isLive ? 'text-[var(--primary)]' : 'text-[var(--text-subtle)]'}`}>
            {isLive ? match.minute : match?.fixture?.status?.short === 'FT' ? 'Final' : match.minute}
          </span>
        </div>
      )}
    </button>
  );
};

/* ---------- Page ---------- */

export const Home: React.FC<HomeProps> = ({ onTabChange }) => {
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
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);

  const adsRef = React.useRef<HTMLDivElement>(null);

  const { user, setSelectedMatch, setIsAnalyzing, setAnalysisResult } = useUserStore();
  const { hapticFeedback, tg, initData } = useTelegram();

  const isPaid = Boolean(user?.plan && user.plan !== 'free');

  const getAnalysisStatusUi = (status: string) => {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'won') {
      return {
        label: 'Won',
        className: 'bg-[var(--success-soft)] text-[var(--success)]',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    }
    if (normalized === 'lost') {
      return {
        label: 'Lost',
        className: 'bg-[var(--danger-soft)] text-[var(--danger)]',
        icon: <XCircle className="h-3.5 w-3.5" />,
      };
    }
    return {
      label: 'Pending',
      className: 'bg-white/[0.06] text-[var(--text-muted)]',
      icon: <Clock className="h-3.5 w-3.5" />,
    };
  };

  const formatRelativeTime = (date: string) => {
    const diff = Math.max(0, Date.now() - new Date(date).getTime());
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
        body: JSON.stringify({ type: 'view' }),
      }).catch(() => {});
    }
  }, [adIndex, dynamicAds]);

  const handleAdClick = (ad: any) => {
    hapticFeedback('light');
    if (ad.id && typeof ad.id === 'string') {
      fetch(`/api/common/ads/${ad.id}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click' }),
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
          fetch('/api/common/ads', { headers: { 'X-TG-Init-Data': authInitData } }).then((r) => r.json()),
          authInitData
            ? fetch('/api/user/history', { headers: { 'X-TG-Init-Data': authInitData } }).then((r) => (r.ok ? r.json() : []))
            : Promise.resolve([]),
          user?.plan && user.plan !== 'free'
            ? getLiveMatches(authInitData).catch(() => [])
            : Promise.resolve([]),
        ]);

        if (adsRes && adsRes.length > 0) setDynamicAds(adsRes);

        const mappedUpcoming = (Array.isArray(upcoming) ? upcoming : [])
          .map((m: any) => {
            const formatted = formatMatch(m);
            return formatted ? { ...formatted, odds: m.odds || null } : null;
          })
          .filter(Boolean);

        const mappedLive = (Array.isArray(live) ? live : []).map((m: any) => formatMatch(m)).filter(Boolean);
        setLiveMatches(mappedLive.slice(0, 20));

        if (trending && trending.length > 0) {
          setTrendingMatches(
            trending.map((t: any) => ({ id: t.id, teams: t.teams, activity: Number(t.clicks || 0) })),
          );
        } else {
          setTrendingMatches([]);
        }

        setUpcomingMatches(mappedUpcoming.slice(0, 200));

        const normalizedHistory = (Array.isArray(historyRes) ? historyRes : []).map((item: any) => ({
          id: String(item.id),
          match: item.match || `${item.home || 'Home'} vs ${item.away || 'Away'}`,
          predictionMarket: item.predictionMarket || 'Unknown market',
          confidence: Number(item.confidence || 0),
          status: String(item.status || 'pending').toLowerCase(),
          created_at: item.created_at || new Date().toISOString(),
        }));
        setRecentAnalysis(normalizedHistory.slice(0, 5));
      } catch (error) {
        console.error('Failed to fetch matches:', error);
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

  useEffect(() => {
    let cancelled = false;
    setNewsLoading(true);
    getFootballNews(12)
      .then((articles) => { if (!cancelled) setNews(articles); })
      .finally(() => { if (!cancelled) setNewsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const adsToScroll = dynamicAds;
    if (!adsToScroll.length) return;
    const interval = setInterval(() => {
      if (adsRef.current) {
        const nextIndex = (adIndex + 1) % adsToScroll.length;
        const width = adsRef.current.offsetWidth;
        adsRef.current.scrollTo({ left: nextIndex * width, behavior: 'smooth' });
        setAdIndex(nextIndex);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [adIndex, dynamicAds]);

  const handleScroll = () => {
    if (adsRef.current) {
      const width = adsRef.current.offsetWidth || 1;
      setAdIndex(Math.round(adsRef.current.scrollLeft / width));
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
  const selectedLabel = selectedDay.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.phone ? String(user?.name || 'there').split(' ')[0] : 'Guest';

  const countByDate = useMemo(
    () => upcomingMatches.reduce((counts: Record<string, number>, match: any) => {
      if (match?.dateKey) counts[match.dateKey] = (counts[match.dateKey] || 0) + 1;
      return counts;
    }, {}),
    [upcomingMatches],
  );

  const dayOptions = useMemo(() => {
    const base = dateFromKey(todayKey);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(base);
      date.setDate(base.getDate() + offset);
      const key = localDateKey(date);
      return {
        key,
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
    const timer = window.setTimeout(() => setSelectedDate(localDateKey(new Date())), Math.max(1000, midnight.getTime() - now.getTime()));
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
    : upcomingMatches.filter((match: any) => match?.dateKey >= selectedDate).slice(0, 12);
  const selectedCount = selectedMatches.length;
  const featuredIsNext = selectedCount === 0;

  const groupedList = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const m of listMatches) {
      const key = m.league || 'Football';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries());
  }, [listMatches]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex-none px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {user?.phone && user.photo_url ? (
              <button type="button" onClick={() => onTabChange('profile')} aria-label="Open profile" className="shrink-0">
                <img src={user.photo_url} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-[var(--border)]" />
              </button>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]">
                <Zap className="h-4.5 w-4.5 text-[var(--primary-foreground)]" fill="currentColor" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--text-muted)]">{user?.phone ? greeting : 'Flash AI'}</p>
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[var(--text-strong)]">
                {user?.phone ? firstName : 'Welcome'}
              </h1>
            </div>
          </div>

          {user?.phone ? (
            <div
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                user.credits <= 0 ? 'border-[var(--danger)]/30 bg-[var(--danger-soft)]' : 'border-[var(--border)] bg-[var(--surface-1)]'
              }`}
            >
              <Zap className={`h-3.5 w-3.5 ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--primary)]'}`} fill="currentColor" />
              <span className={`tabular text-[13px] font-semibold ${user.credits <= 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'}`}>{user.credits}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { hapticFeedback('light'); setIsSignUpOpen(true); }}
              className="flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-[var(--primary-foreground)] transition-transform active:scale-95"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Sign up
            </button>
          )}
        </div>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 space-y-8 overflow-y-auto px-5 pb-28 pt-2">
        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-[24px]" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* Day selector */}
            <section className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <p className="eyebrow">Matches</p>
                  <h2 className="mt-0.5 text-[22px] font-semibold tracking-tight text-[var(--text-strong)]">
                    {isToday ? 'Today' : selectedLabel}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onTabChange('matches')}
                  className="flex items-center gap-0.5 text-[13px] font-medium text-[var(--primary)]"
                >
                  All matches <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="no-scrollbar -mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
                {dayOptions.map((day) => {
                  const active = day.key === selectedDate;
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => { hapticFeedback('light'); setSelectedDate(day.key); }}
                      aria-pressed={active}
                      className={`flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors active:scale-95 ${
                        active ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--surface-1)] text-[var(--text-muted)] border border-[var(--border)]'
                      }`}
                    >
                      <span className="text-[11px] font-medium">{day.isToday ? 'Today' : day.dayName}</span>
                      <span className="tabular text-[17px] font-semibold leading-none">{day.dayNumber}</span>
                      <span className={`h-1 w-1 rounded-full ${day.count ? (active ? 'bg-current' : 'bg-[var(--primary)]') : 'bg-transparent'}`} />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Featured */}
            {featuredMatch ? (
              <FeaturedMatch
                match={featuredMatch}
                eyebrow={featuredIsNext ? 'Next up' : isToday ? 'Top match' : 'Featured'}
                onClick={() => handleAnalyze(featuredMatch)}
              />
            ) : (
              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
                <p className="text-[15px] font-semibold text-[var(--text-strong)]">No fixtures available</p>
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">New matches will appear here once they are scheduled.</p>
              </div>
            )}

            {selectedCount === 0 && featuredMatch && (
              <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--text-strong)]">
                    {isToday ? 'No more fixtures today' : `No fixtures on ${selectedLabel}`}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    Showing the next scheduled fixtures below.
                  </p>
                </div>
              </div>
            )}

            {/* Ads */}
            {dynamicAds.length > 0 && (
              <div>
                <div ref={adsRef} onScroll={handleScroll} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-[22px]">
                  {dynamicAds.map((ad: any, i: number) => {
                    const from = ad?.primary_color || '#1f2a16';
                    const to = ad?.gradient_to ?? '#0f130b';
                    return (
                      <div key={ad.id || i} className="w-full shrink-0 snap-center">
                        <div
                          className="relative h-[140px] overflow-hidden rounded-[22px] border border-[var(--border)]"
                          style={{ background: `linear-gradient(120deg, ${from} 0%, ${to} 100%)` }}
                        >
                          {ad?.image_url && (
                            <img src={ad.image_url} alt="" referrerPolicy="no-referrer" className="absolute right-3 top-1/2 h-[80%] w-[34%] -translate-y-1/2 object-contain" />
                          )}
                          <div className="relative z-10 flex h-full flex-col justify-between p-5 pr-[38%]">
                            <div>
                              <h4 className="line-clamp-2 text-[18px] font-semibold leading-tight" style={{ color: ad?.hero_color || '#fff' }}>
                                {ad.title || 'Promotion'}
                              </h4>
                              <p className="mt-1 line-clamp-2 text-[13px]" style={{ color: ad?.sub_color || 'rgba(255,255,255,0.7)' }}>
                                {ad.sub || ad.subtitle || 'Limited-time offer'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAdClick(ad)}
                              className="self-start rounded-full px-4 py-1.5 text-[13px] font-semibold transition-transform active:scale-95"
                              style={{ backgroundColor: ad?.button_color || '#fff', color: ad?.button_text_color || '#111' }}
                            >
                              {String(ad?.cta ?? '').trim() || 'View'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {dynamicAds.length > 1 && (
                  <div className="mt-3 flex justify-center gap-1.5">
                    {dynamicAds.map((_, i) => (
                      <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === adIndex ? 'w-5 bg-[var(--primary)]' : 'w-1.5 bg-white/15'}`} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Fixtures list */}
            <section className="space-y-3">
              <SectionHeader
                title={selectedCount ? (isToday ? "Today's fixtures" : `${selectedLabel}`) : 'Upcoming fixtures'}
                action="View all"
                onAction={() => onTabChange('matches')}
              />
              {groupedList.length > 0 ? (
                <div className="space-y-3">
                  {groupedList.map(([league, rows]) => (
                    <div key={league} className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                        <span className="text-[12px] font-medium text-[var(--text-muted)] truncate">{league}</span>
                        <span className="text-[11px] text-[var(--text-subtle)]">{rows.length}</span>
                      </div>
                      {rows.map((match: any, idx: number) => (
                        <FixtureRow
                          key={match.id}
                          match={match}
                          isLast={idx === rows.length - 1}
                          onClick={() => handleAnalyze(match)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center">
                  <p className="text-[14px] font-medium text-[var(--text-strong)]">No fixtures scheduled</p>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">Check back later for new matches.</p>
                </div>
              )}
            </section>

            {/* Live */}
            <section className="space-y-3">
              <SectionHeader
                title="Live now"
                icon={isPaid ? <Radio className="h-4 w-4 text-[var(--primary)]" /> : undefined}
                action={isPaid ? 'Open' : undefined}
                onAction={() => onTabChange('matches')}
              />
              {isPaid ? (
                liveMatches.length > 0 ? (
                  <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                    {liveMatches.slice(0, 6).map((match: any, idx: number, arr: any[]) => (
                      <FixtureRow key={match.id} match={match} isLast={idx === arr.length - 1} onClick={() => onTabChange('matches')} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-center text-[13px] text-[var(--text-muted)]">
                    No live fixtures right now.
                  </div>
                )
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
                    <Lock className="h-4 w-4 text-[var(--text-muted)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-strong)]">Live matches are on paid plans</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">Upgrade to unlock live scores and live AI analysis.</p>
                  </div>
                </div>
              )}
            </section>

            {/* Trending */}
            {trendingMatches.length > 0 && (
              <section className="space-y-3">
                <SectionHeader title="Trending" icon={<Flame className="h-4 w-4 text-[var(--primary)]" />} />
                <div className="no-scrollbar -mx-5 flex gap-2.5 overflow-x-auto px-5">
                  {trendingMatches.slice(0, 6).map((match, i) => (
                    <button
                      key={match.id || i}
                      type="button"
                      onClick={() => onTabChange('matches')}
                      className="flex w-[220px] shrink-0 flex-col gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left transition-colors active:bg-[var(--surface-2)]"
                    >
                      <span className="line-clamp-2 text-[14px] font-medium leading-snug text-[var(--text-strong)]">{match.teams}</span>
                      {match.activity > 0 && (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          <span className="tabular font-medium text-[var(--text-strong)]">{match.activity}</span> recent views
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* News */}
            {(newsLoading || news.length > 0) && (
              <section className="space-y-3">
                <SectionHeader title="Football news" icon={<Newspaper className="h-4 w-4 text-[var(--text-muted)]" />} />
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

            {/* Recent analysis */}
            {user?.phone && (
              <section className="space-y-3">
                <SectionHeader
                  title="Recent analysis"
                  icon={<HistoryIcon className="h-4 w-4 text-[var(--text-muted)]" />}
                  action="History"
                  onAction={() => onTabChange('history')}
                />
                {historyLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-[var(--surface-1)]" />
                    ))}
                  </div>
                ) : recentAnalysis.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center">
                    <p className="text-[14px] font-medium text-[var(--text-strong)]">No analysis yet</p>
                    <p className="mt-1 text-[12px] text-[var(--text-muted)]">Analyze a match to start your track record.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                    {recentAnalysis.map((analysis, idx) => {
                      const status = getAnalysisStatusUi(analysis.status);
                      return (
                        <motion.button
                          key={analysis.id}
                          type="button"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: idx * 0.04 }}
                          onClick={() => onTabChange('history')}
                          className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] ${
                            idx === recentAnalysis.length - 1 ? '' : 'border-b border-[var(--border)]'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="truncate text-[14px] font-medium text-[var(--text-strong)]">{analysis.match}</p>
                            <p className="flex items-center gap-1.5 truncate text-[12px] text-[var(--text-muted)]">
                              <Percent className="h-3 w-3 shrink-0" />
                              <span className="tabular">{analysis.confidence}%</span>
                              <span className="truncate">· {analysis.predictionMarket}</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
                              {status.icon}
                              {status.label}
                            </span>
                            <span className="text-[11px] text-[var(--text-subtle)]">{formatRelativeTime(analysis.created_at)}</span>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {!user?.phone && (
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-5">
                <p className="text-[15px] font-semibold text-[var(--text-strong)]">Get a match edge</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  Create an account to analyze fixtures, track your picks and see your results over time.
                </p>
                <button
                  type="button"
                  onClick={() => { hapticFeedback('light'); setIsSignUpOpen(true); }}
                  className="mt-4 w-full rounded-xl bg-[var(--primary)] py-3 text-[14px] font-semibold text-[var(--primary-foreground)] transition-transform active:scale-[0.99]"
                >
                  Create account
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <SignUpSheet isOpen={isSignUpOpen} onClose={() => setIsSignUpOpen(false)} />
    </div>
  );
};
