import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, Zap, ArrowRight, Sparkles, MessageSquare, FileText } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';

interface SignUpSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SignUpSheet: React.FC<SignUpSheetProps> = ({ isOpen, onClose }) => {
  const { tg, hapticFeedback, initData } = useTelegram();

  const handleSignUp = async () => {
    hapticFeedback('medium');
    
    if (!tg?.initDataUnsafe?.user?.id) {
       console.error("No Telegram user ID found");
       return;
    }

    try {
      const response = await fetch('/api/auth/request-signup', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData
        },
        body: JSON.stringify({ telegramId: tg.initDataUnsafe.user.id })
      });

      if (response.ok) {
        onClose();
        const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'Deepflashaibot').replace('@', '');
        const signupLink = `https://t.me/${botUsername}?start=signup`;
        // Minimize the mini app before opening the bot link
        tg.close();
        setTimeout(() => {
          tg.openTelegramLink?.(signupLink);
        }, 300);
      } else {
        console.error("Failed to request signup");
      }
    } catch (err) {
      console.error("Sign up request error:", err);
    }
  };

  const openLegalDocument = (type: 'privacy' | 'terms') => {
    hapticFeedback('light');
    const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'FlashAiBot').replace('@', '');
    tg?.openTelegramLink?.(`https://t.me/${botUsername}`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000]"
          />
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800/50 rounded-t-[40px] z-[1001] overflow-hidden"
          >
            {/* Top Glow Ornament */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-[#ccff00] rounded-full opacity-20 blur-sm" />
            
            <div className="px-6 pt-10 pb-12 space-y-8 relative">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20 mb-1">
                    <Sparkles className="w-3 h-3 text-[#ccff00]" />
                    <span className="text-[10px] font-black text-[#ccff00] uppercase tracking-widest">Early Access</span>
                  </div>
                  <h3 className="text-2xl font-black text-white leading-tight">Join the elite squad</h3>
                  <p className="text-xs font-bold text-zinc-500 tracking-wide">Unlock the full power of Flash AI</p>
                </div>
                <button 
                  onClick={onClose}
                  className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center active:scale-90 transition-all"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Features List */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-center gap-4 p-5 rounded-[28px] bg-zinc-900/50 border border-zinc-800/50 group transition-all hover:border-[#ccff00]/30">
                    <div className="w-12 h-12 rounded-2xl bg-[#ccff00]/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <Zap className="w-6 h-6 text-[#ccff00]" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">Free Daily Credits</p>
                      <p className="text-[11px] font-bold text-zinc-500 leading-snug">Get bonus points every single day for match analysis</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 p-5 rounded-[28px] bg-zinc-900/50 border border-zinc-800/50 group transition-all hover:border-blue-500/30">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <ShieldCheck className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">Expert Predictions</p>
                      <p className="text-[11px] font-bold text-zinc-500 leading-snug">Access high-confidence AI match insights & data</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-5 rounded-[28px] bg-zinc-900/50 border border-zinc-800/50 group transition-all hover:border-purple-500/30">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <MessageSquare className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">AI Assistant</p>
                      <p className="text-[11px] font-bold text-zinc-500 leading-snug">Chat with our bot for deep-dive football analytics</p>
                    </div>
                  </div>
                </div>

                {/* Bot Interaction Info */}
                <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-[24px] p-4 text-center">
                  <p className="text-[11px] font-bold text-zinc-400 leading-relaxed">
                    Registration requires sharing your <span className="text-[#ccff00]">phone number</span> via Telegram to prevent abuse and ensure fair credit distribution.
                  </p>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleSignUp}
                    className="group relative w-full bg-[#ccff00] text-black font-black text-sm tracking-[0.1em] py-5 rounded-[24px] shadow-[0_10px_30px_rgba(204,255,0,0.2)] active:scale-[0.98] transition-all flex items-center justify-center gap-3 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                    SIGN UP VIA TELEGRAM
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <p className="text-[10px] font-bold text-zinc-600 text-center mt-4 tracking-tight uppercase">
                    One-tap registration • Secure & Private
                  </p>
                  
                  {/* Legal Links */}
                  <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-zinc-800">
                    <button 
                      onClick={() => openLegalDocument('privacy')}
                      className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 hover:text-[#ccff00] transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      Privacy Policy
                    </button>
                    <span className="text-zinc-700">•</span>
                    <button 
                      onClick={() => openLegalDocument('terms')}
                      className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 hover:text-[#ccff00] transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      Terms of Service
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
