import React from 'react';
import { Home, History, User, Goal, Zap, ShieldAlert } from 'lucide-react';
import { useUserStore } from '../../store/useUserStore';

export type TabType = 'home' | 'matches' | 'analyze' | 'history' | 'profile' | 'admin' | 'livePreview' | 'subscriptions' | 'paymentMethods' | 'referralEarn' | 'support';

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
    ...((user?.phone || user?.role === 'admin') ? [
      { id: 'history', icon: History, label: 'History' },
      { id: 'profile', icon: User, label: 'Profile' },
    ] : []),
    ...(user?.role === 'admin' ? [{ id: 'admin', icon: ShieldAlert, label: 'Admin' }] : []),
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="flex-none z-50 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 bg-[var(--surface-0)]/90 backdrop-blur-md"
    >
      <div className="mx-auto w-full max-w-md flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-card)]">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id as TabType)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/60 ${
                isActive ? 'bg-[var(--accent-soft)]' : 'hover:bg-white/[0.03]'
              }`}
            >
              <Icon
                strokeWidth={isActive ? 2.25 : 1.75}
                className={`h-5 w-5 transition-colors duration-200 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--text-subtle)]'}`}
              />
              <span
                className={`text-[11px] leading-none font-medium tracking-tight truncate max-w-full transition-colors duration-200 ${
                  isActive ? 'text-[var(--text-strong)]' : 'text-[var(--text-subtle)]'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
