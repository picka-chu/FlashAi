import React from 'react';
import { BottomNav, TabType } from './BottomNav';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, activeTab, onTabChange }) => {
  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--background)] text-[var(--foreground)] font-sans antialiased selection:bg-[var(--primary)]/25 overflow-hidden relative">
      <main className="flex-1 min-h-0 overflow-hidden relative">{children}</main>

      {activeTab !== 'livePreview' && (
        <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
      )}
    </div>
  );
};
