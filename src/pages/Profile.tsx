import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CreditCard, 
  Share2, 
  Headset, 
  FileText, 
  ChevronRight,
  Pencil,
  LogOut,
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
  Loader2
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { useTelegram } from '../hooks/useTelegram';
import { supportService, FAQ } from '../services/supportService';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    icon: Zap,
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-900',
    features: ['5 Daily Credits', '1 Bet Slip Analysis', 'No AI Chat after analysis']
  },
  {
    id: 'weekly',
    name: 'Weekly',
    price: '$3.99',
    period: 'per week',
    icon: ShieldCheck,
    color: 'text-[#ccff00]',
    bgColor: 'bg-[#ccff00]/10',
    features: ['35 Daily Credits', '3 Bet Slip Analysis', 'Upto 2 bet slip image upload', 'AI Chat after analysis'],
    popular: true
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$11.99',
    period: 'per month',
    icon: Crown,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    features: ['120 Daily Credits', '10 Bet Slip Analysis', '5+ Image upload limit', 'Unlimited AI Chat', 'Deep Analysis & Data gathering']
  }
];

const EARN_TASKS = [
  {
    id: 'tg_channel',
    title: 'Join Telegram Channel',
    description: 'Get latest updates and signals',
    reward: 50,
    buttonLabel: 'Join',
    icon: MessageSquare,
    color: 'text-[#ccff00]',
    bgColor: 'bg-[#ccff00]/10',
    url: 'https://t.me/flash_ai_signals'
  },
  {
    id: '1xbet_reg',
    title: 'Register on 1xBet',
    description: 'Use promo code FLASHAI',
    reward: 500,
    buttonLabel: 'Register',
    icon: Trophy,
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    url: 'https://1xbet.com'
  },
  {
    id: 'follow_twitter',
    title: 'Follow on X',
    description: 'Stay updated on Twitter',
    reward: 30,
    buttonLabel: 'Follow',
    icon: Share2,
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-800',
    url: 'https://x.com/flashai'
  },
  {
    id: 'daily_reward',
    title: 'Daily Bonus',
    description: 'Claim your daily free credits',
    reward: 10,
    buttonLabel: 'Claim',
    icon: Gift,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    url: '#'
  }
];

