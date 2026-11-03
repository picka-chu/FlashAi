/**
 * Elite Prediction Engine — Dixon-Coles Poisson + Multi-Agent AI
 *
 * Architecture:
 *   BSD Live Data → Feature Engineering → Dixon-Coles Poisson →
 *   Context Adjustments → Value / EV Engine → AI Deep Analysis →
 *   Confidence Calibration → Ranked Predictions Output
 *
 * Key improvements:
 *  1. League-specific priors (avg goals, home advantage, rho)
 *  2. Market blending weighted by data quality
 *  3. Quality / no-bet gates for stricter tip publishing
 *  4. Full value engine with Kelly fractions
 */

import {
  MatchData,
  ContextData,
  Probabilities,
  ValueBet,
  PredictionResult,
} from "../../src/types/prediction";
import { multiAgentService } from "./multiAgentService";
import { getLeaguePrior } from "./leaguePriors";
import { blendWithMarket, applyQualityGates } from "./calibration";

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

  const homeAttackSeason = safeDiv(homeScored, homePlayed, 1.25);
  const awayAttackSeason = safeDiv(awayScored, awayPlayed, 1.10);
  const homeDefenseSeason = safeDiv(homeConceded, homePlayed, 1.25);
  const awayDefenseSeason = safeDiv(awayConceded, awayPlayed, 1.25);

  const FORM_WEIGHTS = [5, 4, 3, 2, 1];
  const WEIGHT_SUM = FORM_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const computeFormMetrics = (goalsScored: number, goalsConceded: number, results: string[]) => {
    const recentResults = Array.isArray(results) ? results.slice(0, 5) : [];
    const games = Math.max(Math.min(recentResults.length, 5), 1);
    const formScore =
      recentResults.reduce(
        (sum, result, index) =>
          sum + (result === "W" ? 3 : result === "D" ? 1 : 0) * (FORM_WEIGHTS[index] ?? 1),
        0
      ) /
      (WEIGHT_SUM * 3);
    return {
      attack: safeDiv(finiteNonNegative(goalsScored), games, 1.1),
      defense: safeDiv(finiteNonNegative(goalsConceded), games, 1.25),
      formScore: Math.min(1, Math.max(0, formScore)),
    };
  };

  const homeForm = computeFormMetrics(
    data.home?.last5?.goalsScored ?? 0,
    data.home?.last5?.goalsConceded ?? 0,
    data.home?.last5?.results ?? []
  );
  const awayForm = computeFormMetrics(
    data.away?.last5?.goalsScored ?? 0,
    data.away?.last5?.goalsConceded ?? 0,
    data.away?.last5?.results ?? []
  );

  const homeAttack = homeAttackSeason * 0.65 + homeForm.attack * 0.35;
  const awayAttack = awayAttackSeason * 0.65 + awayForm.attack * 0.35;
  const homeDefense = homeDefenseSeason * 0.65 + homeForm.defense * 0.35;
  const awayDefense = awayDefenseSeason * 0.65 + awayForm.defense * 0.35;

  const leagueName =
    (data as any).league ||
    (data as any).leagueName ||
    data.deepContext?.league ||
    data.deepContext?.leagueName ||
    "";
  const prior = getLeaguePrior(leagueName);

  const rawLeague = finiteNonNegative(data.leagueAvgGoals, prior.avgGoals);
  const league = rawLeague >= 1.5 && rawLeague <= 4.5 ? rawLeague : prior.avgGoals;

  let lambdaHome = safeDiv(homeAttack, league) * safeDiv(awayDefense, league) * league;
  let lambdaAway = safeDiv(awayAttack, league) * safeDiv(homeDefense, league) * league;

  const expectedHomeXG = finiteNonNegative(data.deepContext?.expectedGoals?.home, -1);
  const expectedAwayXG = finiteNonNegative(data.deepContext?.expectedGoals?.away, -1);
  if (expectedHomeXG > 0 && expectedAwayXG > 0) {
    lambdaHome = lambdaHome * 0.8 + expectedHomeXG * 0.2;
    lambdaAway = lambdaAway * 0.8 + expectedAwayXG * 0.2;
  }

  lambdaHome *= prior.homeAdvantage;
  lambdaHome = Math.min(5, Math.max(0.3, Number.isFinite(lambdaHome) ? lambdaHome : 1.35));
  lambdaAway = Math.min(5, Math.max(0.3, Number.isFinite(lambdaAway) ? lambdaAway : 1.10));

  return {
    lambdaHome,
    lambdaAway,
    homeFormScore: homeForm.formScore,
    awayFormScore: awayForm.formScore,
    dataQuality: computeDataQuality(data),
    rho: prior.rho,
    leaguePrior: prior,
  };
}

