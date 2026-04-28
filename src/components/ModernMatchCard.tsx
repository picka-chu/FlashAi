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
      className={`w-full text-left relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800/90 rounded-[26px] ${compact ? 'p-4' : 'p-5'} active:scale-[0.985] transition-all`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(124,255,0,0.14),transparent_56%)] pointer-events-none" />
      <div className="absolute -bottom-10 -right-10 w-28 h-28 rounded-full bg-[#ccff00]/10 blur-2xl pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4 gap-2">
          <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.16em] line-clamp-1">{match.league}</span>
          {variant === 'live' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-1">
              <Radio className="w-3 h-3" />
              {match.minute || 'LIVE'}
            </span>
          ) : (
            <span className="text-[10px] font-black uppercase tracking-wide text-zinc-300 bg-zinc-800/80 border border-zinc-700 rounded-full px-2 py-1">{match.date}</span>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2.5">
          {[
            { name: match.home, short: match.homeShort, logo: match.homeLogo },
            { name: match.away, short: match.awayShort, logo: match.awayLogo },
          ].map((team, index) => (
            <div key={index} className="flex flex-col items-center gap-1.5 min-w-0">
              <div className="w-[58px] h-[58px] rounded-2xl bg-zinc-800/80 border border-zinc-700 p-2.5 flex items-center justify-center overflow-hidden">
                {team.logo ? (
                  <img src={team.logo} alt={team.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-sm font-black text-white">{team.short}</span>
                )}
              </div>
              <span className="text-sm font-extrabold text-zinc-100 line-clamp-1 text-center w-full">{team.name}</span>
            </div>
          ))}

          <div className="text-center pb-1">
            {variant === 'live' ? (
              <>
                <div className="text-[36px] leading-none font-black text-[#8fff00]">{(match.score || '0-0').replace('-', ':')}</div>
                <div className="text-[10px] font-bold text-zinc-400 mt-1 uppercase tracking-wide">Live score</div>
              </>
            ) : (
              <>
                <div className="text-[32px] leading-none font-black text-white tracking-tight">{match.time}</div>
                <div className="text-[10px] font-bold text-zinc-500 mt-1 uppercase tracking-wide">Kickoff</div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[10px] font-bold text-zinc-400">
          <span>{variant === 'live' ? 'Open full live preview' : 'Run pre-match analysis'}</span>
          <span className="inline-flex items-center gap-1 text-[#ccff00]"><Sparkles className="w-3 h-3" />AI Ready</span>
        </div>
      </div>
    </button>
  );
};