export const Profile: React.FC = () => {
  const { user, setUser } = useUserStore();
  const { tg, hapticFeedback, showAlert } = useTelegram();
  const [isEditing, setIsEditing] = useState(false);
  const [isViewingSubscriptions, setIsViewingSubscriptions] = useState(false);
  const [isViewingReferral, setIsViewingReferral] = useState(false);
  const [isViewingSupport, setIsViewingSupport] = useState(false);
  const [referralTab, setReferralTab] = useState<'referral' | 'earn'>('referral');
  const [supportTab, setSupportTab] = useState<'chat' | 'faq'>('chat');
  const [editName, setEditName] = useState(user?.name || 'Alex Volkov');
  const [editUsername, setEditUsername] = useState(user?.username || 'alex_v');

  // Support Chat State
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', parts: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isViewingSupport) {
      supportService.getFAQs().then(setFaqs);
    }
  }, [isViewingSupport]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (tg?.BackButton) {
      if (isEditing || isViewingSubscriptions || isViewingReferral || isViewingSupport) {
        tg.BackButton.show();
        const handleBack = () => {
          setIsEditing(false);
          setIsViewingSubscriptions(false);
          setIsViewingReferral(false);
          setIsViewingSupport(false);
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
  }, [isEditing, isViewingSubscriptions, isViewingReferral, isViewingSupport, tg]);

  const handleAction = (name: string) => {
    hapticFeedback('light');
    if (name === 'Subscription') {
      setIsViewingSubscriptions(true);
    } else if (name === 'Referral') {
      setIsViewingReferral(true);
    } else if (name === 'Support') {
      setIsViewingSupport(true);
    } else {
      showAlert(`${name} feature coming soon!`);
    }
  };

  const handleSaveProfile = () => {
    hapticFeedback('success');
    if (user) {
      setUser({
        ...user,
        name: editName,
        username: editUsername
      });
    }
    setIsEditing(false);
    showAlert('Profile updated successfully!');
  };

  const handleUpgrade = (planId: string) => {
    hapticFeedback('medium');
    showAlert(`Upgrading to ${planId.toUpperCase()}... Payment gateway coming soon!`);
  };

  const copyReferralLink = () => {
    hapticFeedback('success');
    const link = `https://t.me/flash_ai_bot?start=${user?.id || 'ref123'}`;
    navigator.clipboard.writeText(link);
    showAlert('Referral link copied to clipboard!');
  };

  const handleTaskAction = (task: typeof EARN_TASKS[0]) => {
    hapticFeedback('medium');
    if (task.url !== '#') {
      tg?.openTelegramLink?.(task.url) || window.open(task.url, '_blank');
    } else {
      showAlert(`Claiming ${task.reward} credits...`);
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
                    onClick={() => showAlert('Report feature coming soon!')}
                    className="w-full py-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <AlertCircle className="w-3 h-3" />
                    Report a Problem
                  </button>
                </div>
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
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">End of FAQs</p>
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
                    <p className="text-4xl font-black text-[#ccff00]">12</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Referred</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-6 text-center space-y-2">
                    <p className="text-4xl font-black text-white">450</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Points Earned</p>
                  </div>
                </div>

                {/* Referral Link Box */}
                <div className="space-y-4">
                  <div className="text-center space-y-1">
                    <h3 className="text-lg font-black text-white">Your Referral Link</h3>
                    <p className="text-xs font-bold text-zinc-500">Every friend gives you 50 credits</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-4 flex items-center justify-between">
                    <code className="text-xs font-mono text-zinc-400 truncate flex-1 block px-2">
                      https://t.me/flash_ai_bot?start={user?.id || 'ref123'}
                    </code>
                    <button 
                      onClick={copyReferralLink}
                      className="shrink-0 w-12 h-12 bg-[#ccff00] rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                    >
                      <Copy className="w-5 h-5 text-black" />
                    </button>
                  </div>
                </div>

                {/* How it works */}
                <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-[32px] p-6 space-y-6">
                  <h3 className="text-sm font-black text-white text-center">HOW IT WORKS</h3>
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
                      <p className="text-xs font-bold text-zinc-400">You instantly receive 50 bonus credits</p>
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
                  <h3 className="text-lg font-black text-white">Complete Tasks</h3>
                  <p className="text-xs font-bold text-zinc-500">Collect points to unlock Premium features</p>
                </div>

                {EARN_TASKS.map((task) => {
                  const Icon = task.icon;
                  return (
                    <div 
                      key={task.id}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-[32px] p-5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl ${task.bgColor} flex items-center justify-center`}>
                          <Icon className={`w-6 h-6 ${task.color}`} />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-black text-white leading-tight">{task.title}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Zap className="w-3 h-3 text-[#ccff00] fill-[#ccff00]" />
                            <span className="text-[10px] font-black text-[#ccff00]">+{task.reward} PTS</span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleTaskAction(task)}
                        className="bg-white text-black px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all hover:bg-[#ccff00]"
                      >
                        {task.buttonLabel}
                      </button>
                    </div>
                  );
                })}

                {/* Coming Soon Message */}
                <div className="py-8 text-center text-zinc-600">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]">More tasks coming daily</p>
                </div>
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

              return (
                <div 
                  key={plan.id}
                  className={`relative p-6 rounded-[32px] border ${isCurrent ? 'border-[#ccff00] bg-[#ccff00]/5' : 'border-zinc-800/50 bg-zinc-900/30'} transition-all`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#ccff00] text-black text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest">
                      Most Popular
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
                      <p className="text-2xl font-black text-white">{plan.price}</p>
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
                    disabled={isCurrent}
                    onClick={() => handleUpgrade(plan.id)}
                    className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${
                      isCurrent 
                        ? 'bg-zinc-800 text-zinc-500 cursor-default' 
                        : 'bg-white text-black active:scale-[0.98] hover:bg-[#ccff00]'
                    }`}
                  >
                    {isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                  </button>
                </div>
              );
            })}
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
                {user?.photo_url ? (
                  <img src={user.photo_url} alt="Profile" className="w-full h-full object-cover opacity-50" />
                ) : (
                  <img 
                    src="https://i.pravatar.cc/150?img=11" 
                    alt="Profile" 
                    className="w-full h-full object-cover opacity-50" 
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera className="w-8 h-8 text-white" />
                </div>
              </div>
            </div>
            <button className="mt-4 text-sm font-bold text-[#ccff00]">
              Change Photo
            </button>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-2">Full Name</label>
              <input 
                type="text" 
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-4 text-white font-bold focus:outline-none focus:border-[#ccff00]/50 transition-colors"
                placeholder="Enter your name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-2">Username</label>
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
            className="w-full bg-[#ccff00] text-black font-black text-sm uppercase tracking-widest py-4 rounded-2xl shadow-[0_0_20px_rgba(204,255,0,0.2)] active:scale-[0.98] transition-all"
          >
            Save Changes
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
          <div className="relative w-32 h-32 rounded-full p-1 bg-gradient-to-b from-[#ccff00] to-transparent shadow-[0_0_30px_rgba(204,255,0,0.2)]">
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden border-4 border-black">
              {user?.photo_url ? (
                <img src={user.photo_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <img 
                  src="https://i.pravatar.cc/150?img=11" 
                  alt="Profile" 
                  className="w-full h-full object-cover" 
                />
              )}
            </div>
            {/* Edit Icon */}
            <button 
              onClick={() => setIsEditing(true)}
              className="absolute -bottom-1 -right-1 bg-zinc-800 rounded-full p-2 border-4 border-black hover:bg-zinc-700 transition-colors active:scale-95"
            >
              <Pencil className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>

        <div className="text-center space-y-3">
          <h2 className="text-3xl font-black text-white tracking-tight">
            {user?.name || 'Alex Volkov'}
          </h2>
          <p className="text-sm font-bold text-zinc-500">@{user?.username || 'alex_v'}</p>
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20 mt-2">
            <span className="text-[10px] font-black text-[#ccff00] uppercase tracking-[0.2em]">
              {user?.plan && user.plan !== 'free' ? 'PREMIUM MEMBER' : 'FREE MEMBER'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="px-6 mb-8">
        <div className="flex items-center justify-between py-6 border-y border-zinc-800/50">
          <div className="flex-1 text-center">
            <p className="text-2xl font-black text-white">84%</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Win Rate</p>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div className="flex-1 text-center">
            <p className="text-2xl font-black text-white">124</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Predictions</p>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div className="flex-1 text-center">
            <p className="text-2xl font-black text-white">12k</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Ranking</p>
          </div>
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
            className="bg-zinc-900/50 border border-zinc-800/50 rounded-[32px] p-6 flex flex-col items-start gap-4 active:scale-[0.98] transition-all"
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
          <button 
            onClick={() => handleAction('Logout')}
            className="w-full bg-red-500/5 border border-red-500/10 rounded-2xl p-4 flex items-center justify-between group active:bg-red-500/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <LogOut className="w-4 h-4 text-red-500" />
              <span className="text-sm font-black text-red-500">Log Out</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
