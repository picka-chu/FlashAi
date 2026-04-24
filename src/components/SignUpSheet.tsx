import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowRight, FileText } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';

interface SignUpSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onRegistered?: () => Promise<void> | void;
}

export const SignUpSheet: React.FC<SignUpSheetProps> = ({ isOpen, onClose }) => {
  const { tg, hapticFeedback, initData, showAlert } = useTelegram();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const handleSignUp = async () => {
    if (isSubmitting) return;
    if (!acceptedTerms) {
      showAlert('Please accept Terms and Privacy Policy to continue.');
      return;
    }
    hapticFeedback('medium');
    
    if (!tg?.initDataUnsafe?.user?.id) {
       console.error("No Telegram user ID found");
       return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch('/api/auth/request-signup', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData
        },
        body: JSON.stringify({ telegramId: tg.initDataUnsafe.user.id })
      });

      if (response.ok) {
        const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'Deepflashaibot').replace('@', '');
        const signupLink = `https://t.me/${botUsername}`;
        onClose();
        // Open signup bot and close mini app so the user can share contact from bot keyboard.
        if (tg?.openTelegramLink) {
          tg.openTelegramLink(signupLink);
          tg.close?.();
        } else {
          window.location.href = signupLink;
        }
      } else {
        console.error("Failed to request signup");
        showAlert('Unable to start signup. Please try again.');
      }
    } catch (err) {
      console.error("Sign up request error:", err);
      showAlert('Signup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
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
            <div className="px-6 pt-8 pb-10 space-y-6 relative">
              <button 
                onClick={onClose}
                className="absolute top-6 right-6 w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center active:scale-90 transition-all"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>

              <div className="space-y-5">
                <div className="space-y-2 text-center pt-6">
                  <p className="text-[10px] font-black text-[#ccff00] uppercase tracking-[0.2em]">Get Started</p>
                  <h3 className="text-3xl font-black text-white leading-tight">Create Your Flash AI Account</h3>
                  <p className="text-xs font-bold text-zinc-500 leading-relaxed">
                    Continue in Telegram, share your contact once, and activate your account securely.
                  </p>
                </div>

                <label className="flex items-start gap-3 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    style={{ accentColor: '#ccff00' }}
                    className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 focus:ring-[#ccff00]/40"
                  />
                  <p className="text-[11px] font-bold text-zinc-400 leading-relaxed">
                    I agree with <button type="button" onClick={() => openLegalDocument('terms')} className="text-[#ccff00] underline">Terms</button> and <button type="button" onClick={() => openLegalDocument('privacy')} className="text-[#ccff00] underline">Privacy Policy</button>.
                  </p>
                </label>

                <div>
                  <button 
                    onClick={handleSignUp}
                    disabled={isSubmitting || !acceptedTerms}
                    className="group relative w-full bg-[#ccff00] text-black font-black text-sm tracking-[0.1em] py-5 rounded-[20px] shadow-[0_10px_30px_rgba(204,255,0,0.2)] active:scale-[0.98] transition-all flex items-center justify-center gap-3 overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                    CONTINUE
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <FileText className="w-3.5 h-3.5 text-zinc-600" />
                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                      Mini app will close and open bot contact step
                    </p>
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
