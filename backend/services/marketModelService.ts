/**
 * Statistical market model — scores every bookable market for a fixture.
 *
 * Dixon-Coles Poisson (via predictionEngine) covers goals markets.
 * Corners / cards / HT-FT / correct score use calibrated Poisson lambdas
 * with league-average priors when live stats are missing.
 *
 * Pure computation + BSD data — no Gemini calls, so it can run inside
 * /api/analyze before the AI step and feed structuredContext.
 */

import type { MatchData, Probabilities } from '../../src/types/prediction';
import {
  adjustProbabilities,
  calculatePoissonProbabilities,
  calculateValue,
  computeFeatures,
  selectBestBet,
} from './predictionEngine';

type ValueBetRow = ReturnType<typeof calculateValue>[number];

export interface MarketModelResult {
  lambdaHome: number;
  lambdaAway: number;
  dataQuality: number;
  probs: Probabilities & { over45: number; under45: number; csHome: number; csAway: number };
  valueBets: ValueBetRow[];
  bestBet: ReturnType<typeof selectBestBet>;
  scorelines: { score: string; prob: number }[];
  corners: { lambda: number; lines: { label: string; over: number; under: number }[] };
  cards: { lambda: number; lines: { label: string; over: number; under: number }[] };
  htFt: { label: string; prob: number }[];
  correctScore: string | null;
}

const FACT: number[] = [1];
for (let i = 1; i <= 12; i++) FACT[i] = FACT[i - 1] * i;
const poissonP = (k: number, lambda: number) =>
  (Math.pow(lambda, k) * Math.exp(-lambda)) / FACT[Math.min(k, 12)];

function overUnder(lambda: number, line: number) {
  let over = 0;
  for (let k = 0; k <= 12; k++) over += poissonP(k, lambda) * (k > line ? 1 : 0);
  return { over, under: 1 - over };
}

function parseStatPair(pair: any): [number, number] {
  if (!pair) return [0, 0];
  return [Number(pair.home) || 0, Number(pair.away) || 0];
}

function neutralContext() {
  return {
    home_missing: 0,
    away_missing: 0,
    home_motivation: 'MEDIUM' as const,
    away_motivation: 'MEDIUM' as const,
    home_fatigue: false,
    away_fatigue: false,
    reasoning: 'Neutral prior — no confirmed absences or motivation shifts applied.',
  };
}

export function computeMarketModel(
  matchData: MatchData,
  extras: {
    bsdMatch?: any;
    h2h?: any;
  } = {},
): MarketModelResult {
  const { lambdaHome, lambdaAway, dataQuality, homeFormScore, awayFormScore } =
    computeFeatures(matchData) as any;

  const base = calculatePoissonProbabilities(lambdaHome, lambdaAway);
  const probs = { ...base, ...adjustProbabilities(base, neutralContext() as any) } as any;
  // adjustProbabilities returns without over45/cs — restore from base grid
  probs.over45 = base.over45;
  probs.under45 = base.under45;
  probs.csHome = base.csHome;
  probs.csAway = base.csAway;

  const odds = matchData.odds || {};
  const valueBets = calculateValue(probs, odds);
  const bestBet = selectBestBet(valueBets, probs);

  // ── Correct score from Poisson grid ────────────────────────────────────
  const scorelines: { score: string; prob: number }[] = [];
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      scorelines.push({ score: `${h}-${a}`, prob: poissonP(h, lambdaHome) * poissonP(a, lambdaAway) });
    }
  }
  scorelines.sort((x, y) => y.prob - x.prob);
  const topScores = scorelines.slice(0, 5);

  // ── HT/FT — half lambdas, near-independent halves ──────────────────────
  const halfH = lambdaHome / 2;
  const halfA = lambdaAway / 2;
  const halfGrid = { h: 0 as number, d: 0 as number, a: 0 as number };
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poissonP(h, halfH) * poissonP(a, halfA);
      if (h > a) halfGrid.h += p; else if (h < a) halfGrid.a += p; else halfGrid.d += p;
    }
  }
  const full = { h: probs.homeWin, d: probs.draw, a: probs.awayWin };
  const htFtRaw: [string, number][] = [
    ['HT/FT Home-Home', halfGrid.h * full.h],
    ['HT/FT Home-Draw', halfGrid.h * full.d],
    ['HT/FT Home-Away', halfGrid.h * full.a],
    ['HT/FT Draw-Home', halfGrid.d * full.h],
    ['HT/FT Draw-Draw', halfGrid.d * full.d],
    ['HT/FT Draw-Away', halfGrid.d * full.a],
    ['HT/FT Away-Home', halfGrid.a * full.h],
    ['HT/FT Away-Draw', halfGrid.a * full.d],
    ['HT/FT Away-Away', halfGrid.a * full.a],
  ];
  const htFt = htFtRaw
    .map(([label, prob]) => ({ label, prob: Math.min(0.99, prob) }))
    .sort((x, y) => y.prob - x.prob);

  // ── Corners — league prior ~10.2 total, home bias 52%, live stats override ─
  const liveCorners = extras.bsdMatch?.stats?.corners;
  let cornerLambda = 10.2;
  if (liveCorners) {
    const [ch, ca] = parseStatPair(liveCorners);
    if (ch + ca > 0) cornerLambda = ch + ca + 4.5; // completed + expected remainder
  } else {
    // High-xG sides win more corners
    cornerLambda += Math.min(1.5, Math.abs(lambdaHome - lambdaAway) * 1.2);
  }
  const cornerLines = [8.5, 9.5, 10.5, 11.5].map((line) => {
    const { over, under } = overUnder(cornerLambda, line);
    return { label: `Corners Over/Under ${line}`, over, under };
  });

  // ── Cards — league prior ~3.8 yellows (+0.4 reds) ─────────────────────
  const liveCards = extras.bsdMatch?.stats?.yellowCards;
  let cardLambda = 3.8;
  if (liveCards) {
    const [yh, ya] = parseStatPair(liveCards);
    if (yh + ya > 0) cardLambda = yh + ya + 1.6;
  }
  const cardLines = [2.5, 3.5, 4.5, 5.5].map((line) => {
    const { over, under } = overUnder(cardLambda, line);
    return { label: `Cards Over/Under ${line}`, over, under };
  });

  return {
    lambdaHome,
    lambdaAway,
    dataQuality,
    probs,
    valueBets,
    bestBet,
    scorelines: topScores,
    corners: { lambda: cornerLambda, lines: cornerLines },
    cards: { lambda: cardLambda, lines: cardLines },
    htFt,
    correctScore: topScores[0]?.score ?? null,
  };
}

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

