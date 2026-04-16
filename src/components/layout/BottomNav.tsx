import React from 'react';
import { Home, History, User, Goal, Zap } from 'lucide-react';
import { motion } from 'motion/react';

export type TabType = 'home' | 'matches' | 'analyze' | 'history' | 'profile';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const NAV_ITEMS = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'matches', icon: Goal, label: 'Matches' },
  { id: 'analyze', icon: Zap, label: 'Analyze' },
  { id: 'history', icon: History, label: 'History' },
  { id: 'profile', icon: User, label: 'Profile' },
] as const;

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="flex-none bg-black/80 backdrop-blur-xl border-t border-zinc-800/50 px-2 pb-8 pt-2 z-50">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="relative flex flex-col items-center gap-1 py-2 px-4 transition-all duration-300"
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
