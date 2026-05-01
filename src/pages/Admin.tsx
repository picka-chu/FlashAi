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
import { useUserStore } from '../store/useUserStore';

type AdminTab = 'dashboard' | 'analytics' | 'tasks' | 'ads' | 'users' | 'notifications' | 'reports';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const { tg, hapticFeedback, showAlert, showConfirm, initData } = useTelegram();
  const { user, isLoading: isUserLoading } = useUserStore();
  
  const [stats, setStats] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);

  // Form states for adding items
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [isAddingAd, setIsAddingAd] = useState(false);
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ title: '', description: '', reward: 10, url: '', buttonLabel: 'Start Task', image_url: '', active: true });
  const [newAd, setNewAd] = useState({ 
    title: '', 
    subtitle: '', 
    image_url: '', 
    link: '', 
    is_internal: false,
    internal_target: 'home',
    active: true, 
    cta: 'Check Out', 
    target_group: 'all',
    expires_at: '',
    primary_color: '#3b82f6',
    gradient_to: '#8b5cf6',
    hero_color: '#ffffff',
    sub_color: '#e4e4e7',
    button_text_color: '#111827',
    button_color: '#ffffff',
    hero_size: 32,
    sub_size: 18,
    button_text_size: 14,
    button_radius: 999,
    button_pad_x: 20,
    button_pad_y: 8
  });
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [reportStatusFilter, setReportStatusFilter] = useState<'all' | 'open' | 'reviewing' | 'resolved'>('all');
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [planSelections, setPlanSelections] = useState<Record<string, string>>({});
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
    fetchReports(reportStatusFilter);
  }, [initData]);

  const fetchUsers = async (q = '', page = 1) => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(page));
      params.set('limit', '50');
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setUsers([]);
        setUsersHasMore(false);
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.users;
      setUsers(Array.isArray(rows) ? rows : []);
      setUsersHasMore(Boolean(data?.hasMore));
      setUsersPage(Number(data?.page || page));
    } catch (e) {
      console.error(e);
      setUsers([]);
      setUsersHasMore(false);
    }
  };

  const suspendUser = async (telegramId: number) => {
    showConfirm('Suspend this user? They will not be able to access the app.', async (confirmed) => {
      if (!confirmed) return;

      try {
        const res = await fetch('/api/admin/users/suspend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
          body: JSON.stringify({ telegramId })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          fetchUsers(userSearch, usersPage);
          showAlert('User suspended successfully.');
        } else {
          showAlert(data.error || 'Failed to suspend user');
        }
      } catch (e) {
        showAlert('Error suspending user');
      }
    });
  };

  const deleteUser = async (telegramId: number) => {
    showConfirm('Delete this user and all their data? This action cannot be undone.', async (confirmed) => {
      if (!confirmed) return;

      try {
        const res = await fetch('/api/admin/users/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
          body: JSON.stringify({ telegramId })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          fetchUsers(userSearch, usersPage);
          showAlert('User and all data deleted successfully.');
        } else {
          showAlert(data.error || 'Failed to delete user');
        }
      } catch (e) {
        showAlert('Error deleting user');
      }
    });
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
          is_internal: false,
          internal_target: 'home',
          active: true, 
          cta: 'Check Out', 
          target_group: 'all',
          expires_at: '',
          primary_color: '#3b82f6',
          gradient_to: '#8b5cf6',
          hero_color: '#ffffff',
          sub_color: '#e4e4e7',
          button_text_color: '#111827',
          button_color: '#ffffff',
          hero_size: 32,
          sub_size: 18,
          button_text_size: 14,
          button_radius: 999,
          button_pad_x: 20,
          button_pad_y: 8
        });
        showAlert('Ad added to rotation successfully!');
      }
    } catch (e) {
      showAlert('Failed to add ad');
    }
  };

  const sanitizeNumberish = (value: string, fallback: number) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  };

  const handleEditAd = async () => {
    if (!editingAdId) return;
    try {
      const res = await fetch(`/api/admin/ads/${editingAdId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify(newAd)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || 'Failed to update ad');
        return;
      }
      await fetchAds();
      setEditingAdId(null);
      setIsAddingAd(false);
      showAlert('Ad updated successfully!');
    } catch (e) {
      showAlert('Failed to update ad');
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

  const fetchReports = async (status: 'all' | 'open' | 'reviewing' | 'resolved' = 'all') => {
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`, {
        headers: { 'X-TG-Init-Data': initData }
      });
      if (!res.ok) {
        setReports([]);
        return;
      }
      const data = await res.json();
      setReports(Array.isArray(data) ? data : []);
    } catch (e) {
      setReports([]);
    }
  };

  const updateReportStatus = async (id: string, status: 'open' | 'reviewing' | 'resolved') => {
    try {
      const res = await fetch(`/api/admin/reports/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || 'Failed to update report');
        return;
      }
      fetchReports(reportStatusFilter);
      showAlert(`Report moved to ${status}.`);
    } catch (e) {
      showAlert('Failed to update report.');
    }
  };

  const promoteUser = async (telegramId: number, role: 'user' | 'admin') => {
    const res = await fetch('/api/admin/users/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
      body: JSON.stringify({ telegramId, role })
    });
    if (res.ok) {
      fetchUsers(userSearch, usersPage);
      showAlert(`User updated to ${role}`);
    }
  };

  const assignUserPlan = async (telegramId: number) => {
    const selectedPlan = planSelections[String(telegramId)];
    if (!selectedPlan) {
      showAlert('Please choose a plan first.');
      return;
    }

    const res = await fetch('/api/admin/users/assign-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TG-Init-Data': initData },
      body: JSON.stringify({ telegramId, planId: selectedPlan })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      fetchUsers(userSearch, usersPage);
      showAlert(`Plan updated to ${selectedPlan}.`);
    } else {
      showAlert(data.error || 'Failed to assign plan');
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
         try {
           const res = await fetch(`/api/admin/ads/${id}`, { method: 'DELETE', headers: { 'X-TG-Init-Data': initData } });
           const data = await res.json().catch(() => ({}));
           if (!res.ok) {
             showAlert(data.error || 'Failed to delete ad');
             return;
           }
           fetchAds();
           showAlert('Ad deleted successfully');
         } catch (e) {
           showAlert('Failed to delete ad');
         }
       }
    });
  };

  if (isUserLoading) {
    return (
      <div className="h-full w-full bg-black flex items-center justify-center">
        <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="h-full w-full bg-black flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-black text-white">Access Denied</h2>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Admin role required.</p>
        </div>
      </div>
    );
  }

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

  const handleUploadAsDataUrl = (
    file: File,
    cb: (dataUrl: string) => void,
    options?: { width?: number; height?: number; quality?: number }
  ) => {
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result || '');
      const width = options?.width || 800;
      const height = options?.height || 450;
      const quality = options?.quality || 0.92;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cb(source);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        const scale = Math.min(width / img.width, height / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = (width - drawW) / 2;
        const dy = (height - drawH) / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, dx, dy, drawW, drawH);
        cb(canvas.toDataURL('image/png', quality));
      };
      img.onerror = () => cb(source);
      img.src = source;
    };
    reader.readAsDataURL(file);
  };

  const normalizeInternalTargetLabel = (v: string) => ({
    home: 'Home',
    matches: 'Matches',
    analyze: 'Analyze',
    history: 'History',
    profile: 'Profile',
    livePreview: 'Live Preview'
  } as Record<string,string>)[v] || v;

  const renderAdCard = (ad: any) => {
    const gradientFrom = ad?.primary_color || '#3b82f6';
    const gradientTo = ad?.gradient_to ?? '#8b5cf6';
    const heroColor = ad?.hero_color || '#ffffff';
    const subColor = ad?.sub_color || '#e4e4e7';
    const buttonBg = ad?.button_color || '#ffffff';
    const buttonText = ad?.button_text_color || '#111827';
    const cta = String(ad?.cta ?? 'Learn more');
    const heroSize = Number(ad?.hero_size ?? 32);
    const subSize = Number(ad?.sub_size ?? 18);
    const btnTextSize = Number(ad?.button_text_size ?? 14);
    const btnRadius = Number(ad?.button_radius ?? 999);
    const btnPadX = Number(ad?.button_pad_x ?? 20);
    const btnPadY = Number(ad?.button_pad_y ?? 8);
    return (
      <div className="relative min-w-[300px] w-[300px] h-[164px] rounded-[24px] overflow-hidden border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        style={{ background: `linear-gradient(100deg, ${gradientFrom} 0%, ${gradientTo} 75%)` }}>
        {ad?.image_url ? (
          <img src={ad.image_url} alt="" className="absolute right-2 top-1/2 -translate-y-1/2 h-[78%] w-[36%] object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.22)]" referrerPolicy="no-referrer" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-black/5" />
        <div className="relative z-10 h-full p-5 pr-24 flex flex-col justify-between">
          <div>
            <p className="font-black leading-[1.05] line-clamp-2" style={{ color: heroColor, fontSize: `${heroSize}px` }}>{ad?.title || 'Hero title'}</p>
            <p className="mt-2 font-semibold leading-tight line-clamp-2" style={{ color: subColor, fontSize: `${subSize}px` }}>{ad?.subtitle || 'Sub text goes here'}</p>
          </div>
          <button type="button" className="self-start font-black" style={{ backgroundColor: buttonBg, color: buttonText, fontSize: `${btnTextSize}px`, borderRadius: `${btnRadius}px`, padding: `${btnPadY}px ${btnPadX}px` }}>
            {cta}
          </button>
        </div>
      </div>
    );
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
          {(['dashboard', 'analytics', 'tasks', 'ads', 'users', 'notifications', 'reports'] as AdminTab[]).map(tab => (
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
                onClick={() => { setEditingAdId(null); setIsAddingAd(true); }}
                className="w-full bg-zinc-900 border border-zinc-800 border-dashed py-6 rounded-3xl flex flex-col items-center gap-2 hover:bg-zinc-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-blue-400" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Push New Promotion</p>
              </button>

              <div className="space-y-4">
                <div className="overflow-x-auto no-scrollbar">
                  <div className="flex gap-4 w-max pr-4">
                {ads.map(ad => (
                  <div key={ad.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl min-w-[340px]">
                    <div className="p-4">{renderAdCard(ad)}</div>
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-sm font-black text-white leading-tight">{ad.title || 'Flash Promotion'}</p>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1 line-clamp-1">{ad.subtitle || 'No description'}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setNewAd({ ...newAd, ...ad, expires_at: ad?.expires_at ? String(ad.expires_at).slice(0, 16) : '' });
                              setEditingAdId(ad.id);
                              setIsAddingAd(true);
                            }}
                            className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
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
                          onClick={() => broadcastAd(ad.id, 'monthly_pro')}
                          className="py-2.5 rounded-xl bg-[#ccff00]/10 text-[9px] font-black uppercase text-[#ccff00] hover:bg-[#ccff00] hover:text-black transition-all flex items-center justify-center gap-2"
                        >
                          <Zap className="w-3 h-3" /> Pro
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                  </div>
                </div>
              </div>

              <div className="pt-8">
                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-3xl">
                  <h4 className="text-[10px] font-black text-white/40 uppercase tracking-[4px]">Automation</h4>
                  <p className="text-xs font-bold text-zinc-500 mt-2">FOMO/marketing automations are disabled. Use Notifications for manual broadcasts.</p>
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
                      <h3 className="text-xl font-black text-white">Ads Creation Studio</h3>
                      <p className="text-xs text-zinc-500">Design cards with live preview, custom gradient, typography and CTA behavior.</p>
                      <div className="space-y-4">
                        <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Live Preview</p>
                        <div className="overflow-x-auto no-scrollbar"><div className="w-max pr-4">{renderAdCard(newAd)}</div></div>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Display Content</p>
                           <input value={newAd.title} onChange={e => setNewAd({...newAd, title: e.target.value})} placeholder="Hero text" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           <textarea value={newAd.subtitle} onChange={e => setNewAd({...newAd, subtitle: e.target.value})} placeholder="Sub text" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 h-24 focus:ring-2 ring-blue-500/50" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Gradient from</p><input type="color" value={newAd.primary_color} onChange={e => setNewAd({...newAd, primary_color: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Gradient to</p><input type="color" value={newAd.gradient_to || '#8b5cf6'} onChange={e => setNewAd({...newAd, gradient_to: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Hero color</p><input type="color" value={newAd.hero_color || '#ffffff'} onChange={e => setNewAd({...newAd, hero_color: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Sub color</p><input type="color" value={newAd.sub_color || '#e4e4e7'} onChange={e => setNewAd({...newAd, sub_color: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Button color</p><input type="color" value={newAd.button_color || '#ffffff'} onChange={e => setNewAd({...newAd, button_color: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                          <div className="bg-zinc-800 rounded-2xl p-3"><p className="text-[10px] text-zinc-500 mb-2">Button text color</p><input type="color" value={newAd.button_text_color || '#111827'} onChange={e => setNewAd({...newAd, button_text_color: e.target.value})} className="w-full h-10 rounded-lg" /></div>
                        </div>
                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Image & CTA</p>
                           <input value={newAd.image_url} onChange={e => setNewAd({...newAd, image_url: e.target.value})} placeholder="PNG image URL (right side)" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer block">Upload PNG<input type="file" accept="image/png,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadAsDataUrl(file, (dataUrl) => setNewAd({ ...newAd, image_url: dataUrl }), { width: 480, height: 360, quality: 0.95 }); }} /></label>
                           <input value={newAd.cta} onChange={e => setNewAd({...newAd, cta: e.target.value})} placeholder="Button text" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           <div className="grid grid-cols-2 gap-3">
                             <input type="number" value={newAd.hero_size ?? 32} onChange={e => setNewAd({ ...newAd, hero_size: sanitizeNumberish(e.target.value, 32) })} placeholder="Hero text size" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                             <input type="number" value={newAd.sub_size ?? 18} onChange={e => setNewAd({ ...newAd, sub_size: sanitizeNumberish(e.target.value, 18) })} placeholder="Sub text size" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                             <input type="number" value={newAd.button_text_size ?? 14} onChange={e => setNewAd({ ...newAd, button_text_size: sanitizeNumberish(e.target.value, 14) })} placeholder="Button text size" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                             <input type="number" value={newAd.button_radius ?? 999} onChange={e => setNewAd({ ...newAd, button_radius: sanitizeNumberish(e.target.value, 999) })} placeholder="Button radius" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                             <input type="number" value={newAd.button_pad_x ?? 20} onChange={e => setNewAd({ ...newAd, button_pad_x: sanitizeNumberish(e.target.value, 20) })} placeholder="Button width pad" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                             <input type="number" value={newAd.button_pad_y ?? 8} onChange={e => setNewAd({ ...newAd, button_pad_y: sanitizeNumberish(e.target.value, 8) })} placeholder="Button height pad" className="bg-zinc-800 border-none rounded-2xl p-3 text-white text-xs font-bold" />
                           </div>
                        </div>
                        <div className="space-y-2">
                           <p className="text-[10px] font-bold text-zinc-600 uppercase ml-2">Redirect</p>
                           {!newAd.is_internal ? (
                            <input value={newAd.link} onChange={e => setNewAd({ ...newAd, link: e.target.value })} placeholder="External URL (https://...)" className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold placeholder:text-zinc-600 focus:ring-2 ring-blue-500/50" />
                           ) : (
                            <select value={newAd.internal_target} onChange={e => setNewAd({ ...newAd, internal_target: e.target.value })} className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold focus:outline-none focus:ring-2 ring-blue-500/50">
                              <option value="home">Home page</option><option value="matches">Matches page</option><option value="analyze">Analyze page</option><option value="history">History page</option><option value="profile">Profile page</option><option value="livePreview">Live Preview page</option>
                            </select>
                           )}
                           <label className="flex items-center gap-2 text-xs text-zinc-400 font-bold ml-1 mt-1"><input type="checkbox" checked={newAd.is_internal} onChange={(e) => setNewAd({ ...newAd, is_internal: e.target.checked, link: e.target.checked ? '' : newAd.link })} className="accent-blue-500" />Use internal redirect page selection</label>
                           <select value={newAd.target_group} onChange={e => setNewAd({...newAd, target_group: e.target.value})} className="w-full bg-zinc-800 rounded-2xl p-4 text-white text-sm font-bold focus:outline-none focus:ring-2 ring-blue-500/50"><option value="all">All users</option><option value="unsubscribed">Unsubscribed users</option><option value="subscribed">Subscribed users</option><option value="monthly_basic">Monthly Basic users</option><option value="monthly_pro">Monthly Pro users</option><option value="admin">Admins only</option></select>
                           <input type="datetime-local" value={newAd.expires_at} onChange={e => setNewAd({...newAd, expires_at: e.target.value})} className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-white text-sm font-bold focus:ring-2 ring-blue-500/50" />
                        </div>
<button onClick={editingAdId ? handleEditAd : handleAddAd} className="w-full py-5 bg-blue-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-[0_0_30px_rgba(59,130,246,0.3)]">{editingAdId ? 'Save Ad Changes' : 'Deploy to Rotation'}</button>
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
                   onChange={(e) => {
                     setUserSearch(e.target.value);
                     setUsersPage(1);
                   }}
                   onKeyDown={(e) => { if (e.key === 'Enter') fetchUsers(userSearch, 1); }}
                   placeholder="Search user ID or name..."
                   className="bg-transparent border-none text-sm font-bold text-white focus:outline-none w-full"
                 />
                 <button onClick={() => fetchUsers(userSearch, 1)} className="text-[10px] text-[#ccff00] font-black">GO</button>
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

                     <div className="flex gap-2 flex-wrap">
                       <button onClick={() => promoteUser(u.telegram_id, 'admin')} className="flex-1 min-w-[80px] py-2 rounded-xl bg-[#ccff00]/10 text-[10px] font-black uppercase text-[#ccff00]">Make Admin</button>
                       <button onClick={() => promoteUser(u.telegram_id, 'user')} className="flex-1 min-w-[80px] py-2 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-300">Make User</button>
                       <button onClick={() => notifyUser(u.telegram_id)} className="flex-1 min-w-[80px] py-2 rounded-xl bg-blue-500/10 text-[10px] font-black uppercase text-blue-300">Notify</button>
                       <button onClick={() => suspendUser(u.telegram_id)} className="flex-1 min-w-[80px] py-2 rounded-xl bg-orange-500/10 text-[10px] font-black uppercase text-orange-400">Suspend</button>
                       <button onClick={() => deleteUser(u.telegram_id)} className="flex-1 min-w-[80px] py-2 rounded-xl bg-red-500/10 text-[10px] font-black uppercase text-red-400">Delete</button>
                     </div>
                     <div className="flex gap-2 items-center">
                       <select
                         value={planSelections[String(u.telegram_id)] || u.plan || 'free'}
                         onChange={(e) => setPlanSelections((prev) => ({ ...prev, [String(u.telegram_id)]: e.target.value }))}
                         className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-[10px] font-black uppercase text-zinc-200"
                       >
                         <option value="free">Free Trial</option>
                         <option value="monthly_basic">Monthly Basic</option>
                         <option value="monthly_pro">Monthly Pro</option>
                         <option value="admin">Admin</option>
                       </select>
                       <button
                         onClick={() => assignUserPlan(u.telegram_id)}
                         className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-black uppercase text-emerald-300"
                       >
                         Assign Plan
                       </button>
                     </div>
                   </div>
                 ))}
               </div>
               <div className="flex items-center justify-between">
                 <button
                   type="button"
                   disabled={usersPage <= 1}
                   onClick={() => fetchUsers(userSearch, Math.max(1, usersPage - 1))}
                   className="px-3 py-2 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-300 disabled:opacity-50"
                 >
                   Previous
                 </button>
                 <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Page {usersPage}</span>
                 <button
                   type="button"
                   disabled={!usersHasMore}
                   onClick={() => fetchUsers(userSearch, usersPage + 1)}
                   className="px-3 py-2 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-300 disabled:opacity-50"
                 >
                   Next
                 </button>
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
                  <option value="monthly_basic">Monthly Basic subscribers</option>
                  <option value="monthly_pro">Monthly Pro subscribers</option>
                </select>

                <button disabled={isSendingNotification} onClick={sendPushNotification} className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-black uppercase tracking-widest text-xs disabled:opacity-50">
                  {isSendingNotification ? 'Sending...' : 'Push Notification'}
                </button>
              </div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">User Reports</h3>
                <div className="flex gap-2 items-center">
                  <select
                    value={reportStatusFilter}
                    onChange={(e) => {
                      const status = e.target.value as 'all' | 'open' | 'reviewing' | 'resolved';
                      setReportStatusFilter(status);
                      fetchReports(status);
                    }}
                    className="flex-1 bg-zinc-800 rounded-2xl p-3 text-white text-xs font-bold focus:outline-none"
                  >
                    <option value="all">All reports</option>
                    <option value="open">Open</option>
                    <option value="reviewing">Reviewing</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <button onClick={() => fetchReports(reportStatusFilter)} className="px-4 py-3 rounded-2xl bg-[#ccff00] text-black text-xs font-black uppercase">
                    Refresh
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {reports.map((report) => (
                  <div key={report.id} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">{report.subject}</p>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
                          {report.category} • {report.name || 'Unknown'} • ID {report.telegram_id}
                        </p>
                      </div>
                      <span className="px-2 py-1 rounded-lg bg-zinc-800 text-[10px] font-black uppercase text-zinc-300">{report.status}</span>
                    </div>
                    <p className="text-xs font-semibold text-zinc-300 whitespace-pre-wrap">{report.details}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => updateReportStatus(report.id, 'open')} className="py-2 rounded-xl bg-zinc-800 text-[10px] font-black uppercase text-zinc-300">Open</button>
                      <button onClick={() => updateReportStatus(report.id, 'reviewing')} className="py-2 rounded-xl bg-blue-500/10 text-[10px] font-black uppercase text-blue-300">Reviewing</button>
                      <button onClick={() => updateReportStatus(report.id, 'resolved')} className="py-2 rounded-xl bg-green-500/10 text-[10px] font-black uppercase text-green-300">Resolved</button>
                    </div>
                  </div>
                ))}
                {reports.length === 0 && (
                  <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl text-center">
                    <p className="text-xs font-bold text-zinc-500">No reports found for this filter.</p>
                  </div>
                )}
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
