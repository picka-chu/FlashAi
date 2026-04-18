import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Skeleton } from '../components/ui/Skeleton';
import { 
  Sparkles, 
  BrainCircuit, 
  Image as ImageIcon, 
  Zap, 
  X, 
  Plus,
  History,
  Lightbulb,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ShieldAlert,
  Dices,
  Target,
  Flame,
  ChevronRight,
  UserPlus
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { searchMatches } from '../services/footballService';
import { BetSlipAnalysis, PredictionResult } from '../types/prediction';
import { useTelegram } from '../hooks/useTelegram';
import { SignUpSheet } from '../components/SignUpSheet';

export const Analyze: React.FC = () => {
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [betSlipResult, setBetSlipResult] = useState<BetSlipAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInsufficientSheet, setShowInsufficientSheet] = useState(false);
  const [creditMeta, setCreditMeta] = useState({ required: 1, current: 0 });
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadingMessages = [
    "Initializing models...",
    "Fetching historical data...",
    "Scanning lineups & injuries...",
    "Analyzing market odds...",
    "Running prediction engine...",
    "Calculating probabilities...",
    "Finalizing insights..."
  ];

  const { 
    user,
    selectedMatch, 
    isAnalyzing, 
    analysisResult, 
    setIsAnalyzing, 
    setAnalysisResult,
    setSelectedMatch,
    updateCredits
  } = useUserStore();

  const { hapticFeedback, initData, tg } = useTelegram();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAnalyzing) {
      setLoadingMessageIndex(0);
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  useEffect(() => {
    const performAnalysis = async () => {
      if (isAnalyzing && selectedMatch && !analysisResult) {
        setError(null);
        try {
          const matchString = `${selectedMatch.home} vs ${selectedMatch.away}`;
          
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'X-TG-Init-Data': initData || ''
            },
            body: JSON.stringify({ 
              matchString, 
              matchId: selectedMatch.id 
            })
          });

          const data = await response.json();

          if (!response.ok) {
            if (response.status === 402) {
              setCreditMeta({ required: Number(data.required || 1), current: Number(data.current || 0) });
              if (user?.plan === 'free') setShowInsufficientSheet(true);
              setError(`Insufficient credits. You need ${data.required} but have ${data.current}.`);
            } else if (response.status === 403) {
              setError(data.error || 'Please complete signup first.');
              setIsSignUpOpen(true);
            } else {
              setError(data.error || "Analysis failed.");
            }
            return;
          }

          setAnalysisResult(data.result);
          if (data.newCredits !== undefined) {
            updateCredits(data.newCredits);
          }
        } catch (error: any) {
          console.error("Match analysis failed:", error);
          setError("Failed to analyze match. Please try again.");
        } finally {
          setIsAnalyzing(false);
        }
      }
    };

    performAnalysis();
  }, [isAnalyzing, selectedMatch, analysisResult, setAnalysisResult, setIsAnalyzing, initData, updateCredits]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newImages = await Promise.all(
      Array.from(files as FileList).map((file: File) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.readAsDataURL(file);
        });
      })
    );
    
    setImages(prev => [...prev, ...newImages]);
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!input.trim() && images.length === 0 && !selectedMatch) return;

    if (!user?.phone) {
      hapticFeedback('medium');
      setError('Please sign up first by sharing your contact to start analysis.');
      setIsSignUpOpen(true);
      return;
    }

    // Initial check for credits
    const requiredCredits = images.length > 0 ? 3 : 1;
    if (user.credits < requiredCredits) {
      hapticFeedback('error');
      setCreditMeta({ required: requiredCredits, current: user.credits });
      if (user.plan === 'free') setShowInsufficientSheet(true);
      setError(`Minimum ${requiredCredits} credits required for this analysis. You have ${user.credits}.`);
      return;
    }
    
    setError(null);
    setIsAnalyzing(true);

    if (images.length > 0) {
      setBetSlipResult(null);
      try {
        const response = await fetch('/api/analyze-betslip', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-TG-Init-Data': initData || ''
          },
          body: JSON.stringify({ images })
        });

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 402) {
            setCreditMeta({ required: Number(data.required || 1), current: Number(data.current || 0) });
            if (user?.plan === 'free') setShowInsufficientSheet(true);
            setError(`Insufficient credits. Required: ${data.required}, Current: ${data.current}`);
          } else if (response.status === 403) {
            setError(data.error || 'Please complete signup first.');
            setIsSignUpOpen(true);
          } else {
            setError(data.error || "Analysis failed.");
          }
          return;
        }

        setBetSlipResult(data.result);
        if (data.newCredits !== undefined) {
          updateCredits(data.newCredits);
        }
      } catch (error) {
        console.error("Analysis failed:", error);
        setError("Failed to analyze bet slip. Please check image quality.");
      } finally {
        setIsAnalyzing(false);
        setImages([]);
      }
    } else if (selectedMatch) {
      // Trigger analysis for the selected match
      setAnalysisResult(null);
      setIsAnalyzing(true);
      setInput('');
    } else if (input.trim()) {
      // Search for match by name
      try {
        const matches = await searchMatches(input);
        if (matches.length > 0) {
          const match = matches[0];
          const matchObj = {
            id: match.fixture.id,
            home: match.teams.home.name,
            away: match.teams.away.name,
            homeShort: match.teams.home.name.substring(0, 3).toUpperCase(),
            awayShort: match.teams.away.name.substring(0, 3).toUpperCase(),
            homeLogo: match.teams.home.logo,
            awayLogo: match.teams.away.logo,
            score: match.goals.home !== null ? `${match.goals.home}-${match.goals.away}` : null,
            time: match.fixture.status.short === 'NS' ? new Date(match.fixture.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : match.fixture.status.short,
          };
          setSelectedMatch(matchObj);
          setAnalysisResult(null);
          setIsAnalyzing(true);
        } else {
          // No match found in API, create a fallback match object for Gemini to analyze
          const matchObj = {
            id: 'fallback',
            home: input.split('vs')[0]?.trim() || input,
            away: input.split('vs')[1]?.trim() || 'Unknown',
            homeShort: (input.split('vs')[0]?.trim() || input).substring(0, 3).toUpperCase(),
            awayShort: (input.split('vs')[1]?.trim() || 'UNK').substring(0, 3).toUpperCase(),
            score: null,
            time: 'TBD',
          };
          setSelectedMatch(matchObj);
          setAnalysisResult(null);
          setIsAnalyzing(true);
        }
      } catch (error) {
        console.error("Search failed:", error);
        setError("Search failed. Please check your connection.");
        setIsAnalyzing(false);
      } finally {
        setInput('');
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-black relative overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-4 pt-6 pb-2 z-50">
        <h1 className="text-lg font-black text-white">Analyze</h1>
        <div className="flex items-center gap-3">
          {user?.phone && (
            <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
              <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
              <span className="text-xs font-black text-white">{user?.credits}</span>
            </div>
          )}
        </div>
      </div>

      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-[#ccff00]/5 blur-[120px] pointer-events-none" />

      {/* Main Content Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-8 pb-32">
        
        <AnimatePresence mode="wait">
          {selectedMatch ? (
            <motion.div 
              key="match-analysis"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Active Match Card */}
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-[32px] p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 flex gap-2">
                  <button 
                    onClick={() => {
                      setSelectedMatch(null);
                      setAnalysisResult(null);
                      setError(null);
                    }}
                    className="p-1.5 bg-zinc-800/50 rounded-lg hover:bg-zinc-700/50 transition-colors"
                  >
                    <X className="w-3 h-3 text-zinc-400" />
                  </button>
                  <Sparkles className="w-4 h-4 text-[#ccff00]/30" />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/30 flex items-center justify-center shadow-lg mb-2 overflow-hidden">
                      {selectedMatch.homeLogo ? (
                        <img src={selectedMatch.homeLogo} alt={selectedMatch.homeShort} className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xs font-black text-white">{selectedMatch.homeShort}</span>
                      )}
                    </div>
                    <p className="text-sm font-black text-white truncate w-full text-center">{selectedMatch.home}</p>
                  </div>
                  <div className="flex flex-col items-center">
                    {selectedMatch.score ? (
                      <span className="text-xl font-black text-[#ccff00] tracking-tighter">{selectedMatch.score}</span>
                    ) : (
                      <span className="text-xs font-black text-zinc-700">VS</span>
                    )}
                    <span className="text-[8px] font-black text-zinc-500 mt-1">{selectedMatch.minute || selectedMatch.time}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/30 flex items-center justify-center shadow-lg mb-2 overflow-hidden">
                      {selectedMatch.awayLogo ? (
                        <img src={selectedMatch.awayLogo} alt={selectedMatch.awayShort} className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xs font-black text-white">{selectedMatch.awayShort}</span>
                      )}
                    </div>
                    <p className="text-sm font-black text-white truncate w-full text-center">{selectedMatch.away}</p>
                  </div>
                </div>
              </div>

              {/* Analysis Status */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-black text-zinc-500 tracking-widest flex items-center gap-2">
                    <BrainCircuit className="w-3 h-3" />
                    AI insights
                  </h3>
                  {isAnalyzing && (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 text-[#ccff00] animate-spin" />
                      <span className="text-[10px] font-black text-[#ccff00]">
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={loadingMessageIndex}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.2 }}
                          >
                            {loadingMessages[loadingMessageIndex]}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                    </div>
                  )}
                </div>

                <AnimatePresence mode="popLayout">
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3"
                    >
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <p className="text-xs font-bold text-red-500">{error}</p>
                    </motion.div>
                  )}

                  {isAnalyzing ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      {[1, 2].map(i => (
                        <div key={i} className="bg-zinc-900/40 border border-zinc-800/50 rounded-[28px] p-5 space-y-4">
                          <div className="flex justify-between items-center">
                            <Skeleton className="w-32 h-5" />
                            <Skeleton className="w-12 h-5 rounded-full" />
                          </div>
                          <Skeleton className="w-full h-16" />
                          <div className="flex justify-between items-center pt-2">
                            <Skeleton className="w-24 h-4" />
                            <Skeleton className="w-20 h-8 rounded-full" />
                          </div>
                        </div>
                      ))}
                      <div className="text-center text-[10px] font-bold text-zinc-600 h-4 relative overflow-hidden">
                        <AnimatePresence mode="wait">
                          <motion.p
                            key={loadingMessageIndex}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                            className="absolute inset-0"
                          >
                            {loadingMessages[loadingMessageIndex]}
                          </motion.p>
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ) : analysisResult ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-4"
                    >
                      {analysisResult.predictions.map((pred: any, i: number) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                          className={`p-5 rounded-[28px] border ${
                            i === 0 
                              ? 'bg-green-500/5 border-green-500/20' 
                              : 'bg-[#ccff00]/5 border-[#ccff00]/20'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              {i === 0 ? (
                                <div className="p-1.5 bg-green-500/20 rounded-lg">
                                  <ShieldCheck className="w-4 h-4 text-green-400" />
                                </div>
                              ) : (
                                <div className="p-1.5 bg-[#ccff00]/20 rounded-lg">
                                  <TrendingUp className="w-4 h-4 text-[#ccff00]" />
                                </div>
                              )}
                              <span className={`text-[10px] font-black tracking-widest ${
                                i === 0 ? 'text-green-400' : 'text-[#ccff00]'
                              }`}>
                                {i === 0 ? 'Top prediction' : 'Value pick'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full ${pred.confidence > 80 ? 'bg-green-500' : 'bg-[#ccff00]'}`} 
                                  style={{ width: `${pred.confidence}%` }} 
                                />
                              </div>
                              <span className="text-[10px] font-black text-white">{pred.confidence}%</span>
                            </div>
                          </div>
                          <div className="bg-black/20 p-4 rounded-2xl border border-white/5 mb-3">
                            <p className="text-xl font-black text-white tracking-tight">{pred.market}</p>
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed font-medium">{pred.reasoning}</p>
                          
                          <button className="w-full mt-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-black text-white transition-colors flex items-center justify-center gap-2">
                            <Flame className="w-3 h-3 text-red-500" />
                            Add to bet slip
                          </button>
                        </motion.div>
                      ))}

                      {/* Overall Reasoning Collapsible */}
                      <details className="group bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] overflow-hidden">
                        <summary className="p-5 flex items-center justify-between cursor-pointer list-none">
                          <div className="flex items-center gap-2">
                            <BrainCircuit className="w-4 h-4 text-[#ccff00]" />
                            <span className="text-sm font-black text-white">AI Match Analysis</span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-zinc-500 group-open:rotate-90 transition-transform" />
                        </summary>
                        <div className="px-5 pb-5 pt-0 border-t border-zinc-800/50 mt-2">
                          <p className="text-xs text-zinc-400 leading-relaxed pt-3">
                            {analysisResult.overallReasoning}
                          </p>
                        </div>
                      </details>

                      {/* Team Data */}
                      <div className="grid grid-cols-2 gap-3">
                        {['home', 'away'].map((side) => {
                          const team = analysisResult.teamData[side as 'home' | 'away'];
                          return (
                            <div key={side} className="bg-zinc-900/30 border border-zinc-800/50 rounded-[24px] p-4">
                              <h4 className="text-xs font-black text-white mb-2 truncate">{team.name}</h4>
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[8px] font-black text-zinc-500">Form</span>
                                  <div className="flex gap-1 mt-1">
                                    {team.form.split('').map((res: string, idx: number) => (
                                      <span key={idx} className={`w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-black ${
                                        res === 'W' ? 'bg-green-500/20 text-green-400' :
                                        res === 'D' ? 'bg-zinc-500/20 text-zinc-400' :
                                        'bg-red-500/20 text-red-400'
                                      }`}>
                                        {res}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                {team.injuries.length > 0 && (
                                  <div>
                                    <span className="text-[8px] font-black text-zinc-500">Missing</span>
                                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight line-clamp-2">
                                      {team.injuries.join(', ')}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {user?.plan === 'free' && (
                        <div className="p-6 rounded-[28px] bg-gradient-to-br from-[#ccff00]/10 to-[#88aa00]/5 border border-[#ccff00]/20 flex flex-col items-center text-center gap-4 relative overflow-hidden group">
                          <div className="absolute inset-0 bg-[#ccff00]/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                          <div className="p-3 bg-[#ccff00]/10 rounded-2xl relative z-10">
                            <Sparkles className="w-6 h-6 text-[#ccff00]" />
                          </div>
                          <div className="relative z-10">
                            <p className="text-sm font-black text-white">Unlock 3+ Premium Predictions</p>
                            <p className="text-xs font-bold text-zinc-400 mt-1.5 leading-relaxed">PRO members get access to deep statistical reasoning, sharp money movements, and high-value bets.</p>
                          </div>
                          <button className="w-full mt-2 bg-[#ccff00] text-black font-black text-xs tracking-widest py-4 rounded-xl shadow-xl shadow-[#ccff00]/10 active:scale-[0.98] transition-all relative z-10">
                            Upgrade to pro
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : betSlipResult ? (
            <motion.div 
              key="betslip-analysis"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 px-1">
                <div className="w-10 h-10 rounded-2xl bg-[#ccff00]/10 flex items-center justify-center">
                  <Dices className="w-5 h-5 text-[#ccff00]" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white">Bet slip analysis</h2>
                  <p className="text-[10px] font-bold text-zinc-500 tracking-widest">AI audit complete</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-[24px] text-center">
                  <p className="text-[10px] font-black text-zinc-500 mb-1">Total odds</p>
                  <p className="text-xl font-black text-white">{betSlipResult.totalOdds.toFixed(2)}</p>
                </div>
                <div className={`border p-4 rounded-[24px] text-center ${
                  betSlipResult.overallRisk === 'LOW' ? 'bg-green-500/5 border-green-500/20' :
                  betSlipResult.overallRisk === 'MEDIUM' ? 'bg-[#ccff00]/5 border-[#ccff00]/20' :
                  'bg-red-500/5 border-red-500/20'
                }`}>
                  <p className="text-[10px] font-black text-zinc-500 mb-1">Risk level</p>
                  <p className={`text-xl font-black ${
                    betSlipResult.overallRisk === 'LOW' ? 'text-green-400' :
                    betSlipResult.overallRisk === 'MEDIUM' ? 'text-[#ccff00]' :
                    'text-red-400'
                  }`}>{betSlipResult.overallRisk}</p>
                </div>
              </div>

              <div className="space-y-4">
                {betSlipResult.items.map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black text-white">{item.match}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-[#ccff00]/10 text-[#ccff00] text-[10px] font-black px-2 py-1 rounded-lg border border-[#ccff00]/20">
                        {item.prediction}
                      </span>
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-[#ccff00]" 
                          style={{ width: `${item.confidence}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-black text-white">{item.confidence}%</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed italic">"{item.reasoning}"</p>
                  </motion.div>
                ))}
              </div>

              <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 rounded-[32px] space-y-4">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-[#ccff00]" />
                  <h4 className="text-sm font-black text-white tracking-widest">Flash verdict</h4>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{betSlipResult.verdict}</p>
                <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-500">Suggested Stake</span>
                  <span className="bg-white text-black px-3 py-1 rounded-lg text-xs font-black">{betSlipResult.suggestedStake}</span>
                </div>
              </div>

              {betSlipResult.safePicks && betSlipResult.safePicks.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <ShieldCheck className="w-4 h-4 text-green-400" />
                    <h3 className="text-[10px] font-black text-zinc-500 tracking-widest">Safe alternatives</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {betSlipResult.safePicks.map((pick, i) => (
                      <div key={i} className="bg-green-500/5 border border-green-500/10 rounded-[24px] p-4 flex items-center justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-[10px] font-black text-green-400 mb-1">{pick.match}</p>
                          <p className="text-sm font-black text-white">{pick.pick}</p>
                          <p className="text-[10px] text-zinc-500 mt-1">{pick.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setBetSlipResult(null)}
                className="w-full py-4 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] hover:text-white transition-colors"
              >
                Clear Analysis
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="default-analyze"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="text-center space-y-3">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="inline-flex p-4 rounded-[24px] bg-gradient-to-br from-[#ccff00]/20 to-[#88aa00]/5 border border-[#ccff00]/20 shadow-xl shadow-[#ccff00]/5"
                >
                  <BrainCircuit className="w-10 h-10 text-[#ccff00]" />
                </motion.div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-black text-white tracking-tight">Flash AI analysis</h2>
                  <p className="text-xs font-bold text-zinc-500 tracking-widest">Deep match insights • Real-time data</p>
                </div>
              </div>

              {/* Info Cards */}
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Lightbulb className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">How it works</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Paste match details or upload a screenshot of odds/lineups. Our AI processes 100+ variables to predict outcomes.</p>
                  </div>
                </div>

                <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-[28px] p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">Accuracy Guarantee</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Flash AI maintains an 84% win rate on top-tier leagues. Use credits for high-confidence elite picks.</p>
                  </div>
                </div>
              </div>

              {/* Recent Prompts Placeholder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-black text-zinc-500 tracking-widest flex items-center gap-2">
                    <History className="w-3 h-3" />
                    Recent analysis
                  </h3>
                  <button className="text-[10px] font-black text-[#ccff00]">View all</button>
                </div>
                <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1">
                  {['Real vs City', 'Arsenal Win?', 'Over 2.5 Goals'].map((tag, i) => (
                    <button key={i} className="whitespace-nowrap bg-zinc-900/50 border border-zinc-800 px-4 py-2 rounded-full text-[10px] font-black text-zinc-400 hover:text-white transition-colors">
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Bottom Input Bar */}
      <div className="absolute bottom-6 left-0 right-0 px-4 z-50">
        <motion.div 
          layout
          className={`mx-auto bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/50 rounded-[32px] shadow-2xl transition-all duration-300 ${
            isFocused ? 'w-full' : 'w-[92%]'
          }`}
        >
          {/* Image Preview Area */}
          <AnimatePresence>
            {images.length > 0 && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="px-4 pt-4 overflow-hidden"
              >
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                  {images.map((img, i) => (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="relative flex-shrink-0"
                    >
                      <img 
                        src={img} 
                        alt="upload" 
                        className={`rounded-xl object-cover border border-zinc-700 ${
                          images.length === 1 ? 'w-32 h-32' : 'w-20 h-20'
                        }`}
                      />
                      <button 
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-20 h-20 rounded-xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center gap-1 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-[8px] font-black">Add</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Controls */}
          <div className="p-2 flex items-center gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              multiple 
              accept="image/*" 
              className="hidden" 
            />

            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={selectedMatch ? `Chat about ${selectedMatch.homeShort}...` : "Ask Flash AI anything..."}
                className="w-full bg-transparent border-none px-2 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>

            <button 
              onClick={handleSend}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                input.trim() || images.length > 0 
                  ? 'bg-[#ccff00] text-black shadow-lg shadow-[#ccff00]/20' 
                  : 'bg-zinc-800 text-zinc-600'
              }`}
            >
              {isAnalyzing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Zap className="w-5 h-5" />
              )}
            </button>
          </div>
        </motion.div>
      </div>

      <SignUpSheet 
        isOpen={isSignUpOpen} 
        onClose={() => setIsSignUpOpen(false)} 
      />

      <AnimatePresence>
        {showInsufficientSheet && user?.plan === 'free' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-[120]"
              onClick={() => setShowInsufficientSheet(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="fixed bottom-0 left-0 right-0 z-[121] bg-zinc-950 border-t border-zinc-800 rounded-t-[36px] p-6 space-y-4"
            >
              <h3 className="text-lg font-black text-white">Insufficient Credits</h3>
              <p className="text-sm font-bold text-zinc-400 leading-relaxed">
                You currently have <span className="text-white">{creditMeta.current}</span> credits, but this action needs <span className="text-white">{creditMeta.required}</span>. Upgrade now to continue instantly.
              </p>

              <button
                onClick={() => {
                  const upgradeUrl = `${window.location.origin}${window.location.pathname}?tab=profile`;
                  tg?.openLink?.(upgradeUrl);
                  setShowInsufficientSheet(false);
                }}
                className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-black uppercase tracking-widest text-xs"
              >
                Subscribe to continue
              </button>
              <button
                onClick={() => setShowInsufficientSheet(false)}
                className="w-full py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-black text-xs uppercase"
              >
                Close
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
