import React from 'react';
import {
  Zap,
  Trophy,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { TeamLogo } from '../components/TeamLogo';

/* ---------- Small presentational pieces ---------- */

export const SectionHeader: React.FC<{ title: string; action?: string; onAction?: () => void; icon?: React.ReactNode }> = ({ title, action, onAction, icon }) => (
  <div className="flex items-center justify-between gap-3">
    <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--text-strong)]">
      {icon}
      {title}
    </h2>
    {action && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="flex items-center gap-0.5 text-[13px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
      >
        {action}
        <ChevronRight className="h-4 w-4" />
      </button>
    )}
  </div>
);

export const StatusPill: React.FC<{ tone: 'live' | 'upcoming' | 'final'; children: React.ReactNode; dark?: boolean }> = ({ tone, children, dark }) => {
  const styles = {
    live: dark ? 'bg-black/15 text-black' : 'bg-[var(--accent-soft)] text-[var(--primary)]',
    upcoming: dark ? 'bg-black/15 text-black' : 'bg-white/[0.06] text-[var(--text-muted)]',
    final: dark ? 'bg-black/15 text-black' : 'bg-white/[0.06] text-[var(--text-muted)]',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${styles}`}>
      {tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
};

export const OddsChip: React.FC<{ label: string; value?: number | null }> = ({ label, value }) => (
  <div className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-white/[0.04] py-2">
    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">{label}</span>
    <span className="tabular text-[13px] font-semibold text-[var(--text-strong)]">{value ? value.toFixed(2) : '–'}</span>
  </div>
);

export const FeaturedMatch: React.FC<{
  match: any;
  eyebrow: string;
  onClick: () => void;
}> = ({ match, eyebrow, onClick }) => {
  const state = match?.fixture?.status?.state;
  const isLive = state === 'in' || match.status === 'Live';
  const isPre = state === 'pre' || match.status === 'Upcoming';
  const hasScore = !isPre && Boolean(match.score) && match.score !== '--';
  const odds = match.odds;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative isolate w-full overflow-hidden rounded-[28px] border border-white/15 bg-gradient-to-br from-[#d6ff57] via-[#b9ec35] to-[#8fbd19] p-5 text-left text-[#111609] shadow-[0_16px_40px_rgba(151,205,32,0.16)] transition-all duration-200 active:scale-[0.99]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full border-[24px] border-black/[0.04]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/10">
            <Trophy className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold tracking-tight">{match.league}</p>
            <p className="mt-0.5 text-[10px] font-medium opacity-65">{match.date || 'Upcoming fixture'}{match.time ? ` · ${match.time}` : ''}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-black/10 bg-black/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide">
          {isLive ? match.minute : eyebrow}
        </span>
      </div>

      <div className="relative mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamLogo name={match.home} logo={match.homeLogo} className="h-[60px] w-[60px] rounded-full border border-black/10 bg-white/80 p-1 shadow-sm" textClassName="text-base" />
          <span className="line-clamp-2 min-h-[34px] text-[13px] font-bold leading-tight">{match.home}</span>
        </div>
        <div className="flex flex-col items-center">
          {hasScore ? (
            <span className="tabular text-[30px] font-semibold leading-none tracking-tight">{match.score}</span>
          ) : (
            <>
              <span className="rounded-2xl border border-black/10 bg-black/[0.06] px-3 py-2 tabular text-[22px] font-black leading-none">{match.time}</span>
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wide opacity-60">Kick-off</span>
            </>
          )}
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamLogo name={match.away} logo={match.awayLogo} className="h-[60px] w-[60px] rounded-full border border-black/10 bg-white/80 p-1 shadow-sm" textClassName="text-base" />
          <span className="line-clamp-2 min-h-[34px] text-[13px] font-bold leading-tight">{match.away}</span>
        </div>
      </div>

      {odds && (odds.home || odds.draw || odds.away) && (
        <div className="mt-5 flex gap-2">
          <OddsChip label="1" value={odds.home} />
          <OddsChip label="X" value={odds.draw} />
          <OddsChip label="2" value={odds.away} />
        </div>
      )}

      <div className="relative mt-5 flex items-center justify-between rounded-2xl bg-[#10130a] px-4 py-3.5 text-[13px] font-semibold text-white shadow-sm transition-transform group-hover:translate-y-[-1px]">
        <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-[#d6ff57]" /> Get AI match analysis</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10"><ChevronRight className="h-4 w-4" /></span>
      </div>
    </button>
  );
};

export const ResultCard: React.FC<{ match: any; onClick: () => void }> = ({ match, onClick }) => {
  const [rawHome, rawAway] = String(match.score || '0-0').split('-');
  const homeGoals = Number(rawHome) || 0;
  const awayGoals = Number(rawAway) || 0;
  const homeWon = homeGoals > awayGoals;
  const awayWon = awayGoals > homeGoals;

  const TeamRow = ({
    name,
    logo,
    goals,
    won,
  }: {
    name: string;
    logo?: string | null;
    goals: number;
    won: boolean;
  }) => (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 shrink-0 rounded-full border border-zinc-700/40 bg-zinc-800/50 p-1 shadow-inner overflow-hidden">
        <TeamLogo name={name} logo={logo} className="h-full w-full" textClassName="text-[10px]" />
      </div>
      <span
        className={`min-w-0 flex-1 truncate text-[13px] leading-tight ${
          won ? 'font-semibold text-[var(--text-strong)]' : 'text-[var(--text-muted)]'
        }`}
      >
        {name}
      </span>
      <span
        className={`tabular text-[16px] font-bold leading-none ${\n          won ? 'text-[var(--primary)]' : 'text-[var(--text-strong)]'
        }`}
      >
        {goals}
      </span>
    </div>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-[260px] shrink-0 flex-col gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left transition-colors active:bg-[var(--surface-2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-[var(--text-subtle)]">{match.league}</span>
        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-muted)]">FT</span>
      </div>
      <div className="space-y-3">
        <TeamRow name={match.home} logo={match.homeLogo} goals={homeGoals} won={homeWon} />
        <TeamRow name={match.away} logo={match.awayLogo} goals={awayGoals} won={awayWon} />
      </div>
      <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-subtle)] transition-colors group-hover:text-[var(--primary)]">
        Analyze result
        <ChevronRight className="h-3 w-3" />
      </span>
    </button>
  );
};
