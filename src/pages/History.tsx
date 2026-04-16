import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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

const MOCK_HISTORY = [
  {
    id: 1,
    home: 'Man City',
    away: 'Man Utd',
    league: 'Premier League',
    date: '2024-04-14',
    prediction: 'Home Win',
    odds: 1.45,
    confidence: 92,
    status: 'WON',
    result: '3-1',
    type: 'Safe'
  },
  {
    id: 2,
    home: 'Arsenal',
    away: 'Aston Villa',
    league: 'Premier League',
    date: '2024-04-14',
    prediction: 'Over 2.5 Goals',
    odds: 1.65,
    confidence: 85,
    status: 'LOST',
    result: '0-2',
    type: 'Value'
  },
  {
    id: 3,
    home: 'Real Madrid',
    away: 'Mallorca',
    league: 'La Liga',
    date: '2024-04-13',
    prediction: 'Home Win',
    odds: 1.35,
    confidence: 95,
    status: 'WON',
    result: '1-0',
    type: 'Safe'
  },
  {
    id: 4,
    home: 'Bayern',
    away: 'FC Koln',
    league: 'Bundesliga',
    date: '2024-04-13',
    prediction: 'Home Win',
    odds: 1.25,
    confidence: 98,
    status: 'WON',
    result: '2-0',
    type: 'Safe'
  }
];

export const History: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHistory = MOCK_HISTORY.filter(item => {
    const matchesFilter = filter === 'all' || item.status.toLowerCase() === filter;
    const matchesSearch = item.home.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.away.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: MOCK_HISTORY.length,
    won: MOCK_HISTORY.filter(i => i.status === 'WON').length,
    winRate: Math.round((MOCK_HISTORY.filter(i => i.status === 'WON').length / MOCK_HISTORY.length) * 100)
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar bg-black">
      {/* Stats Header */}
      <div className="px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-black text-white">History</h2>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Last 30 Days</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
              <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
              <span className="text-xs font-black text-white">240</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900/40 border border-zinc-800/50 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase mb-1">Total</p>
            <p className="text-lg font-black text-white">{stats.total}</p>
          </div>
          <div className="bg-green-500/5 border border-green-500/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-500/50 uppercase mb-1">Won</p>
            <p className="text-lg font-black text-green-400">{stats.won}</p>
          </div>
          <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 p-3 rounded-2xl">
            <p className="text-[10px] font-black text-[#ccff00]/50 uppercase mb-1">Win Rate</p>
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
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
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
          {filteredHistory.length > 0 ? (
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
                      item.status === 'WON' ? 'bg-green-500/10' : 'bg-red-500/10'
                    }`}>
                      {item.status === 'WON' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-tighter">{item.league}</p>
                      <p className="text-xs font-black text-white">{item.home} vs {item.away}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${
                      item.status === 'WON' ? 'text-green-400' : 'text-red-400'
                    }`}>{item.status}</p>
                    <p className="text-xs font-black text-white">{item.result}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-zinc-600 uppercase">Prediction</span>
                      <span className="text-[10px] font-black text-white">{item.prediction}</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-800" />
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-zinc-600 uppercase">Odds</span>
                      <span className="text-[10px] font-black text-[#ccff00]">@{item.odds}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="text-[8px] font-black text-zinc-600 uppercase block">Confidence</span>
                      <span className="text-[10px] font-black text-white">{item.confidence}%</span>
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
