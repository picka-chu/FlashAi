import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
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
        
        // Use tg.close() to close the mini app as requested
        if (tg?.close) {
          // Optional: briefly show a success message or just close
          tg.close();
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
            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[1000]"
          />
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-[#0f0f0f] border-t border-white/[0.05] rounded-t-[32px] z-[1001] overflow-hidden"
          >
            <div className="px-8 pt-10 pb-12 space-y-8 relative">
              <button 
                onClick={onClose}
                className="absolute top-6 right-6 w-8 h-8 bg-white/5 rounded-full flex items-center justify-center active:scale-90 transition-all"
              >
                <X className="w-4 h-4 text-zinc-500" />
              </button>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="w-12 h-12 bg-[#ccff00]/10 rounded-2xl flex items-center justify-center mb-6">
                    <Zap className="w-6 h-6 text-[#ccff00] fill-current" />
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">Join Flash AI</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Unlock professional football analysis and real-time predictions. Share your contact to get started.
                  </p>
                </div>

                <div className="space-y-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-3 h-3 text-[#ccff00]" />
                    </div>
                    <p className="text-xs text-zinc-400">Secure Telegram-based authentication</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <Zap className="w-3 h-3 text-[#ccff00]" />
                    </div>
                    <p className="text-xs text-zinc-400">Instant access to premium insights</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-white/10 bg-white/5 transition-all checked:bg-[#ccff00]"
                      />
                      <X className="absolute h-3.5 w-3.5 text-black opacity-0 peer-checked:opacity-100 left-0.5 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      I agree to the <button type="button" onClick={() => openLegalDocument('terms')} className="text-zinc-300 hover:text-[#ccff00] transition-colors">Terms of Service</button> and <button type="button" onClick={() => openLegalDocument('privacy')} className="text-zinc-300 hover:text-[#ccff00] transition-colors">Privacy Policy</button>.
                    </p>
                  </label>

                  <button 
                    onClick={handleSignUp}
                    disabled={isSubmitting || !acceptedTerms}
                    className="w-full bg-[#ccff00] text-black font-bold text-sm py-4 rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-30 disabled:grayscale"
                  >
                    {isSubmitting ? 'Processing...' : 'Continue to Telegram'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  
                  <p className="text-[10px] text-center text-zinc-600 font-medium uppercase tracking-widest">
                    App will close to complete registration
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
