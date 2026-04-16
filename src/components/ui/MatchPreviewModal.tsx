import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { X, Sparkles, Info, Activity, Target, Zap, Shield, TrendingUp, Users, Loader2 } from 'lucide-react';
import { fetchMatchH2H } from '../../services/geminiService';
import { getMatchDetails } from '../../services/footballService';

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
  const opacity = useTransform(y, [0, 200], [1, 0]);
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
            className="fixed bottom-0 left-0 right-0 bg-zinc-900 rounded-t-[40px] z-[120] p-6 pb-12 border-t border-zinc-800 shadow-2xl touch-none max-h-[90vh] overflow-y-auto no-scrollbar"
          >
            {/* Drag Handle */}
            <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto mb-6" />
            
            {/* Close Button */}
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 w-8 h-8 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-400 active:scale-90 transition-transform"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-6">
              {/* Header Info */}
              <div className="text-center space-y-4">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-black text-[#ccff00] uppercase tracking-[0.2em]">{match.league}</span>
                  {isLive && (
                    <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] font-black text-red-500 uppercase">{match.minute}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-center gap-4">
                  <div className="flex flex-col items-center gap-3 flex-1">
                    <div className="w-20 h-20 rounded-3xl bg-zinc-800 flex items-center justify-center border border-zinc-700 shadow-xl overflow-hidden">
                      {match.homeLogo ? (
                        <img src={match.homeLogo} alt={match.homeShort} className="w-12 h-12 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-2xl font-black text-white">{match.homeShort}</span>
                      )}
                    </div>
                    <span className="text-xs font-black text-white text-center line-clamp-1">{match.home}</span>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    {isLive ? (
                      <span className="text-3xl font-black text-white tracking-tighter italic">{match.score}</span>
                    ) : (
                      <div className="flex flex-col items-center">
                        <span className="text-2xl font-black text-zinc-700 italic">VS</span>
                        <span className="text-[10px] font-black text-zinc-500 uppercase">{match.time}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-3 flex-1">
                    <div className="w-20 h-20 rounded-3xl bg-zinc-800 flex items-center justify-center border border-zinc-700 shadow-xl overflow-hidden">
                      {match.awayLogo ? (
                        <img src={match.awayLogo} alt={match.awayShort} className="w-12 h-12 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-2xl font-black text-white">{match.awayShort}</span>
                      )}
                    </div>
                    <span className="text-xs font-black text-white text-center line-clamp-1">{match.away}</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Content: Live Stats or Prematch Info */}
              <div className="space-y-4">
                {isLive ? (
                  <div className="bg-zinc-800/30 rounded-[32px] p-6 border border-white/5 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-[#ccff00]" />
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Live Match Stats</h4>
                    </div>

                    {/* Possession Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black text-zinc-400 uppercase">
                        <span>Possession</span>
                        <div className="flex gap-4">
                          <span className="text-white">{stats.possession?.home || '50%'}</span>
                          <span className="text-white">{stats.possession?.away || '50%'}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-[#ccff00]" 
                          style={{ width: stats.possession?.home || '50%' }}
                        />
                        <div 
                          className="h-full bg-zinc-600" 
                          style={{ width: stats.possession?.away || '50%' }}
                        />
                      </div>
                    </div>

                    {/* xG Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black text-zinc-400 uppercase">
                        <span>Expected Goals (xG)</span>
                        <div className="flex gap-4">
                          <span className="text-[#ccff00]">{match.xG?.home || '0.00'}</span>
                          <span className="text-[#ccff00]">{match.xG?.away || '0.00'}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-[#ccff00] opacity-50" 
                          style={{ width: `${((match.xG?.home || 0) / ((match.xG?.home || 0) + (match.xG?.away || 0) || 1)) * 100}%` }}
                        />
                        <div 
                          className="h-full bg-zinc-600" 
                          style={{ width: `${((match.xG?.away || 0) / ((match.xG?.home || 0) + (match.xG?.away || 0) || 1)) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Other Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-lg font-black text-white">{stats.shotsOnTarget?.home || '0'}-{stats.shotsOnTarget?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-500 uppercase">Shots on Target</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-lg font-black text-white">{stats.shots?.home || '0'}-{stats.shots?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-500 uppercase">Total Shots</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-lg font-black text-white">{stats.corners?.home || '0'}-{stats.corners?.away || '0'}</span>
                        <span className="text-[8px] font-black text-zinc-500 uppercase">Corners</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-800/30 rounded-[24px] p-4 border border-white/5 space-y-3 min-h-[100px] flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-[9px] font-black text-zinc-400 uppercase">Head to Head</span>
                      </div>
                      {loadingH2H ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />
                          <span className="text-[8px] font-bold text-zinc-600 uppercase">Fetching H2H...</span>
                        </div>
                      ) : h2hData ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-zinc-500">Last 5</span>
                            <span className="text-white">{h2hData.summary}</span>
                          </div>
                          <div className="flex gap-1">
                            {h2hData.last5.map((r: string, i: number) => (
                              <div key={i} className={`w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-black ${r === 'W' ? 'bg-green-500/20 text-green-500' : r === 'D' ? 'bg-zinc-500/20 text-zinc-500' : 'bg-red-500/20 text-red-500'}`}>
                                {r}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[8px] font-bold text-zinc-600 uppercase">No H2H Data</span>
                      )}
                    </div>

                    <div className="bg-zinc-800/30 rounded-[24px] p-4 border border-white/5 space-y-3 min-h-[100px] flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-[#ccff00]" />
                        <span className="text-[9px] font-black text-zinc-400 uppercase">Match Context</span>
                      </div>
                      {match.deepContext?.injuries ? (
                        <div className="space-y-1">
                          <div className="text-xs font-black text-white">{match.deepContext.injuries.length} Injuries Reported</div>
                          <div className="flex items-center gap-1">
                            <Info className="w-3 h-3 text-zinc-500" />
                            <span className="text-[8px] font-bold text-zinc-500">Affects prediction confidence</span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-xs font-black text-white">Full Squads</div>
                          <div className="flex items-center gap-1">
                            <Info className="w-3 h-3 text-zinc-500" />
                            <span className="text-[8px] font-bold text-zinc-500">No major injuries reported</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="space-y-3">
                <button 
                  onClick={() => onAnalyze(match)}
                  className="w-full bg-[#ccff00] text-black py-5 rounded-[28px] font-black text-sm flex items-center justify-center gap-3 shadow-xl shadow-[#ccff00]/10 active:scale-[0.98] transition-all group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  <Sparkles className="w-5 h-5 relative z-10" />
                  <span className="relative z-10 tracking-widest uppercase">Unlock AI Analysis</span>
                </button>
                <p className="text-[9px] font-bold text-zinc-500 text-center uppercase tracking-tighter">
                  Powered by Gemini 2.0 Flash • Real-time Data Integration
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
