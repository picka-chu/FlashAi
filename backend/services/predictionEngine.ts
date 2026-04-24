import { 
  MatchData, 
  ContextData, 
  Probabilities, 
  ValueBet, 
  PredictionResult,
  TeamStats
} from "../../src/types/prediction";
import { fetchContextData } from "./geminiService";
import { multiAgentService } from "./multiAgentService";

/**
 * PART 2 — FEATURE ENGINEERING
 */
export function computeFeatures(data: MatchData) {
  const homeAttack = data.home.season.goalsScored / data.home.season.played;
  const awayAttack = data.away.season.goalsScored / data.away.season.played;
  const homeDefense = data.home.season.goalsConceded / data.home.season.played;
  const awayDefense = data.away.season.goalsConceded / data.away.season.played;

  // Lambda calculation (Expected Goals)
  const lambdaHome = (homeAttack / data.leagueAvgGoals) * (awayDefense / data.leagueAvgGoals) * data.leagueAvgGoals;
  const lambdaAway = (awayAttack / data.leagueAvgGoals) * (homeDefense / data.leagueAvgGoals) * data.leagueAvgGoals;

  return { lambdaHome, lambdaAway };
}

/**
 * PART 3 — POISSON MODEL
 */
export function calculatePoissonProbabilities(lambdaHome: number, lambdaAway: number): Probabilities {
  const poisson = (k: number, lambda: number) => {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  };

  const factorial = (n: number): number => {
    if (n === 0) return 1;
    return n * factorial(n - 1);
  };

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const pHome = poisson(h, lambdaHome);
      const pAway = poisson(a, lambdaAway);
      const pScore = pHome * pAway;

      if (h > a) homeWin += pScore;
      else if (h === a) draw += pScore;
      else awayWin += pScore;

      if (h > 0 && a > 0) bttsYes += pScore;
      if (h + a > 1.5) over15 += pScore;
      if (h + a > 2.5) over25 += pScore;
      if (h + a > 3.5) over35 += pScore;
    }
  }

  // Derived markets
  const total1X2 = homeWin + draw + awayWin;
  const dnb1 = homeWin / (homeWin + awayWin || 1);
  const dnb2 = awayWin / (homeWin + awayWin || 1);

  return { 
    homeWin, draw, awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15,
    under15: 1 - over15,
    over25,
    under25: 1 - over25,
    over35,
    under35: 1 - over35,
    bttsYes,
    bttsNo: 1 - bttsYes,
    dnb1,
    dnb2
  };
}

/**
 * PART 4 — CONTEXT ADJUSTMENT
 */
export function adjustProbabilities(probs: Probabilities, context: ContextData): Probabilities {
  let { homeWin, draw, awayWin } = { ...probs };

  // Adjustments based on missing players
  if (context.home_missing > 2) homeWin *= 0.9;
  if (context.away_missing > 2) awayWin *= 0.9;

  // Motivation adjustments
  if (context.home_motivation === 'HIGH') homeWin *= 1.1;
  if (context.away_motivation === 'HIGH') awayWin *= 1.1;

  // Fatigue adjustments
  if (context.home_fatigue) homeWin *= 0.95;
  if (context.away_fatigue) awayWin *= 0.95;

  // Normalize 1X2
  const total = homeWin + draw + awayWin;
  homeWin /= total;
  draw /= total;
  awayWin /= total;

  // Re-derive other markets based on adjusted 1X2 and original ratios
  // This is a simplification, but better than leaving them unadjusted
  const ratio = (homeWin + draw + awayWin) / (probs.homeWin + probs.draw + probs.awayWin);
  
  return {
    homeWin,
    draw,
    awayWin,
    dc1X: homeWin + draw,
    dcX2: awayWin + draw,
    dc12: homeWin + awayWin,
    over15: Math.min(probs.over15 * ratio, 0.99),
    under15: 1 - Math.min(probs.over15 * ratio, 0.99),
    over25: Math.min(probs.over25 * ratio, 0.95),
    under25: 1 - Math.min(probs.over25 * ratio, 0.95),
    over35: Math.min(probs.over35 * ratio, 0.90),
    under35: 1 - Math.min(probs.over35 * ratio, 0.90),
    bttsYes: Math.min(probs.bttsYes * ratio, 0.95),
    bttsNo: 1 - Math.min(probs.bttsYes * ratio, 0.95),
    dnb1: homeWin / (homeWin + awayWin || 1),
    dnb2: awayWin / (homeWin + awayWin || 1)
  };
}

/**
 * PART 5 — ODDS & VALUE ENGINE
 */
