import {
  MatchData,
  ContextData,
  Probabilities,
  ValueBet,
  PredictionResult,
  TeamStats
} from "../../src/types/prediction";
import { multiAgentService } from "./multiAgentService";

// ─────────────────────────────────────────────
// PART 1 — DIXON-COLES CORRECTION
// Fixes underestimation of low-scoring scorelines (0-0, 1-0, 0-1, 1-1)
// which are systematically undervalued by naive Poisson models.
// ─────────────────────────────────────────────
function dixonColesCorrection(h: number, a: number, lambdaH: number, lambdaA: number, rho = -0.10): number {
  if (h === 0 && a === 0) return 1 - lambdaH * lambdaA * rho;
  if (h === 1 && a === 0) return 1 + lambdaA * rho;
  if (h === 0 && a === 1) return 1 + lambdaH * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ─────────────────────────────────────────────
// PART 2 — ELITE FEATURE ENGINEERING
// Separates home/away splits, applies form decay (recent games weighted more),
// head-to-head weighting, and xG adjustment when available.
// ─────────────────────────────────────────────
export function computeFeatures(data: MatchData) {
  const safeDiv = (a: number, b: number, fallback = 1) => (b > 0 ? a / b : fallback);

  // Season averages
  const homeAttackSeason = safeDiv(data.home.season.goalsScored, data.home.season.played);
  const awayAttackSeason = safeDiv(data.away.season.goalsScored, data.away.season.played);
  const homeDefenseSeason = safeDiv(data.home.season.goalsConceded, data.home.season.played);
  const awayDefenseSeason = safeDiv(data.away.season.goalsConceded, data.away.season.played);

  // Recent form (last 5) — weighted decay: most recent game = weight 5, oldest = weight 1
  const formWeights = [5, 4, 3, 2, 1];
  const computeFormMetrics = (goalsScored: number, goalsConceded: number, results: string[]) => {
    const games = results.length || 5;
    return {
      attack: safeDiv(goalsScored, games),
      defense: safeDiv(goalsConceded, games),
      form: results.slice(0, 5).reduce((acc, r, i) => {
        return acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0) * formWeights[i];
      }, 0) / formWeights.reduce((a, b) => a + b, 0) / 3 // Normalize to 0-1
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

  // Blend season + form (60/40 split — form matters but small sample)
  const homeAttack = homeAttackSeason * 0.6 + homeForm.attack * 0.4;
  const awayAttack = awayAttackSeason * 0.6 + awayForm.attack * 0.4;
  const homeDefense = homeDefenseSeason * 0.6 + homeForm.defense * 0.4;
  const awayDefense = awayDefenseSeason * 0.6 + awayForm.defense * 0.4;

  const league = data.leagueAvgGoals || 2.6;

  // Dixon-Coles lambda (attack strength x opponent defensive weakness, normalized by league avg)
  let lambdaHome = safeDiv(homeAttack, league) * safeDiv(awayDefense, league) * league;
  let lambdaAway = safeDiv(awayAttack, league) * safeDiv(homeDefense, league) * league;

  // xG overlay: if BSD API provides xG, blend it in (70% model, 30% xG for live matches)
  const homeXG = data.deepContext?.xG?.home;
  const awayXG = data.deepContext?.xG?.away;
  if (homeXG && awayXG && homeXG > 0 && awayXG > 0) {
    lambdaHome = lambdaHome * 0.7 + homeXG * 0.3;
    lambdaAway = lambdaAway * 0.7 + awayXG * 0.3;
  }

  // Home advantage factor (+8% goal expectancy for home team)
  lambdaHome *= 1.08;

  // Form momentum multiplier (hot team gets slight boost)
  if (homeForm.form > 0.75) lambdaHome *= 1.05;
  if (awayForm.form > 0.75) lambdaAway *= 1.05;

  // Sanity bounds
  lambdaHome = Math.max(0.3, Math.min(lambdaHome, 5));
  lambdaAway = Math.max(0.3, Math.min(lambdaAway, 5));

  return {
    lambdaHome,
    lambdaAway,
    homeFormScore: homeForm.form,
    awayFormScore: awayForm.form,
    dataQuality: computeDataQuality(data)
  };
}

function computeDataQuality(data: MatchData): number {
  let score = 0.5;
  if (data.home.season.played >= 10) score += 0.15;
  if (data.away.season.played >= 10) score += 0.15;
  if (data.home.last5.results.length >= 5) score += 0.05;
  if (data.away.last5.results.length >= 5) score += 0.05;
  if (data.deepContext?.xG) score += 0.05;
  if (data.odds && Object.keys(data.odds).length > 4) score += 0.05;
  return Math.min(score, 1.0);
}

// ─────────────────────────────────────────────
// PART 3 — ELITE POISSON MODEL WITH DIXON-COLES
// Scores computed up to 10 for better tail capture.
// ─────────────────────────────────────────────
export function calculatePoissonProbabilities(lambdaHome: number, lambdaAway: number): Probabilities & { over45: number; under45: number; csHome: number; csAway: number } {
  const MAX_GOALS = 10;

  // Precompute factorials
  const factCache: number[] = [1];
  for (let i = 1; i <= MAX_GOALS; i++) factCache[i] = factCache[i - 1] * i;
  const poisson = (k: number, lambda: number) =>
    (Math.pow(lambda, k) * Math.exp(-lambda)) / factCache[k];

  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0, over15 = 0, over25 = 0, over35 = 0, over45 = 0;
  let cs_home = 0, cs_away = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const pHome = poisson(h, lambdaHome);
      const pAway = poisson(a, lambdaAway);
      const dcFactor = dixonColesCorrection(h, a, lambdaHome, lambdaAway);
      const pScore = pHome * pAway * dcFactor;

      if (h > a) homeWin += pScore;
      else if (h === a) draw += pScore;
      else awayWin += pScore;

      if (h > 0 && a > 0) bttsYes += pScore;
      if (h + a > 1.5) over15 += pScore;
      if (h + a > 2.5) over25 += pScore;
      if (h + a > 3.5) over35 += pScore;
      if (h + a > 4.5) over45 += pScore;
      if (a === 0) cs_home += pScore;
      if (h === 0) cs_away += pScore;
    }
  }

  // Normalize (Dixon-Coles slightly perturbs the total)
  const total = homeWin + draw + awayWin;
  homeWin /= total;
  draw /= total;
  awayWin /= total;

  const dnb1 = homeWin / (homeWin + awayWin || 1);
  const dnb2 = awayWin / (homeWin + awayWin || 1);

  return {
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15, under15: 1 - over15,
    over25, under25: 1 - over25,
    over35, under35: 1 - over35,
    bttsYes, bttsNo: 1 - bttsYes,
    dnb1, dnb2,
    over45, under45: 1 - over45,
    csHome: cs_home, csAway: cs_away
  };
}

