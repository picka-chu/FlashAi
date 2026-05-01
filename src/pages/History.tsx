import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUserStore } from '../store/useUserStore';
import { useTelegram } from '../hooks/useTelegram';
import {
  History as HistoryIcon,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Percent,
  ShieldAlert,
  ChevronRight,
  CalendarDays,
  X,
  BrainCircuit,
} from 'lucide-react';

type HistoryStatus = 'pending' | 'won' | 'lost' | 'not_applicable';

type AnalysisPayload = {
  predictions?: { market: string; confidence: number; reasoning: string }[];
  overallReasoning?: string;
  teamData?: {
    home?: { name?: string; form?: string; injuries?: string[]; keyStats?: string[] };
    away?: { name?: string; form?: string; injuries?: string[]; keyStats?: string[] };
  };
};

type HistoryItem = {
  id: string;
  match: string;
  home?: string;
  away?: string;
  predictionMarket: string;
  confidence: number;
  reasoning?: string;
  status: HistoryStatus;
  created_at: string;
  resolved_at?: string | null;
  analysisPayload?: AnalysisPayload | null;
};

const statusUi: Record<HistoryStatus, { label: string; className: string; icon: React.ReactNode }> = {
  won: {
    label: 'Won',
    className: 'text-green-300 bg-green-500/10 border-green-500/30',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  },
  lost: {
    label: 'Lost',
    className: 'text-red-300 bg-red-500/10 border-red-500/30',
    icon: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  },
  pending: {
    label: 'Pending',
    className: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  not_applicable: {
    label: 'N/A',
    className: 'text-zinc-400 bg-zinc-800/50 border-zinc-700/50',
    icon: <ShieldAlert className="w-3.5 h-3.5 text-zinc-500" />,
  },
};

function getStatusUi(status: string) {
  return statusUi[status as HistoryStatus] ?? statusUi['pending'];
}

export const History: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<HistoryItem | null>(null);

  const { user } = useUserStore();
  const { initData } = useTelegram();

  const filteredHistory = historyItems.filter((item) => {
    const haystack = `${item.match} ${item.predictionMarket}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  const stats = useMemo(() => {
    const total = historyItems.length;
    const won = historyItems.filter((i) => i.status === 'won').length;
    const lost = historyItems.filter((i) => i.status === 'lost').length;
    const settled = won + lost;
    const winRate = settled > 0 ? Math.round((won / settled) * 100) : 0;
    return { total, won, lost, winRate };
  }, [historyItems]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await fetch('/api/user/history', { headers: { 'X-TG-Init-Data': initData || '' } });
        const data = await res.json();
        const normalized = (Array.isArray(data) ? data : []).map((item: any) => ({
          id: String(item.id),
          match: item.match || `${item.home || 'Home'} vs ${item.away || 'Away'}`,
          home: item.home || 'Home',
          away: item.away || 'Away',
          predictionMarket: item.predictionMarket || 'Unknown market',
          confidence: Number(item.confidence || 0),
          reasoning: item.reasoning || '',
          status: (['won', 'lost', 'pending', 'not_applicable'].includes(item.status) ? item.status : 'pending') as HistoryStatus,
          created_at: item.created_at,
          resolved_at: item.resolved_at || null,
          analysisPayload: item.analysisPayload || null,
        }));
        setHistoryItems(normalized);
      } catch (e) {
        console.error('History fetch failed:', e);
        setHistoryItems([]);
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, [initData]);

  const formatDate = (date: string) => new Date(date).toLocaleString();

  return (
    <div className="h-full overflow-y-auto no-scrollbar bg-black relative">
      <div className="px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-black text-white">Analysis History</h2>
            <p className="text-[10px] font-black text-zinc-500 tracking-widest">Tap any card to view full analysis</p>
          </div>
          {user?.phone && (
            <div className={`backdrop-blur-md border px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)] ${user.credits <= 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
              <Zap className={`w-3.5 h-3.5 ${user.credits <= 0 ? 'text-red-500' : 'text-[#ccff00]'}`} />
              <span className={`text-xs font-black ${user.credits <= 0 ? 'text-red-500' : 'text-white'}`}>{user.credits}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-900/50 border border-zinc-800/60 p-4 rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 mb-1">Total</p>
            <p className="text-lg font-black text-white">{stats.total}</p>
          </div>
          <div className="bg-[#ccff00]/5 border border-[#ccff00]/20 p-4 rounded-2xl">
            <p className="text-[10px] font-black text-[#ccff00]/60 mb-1">Win rate</p>
            <p className="text-lg font-black text-[#ccff00]">{stats.winRate}%</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by match or market..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ccff00]/50 transition-colors"
          />
        </div>
      </div>

      <div className="px-4 py-4 space-y-3 pb-24">
        <AnimatePresence mode="popLayout">
          {loading ? (
            <div className="text-center text-zinc-500 text-sm py-10">Loading history...</div>
          ) : filteredHistory.length > 0 ? (
            filteredHistory.map((item, i) => {
              const status = getStatusUi(item.status);
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => setActiveItem(item)}
                  className="w-full text-left rounded-[24px] border border-zinc-800/60 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-4 hover:border-[#ccff00]/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-black tracking-wide ${status.className}`}>
                          {status.icon}
                          {status.label}
                        </span>
                        <span className="text-[10px] font-bold text-zinc-500 inline-flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <p className="text-sm font-black text-white line-clamp-1">{item.match}</p>
                      <p className="text-[11px] font-bold text-zinc-400 line-clamp-1">{item.predictionMarket}</p>
                    </div>

                    <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                  </div>

                  <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-zinc-300">
                      <Percent className="w-3.5 h-3.5" />
                      <span className="text-xs font-black">{item.confidence}% confidence</span>
                    </div>
                    <span className="text-[10px] font-black text-zinc-500">View details</span>
                  </div>
                </motion.button>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
                <HistoryIcon className="w-8 h-8 text-zinc-800" />
              </div>
              <div>
                <p className="text-sm font-black text-white">No analyzed matches yet</p>
                <p className="text-xs font-bold text-zinc-600 mt-1">Analyze matches to build your history.</p>
              </div>
            </div>
          )}
        </AnimatePresence>

        {!loading && historyItems.some((item) => item.status === 'pending') && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5" />
            <p className="text-[10px] font-bold text-amber-200">Pending items auto-resolve when the match finishes. Markets like corners or player scorers show N/A as they can't be verified from the final score.</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {activeItem && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveItem(null)}
              className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-40"
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="fixed z-50 inset-x-0 bottom-0 rounded-t-[32px] bg-zinc-950 border-t border-zinc-800 max-h-[85vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-zinc-950/95 backdrop-blur-md px-5 pt-4 pb-3 border-b border-zinc-800/60 flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-zinc-500 tracking-widest">Full analysis</p>
                  <p className="text-sm font-black text-white line-clamp-1">{activeItem.match}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveItem(null)}
                  className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"
                >
                  <X className="w-4 h-4 text-zinc-300" />
                </button>
              </div>

              <div className="p-5 space-y-4 pb-8">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
                    <p className="text-[10px] font-black text-zinc-500 mb-1">Prediction</p>
                    <p className="text-sm font-black text-white">{activeItem.predictionMarket}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
                    <p className="text-[10px] font-black text-zinc-500 mb-1">Confidence</p>
                    <p className="text-sm font-black text-[#ccff00]">{activeItem.confidence}%</p>
                  </div>
                </div>

                {activeItem.analysisPayload?.predictions?.length ? (
                  <div className="space-y-3">
                    <p className="text-xs font-black text-zinc-500 tracking-widest">All predictions</p>
                    {activeItem.analysisPayload.predictions.map((prediction, idx) => (
                      <div key={`${activeItem.id}-${idx}`} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-white">{prediction.market}</p>
                          <span className="text-[10px] font-black text-[#ccff00]">{prediction.confidence}%</span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">{prediction.reasoning}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                    <p className="text-xs font-black text-zinc-500 mb-2">Reasoning</p>
                    <p className="text-xs text-zinc-300 leading-relaxed">{activeItem.reasoning || 'No detailed analysis available for this entry.'}</p>
                  </div>
                )}

                {activeItem.analysisPayload?.overallReasoning && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                    <p className="text-xs font-black text-zinc-500 mb-2 inline-flex items-center gap-1.5">
                      <BrainCircuit className="w-3.5 h-3.5 text-[#ccff00]" />
                      Match overview
                    </p>
                    <p className="text-xs text-zinc-300 leading-relaxed">{activeItem.analysisPayload.overallReasoning}</p>
                  </div>
                )}

                {activeItem.analysisPayload?.teamData && (
                  <div className="grid grid-cols-2 gap-3">
                    {(['home', 'away'] as const).map((side) => {
                      const team = activeItem.analysisPayload?.teamData?.[side];
                      return (
                        <div key={side} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-2">
                          <p className="text-xs font-black text-white line-clamp-1">{team?.name || activeItem[side] || side}</p>
                          <p className="text-[10px] text-zinc-500">Form: <span className="text-zinc-300 font-black">{team?.form || 'N/A'}</span></p>
                          {team?.injuries?.length ? (
                            <p className="text-[10px] text-zinc-400 line-clamp-2">Missing: {team.injuries.join(', ')}</p>
                          ) : (
                            <p className="text-[10px] text-green-300">Full squad reported</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="text-[10px] text-zinc-500 flex items-center justify-between border-t border-zinc-800/60 pt-3">
                  <span>Created: {formatDate(activeItem.created_at)}</span>
                  <span>{activeItem.resolved_at ? `Resolved: ${formatDate(activeItem.resolved_at)}` : 'Awaiting result'}</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