function computeDataQuality(data: MatchData): number {
  let score = 0.2;
  const homePlayed = finiteDataNumber(data.home?.season?.played);
  const awayPlayed = finiteDataNumber(data.away?.season?.played);
  if (homePlayed >= 5) score += 0.1;
  if (homePlayed >= 10) score += 0.08;
  if (awayPlayed >= 5) score += 0.1;
  if (awayPlayed >= 10) score += 0.08;
  if ((data.home?.last5?.results?.length ?? 0) >= 3) score += 0.07;
  if ((data.home?.last5?.results?.length ?? 0) >= 5) score += 0.04;
  if ((data.away?.last5?.results?.length ?? 0) >= 3) score += 0.07;
  if ((data.away?.last5?.results?.length ?? 0) >= 5) score += 0.04;
  const validOdds = Object.values(data.odds ?? {}).filter(
    (odd) => typeof odd === "number" && Number.isFinite(odd) && odd > 1.01 && odd <= 100
  ).length;
  if (validOdds >= 3) score += 0.08;
  const context = data.deepContext ?? {};
  const source = (data as any).dataSource ?? context.dataSource;
  if (source === "gemini_search") score -= 0.15;
  if ((data as any).dataQualityWarning ?? context.dataQualityWarning) score -= 0.1;
  if (context.oddsAvailable === false) score -= 0.08;
  if (context.statsAvailable === false) score -= 0.1;
  if (homePlayed === 0 || awayPlayed === 0) score -= 0.15;
  return Math.min(1, Math.max(0, score));
}

function finiteDataNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function calculatePoissonProbabilities(
  lambdaHome: number,
  lambdaAway: number,
  rho = -0.13
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
  const MAX_GOALS = 12;
  const safeLambda = (value: number) =>
    Number.isFinite(value) ? Math.min(5.5, Math.max(0.01, value)) : 1.25;
  const lh = safeLambda(lambdaHome);
  const la = safeLambda(lambdaAway);
  const factorial = [1];
  for (let i = 1; i <= MAX_GOALS; i++) factorial[i] = factorial[i - 1] * i;
  const poisson = (k: number, lambda: number) =>
    (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial[k];

  const matrix: { h: number; a: number; p: number }[] = [];
  let matrixTotal = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw = poisson(h, lh) * poisson(a, la) * dixonColesCorrection(h, a, lh, la, rho);
      const p = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      matrix.push({ h, a, p });
      matrixTotal += p;
    }
  }
  const denominator = matrixTotal > 0 ? matrixTotal : 1;

  let homeWin = 0,
    draw = 0,
    awayWin = 0;
  let bttsYes = 0,
    over05 = 0,
    over15 = 0,
    over25 = 0,
    over35 = 0,
    over45 = 0,
    over55 = 0;
  let homeScores = 0,
    awayScores = 0,
    csHome = 0,
    csAway = 0;
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
    homeWin,
    draw,
    awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over05,
    under05: 1 - over05,
    over15,
    under15: 1 - over15,
    over25,
    under25: 1 - over25,
    over35,
    under35: 1 - over35,
    bttsYes,
    bttsNo: 1 - bttsYes,
    dnb1: homeWin / nonDraw,
    dnb2: awayWin / nonDraw,
    over45,
    under45: 1 - over45,
    over55,
    under55: 1 - over55,
    homeScores,
    awayScores,
    homeOver05: homeScores,
    awayOver05: awayScores,
    csHome,
    csAway,
  };
}

