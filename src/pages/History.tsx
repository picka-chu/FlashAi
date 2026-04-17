import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUserStore } from '../store/useUserStore';
import { 
  History as HistoryIcon, 
  ChevronRight, 
  Calendar, 
  Trophy, 
  Target, 
  TrendingUp, 
  Filter,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Zap
} from 'lucide-react';

export const History: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const filteredHistory = historyItems.filter(item => {
    const matchesFilter = filter === 'all' || item.status.toLowerCase() === filter;
    const haystack = `${item.endpoint || ''} ${item.method || ''}`.toLowerCase();
    const matchesSearch = haystack.includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = useMemo(() => {
    const total = historyItems.length;
    const won = historyItems.filter(i => i.status === 'won').length;
    const winRate = total > 0 ? Math.round((won / total) * 100) : 0;
    return { total, won, winRate };
  }, [historyItems]);

  const { user } = useUserStore();

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const tgInitData = window?.Telegram?.WebApp?.initData || '';
        const res = await fetch('/api/user/history', { headers: { 'X-TG-Init-Data': tgInitData } });
        const data = await res.json();
        const normalized = (Array.isArray(data) ? data : []).map((item: any) => {
          const isSuccess = Number(item.status) < 400;
          return {
            id: item.id,
            endpoint: item.endpoint || 'Unknown endpoint',
            method: item.method || 'GET',
            statusCode: item.status || 0,
            status: isSuccess ? 'won' : 'lost',
            created_at: item.created_at
          };
        });
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
      {/* Stats Header */}
      <div className="px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-black text-white">History</h2>
            <p className="text-[10px] font-black text-zinc-500 tracking-widest">Last 30 days</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.phone && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
                <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
                <span className="text-xs font-black text-white">{user.credits}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900/40 border border-zinc-800/50 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 mb-1">Total</p>
            <p className="text-lg font-black text-white">{stats.total}</p>
          </div>
          <div className="bg-green-500/5 border border-green-500/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-500/50 mb-1">Won</p>
            <p className="text-lg font-black text-green-400">{stats.won}</p>
          </div>
          <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-[#ccff00]/50 mb-1">Win rate</p>
            <p className="text-lg font-black text-[#ccff00]">{stats.winRate}%</p>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="px-4 py-2 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input 
            type="text"
            placeholder="Search matches..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ccff00]/50 transition-colors"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['all', 'won', 'lost'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-[10px] font-black tracking-widest transition-all ${
                filter === f 
                  ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.3)]' 
                  : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* History List */}
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
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] p-4 group active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      item.status === 'won' ? 'bg-green-500/10' : 'bg-red-500/10'
                    }`}>
                      {item.status === 'won' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 tracking-tighter">{item.method}</p>
                      <p className="text-xs font-black text-white">{item.endpoint}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] font-black tracking-widest ${
                      item.status === 'won' ? 'text-green-400' : 'text-red-400'
                    }`}>{item.status.toUpperCase()}</p>
                    <p className="text-xs font-black text-white">{item.statusCode}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-zinc-600">Prediction</span>
                      <span className="text-[10px] font-black text-white">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-800" />
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-zinc-600">Odds</span>
                      <span className="text-[10px] font-black text-[#ccff00]">{item.method}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="text-[8px] font-black text-zinc-600 block">Confidence</span>
                      <span className="text-[10px] font-black text-white">{item.statusCode}</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center group-hover:bg-[#ccff00] transition-colors">
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-black" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
                <HistoryIcon className="w-8 h-8 text-zinc-800" />
              </div>
              <div>
                <p className="text-sm font-black text-white">No history found</p>
                <p className="text-xs font-bold text-zinc-600 mt-1">Try adjusting your filters or search.</p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
