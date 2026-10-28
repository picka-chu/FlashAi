import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Loader2, RefreshCw, Sparkles, Zap, AlertTriangle } from 'lucide-react';
import { analyzeLiveMatch, getLiveMatchPreview } from '../services/footballService';
import { useTelegram } from '../hooks/useTelegram';
import { useUserStore } from '../store/useUserStore';
import { formatMatch } from '../lib/matchUtils';
import { TeamLogo } from '../components/TeamLogo';

const statPercent = (value: string | number | undefined | null, fallback = 0) => {
  if (value == null || value === '') return fallback;
  const raw = typeof value === 'number' ? value : Number(String(value).replace('%', '').replace(',', '.'));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(100, raw));
};

export const LiveMatchPreview: React.FC<{ onBack: () => void; onGoAnalyze: () => void }> = ({ onBack, onGoAnalyze }) => {
  const { livePreviewMatch, setLivePreviewMatch, user, setUser, setSelectedMatch, setAnalysisResult, setIsAnalyzing } = useUserStore();
  const { initData, showAlert, hapticFeedback } = useTelegram();
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [minuteSync, setMinuteSync] = useState({ elapsed: 0, at: Date.now(), status: '' });

  const fixtureId =
    livePreviewMatch?.id ??
    livePreviewMatch?.fixture_id ??
    livePreviewMatch?.fixture?.id ??
    null;

  useEffect(() => {
    const ticker = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!fixtureId) return;

    let mounted = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const data = await getLiveMatchPreview(String(fixtureId), initData || '');
        if (mounted && data) {
          // Format the raw backend data before merging into state
          const formatted = formatMatch(data);
          const status = String(data?.fixture?.status?.short || data?.status || '').toUpperCase();
          const elapsed = Number(data?.fixture?.status?.elapsed ?? 0);
          setLivePreviewMatch({ ...(useUserStore.getState().livePreviewMatch || {}), ...formatted });
          setMinuteSync({ elapsed: Number.isFinite(elapsed) ? elapsed : 0, at: Date.now(), status });
        }
      } catch {
        // keep last snapshot — don't show error for background refresh failures
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fixtureId]);

  const minuteStatus = String(minuteSync.status || livePreviewMatch?.fixture?.status?.short || '').toUpperCase();
  const clockRuns = minuteSync.elapsed > 0 && !['HT', 'BT', 'FT', 'AET', 'PEN', 'P', 'SUSP', 'INT', 'CANC', 'ABD'].includes(minuteStatus);
  const liveMinute = clockRuns
    ? `${minuteSync.elapsed + Math.floor(Math.max(0, clockNow - minuteSync.at) / 60_000)}'`
    : (livePreviewMatch?.fixture?.status?.long || livePreviewMatch?.minute || minuteStatus || 'LIVE');

  const rows = useMemo(() => {
    const stats = livePreviewMatch?.stats || {};
    const homePassing = statPercent(stats?.possession?.home || 50);
    return [
      { label: 'Attacks', home: statPercent(stats?.shots?.home), away: statPercent(stats?.shots?.away) },
      { label: 'Possession', home: homePassing, away: 100 - homePassing },
      { label: 'On Target', home: statPercent(stats?.shotsOnTarget?.home), away: statPercent(stats?.shotsOnTarget?.away) },
      { label: 'Corners', home: statPercent(stats?.corners?.home), away: statPercent(stats?.corners?.away) },
    ];
  }, [livePreviewMatch]);

  if (!livePreviewMatch) {
    return (
      <div className="h-full bg-black text-white flex items-center justify-center">
        <button onClick={onBack} className="text-sm text-zinc-300">Back to matches</button>
      </div>
    );
  }

  const handleAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAttemptCount(n => n + 1);
    hapticFeedback('medium');

    try {
      if (!fixtureId) {
        setAnalyzeError('Live fixture ID is missing. Go back and reopen this match from Live Matches.');
        return;
      }
      const payload = await analyzeLiveMatch(
        { fixtureId: String(fixtureId), liveSnapshot: livePreviewMatch },
        initData || ''
      );

      if (!payload?.result) {
        setAnalyzeError('Analysis response was incomplete. Tap Retry to try again.');
        return;
      }

      // Set ALL store state BEFORE navigating — Analyze.tsx reads on mount.
      // Wrong order = race condition = blank/error page.
      setAnalysisResult(payload.result);
      setIsAnalyzing(false);
      setSelectedMatch({
        ...livePreviewMatch,
        liveSnapshot: payload?.liveData || livePreviewMatch,
        analysisType: 'live',
      });
      if (typeof payload?.newCredits === 'number' && user) {
        setUser({ ...user, credits: payload.newCredits });
      }

      // Let Zustand flush before React re-renders the new tab
      await new Promise(r => setTimeout(r, 30));
      onGoAnalyze();
    } catch (error: any) {
      const msg = error?.message || 'Live analysis failed. Please try again.';
      // Only use showAlert for permanent errors (auth, plan, credits)
      // For transient errors, show inline so the app doesn't close
      const isPermanent = msg.includes('paid plan') || msg.includes('credit') || msg.includes('authentication') || msg.includes('not identified');
      if (isPermanent) {
        showAlert(msg);
      } else {
        setAnalyzeError(msg);
      }
    } finally {
      setAnalyzing(false);
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="h-full bg-black text-white overflow-y-auto no-scrollbar">
      <div className="sticky top-0 z-20 bg-black/90 border-b border-zinc-800 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center"><ArrowLeft className="w-5 h-5" /></button>
          <div className="text-center">
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Telegram Live Preview</div>
            <div className="text-xs font-bold text-zinc-300">{livePreviewMatch.league}</div>
          </div>
          <button onClick={() => setLivePreviewMatch(null)} className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      <div className="p-4 pb-36 space-y-4">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-800 border border-zinc-700 p-2 overflow-hidden">
                <TeamLogo name={livePreviewMatch.home} logo={livePreviewMatch.homeLogo} textClassName="text-base" />
              </div>
              <p className="mt-2 text-sm font-bold line-clamp-1">{livePreviewMatch.home}</p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-black text-[#8fff00]">{(livePreviewMatch.score || '0-0').replace('-', ':')}</div>
              <div className="text-xs text-red-400 font-black uppercase mt-1">{liveMinute}</div>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-800 border border-zinc-700 p-2 overflow-hidden">
                <TeamLogo name={livePreviewMatch.away} logo={livePreviewMatch.awayLogo} textClassName="text-base" />
              </div>
              <p className="mt-2 text-sm font-bold line-clamp-1">{livePreviewMatch.away}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-4">
          <div className="flex items-center gap-2 text-zinc-300"><BarChart3 className="w-4 h-4" /><span className="text-xs font-black uppercase tracking-wider">Live composition & momentum</span></div>
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex justify-between text-xs mb-1"><span>{row.home.toFixed(0)}%</span><span className="text-zinc-400">{row.label}</span><span>{row.away.toFixed(0)}%</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-[#ccff00]" style={{ width: `${row.home}%` }} /></div>
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${row.away}%` }} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Inline error — never use showAlert for transient errors as it can close the mini-app */}
        {analyzeError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-300 leading-relaxed">{analyzeError}</p>
              {attemptCount < 5 && (
                <button
                  onClick={handleAnalyze}
                  className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#ccff00] underline underline-offset-2"
                >
                  Tap to retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleAnalyze}
        disabled={analyzing}
        className="fixed bottom-24 right-5 z-30 h-14 px-5 rounded-full bg-[#ccff00] text-black font-black text-sm shadow-[0_12px_32px_rgba(204,255,0,0.35)] inline-flex items-center gap-2 disabled:opacity-70"
      >
        {analyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        {analyzing ? 'Analysing… (up to 35s)' : analyzeError ? '↺ Retry Analysis' : 'Run Live Analysis'}
      </button>

      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500 inline-flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-full px-3 py-1">
        <Sparkles className="w-3 h-3" /> Live data refreshes every 15s
      </div>
    </div>
  );
};