export function adjustProbabilities(
  probs: Probabilities,
  context: ContextData & {
    home_key_absentee?: string;
    away_key_absentee?: string;
  }
): Probabilities {
  const bounded = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : 1));
  const motivation: Record<string, number> = { HIGH: 1.04, MEDIUM: 1, LOW: 0.97 };
  let homeAdj = 1;
  let awayAdj = 1;
  homeAdj *= Math.max(0.82, 1 - bounded(context.home_missing ?? 0, 0, 11) * 0.018);
  awayAdj *= Math.max(0.82, 1 - bounded(context.away_missing ?? 0, 0, 11) * 0.018);
  if (context.home_key_absentee?.trim()) homeAdj *= 0.97;
  if (context.away_key_absentee?.trim()) awayAdj *= 0.97;
  homeAdj *= motivation[context.home_motivation] ?? 1;
  awayAdj *= motivation[context.away_motivation] ?? 1;
  if (context.home_fatigue) homeAdj *= 0.97;
  if (context.away_fatigue) awayAdj *= 0.97;

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
    homeWin,
    draw,
    awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    dnb1: homeWin / nonDraw,
    dnb2: awayWin / nonDraw,
  };
}

export function calculateValue(
  probs: Probabilities & Record<string, number>,
  odds: MatchData["odds"]
): (ValueBet & { ev: number; kellyFraction: number })[] {
  const markets: { name: string; prob: number; oddsKeys: string[] }[] = [
    { name: "Home Win", prob: probs.homeWin, oddsKeys: ["home", "1"] },
    { name: "Draw", prob: probs.draw, oddsKeys: ["draw", "X"] },
    { name: "Away Win", prob: probs.awayWin, oddsKeys: ["away", "2"] },
    { name: "1X", prob: probs.dc1X, oddsKeys: ["dc1X", "1X"] },
    { name: "X2", prob: probs.dcX2, oddsKeys: ["dcX2", "X2"] },
    { name: "12", prob: probs.dc12, oddsKeys: ["dc12", "12"] },
    { name: "Over 1.5 Goals", prob: probs.over15, oddsKeys: ["over15", "Over 1.5"] },
    { name: "Under 1.5", prob: probs.under15, oddsKeys: ["under15", "Under 1.5"] },
    { name: "Over 2.5 Goals", prob: probs.over25, oddsKeys: ["over25", "Over 2.5"] },
    { name: "Under 2.5", prob: probs.under25, oddsKeys: ["under25", "Under 2.5"] },
    { name: "Over 3.5 Goals", prob: probs.over35, oddsKeys: ["over35", "Over 3.5"] },
    { name: "Under 3.5", prob: probs.under35, oddsKeys: ["under35", "Under 3.5"] },
    { name: "BTTS - Yes", prob: probs.bttsYes, oddsKeys: ["bttsYes", "BTTS - Yes"] },
    { name: "BTTS - No", prob: probs.bttsNo, oddsKeys: ["bttsNo", "BTTS - No"] },
    { name: "DNB Home", prob: probs.dnb1, oddsKeys: ["dnb1", "DNB 1"] },
    { name: "DNB Away", prob: probs.dnb2, oddsKeys: ["dnb2", "DNB 2"] },
  ];

  const results: (ValueBet & { ev: number; kellyFraction: number })[] = [];
  for (const market of markets) {
    let price: number | null = null;
    for (const key of market.oddsKeys) {
      const v = odds?.[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 1.01 && v <= 100) {
        price = v;
        break;
      }
    }
    if (price === null) continue;
    const probability = Math.min(0.95, Math.max(0.01, market.prob));
    const impliedProb = 1 / price;
    const edge = probability - impliedProb;
    if (edge < 0.01) continue;
    const ev = probability * price - 1;
    const b = price - 1;
    const kelly = b > 0 ? Math.max(0, (probability * price - 1) / b) : 0;
    results.push({
      market: market.name,
      modelProb: probability,
      impliedProb,
      value: edge,
      odds: price,
      ev,
      kellyFraction: kelly * 0.25,
    });
  }
  return results.sort((a, b) => b.ev - a.ev);
}

