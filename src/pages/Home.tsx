import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Zap,
  Trophy,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  History as HistoryIcon,
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
import { formatMatch } from '../lib/matchUtils';
import { useTabActive } from '../hooks/useTabActive';
import { ModernMatchCard } from '../components/ModernMatchCard';
import { SectionHeader, FeaturedMatch, ResultCard } from './HomeParts';

interface HomeProps {
  onTabChange: (tab: any) => void;
}

export const Home: React.FC<HomeProps> = ({ onTabChange }) => {
  const [adIndex, setAdIndex] = useState(0);
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [dynamicAds, setDynamicAds] = useState<any[]>([]);
  const [recentAnalysis, setRecentAnalysis] = useState<any[]>([]);
  const [news, setNews] = useState<FootballNewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const isTabActive = useTabActive();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  const adsRef = React.useRef<HTMLDivElement>(null);
  const { user, setSelectedMatch, setIsAnalyzing, setAnalysisResult } = useUserStore();
  const { hapticFeedback, tg, initData } = useTelegram();
  const isPaid = Boolean(user?.plan && user.plan !== 'free');

  const getAnalysisStatusUi = (status: string) => {
    const n = String(status || 'pending').toLowerCase();
    if (n === 'won') return { label: 'Won', className: 'bg-[var(--success-soft)] text-[var(--success)]', icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    if (n === 'lost') return { label: 'Lost', className: 'bg-[var(--danger-soft)] text-[var(--danger)]', icon: <XCircle className="h-3.5 w-3.5" /> };
    return { label: 'Pending', className: 'bg-white/[0.06] text-[var(--text-muted)]', icon: <Clock className="h-3.5 w-3.5" /> };
  };

  const formatRelativeTime = (date: string) => {
    const diff = Math.max(0, Date.now() - new Date(date).getTime());
    const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;
    if (diff < minute) return 'Just now';
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    return `${Math.floor(diff / day)}d ago`;
  };

  useEffect(() => {
    const activeAd = dynamicAds[adIndex];
    if (activeAd?.id && typeof activeAd.id === 'string') {
      fetch(`/api/common/ads/${activeAd.id}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view' }) }).catch(() => {});
    }
  }, [adIndex, dynamicAds]);

  useEffect(() => {
    const fetchData = async () => {
      const authInitData = initData || tg?.initData || '';
      setLoadFailed(false);
      const [upcomingR, adsR, historyR, liveR] = await Promise.allSettled([
        getUpcomingMatches(authInitData),
        fetch('/api/common/ads', { headers: { 'X-TG-Init-Data': authInitData } }).then((r) => r.json()),
        authInitData ? fetch('/api/user/history', { headers: { 'X-TG-Init-Data': authInitData } }).then((r) => (r.ok ? r.json() : [])) : Promise.resolve([]),
        user?.plan && user.plan !== 'free' ? getLiveMatches(authInitData).catch(() => []) : Promise.resolve([]),
      ]);
      const settle = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
      const adsRes = settle(adsR) as any;
      if (Array.isArray(adsRes) && adsRes.length > 0) setDynamicAds(adsRes);
      const upcoming = settle(upcomingR) as any;
      if (Array.isArray(upcoming)) {
        setUpcomingMatches(upcoming.map((m: any) => { const f = formatMatch(m); return f ? { ...f, odds: m.odds || null } : null; }).filter(Boolean).slice(0, 200));
      } else setLoadFailed(true);
      const live = settle(liveR) as any;
      if (Array.isArray(live)) setLiveMatches(live.map((m: any) => formatMatch(m)).filter(Boolean).slice(0, 20));
      const historyRes = settle(historyR) as any;
      if (Array.isArray(historyRes)) {
        setRecentAnalysis(historyRes.map((item: any) => ({
          id: String(item.id),
          match: item.match || `${item.home || 'Home'} vs ${item.away || 'Away'}`,
          predictionMarket: item.predictionMarket || 'Unknown market',
          confidence: Number(item.confidence || 0),
          status: String(item.status || 'pending').toLowerCase(),
          created_at: item.created_at || new Date().toISOString(),
        })).slice(0, 5));
      }
      setIsLoading(false);
    };
    void fetchData();
  }, [initData, tg?.initData, user?.phone, user?.plan, reloadNonce]);

  useEffect(() => {
    let cancelled = false;
    setNewsLoading(true);
    getFootballNews(12).then((a) => { if (!cancelled) setNews(a); }).catch(() => {}).finally(() => { if (!cancelled) setNewsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dynamicAds.length || !isTabActive || prefersReducedMotion) return;
    const interval = window.setInterval(() => {
      const el = adsRef.current;
      if (!el || document.visibilityState !== 'visible') return;
      const width = el.offsetWidth || 1;
      const next = (Math.round(el.scrollLeft / width) + 1) % dynamicAds.length;
      el.scrollTo({ left: next * width, behavior: 'smooth' });
      setAdIndex(next);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [dynamicAds, isTabActive, prefersReducedMotion]);

  const handleAnalyze = async (match: any) => {
    hapticFeedback('medium');
    setSelectedMatch(match);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    onTabChange('analyze');
    try { await recordMatchClick(match.id || match.fixture?.id, match); } catch {}
  };

  const featuredMatch = useMemo(() => liveMatches[0] || upcomingMatches[0] || null, [liveMatches, upcomingMatches]);
  const featuredIsNext = !liveMatches.length && !!upcomingMatches.length;
  const finishedMatches = useMemo(() => upcomingMatches.filter((m) => m?.fixture?.status?.state === 'post' || m.status === 'FT' || m.status === 'Finished').slice(0, 8), [upcomingMatches]);

  return (
    <div className="min-h-full space-y-6 pb-8 pt-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3 min-w-0">
          {user?.photo_url ? (
            <img src={user.photo_url} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-[var(--border)]" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]">
              <Zap className="h-5 w-5 text-[var(--primary-foreground)]" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-[var(--text-strong)]">{user?.name || user?.username || 'Flash AI'}</p>
            <p className="text-[12px] text-[var(--text-muted)]">Match intelligence</p>
          </div>
        </div>
        {isPaid ? (
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--primary)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--primary)]"><Flame className="h-3.5 w-3.5" /> Pro</span>
        ) : (
          <button type="button" onClick={() => { hapticFeedback('light'); onTabChange('profile'); }} className="rounded-full bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-[var(--primary-foreground)]">Upgrade</button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-[24px]" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {loadFailed && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4">
              <p className="text-[13px] font-medium text-[var(--text-strong)]">Couldn't refresh fixtures.</p>
              <button type="button" onClick={() => { setReloadNonce((n) => n + 1); setIsLoading(true); }} className="rounded-xl bg-[var(--primary)] px-3 py-2 text-[12px] font-semibold text-[var(--primary-foreground)]">Retry</button>
            </div>
          )}

          {featuredMatch ? (
            <FeaturedMatch match={featuredMatch} eyebrow={featuredIsNext ? 'Next up' : 'Top match'} onClick={() => handleAnalyze(featuredMatch)} />
          ) : (
            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
              <p className="text-[15px] font-semibold text-[var(--text-strong)]">No fixtures available</p>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">New matches will appear once scheduled.</p>
            </div>
          )}

          {isPaid && liveMatches.length > 0 && (
            <section className="space-y-3">
              <SectionHeader title="Live now" icon={<Radio className="h-4 w-4 text-[var(--primary)]" />} action="All" onAction={() => onTabChange('matches')} />
              <div className="space-y-2">{liveMatches.slice(0, 4).map((match, i) => (<ModernMatchCard key={match.id || i} match={match} onClick={() => handleAnalyze(match)} />))}</div>
            </section>
          )}

          {!isPaid && (
            <button type="button" onClick={() => { hapticFeedback('light'); onTabChange('profile'); }} className="flex w-full items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]"><Lock className="h-5 w-5 text-[var(--primary)]" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[var(--text-strong)]">Unlock live scores</p>
                <p className="text-[12px] text-[var(--text-muted)]">Upgrade for live matches and deeper markets</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" />
            </button>
          )}

          {upcomingMatches.filter((m) => m?.fixture?.status?.state !== 'post').length > 0 && (
            <section className="space-y-3">
              <SectionHeader title="Upcoming" icon={<Clock className="h-4 w-4 text-[var(--primary)]" />} action="All" onAction={() => onTabChange('matches')} />
              <div className="space-y-2">{upcomingMatches.filter((m) => m?.fixture?.status?.state !== 'post').slice(0, 6).map((match, i) => (<ModernMatchCard key={match.id || i} match={match} onClick={() => handleAnalyze(match)} />))}</div>
            </section>
          )}

          {finishedMatches.length > 0 && (
            <section className="space-y-3">
              <SectionHeader title="Latest results" icon={<Trophy className="h-4 w-4 text-[var(--primary)]" />} />
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">{finishedMatches.map((match, i) => (<ResultCard key={match.id || i} match={match} onClick={() => handleAnalyze(match)} />))}</div>
            </section>
          )}

          {recentAnalysis.length > 0 && (
            <section className="space-y-3">
              <SectionHeader title="Your recent picks" icon={<HistoryIcon className="h-4 w-4 text-[var(--primary)]" />} action="History" onAction={() => onTabChange('history')} />
              <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                {recentAnalysis.map((analysis, idx) => {
                  const status = getAnalysisStatusUi(analysis.status);
                  return (
                    <motion.button key={analysis.id} type="button" onClick={() => onTabChange('history')} className={`flex w-full items-center gap-3 p-4 text-left ${idx === recentAnalysis.length - 1 ? '' : 'border-b border-[var(--border)]'}`}>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-[14px] font-medium text-[var(--text-strong)]">{analysis.match}</p>
                        <p className="flex items-center gap-1.5 truncate text-[12px] text-[var(--text-muted)]"><Percent className="h-3 w-3 shrink-0" /><span className="tabular">{analysis.confidence}%</span><span className="truncate">· {analysis.predictionMarket}</span></p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.icon}{status.label}</span>
                        <span className="text-[11px] text-[var(--text-subtle)]">{formatRelativeTime(analysis.created_at)}</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </section>
          )}

          {!user?.phone && (
            <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-5">
              <p className="text-[15px] font-semibold text-[var(--text-strong)]">Get a match edge</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">Create an account to analyze fixtures, track picks and see results.</p>
              <button type="button" onClick={() => { hapticFeedback('light'); setIsSignUpOpen(true); }} className="mt-4 w-full rounded-xl bg-[var(--primary)] py-3 text-[14px] font-semibold text-[var(--primary-foreground)]">Create account</button>
            </div>
          )}

          {(newsLoading || news.length > 0) && (
            <section className="space-y-3">
              <SectionHeader title="Football news" icon={<Newspaper className="h-4 w-4 text-[var(--primary)]" />} />
              <FootballNewsFeed articles={news} loading={newsLoading} />
            </section>
          )}
        </>
      )}

      <SignUpSheet isOpen={isSignUpOpen} onClose={() => setIsSignUpOpen(false)} />
    </div>
  );
};
