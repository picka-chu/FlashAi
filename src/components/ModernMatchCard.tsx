import React from 'react';
import { Radio, Sparkles } from 'lucide-react';

interface ModernMatchCardProps {
  match: any;
  variant: 'live' | 'prematch';
  onClick: () => void;
  compact?: boolean;
}

export const ModernMatchCard: React.FC<ModernMatchCardProps> = ({ match, variant, onClick, compact = false }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left relative overflow-hidden bg-zinc-900/40 border border-zinc-800/60 rounded-[24px] ${compact ? 'p-3.5' : 'p-4.5'} active:scale-[0.98] transition-all hover:bg-zinc-900/60`}
    >
      {/* Subtle Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(124,255,0,0.08),transparent_50%)] pointer-events-none" />

      <div className="relative z-10">
        {/* Header: League & Status */}
        <div className="flex items-center justify-between mb-3.5 gap-2">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.12em] line-clamp-1">
            {match.league}
          </span>
          {variant === 'live' ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
              <Radio className="w-2.5 h-2.5" />
              {match.minute || 'LIVE'}
            </span>
          ) : (
            <span className="text-[9px] font-black uppercase tracking-wide text-zinc-400 bg-zinc-800/50 border border-zinc-700/50 rounded-full px-2 py-0.5">
              {match.date}
            </span>
          )}
        </div>

        {/* Main Content: Teams & Score/Time */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* Home Team */}
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            <div className="w-[48px] h-[48px] rounded-xl bg-zinc-800/40 border border-zinc-700/30 p-2 flex items-center justify-center overflow-hidden shadow-sm">
              {match.homeLogo ? (
                <img src={match.homeLogo} alt={match.home} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-[10px] font-black text-zinc-500">{match.homeShort}</span>
              )}
            </div>
            <span className="text-[11px] font-bold text-zinc-200 line-clamp-1 text-center w-full">{match.home}</span>
          </div>

          {/* Center: Score or Time */}
          <div className="text-center px-1">
            {variant === 'live' ? (
              <div className="flex flex-col items-center">
                <div className="text-[24px] leading-none font-black text-[#8fff00] tracking-tight">
                  {(match.score || '0-0').replace('-', ':')}
                </div>
                <div className="text-[8px] font-black text-zinc-500 mt-1 uppercase tracking-widest">Live</div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="text-[20px] leading-none font-black text-white tracking-tight">
                  {match.time}
                </div>
                <div className="text-[8px] font-black text-zinc-600 mt-1 uppercase tracking-widest">Kickoff</div>
              </div>
            )}
          </div>

          {/* Away Team */}
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            <div className="w-[48px] h-[48px] rounded-xl bg-zinc-800/40 border border-zinc-700/30 p-2 flex items-center justify-center overflow-hidden shadow-sm">
              {match.awayLogo ? (
                <img src={match.awayLogo} alt={match.away} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-[10px] font-black text-zinc-500">{match.awayShort}</span>
              )}
            </div>
            <span className="text-[11px] font-bold text-zinc-200 line-clamp-1 text-center w-full">{match.away}</span>
          </div>
        </div>

        {/* Footer: Action Hint */}
        <div className="mt-3.5 pt-2.5 border-t border-zinc-800/40 flex items-center justify-between">
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
            {variant === 'live' ? 'Live Preview' : 'Pre-match Analysis'}
          </span>
          <div className="flex items-center gap-1 text-[#ccff00] opacity-80">
            <Sparkles className="w-2.5 h-2.5" />
            <span className="text-[9px] font-black uppercase tracking-widest">AI Ready</span>
          </div>
        </div>
      </div>
    </button>
  );
};
