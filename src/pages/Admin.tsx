import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  BarChart3, 
  ListTodo, 
  Image as ImageIcon, 
  Users, 
  TrendingUp, 
  Activity, 
  CreditCard,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Search,
  ChevronRight,
  PieChart,
  Calendar,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Megaphone,
  Zap
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { useTelegram } from '../hooks/useTelegram';

type AdminTab = 'dashboard' | 'analytics' | 'tasks' | 'ads' | 'users' | 'notifications';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const { tg, hapticFeedback, showAlert, showConfirm, initData } = useTelegram();
  
  const [stats, setStats] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);

  // Form states for adding items
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [isAddingAd, setIsAddingAd] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', reward: 10, url: '', buttonLabel: 'Start Task', image_url: '', active: true });
  const [newAd, setNewAd] = useState({ 
    title: '', 
    subtitle: '', 
    image_url: '', 
    link: '', 
    active: true, 
    cta: 'Check Out', 
    target_group: 'all',
    expires_at: '',
    primary_color: '#3b82f6'
  });
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [pushForm, setPushForm] = useState({
    message: '',
    image_url: '',
    with_app_button: false,
    app_button_text: '',
    with_url_button: false,
    url_button_text: '',
    button_url: '',
    target_group: 'all'
  });

  useEffect(() => {
    if (!initData) return;
    fetchDashboard();
    fetchAnalytics();
    fetchTasks();
    fetchAds();
    fetchUsers();
  }, [initData]);

  const fetchUsers = async (q = '') => {
    try {
      const res = await fetch(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setUsers([]);
        return;
      }
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setUsers([]);
    }
  };

  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (res.status === 403) {
        setIsForbidden(true);
        setIsLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`Dashboard request failed (${res.status})`);
      const data = await res.json();
      setStats(data.stats);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/admin/analytics', {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setAnalytics(null);
        return;
      }
      const data = await res.json();
      setAnalytics(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/admin/tasks', {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setTasks([]);
    }
  };

  const fetchAds = async () => {
    try {
      const res = await fetch('/api/admin/ads', {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setAds([]);
        return;
      }
      const data = await res.json();
      setAds(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setAds([]);
    }
  };

  const handleAddTask = async () => {
    if (!newTask.title || !newTask.description) return;
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify(newTask)
      });
      if (res.ok) {
        fetchTasks();
        setIsAddingTask(false);
        setNewTask({ title: '', description: '', reward: 10, url: '', buttonLabel: 'Start Task', image_url: '', active: true });
        showAlert('Task added successfully!');
      }
    } catch (e) {
      showAlert('Failed to add task');
    }
  };

  const handleAddAd = async () => {
    try {
      const res = await fetch('/api/admin/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify(newAd)
      });
      if (res.ok) {
        fetchAds();
        setIsAddingAd(false);
        setNewAd({ 
          title: '', 
          subtitle: '', 
          image_url: '', 
          link: '', 
          active: true, 
          cta: 'Check Out', 
          target_group: 'all',
          expires_at: '',
          primary_color: '#3b82f6'
        });
        showAlert('Ad added to rotation successfully!');
      }
    } catch (e) {
      showAlert('Failed to add ad');
    }
  };

  const broadcastAd = async (adId: string, group: string) => {
    setIsBroadcasting(true);
    try {
      const res = await fetch('/api/admin/ads/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify({ adId, targetGroup: group })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert(`Broadcast complete! Sent to ${data.sentCount} users.`);
      } else {
        showAlert(data.error || "Broadcast failed");
      }
    } catch (e) {
      showAlert('Failed to broadcast');
    } finally {
      setIsBroadcasting(false);
    }
  };

  const triggerAutomation = async (type: string) => {
    try {
      const res = await fetch('/api/admin/automation/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify({ type })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showAlert(`Automation triggered. Sent to ${data.sentCount ?? 0} users.`);
      } else {
        showAlert(data.error || 'Failed to trigger automation');
      }
    } catch (e) {
      showAlert('Failed to trigger');
    }
  };

  const promoteUser = async (telegramId: number, role: 'user' | 'admin') => {
    const res = await fetch('/api/admin/users/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
      body: JSON.stringify({ telegramId, role })
    });
    if (res.ok) {
      fetchUsers(userSearch);
      showAlert(`User updated to ${role}`);
    }
  };

  const notifyUser = async (telegramId: number) => {
    if (!notifyMessage.trim()) {
      showAlert('Please type a message first.');
      return;
    }
    const res = await fetch('/api/admin/users/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
      body: JSON.stringify({ telegramId, message: notifyMessage })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showAlert('Notification sent.');
    } else {
      showAlert(data.error || 'Failed to notify user');
    }
  };

  const deleteTask = async (id: string) => {
    showConfirm('Delete this task?', async (ok) => {
       if (ok) {
         await fetch(`/api/admin/tasks/${id}`, { method: 'DELETE', headers: { 'X-TG-Init-Data': initData } });
         fetchTasks();
       }
    });
  };

  const deleteAd = async (id: string) => {
    showConfirm('Delete this ad?', async (ok) => {
       if (ok) {
         await fetch(`/api/admin/ads/${id}`, { method: 'DELETE', headers: { 'X-TG-Init-Data': initData } });
         fetchAds();
       }
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-[#ccff00]/20 border-t-[#ccff00] rounded-full animate-spin" />
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Accessing Control Center</p>
      </div>
    );
  }

  const trafficData = Array.isArray(analytics?.traffic) ? analytics.traffic : [];
  const patternData = Array.isArray(analytics?.patterns) ? analytics.patterns : [];

  if (isForbidden) {
    return (
      <div className="min-h-[100dvh] bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
          <h2 className="text-lg font-black">Admin Access Required</h2>
          <p className="text-xs text-zinc-400 font-semibold">This page is restricted to admin accounts only.</p>
        </div>
      </div>
    );
  }

  const handleUploadAsDataUrl = (file: File, cb: (dataUrl: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const sendPushNotification = async () => {
    if (!pushForm.message.trim()) {
      showAlert('Please enter a message.');
      return;
    }

    setIsSendingNotification(true);
    try {
      const res = await fetch('/api/admin/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify(pushForm)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showAlert(`Push sent to ${data.sentCount ?? 0} users.`);
        setPushForm({ message: '', image_url: '', with_app_button: false, app_button_text: '', with_url_button: false, url_button_text: '', button_url: '', target_group: 'all' });
      } else {
        showAlert(data.error || 'Failed to send push notification');
      }
    } finally {
      setIsSendingNotification(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-black overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-zinc-900 bg-black/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-white">Admin Hub</h1>
            <p className="text-[10px] font-bold text-[#ccff00] tracking-widest uppercase">Elite Control Panel</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-[#ccff00]/10 flex items-center justify-center border border-[#ccff00]/20">
            <ShieldCheck className="w-5 h-5 text-[#ccff00]" />
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-2 p-1 bg-zinc-900/50 rounded-2xl overflow-x-auto no-scrollbar">
          {(['dashboard', 'analytics', 'tasks', 'ads', 'users', 'notifications'] as AdminTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => { hapticFeedback('light'); setActiveTab(tab); }}
              className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab 
                  ? 'bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]' 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-6 font-poppins">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dash"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-white">{stats?.totalUsers}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Users</p>
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#ccff00]/10 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-[#ccff00]" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-white">{stats?.subscribers}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Active Subs</p>
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-400/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-white">{stats?.totalTransactions}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Txns</p>
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-white">{stats?.engagement}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">UX Health</p>
                  </div>
                </div>
              </div>

              {/* Performance Indicator */}
              <div className="bg-[#ccff00] rounded-3xl p-6 flex items-center justify-between overflow-hidden relative group">
                <div className="relative z-10">
                  <h3 className="text-sm font-black text-black">System Status Optimized</h3>
                  <p className="text-[10px] font-bold text-black/60 capitalize">All agent nodes functioning at peak performance</p>
                </div>
                <Zap className="w-12 h-12 text-black/10 absolute -right-2 -bottom-2 group-hover:scale-110 transition-transform" />
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div 
              key="ana"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 pb-12"
            >
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-[#ccff00]/10 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-[#ccff00]" />
                  </div>
                  <h3 className="text-sm font-black text-white">Usage Traffic (7D)</h3>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trafficData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ccff00" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#ccff00" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#71717a" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                        tick={{ dy: 10 }}
                      />
                      <YAxis hide />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '12px', fontSize: '10px' }}
                        itemStyle={{ color: '#ccff00' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#ccff00" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <PieChart className="w-4 h-4 text-blue-400" />
                  </div>
                  <h3 className="text-sm font-black text-white">Usage Patterns</h3>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patternData}>
                      <XAxis 
                        dataKey="label" 
                        stroke="#71717a" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                        tick={{ dy: 10 }}
                      />
                      <YAxis hide />
                      <Tooltip 
                        cursor={{ fill: 'transparent' }}
                        contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '12px', fontSize: '10px' }}
                      />
                      <Bar dataKey="value" radius={[10, 10, 10, 10]}>
                        {patternData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#ccff00' : '#3b82f6'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <button 
                onClick={() => setIsAddingTask(true)}
                className="w-full bg-zinc-900 border border-zinc-800 border-dashed py-6 rounded-3xl flex flex-col items-center gap-2 hover:bg-zinc-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-[#ccff00]/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-[#ccff00]" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#ccff00]">Create New Task</p>
              </button>

              <div className="space-y-4">
                {tasks.map(task => (
                  <div key={task.id} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center">
                        <ListTodo className="w-6 h-6 text-[#ccff00]" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-white">{task.title}</p>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">+{task.reward} CREDITS</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => deleteTask(task.id)}
                      className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Task Modal */}
              <AnimatePresence>
                {isAddingTask && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
                      onClick={() => setIsAddingTask(false)}
                    />
                    <motion.div 
                      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                      className="fixed bottom-0 left-0 right-0 bg-zinc-900 rounded-t-[40px] z-50 p-8 space-y-6 pt-12"
                    >
                      <h3 className="text-xl font-black text-white">Create Daily Task</h3>
                      <div className="space-y-4">
                        <input value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} placeholder="Task Title" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-[#ccff00]/50" />
                        <textarea value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} placeholder="Task Description" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 h-24 focus:ring-2 ring-[#ccff00]/50" />
                        <div className="flex gap-4">
                           <input type="number" value={newTask.reward} onChange={e => setNewTask({...newTask, reward: Number(e.target.value)})} placeholder="Reward" className="flex-1 bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-[#ccff00]/50" />
                           <input value={newTask.url} onChange={e => setNewTask({...newTask, url: e.target.value})} placeholder="Task redirect URL (optional)" className="flex-[2] bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-[#ccff00]/50" />
                        </div>
                        <div className="flex gap-4">
                          <input value={newTask.buttonLabel} onChange={e => setNewTask({...newTask, buttonLabel: e.target.value})} placeholder="Button text (e.g. Join now)" className="flex-1 bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-[#ccff00]/50" />
                          <input value={newTask.image_url} onChange={e => setNewTask({...newTask, image_url: e.target.value})} placeholder="Task image URL (optional)" className="flex-[2] bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-[#ccff00]/50" />
                        </div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer block">
                          Upload task image
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadAsDataUrl(file, (dataUrl) => setNewTask({ ...newTask, image_url: dataUrl }));
                          }} />
                        </label>
                        <button onClick={handleAddTask} className="w-full py-5 bg-[#ccff00] text-black font-black uppercase tracking-widest text-xs rounded-2xl shadow-[0_0_30px_rgba(204,255,0,0.3)]">Publish Task</button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'ads' && (
            <motion.div 
              key="ads"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <button 
                onClick={() => setIsAddingAd(true)}
                className="w-full bg-zinc-900 border border-zinc-800 border-dashed py-6 rounded-3xl flex flex-col items-center gap-2 hover:bg-zinc-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-blue-400" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Push New Promotion</p>
              </button>

              <div className="space-y-4">
                {ads.map(ad => (
                  <div key={ad.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
                    <div className="relative h-24 overflow-hidden">
                       <img src={ad.image_url} alt="" className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer" />
                       <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
                    </div>
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-sm font-black text-white leading-tight">{ad.title || 'Flash Promotion'}</p>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1 line-clamp-1">{ad.subtitle || 'No description'}</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => deleteAd(ad.id)}
                            className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-800">
                        <button 
                          disabled={isBroadcasting}
                          onClick={() => broadcastAd(ad.id, 'all')}
                          className="py-2.5 rounded-xl bg-zinc-800 text-[9px] font-black uppercase text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                          <Users className="w-3 h-3" /> All
                        </button>
                        <button 
                          disabled={isBroadcasting}
                          onClick={() => broadcastAd(ad.id, 'subscribed')}
                          className="py-2.5 rounded-xl bg-blue-500/10 text-[9px] font-black uppercase text-blue-400 hover:bg-blue-500 hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                          <ShieldCheck className="w-3 h-3" /> Subs
                        </button>
                        <button 
                          disabled={isBroadcasting}
                          onClick={() => broadcastAd(ad.id, 'unsubscribed')}
                          className="py-2.5 rounded-xl bg-orange-500/10 text-[9px] font-black uppercase text-orange-400 hover:bg-orange-500 hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                          <Users className="w-3 h-3" /> Free
                        </button>
                        <button 
                          disabled={isBroadcasting}
                          onClick={() => broadcastAd(ad.id, 'weekly')}
                          className="py-2.5 rounded-xl bg-[#ccff00]/10 text-[9px] font-black uppercase text-[#ccff00] hover:bg-[#ccff00] hover:text-black transition-all flex items-center justify-center gap-2"
                        >
                          <Zap className="w-3 h-3" /> Weekly
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Automation Triggers */}
              <div className="pt-8 space-y-4">
                 <h4 className="text-[10px] font-black text-white/40 uppercase tracking-[4px]">Smart Retention Loops</h4>
                 <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={() => triggerAutomation('registration')}
                      className="p-5 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-between group active:scale-95 transition-all"
                    >
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500">
                             <Clock className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                             <p className="text-[11px] font-black text-white uppercase tracking-wider">Unfinished Signups</p>
                             <p className="text-[9px] font-bold text-zinc-600 uppercase">Trigger FOMO Registration Nudge</p>
                          </div>
                       </div>
                       <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-white" />
                    </button>

                    <button 
                      onClick={() => triggerAutomation('inactive')}
                      className="p-5 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-between group active:scale-95 transition-all"
                    >
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500">
                             <Activity className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                             <p className="text-[11px] font-black text-white uppercase tracking-wider">Inactive Users</p>
                             <p className="text-[9px] font-bold text-zinc-600 uppercase">Trigger Global Comeback Alert</p>
                          </div>
                       </div>
                       <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-white" />
                    </button>
                 </div>
              </div>

               {/* Add Ad Modal */}
               <AnimatePresence>
                {isAddingAd && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
                      onClick={() => setIsAddingAd(false)}
                    />
                    <motion.div 
                      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                      className="fixed bottom-0 left-0 right-0 bg-zinc-900 rounded-t-[40px] z-50 p-8 space-y-6 pt-12 max-h-[90vh] overflow-y-auto no-scrollbar"
                    >
                      <h3 className="text-xl font-black text-white">Advanced Campaign Builder</h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Display Content</p>
                           <input value={newAd.title} onChange={e => setNewAd({...newAd, title: e.target.value})} placeholder="Ad Headline (e.g. 50% Weekend Bonus)" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           <textarea value={newAd.subtitle} onChange={e => setNewAd({...newAd, subtitle: e.target.value})} placeholder="Compelling Description (FOMO text)" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 h-24 focus:ring-2 ring-blue-500/50" />
                        </div>

                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Visuals & Branding</p>
                           <div className="flex gap-4">
                              <input value={newAd.image_url} onChange={e => setNewAd({...newAd, image_url: e.target.value})} placeholder="Banner Image URL" className="flex-[3] bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                              <input type="color" value={newAd.primary_color} onChange={e => setNewAd({...newAd, primary_color: e.target.value})} className="flex-1 h-[52px] bg-zinc-800 border-none rounded-2xl p-2 cursor-pointer" />
                           </div>
                           <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer block">
                              Upload ad image
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadAsDataUrl(file, (dataUrl) => setNewAd({ ...newAd, image_url: dataUrl }));
                              }} />
                           </label>
                        </div>

                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Audience</p>
                           <select value={newAd.target_group} onChange={e => setNewAd({...newAd, target_group: e.target.value})} className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold focus:outline-none focus:ring-2 ring-blue-500/50">
                              <option value="all">All users</option>
                              <option value="unsubscribed">Unsubscribed users</option>
                              <option value="subscribed">Subscribed users</option>
                           </select>
                        </div>

                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Campaign Schedule</p>
                           <input 
                            type="datetime-local" 
                            value={newAd.expires_at} 
                            onChange={e => setNewAd({...newAd, expires_at: e.target.value})} 
                            className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold focus:ring-2 ring-blue-500/50" 
                           />
                        </div>

                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Call to Action</p>
                           <div className="flex gap-4">
                              <input value={newAd.cta} onChange={e => setNewAd({...newAd, cta: e.target.value})} placeholder="Btn Text (Claim)" className="flex-1 bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                              <input value={newAd.link} onChange={e => setNewAd({...newAd, link: e.target.value})} placeholder="Destination URL" className="flex-[2] bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           </div>
                        </div>

                        <button onClick={handleAddAd} className="w-full py-5 bg-blue-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-[0_0_30px_rgba(59,130,246,0.3)]">Deploy to Rotation</button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'users' && (
             <motion.div 
              key="users"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
               <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 flex items-center gap-3">
                 <Search className="w-4 h-4 text-zinc-600" />
                 <input
                   value={userSearch}
                   onChange={(e) => setUserSearch(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') fetchUsers(userSearch); }}
                   placeholder="Search user ID or name..."
                   className="bg-transparent border-none text-sm font-bold text-white focus:outline-none w-full"
                 />
                 <button onClick={() => fetchUsers(userSearch)} className="text-[10px] text-[#ccff00] font-black">GO</button>
               </div>

               <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-4">
                 <textarea
                   value={notifyMessage}
                   onChange={(e) => setNotifyMessage(e.target.value)}
                   placeholder="Message template for user notification..."
                   className="w-full bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold placeholder:text-zinc-600 h-20 focus:ring-2 ring-[#ccff00]/40"
                 />
               </div>

               <div className="space-y-4">
                 {users.map((u) => (
                   <div key={u.telegram_id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-3xl relative space-y-3">
                     <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-2xl bg-[#ccff00] flex items-center justify-center font-black text-black">
                         {(u.name || u.username || 'U').substring(0, 2).toUpperCase()}
                       </div>
                       <div className="min-w-0">
                         <p className="text-sm font-black text-white truncate">{u.name || 'Unknown User'}</p>
                         <div className="flex items-center gap-2 flex-wrap">
                           <span className="text-[10px] font-bold text-[#ccff00] tracking-widest uppercase">{u.role}</span>
                           <span className="w-1 h-1 rounded-full bg-zinc-800" />
                           <span className="text-[10px] font-bold text-zinc-500 uppercase">{u.plan}</span>
                           <span className="w-1 h-1 rounded-full bg-zinc-800" />
                           <span className="text-[10px] font-bold text-zinc-400">ID {u.telegram_id}</span>
                         </div>
                       </div>
                     </div>

                     <div className="flex gap-2">
                       <button onClick={() => promoteUser(u.telegram_id, 'admin')} className="flex-1 py-2 rounded-xl bg-[#ccff00]/10 text-[10px] font-black uppercase text-[#ccff00]">Make Admin</button>
                       <button onClick={() => promoteUser(u.telegram_id, 'user')} className="flex-1 py-2 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-300">Make User</button>
                       <button onClick={() => notifyUser(u.telegram_id)} className="flex-1 py-2 rounded-xl bg-blue-500/10 text-[10px] font-black uppercase text-blue-300">Notify</button>
                     </div>
                   </div>
                 ))}
               </div>
            </motion.div>
          )}

          {activeTab === 'notifications' && (
            <motion.div
              key="notifications"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Push Notification Composer</h3>
                <textarea
                  value={pushForm.message}
                  onChange={(e) => setPushForm({ ...pushForm, message: e.target.value })}
                  placeholder="Notification message..."
                  className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold h-28 focus:outline-none focus:ring-2 ring-[#ccff00]/50"
                />
                <input
                  value={pushForm.image_url}
                  onChange={(e) => setPushForm({ ...pushForm, image_url: e.target.value })}
                  placeholder="Image URL (optional)"
                  className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:outline-none focus:ring-2 ring-[#ccff00]/50"
                />
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer block">
                  Upload image
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadAsDataUrl(file, (dataUrl) => setPushForm({ ...pushForm, image_url: dataUrl }));
                  }} />
                </label>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <input
                      id="withAppButton"
                      type="checkbox"
                      checked={pushForm.with_app_button}
                      onChange={(e) => setPushForm({ ...pushForm, with_app_button: e.target.checked, with_url_button: e.target.checked ? false : pushForm.with_url_button })}
                    />
                    <label htmlFor="withAppButton" className="text-xs font-bold text-zinc-300">Open App Button (sets button text only)</label>
                  </div>

                  {pushForm.with_app_button && (
                    <input 
                      value={pushForm.app_button_text} 
                      onChange={(e) => setPushForm({ ...pushForm, app_button_text: e.target.value })} 
                      placeholder="App button text (e.g., Open Flash AI)" 
                      className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:outline-none focus:ring-2 ring-[#ccff00]/50" 
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      id="withUrlButton"
                      type="checkbox"
                      checked={pushForm.with_url_button}
                      onChange={(e) => setPushForm({ ...pushForm, with_url_button: e.target.checked, with_app_button: e.target.checked ? false : pushForm.with_app_button })}
                    />
                    <label htmlFor="withUrlButton" className="text-xs font-bold text-zinc-300">External URL Button (sets button text + URL)</label>
                  </div>

                  {pushForm.with_url_button && (
                    <div className="grid grid-cols-1 gap-3">
                      <input 
                        value={pushForm.url_button_text} 
                        onChange={(e) => setPushForm({ ...pushForm, url_button_text: e.target.value })} 
                        placeholder="URL button text" 
                        className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:outline-none focus:ring-2 ring-[#ccff00]/50" 
                      />
                      <input 
                        value={pushForm.button_url} 
                        onChange={(e) => setPushForm({ ...pushForm, button_url: e.target.value })} 
                        placeholder="External URL (e.g., https://example.com)" 
                        className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:outline-none focus:ring-2 ring-[#ccff00]/50" 
                      />
                    </div>
                  )}
                </div>

                <select value={pushForm.target_group} onChange={(e) => setPushForm({ ...pushForm, target_group: e.target.value })} className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold focus:outline-none focus:ring-2 ring-[#ccff00]/50">
                  <option value="all">All users</option>
                  <option value="unsubscribed">Unsubscribed users</option>
                  <option value="subscribed">Subscribed users</option>
                  <option value="weekly">Weekly subscribers</option>
                  <option value="monthly">Monthly subscribers</option>
                </select>

                <button disabled={isSendingNotification} onClick={sendPushNotification} className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-black uppercase tracking-widest text-xs disabled:opacity-50">
                  {isSendingNotification ? 'Sending...' : 'Push Notification'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Admin Safety Notice */}
      <div className="px-6 py-4 bg-zinc-950/50 border-t border-zinc-900 flex items-center justify-center gap-2">
         <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] animate-pulse" />
         <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-[2px]">Encrypted Admin Session Active</p>
      </div>
    </div>
  );
};
