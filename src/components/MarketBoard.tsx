import React from 'react';
import { BarChart3, ChevronRight, Dices, ShieldCheck, TrendingUp } from 'lucide-react';
import {
  MarketBoardSection,
  MarketDataQuality,
  MarketPick,
  SuggestedCombo,
} from '../types/prediction';

const qualityStyles: Record<MarketDataQuality, string> = {
  STRONG: 'bg-green-500/10 border-green-500/30 text-green-300',
  MODERATE: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
  LIMITED: 'bg-red-500/10 border-red-500/30 text-red-300',
};

const qualityLabels: Record<MarketDataQuality, string> = {
  STRONG: 'Strong data',
  MODERATE: 'Moderate data',
  LIMITED: 'Limited data',
};

function formatOdds(odds?: number | null): string | null {
  return typeof odds === 'number' && Number.isFinite(odds) && odds > 1
    ? odds.toFixed(2)
    : null;
}

function PickMeta({ pick }: { pick: MarketPick }) {
  const odds = formatOdds(pick.odds);
  const probability = typeof pick.probability === 'number' ? Math.round(pick.probability) : null;
  const edge = typeof pick.edge === 'number' ? pick.edge : null;
  const quality = pick.dataQuality || 'MODERATE';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {probability !== null && (
        <span className="text-[9px] font-black px-2 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/70 text-zinc-300">
          Model {probability}%
        </span>
      )}
      {odds && (
        <span className="text-[9px] font-black px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white">
          @ {odds}
        </span>
      )}
      {edge !== null && (
        <span className="text-[9px] font-black px-2 py-1 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/25 text-[#ccff00]">
          Edge {edge > 0 ? '+' : ''}{edge}%
        </span>
      )}
      <span className={`text-[9px] font-black px-2 py-1 rounded-full border ${qualityStyles[quality]}`}>
        {qualityLabels[quality]}
      </span>
    </div>
  );
}

function ConfidenceBar({ confidence, tone = 'lime' }: { confidence: number; tone?: 'lime' | 'green' | 'blue' }) {
  const barColor = tone === 'green' ? 'bg-green-500' : tone === 'blue' ? 'bg-blue-400' : 'bg-[#ccff00]';

  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }} />
      </div>
      <span className="text-[10px] font-black text-white">{confidence}%</span>
    </div>
  );
}

function BoardPick({ pick }: { pick: MarketPick }) {
  return (
    <div className="bg-black/20 border border-white/5 rounded-2xl p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-black text-white leading-tight">{pick.market}</p>
        <span className="text-[10px] font-black text-[#ccff00] shrink-0">{pick.confidence}%</span>
      </div>
      <div className="mt-2">
        <PickMeta pick={pick} />
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed font-medium mt-2">{pick.reasoning}</p>
    </div>
  );
}

export const PickSummary: React.FC<{
  safePick?: MarketPick;
  valuePick?: MarketPick | null;
  combo?: SuggestedCombo | null;
}> = ({ safePick, valuePick, combo }) => {
  if (!safePick && !valuePick && !combo) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <TrendingUp className="w-3.5 h-3.5 text-[#ccff00]" />
        <p className="text-[10px] font-black text-zinc-500 tracking-widest">Sharp picks</p>
      </div>

      {safePick && (
        <div className="p-4 rounded-[24px] bg-green-500/5 border border-green-500/20">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-green-500/20 rounded-lg">
                <ShieldCheck className="w-4 h-4 text-green-400" />
              </div>
              <span className="text-[10px] font-black tracking-widest text-green-400">Safest pick</span>
            </div>
            <ConfidenceBar confidence={safePick.confidence} tone="green" />
          </div>
          <p className="text-lg font-black text-white tracking-tight">{safePick.market}</p>
          <div className="mt-2">
            <PickMeta pick={safePick} />
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed font-medium mt-2">{safePick.reasoning}</p>
        </div>
      )}

      {valuePick && (
        <div className="p-4 rounded-[24px] bg-[#ccff00]/5 border border-[#ccff00]/20">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#ccff00]/20 rounded-lg">
                <TrendingUp className="w-4 h-4 text-[#ccff00]" />
              </div>
              <span className="text-[10px] font-black tracking-widest text-[#ccff00]">Best value</span>
            </div>
            <ConfidenceBar confidence={valuePick.confidence} />
          </div>
          <p className="text-lg font-black text-white tracking-tight">{valuePick.market}</p>
          <div className="mt-2">
            <PickMeta pick={valuePick} />
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed font-medium mt-2">{valuePick.reasoning}</p>
        </div>
      )}

      {combo && (
        <div className="p-4 rounded-[24px] bg-blue-500/5 border border-blue-500/20">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-500/20 rounded-lg">
                <Dices className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-[10px] font-black tracking-widest text-blue-400">Suggested combo</span>
            </div>
            <ConfidenceBar confidence={combo.confidence} tone="blue" />
          </div>
          <p className="text-sm font-black text-white tracking-tight">{combo.market}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {combo.legs.map((leg, index) => (
              <span
                key={`${leg.market}-${index}`}
                className="text-[9px] font-black px-2 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-200"
              >
                {leg.market} {leg.confidence}%
              </span>
            ))}
            {formatOdds(combo.combinedOdds) && (
              <span className="text-[9px] font-black px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-300">
                @ {formatOdds(combo.combinedOdds)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed font-medium mt-2">{combo.reasoning}</p>
        </div>
      )}
    </div>
  );
};

export const MarketBoard: React.FC<{ sections?: MarketBoardSection[] }> = ({ sections }) => {
  if (!sections?.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-[#ccff00]" />
          <p className="text-[10px] font-black text-zinc-500 tracking-widest">Full market coverage</p>
        </div>
        <span className="text-[9px] font-black text-zinc-600">{sections.length} markets</span>
      </div>

      {sections.map((section, index) => (
        <details
          key={`${section.category}-${index}`}
          open={index === 0}
          className="group bg-zinc-900/30 border border-zinc-800/50 rounded-[24px] overflow-hidden"
        >
          <summary className="p-4 flex items-center justify-between gap-3 cursor-pointer list-none">
            <div className="min-w-0">
              <p className="text-sm font-black text-white">{section.category}</p>
              {section.summary && (
                <p className="text-[10px] text-zinc-500 font-bold mt-0.5 line-clamp-1">{section.summary}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[9px] font-black text-zinc-500">{section.picks.length} picks</span>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-open:rotate-90 transition-transform" />
            </div>
          </summary>
          <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50 pt-3">
            {section.picks.map((pick, pickIndex) => (
              <React.Fragment key={`${pick.market}-${pickIndex}`}>
                <BoardPick pick={pick} />
              </React.Fragment>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
};
