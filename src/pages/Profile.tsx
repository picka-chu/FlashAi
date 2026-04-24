import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TonConnectButton, useTonConnectUI } from '@tonconnect/ui-react';
import { 
  CreditCard, 
  Share2, 
  Headset, 
  FileText, 
  ChevronRight,
  Pencil,
  Camera,
  ArrowLeft,
  Check,
  Zap,
  ShieldCheck,
  Crown,
  Star,
  Copy,
  Users,
  Coins,
  ExternalLink,
  MessageSquare,
  Gift,
  Trophy,
  Send,
  Info,
  AlertCircle,
  Loader2,
  Wallet,
  X,
  CreditCard as StarsIcon,
  User,
  UserPlus
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { useTelegram } from '../hooks/useTelegram';
import { supportService, FAQ } from '../services/supportService';
import { SignUpSheet } from '../components/SignUpSheet';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    usdPrice: 0,
    price: '$0',
    period: 'forever',
    icon: Zap,
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-900',
    features: ['3 Daily credits', '1 Bet slip analysis', 'No AI chat after analysis']
  },
  {
    id: 'monthly_basic',
    name: 'Monthly Basic',
    usdPrice: 8.99,
    price: '$8.99',
    period: 'per month',
    icon: ShieldCheck,
    color: 'text-[#ccff00]',
    bgColor: 'bg-[#ccff00]/10',
    features: ['10 Daily credits', '2 Bet slip analysis/day', 'Flash AI Lite (Gemini Flash)', '1 Bundle (1 Safe + 1 Value Bet)', 'AI chat after analysis'],
    popular: true,
    aiModel: 'gemini-flash'
  },
  {
    id: 'monthly_pro',
    name: 'Monthly Pro',
    usdPrice: 14.99,
    price: '$14.99',
    period: 'per month',
    icon: Crown,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    features: ['16 Daily credits', '6 Bet slip analysis/day', 'Flash AI Pro (advanced reasoning tier)', '1 Bundle (2 Safe + 2 Value Bets)', '1-2 Top Pick Accumulator/day', 'Unlimited AI chat'],
    aiModel: 'gemini-pro'
  }
];

const USD_TO_STARS_RATE = 50; // 1 USD ≈ 50 Telegram Stars
const DEFAULT_USD_TO_TON_RATE = Number(import.meta.env.VITE_USD_TO_TON_RATE || 0.23);

const getPriceInStars = (usdPrice: number) => Math.ceil(usdPrice * USD_TO_STARS_RATE);
const getPriceInTon = (usdPrice: number, usdToTonRate: number) => Number((usdPrice * usdToTonRate).toFixed(2));


