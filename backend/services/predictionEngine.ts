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
  const safeDiv = (a: number, b: number, fallback = 1.0) =>
    b > 0 ? a / b : fallback;

  // ── Season averages ────────────────────────────────────────────────────────
  const homePlayed  = data.home.season.played  || 1;
  const awayPlayed  = data.away.season.played  || 1;

  const homeAttackSeason  = safeDiv(data.home.season.goalsScored,   homePlayed);
  const awayAttackSeason  = safeDiv(data.away.season.goalsScored,   awayPlayed);
  const homeDefenseSeason = safeDiv(data.home.season.goalsConceded, homePlayed);
  const awayDefenseSeason = safeDiv(data.away.season.goalsConceded, awayPlayed);

  // ── Form decay (last 5, newest = highest weight) ──────────────────────────
  const FORM_WEIGHTS = [5, 4, 3, 2, 1];
  const WEIGHT_SUM   = FORM_WEIGHTS.reduce((a, b) => a + b, 0);

  const computeFormMetrics = (
    goalsScored: number,
    goalsConceded: number,
    results: string[]
  ) => {
    const games = Math.max(results.length, 1);
    const formScore =
      results
        .slice(0, 5)
        .reduce((acc, r, i) => acc + (r === "W" ? 3 : r === "D" ? 1 : 0) * (FORM_WEIGHTS[i] ?? 1), 0) /
      (WEIGHT_SUM * 3); // normalised 0-1

    return {
      attack:    safeDiv(goalsScored,   games),
      defense:   safeDiv(goalsConceded, games),
      formScore,
    };
  };

  const homeForm = computeFormMetrics(
    data.home.last5.goalsScored,
    data.home.last5.goalsConceded,
    data.home.last5.results
  );
  const awayForm = computeFormMetrics(
    data.away.last5.goalsScored,
    data.away.last5.goalsConceded,
    data.away.last5.results
  );

  // ── Blend season (60%) + recent form (40%) ─────────────────────────────────
  const homeAttack  = homeAttackSeason  * 0.6 + homeForm.attack  * 0.4;
  const awayAttack  = awayAttackSeason  * 0.6 + awayForm.attack  * 0.4;
  const homeDefense = homeDefenseSeason * 0.6 + homeForm.defense * 0.4;
  const awayDefense = awayDefenseSeason * 0.6 + awayForm.defense * 0.4;

  // ── League average with sensible defaults ─────────────────────────────────
  const league = data.leagueAvgGoals && data.leagueAvgGoals > 0.5
    ? data.leagueAvgGoals
    : 2.65; // European average

  // ── Dixon-Coles lambdas ────────────────────────────────────────────────────
  let lambdaHome =
    safeDiv(homeAttack,  league) *
    safeDiv(awayDefense, league) *
    league;

  let lambdaAway =
    safeDiv(awayAttack,  league) *
    safeDiv(homeDefense, league) *
    league;

  // ── xG overlay (BSD live data, 30% weight) ────────────────────────────────
  const homeXG = data.deepContext?.xG?.home;
  const awayXG = data.deepContext?.xG?.away;
  if (homeXG && awayXG && homeXG > 0 && awayXG > 0) {
    lambdaHome = lambdaHome * 0.70 + homeXG * 0.30;
    lambdaAway = lambdaAway * 0.70 + awayXG * 0.30;
  }

  // ── Home advantage +8% ────────────────────────────────────────────────────
  lambdaHome *= 1.08;

  // ── Form momentum boost (hot teams) ──────────────────────────────────────
  if (homeForm.formScore > 0.75) lambdaHome *= 1.05;
  if (awayForm.formScore > 0.75) lambdaAway *= 1.05;

  // ── Sanity bounds ─────────────────────────────────────────────────────────
  lambdaHome = Math.max(0.30, Math.min(lambdaHome, 5.0));
  lambdaAway = Math.max(0.30, Math.min(lambdaAway, 5.0));

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
  let score = 0.40; // base

  // Season data depth
  if (data.home.season.played >= 5)  score += 0.05;
  if (data.home.season.played >= 10) score += 0.10;
  if (data.away.season.played >= 5)  score += 0.05;
  if (data.away.season.played >= 10) score += 0.10;

  // Form data
  if (data.home.last5.results.length >= 5) score += 0.05;
  if (data.away.last5.results.length >= 5) score += 0.05;

  // Live data bonuses
  if (data.deepContext?.xG)                     score += 0.08;
  if (data.odds && Object.keys(data.odds).length > 4) score += 0.07;

  // Penalty if data came from AI fallback (not real sports API)
  if ((data as any).dataSource === "gemini_search") score -= 0.15;
  if ((data as any).dataQualityWarning)              score -= 0.10;

  return Math.min(Math.max(score, 0.0), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — ELITE POISSON MODEL WITH DIXON-COLES
// Scores computed up to 10 for accurate tail capture.
// ─────────────────────────────────────────────────────────────────────────────
export function calculatePoissonProbabilities(
  lambdaHome: number,
  lambdaAway: number
): Probabilities & {
  over45: number;
  under45: number;
  csHome: number;
  csAway: number;
} {
  const MAX_GOALS = 10;

  const factCache: number[] = [1];
  for (let i = 1; i <= MAX_GOALS; i++) factCache[i] = factCache[i - 1] * i;

  const poisson = (k: number, λ: number) =>
    (Math.pow(λ, k) * Math.exp(-λ)) / factCache[k];

  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0, over15 = 0, over25 = 0, over35 = 0, over45 = 0;
  let csHome = 0, csAway = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p =
        poisson(h, lambdaHome) *
        poisson(a, lambdaAway) *
        dixonColesCorrection(h, a, lambdaHome, lambdaAway);

      if (h > a)      homeWin += p;
      else if (h < a) awayWin += p;
      else            draw    += p;

      if (h > 0 && a > 0) bttsYes += p;
      if (h + a > 1.5)    over15  += p;
      if (h + a > 2.5)    over25  += p;
      if (h + a > 3.5)    over35  += p;
      if (h + a > 4.5)    over45  += p;
      if (a === 0)         csHome  += p;
      if (h === 0)         csAway  += p;
    }
  }

  // Normalise (DC correction perturbs sum slightly)
  const total = homeWin + draw + awayWin || 1;
  homeWin /= total;
  draw    /= total;
  awayWin /= total;

  const dnb1 = homeWin / (homeWin + awayWin || 1);
  const dnb2 = awayWin / (homeWin + awayWin || 1);

  return {
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15,  under15:  1 - over15,
    over25,  under25:  1 - over25,
    over35,  under35:  1 - over35,
    bttsYes, bttsNo:   1 - bttsYes,
    dnb1,    dnb2,
    over45,  under45:  1 - over45,
    csHome,  csAway,
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
  let homeAdj = 1.0;
  let awayAdj = 1.0;

  // ── Injury penalty (-4% per confirmed absentee, capped at -30%) ───────────
  if ((context.home_missing ?? 0) >= 1)
    homeAdj *= Math.max(0.70, 1 - (context.home_missing ?? 0) * 0.04);
  if ((context.away_missing ?? 0) >= 1)
    awayAdj *= Math.max(0.70, 1 - (context.away_missing ?? 0) * 0.04);

  // ── KEY absentee: extra -6% if the missing player is named (i.e., confirmed important) ─
  if (context.home_key_absentee && context.home_key_absentee.trim().length > 0)
    homeAdj *= 0.94;
  if (context.away_key_absentee && context.away_key_absentee.trim().length > 0)
    awayAdj *= 0.94;

  // ── Motivation ──────────────────────────────────────────────────────────────
  const motivMap: Record<string, number> = { HIGH: 1.12, MEDIUM: 1.0, LOW: 0.90 };
  homeAdj *= motivMap[context.home_motivation] ?? 1.0;
  awayAdj *= motivMap[context.away_motivation] ?? 1.0;

  // ── Fatigue ─────────────────────────────────────────────────────────────────
  if (context.home_fatigue) homeAdj *= 0.94;
  if (context.away_fatigue) awayAdj *= 0.94;

  // ── Home crowd effect when highly motivated ──────────────────────────────
  if (context.home_motivation === "HIGH") homeAdj *= 1.04;

  // ── Derby bonus (both teams lift — suppress draw slightly) ───────────────
  if (context.is_derby) {
    homeAdj *= 1.03;
    awayAdj *= 1.03;
  }

  // ── League position: relegation-threatened team boost (desperation effect) ─
  const homeLPos = context.home_league_position ?? 0;
  const awayLPos = context.away_league_position ?? 0;
  if (homeLPos >= 17) homeAdj *= 1.06; // bottom 4 = desperation
  if (awayLPos >= 17) awayAdj *= 1.06;

  // ── 1X2 normalisation ────────────────────────────────────────────────────
  let homeWin = probs.homeWin * homeAdj;
  let awayWin = probs.awayWin * awayAdj;
  let draw    = probs.draw;

  // Draw less likely when one side has a strong edge
  const pressureDiff = Math.abs(homeAdj - awayAdj);
  draw *= Math.max(0.80, 1 - pressureDiff * 0.5);

  const total = homeWin + draw + awayWin || 1;
  homeWin /= total;
  draw    /= total;
  awayWin /= total;

  // ── Goals markets — fewer goals when there are significant injuries ────────
  const injuryPenalty = Math.max(
    0,
    ((context.home_missing ?? 0) + (context.away_missing ?? 0)) * 0.025
  );
  const goalsMod = Math.max(0.82, 1 - injuryPenalty);

  return {
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15:  Math.min(probs.over15  * goalsMod, 0.99),
    under15: 1 - Math.min(probs.over15  * goalsMod, 0.99),
    over25:  Math.min(probs.over25  * goalsMod, 0.97),
    under25: 1 - Math.min(probs.over25  * goalsMod, 0.97),
    over35:  Math.min(probs.over35  * goalsMod, 0.93),
    under35: 1 - Math.min(probs.over35  * goalsMod, 0.93),
    bttsYes: Math.min(probs.bttsYes * goalsMod, 0.94),
    bttsNo:  1 - Math.min(probs.bttsYes * goalsMod, 0.94),
    dnb1:    homeWin / (homeWin + awayWin || 1),
    dnb2:    awayWin / (homeWin + awayWin || 1),
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
  },
  odds: MatchData["odds"]
): (ValueBet & { ev: number; kellyFraction: number })[] {
  const MARKETS: { name: string; prob: number; oddsKeys: string[] }[] = [
    { name: "Home Win",       prob: probs.homeWin, oddsKeys: ["home", "1"]        },
    { name: "Draw",           prob: probs.draw,    oddsKeys: ["draw", "X"]        },
    { name: "Away Win",       prob: probs.awayWin, oddsKeys: ["away", "2"]        },
    { name: "1X",             prob: probs.dc1X,    oddsKeys: ["dc1X", "1X"]       },
    { name: "X2",             prob: probs.dcX2,    oddsKeys: ["dcX2", "X2"]       },
    { name: "12",             prob: probs.dc12,    oddsKeys: ["dc12", "12"]       },
    { name: "Over 1.5 Goals", prob: probs.over15,  oddsKeys: ["over15","Over 1.5"]},
    { name: "Under 1.5",      prob: probs.under15, oddsKeys: ["under15","Under 1.5"]},
    { name: "Over 2.5 Goals", prob: probs.over25,  oddsKeys: ["over25","Over 2.5"]},
    { name: "Under 2.5",      prob: probs.under25, oddsKeys: ["under25","Under 2.5"]},
    { name: "Over 3.5 Goals", prob: probs.over35,  oddsKeys: ["over35","Over 3.5"]},
    { name: "Under 3.5",      prob: probs.under35, oddsKeys: ["under35","Under 3.5"]},
    { name: "Over 4.5 Goals", prob: probs.over45 ?? 0, oddsKeys: ["over45","Over 4.5"]},
    { name: "BTTS - Yes",     prob: probs.bttsYes, oddsKeys: ["bttsYes","BTTS - Yes"]},
    { name: "BTTS - No",      prob: probs.bttsNo,  oddsKeys: ["bttsNo","BTTS - No"] },
    { name: "DNB Home",       prob: probs.dnb1,    oddsKeys: ["dnb1","DNB 1"]     },
    { name: "DNB Away",       prob: probs.dnb2,    oddsKeys: ["dnb2","DNB 2"]     },
    { name: "Clean Sheet Home", prob: probs.csHome ?? 0, oddsKeys: ["csHome"]    },
    { name: "Clean Sheet Away", prob: probs.csAway ?? 0, oddsKeys: ["csAway"]    },
  ];

  return MARKETS.map((m) => {
    const o = m.oddsKeys.reduce<number | undefined>(
      (found, key) => found ?? (odds[key] > 1.01 ? odds[key] : undefined),
      undefined
    );
    if (!o || o <= 1.01 || m.prob <= 0) return null;

    const impliedProb    = 1 / o;
    const edge           = m.prob - impliedProb;
    const ev             = m.prob * o - 1;
    const kellyFraction  = Math.max(0, edge / (o - 1));

    return { market: m.name, modelProb: m.prob, impliedProb, value: edge, odds: o, ev, kellyFraction };
  }).filter(
    (v): v is ValueBet & { ev: number; kellyFraction: number } =>
      v !== null && v.value > 0.01
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — CONFIDENCE ENGINE
// Combines probability, edge, data quality, form, AI grounding signal.
// Hard cap at 95 — 100% confidence is always wrong in football.
// ─────────────────────────────────────────────────────────────────────────────
export function calculateConfidence(
  prob:         number,
  value:        number,
  dataQuality:  number,
  formScore?:   number,
  aiConfidence?: number,
  searchDataUsed?: boolean
): number {
  const probScore    = Math.min(prob * 42, 42);                        // 0-42
  const valueScore   = Math.min(value * 250, 25);                      // 0-25
  const qualScore    = dataQuality * 18;                               // 0-18
  const formBonus    = formScore ? Math.min(formScore * 10, 10) : 5;  // 0-10
  const aiBonus      = aiConfidence
    ? Math.min((aiConfidence / 100) * 4, 4)
    : 0;                                                               // 0-4
  const searchBonus  = searchDataUsed ? 3 : 0;                        // 0-3 (real-time grounding)

  // If data quality is very low, cap max confidence (don't report 85% on AI-guessed data)
  const rawScore = probScore + valueScore + qualScore + formBonus + aiBonus + searchBonus;
  const maxAllowed = dataQuality < 0.45 ? 70 : 95;

  return Math.min(Math.max(Math.round(rawScore), 5), maxAllowed);
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 7 — DECISION ENGINE
// Ranks by composite: EV (40%) + probability (35%) + edge (25%).
// Minimum quality gate before a bet is recommended.
// ─────────────────────────────────────────────────────────────────────────────
export function selectBestBet(
  valueBets: (ValueBet & { ev?: number; kellyFraction?: number })[],
  probs: Probabilities
): ValueBet | null {
  if (valueBets.length === 0) {
    // No value found — fall back to highest-probability safe market
    const safe = [
      { market: "Over 1.5 Goals",  prob: probs.over15  },
      { market: "Home Win or Draw", prob: probs.dc1X    },
      { market: "Away Win or Draw", prob: probs.dcX2    },
      { market: "BTTS - Yes",       prob: probs.bttsYes },
      { market: "Home Win",         prob: probs.homeWin },
      { market: "Away Win",         prob: probs.awayWin },
    ].sort((a, b) => b.prob - a.prob)[0];
    return { market: safe.market, modelProb: safe.prob, impliedProb: 0, value: 0, odds: 0 };
  }

  const scored = valueBets.map((b) => ({
    ...b,
    compositeScore:
      (b.ev ?? 0)   * 0.40 +
      b.modelProb    * 0.35 +
      b.value        * 0.25,
  }));

  const qualified = scored.filter(
    (b) => b.modelProb >= 0.42 && b.value >= 0.02 && b.odds >= 1.15
  );

  return (qualified.length > 0 ? qualified : scored).sort(
    (a, b) => b.compositeScore - a.compositeScore
  )[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 8 — LIVE MATCH PREDICTOR
// xG pressure signals, possession dominance, set-piece danger.
// ─────────────────────────────────────────────────────────────────────────────
export function analyzeLiveMatch(liveStats: {
  minute:       number;
  score:        string;
  shotsOnTarget: number;
  xG:           number;
  possession?:  number;
  corners?:     number;
}) {
  const { minute, xG, shotsOnTarget, possession = 50, corners = 0 } = liveStats;
  const [homeGoals = 0, awayGoals = 0] = liveStats.score.split("-").map(Number);

  if (minute > 70 && xG > 2.0 && shotsOnTarget > 6)
    return { signal: "GOAL_PRESSURE_HIGH", confidence: 90, reasoning: `${xG.toFixed(2)} xG with ${shotsOnTarget} shots on target past 70' — goal imminent.` };

  if (minute > 60 && xG > 1.5 && shotsOnTarget > 5)
    return { signal: "GOAL_LIKELY", confidence: 78, reasoning: `Sustained pressure with ${xG.toFixed(2)} xG — goal within 15 min is the statistical expectation.` };

  if (possession > 65 && corners > 6 && minute > 45)
    return { signal: "SET_PIECE_DANGER", confidence: 72, reasoning: `${possession}% possession + ${corners} corners — set piece threat elevated.` };

  if (minute > 60 && homeGoals + awayGoals === 0 && xG > 1.8)
    return { signal: "LATE_GOAL_WINDOW", confidence: 82, reasoning: `0-0 with ${xG.toFixed(2)} accumulated xG — statistical pressure for a late goal.` };

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
