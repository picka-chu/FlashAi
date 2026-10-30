import React from 'react';
import { ChevronRight } from 'lucide-react';
import { TeamLogo } from '../TeamLogo';

interface FixtureRowProps {
  match: any;
  onClick: () => void;
  isLast?: boolean;
}

/**
 * One fixture in a list. Left: kick-off time, live minute or full-time.
 * Middle: each team on its own line with its crest. Right: scores once played.
 */
export const FixtureRow: React.FC<FixtureRowProps> = ({ match, onClick, isLast = false }) => {
  const state = match?.fixture?.status?.state;
  const isLive = state === 'in';
  const isFinished = state === 'post';
  const hasScore = Boolean(match.score && match.score !== '--');
  const [homeGoals, awayGoals] = hasScore ? String(match.score).split('-') : ['', ''];

  const statusLabel = isLive ? match.minute : isFinished ? 'FT' : match.time;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02] active:bg-white/[0.04] ${
        isLast ? '' : 'border-b border-[var(--border)]'
      }`}
    >
      <span
        className={`tabular w-12 shrink-0 text-[13px] font-medium ${
          isLive ? 'text-[var(--primary)]' : isFinished ? 'text-[var(--text-subtle)]' : 'text-[var(--text-strong)]'
        }`}
      >
        {statusLabel}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamLogo name={match.home} logo={match.homeLogo} className="h-7 w-7 rounded-full ring-1 ring-white/10" textClassName="text-[10px]" />
          <span className="truncate text-[14px] text-[var(--text-strong)]">{match.home}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamLogo name={match.away} logo={match.awayLogo} className="h-7 w-7 rounded-full ring-1 ring-white/10" textClassName="text-[10px]" />
          <span className="truncate text-[14px] text-[var(--text-strong)]">{match.away}</span>
        </div>
      </div>

      {hasScore && (
        <div className="tabular flex shrink-0 flex-col gap-2 text-right text-[14px] font-semibold text-[var(--text-strong)]">
          <span>{homeGoals}</span>
          <span>{awayGoals}</span>
        </div>
      )}

      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5" />
    </button>
  );
};