export function calculateConfidence(
  modelProb: number,
  edge: number,
  dataQuality: number,
  formScore: number,
  aiConfidence?: number,
  searchUsed?: boolean
): number {
  let conf = typeof aiConfidence === "number" ? aiConfidence : 55 + modelProb * 25;
  conf += Math.min(8, Math.max(0, edge * 40));
  conf += (dataQuality - 0.5) * 12;
  conf += (formScore - 0.5) * 6;
  if (searchUsed) conf += 3;
  else conf -= 4;
  return Math.round(Math.min(92, Math.max(50, conf)));
}

export function selectBestBet(
  valueBets: (ValueBet & { ev: number; kellyFraction: number })[],
  _probs: Probabilities
): (ValueBet & { ev: number; kellyFraction: number }) | null {
  if (!valueBets.length) return null;
  const ranked = [...valueBets].sort((a, b) => b.ev * 0.6 + b.value * 0.4 - (a.ev * 0.6 + a.value * 0.4));
  return ranked[0] ?? null;
}

export function enrichMatchDataFromBSD(matchData: MatchData, bsdEvent: any): MatchData {
  if (!bsdEvent) return matchData;
  const enriched = { ...matchData };
  if (bsdEvent.xG?.home && bsdEvent.xG?.away) {
    enriched.deepContext = {
      ...enriched.deepContext,
      expectedGoals: {
        home: Number(bsdEvent.xG.home) || 0,
        away: Number(bsdEvent.xG.away) || 0,
      },
    };
  }
  if (bsdEvent.odds) {
    const o = bsdEvent.odds;
    enriched.odds = {
      ...enriched.odds,
      home: o["1"] || o.home || enriched.odds?.home,
      draw: o["X"] || o.draw || enriched.odds?.draw,
      away: o["2"] || o.away || enriched.odds?.away,
      over25: o.over25 || o["Over 2.5"] || enriched.odds?.over25,
      under25: o.under25 || o["Under 2.5"] || enriched.odds?.under25,
      bttsYes: o.bttsYes || o["BTTS Yes"] || enriched.odds?.bttsYes,
    };
  }
  return enriched;
}

function buildFallbackReasoning(
  matchData: MatchData,
  probs: Probabilities,
  bestBet: ValueBet | null,
  lambdaH: number,
  lambdaA: number
): string {
  const favourite =
    probs.homeWin > probs.awayWin && probs.homeWin > probs.draw
      ? `${matchData.home.name} (${(probs.homeWin * 100).toFixed(1)}%)`
      : probs.awayWin > probs.draw
      ? `${matchData.away.name} (${(probs.awayWin * 100).toFixed(1)}%)`
      : `Draw (${(probs.draw * 100).toFixed(1)}%)`;
  return (
    `Dixon-Coles Poisson model favours ${favourite}. ` +
    `Expected goals: ${matchData.home.name} λ=${lambdaH.toFixed(2)}, ${matchData.away.name} λ=${lambdaA.toFixed(2)}. ` +
    (bestBet
      ? `Top pick: ${bestBet.market} at ${(bestBet.modelProb * 100).toFixed(1)}% model probability.`
      : "")
  );
}