/** Compact, model-grounded context block injected into the Gemini prompt. */
export function buildMarketContextBlock(
  matchData: MatchData,
  model: MarketModelResult,
  extras: { h2h?: any; bsdMatch?: any } = {},
): string {
  const odds = matchData.odds || {};
  const h2h = extras.h2h;
  const bsd = extras.bsdMatch;

  const oddsLine = Object.entries(odds)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number' && (v as number) > 1.01)
    .slice(0, 40)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const valueLine = model.valueBets
    .slice(0, 8)
    .map(
      (v) =>
        `${v.market}: model ${pct(v.modelProb)} vs implied ${pct(v.impliedProb)} (edge ${pct(v.value)}, EV ${pct(v.ev)})`,
    )
    .join('\n');

  const htLine = model.htFt.slice(0, 4).map((h) => `${h.label} ${pct(h.prob)}`).join(', ');
  const cornerLine = model.corners.lines
    .map((c) => `${c.label.replace('/Under', '')}: over ${pct(c.over)} / under ${pct(c.under)}`)
    .join('; ');
  const cardLine = model.cards.lines
    .map((c) => `${c.label.replace('/Under', '')}: over ${pct(c.over)} / under ${pct(c.under)}`)
    .join('; ');
  const scoreLine = model.scorelines
    .map((s) => `${s.score} ${pct(s.prob)}`)
    .join(', ');

  return [
    'STATISTICAL MARKET MODEL (Dixon-Coles Poisson, computed server-side — trust these over guesses):',
    `- Expected goals: home λ=${model.lambdaHome.toFixed(3)}, away λ=${model.lambdaAway.toFixed(3)}. Data quality ${(model.dataQuality * 100).toFixed(0)}%.`,
    `- 1X2: Home ${pct(model.probs.homeWin)} | Draw ${pct(model.probs.draw)} | Away ${pct(model.probs.awayWin)}`,
    `- Double Chance: 1X ${pct(model.probs.dc1X)} | X2 ${pct(model.probs.dcX2)} | 12 ${pct(model.probs.dc12)}`,
    `- Over/Under: O1.5 ${pct(model.probs.over15)} | O2.5 ${pct(model.probs.over25)} | O3.5 ${pct(model.probs.over35)} | O4.5 ${pct(model.probs.over45)}`,
    `- BTTS: Yes ${pct(model.probs.bttsYes)} | No ${pct(model.probs.bttsNo)}`,
    `- DNB: Home ${pct(model.probs.dnb1)} | Away ${pct(model.probs.dnb2)}`,
    `- Clean sheet: Home ${pct(model.probs.csHome)} | Away ${pct(model.probs.csAway)}`,
    `- Correct score top: ${scoreLine}`,
    `- HT/FT top: ${htLine}`,
    `- Corners λ=${model.corners.lambda.toFixed(2)}: ${cornerLine}`,
    `- Cards λ=${model.cards.lambda.toFixed(2)}: ${cardLine}`,
    oddsLine ? `- Book odds: ${oddsLine}` : '- Book odds: unavailable',
    valueLine ? `VALUE BETS (model edge over book):\n${valueLine}` : 'VALUE BETS: none above +1% edge.',
    model.bestBet
      ? `- BEST MODEL PICK: ${model.bestBet.market} @ ${model.bestBet.odds ? model.bestBet.odds.toFixed(2) : 'n/a'} (model ${pct(model.bestBet.modelProb)})`
      : '- BEST MODEL PICK: no strong edge',
    h2h
      ? `- H2H: ${h2h.summary || 'n/a'} over ${h2h.totalMatches ?? '?'} matches; avg goals ${h2h.avgGoals ?? '?'}; home wins ${h2h.homeWins ?? 0}, draws ${h2h.draws ?? 0}, away wins ${h2h.awayWins ?? 0}; last5 ${JSON.stringify(h2h.last5 || [])}`
      : '- H2H: unavailable',
    bsd?.stats
      ? `- Live/last stats: possession ${bsd.stats.possession?.home}/${bsd.stats.possession?.away}, shots ${bsd.stats.shots?.home}/${bsd.stats.shots?.away}, on target ${bsd.stats.shotsOnTarget?.home}/${bsd.stats.shotsOnTarget?.away}, corners ${bsd.stats.corners?.home}/${bsd.stats.corners?.away}, yellow ${bsd.stats.yellowCards?.home}/${bsd.stats.yellowCards?.away}`
      : '- Live stats: unavailable',
    bsd?.xG ? `- xG: home ${bsd.xG.home}, away ${bsd.xG.away}` : '',
    'When ranking picks, cross-check model probabilities against book odds and prefer markets with both a solid model probability (>45%) and positive value. Always include at least one corners/cards or HT/FT pick when model confidence is meaningful.',
  ]
    .filter(Boolean)
    .join('\n');
}
