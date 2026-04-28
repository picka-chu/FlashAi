import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { X, Sparkles, Activity, Shield, Loader2 } from 'lucide-react';
import { fetchMatchH2H, getMatchDetails } from '../../services/footballService';

interface MatchPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  match: any;
  onAnalyze: (match: any) => void;
}

export const MatchPreviewModal: React.FC<MatchPreviewModalProps> = ({ 
  isOpen, 
  onClose, 
  match, 
  onAnalyze 
}) => {
  const y = useMotionValue(0);
  const [h2hData, setH2hData] = useState<any>(null);
  const [loadingH2H, setLoadingH2H] = useState(false);

  useEffect(() => {
    if (isOpen && match && match.status !== 'Live') {
      const loadH2H = async () => {
        setLoadingH2H(true);
        try {
          const details = await getMatchDetails(match.id, match);
          if (details && details.home.last5.results.length > 0) {
            const results = details.home.last5.results;
            const w = results.filter(r => r === 'W').length;
            const d = results.filter(r => r === 'D').length;
            const l = results.filter(r => r === 'L').length;
            setH2hData({
              last5: results.slice(0, 5),
              summary: `${w}W - ${d}D - ${l}L`,
              hypeScore: 85,
              hypeLevel: "HIGH"
            });
          } else {
            const data = await fetchMatchH2H(match.home, match.away);
            if (data) setH2hData(data);
          }
        } catch (e) {
          const data = await fetchMatchH2H(match.home, match.away);
          if (data) setH2hData(data);
        }
        setLoadingH2H(false);
      };
      loadH2H();
    } else {
      setH2hData(null);
    }
  }, [isOpen, match]);

  if (!match) return null;

  const isLive = match.status === 'Live';
  const stats = match.stats || {};

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110]"
          />
          
          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) onClose();
            }}
            style={{ y }}
            className="fixed bottom-0 left-0 right-0 bg-zinc-950 rounded-t-[32px] z-[120] p-5 pb-10 border-t border-zinc-800/50 shadow-2xl touch-none max-h-[85vh] overflow-y-auto no-scrollbar"
          >
            {/* Drag Handle */}
            <div className="w-10 h-1 bg-zinc-800 rounded-full mx-auto mb-6" />
            
            {/* Close Button */}
            <button 
              onClick={onClose}
              className="absolute top-5 right-5 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 active:scale-90 transition-transform"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="space-y-6">
              {/* Header Info */}
              <div className="text-center space-y-4">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.15em]">{match.league}</span>
                  {isLive && (
                    <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                      <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[9px] font-black text-red-500 uppercase">{match.minute}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-center gap-6">
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800 shadow-sm overflow-hidden">
                      {match.homeLogo ? (
                        <img src={match.homeLogo} alt={match.homeShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xl font-black text-zinc-500">{match.homeShort}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-black text-zinc-200 text-center line-clamp-1">{match.home}</span>
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    {isLive ? (
                      <span className="text-2xl font-black text-white tracking-tighter">{match.score}</span>
                    ) : (
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-black text-zinc-800">VS</span>
                        <span className="text-[9px] font-black text-zinc-500 uppercase">{match.time}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800 shadow-sm overflow-hidden">
                      {match.awayLogo ? (
                        <img src={match.awayLogo} alt={match.awayShort} className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xl font-black text-zinc-500">{match.awayShort}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-black text-zinc-200 text-center line-clamp-1">{match.away}</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Content: Live Stats or Prematch Info */}
              <div className="space-y-4">
                {isLive ? (
                  <div className="bg-zinc-900/50 rounded-[24px] p-5 border border-zinc-800/50 space-y-5">
                    <div className="flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-[#ccff00]" />
                      <h4 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Live Match Stats</h4>
                    </div>

                    {/* Possession Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[9px] font-black text-zinc-500 uppercase">
                        <span>Possession</span>
                        <div className="flex gap-3">
                          <span className="text-zinc-300">{stats.possession?.home || '50%'}</span>
                          <span className="text-zinc-300">{stats.possession?.away || '50%'}</span>
                        </div>
                      </div>
                      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-[#ccff00]" 
                          style={{ width: stats.possession?.home || '50%' }}
                        />
                        <div 
                          className="h-full bg-zinc-700" 
                          style={{ width: stats.possession?.away || '50%' }}
                        />
                      </div>
                    </div>

                    {/* xG Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[9px] font-black text-zinc-500 uppercase">
                        <span>Expected Goals (xG)</span>
                        <div className="flex gap-3">
                          <span className="text-[#ccff00]">{match.xG?.home || '0.00'}</span>
                          <span className="text-[#ccff00]">{match.xG?.away || '0.00'}</span>
                        </div>
                      </div>
                      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-[#ccff00] opacity-50" 
                          style={{ width: `${((match.xG?.home || 0) / ((match.xG?.home || 0) + (match.xG?.away || 0) || 1)) * 100}%` }}
                        />
                        <div 
                          className="h-full bg-zinc-700" 
                          style={{ width: `${((match.xG?.away || 0) / ((match.xG?.home || 0) + (match.xG?.away || 0) || 1)) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Other Stats Grid */}
                    <div className="grid grid-cols-3 gap-4 pt-2">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-base font-black text-white">{stats.shotsOnTarget?.home || '0'}-{stats.shotsOnTarget?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-600 uppercase">On Target</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-base font-black text-white">{stats.shots?.home || '0'}-{stats.shots?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-600 uppercase">Total Shots</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-base font-black text-white">{stats.corners?.home || '0'}-{stats.corners?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-600 uppercase">Corners</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-900/50 rounded-[20px] p-4 border border-zinc-800/50 space-y-3 min-h-[90px] flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3 h-3 text-blue-400" />
                        <span className="text-[8px] font-black text-zinc-500 uppercase">Head to Head</span>
                      </div>
                      {loadingH2H ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-2.5 h-2.5 text-zinc-700 animate-spin" />
                          <span className="text-[8px] font-bold text-zinc-700 uppercase">Loading...</span>
                        </div>
                      ) : h2hData ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[9px] font-bold">
                            <span className="text-zinc-600">Last 5</span>
                            <span className="text-zinc-300">{h2hData.summary}</span>
                          </div>
                          <div className="flex gap-1">
                            {h2hData.last5.map((r: string, i: number) => (
                              <div key={i} className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-black ${r === 'W' ? 'bg-green-500/10 text-green-500' : r === 'D' ? 'bg-zinc-500/10 text-zinc-500' : 'bg-red-500/10 text-red-500'}`}>
                                {r}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[8px] text-zinc-700 uppercase font-black">No data</span>
                      )}
                    </div>

                    <div className="bg-zinc-900/50 rounded-[20px] p-4 border border-zinc-800/50 space-y-3 min-h-[90px] flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3 h-3 text-[#ccff00]" />
                        <span className="text-[8px] font-black text-zinc-500 uppercase">AI Readiness</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] font-bold">
                          <span className="text-zinc-600">Confidence</span>
                          <span className="text-[#ccff00]">85%</span>
                        </div>
                        <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-[#ccff00] w-[85%]" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <button
                onClick={() => {
                  onAnalyze(match);
                  onClose();
                }}
                className="w-full bg-[#ccff00] text-black py-4 rounded-[20px] font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-2 shadow-[0_10px_20px_-10px_rgba(204,255,0,0.3)] active:scale-[0.98] transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Run AI Analysis
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
