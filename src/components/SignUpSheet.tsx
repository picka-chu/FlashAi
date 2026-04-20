import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, UserPlus, Phone, ShieldCheck, Zap, ArrowRight } from 'lucide-react';
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
        tg.openTelegramLink?.(signupLink);
      } else {
        console.error("Failed to request signup");
      }
    } catch (err) {
      console.error("Sign up request error:", err);
    }
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
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000]"
          />
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-[40px] z-[1001] px-6 pt-8 pb-12 space-y-8"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="space-y-1">
                <h3 className="text-xl font-black text-white">Join the elite squad</h3>
                <p className="text-xs font-bold text-zinc-500 tracking-widest uppercase">One step to unlock everything</p>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center active:scale-90 transition-all"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Features List */}
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-zinc-800/30 border border-zinc-800/50">
                  <div className="w-10 h-10 rounded-xl bg-[#ccff00]/10 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-[#ccff00]" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">3 Free credits daily</p>
                    <p className="text-[10px] font-bold text-zinc-500">Daily reset for your first 7 days</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-zinc-800/30 border border-zinc-800/50">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">Expert Predictions</p>
                    <p className="text-[10px] font-bold text-zinc-500">Access to all high-confidence AI match analyses</p>
                  </div>
                </div>
              </div>

              {/* Bot Interaction Info */}
              <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-2xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#ccff00] flex items-center justify-center">
                   <Phone className="w-4 h-4 text-black" />
                </div>
                <p className="text-[10px] font-black text-white leading-relaxed">
                  Clicking sign up will minimize the app and ask you to share your contact in the bot chat.
                </p>
              </div>

              <button 
                onClick={handleSignUp}
                className="group relative w-full bg-[#ccff00] text-black font-black text-sm tracking-widest py-5 rounded-2xl shadow-[0_0_30px_rgba(204,255,0,0.2)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Sign up via Telegram
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>

              <p className="text-[10px] font-bold text-zinc-600 text-center px-4">
                Registration requires sharing your phone number to prevent bot abuse and ensure fair point distribution.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