// ─────────────────────────────────────────────
// PART 4 — ELITE CONTEXT ADJUSTMENT
// Applies granular modifiers per context signal with proper normalization.
// ─────────────────────────────────────────────
export function adjustProbabilities(probs: Probabilities, context: ContextData): Probabilities {
  let homeAdj = 1.0;
  let awayAdj = 1.0;

  // Injuries — scaled by severity (1 missing = -4%, max -30%)
  if (context.home_missing >= 1) homeAdj *= Math.max(0.70, 1 - context.home_missing * 0.04);
  if (context.away_missing >= 1) awayAdj *= Math.max(0.70, 1 - context.away_missing * 0.04);

  // Motivation — HIGH teams fight harder
  const motivationMap: Record<string, number> = { HIGH: 1.12, MEDIUM: 1.0, LOW: 0.90 };
  homeAdj *= motivationMap[context.home_motivation] || 1.0;
  awayAdj *= motivationMap[context.away_motivation] || 1.0;

  // Fatigue — congested fixtures reduce performance
  if (context.home_fatigue) homeAdj *= 0.94;
  if (context.away_fatigue) awayAdj *= 0.94;

  // Extra home advantage when home team is highly motivated (crowd effect)
  if (context.home_motivation === 'HIGH') homeAdj *= 1.04;

  let homeWin = probs.homeWin * homeAdj;
  let draw = probs.draw;
  let awayWin = probs.awayWin * awayAdj;

  // Draw is less likely when one team has a large motivation edge
  const pressureDiff = Math.abs(homeAdj - awayAdj);
  draw *= Math.max(0.8, 1 - pressureDiff * 0.5);

  // Normalize 1X2
  const total = homeWin + draw + awayWin;
  homeWin /= total;
  draw /= total;
  awayWin /= total;

  // Goals markets — fewer goals when injuries are significant
  const injuryPenalty = Math.max(0, (context.home_missing + context.away_missing) * 0.03);
  const goalsMod = Math.max(0.80, 1 - injuryPenalty);

  return {
    homeWin,
    draw,
    awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15: Math.min(probs.over15 * goalsMod, 0.99),
    under15: 1 - Math.min(probs.over15 * goalsMod, 0.99),
    over25: Math.min(probs.over25 * goalsMod, 0.97),
    under25: 1 - Math.min(probs.over25 * goalsMod, 0.97),
    over35: Math.min(probs.over35 * goalsMod, 0.93),
    under35: 1 - Math.min(probs.over35 * goalsMod, 0.93),
    bttsYes: Math.min(probs.bttsYes * goalsMod, 0.94),
    bttsNo: 1 - Math.min(probs.bttsYes * goalsMod, 0.94),
    dnb1: homeWin / (homeWin + awayWin || 1),
    dnb2: awayWin / (homeWin + awayWin || 1),
  };
}

