import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUserStore } from '../store/useUserStore';
import { 
  History as HistoryIcon,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Target,
  Percent,
  ShieldAlert,
} from 'lucide-react';

type HistoryItem = {
  id: string;
  match: string;
  predictionMarket: string;
  confidence: number;
  status: 'pending' | 'won' | 'lost';
  created_at: string;
};

export const History: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const { user } = useUserStore();

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
        const tgInitData = window?.Telegram?.WebApp?.initData || '';
        const res = await fetch('/api/user/history', { headers: { 'X-TG-Init-Data': tgInitData } });
        const data = await res.json();
        const normalized = (Array.isArray(data) ? data : []).map((item: any) => ({
          id: String(item.id),
          match: item.match || `${item.home || 'Home'} vs ${item.away || 'Away'}`,
          predictionMarket: item.predictionMarket || 'Unknown market',
          confidence: Number(item.confidence || 0),
          status: (item.status || 'pending') as HistoryItem['status'],
          created_at: item.created_at,
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
  }, []);

  return (
    <div className="h-full overflow-y-auto no-scrollbar bg-black">
      <div className="px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-black text-white">Analysis History</h2>
            <p className="text-[10px] font-black text-zinc-500 tracking-widest">Your analyzed matches</p>
          </div>
          {user?.phone && (
            <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
              <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
              <span className="text-xs font-black text-white">{user.credits}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="bg-zinc-900/40 border border-zinc-800/50 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 mb-1">Total</p>
            <p className="text-lg font-black text-white">{stats.total}</p>
          </div>
          <div className="bg-green-500/5 border border-green-500/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-500/50 mb-1">Won</p>
            <p className="text-lg font-black text-green-400">{stats.won}</p>
          </div>
          <div className="bg-red-500/5 border border-red-500/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-red-500/50 mb-1">Lost</p>
            <p className="text-lg font-black text-red-400">{stats.lost}</p>
          </div>
          <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-[#ccff00]/50 mb-1">Win rate</p>
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
            filteredHistory.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.04 }}
                className="bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] p-4"
              >
                <div className="flex justify-between items-start mb-4 gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      item.status === 'won' ? 'bg-green-500/10' : item.status === 'lost' ? 'bg-red-500/10' : 'bg-amber-500/10'
                    }`}>
                      {item.status === 'won' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      ) : item.status === 'lost' ? (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-black text-white">{item.match}</p>
                      <p className="text-[10px] font-black text-zinc-500 tracking-tighter uppercase">{item.predictionMarket}</p>
                    </div>
                  </div>
                  <p className={`text-[10px] font-black tracking-widest uppercase ${
                    item.status === 'won' ? 'text-green-400' : item.status === 'lost' ? 'text-red-400' : 'text-amber-400'
                  }`}>{item.status}</p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-3 h-3 text-[#ccff00]" />
                      <span className="text-[10px] font-black text-zinc-300">{item.predictionMarket}</span>
                    </div>
                    <div className="w-px h-5 bg-zinc-800" />
                    <div className="flex items-center gap-1.5">
                      <Percent className="w-3 h-3 text-zinc-400" />
                      <span className="text-[10px] font-black text-white">{item.confidence}%</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-black text-zinc-500">{new Date(item.created_at).toLocaleString()}</span>
                </div>
              </motion.div>
            ))
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
            <p className="text-[10px] font-bold text-amber-200">Pending items are auto-resolved when the match is finished.</p>
          </div>
        )}
      </div>
    </div>
  );
};
