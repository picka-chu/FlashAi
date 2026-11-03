/**
 * League-specific priors for the prediction engine.
 * These replace the previous global constants and improve calibration
 * across different competitions.
 *
 * Values are conservative starting points and should be refreshed
 * periodically from historical results.
 */

export type LeaguePrior = {
  /** Average total goals per match */
  avgGoals: number;
  /** Home advantage multiplier applied to home lambda */
  homeAdvantage: number;
  /** Dixon-Coles rho (low-score correction) */
  rho: number;
  /** Typical draw rate (informational / soft prior) */
  drawRate: number;
};

const DEFAULT_PRIOR: LeaguePrior = {
  avgGoals: 2.65,
  homeAdvantage: 1.08,
  rho: -0.13,
  drawRate: 0.26,
};

/** Normalised league name → prior */
const LEAGUE_PRIORS: Record<string, LeaguePrior> = {
  // Big-5
  "premier league": { avgGoals: 2.85, homeAdvantage: 1.07, rho: -0.12, drawRate: 0.24 },
  "english premier league": { avgGoals: 2.85, homeAdvantage: 1.07, rho: -0.12, drawRate: 0.24 },
  "la liga": { avgGoals: 2.55, homeAdvantage: 1.09, rho: -0.13, drawRate: 0.27 },
  "serie a": { avgGoals: 2.50, homeAdvantage: 1.08, rho: -0.14, drawRate: 0.28 },
  "bundesliga": { avgGoals: 3.10, homeAdvantage: 1.06, rho: -0.11, drawRate: 0.23 },
  "ligue 1": { avgGoals: 2.70, homeAdvantage: 1.08, rho: -0.13, drawRate: 0.26 },

  // Other strong European
  "eredivisie": { avgGoals: 3.15, homeAdvantage: 1.10, rho: -0.10, drawRate: 0.22 },
  "primeira liga": { avgGoals: 2.60, homeAdvantage: 1.11, rho: -0.13, drawRate: 0.27 },
  "championship": { avgGoals: 2.70, homeAdvantage: 1.08, rho: -0.12, drawRate: 0.27 },
  "super lig": { avgGoals: 2.80, homeAdvantage: 1.12, rho: -0.12, drawRate: 0.25 },
  "süper lig": { avgGoals: 2.80, homeAdvantage: 1.12, rho: -0.12, drawRate: 0.25 },

  // Cups / continental
  "uefa champions league": { avgGoals: 2.80, homeAdvantage: 1.06, rho: -0.12, drawRate: 0.24 },
  "champions league": { avgGoals: 2.80, homeAdvantage: 1.06, rho: -0.12, drawRate: 0.24 },
  "uefa europa league": { avgGoals: 2.70, homeAdvantage: 1.07, rho: -0.13, drawRate: 0.25 },
  "europa league": { avgGoals: 2.70, homeAdvantage: 1.07, rho: -0.13, drawRate: 0.25 },
  "conference league": { avgGoals: 2.65, homeAdvantage: 1.08, rho: -0.13, drawRate: 0.26 },

  // Africa (more variable, slightly higher home advantage)
  "ethiopian premier league": { avgGoals: 2.40, homeAdvantage: 1.14, rho: -0.14, drawRate: 0.29 },
  "egyptian premier league": { avgGoals: 2.35, homeAdvantage: 1.13, rho: -0.14, drawRate: 0.30 },
  "south african premiership": { avgGoals: 2.30, homeAdvantage: 1.12, rho: -0.14, drawRate: 0.30 },
  "caf champions league": { avgGoals: 2.35, homeAdvantage: 1.12, rho: -0.13, drawRate: 0.29 },
};

/**
 * Resolve a league prior from a free-text league name.
 * Falls back to a conservative default when unknown.
 */
export function getLeaguePrior(leagueName?: string | null): LeaguePrior {
  if (!leagueName || typeof leagueName !== "string") return { ...DEFAULT_PRIOR };

  const key = leagueName.trim().toLowerCase();
  if (LEAGUE_PRIORS[key]) return { ...LEAGUE_PRIORS[key] };

  // Fuzzy contains match for common variants
  for (const [name, prior] of Object.entries(LEAGUE_PRIORS)) {
    if (key.includes(name) || name.includes(key)) {
      return { ...prior };
    }
  }

  return { ...DEFAULT_PRIOR };
}

export { DEFAULT_PRIOR };