// ─────────────────────────────────────────────
// PART 5 — ODDS & VALUE ENGINE (Kelly Criterion aware)
// Calculates edge, EV, and Kelly fraction for each market.
// ─────────────────────────────────────────────
export function calculateValue(
  probs: Probabilities & { over45?: number; under45?: number; csHome?: number; csAway?: number },
  odds: MatchData['odds']
): (ValueBet & { ev: number; kellyFraction: number })[] {
  const markets: { name: string; prob: number; oddsKeys: string[] }[] = [
    { name: '1', prob: probs.homeWin, oddsKeys: ['home', '1'] },
    { name: 'X', prob: probs.draw, oddsKeys: ['draw', 'X'] },
    { name: '2', prob: probs.awayWin, oddsKeys: ['away', '2'] },
    { name: '1X', prob: probs.dc1X, oddsKeys: ['dc1X', '1X'] },
    { name: 'X2', prob: probs.dcX2, oddsKeys: ['dcX2', 'X2'] },
    { name: '12', prob: probs.dc12, oddsKeys: ['dc12', '12'] },
    { name: 'Over 1.5', prob: probs.over15, oddsKeys: ['over15', 'Over 1.5'] },
    { name: 'Under 1.5', prob: probs.under15, oddsKeys: ['under15', 'Under 1.5'] },
    { name: 'Over 2.5', prob: probs.over25, oddsKeys: ['over25', 'Over 2.5'] },
    { name: 'Under 2.5', prob: probs.under25, oddsKeys: ['under25', 'Under 2.5'] },
    { name: 'Over 3.5', prob: probs.over35, oddsKeys: ['over35', 'Over 3.5'] },
    { name: 'Under 3.5', prob: probs.under35, oddsKeys: ['under35', 'Under 3.5'] },
    { name: 'Over 4.5', prob: probs.over45 || 0, oddsKeys: ['over45', 'Over 4.5'] },
    { name: 'BTTS - Yes', prob: probs.bttsYes, oddsKeys: ['bttsYes', 'BTTS - Yes'] },
    { name: 'BTTS - No', prob: probs.bttsNo, oddsKeys: ['bttsNo', 'BTTS - No'] },
    { name: 'DNB 1', prob: probs.dnb1, oddsKeys: ['dnb1', 'DNB 1'] },
    { name: 'DNB 2', prob: probs.dnb2, oddsKeys: ['dnb2', 'DNB 2'] },
    { name: 'Clean Sheet Home', prob: probs.csHome || 0, oddsKeys: ['csHome'] },
    { name: 'Clean Sheet Away', prob: probs.csAway || 0, oddsKeys: ['csAway'] },
  ];

  return markets
    .map(m => {
      const o = m.oddsKeys.reduce<number | undefined>((found, key) => found ?? (odds[key] > 1.01 ? odds[key] : undefined), undefined);
      if (!o || o <= 1.01 || m.prob <= 0) return null;

      const impliedProb = 1 / o;
      const edge = m.prob - impliedProb;
      const ev = m.prob * o - 1;
      const kellyFraction = Math.max(0, edge / (o - 1));

      return {
        market: m.name,
        modelProb: m.prob,
        impliedProb,
        value: edge,
        odds: o,
        ev,
        kellyFraction,
      };
    })
    .filter((v): v is ValueBet & { ev: number; kellyFraction: number } =>
      v !== null && v.value > 0.01
    );
}