export const Profile: React.FC = () => {
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const { user, setUser } = useUserStore();
  const { tg, hapticFeedback, showAlert, showConfirm, initData } = useTelegram();
  const [isEditing, setIsEditing] = useState(false);
  const [isViewingSubscriptions, setIsViewingSubscriptions] = useState(false);
  const [isViewingReferral, setIsViewingReferral] = useState(false);
  const [isViewingSupport, setIsViewingSupport] = useState(false);
  const [isReportingIssue, setIsReportingIssue] = useState(false);
  const [referralTab, setReferralTab] = useState<'referral' | 'earn'>('referral');
  const [supportTab, setSupportTab] = useState<'chat' | 'faq'>('chat');
  const [editName, setEditName] = useState(user?.name || 'Alex Volkov');
  const [editUsername, setEditUsername] = useState(user?.username || 'alex_v');
  const [editPhotoUrl, setEditPhotoUrl] = useState(user?.photo_url || '');
  const [tonConnectUI] = useTonConnectUI();
  const [dynamicTasks, setDynamicTasks] = useState<any[]>([]);
  const [referralStats, setReferralStats] = useState<{ totalReferred: number; earnedCredits: number; referralLink: string }>({
    totalReferred: 0,
    earnedCredits: 0,
    referralLink: '',
  });

  useEffect(() => {
     fetch('/api/common/tasks')
       .then(r => r.json())
       .then(data => {
          if (data && data.length > 0) setDynamicTasks(data);
       })
       .catch(err => console.error("Failed to fetch tasks:", err));
  }, []);

  useEffect(() => {
    if (!isViewingReferral) return;
    fetch('/api/user/referral', { headers: { 'X-TG-Init-Data': initData || '' } })
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setReferralStats({
          totalReferred: Number(data.totalReferred || 0),
          earnedCredits: Number(data.earnedCredits || 0),
          referralLink: data.referralLink || '',
        });
      })
      .catch((err) => console.error("Failed to fetch referral stats:", err));
  }, [isViewingReferral, initData]);

  // Payment State
  const [isViewingPaymentMethods, setIsViewingPaymentMethods] = useState(false);
  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState<any>(null);
  const [usdToTonRate, setUsdToTonRate] = useState(DEFAULT_USD_TO_TON_RATE);

  // Support Chat State
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', parts: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [reportCategory, setReportCategory] = useState('general');
  const [reportSubject, setReportSubject] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isViewingLegal, setIsViewingLegal] = useState(false);
  const [legalContent, setLegalContent] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState<{ isLoading: boolean; title: string; detail: string }>({
    isLoading: false,
    title: '',
    detail: '',
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditName(user?.name || '');
    setEditUsername(user?.username || '');
    setEditPhotoUrl(user?.photo_url || '');
  }, [user?.name, user?.username, user?.photo_url]);

  useEffect(() => {
    if (isViewingSupport) {
      supportService.getFAQs().then(setFaqs);
    }
  }, [isViewingSupport]);

  useEffect(() => {
    fetch('/api/config/rates')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const tonUsd = Number(data?.tonUsd || 0);
        if (tonUsd > 0) {
          setUsdToTonRate(1 / tonUsd);
        }
      })
      .catch(() => {
        // Keep fallback rate.
      });
  }, []);

  useEffect(() => {
    if (!isViewingLegal) return;
    fetch('/api/legal/terms')
      .then((r) => r.ok ? r.text() : '')
      .then((txt) => setLegalContent(txt))
      .catch(() => setLegalContent('Terms are temporarily unavailable.'));
  }, [isViewingLegal]);

  useEffect(() => {
    if (!user?.telegram_id || !tonConnectUI.connected || !tonConnectUI.account?.address) return;

    const storageKey = 'flashai_ton_wallet_owner';
    const currentOwner = localStorage.getItem(storageKey);
    const nextOwner = String(user.telegram_id);

    if (currentOwner && currentOwner !== nextOwner) {
      tonConnectUI.disconnect().catch((err) => {
        console.warn('Failed to disconnect stale wallet session:', err);
      }).finally(() => {
        localStorage.setItem(storageKey, nextOwner);
      });
      return;
    }

    localStorage.setItem(storageKey, nextOwner);
  }, [user?.telegram_id, tonConnectUI, tonConnectUI.connected, tonConnectUI.account?.address]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (tg?.BackButton) {
      if (isEditing || isViewingSubscriptions || isViewingReferral || isViewingSupport || isViewingPaymentMethods || isReportingIssue || isViewingLegal) {
        tg.BackButton.show();
        const handleBack = () => {
          if (isViewingPaymentMethods) {
            setIsViewingPaymentMethods(false);
          } else if (isViewingLegal) {
            setIsViewingLegal(false);
          } else if (isReportingIssue) {
            setIsReportingIssue(false);
          } else {
            setIsEditing(false);
            setIsViewingSubscriptions(false);
            setIsViewingReferral(false);
            setIsViewingSupport(false);
          }
        };
        tg.BackButton.onClick(handleBack);
        return () => {
          tg.BackButton.offClick(handleBack);
          tg.BackButton.hide();
        };
      } else {
        tg.BackButton.hide();
      }
    }
  }, [isEditing, isViewingSubscriptions, isViewingReferral, isViewingSupport, isViewingPaymentMethods, isReportingIssue, isViewingLegal, tg]);

  const refreshAuthedProfile = async () => {
    const effectiveInitData = initData || (window as any)?.Telegram?.WebApp?.initData || '';
    if (!effectiveInitData) return;
    const res = await fetch('/api/auth/me', { headers: { 'X-TG-Init-Data': effectiveInitData } });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.user || !user) return;
    setUser({
      ...user,
      ...payload.user,
      role: payload.user.role || user.role,
      plan: payload.user.plan || user.plan,
      credits: Number(payload.user.credits ?? user.credits),
    });
  };

  const submitReport = async () => {
    if (!reportSubject.trim() || !reportDetails.trim()) {
      showAlert('Please fill in both subject and details.');
      return;
    }
    setIsSubmittingReport(true);
    try {
      const res = await fetch('/api/user/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData || '',
        },
        body: JSON.stringify({
          category: reportCategory,
          subject: reportSubject,
          details: reportDetails,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || 'Failed to submit report.');
        return;
      }
      setReportSubject('');
      setReportDetails('');
      setReportCategory('general');
      setIsReportingIssue(false);
      showAlert('Report submitted successfully. Admin has been notified.');
    } catch (error) {
      showAlert('Failed to submit report. Please try again.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleAction = (name: string) => {
    hapticFeedback('light');

    if (!user?.phone && name !== 'Support') {
       hapticFeedback('medium');
       setIsSignUpOpen(true);
       return;
    }

    if (name === 'Subscription') {
      setIsViewingSubscriptions(true);
    } else if (name === 'Referral') {
      setIsViewingReferral(true);
    } else if (name === 'Support') {
      setIsViewingSupport(true);
    } else if (name === 'Terms') {
      setIsViewingLegal(true);
    } else {
      showAlert(`${name} feature coming soon!`);
    }
  };

  const handleSaveProfile = async () => {
    hapticFeedback('success');
    if (!user) return;
    if (!editName.trim()) {
      showAlert('Name is required.');
      return;
    }

    try {
      setIsSavingProfile(true);
      const effectiveInitData = initData || (window as any)?.Telegram?.WebApp?.initData || '';
      if (!effectiveInitData && !user?.telegram_id) {
        showAlert('Unable to verify your account. Please reopen the app from Telegram.');
        return;
      }
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TG-Init-Data': effectiveInitData
        },
        body: JSON.stringify({
          telegramId: user.telegram_id,
          name: editName.trim(),
          username: editUsername.trim(),
          photo_url: editPhotoUrl || null,
        })
      });

      const data = await response.json();
      if (!response.ok) {
        showAlert(data.error || 'Failed to save profile.');
        return;
      }

      setUser({
        ...user,
        name: data?.user?.name || editName,
        username: data?.user?.username || editUsername,
        photo_url: data?.user?.photo_url || editPhotoUrl || user.photo_url,
      });
      await refreshAuthedProfile();
      setIsEditing(false);
      hapticFeedback('success');
      showAlert('Profile updated successfully!');
    } catch (e) {
      console.error('Save profile error:', e);
      showAlert('Failed to save profile. Please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpgrade = (plan: any) => {
    hapticFeedback('medium');
    setSelectedPlanForPayment(plan);
    setIsViewingSubscriptions(false);
    setIsViewingPaymentMethods(true);
  };

  const handleTonPayment = async () => {
    hapticFeedback('medium');
    if (!selectedPlanForPayment || !user) return;
    const tonPrice = getPriceInTon(Number(selectedPlanForPayment.usdPrice || 0), usdToTonRate);
    const tonReceiver = import.meta.env.VITE_TON_RECEIVER_ADDRESS || '';
    if (!tonReceiver) {
      showAlert('TON payments are temporarily unavailable. Missing receiver configuration.');
      return;
    }
    
    if (!tonConnectUI.connected) {
      setPaymentProcessing({
        isLoading: true,
        title: 'Connecting wallet',
        detail: 'Please connect your TON wallet to continue.',
      });
      await tonConnectUI.openModal().finally(() =>
        setPaymentProcessing({ isLoading: false, title: '', detail: '' })
      );
      return;
    }

    try {
      setPaymentProcessing({
        isLoading: true,
        title: 'Processing TON payment',
        detail: 'Sending transaction and verifying on-chain...',
      });
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 60, // 60 sec
        messages: [
          {
            address: tonReceiver,
            amount: (tonPrice * 1e9).toString(), // nanoTON
            payload: btoa(`plan:${selectedPlanForPayment.id}:user:${user.telegram_id}`) // Memo for tracking
          },
        ],
      };

      const result = await tonConnectUI.sendTransaction(transaction);
      
      // Verify with backend
      const verifyRes = await fetch('/api/payments/verify-ton-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData || (window as any)?.Telegram?.WebApp?.initData || ''
        },
        body: JSON.stringify({
          telegramId: user.telegram_id,
          planId: selectedPlanForPayment.id,
          boc: result.boc,
          amount: tonPrice
        })
      });

      if (verifyRes.ok) {
        hapticFeedback('success');
        await refreshAuthedProfile();
        showAlert(`Congratulations! You have successfully upgraded to ${selectedPlanForPayment.name}.`);
      } else {
        const verifyData = await verifyRes.json().catch(() => ({}));
        throw new Error(verifyData.error || 'Verification failed');
      }
    } catch (e: any) {
      console.error('TON Payment error:', e);
      showAlert(`TON payment failed: ${e?.message || 'Canceled or failed.'}`);
    } finally {
      setPaymentProcessing({ isLoading: false, title: '', detail: '' });
    }
  };

  const handleStarsPayment = async () => {
    hapticFeedback('medium');
    if (!selectedPlanForPayment || !user) return;
    const starsPrice = getPriceInStars(Number(selectedPlanForPayment.usdPrice || 0));
    
    if (!tg || !user) {
      showAlert('Telegram environment or user not detected.');
      return;
    }

    try {
      setPaymentProcessing({
        isLoading: true,
        title: 'Preparing Stars invoice',
        detail: `Creating invoice for ${starsPrice} Stars...`,
      });
      
      const response = await fetch('/api/payments/create-stars-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData
        },
        body: JSON.stringify({
          telegramId: user.telegram_id,
          planId: selectedPlanForPayment.id,
          amount: starsPrice,
          title: `Flash AI - ${selectedPlanForPayment.name} Plan`,
          description: `Unlock premium football predictions with ${selectedPlanForPayment.id === 'monthly_basic' ? 'Flash AI Lite' : 'Flash AI Pro'} for 1 month.`
        }),
      });

      const data = await response.json();

      if (data.invoiceLink) {
        setPaymentProcessing({
          isLoading: true,
          title: 'Waiting for payment',
          detail: 'Complete payment in Telegram to continue.',
        });
        tg.openInvoice(data.invoiceLink, (status) => {
          setPaymentProcessing({ isLoading: false, title: '', detail: '' });
          if (status === 'paid') {
            hapticFeedback('success');
            showAlert(`Congratulations! You have successfully upgraded to ${selectedPlanForPayment.name}`);
            refreshAuthedProfile();
          } else if (status === 'cancelled') {
            showAlert('Payment cancelled.');
          } else {
            showAlert('Payment failed or pending.');
          }
        });
      } else {
        throw new Error(data.error || 'Failed to create invoice link');
      }
    } catch (e: any) {
      console.error('Stars Payment error:', e);
      showAlert('Failed to initiate Stars payment: ' + (e.message || 'Unknown error'));
    } finally {
      setPaymentProcessing({ isLoading: false, title: '', detail: '' });
    }
  };

  const handleLemonSqueezyPayment = async () => {
    hapticFeedback('medium');
    if (!selectedPlanForPayment || !user) return;

    try {
      setPaymentProcessing({
        isLoading: true,
        title: 'Creating secure checkout',
        detail: 'Please wait while we redirect you...',
      });
      // Get Lemon Squeezy checkout URL from backend
      const response = await fetch('/api/payments/create-lemonsqueezy-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData || ''
        },
        body: JSON.stringify({
          telegramId: user.telegram_id,
          planId: selectedPlanForPayment.id,
          planName: selectedPlanForPayment.name,
          price: selectedPlanForPayment.price,
        }),
      });

      const data = await response.json();

      if (data.checkoutUrl) {
        // Open Lemon Squeezy checkout in browser/webview
        window.open(data.checkoutUrl, '_blank');
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (e: any) {
      console.error('Lemon Squeezy Payment error:', e);
      showAlert('Failed to initiate payment: ' + (e.message || 'Unknown error'));
    } finally {
      setPaymentProcessing({ isLoading: false, title: '', detail: '' });
    }
  };

  const copyReferralLink = async () => {
    const fallbackRefId = user?.telegram_id || user?.id;
    let link = referralStats.referralLink || '';
    if (!link && initData) {
      try {
        const res = await fetch('/api/user/referral', { headers: { 'X-TG-Init-Data': initData } });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.referralLink) {
          link = data.referralLink;
          setReferralStats(prev => ({ ...prev, referralLink: data.referralLink }));
        }
      } catch {}
    }
    if (!link && fallbackRefId) {
      link = `https://t.me/Deepflashaibot?start=${fallbackRefId}`;
    }
    if (!link) {
      showAlert('Referral link is not ready yet.');
      return;
    }
    
    hapticFeedback('success');
    
    // Use Telegram's native way if possible, or fallback to navigator
    try {
      if (tg?.ready) {
        // Use Telegram WebApp API to copy to clipboard if available
        // Some versions of Telegram support this via a specific method or just standard API
        // But for reliability in TMA, we try both
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(link);
          showAlert('Referral link copied to clipboard!');
          hapticFeedback('success');
          return;
        }
      }

      // Fallback for all environments
      const textArea = document.createElement('textarea');
      textArea.value = link;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        showAlert('Referral link copied to clipboard!');
        hapticFeedback('success');
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (err) {
      console.error('Copy failed:', err);
      // Final fallback: try to use Telegram's share if copy fails
      if (tg?.openTelegramLink) {
        showAlert('Copy failed. Opening share menu...');
        shareReferralLink();
      } else {
        showAlert('Copy failed. Please copy manually.');
      }
    }
  };

  const shareReferralLink = () => {
    const fallbackRefId = user?.telegram_id || user?.id;
    const link = referralStats.referralLink || `https://t.me/Deepflashaibot?start=${fallbackRefId}`;
    const text = `Join Flash AI and get high-confidence football predictions! 🚀⚽️`;
    
    hapticFeedback('medium');
    
    if (tg?.shareToStory) {
      // If we want to share to story, but user asked for forwarding
    }
    
    // Telegram's way to share/forward link
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
  };

  const handleTaskAction = async (task: any) => {
    hapticFeedback('medium');
    
    // First, open the URL if it exists
    if (task.url !== '#') {
      tg?.openTelegramLink?.(task.url) || window.open(task.url, '_blank');
      
      // Give a small delay before showing claim prompt
      setTimeout(() => {
        showConfirm(`Did you complete the task "${task.title}"?`, async (ok) => {
          if (ok) {
            await claimTaskReward(task);
          }
        });
      }, 2000);
    } else {
      await claimTaskReward(task);
    }
  };

  const claimTaskReward = async (task: any) => {
    if (!user) return;
    
    // Create an immersive verification experience
    const loadingToast = showAlert(`Verifying completion: ${task.title}...`, { 
      // Some UI libraries allow non-blocking or persistent alerts, 
      // but here we use the existing showAlert and rely on backend speed.
    });
    
    hapticFeedback('light');

    try {
      const response = await fetch('/api/tasks/claim', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-TG-Init-Data': initData
        },
        body: JSON.stringify({ 
          telegramId: user.telegram_id,
          taskId: task.id,
          reward: task.reward
        })
      });

      const data = await response.json();

      if (response.ok) {
        hapticFeedback('success');
        // Immersive success feedback
        showAlert(`✨ Excellent! Task verified.\n+${task.reward} credits have been added to your balance.`);
        
        if (user) {
          setUser({ ...user, credits: data.newCredits });
        }
        
        // Refresh tasks list to show completed state if UI supports it
        fetch('/api/common/tasks')
          .then(r => r.json())
          .then(data => {
             if (data && data.length > 0) setDynamicTasks(data);
          });
      } else {
        hapticFeedback('error');
        showAlert(data.error || 'Verification failed. Please make sure you completed the task correctly!');
      }
    } catch (err) {
      console.error("Task claim error:", err);
      hapticFeedback('error');
      showAlert('Connection error. Please try again in a moment.');
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || isChatLoading) return;

    const userMsg = chatMessage.trim();
    setChatMessage('');
    setChatHistory(prev => [...prev, { role: 'user', parts: userMsg }]);
    setIsChatLoading(true);
    hapticFeedback('light');

    try {
      const response = await supportService.chatWithSupport(userMsg, chatHistory);
      setChatHistory(prev => [...prev, { role: 'model', parts: response || 'No response' }]);
      hapticFeedback('medium');
    } catch (error) {
      showAlert('Failed to get response from support agent.');
    } finally {
      setIsChatLoading(false);
    }
  };

  if (isViewingSupport) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col overflow-hidden">
        {/* Tab Switcher */}
        <div className="px-6 pt-8 pb-4">
          <div className="flex bg-zinc-900/50 p-1.5 rounded-[24px]">
            <button 
              onClick={() => { hapticFeedback('light'); setSupportTab('chat'); }}
              className={`flex-1 py-3 rounded-[18px] text-sm font-black transition-all ${supportTab === 'chat' ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]' : 'text-zinc-500 hover:text-white'}`}
            >
              AI Support
            </button>
            <button 
              onClick={() => { hapticFeedback('light'); setSupportTab('faq'); }}
              className={`flex-1 py-3 rounded-[18px] text-sm font-black transition-all ${supportTab === 'faq' ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]' : 'text-zinc-500 hover:text-white'}`}
            >
              FAQ
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {supportTab === 'chat' ? (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex-1 flex flex-col px-6"
              >
                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-4">
                  {chatHistory.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
                      <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center">
                        <Headset className="w-8 h-8 text-[#ccff00]" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-lg font-black text-white">How can we help?</p>
                        <p className="text-xs font-bold text-zinc-500">Our AI agent is ready to assist you</p>
                      </div>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div 
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm font-bold ${
                        msg.role === 'user' 
                          ? 'bg-[#ccff00] text-black rounded-tr-none' 
                          : 'bg-zinc-900 text-white rounded-tl-none border border-zinc-800'
                      }`}>
                        {msg.parts}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-zinc-900 text-white px-4 py-3 rounded-2xl rounded-tl-none border border-zinc-800">
                        <Loader2 className="w-4 h-4 animate-spin text-[#ccff00]" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="py-6 space-y-4">
                  <div className="relative">
                    <input 
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Type your question..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 pr-14 text-white font-bold focus:outline-none focus:border-[#ccff00]/50 transition-all"
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={!chatMessage.trim() || isChatLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#ccff00] rounded-xl flex items-center justify-center active:scale-90 transition-all disabled:opacity-50 disabled:grayscale"
                    >
                      <Send className="w-5 h-5 text-black" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsReportingIssue(true)}
                    className="w-full py-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[10px] font-black tracking-widest flex items-center justify-center gap-2"
                  >
                    <AlertCircle className="w-3 h-3" />
                    Report a problem
                  </button>
                </div>

                {isReportingIssue && (
                  <div className="fixed inset-0 z-[120] bg-black/90 p-6 flex items-end">
                    <div className="w-full bg-zinc-950 border border-zinc-800 rounded-3xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">Submit report</h3>
                        <button onClick={() => setIsReportingIssue(false)} className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center">
                          <X className="w-4 h-4 text-zinc-300" />
                        </button>
                      </div>
                      <select
                        value={reportCategory}
                        onChange={(e) => setReportCategory(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-white"
                      >
                        <option value="general">General issue</option>
                        <option value="payment">Payment issue</option>
                        <option value="analysis">Analysis issue</option>
                        <option value="bug">Bug report</option>
                      </select>
                      <input
                        value={reportSubject}
                        onChange={(e) => setReportSubject(e.target.value)}
                        placeholder="Short subject"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-white placeholder:text-zinc-600"
                      />
                      <textarea
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        placeholder="Describe the issue in detail..."
                        className="w-full h-28 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-white placeholder:text-zinc-600"
                      />
                      <button
                        onClick={submitReport}
                        disabled={isSubmittingReport}
                        className="w-full py-3 rounded-2xl bg-red-500 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50"
                      >
                        {isSubmittingReport ? 'Submitting...' : 'Submit report'}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="faq"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-4"
              >
                {faqs.map((faq, i) => (
                  <div 
                    key={i}
                    className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#ccff00] shrink-0" />
                      <h4 className="text-sm font-black text-white">{faq.question}</h4>
                    </div>
                    <p className="text-xs font-bold text-zinc-500 leading-relaxed pl-4">
                      {faq.answer}
                    </p>
                  </div>
                ))}
                <div className="py-8 text-center">
                  <p className="text-[10px] font-black text-zinc-600 tracking-[0.3em]">End of FAQs</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (isViewingReferral) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col overflow-hidden">
        {/* Tab Switcher */}
        <div className="px-6 pt-8 pb-4">
          <div className="flex bg-zinc-900/50 p-1.5 rounded-[24px]">
            <button 
              onClick={() => { hapticFeedback('light'); setReferralTab('referral'); }}
              className={`flex-1 py-3 rounded-[18px] text-sm font-black transition-all ${referralTab === 'referral' ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]' : 'text-zinc-500 hover:text-white'}`}
            >
              Referral
            </button>
            <button 
              onClick={() => { hapticFeedback('light'); setReferralTab('earn'); }}
              className={`flex-1 py-3 rounded-[18px] text-sm font-black transition-all ${referralTab === 'earn' ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]' : 'text-zinc-500 hover:text-white'}`}
            >
              Earn
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-8">
          <AnimatePresence mode="wait">
            {referralTab === 'referral' ? (
              <motion.div 
                key="referral"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-6 text-center space-y-2">
                    <p className="text-4xl font-black text-[#ccff00]">{referralStats.totalReferred}</p>
                    <p className="text-[10px] font-bold text-zinc-500 tracking-widest">Total referred</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-6 text-center space-y-2">
                    <p className="text-4xl font-black text-white">{referralStats.earnedCredits}</p>
                    <p className="text-[10px] font-bold text-zinc-500 tracking-widest">Credits earned</p>
                  </div>
                </div>

                {/* Referral Link Box */}
                <div className="space-y-4">
                  <div className="text-center space-y-1">
                    <h3 className="text-lg font-black text-white">Your referral link</h3>
                    <p className="text-xs font-bold text-zinc-500">Every friend gives you 2 credits</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-4 flex items-center justify-between">
                    <code className="text-[10px] sm:text-xs font-mono text-zinc-400 truncate flex-1 block px-2">
                      {referralStats.referralLink || `https://t.me/Deepflashaibot?start=${user?.telegram_id || ''}`}
                    </code>
                    <div className="flex gap-2">
                      <button 
                        onClick={copyReferralLink}
                        className="shrink-0 w-12 h-12 bg-zinc-800 border border-zinc-700 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
                        title="Copy Link"
                      >
                        <Copy className="w-5 h-5 text-white" />
                      </button>
                      <button 
                        onClick={shareReferralLink}
                        className="shrink-0 w-12 h-12 bg-[#ccff00] rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                        title="Share Link"
                      >
                        <Share2 className="w-5 h-5 text-black" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* How it works */}
                <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-[32px] p-6 space-y-6">
                  <h3 className="text-sm font-black text-white text-center">How it works</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-xl bg-[#ccff00]/20 flex items-center justify-center text-[#ccff00] text-xs font-black">1</div>
                      <p className="text-xs font-bold text-zinc-400">Share your referral link with friends</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-xl bg-[#ccff00]/20 flex items-center justify-center text-[#ccff00] text-xs font-black">2</div>
                      <p className="text-xs font-bold text-zinc-400">Friend joins Flash AI Bot</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-xl bg-[#ccff00]/20 flex items-center justify-center text-[#ccff00] text-xs font-black">3</div>
                      <p className="text-xs font-bold text-zinc-400">You instantly receive 2 bonus credits</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="earn"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-1 mb-2">
                  <h3 className="text-lg font-black text-white">Complete tasks</h3>
                  <p className="text-xs font-bold text-zinc-500">Collect points to unlock Premium features</p>
                </div>

                {dynamicTasks.map((task: any) => {
                  const Icon = task.icon || Trophy;
                  return (
                    <div 
                      key={task.id}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-[32px] p-5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl ${task.bgColor || 'bg-zinc-800'} flex items-center justify-center overflow-hidden`}>
                          {task.image_url ? (
                            <img src={task.image_url} alt={task.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Icon className={`w-6 h-6 ${task.color || 'text-zinc-400'}`} />
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-black text-white leading-tight">{task.title}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Zap className="w-3 h-3 text-[#ccff00] fill-[#ccff00]" />
                            <span className="text-[10px] font-black text-[#ccff00]">+{task.reward} pts</span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleTaskAction(task)}
                        className="bg-white text-black px-6 py-2.5 rounded-xl font-black text-[10px] tracking-widest active:scale-95 transition-all hover:bg-[#ccff00]"
                      >
                        {task.buttonLabel || 'Claim'}
                      </button>
                    </div>
                  );
                })}

                {dynamicTasks.length === 0 ? (
                  <div className="py-8 text-center text-zinc-600">
                    <p className="text-sm font-black">No admin tasks available right now.</p>
                  </div>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (isViewingSubscriptions) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-8 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-black text-white tracking-tight">Upgrade Plan</h1>
            <p className="text-zinc-500 text-sm font-bold">Choose the best plan for your success</p>
          </div>

          <div className="space-y-6 pb-12">
            {PLANS.map((plan) => {
              const isCurrent = user?.plan === plan.id;
              const Icon = plan.icon;
              const planStarsPrice = getPriceInStars(Number(plan.usdPrice || 0));
              const planTonPrice = getPriceInTon(Number(plan.usdPrice || 0), usdToTonRate);

              return (
                <div 
                  key={plan.id}
                  className={`relative p-6 rounded-[32px] border ${isCurrent ? 'border-[#ccff00] bg-[#ccff00]/5' : 'border-zinc-800/50 bg-zinc-900/30'} transition-all`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#ccff00] text-black text-[10px] font-black px-4 py-1 rounded-full tracking-widest">
                      Most popular
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl ${plan.bgColor} flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 ${plan.color}`} />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-white">{plan.name}</h3>
                        <p className="text-xs font-bold text-zinc-500">{plan.period}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {plan.id === 'free' ? (
                        <p className="text-2xl font-black text-white">{plan.price}</p>
                      ) : (
                        <div className="flex flex-col items-end">
                          <p className="text-2xl font-black text-white">${Number(plan.usdPrice).toFixed(2)}</p>
                          <p className="text-[10px] font-bold text-zinc-500 mt-1">{planStarsPrice} Stars • {planTonPrice} TON</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-3 text-sm font-bold text-zinc-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00]" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => handleUpgrade(plan)}
                    className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
                      isCurrent
                        ? 'bg-zinc-800 text-zinc-500 cursor-default border border-zinc-700'
                        : 'bg-gradient-to-r from-[#ccff00] to-[#b5e500] text-black active:scale-[0.98] shadow-[0_8px_20px_rgba(204,255,0,0.2)]'
                    }`}
                  >
                    {isCurrent ? (
                      <>
                        <Check className="w-4 h-4" />
                        Current plan
                      </>
                    ) : (
                      <>
                        Choose plan
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (isViewingPaymentMethods && selectedPlanForPayment) {
    const selectedPlanUsdPrice = Number(selectedPlanForPayment.usdPrice || 0);
    const selectedStarsPrice = getPriceInStars(selectedPlanUsdPrice);
    const selectedTonPrice = getPriceInTon(selectedPlanUsdPrice, usdToTonRate);
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-6 space-y-5">
            <div className="text-center space-y-1 pt-2">
              <p className="text-lg font-black text-white">Payment Methods</p>
              <p className="text-xs font-semibold text-zinc-500">Choose your preferred checkout option</p>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-zinc-500">Selected plan</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xl font-black text-white">{selectedPlanForPayment.name}</p>
                  <p className="text-xs font-semibold text-zinc-500">{selectedPlanForPayment.period}</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-black text-white">${selectedPlanUsdPrice.toFixed(2)}</p>
                  <p className="text-[11px] font-semibold text-zinc-400">{selectedStarsPrice} Stars • {selectedTonPrice} TON</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleStarsPayment}
                className="w-full bg-[#0088cc]/12 border border-[#0088cc]/30 rounded-3xl p-5 flex items-center justify-between group active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#0088cc] flex items-center justify-center">
                    <StarsIcon className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-black text-white">Telegram Stars</p>
                    <p className="text-xs font-semibold text-zinc-400">{selectedStarsPrice} Stars • Fast in-app checkout</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#0088cc]" />
              </button>

              <button
                onClick={handleTonPayment}
                className="w-full bg-[#0098EA]/12 border border-[#0098EA]/25 rounded-3xl p-5 flex items-center justify-between group active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0098EA] to-[#0077B5] flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-black text-white">TON Wallet</p>
                    <p className="text-xs font-semibold text-zinc-400">{selectedTonPrice} TON • Pay securely on-chain</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#0098EA]" />
              </button>

              <button
                onClick={handleLemonSqueezyPayment}
                className="w-full bg-[#FFC233]/10 border border-[#FFC233]/25 rounded-3xl p-5 flex items-center justify-between group active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#FFC233] flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-black" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-black text-white">Bank Card</p>
                    <p className="text-xs font-semibold text-zinc-400">${selectedPlanUsdPrice.toFixed(2)} • Powered by Lemon Squeezy</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#FFC233]" />
              </button>
            </div>

            <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-3">
              <p className="text-[11px] font-semibold text-zinc-400 leading-relaxed">
                We use encrypted providers for secure processing. By continuing, you agree to the Terms and Privacy Policy.
              </p>
              <button onClick={() => setIsViewingLegal(true)} className="w-full py-2.5 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-200 tracking-wider">
                View Terms & Privacy
              </button>
            </div>
          </div>

          {paymentProcessing.isLoading && (
            <div className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-sm flex items-center justify-center px-6">
              <div className="w-full max-w-sm rounded-3xl bg-zinc-950 border border-zinc-800 p-6 text-center space-y-4">
                <div className="mx-auto w-12 h-12 border-4 border-zinc-700 border-t-[#ccff00] rounded-full animate-spin" />
                <p className="text-base font-black text-white">{paymentProcessing.title}</p>
                <p className="text-xs font-semibold text-zinc-400 leading-relaxed">{paymentProcessing.detail}</p>
              </div>
            </div>
          )}
      </div>
    );
  }

  if (isViewingLegal) {
    return (
      <div className="fixed inset-0 z-[120] bg-black flex flex-col overflow-hidden">
        <div className="sticky top-0 z-20 border-b border-zinc-800/70 bg-[#17212b]/95 backdrop-blur-sm">
          <div className="h-14 px-4 flex items-center justify-between">
            <button
              onClick={() => setIsViewingLegal(false)}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center active:scale-95 transition-all"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <p className="text-sm font-bold text-white">Terms & Policies</p>
            <div className="w-9" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-5">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
            <pre className="text-[11px] text-zinc-300 font-semibold leading-relaxed whitespace-pre-wrap">
              {legalContent || 'Loading terms and policies...'}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-8 space-y-8 pb-8">
          {/* Avatar Edit */}
          <div className="flex flex-col items-center">
            <div className="relative w-32 h-32 rounded-full p-1 bg-gradient-to-b from-zinc-800 to-zinc-900">
              <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden border-4 border-black">
                {editPhotoUrl ? (
                  <img src={editPhotoUrl} alt="Profile" className="w-full h-full object-cover opacity-50" />
                ) : (
                  <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                    <User className="w-10 h-10 text-zinc-600" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera className="w-8 h-8 text-white" />
                </div>
              </div>
            </div>
            <label className="mt-4 text-sm font-bold text-[#ccff00] cursor-pointer">
              Change Photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) {
                    showAlert('Image too large. Maximum 2MB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setEditPhotoUrl(String(reader.result || ''));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 tracking-widest pl-2">Full name</label>
              <input 
                type="text" 
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-4 text-white font-bold focus:outline-none focus:border-[#ccff00]/50 transition-colors"
                placeholder="Enter your name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 tracking-widest pl-2">Username</label>
              <input 
                type="text" 
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-4 text-white font-bold focus:outline-none focus:border-[#ccff00]/50 transition-colors"
                placeholder="Enter your username"
              />
            </div>
          </div>
        </div>

        {/* Save Button at Bottom */}
        <div className="p-6 bg-black border-t border-zinc-900">
          <button 
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="w-full bg-[#ccff00] text-black font-black text-sm tracking-widest py-4 rounded-2xl shadow-[0_0_20px_rgba(204,255,0,0.2)] active:scale-[0.98] transition-all"
          >
            {isSavingProfile ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar bg-black">
      {/* Profile Header Section */}
      <div className="flex flex-col items-center pt-12 pb-8 px-6 space-y-6">
        <div className="relative">
          {/* Avatar with Glow */}
          <div className={`relative w-32 h-32 rounded-full p-1 ${user ? 'bg-gradient-to-b from-[#ccff00] to-transparent shadow-[0_0_30px_rgba(204,255,0,0.2)]' : 'bg-zinc-800'}`}>
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden border-4 border-black">
              {user?.photo_url ? (
                <img src={user.photo_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                  <User className="w-12 h-12 text-zinc-600" />
                </div>
              )}
            </div>
            {/* Edit Icon */}
            {user && (
              <button 
                onClick={() => setIsEditing(true)}
                className="absolute -bottom-1 -right-1 bg-zinc-800 rounded-full p-2 border-4 border-black hover:bg-zinc-700 transition-colors active:scale-95"
              >
                <Pencil className="w-3.5 h-3.5 text-white" />
              </button>
            )}
          </div>
        </div>

        <div className="text-center space-y-3">
          {user?.phone ? (
            <>
              <h2 className="text-3xl font-black text-white tracking-tight">
                {user.name}
              </h2>
              <p className="text-sm font-bold text-zinc-500">@{user.username || 'user'}</p>
              <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20 mt-2">
                <span className="text-[10px] font-black text-[#ccff00] tracking-[0.2em]">
                  {user.plan !== 'free' ? 'Premium member' : 'Free member'}
                </span>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-3xl font-black text-white tracking-tight">Guest User</h2>
              <p className="text-sm font-bold text-zinc-500">Sign up to unlock all features</p>
              <button 
                onClick={() => setIsSignUpOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-[#ccff00] text-black text-xs font-black tracking-widest mt-4 active:scale-95 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                Start registration
              </button>
            </>
          )}

          {user?.phone && (
            <div className="pt-2">
              <TonConnectButton />
            </div>
          )}
        </div>
      </div>

      {/* Action Cards */}
      <div className="px-6 space-y-6 pb-32">
        {/* Subscription Plan Card */}
        <button 
          onClick={() => handleAction('Subscription')}
          className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-[32px] p-6 flex items-center justify-between group active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center">
              <CreditCard className="w-7 h-7 text-[#ccff00]" />
            </div>
            <div className="text-left">
              <p className="text-lg font-black text-white">Subscription Plan</p>
              <p className="text-sm font-bold text-zinc-500">Manage your pro features</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-[#ccff00] transition-colors" />
        </button>

        {/* Referral & Support Grid */}
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => handleAction('Referral')}
            className={`bg-zinc-900/50 border border-zinc-800/50 rounded-[32px] p-6 flex flex-col items-start gap-4 active:scale-[0.98] transition-all ${!user?.phone && 'opacity-50'}`}
          >
            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center">
              <Share2 className="w-6 h-6 text-[#ccff00]" />
            </div>
            <div className="text-left">
              <p className="text-lg font-black text-white">Referral and Earn</p>
              <p className="text-[10px] font-bold text-zinc-500 leading-relaxed">Invite friends and earn Flash credits</p>
            </div>
          </button>
          <button 
            onClick={() => handleAction('Support')}
            className="bg-zinc-900/50 border border-zinc-800/50 rounded-[32px] p-6 flex flex-col items-start gap-4 active:scale-[0.98] transition-all"
          >
            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center">
              <Headset className="w-6 h-6 text-zinc-400" />
            </div>
            <div className="text-left">
              <p className="text-lg font-black text-white">Support</p>
              <p className="text-[10px] font-bold text-zinc-500 leading-relaxed">24/7 AI-assisted help center</p>
            </div>
          </button>
        </div>

        {/* Bottom Links */}
        <div className="space-y-2 pt-4">
          <button 
            onClick={() => handleAction('Terms')}
            className="w-full bg-zinc-900/30 border border-zinc-800/30 rounded-2xl p-4 flex items-center justify-between group active:bg-zinc-900/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-black text-white">Terms of Service</span>
            </div>
          </button>
        </div>
      </div>

      <SignUpSheet 
        isOpen={isSignUpOpen} 
        onClose={() => setIsSignUpOpen(false)}
      />
    </div>
  );
};
