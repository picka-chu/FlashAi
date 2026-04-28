import React from 'react';
import { Home, History, User, Goal, Zap, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useUserStore } from '../../store/useUserStore';

export type TabType = 'home' | 'matches' | 'analyze' | 'history' | 'profile' | 'admin' | 'livePreview';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  const { user } = useUserStore();

  const NAV_ITEMS = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'matches', icon: Goal, label: 'Matches' },
    { id: 'analyze', icon: Zap, label: 'Analyze' },
    ...(user?.phone ? [
      { id: 'history', icon: History, label: 'History' },
      { id: 'profile', icon: User, label: 'Profile' }
    ] : []),
    ...(user?.role === 'admin' ? [{ id: 'admin', icon: ShieldAlert, label: 'Admin' }] : []),
  ] as const;

  return (
    <nav className="flex-none bg-black/80 backdrop-blur-xl border-t border-zinc-800/50 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)] z-50">
      <div className="flex items-stretch justify-between max-w-md mx-auto w-full gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id as TabType)}
              className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 px-1 transition-all duration-300"
            >
              <Icon 
                className={`w-5 h-5 transition-all duration-300 ${isActive ? 'text-[#ccff00] scale-110 drop-shadow-[0_0_8px_rgba(204,255,0,0.5)]' : 'text-zinc-500'}`} 
              />
              <span className={`text-[10px] font-bold transition-all duration-300 ${isActive ? 'text-[#ccff00]' : 'text-zinc-500'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