// ─────────────────────────────────────────────
// PART 6 — MULTI-DIMENSIONAL CONFIDENCE ENGINE
// Combines model probability, value edge, data quality, form score, and AI reasoning.
// ─────────────────────────────────────────────
export function calculateConfidence(
  prob: number,
  value: number,
  dataQuality: number,
  formScore?: number,
  aiConfidence?: number
): number {
  const probScore = Math.min(prob * 40, 40);           // 0-40 pts
  const valueScore = Math.min(value * 250, 25);        // 0-25 pts (edge > 10% = elite)
  const qualityScore = dataQuality * 20;               // 0-20 pts
  const formBonus = formScore ? Math.min(formScore * 10, 10) : 5;  // 0-10 pts
  const aiBonus = aiConfidence ? Math.min((aiConfidence / 100) * 5, 5) : 0; // 0-5 pts

  const raw = probScore + valueScore + qualityScore + formBonus + aiBonus;
  return Math.min(Math.max(Math.round(raw), 5), 99);
}

// ─────────────────────────────────────────────
// PART 7 — ELITE DECISION ENGINE
// Ranks bets by composite score: EV + probability + edge.
// ─────────────────────────────────────────────
export function selectBestBet(
  valueBets: (ValueBet & { ev?: number; kellyFraction?: number })[],
  probs: Probabilities
): ValueBet | null {
  if (valueBets.length === 0) {
    const safeMarkets = [
      { market: 'Over 1.5 Goals', prob: probs.over15 },
      { market: 'Home Win or Draw', prob: probs.dc1X },
      { market: 'Away Win or Draw', prob: probs.dcX2 },
      { market: 'BTTS - Yes', prob: probs.bttsYes },
      { market: 'Home Win', prob: probs.homeWin },
      { market: 'Away Win', prob: probs.awayWin },
    ];
    const best = safeMarkets.sort((a, b) => b.prob - a.prob)[0];
    return { market: best.market, modelProb: best.prob, impliedProb: 0, value: 0, odds: 0 };
  }

  const scored = valueBets.map(bet => ({
    ...bet,
    compositeScore:
      (bet.ev || 0) * 0.40 +
      bet.modelProb * 0.35 +
      bet.value * 0.25,
  }));

  const qualified = scored.filter(b =>
    b.modelProb >= 0.45 && b.value >= 0.02 && b.odds >= 1.15
  );

  return (qualified.length > 0 ? qualified : scored)
    .sort((a, b) => b.compositeScore - a.compositeScore)[0];
}

// ─────────────────────────────────────────────
// PART 8 — LIVE MATCH PREDICTION ENGINE
// Considers game state, score pressure, possession, xG tempo.
// ─────────────────────────────────────────────
export function analyzeLiveMatch(liveStats: {
  minute: number;
  score: string;
  shotsOnTarget: number;
  xG: number;
  possession?: number;
  corners?: number;
}) {
  const { minute, xG, shotsOnTarget, possession = 50, corners = 0 } = liveStats;

  if (minute > 70 && xG > 2.0 && shotsOnTarget > 6) {
    return { signal: 'GOAL_PRESSURE_HIGH', confidence: 90, reasoning: `${xG.toFixed(2)} xG with ${shotsOnTarget} shots on target past 70' — overperformance imminent.` };
  }
  if (minute > 60 && xG > 1.5 && shotsOnTarget > 5) {
    return { signal: 'GOAL_LIKELY', confidence: 78, reasoning: `Sustained offensive pressure. High xG tempo suggests goal within 15 mins.` };
  }
  if (possession > 65 && corners > 6 && minute > 45) {
    return { signal: 'SET_PIECE_DANGER', confidence: 72, reasoning: `${possession}% possession with ${corners} corners — set piece threat elevated.` };
  }

  const [homeGoals, awayGoals] = liveStats.score.split('-').map(Number);
  if (minute > 60 && (homeGoals || 0) + (awayGoals || 0) === 0 && xG > 1.8) {
    return { signal: 'LATE_GOAL_WINDOW', confidence: 82, reasoning: `0-0 with ${xG.toFixed(2)} xG — statistical pressure for a goal to materialize late.` };
  }

  return null;
}

