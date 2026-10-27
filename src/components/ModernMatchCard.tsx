import React from 'react';
import { Radio, Sparkles, Clock, Trophy } from 'lucide-react';
import { TeamLogo } from './TeamLogo';

interface ModernMatchCardProps {
  match: any;
  variant: 'live' | 'prematch';
  onClick: () => void;
  compact?: boolean;
}

export const ModernMatchCard: React.FC<ModernMatchCardProps> = ({ match, variant, onClick, compact = false }) => {
  const isLive = variant === 'live';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left relative overflow-hidden bg-zinc-900/40 backdrop-blur-sm border border-zinc-800/50 rounded-[28px] ${compact ? 'p-4' : 'p-5'} active:scale-[0.98] transition-all group`}
    >
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/50 via-transparent to-transparent pointer-events-none" />
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#ccff00]/5 blur-3xl rounded-full pointer-events-none group-hover:bg-[#ccff00]/10 transition-colors" />
      
      <div className="relative z-10">
        {/* League & Status Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
              <Trophy className="w-3 h-3 text-zinc-500" />
            </div>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.12em] truncate">
              {match.league}
            </span>
          </div>
          
          {isLive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20">
              <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-black text-red-500 uppercase tracking-wider">
                {match.minute || 'LIVE'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/50 border border-zinc-700/50">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] font-black text-zinc-300 uppercase tracking-wider">
                {match.date}
              </span>
            </div>
          )}
        </div>

        {/* Match Composition */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Home Team */}
          <div className="flex flex-col items-center gap-2.5 min-w-0">
            <div className="relative">
              <div className="absolute inset-0 bg-white/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="w-14 h-14 rounded-2xl bg-zinc-800/40 border border-zinc-700/30 p-2 flex items-center justify-center relative z-10 backdrop-blur-md shadow-inner overflow-hidden">
                <TeamLogo name={match.home} logo={match.homeLogo} textClassName="text-xs" />
              </div>
            </div>
            <span className="text-[12px] font-bold text-zinc-100 text-center line-clamp-1 w-full tracking-tight">
              {match.home}
            </span>
          </div>

          {/* Center Info: Score or Time */}
          <div className="flex flex-col items-center justify-center min-w-[80px]">
            {isLive ? (
              <div className="flex flex-col items-center">
                <div className="text-2xl font-black text-white tracking-tighter flex items-center gap-1.5">
                  <span className={match.goals?.home > match.goals?.away ? 'text-[#ccff00]' : 'text-white'}>
                    {match.score?.split('-')[0] || '0'}
                  </span>
                  <span className="text-zinc-700">:</span>
                  <span className={match.goals?.away > match.goals?.home ? 'text-[#ccff00]' : 'text-white'}>
                    {match.score?.split('-')[1] || '0'}
                  </span>
                </div>
                <div className="mt-1 px-2 py-0.5 rounded-md bg-zinc-800/30">
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.15em]">Live</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="text-xl font-black text-white tracking-tight">
                  {match.time}
                </div>
                <div className="mt-1 h-[1px] w-4 bg-zinc-800" />
                <div className="mt-1 text-[8px] font-black text-[#ccff00] uppercase tracking-[0.2em]">
                  VS
                </div>
              </div>
            )}
          </div>

          {/* Away Team */}
          <div className="flex flex-col items-center gap-2.5 min-w-0">
            <div className="relative">
              <div className="absolute inset-0 bg-white/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="w-14 h-14 rounded-2xl bg-zinc-800/40 border border-zinc-700/30 p-2 flex items-center justify-center relative z-10 backdrop-blur-md shadow-inner overflow-hidden">
                <TeamLogo name={match.away} logo={match.awayLogo} textClassName="text-xs" />
              </div>
            </div>
            <span className="text-[12px] font-bold text-zinc-100 text-center line-clamp-1 w-full tracking-tight">
              {match.away}
            </span>
          </div>
        </div>

        {/* Footer Action */}
        <div className="mt-5 pt-4 border-t border-zinc-800/40 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-[#ccff00]" />
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
              {isLive ? 'Live Analysis' : 'Pre-match AI'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#ccff00] group-hover:translate-x-0.5 transition-transform">
            <span className="text-[9px] font-black uppercase tracking-widest">
              {isLive ? 'View' : 'Analyze'}
            </span>
            <Sparkles className="w-3 h-3" />
          </div>
        </div>
      </div>
    </button>
  );
};