export function calculateValue(probs: Probabilities, odds: MatchData['odds']): ValueBet[] {
  const markets = [
    { name: '1', prob: probs.homeWin, odds: odds.home || odds['1'] },
    { name: 'X', prob: probs.draw, odds: odds.draw || odds['X'] },
    { name: '2', prob: probs.awayWin, odds: odds.away || odds['2'] },
    { name: '1X', prob: probs.dc1X, odds: odds.dc1X || odds['1X'] },
    { name: 'X2', prob: probs.dcX2, odds: odds.dcX2 || odds['X2'] },
    { name: '12', prob: probs.dc12, odds: odds.dc12 || odds['12'] },
    { name: 'Over 1.5', prob: probs.over15, odds: odds.over15 || odds['Over 1.5'] },
    { name: 'Under 1.5', prob: probs.under15, odds: odds.under15 || odds['Under 1.5'] },
    { name: 'Over 2.5', prob: probs.over25, odds: odds.over25 || odds['Over 2.5'] },
    { name: 'Under 2.5', prob: probs.under25, odds: odds.under25 || odds['Under 2.5'] },
    { name: 'Over 3.5', prob: probs.over35, odds: odds.over35 || odds['Over 3.5'] },
    { name: 'Under 3.5', prob: probs.under35, odds: odds.under35 || odds['Under 3.5'] },
    { name: 'BTTS - Yes', prob: probs.bttsYes, odds: odds.bttsYes || odds['BTTS - Yes'] },
    { name: 'BTTS - No', prob: probs.bttsNo, odds: odds.bttsNo || odds['BTTS - No'] },
    { name: 'DNB 1', prob: probs.dnb1, odds: odds.dnb1 || odds['DNB 1'] },
    { name: 'DNB 2', prob: probs.dnb2, odds: odds.dnb2 || odds['DNB 2'] },
  ];

  return markets
    .filter(m => m.odds && m.odds > 1) // Only check markets where we have valid odds
    .map(m => {
      const impliedProb = 1 / m.odds!;
      const value = m.prob - impliedProb;
      return {
        market: m.name,
        modelProb: m.prob,
        impliedProb,
        value,
        odds: m.odds!
      };
    })
    .filter(v => v.value > 0);
}

/**
 * PART 6 — CONFIDENCE ENGINE
 */
export function calculateConfidence(prob: number, value: number, dataQuality: number): number {
  if (value === 0) {
    // Fallback confidence based purely on probability
    return Math.round(prob * 100);
  }
  // Simple weighted score
  const score = (prob * 40) + (value * 400) + (dataQuality * 20);
  return Math.min(Math.max(score, 0), 100);
}

/**
 * PART 7 — FINAL DECISION ENGINE
 */
export function selectBestBet(valueBets: ValueBet[], probs: Probabilities): ValueBet | null {
  const best = valueBets.sort((a, b) => b.value - a.value)[0];
  
  if (best && best.modelProb > 0.50 && best.value > 0.02) {
    return best;
  }

  // Fallback to highest probability market if no strong value bet found
  const markets = [
    { market: 'Home Win', prob: probs.homeWin },
    { market: 'Away Win', prob: probs.awayWin },
    { market: 'Draw', prob: probs.draw },
    { market: 'Over 1.5 Goals', prob: probs.over15 },
    { market: 'Under 3.5 Goals', prob: probs.under35 },
    { market: 'BTTS - Yes', prob: probs.bttsYes },
  ];

  const highestProb = markets.sort((a, b) => b.prob - a.prob)[0];
  
  return {
    market: highestProb.market,
    modelProb: highestProb.prob,
    impliedProb: 0,
    value: 0,
    odds: 0
  };
}

/**
 * PART 8 — LIVE PREDICTION ENGINE
 */
export function analyzeLiveMatch(liveStats: { minute: number, score: string, shotsOnTarget: number, xG: number }) {
  if (liveStats.minute > 70 && liveStats.xG > 1.5 && liveStats.shotsOnTarget > 5) {
    return { signal: 'GOAL_LIKELY', confidence: 85 };
  }
  return null;
}

/**
 * PART 10 — MAIN PIPELINE
 */
export async function runPrediction(matchId: string, matchData: MatchData): Promise<PredictionResult> {
  // 1. Context Data (Gemini + Google Search)
  const context = await multiAgentService.fetchContextData(`${matchData.home.name} vs ${matchData.away.name}`);

  // 2. Feature Engineering
  const { lambdaHome, lambdaAway } = computeFeatures(matchData);

  // 3. Poisson Model
  const baseProbs = calculatePoissonProbabilities(lambdaHome, lambdaAway);

  // 4. Context Adjustment
  const adjustedProbs = adjustProbabilities(baseProbs, context);

  // 5. Value Engine
  const valueBets = calculateValue(adjustedProbs, matchData.odds);

  // 6. Best Bet Selection
  const bestBet = selectBestBet(valueBets, adjustedProbs);

  // 7. Confidence Calculation
  const confidence = bestBet 
    ? calculateConfidence(bestBet.modelProb, bestBet.value, 0.9) 
    : 0;

  // 8. Deep AI Analysis (Multi-Agent with Gemini 1.5 Pro)
  let deepReasoning = "";
  try {
    const aiAnalysis = await multiAgentService.analyzeMatch({
      match: `${matchData.home.name} vs ${matchData.away.name}`,
      stats: { home: matchData.home.season, away: matchData.away.season },
      probabilities: adjustedProbs,
      context: context
    });
    
    // aiAnalysis is now a parsed object, not a string
    deepReasoning = aiAnalysis.reasoning || aiAnalysis.analysis || "";
  } catch (e) {
    console.warn("Deep AI analysis failed, using fallback reasoning", e);
  }

  // 9. Construct final reasoning
  const reasoning = deepReasoning || context.reasoning || `Model suggests ${adjustedProbs.homeWin > 0.5 ? 'Home Win' : adjustedProbs.awayWin > 0.5 ? 'Away Win' : 'Draw'} based on season stats and recent form.`;

  return {
    matchId,
    predictions: bestBet ? [{
      market: bestBet.market,
      confidence: Math.round(confidence),
      reasoning: reasoning
    }] : [],
    overallReasoning: reasoning,
    teamData: {
      home: { name: matchData.home.name, form: matchData.home.last5.results.join(''), injuries: [], keyStats: [] },
      away: { name: matchData.away.name, form: matchData.away.last5.results.join(''), injuries: [], keyStats: [] }
    }
  };
}