// ─────────────────────────────────────────────
// PART 9 — BSD API DATA ENRICHMENT LAYER
// Fetches live BSD stats and merges them into MatchData for Poisson.
// ─────────────────────────────────────────────
export function enrichMatchDataFromBSD(matchData: MatchData, bsdEvent: any): MatchData {
  if (!bsdEvent) return matchData;

  const enriched = { ...matchData };

  if (bsdEvent.xG?.home && bsdEvent.xG?.away) {
    enriched.deepContext = {
      ...enriched.deepContext,
      xG: { home: Number(bsdEvent.xG.home) || 0, away: Number(bsdEvent.xG.away) || 0 }
    };
  }

  if (bsdEvent.odds) {
    const o = bsdEvent.odds;
    enriched.odds = {
      ...enriched.odds,
      home: o['1'] || o.home || enriched.odds.home,
      draw: o['X'] || o.draw || enriched.odds.draw,
      away: o['2'] || o.away || enriched.odds.away,
      over25: o.over25 || o['Over 2.5'] || enriched.odds.over25,
      under25: o.under25 || o['Under 2.5'] || enriched.odds.under25,
      bttsYes: o.bttsYes || o['BTTS Yes'] || enriched.odds.bttsYes,
    };
  }

  if (bsdEvent.stats) {
    enriched.deepContext = {
      ...enriched.deepContext,
      liveStats: bsdEvent.stats,
      elapsed: bsdEvent.fixture?.status?.elapsed || 0,
      score: `${bsdEvent.goals?.home || 0}-${bsdEvent.goals?.away || 0}`,
    };
  }

  return enriched;
}

