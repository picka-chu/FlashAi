import React from 'react';
import { BottomNav, TabType } from './BottomNav';
import { useUserStore } from '../../store/useUserStore';
import { Coins, Zap } from 'lucide-react';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ 
  children, 
  activeTab, 
  onTabChange
}) => {
  const { user } = useUserStore();

  return (
    <div className="h-[100dvh] flex flex-col bg-black text-white font-sans selection:bg-[#ccff00]/30 overflow-hidden relative">
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
      
      <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
};
