import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Trophy, Medal, Star, ChevronLeft, ArrowUpRight, Copy } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';
import { supabase } from '../lib/supabase';

interface LeaderboardUser {
  id: string;
  name: string;
  username: string;
  telegram_id: number;
  credits: number;
  photo_url?: string;
}

export const Leaderboard: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const { hapticFeedback, tg } = useTelegram();

  useEffect(() => {
    if (tg?.BackButton) {
      tg.BackButton.show();
      const handleBack = () => {
        hapticFeedback('light');
        onBack();
      };
      tg.BackButton.onClick(handleBack);
      return () => {
        tg.BackButton.offClick(handleBack);
        tg.BackButton.hide();
      };
    }
  }, [tg, onBack, hapticFeedback]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, name, username, telegram_id, credits, photo_url')
          .order('credits', { ascending: false })
          .limit(10);
        
        if (data) setUsers(data);
      } catch (e) {
        console.error("Failed to fetch leaderboard:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, []);

  return (
    <div className="h-full bg-black flex flex-col relative z-[60]">
      {/* Header */}
      <div className="flex-none p-6 pt-8 pb-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#ccff00]/10 rounded-full flex items-center justify-center">
            <Trophy className="w-5 h-5 text-[#ccff00]" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Global Ranking</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Top analysts by credits</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-4">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-8 h-8 border-2 border-[#ccff00]/20 border-t-[#ccff00] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user, i) => (
              <motion.div 
                key={user.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`relative flex items-center gap-4 bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-[28px] overflow-hidden ${i < 3 ? 'shadow-[0_0_15px_rgba(204,255,0,0.05)]' : ''}`}
              >
                {/* Ranking Number */}
                <div className="w-8 flex justify-center items-center shrink-0">
                   <span className={`text-lg font-black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-600' : 'text-zinc-600'}`}>
                     #{i + 1}
                   </span>
                </div>

                {/* Avatar */}
                <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                   {user.photo_url ? (
                     <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                   ) : (
                     <span className="text-sm font-black text-white">{user.name.substring(0, 2).toUpperCase()}</span>
                   )}
                   {i === 0 && <div className="absolute top-0 right-0 w-3 h-3 bg-amber-400 rounded-full border-2 border-zinc-900" />}
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate">{user.name}</p>
                  <p className="text-[10px] font-bold text-zinc-500 truncate">@{user.username || user.telegram_id}</p>
                </div>

                {/* Score */}
                <div className="flex flex-col items-end shrink-0">
                  <div className="bg-[#ccff00]/10 px-3 py-1 rounded-full flex items-center gap-1 border border-[#ccff00]/20">
                    <span className="text-xs font-black text-[#ccff00]">{user.credits.toLocaleString()}</span>
                    <Star className="w-3 h-3 text-[#ccff00]" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
