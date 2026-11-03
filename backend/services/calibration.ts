/**
 * Calibration helpers for the prediction engine.
 *
 * Goals:
 *  1. Anchor model probabilities to the market when data quality is imperfect.
 *  2. Enforce stricter "no-bet" discipline so low-quality predictions are not
 *     presented as high-confidence tips.
 */

export type BlendInput = {
  modelProb: number;
  marketOdds?: number | null;
  dataQuality: number; // 0–1
};

/**
 * Convert decimal odds to implied probability (no overround removal).
 */
export function impliedProbFromOdds(odds?: number | null): number | null {
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1.01) return null;
  return 1 / odds;
}

/**
 * Blend model probability with market-implied probability.
 *
 * Weight on the model rises with data quality:
 *  - quality 0.3 → ~35% model / 65% market
 *  - quality 0.6 → ~60% model / 40% market
 *  - quality 0.9 → ~85% model / 15% market
 *
 * When no usable market odds exist, the model probability is returned unchanged.
 */
export function blendWithMarket(input: BlendInput): number {
  const { modelProb, marketOdds, dataQuality } = input;
  const marketProb = impliedProbFromOdds(marketOdds);
  if (marketProb === null) {
    return clamp01(modelProb);
  }

  const q = clamp01(dataQuality);
  // Model weight between 0.30 and 0.90
  const modelWeight = 0.30 + q * 0.60;
  const blended = modelWeight * modelProb + (1 - modelWeight) * marketProb;
  return clamp01(blended);
}

export type QualityGateResult = {
  /** Adjusted confidence (0–100 scale used by the app) */
  confidence: number;
  /** True when the tip should be suppressed or marked speculative */
  noBet: boolean;
  /** Human-readable reason when noBet is true */
  reason?: string;
};

/**
 * Apply data-quality and edge gates before publishing a tip.
 *
 * Rules (conservative):
 *  - dataQuality < 0.40  → hard no-bet
 *  - dataQuality < 0.55  → confidence capped at 62
 *  - edge < 3%           → no-bet for value tips
 *  - confidence hard-capped at 92 (never claim near-certainty)
 */
export function applyQualityGates(opts: {
  rawConfidence: number;
  dataQuality: number;
  edge?: number | null;
  requireEdge?: boolean;
}): QualityGateResult {
  const quality = clamp01(opts.dataQuality);
  let confidence = Math.round(
    Math.min(92, Math.max(50, Number(opts.rawConfidence) || 55)),
  );

  if (quality < 0.40) {
    return {
      confidence: Math.min(confidence, 55),
      noBet: true,
      reason: "Insufficient data quality for a reliable tip",
    };
  }

  if (quality < 0.55) {
    confidence = Math.min(confidence, 62);
  }

  const edge = opts.edge;
  if (opts.requireEdge && (typeof edge !== "number" || edge < 0.03)) {
    return {
      confidence,
      noBet: true,
      reason: "No meaningful edge versus the market",
    };
  }

  // Mild confidence discount when quality is only moderate
  if (quality < 0.70) {
    confidence = Math.round(confidence * (0.85 + quality * 0.15));
  }

  return { confidence: Math.min(92, confidence), noBet: false };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
