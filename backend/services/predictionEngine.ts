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
 *  4. Dixon-Coles rho is league-specific via leaguePriors.
 *  5. leagueAvgGoals + home advantage come from league-specific priors.
 *  7. Market blending + quality gates (calibration.ts) for stricter tips.
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
import { getLeaguePrior } from "./leaguePriors";
import { blendWithMarket, applyQualityGates } from "./calibration";

// SEE REPO FOR FULL FILE - uploading in parts
export {};
