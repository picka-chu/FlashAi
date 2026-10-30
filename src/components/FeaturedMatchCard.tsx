import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, Flame, Star } from 'lucide-react';
import { TeamLogo } from './TeamLogo';

interface FeaturedMatchCardProps {
  match: any;
  onClick: () => void;
  eyebrow?: string;
  badge?: string;
  showHot?: boolean;
}

export const FeaturedMatchCard: React.FC<FeaturedMatchCardProps> = ({
  match,
  onClick,
  eyebrow = 'Featured match',
  badge = 'Top pick',
  showHot = true,
}) => {
  if (!match) return null;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-black tracking-[0.2em] text-zinc-400 uppercase flex items-center gap-2">
          <Star className="w-3.5 h-3.5 text-[#ccff00] fill-[#ccff00]" />
          {eyebrow}
        </h3>
        <div className="flex items-center gap-2">
          {showHot && (
            <div className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-1">
              <Flame className="w-3 h-3 text-red-500" />
              <span className="text-[9px] font-black text-red-500 uppercase">Hot</span>
            </div>
          )}
          <div className="px-2 py-0.5 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20">
            <span className="text-[9px] font-black text-[#ccff00] uppercase">{badge}</span>
          </div>
        </div>
      </div>
      
      <motion.div 
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className="relative overflow-hidden rounded-[32px] bg-[#111218] border border-zinc-800/90 p-6 group cursor-pointer shadow-2xl"
      >
        {/* Unique Background Elements */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(204,255,0,0.12),transparent_60%)]" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-[#ccff00]/5 rounded-full blur-[80px]" />
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] pointer-events-none" />

        <div className="relative z-10">
          {/* League Info */}
          <div className="flex justify-center mb-6">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] bg-zinc-900/80 border border-zinc-800 px-3 py-1 rounded-full">
              {match.league}
            </span>
          </div>

          {/* Teams and Time Grid */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            {/* Home Team */}
            <div className="flex flex-col items-center gap-3 min-w-0">
              <div className="relative group-hover:scale-105 transition-transform duration-300">
                <div className="absolute inset-0 bg-[#ccff00]/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-[76px] h-[76px] rounded-full bg-zinc-900 border border-zinc-800 p-1.5 relative z-10 flex items-center justify-center shadow-inner ring-2 ring-[#ccff00]/15">
                  <TeamLogo name={match.home} logo={match.homeLogo} textClassName="text-lg" />
                </div>
              </div>
              <span className="text-sm font-black text-white text-center line-clamp-2 w-full leading-tight">{match.home}</span>
            </div>

            {/* Center Info */}
            <div className="flex flex-col items-center justify-center px-2">
              {match.status === 'Live' ? (
                <div className="flex flex-col items-center">
                  <div className="text-[36px] leading-none font-black text-white tracking-tighter flex items-center gap-2">
                    <span className={match.goals?.home > match.goals?.away ? 'text-[#ccff00]' : 'text-white'}>
                      {match.score?.split('-')[0] || '0'}
                    </span>
                    <span className="text-zinc-800">:</span>
                    <span className={match.goals?.away > match.goals?.home ? 'text-[#ccff00]' : 'text-white'}>
                      {match.score?.split('-')[1] || '0'}
                    </span>
                  </div>
                  <div className="mt-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[9px] font-black text-red-500 uppercase tracking-widest">{match.minute || 'LIVE'}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-[32px] leading-none font-black text-white tracking-tighter mb-1.5">
                    {match.time}
                  </div>
                  <div className="h-px w-8 bg-zinc-800 mb-1.5" />
                  <div className="text-[10px] font-black text-[#ccff00] uppercase tracking-[0.2em]">
                    {match.date}
                  </div>
                </>
              )}
            </div>

            {/* Away Team */}
            <div className="flex flex-col items-center gap-3 min-w-0">
              <div className="relative group-hover:scale-105 transition-transform duration-300">
                <div className="absolute inset-0 bg-[#ccff00]/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-[76px] h-[76px] rounded-full bg-zinc-900 border border-zinc-800 p-1.5 relative z-10 flex items-center justify-center shadow-inner ring-2 ring-[#ccff00]/15">
                  <TeamLogo name={match.away} logo={match.awayLogo} textClassName="text-lg" />
                </div>
              </div>
              <span className="text-sm font-black text-white text-center line-clamp-2 w-full leading-tight">{match.away}</span>
            </div>
          </div>

          {/* Footer Action */}
          <div className="mt-8 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] animate-pulse" />
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">AI Analysis Ready</span>
            </div>
            <div className="flex items-center gap-2 bg-[#ccff00] text-black px-4 py-2 rounded-xl font-black transition-all hover:shadow-[0_0_20px_rgba(204,255,0,0.3)] active:scale-95">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-widest">Analyze</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