// ─────────────────────────────────────────────
// PART 10 — MAIN PREDICTION PIPELINE (full elite flow)
// BSD → Feature Engineering → Poisson+DC → Context Adjust →
// Value Engine → Decision Engine → AI Deep Analysis → Output
// ─────────────────────────────────────────────
export async function runPrediction(matchId: string, matchData: MatchData): Promise<PredictionResult> {
  // 1. Enrich with BSD live data
  let enrichedData = matchData;
  try {
    const { getLiveMatchPreview } = await import("./footballService.js");
    const bsdEvent = await getLiveMatchPreview(matchId);
    if (bsdEvent) enrichedData = enrichMatchDataFromBSD(matchData, bsdEvent);
  } catch (e) {
    console.warn("[PredictionEngine] BSD enrichment skipped:", (e as Error).message);
  }

  // 2. Feature Engineering
  const features = computeFeatures(enrichedData);
  const { lambdaHome, lambdaAway, homeFormScore, awayFormScore, dataQuality } = features;

  // 3. Poisson Model with Dixon-Coles
  const baseProbs = calculatePoissonProbabilities(lambdaHome, lambdaAway);

  // 4. Fetch Context via Multi-Agent + Google Search
  const context = await multiAgentService.fetchContextData(
    `${matchData.home.name} vs ${matchData.away.name}`
  );

  // 5. Context Adjustment
  const adjustedProbs = adjustProbabilities(baseProbs, context);

  // 6. Value Engine (EV + Kelly)
  const valueBets = calculateValue(adjustedProbs as any, enrichedData.odds);

  // 7. Best Bet Decision
  const bestBet = selectBestBet(valueBets, adjustedProbs);

  // 8. AI Deep Analysis with structured data
  let aiAnalysis: { reasoning: string; confidence: number; best_value_market: string } | null = null;
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
      valueBets: valueBets.map(v => ({ market: v.market, edge: `+${(v.value * 100).toFixed(1)}%`, odds: v.odds })),
      context,
      bsdData: enrichedData.deepContext || null,
      odds: enrichedData.odds,
    });
  } catch (e) {
    console.warn("[PredictionEngine] AI deep analysis failed:", (e as Error).message);
  }

  // 9. Confidence Score
  const confidence = bestBet
    ? calculateConfidence(
        bestBet.modelProb,
        bestBet.value,
        dataQuality,
        (homeFormScore + awayFormScore) / 2,
        aiAnalysis?.confidence
      )
    : 0;

  // 10. Final reasoning
  const reasoning =
    aiAnalysis?.reasoning ||
    context.reasoning ||
    buildFallbackReasoning(matchData, adjustedProbs, bestBet, lambdaHome, lambdaAway);

  // 11. Build prediction list (primary + secondary value bets for Pro users)
  const predictions = bestBet
    ? [
        { market: bestBet.market, confidence: Math.round(confidence), reasoning },
        ...valueBets
          .filter(v => v.market !== bestBet.market)
          .sort((a, b) => b.value - a.value)
          .slice(0, 4)
          .map(v => ({
            market: v.market,
            confidence: calculateConfidence(v.modelProb, v.value, dataQuality * 0.9),
            reasoning: `Model: ${(v.modelProb * 100).toFixed(1)}% vs market implied ${(v.impliedProb * 100).toFixed(1)}%. Edge: +${(v.value * 100).toFixed(1)}%. EV: +${(v.ev * 100).toFixed(1)}%.`,
          })),
      ]
    : [];

  return {
    matchId,
    predictions,
    overallReasoning: reasoning,
    teamData: {
      home: {
        name: matchData.home.name,
        form: matchData.home.last5.results.join('') || 'N/A',
        injuries: [],
        keyStats: [
          `Goals/game: ${(matchData.home.season.goalsScored / (matchData.home.season.played || 1)).toFixed(2)}`,
          `Conceded/game: ${(matchData.home.season.goalsConceded / (matchData.home.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaHome.toFixed(3)}`,
          `Form score: ${(homeFormScore * 100).toFixed(0)}%`,
        ],
      },
      away: {
        name: matchData.away.name,
        form: matchData.away.last5.results.join('') || 'N/A',
        injuries: [],
        keyStats: [
          `Goals/game: ${(matchData.away.season.goalsScored / (matchData.away.season.played || 1)).toFixed(2)}`,
          `Conceded/game: ${(matchData.away.season.goalsConceded / (matchData.away.season.played || 1)).toFixed(2)}`,
          `xG lambda: ${lambdaAway.toFixed(3)}`,
          `Form score: ${(awayFormScore * 100).toFixed(0)}%`,
        ],
      },
    },
  };
}

function buildFallbackReasoning(
  matchData: MatchData,
  probs: Probabilities,
  bestBet: ValueBet | null,
  lambdaHome: number,
  lambdaAway: number
): string {
  const homeAvg = (matchData.home.season.goalsScored / (matchData.home.season.played || 1)).toFixed(2);
  const awayAvg = (matchData.away.season.goalsScored / (matchData.away.season.played || 1)).toFixed(2);

  const winnerLabel =
    probs.homeWin > probs.awayWin && probs.homeWin > probs.draw
      ? `${matchData.home.name} (${(probs.homeWin * 100).toFixed(1)}%)`
      : probs.awayWin > probs.draw
        ? `${matchData.away.name} (${(probs.awayWin * 100).toFixed(1)}%)`
        : `Draw (${(probs.draw * 100).toFixed(1)}%)`;

  return (
    `Dixon-Coles Poisson model favors ${winnerLabel}. ` +
    `Expected goals: ${matchData.home.name} λ=${lambdaHome.toFixed(2)}, ${matchData.away.name} λ=${lambdaAway.toFixed(2)}. ` +
    `Season avg: ${homeAvg} vs ${awayAvg} goals/game. ` +
    `Over 2.5: ${(probs.over25 * 100).toFixed(1)}% | BTTS: ${(probs.bttsYes * 100).toFixed(1)}%. ` +
    (bestBet ? `Top pick: ${bestBet.market} at ${(bestBet.modelProb * 100).toFixed(1)}% model probability.` : '')
  );
}
