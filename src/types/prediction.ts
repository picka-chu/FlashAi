export interface TeamStats {
  id: number;
  name: string;
  last5: {
    goalsScored: number;
    goalsConceded: number;
    results: ('W' | 'D' | 'L')[];
  };
  season: {
    played: number;
    goalsScored: number;
    goalsConceded: number;
  };
}

export interface MatchData {
  id: string;
  home: TeamStats;
  away: TeamStats;
  leagueAvgGoals: number;
  odds: Record<string, number>;
  deepContext?: any;
}

export interface ContextData {
  home_missing: number;
  away_missing: number;
  home_motivation: 'HIGH' | 'MEDIUM' | 'LOW';
  away_motivation: 'HIGH' | 'MEDIUM' | 'LOW';
  home_fatigue: boolean;
  away_fatigue: boolean;
  reasoning: string;
}

export interface Probabilities {
  // 1X2
  homeWin: number;
  draw: number;
  awayWin: number;
  // Double Chance
  dc1X: number;
  dcX2: number;
  dc12: number;
  // Over/Under
  over15: number;
  under15: number;
  over25: number;
  under25: number;
  over35: number;
  under35: number;
  // BTTS
  bttsYes: number;
  bttsNo: number;
  // Draw No Bet
  dnb1: number;
  dnb2: number;
}

export interface ValueBet {
  market: string;
  modelProb: number;
  impliedProb: number;
  value: number;
  odds: number;
}

export interface TeamStructuredData {
  name: string;
  form: string;
  injuries: string[];
  keyStats: string[];
}

export type MarketDataQuality = 'STRONG' | 'MODERATE' | 'LIMITED';

export type PredictionPickType = 'safe' | 'value';

export interface MarketPick {
  market: string;
  confidence: number;
  probability?: number | null;
  odds?: number | null;
  edge?: number | null;
  dataQuality?: MarketDataQuality;
  reasoning: string;
}

export interface PredictionOutcome {
  market: string;
  confidence: number;
  reasoning: string;
  type?: PredictionPickType;
  probability?: number | null;
  odds?: number | null;
  edge?: number | null;
  dataQuality?: MarketDataQuality;
}

export interface PredictionResult {
  matchId: string;
  predictions: PredictionOutcome[];
  overallReasoning: string;
  teamData: {
    home: TeamStructuredData;
    away: TeamStructuredData;
  };
}

export interface BetSlipItem {
  match: string;
  prediction: string;
  odds: number;
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string;
}

export interface BetSlipAnalysis {
  items: BetSlipItem[];
  totalOdds: number;
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  verdict: string;
  suggestedStake: string;
  safePicks?: {
    match: string;
    pick: string;
    odds: number;
    reason: string;
  }[];
  valueBets?: {
    match: string;
    market: string;
    odds: number;
    value: number;
    reason: string;
  }[];
}