export async function runPrediction(
  matchId: string,
  matchData: MatchData
): Promise<PredictionResult> {
  let enrichedData = matchData;
  try {
    const { getLiveMatchPreview } = await import("./footballService.js");
    const bsdEvent = await getLiveMatchPreview(matchId);
    if (bsdEvent) enrichedData = enrichMatchDataFromBSD(matchData, bsdEvent);
  } catch (e) {
    console.warn("[PredictionEngine] BSD enrichment skipped:", (e as Error).message);
  }

  const {
    lambdaHome,
    lambdaAway,
    homeFormScore,
    awayFormScore,
    dataQuality,
    rho = -0.13,
  } = computeFeatures(enrichedData) as ReturnType<typeof computeFeatures> & { rho?: number };

  const baseProbs = calculatePoissonProbabilities(lambdaHome, lambdaAway, rho);
  const context = await multiAgentService.fetchContextData(
    `${matchData.home.name} vs ${matchData.away.name}`
  );
  const adjustedProbs = adjustProbabilities(baseProbs, context as any);
  const valueBets = calculateValue(adjustedProbs as any, enrichedData.odds ?? {});
  const bestBet = selectBestBet(valueBets, adjustedProbs);

  let aiAnalysis: {
    reasoning: string;
    confidence: number;
    best_value_market: string;
    key_insight?: string;
    risk_flag?: string;
    search_data_used?: boolean;
  } | null = null;

  try {
    aiAnalysis = await multiAgentService.analyzeMatch({
      match: `${matchData.home.name} vs ${matchData.away.name}`,
      matchId,
      stats: { home: matchData.home.season, away: matchData.away.season },
      form: { home: matchData.home.last5.results, away: matchData.away.last5.results },
      poissonLambdas: { home: lambdaHome, away: lambdaAway },
      probabilities: {
        homeWin: `${(adjustedProbs.homeWin * 100).toFixed(1)}%`,
        draw: `${(adjustedProbs.draw * 100).toFixed(1)}%`,
        awayWin: `${(adjustedProbs.awayWin * 100).toFixed(1)}%`,
        over25: `${(adjustedProbs.over25 * 100).toFixed(1)}%`,
        bttsYes: `${(adjustedProbs.bttsYes * 100).toFixed(1)}%`,
      },
      valueBets: valueBets.map((v) => ({
        market: v.market,
        edge: `+${(v.value * 100).toFixed(1)}%`,
        odds: v.odds,
      })),
      context,
      bsdData: enrichedData.deepContext ?? null,
      odds: enrichedData.odds ?? {},
    });
  } catch (e) {
    console.warn("[PredictionEngine] AI deep analysis failed:", (e as Error).message);
  }

  let confidence = bestBet
    ? calculateConfidence(
        bestBet.modelProb,
        bestBet.value,
        dataQuality,
        (homeFormScore + awayFormScore) / 2,
        aiAnalysis?.confidence,
        aiAnalysis?.search_data_used
      )
    : 0;

  if (bestBet && typeof bestBet.odds === "number") {
    bestBet.modelProb = blendWithMarket({
      modelProb: bestBet.modelProb,
      marketOdds: bestBet.odds,
      dataQuality,
    });
  }

  const gate = applyQualityGates({
    rawConfidence: confidence,
    dataQuality,
    edge: bestBet?.value ?? null,
    requireEdge: Boolean(bestBet && bestBet.odds > 1.01),
  });
  confidence = gate.confidence;
  const noBet = gate.noBet;
  const noBetReason = gate.reason;

  const reasoning =
    aiAnalysis?.reasoning ||
    context.reasoning ||
    buildFallbackReasoning(matchData, adjustedProbs, bestBet, lambdaHome, lambdaAway);

  const dataWarning =
    dataQuality < 0.45
      ? " ⚠️ Low data quality — this prediction is based on limited statistics. Treat with caution."
      : "";
  const noBetWarning = noBet
    ? ` ⚠️ No-bet recommendation: ${noBetReason || "insufficient edge or data quality"}.`
    : "";

  const topPredictions =
    bestBet && !noBet
      ? [
          {
            market: bestBet.market,
            confidence: Math.round(confidence),
            reasoning: reasoning + dataWarning + noBetWarning,
          },
        ]
      : [];

  return {
    matchId,
    predictions: topPredictions,
    overallReasoning: reasoning + dataWarning + noBetWarning,
    teamData: {
      home: {
        name: matchData.home.name,
        form: matchData.home.last5.results.join("") || "N/A",
        injuries: context.home_key_absentee ? [context.home_key_absentee] : [],
        keyStats: [
          `Goals/game: ${(matchData.home.season.goalsScored / (matchData.home.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaHome.toFixed(3)}`,
          `Data quality: ${(dataQuality * 100).toFixed(0)}%`,
        ],
      },
      away: {
        name: matchData.away.name,
        form: matchData.away.last5.results.join("") || "N/A",
        injuries: context.away_key_absentee ? [context.away_key_absentee] : [],
        keyStats: [
          `Goals/game: ${(matchData.away.season.goalsScored / (matchData.away.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaAway.toFixed(3)}`,
          `Data quality: ${(dataQuality * 100).toFixed(0)}%`,
        ],
      },
    },
  };
}
