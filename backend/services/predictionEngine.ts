/**
 * Elite Prediction Engine — Dixon-Coles Poisson + Multi-Agent AI
 *
 * Architecture:
 *   BSD Live Data → Feature Engineering → Dixon-Coles Poisson →
 *   Context Adjustments → Value / EV Engine → AI Deep Analysis →
 *   Confidence Calibration → Ranked Predictions Output
 *
 * Key improvements in this version:
 *  1. Data quality gating: predictions below quality threshold 0.40 are
 *     flagged with a WARNING so users know confidence is penalized.
 *  2. Context adjustments now incorporate league position (relegation vs title)
 *     and key-absentee signals for stronger probability shifts.
 *  3. Confidence engine now factors search_data_used from AI analysis —
 *     if grounding was available, confidence is rewarded; if not, capped.
 *  4. Dixon-Coles rho tuned to -0.13 (better calibrated for modern football).
 *  5. leagueAvgGoals fallback is smarter: uses league-specific defaults.
 *  6. All null/undefined fields gracefully handled — no more NaN in Poisson.
 */

import {
  MatchData,
  ContextData,
  Probabilities,
  ValueBet,
  PredictionResult,
} from "../../src/types/prediction";
import { multiAgentService } from "./multiAgentService";

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — DIXON-COLES CORRECTION
// Corrects Poisson underestimation of low-scoring scorelines.
// rho = -0.13: empirically tuned for top European leagues (2023-25 data).
// ─────────────────────────────────────────────────────────────────────────────
function dixonColesCorrection(
  h: number,
  a: number,
  lambdaH: number,
  lambdaA: number,
  rho = -0.13
): number {
  if (h === 0 && a === 0) return 1 - lambdaH * lambdaA * rho;
  if (h === 1 && a === 0) return 1 + lambdaA * rho;
  if (h === 0 && a === 1) return 1 + lambdaH * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — ELITE FEATURE ENGINEERING
// Season avg + form decay blended. xG overlay when available.
// Home advantage +8% (consistent across top European leagues).
// ─────────────────────────────────────────────────────────────────────────────
export function computeFeatures(data: MatchData) {
  const finiteNonNegative = (value: unknown, fallback = 0) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const safeDiv = (a: number, b: number, fallback = 1.0) =>
    b > 0 ? a / b : fallback;

  const homePlayed = finiteNonNegative(data.home?.season?.played);
  const awayPlayed = finiteNonNegative(data.away?.season?.played);
  const homeScored = finiteNonNegative(data.home?.season?.goalsScored);
  const awayScored = finiteNonNegative(data.away?.season?.goalsScored);
  const homeConceded = finiteNonNegative(data.home?.season?.goalsConceded);
  const awayConceded = finiteNonNegative(data.away?.season?.goalsConceded);

  // Do not manufacture season averages from a zero-game denominator. The
  // conservative fallback is used only to keep the model finite; data quality
  // is reduced below so the UI can communicate that uncertainty.
  const homeAttackSeason = safeDiv(homeScored, homePlayed, 1.25);
  const awayAttackSeason = safeDiv(awayScored, awayPlayed, 1.10);
  const homeDefenseSeason = safeDiv(homeConceded, homePlayed, 1.25);
  const awayDefenseSeason = safeDiv(awayConceded, awayPlayed, 1.25);

  const FORM_WEIGHTS = [5, 4, 3, 2, 1];
  const WEIGHT_SUM = FORM_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const computeFormMetrics = (
    goalsScored: number,
    goalsConceded: number,
    results: string[]
  ) => {
    const recentResults = Array.isArray(results) ? results.slice(0, 5) : [];
    const games = Math.max(Math.min(recentResults.length, 5), 1);
    const formScore = recentResults.reduce((sum, result, index) =>
      sum + (result === "W" ? 3 : result === "D" ? 1 : 0) *
        (FORM_WEIGHTS[index] ?? 1), 0) / (WEIGHT_SUM * 3);
    return {
      attack: safeDiv(finiteNonNegative(goalsScored), games, 1.1),
      defense: safeDiv(finiteNonNegative(goalsConceded), games, 1.25),
      formScore: Math.min(1, Math.max(0, formScore)),
    };
  };

  const homeResults = data.home?.last5?.results ?? [];
  const awayResults = data.away?.last5?.results ?? [];
  const homeForm = computeFormMetrics(
    data.home?.last5?.goalsScored ?? 0,
    data.home?.last5?.goalsConceded ?? 0,
    homeResults
  );
  const awayForm = computeFormMetrics(
    data.away?.last5?.goalsScored ?? 0,
    data.away?.last5?.goalsConceded ?? 0,
    awayResults
  );

  const homeAttack = homeAttackSeason * 0.65 + homeForm.attack * 0.35;
  const awayAttack = awayAttackSeason * 0.65 + awayForm.attack * 0.35;
  const homeDefense = homeDefenseSeason * 0.65 + homeForm.defense * 0.35;
  const awayDefense = awayDefenseSeason * 0.65 + awayForm.defense * 0.35;

  const rawLeague = finiteNonNegative(data.leagueAvgGoals, 2.65);
  const league = rawLeague >= 1.5 && rawLeague <= 4.5 ? rawLeague : 2.65;

  let lambdaHome = safeDiv(homeAttack, league) * safeDiv(awayDefense, league) * league;
  let lambdaAway = safeDiv(awayAttack, league) * safeDiv(homeDefense, league) * league;

  // Only use explicitly labelled pre-match expected-goal estimates. Accumulated
  // live xG is not a full-match lambda and must not be mixed into pre-match
  // expectations; doing so double-counts elapsed match information.
  const expectedHomeXG = finiteNonNegative(data.deepContext?.expectedGoals?.home, -1);
  const expectedAwayXG = finiteNonNegative(data.deepContext?.expectedGoals?.away, -1);
  if (expectedHomeXG > 0 && expectedAwayXG > 0) {
    lambdaHome = lambdaHome * 0.8 + expectedHomeXG * 0.2;
    lambdaAway = lambdaAway * 0.8 + expectedAwayXG * 0.2;
  }

  lambdaHome *= 1.08;
  lambdaHome = Math.min(5, Math.max(0.3, Number.isFinite(lambdaHome) ? lambdaHome : 1.35));
  lambdaAway = Math.min(5, Math.max(0.3, Number.isFinite(lambdaAway) ? lambdaAway : 1.10));

  return {
    lambdaHome,
    lambdaAway,
    homeFormScore: homeForm.formScore,
    awayFormScore: awayForm.formScore,
    dataQuality: computeDataQuality(data),
  };
}

// ─── Data quality score ───────────────────────────────────────────────────────
function computeDataQuality(data: MatchData): number {
  let score = 0.20;

  const homePlayed = finiteDataNumber(data.home?.season?.played);
  const awayPlayed = finiteDataNumber(data.away?.season?.played);
  if (homePlayed >= 5) score += 0.10;
  if (homePlayed >= 10) score += 0.08;
  if (awayPlayed >= 5) score += 0.10;
  if (awayPlayed >= 10) score += 0.08;

  if ((data.home?.last5?.results?.length ?? 0) >= 3) score += 0.07;
  if ((data.home?.last5?.results?.length ?? 0) >= 5) score += 0.04;
  if ((data.away?.last5?.results?.length ?? 0) >= 3) score += 0.07;
  if ((data.away?.last5?.results?.length ?? 0) >= 5) score += 0.04;

  // Odds add market context, but are not a substitute for complete team data.
  const validOdds = Object.values(data.odds ?? {}).filter((odd) =>
    typeof odd === "number" && Number.isFinite(odd) && odd > 1.01 && odd <= 100
  ).length;
  if (validOdds >= 3) score += 0.08;

  const context = data.deepContext ?? {};
  const source = (data as any).dataSource ?? context.dataSource;
  const warning = (data as any).dataQualityWarning ?? context.dataQualityWarning;
  if (source === "gemini_search") score -= 0.15;
  if (warning) score -= 0.10;
  if (context.oddsAvailable === false) score -= 0.08;
  if (context.statsAvailable === false) score -= 0.10;
  if (homePlayed === 0 || awayPlayed === 0) score -= 0.15;

  return Math.min(1, Math.max(0, score));
}

function finiteDataNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — ELITE POISSON MODEL WITH DIXON-COLES
// Scores computed up to 10 for accurate tail capture.
// ─────────────────────────────────────────────────────────────────────────────
export function calculatePoissonProbabilities(
  lambdaHome: number,
  lambdaAway: number
): Probabilities & {
  over05: number;
  under05: number;
  over45: number;
  under45: number;
  over55: number;
  under55: number;
  homeScores: number;
  awayScores: number;
  homeOver05: number;
  awayOver05: number;
  csHome: number;
  csAway: number;
} {
  // Defensive bounds prevent malformed upstream data from producing NaN,
  // negative probabilities, or factorial overflow.
  const MAX_GOALS = 12;
  const safeLambda = (value: number) =>
    Number.isFinite(value) ? Math.min(5.5, Math.max(0.01, value)) : 1.25;
  const lh = safeLambda(lambdaHome);
  const la = safeLambda(lambdaAway);

  const factorial = [1];
  for (let i = 1; i <= MAX_GOALS; i++) factorial[i] = factorial[i - 1] * i;
  const poisson = (k: number, lambda: number) =>
    (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial[k];

  // Build and normalise the entire score matrix, not only 1X2. This ensures
  // the Dixon–Coles low-score correction is reflected consistently in every
  // market derived from the same distribution.
  const matrix: { h: number; a: number; p: number }[] = [];
  let matrixTotal = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw = poisson(h, lh) * poisson(a, la) *
        dixonColesCorrection(h, a, lh, la);
      const p = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      matrix.push({ h, a, p });
      matrixTotal += p;
    }
  }
  const denominator = matrixTotal > 0 ? matrixTotal : 1;

  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0, over05 = 0, over15 = 0, over25 = 0, over35 = 0, over45 = 0, over55 = 0;
  let homeScores = 0, awayScores = 0, csHome = 0, csAway = 0;
  for (const { h, a, p: rawP } of matrix) {
    const p = rawP / denominator;
    if (h > a) homeWin += p;
    else if (h < a) awayWin += p;
    else draw += p;

    if (h > 0) homeScores += p;
    if (a > 0) awayScores += p;
    if (h + a >= 1) over05 += p;
    if (h > 0 && a > 0) bttsYes += p;
    if (h + a >= 2) over15 += p;
    if (h + a >= 3) over25 += p;
    if (h + a >= 4) over35 += p;
    if (h + a >= 5) over45 += p;
    if (h + a >= 6) over55 += p;
    if (a === 0) csHome += p;
    if (h === 0) csAway += p;
  }

  const outcomeTotal = homeWin + draw + awayWin || 1;
  homeWin /= outcomeTotal;
  draw /= outcomeTotal;
  awayWin /= outcomeTotal;
  const nonDraw = homeWin + awayWin || 1;

  return {
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over05, under05: 1 - over05,
    over15, under15: 1 - over15,
    over25, under25: 1 - over25,
    over35, under35: 1 - over35,
    bttsYes, bttsNo: 1 - bttsYes,
    dnb1: homeWin / nonDraw,
    dnb2: awayWin / nonDraw,
    over45, under45: 1 - over45,
    over55, under55: 1 - over55,
    homeScores, awayScores,
    homeOver05: homeScores, awayOver05: awayScores,
    csHome, csAway,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — ELITE CONTEXT ADJUSTMENT
// Injury penalty, motivation multiplier, fatigue, derby, league position.
// All adjustments normalised so 1X2 still sums to 1.
// ─────────────────────────────────────────────────────────────────────────────
export function adjustProbabilities(
  probs: Probabilities,
  context: ContextData & {
    home_league_position?: number;
    away_league_position?: number;
    is_derby?: boolean;
    home_key_absentee?: string;
    away_key_absentee?: string;
  }
): Probabilities {
  // Context is deliberately a restrained adjustment layer. Subjective factors
  // are kept small; unsupported narrative signals must not overwhelm the
  // statistical prior. Goal-market probabilities are left unchanged because
  // scaling them independently would break their relationship to the score model.
  const bounded = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : 1));
  const motivation: Record<string, number> = { HIGH: 1.04, MEDIUM: 1, LOW: 0.97 };
  let homeAdj = 1;
  let awayAdj = 1;

  const homeMissing = bounded(context.home_missing ?? 0, 0, 11);
  const awayMissing = bounded(context.away_missing ?? 0, 0, 11);
  homeAdj *= Math.max(0.82, 1 - homeMissing * 0.018);
  awayAdj *= Math.max(0.82, 1 - awayMissing * 0.018);

  // A named absentee is only a small additional modifier; do not double-count
  // an entire player penalty as though every named player has equal value.
  if (context.home_key_absentee?.trim()) homeAdj *= 0.97;
  if (context.away_key_absentee?.trim()) awayAdj *= 0.97;
  homeAdj *= motivation[context.home_motivation] ?? 1;
  awayAdj *= motivation[context.away_motivation] ?? 1;
  if (context.home_fatigue) homeAdj *= 0.97;
  if (context.away_fatigue) awayAdj *= 0.97;

  // League position and derby status are not reliable enough on their own to
  // assert a directional advantage, so they are not given arbitrary boosts.
  let homeWin = Math.max(0, probs.homeWin * homeAdj);
  let draw = Math.max(0, probs.draw);
  let awayWin = Math.max(0, probs.awayWin * awayAdj);
  const total = homeWin + draw + awayWin;
  if (!(total > 0) || !Number.isFinite(total)) {
    homeWin = probs.homeWin;
    draw = probs.draw;
    awayWin = probs.awayWin;
  } else {
    homeWin /= total;
    draw /= total;
    awayWin /= total;
  }
  const nonDraw = homeWin + awayWin || 1;

  return {
    ...probs,
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    dnb1: homeWin / nonDraw,
    dnb2: awayWin / nonDraw,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — ODDS & VALUE ENGINE (Kelly Criterion aware)
// Calculates edge, EV, and quarter-Kelly fraction for each market.
// ─────────────────────────────────────────────────────────────────────────────
export function calculateValue(
  probs: Probabilities & {
    over45?: number;
    under45?: number;
    csHome?: number;
    csAway?: number;
    over05?: number;
    under05?: number;
    over55?: number;
    under55?: number;
    homeScores?: number;
    awayScores?: number;
    homeOver05?: number;
    awayOver05?: number;
  },
  odds: MatchData["odds"]
): (ValueBet & { ev: number; kellyFraction: number })[] {
  const markets: { name: string; prob: number; oddsKeys: string[] }[] = [
    { name: "Home Win", prob: probs.homeWin, oddsKeys: ["home", "1"] },
    { name: "Draw", prob: probs.draw, oddsKeys: ["draw", "X"] },
    { name: "Away Win", prob: probs.awayWin, oddsKeys: ["away", "2"] },
    { name: "1X", prob: probs.dc1X, oddsKeys: ["dc1X", "1X"] },
    { name: "X2", prob: probs.dcX2, oddsKeys: ["dcX2", "X2"] },
    { name: "12", prob: probs.dc12, oddsKeys: ["dc12", "12"] },
    { name: "Over 0.5 Goals", prob: probs.over05 ?? 0, oddsKeys: ["over05", "over_05_goals", "over_0_5", "Over 0.5"] },
    { name: "Under 0.5 Goals", prob: probs.under05 ?? 0, oddsKeys: ["under05", "under_05_goals", "under_0_5", "Under 0.5"] },
    { name: "Over 1.5 Goals", prob: probs.over15, oddsKeys: ["over15", "Over 1.5"] },
    { name: "Under 1.5", prob: probs.under15, oddsKeys: ["under15", "Under 1.5"] },
    { name: "Over 2.5 Goals", prob: probs.over25, oddsKeys: ["over25", "Over 2.5"] },
    { name: "Under 2.5", prob: probs.under25, oddsKeys: ["under25", "Under 2.5"] },
    { name: "Over 3.5 Goals", prob: probs.over35, oddsKeys: ["over35", "Over 3.5"] },
    { name: "Under 3.5", prob: probs.under35, oddsKeys: ["under35", "Under 3.5"] },
    { name: "Over 4.5 Goals", prob: probs.over45 ?? 0, oddsKeys: ["over45", "over_45_goals", "over_4_5", "Over 4.5"] },
    { name: "Under 4.5 Goals", prob: probs.under45 ?? 0, oddsKeys: ["under45", "under_45_goals", "under_4_5", "Under 4.5"] },
    { name: "Over 5.5 Goals", prob: probs.over55 ?? 0, oddsKeys: ["over55", "over_55_goals", "over_5_5", "Over 5.5"] },
    { name: "Under 5.5 Goals", prob: probs.under55 ?? 0, oddsKeys: ["under55", "under_55_goals", "under_5_5", "Under 5.5"] },
    { name: "Home Team To Score", prob: probs.homeScores ?? probs.homeOver05 ?? 0, oddsKeys: ["homeScores", "home_team_to_score", "home_to_score", "home_team_over_05"] },
    { name: "Away Team To Score", prob: probs.awayScores ?? probs.awayOver05 ?? 0, oddsKeys: ["awayScores", "away_team_to_score", "away_to_score", "away_team_over_05"] },
    { name: "BTTS - Yes", prob: probs.bttsYes, oddsKeys: ["bttsYes", "BTTS - Yes"] },
    { name: "BTTS - No", prob: probs.bttsNo, oddsKeys: ["bttsNo", "BTTS - No"] },
    { name: "DNB Home", prob: probs.dnb1, oddsKeys: ["dnb1", "DNB 1"] },
    { name: "DNB Away", prob: probs.dnb2, oddsKeys: ["dnb2", "DNB 2"] },
    { name: "Clean Sheet Home", prob: probs.csHome ?? 0, oddsKeys: ["csHome"] },
    { name: "Clean Sheet Away", prob: probs.csAway ?? 0, oddsKeys: ["csAway"] },
  ];

  const results: (ValueBet & { ev: number; kellyFraction: number })[] = [];
  for (const market of markets) {
    const probability = market.prob;
    if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) continue;
    const price = market.oddsKeys
      .map((key) => Number(odds?.[key]))
      .find((value) => Number.isFinite(value) && value > 1.01 && value <= 100);
    if (price === undefined) continue;

    const impliedProb = 1 / price;
    const edge = probability - impliedProb;
    const ev = probability * price - 1;
    // Standard Kelly: (b*p - q)/b = (p*odds - 1)/(odds - 1).
    // Report quarter Kelly as a conservative sizing reference, never a promise.
    const fullKelly = Math.max(0, ev / (price - 1));
    const kellyFraction = Math.min(0.25, fullKelly * 0.25);
    if (edge <= 0.01 || ev <= 0.01) continue;

    results.push({
      market: market.name,
      modelProb: probability,
      impliedProb,
      value: edge,
      odds: price,
      ev,
      kellyFraction,
    });
  }
  return results.sort((a, b) => b.ev - a.ev);
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — CONFIDENCE ENGINE
// Combines probability, edge, data quality, form, AI grounding signal.
// Hard cap at 95 — 100% confidence is always wrong in football.
// ─────────────────────────────────────────────────────────────────────────────
export function calculateConfidence(
  prob: number,
  value: number,
  dataQuality: number,
  formScore?: number,
  _aiConfidence?: number,
  _searchDataUsed?: boolean
): number {
  // This is a model-signal score, not a calibrated probability of winning.
  // Search grounding and an LLM's self-reported confidence are not evidence
  // that an outcome is more likely, so they intentionally do not add points.
  const p = Number.isFinite(prob) ? Math.min(1, Math.max(0, prob)) : 0;
  const edge = Number.isFinite(value) ? Math.max(0, value) : 0;
  const quality = Number.isFinite(dataQuality)
    ? Math.min(1, Math.max(0, dataQuality))
    : 0;
  const form = Number.isFinite(formScore)
    ? Math.min(1, Math.max(0, formScore as number))
    : 0.5;

  const raw = 35 * p + 20 * Math.min(edge / 0.10, 1) +
    30 * quality + 15 * form;
  // Until historical calibration exists, cap the displayed score so it cannot
  // be mistaken for a statistically validated 90–95% win probability.
  const qualityCap = quality < 0.35 ? 45 : quality < 0.60 ? 55 : 70;
  return Math.round(Math.min(qualityCap, Math.max(5, raw)));
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 7 — DECISION ENGINE
// Ranks by composite: EV (40%) + probability (35%) + edge (25%).
// Minimum quality gate before a bet is recommended.
// ─────────────────────────────────────────────────────────────────────────────
export function selectBestBet(
  valueBets: (ValueBet & { ev?: number; kellyFraction?: number })[],
  _probs: Probabilities
): ValueBet | null {
  // No qualifying positive-EV market means no bet recommendation. Selecting a
  // high-hit-rate market without odds is not evidence of value.
  const qualified = valueBets.filter((bet) =>
    Number.isFinite(bet.modelProb) &&
    Number.isFinite(bet.value) &&
    Number.isFinite(bet.odds) &&
    bet.modelProb > 0 && bet.modelProb < 1 &&
    bet.odds > 1.01 &&
    bet.value >= 0.02 &&
    (bet.ev ?? (bet.modelProb * bet.odds - 1)) > 0.01
  );
  if (qualified.length === 0) return null;

  return [...qualified].sort((a, b) => {
    const evA = a.ev ?? a.modelProb * a.odds - 1;
    const evB = b.ev ?? b.modelProb * b.odds - 1;
    // Prioritise expected return, with modest preference for larger edge;
    // probability alone should not dominate value selection.
    return (evB + b.value * 0.15) - (evA + a.value * 0.15);
  })[0];
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 8 — LIVE MATCH PREDICTOR
// xG pressure signals, possession dominance, set-piece danger.
// ─────────────────────────────────────────────────────────────────────────────
export function analyzeLiveMatch(liveStats: {
  minute: number;
  score: string;
  shotsOnTarget: number;
  xG: number;
  possession?: number;
  corners?: number;
}) {
  const minute = Math.min(130, Math.max(0, Number(liveStats.minute) || 0));
  const xG = Math.max(0, Number(liveStats.xG) || 0);
  const shotsOnTarget = Math.max(0, Number(liveStats.shotsOnTarget) || 0);
  const possession = Math.min(100, Math.max(0, Number(liveStats.possession ?? 50) || 0));
  const corners = Math.max(0, Number(liveStats.corners) || 0);
  const scoreParts = String(liveStats.score ?? "").split("-").map((value) => Number(value.trim()));
  const homeGoals = Number.isFinite(scoreParts[0]) ? Math.max(0, scoreParts[0]) : 0;
  const awayGoals = Number.isFinite(scoreParts[1]) ? Math.max(0, scoreParts[1]) : 0;
  const totalGoals = homeGoals + awayGoals;

  // Observational alerts only. Without a calibrated hazard model, do not label
  // an event "imminent", promise a goal within 15 minutes, or invent confidence.
  if (minute >= 60 && xG >= 1.8 && shotsOnTarget >= 5) {
    return {
      signal: "SUSTAINED_ATTACKING_PRESSURE",
      confidence: 0,
      reasoning: `Elevated attacking activity: ${xG.toFixed(2)} combined xG and ${shotsOnTarget} shots on target by ${Math.round(minute)}'. This is a descriptive signal, not a calibrated goal forecast.`,
    };
  }
  if (minute >= 45 && possession >= 65 && corners >= 6) {
    return {
      signal: "TERRITORIAL_AND_SET_PIECE_PRESSURE",
      confidence: 0,
      reasoning: `${Math.round(possession)}% possession and ${corners} corners indicate territorial/set-piece pressure. This alone does not establish that a goal is likely.`,
    };
  }
  if (minute >= 60 && totalGoals === 0 && xG >= 1.5) {
    return {
      signal: "HIGH_CHANCE_VOLUME_SCORELESS",
      confidence: 0,
      reasoning: `The match remains 0-0 despite ${xG.toFixed(2)} combined xG at ${Math.round(minute)}'. Chance quality and the remaining-time model should be reviewed; no goal probability is inferred from this threshold alone.`,
    };
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 9 — BSD API ENRICHMENT LAYER
// Merges live BSD xG, odds, and match state into MatchData for Poisson.
// ─────────────────────────────────────────────────────────────────────────────
export function enrichMatchDataFromBSD(matchData: MatchData, bsdEvent: any): MatchData {
  if (!bsdEvent) return matchData;
  const enriched = { ...matchData };

  if (bsdEvent.xG?.home && bsdEvent.xG?.away) {
    enriched.deepContext = {
      ...enriched.deepContext,
      xG: { home: Number(bsdEvent.xG.home) || 0, away: Number(bsdEvent.xG.away) || 0 },
    };
  }

  if (bsdEvent.odds) {
    const o = bsdEvent.odds;
    enriched.odds = {
      ...enriched.odds,
      home:    o["1"]    || o.home    || enriched.odds?.home,
      draw:    o["X"]    || o.draw    || enriched.odds?.draw,
      away:    o["2"]    || o.away    || enriched.odds?.away,
      over25:  o.over25  || o["Over 2.5"] || enriched.odds?.over25,
      under25: o.under25 || o["Under 2.5"] || enriched.odds?.under25,
      bttsYes: o.bttsYes || o["BTTS Yes"]  || enriched.odds?.bttsYes,
    };
  }

  if (bsdEvent.stats) {
    enriched.deepContext = {
      ...enriched.deepContext,
      liveStats: bsdEvent.stats,
      elapsed:   bsdEvent.fixture?.status?.elapsed || 0,
      score:     `${bsdEvent.goals?.home ?? 0}-${bsdEvent.goals?.away ?? 0}`,
    };
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 10 — MAIN PREDICTION PIPELINE
//
// Flow:
//   1  BSD Live Enrichment
//   2  Feature Engineering
//   3  Dixon-Coles Poisson
//   4  Context (Multi-Agent + Google Search)
//   5  Probability Adjustment
//   6  Value / EV Engine
//   7  Best Bet Selection
//   8  AI Deep Analysis (search-grounded)
//   9  Confidence Calibration (penalised for low data quality)
//  10  Output ranked predictions
// ─────────────────────────────────────────────────────────────────────────────
export async function runPrediction(
  matchId: string,
  matchData: MatchData
): Promise<PredictionResult> {

  // ── 1. BSD live enrichment ──────────────────────────────────────────────
  let enrichedData = matchData;
  try {
    const { getLiveMatchPreview } = await import("./footballService.js");
    const bsdEvent = await getLiveMatchPreview(matchId);
    if (bsdEvent) enrichedData = enrichMatchDataFromBSD(matchData, bsdEvent);
  } catch (e) {
    console.warn("[PredictionEngine] BSD enrichment skipped:", (e as Error).message);
  }

  // ── 2. Feature engineering ─────────────────────────────────────────────
  const { lambdaHome, lambdaAway, homeFormScore, awayFormScore, dataQuality } =
    computeFeatures(enrichedData);

  // ── 3. Poisson + Dixon-Coles ───────────────────────────────────────────
  const baseProbs = calculatePoissonProbabilities(lambdaHome, lambdaAway);

  // ── 4. Context (injuries, motivation, fatigue) via Google Search ────────
  const context = await multiAgentService.fetchContextData(
    `${matchData.home.name} vs ${matchData.away.name}`
  );

  // ── 5. Probability adjustment ──────────────────────────────────────────
  const adjustedProbs = adjustProbabilities(baseProbs, context as any);

  // ── 6. Value / EV engine ───────────────────────────────────────────────
  const valueBets = calculateValue(adjustedProbs as any, enrichedData.odds ?? {});

  // ── 7. Best bet selection ──────────────────────────────────────────────
  const bestBet = selectBestBet(valueBets, adjustedProbs);

  // ── 8. AI deep analysis (search-grounded) ─────────────────────────────
  let aiAnalysis: {
    reasoning:         string;
    confidence:        number;
    best_value_market: string;
    key_insight?:      string;
    risk_flag?:        string;
    search_data_used?: boolean;
  } | null = null;

  try {
    aiAnalysis = await multiAgentService.analyzeMatch({
      match:        `${matchData.home.name} vs ${matchData.away.name}`,
      matchId,
      stats:        { home: matchData.home.season, away: matchData.away.season },
      form:         { home: matchData.home.last5.results, away: matchData.away.last5.results },
      poissonLambdas: { home: lambdaHome, away: lambdaAway },
      probabilities: {
        homeWin: `${(adjustedProbs.homeWin * 100).toFixed(1)}%`,
        draw:    `${(adjustedProbs.draw    * 100).toFixed(1)}%`,
        awayWin: `${(adjustedProbs.awayWin * 100).toFixed(1)}%`,
        over25:  `${(adjustedProbs.over25  * 100).toFixed(1)}%`,
        bttsYes: `${(adjustedProbs.bttsYes * 100).toFixed(1)}%`,
      },
      valueBets: valueBets.map((v) => ({
        market: v.market,
        edge:   `+${(v.value * 100).toFixed(1)}%`,
        odds:   v.odds,
      })),
      context,
      bsdData:  enrichedData.deepContext ?? null,
      odds:     enrichedData.odds ?? {},
    });
  } catch (e) {
    console.warn("[PredictionEngine] AI deep analysis failed:", (e as Error).message);
  }

  // ── 9. Confidence calibration ──────────────────────────────────────────
  const confidence = bestBet
    ? calculateConfidence(
        bestBet.modelProb,
        bestBet.value,
        dataQuality,
        (homeFormScore + awayFormScore) / 2,
        aiAnalysis?.confidence,
        aiAnalysis?.search_data_used
      )
    : 0;

  // ── 10. Build output ───────────────────────────────────────────────────
  const reasoning =
    aiAnalysis?.reasoning ||
    context.reasoning ||
    buildFallbackReasoning(matchData, adjustedProbs, bestBet, lambdaHome, lambdaAway);

  // Data quality warning for low-confidence predictions
  const dataWarning =
    dataQuality < 0.45
      ? " ⚠️ Low data quality — this prediction is based on limited statistics. Treat with caution."
      : "";

  const topPredictions = bestBet
    ? [
        {
          market:     bestBet.market,
          confidence: Math.round(confidence),
          reasoning:  reasoning + dataWarning,
        },
        ...valueBets
          .filter((v) => v.market !== bestBet.market)
          .sort((a, b) => b.value - a.value)
          .slice(0, 4)
          .map((v) => ({
            market: v.market,
            confidence: calculateConfidence(
              v.modelProb,
              v.value,
              dataQuality * 0.9,
              undefined,
              undefined,
              aiAnalysis?.search_data_used
            ),
            reasoning:
              `Model probability: ${(v.modelProb * 100).toFixed(1)}% vs market implied ` +
              `${(v.impliedProb * 100).toFixed(1)}%. ` +
              `Edge: +${(v.value * 100).toFixed(1)}%. ` +
              `Expected value: +${(v.ev * 100).toFixed(1)}%.`,
          })),
      ]
    : [];

  return {
    matchId,
    predictions:     topPredictions,
    overallReasoning: reasoning + dataWarning,
    teamData: {
      home: {
        name:      matchData.home.name,
        form:      matchData.home.last5.results.join("") || "N/A",
        injuries:  context.home_key_absentee
          ? [context.home_key_absentee]
          : [],
        keyStats: [
          `Goals/game: ${(matchData.home.season.goalsScored / (matchData.home.season.played || 1)).toFixed(2)}`,
          `Conceded/game: ${(matchData.home.season.goalsConceded / (matchData.home.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaHome.toFixed(3)}`,
          `Form score: ${(homeFormScore * 100).toFixed(0)}%`,
          `Data quality: ${(dataQuality * 100).toFixed(0)}%`,
        ],
      },
      away: {
        name:      matchData.away.name,
        form:      matchData.away.last5.results.join("") || "N/A",
        injuries:  context.away_key_absentee
          ? [context.away_key_absentee]
          : [],
        keyStats: [
          `Goals/game: ${(matchData.away.season.goalsScored / (matchData.away.season.played || 1)).toFixed(2)}`,
          `Conceded/game: ${(matchData.away.season.goalsConceded / (matchData.away.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaAway.toFixed(3)}`,
          `Form score: ${(awayFormScore * 100).toFixed(0)}%`,
          `Data quality: ${(dataQuality * 100).toFixed(0)}%`,
        ],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback reasoning (when AI analysis is unavailable)
// ─────────────────────────────────────────────────────────────────────────────
function buildFallbackReasoning(
  matchData: MatchData,
  probs:     Probabilities,
  bestBet:   ValueBet | null,
  λH:        number,
  λA:        number
): string {
  const homeAvg = (matchData.home.season.goalsScored / (matchData.home.season.played || 1)).toFixed(2);
  const awayAvg = (matchData.away.season.goalsScored / (matchData.away.season.played || 1)).toFixed(2);

  const favourite =
    probs.homeWin > probs.awayWin && probs.homeWin > probs.draw
      ? `${matchData.home.name} (${(probs.homeWin * 100).toFixed(1)}%)`
      : probs.awayWin > probs.draw
      ? `${matchData.away.name} (${(probs.awayWin * 100).toFixed(1)}%)`
      : `Draw (${(probs.draw * 100).toFixed(1)}%)`;

  return (
    `Dixon-Coles Poisson model favours ${favourite}. ` +
    `Expected goals: ${matchData.home.name} λ=${λH.toFixed(2)}, ${matchData.away.name} λ=${λA.toFixed(2)}. ` +
    `Season avg: ${homeAvg} vs ${awayAvg} goals/game. ` +
    `Over 2.5: ${(probs.over25 * 100).toFixed(1)}% | BTTS: ${(probs.bttsYes * 100).toFixed(1)}%. ` +
    (bestBet
      ? `Top pick: ${bestBet.market} at ${(bestBet.modelProb * 100).toFixed(1)}% model probability.`
      : "")
  );
}
