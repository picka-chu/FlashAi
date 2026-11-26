/**
 * Country-aware pricing catalog for Flash AI.
 *
 * Design rules (see docs/02-pricing-strategy.md):
 *  1. Prices are FIXED in local currency. They are never derived from a live
 *     USD rate at checkout - FX drift must not silently reprice a subscriber.
 *     `usdRate` is only used for reporting and margin analysis.
 *  2. Every plan's allowance is capped by a cost budget, not by marketing.
 *     `AI_COST` below is the measured cost per analysis; a plan is only
 *     considered healthy when the worst-case margin clears `TARGET_MARGIN`.
 *  3. Payment methods are declared per country with their real capability
 *     (recurring vs one-time). Never advertise "auto-renew" on a rail that
 *     cannot charge without the user present.
 */

export type CountryCode = "ET" | "KE" | "NG" | "GH" | "TZ" | "UG" | "ZA" | "GLOBAL";
export type CurrencyCode = "ETB" | "KES" | "NGN" | "GHS" | "TZS" | "UGX" | "ZAR" | "USD";
export type PlanId =
  | "free"
  | "day_pass"
  | "weekly"
  | "monthly_basic"
  | "monthly_pro"
  | "credits_20"
  | "credits_50"
  | "credits_100"
  | "credits_250";

export type BillingInterval = "free" | "day" | "week" | "month" | "credit_pack";

export interface PlanOffer {
  id: PlanId;
  name: string;
  /** Price in minor units of `currency` (e.g. santim, kobo, cents). 0 for free. */
  priceMinor: number;
  currency: CurrencyCode;
  interval: BillingInterval;
  /** Access window in days. 0 for free. */
  durationDays: number;
  /**
   * Total credit bundle for the pass. One credit = one analysis (match or bet slip).
   * Unlike the old daily-reset model, credits are a pool the user spends at their
   * own pace within the validity window.
   */
  credits: number;
  /** Optional daily allowance (used by the free trial only). Paid passes are credit pools. */
  dailyCap?: number;
  /** Bet-slip images per analysis. */
  maxBetSlipImages: number;
  /** Share of picks unlocked: 1 = safe only, 2 = safe+value, 4 = full board. */
  picksUnlocked: number;
  features: string[];
  /** False when the rail cannot auto-charge; UI must say "30 days", not "per month". */
  recurring: boolean;
  badge?: "popular" | "best_value";
}

export interface PaymentMethod {
  id:
    | "chapa"
    | "telebirr"
    | "cbe_birr"
    | "mpesa"
    | "paystack"
    | "flutterwave"
    | "pesapal"
    | "mtn_momo"
    | "airtel_money"
    | "opay"
    | "card"
    | "whop"
    | "telegram_stars"
    | "ton";
  label: string;
  /** Gateway that actually settles the money. */
  provider: string;
  /** Can this rail charge again without the user present? */
  supportsRecurring: boolean;
  /** Priority in the checkout sheet. Lower = shown first. */
  priority: number;
  /** True when a foreign-owned entity can onboard without a local company. */
  foreignEntityFriendly: boolean;
  notes?: string;
}

export interface CountryMarket {
  code: CountryCode;
  name: string;
  currency: CurrencyCode;
  /** Reporting only - never used to compute a checkout price. */
  usdRate: number;
  /** Local mobile-money / wallet names shown in the checkout copy. */
  wallets: string[];
  /** 2026 wage anchor used to sanity-check affordability, in local currency. */
  avgFormalMonthlyWage: number;
  /** Price points that read as "normal" locally (used for future A/B tests). */
  priceAnchors: number[];
  taxNote: string;
  /** Can a paid, compliant funnel exist here today? Drives the UI banner. */
  monetisationStatus: "open" | "restricted" | "grey";
  paymentMethods: PaymentMethod[];
}

/**
 * Measured Gemini cost per grounded analysis (USD), Nov 2026 list prices.
 *
 * Breakdown of the "current" path (backend/services/multiAgentService.ts):
 *   analyzeMatch            -> 1 grounded request
 *   fetchContextData        -> 1 grounded request (search-grounded context)
 *   fetchMatchDataFallback  -> 1 grounded request (only on cache miss)
 *   tokens: ~6k in @ $0.75/M + ~1.5k out @ $3.75/M ~= $0.010 per request
 *   grounding: $14 / 1,000 requests = $0.014 per request
 *   => ~$0.024 per grounded request; 3 requests ~= $0.07 worst case.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing (read 25 Nov 2026).
 * Prices double on 1 Jan 2027 for the 3.x Flash line, so this stays conservative.
 */
export const AI_COST = {
  /** Today's path: up to 3 grounded requests on a Flash-tier model. */
  currentPerAnalysis: 0.06,
  /** After collapsing to 1 grounded request + cached match context. */
  optimisedPerAnalysis: 0.025,
  /** Bet-slip OCR: one vision request, no grounding. */
  perBetSlipImage: 0.004,
} as const;

/**
 * Minimum gross margin a paid plan must clear when a user runs the pass at its
 * hard cap. 65% keeps room for gateway fees (2-5%), VAT, refunds and support.
 */
export const TARGET_MARGIN = 0.65;

const PAYMENT_METHODS: Record<CountryCode, PaymentMethod[]> = {
  ET: [
    {
      id: "chapa",
      label: "Telebirr / CBE Birr / Card",
      provider: "Chapa",
      supportsRecurring: false,
      priority: 1,
      foreignEntityFriendly: false,
      notes: "Requires an Ethiopian registered merchant and ETB settlement account. One-time only.",
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 2,
      foreignEntityFriendly: true,
      notes: "~35% effective haircut; the only rail Telegram's ToS allows inside the Mini App.",
    },
    {
      id: "ton",
      label: "TON",
      provider: "TON Connect",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
      notes: "Negligible reach in ET; keep as power-user fallback only.",
    },
  ],
  KE: [
    {
      id: "mpesa",
      label: "M-Pesa",
      provider: "Flutterwave / Pesapal",
      supportsRecurring: false,
      priority: 1,
      foreignEntityFriendly: true,
      notes: "STK push is one-time; no standing order for most merchants.",
    },
    {
      id: "card",
      label: "Visa / Mastercard",
      provider: "Flutterwave",
      supportsRecurring: true,
      priority: 2,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
    },
  ],
  NG: [
    {
      id: "paystack",
      label: "Card / Bank transfer / USSD",
      provider: "Paystack",
      supportsRecurring: true,
      priority: 1,
      foreignEntityFriendly: true,
    },
    {
      id: "opay",
      label: "OPay / PalmPay",
      provider: "Paystack / Flutterwave",
      supportsRecurring: false,
      priority: 2,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
    },
  ],
  GH: [
    {
      id: "mtn_momo",
      label: "MTN MoMo",
      provider: "Paystack / Flutterwave",
      supportsRecurring: false,
      priority: 1,
      foreignEntityFriendly: true,
    },
    {
      id: "card",
      label: "Visa / Mastercard",
      provider: "Paystack",
      supportsRecurring: true,
      priority: 2,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
    },
  ],
  TZ: [
    {
      id: "mpesa",
      label: "M-Pesa / Mixx by Yas / Airtel Money",
      provider: "Flutterwave / Pesapal",
      supportsRecurring: false,
      priority: 1,
      foreignEntityFriendly: true,
    },
    {
      id: "card",
      label: "Visa / Mastercard",
      provider: "Flutterwave",
      supportsRecurring: true,
      priority: 2,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
    },
  ],
  UG: [
    {
      id: "mtn_momo",
      label: "MTN MoMo / Airtel Money",
      provider: "Flutterwave / Pesapal",
      supportsRecurring: false,
      priority: 1,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 2,
      foreignEntityFriendly: true,
    },
  ],
  ZA: [
    {
      id: "card",
      label: "Visa / Mastercard / Instant EFT",
      provider: "Paystack / Ozow",
      supportsRecurring: true,
      priority: 1,
      foreignEntityFriendly: true,
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 2,
      foreignEntityFriendly: true,
    },
  ],
  GLOBAL: [
    {
      id: "whop",
      label: "Card (Whop)",
      provider: "Whop",
      supportsRecurring: true,
      priority: 1,
      foreignEntityFriendly: true,
      notes: "Primary card rail for the rest of the world.",
    },
    {
      id: "telegram_stars",
      label: "Telegram Stars",
      provider: "Telegram",
      supportsRecurring: false,
      priority: 2,
      foreignEntityFriendly: true,
    },
    {
      id: "ton",
      label: "TON",
      provider: "TON Connect",
      supportsRecurring: false,
      priority: 3,
      foreignEntityFriendly: true,
    },
  ],
};

interface PricePoints {
  day: number;
  week: number;
  basic: number;
  pro: number;
}

function paidOffers(currency: CurrencyCode, p: PricePoints): PlanOffer[] {
  // Top-ups use the Basic pass's per-credit rate and round up, protecting margin.
  const creditPackPrice = (credits: number) => Math.ceil((p.basic * credits / 16) / 100) * 100;
  return [
    {
      id: "day_pass",
      name: "Match Day Pass",
      priceMinor: p.day,
      currency,
      interval: "day",
      durationDays: 1,
      credits: 1,
      maxBetSlipImages: 2,
      picksUnlocked: 2,
      features: ["1 credit • valid for 1 day", "Safe + Value pick", "AI chat after analysis", "Nothing auto-renews"],
      recurring: false,
    },
    {
      id: "weekly",
      name: "7-Day Pass",
      priceMinor: p.week,
      currency,
      interval: "week",
      durationDays: 7,
      credits: 6,
      maxBetSlipImages: 2,
      picksUnlocked: 2,
      features: ["6 credits • valid for 7 days", "Use credits any time during the pass", "Safe + Value picks", "AI chat after analysis"],
      recurring: false,
    },
    {
      id: "monthly_basic",
      name: "30-Day Basic",
      priceMinor: p.basic,
      currency,
      interval: "month",
      durationDays: 30,
      credits: 16,
      maxBetSlipImages: 2,
      picksUnlocked: 2,
      features: [
        "16 credits • valid for 30 days",
        "Use credits any time during the pass",
        "Safe + Value picks",
        "AI chat after analysis",
        "Renew manually - no card stored",
      ],
      recurring: false,
      badge: "popular",
    },
    {
      id: "monthly_pro",
      name: "30-Day Pro",
      priceMinor: p.pro,
      currency,
      interval: "month",
      durationDays: 30,
      credits: 31,
      maxBetSlipImages: 6,
      picksUnlocked: 4,
      features: [
        "31 credits • valid for 30 days",
        "Use credits any time during the pass",
        "Full board (2 Safe + 2 Value)",
        "Bet-slip image analysis (up to 6 images)",
        "Top-pick accumulator",
        "AI chat after analysis",
        "Live match analysis",
      ],
      recurring: false,
      badge: "best_value",
    },
    // Standalone credit packs - no expiry, just add credits to balance.
    // Users can buy these anytime to top up without a pass.
    {
      id: "credits_20",
      name: "20 Credit Pack",
      priceMinor: creditPackPrice(20),
      currency,
      interval: "credit_pack",
      durationDays: 0,
      credits: 20,
      maxBetSlipImages: 2,
      picksUnlocked: 2,
      features: ["20 bonus credits", "No expiry", "Stacks with any pass"],
      recurring: false,
    },
    {
      id: "credits_50",
      name: "50 Credit Pack",
      priceMinor: creditPackPrice(50),
      currency,
      interval: "credit_pack",
      durationDays: 0,
      credits: 50,
      maxBetSlipImages: 2,
      picksUnlocked: 2,
      features: ["50 bonus credits", "No expiry", "Stacks with any pass"],
      recurring: false,
    },
    {
      id: "credits_100",
      name: "100 Credit Pack",
      priceMinor: creditPackPrice(100),
      currency,
      interval: "credit_pack",
      durationDays: 0,
      credits: 100,
      maxBetSlipImages: 6,
      picksUnlocked: 4,
      features: ["100 bonus credits", "No expiry", "Stacks with any pass"],
      recurring: false,
    },
    {
      id: "credits_250",
      name: "250 Credit Pack",
      priceMinor: creditPackPrice(250),
      currency,
      interval: "credit_pack",
      durationDays: 0,
      credits: 250,
      maxBetSlipImages: 6,
      picksUnlocked: 4,
      features: ["250 bonus credits", "No expiry", "Stacks with any pass", "Best value"],
      recurring: false,
      badge: "best_value",
    },
  ];
}

export const MIN_CREDIT_PACK = 10;
export const MAX_CREDIT_PACK = 1000;

export const MARKETS: Record<CountryCode, CountryMarket> = {
  ET: {
    code: "ET",
    name: "Ethiopia",
    currency: "ETB",
    usdRate: 161.54,
    wallets: ["Telebirr", "CBE Birr", "Amole", "M-Pesa Ethiopia"],
    avgFormalMonthlyWage: 6500,
    priceAnchors: [39, 59, 99, 199, 299, 499, 999],
    taxNote: "15% VAT on digital services. Chapa settlement must be to an ETB account.",
    monetisationStatus: "grey",
    paymentMethods: PAYMENT_METHODS.ET,
  },
  KE: {
    code: "KE",
    name: "Kenya",
    currency: "KES",
    usdRate: 129.98,
    wallets: ["M-Pesa", "Airtel Money"],
    avgFormalMonthlyWage: 16114,
    priceAnchors: [49, 99, 199, 299, 399, 799],
    taxNote: "16% VAT on digital services; Flutterwave/Pesapal remit for you.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.KE,
  },
  NG: {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    usdRate: 1366.83,
    wallets: ["OPay", "PalmPay", "Moniepoint"],
    avgFormalMonthlyWage: 70000,
    priceAnchors: [500, 1000, 2000, 3900, 7900],
    taxNote: "7.5% VAT on digital services.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.NG,
  },
  GH: {
    code: "GH",
    name: "Ghana",
    currency: "GHS",
    usdRate: 11.88,
    wallets: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"],
    avgFormalMonthlyWage: 588,
    priceAnchors: [5, 15, 24, 39, 79],
    taxNote: "15% VAT + levies on electronic services.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.GH,
  },
  TZ: {
    code: "TZ",
    name: "Tanzania",
    currency: "TZS",
    usdRate: 2668.41,
    wallets: ["M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa"],
    avgFormalMonthlyWage: 120000,
    priceAnchors: [900, 2900, 4900, 7900, 15900],
    taxNote: "18% VAT on digital services.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.TZ,
  },
  UG: {
    code: "UG",
    name: "Uganda",
    currency: "UGX",
    usdRate: 4085.84,
    wallets: ["MTN MoMo", "Airtel Money"],
    avgFormalMonthlyWage: 600000,
    priceAnchors: [1500, 4900, 9900, 11900, 23900],
    taxNote: "18% VAT on digital services. Player age floor rose to 25 in Jul 2026.",
    monetisationStatus: "restricted",
    paymentMethods: PAYMENT_METHODS.UG,
  },
  ZA: {
    code: "ZA",
    name: "South Africa",
    currency: "ZAR",
    usdRate: 17.53,
    wallets: ["Instant EFT", "Capitec Pay"],
    avgFormalMonthlyWage: 5240,
    priceAnchors: [19, 29, 49, 69, 129],
    taxNote: "15% VAT on digital services.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.ZA,
  },
  GLOBAL: {
    code: "GLOBAL",
    name: "Rest of world",
    currency: "USD",
    usdRate: 1,
    wallets: [],
    avgFormalMonthlyWage: 1200,
    priceAnchors: [0.99, 2.99, 4.99, 6.99, 12.99],
    taxNote: "Merchant-of-record (Whop) collects VAT/GST.",
    monetisationStatus: "open",
    paymentMethods: PAYMENT_METHODS.GLOBAL,
  },
};

/**
 * Price points are set from affordability anchors, then checked against the
 * cost cap. Every plan below clears TARGET_MARGIN at its hard cap - see
 * `estimateEconomics` and GET /api/pricing/economics.
 */
const OFFERS: Record<CountryCode, PlanOffer[]> = {
  // ETB 499/mo is ~7.7% of an average formal wage and ~$3.09 at 161.54.
  ET: paidOffers("ETB", { day: 5900, week: 19900, basic: 49900, pro: 99900 }),
  // Anchored under Showmax All-Devices (KES 550).
  KE: paidOffers("KES", { day: 4900, week: 15900, basic: 39900, pro: 79900 }),
  // Anchored under Showmax All-Devices (NGN 4,500).
  NG: paidOffers("NGN", { day: 50000, week: 150000, basic: 399000, pro: 790000 }),
  // Anchored above Showmax Mobile (GHS 24.30); 39 reads as an impulse add-on.
  GH: paidOffers("GHS", { day: 500, week: 1500, basic: 3900, pro: 7900 }),
  TZ: paidOffers("TZS", { day: 90000, week: 290000, basic: 790000, pro: 1590000 }),
  UG: paidOffers("UGX", { day: 150000, week: 490000, basic: 1190000, pro: 2390000 }),
  ZA: paidOffers("ZAR", { day: 900, week: 2900, basic: 6900, pro: 12900 }),
  GLOBAL: paidOffers("USD", { day: 99, week: 299, basic: 699, pro: 1299 }),
};

export const FREE_OFFER: PlanOffer = {
  id: "free",
  name: "Free",
  priceMinor: 0,
  currency: "USD",
  interval: "free",
  durationDays: 0,
  credits: 3,
  dailyCap: 3,
  maxBetSlipImages: 1,
  picksUnlocked: 1,
  features: ["3 credits per day", "1 free pick", "History and live scores"],
  recurring: false,
};

/** Stars are currency-agnostic; Telegram keeps ~35%, so these net ~$3 / $6. */
export const PLAN_STARS: Record<string, number> = {
  day_pass: 30,
  weekly: 95,
  monthly_basic: 240,
  monthly_pro: 480,
};

export function normalizeCountry(raw?: string | null): CountryCode {
  const code = String(raw || "").trim().toUpperCase();
  if (code in MARKETS) return code as CountryCode;
  return "GLOBAL";
}

/** Like `normalizeCountry`, but returns null instead of falling back to GLOBAL. */
export function parseCountry(raw?: string | null): CountryCode | null {
  const code = String(raw || "").trim().toUpperCase();
  return code in MARKETS ? (code as CountryCode) : null;
}

export function getOffer(
  country: string | null | undefined,
  planId: string,
): PlanOffer | undefined {
  return getOffers(country).find((offer) => offer.id === planId);
}

export function getMarket(country: string | null | undefined): CountryMarket {
  return MARKETS[normalizeCountry(country)];
}

export function getOffers(country: string | null | undefined): PlanOffer[] {
  const code = normalizeCountry(country);
  const free: PlanOffer = { ...FREE_OFFER, currency: MARKETS[code].currency };
  // Top-ups are only shown where a supported checkout rail can fulfil them.
  const marketOffers = code === "ET" || code === "GLOBAL"
    ? OFFERS[code]
    : OFFERS[code].filter((offer) => offer.interval !== "credit_pack");
  return [free, ...marketOffers];
}

export function getPaymentMethods(country: string | null | undefined): PaymentMethod[] {
  return [...getMarket(country).paymentMethods].sort((a, b) => a.priority - b.priority);
}

export interface OfferEconomics {
  offer: PlanOffer;
  revenueUsd: number;
  /** Worst case: user spends the entire purchased credit pool. */
  creditsAtCap: number;
  /** @deprecated Compatibility field; mirrors credit units, not bet-slip count. */
  analysesAtCap: number;
  costAtCapUsd: number;
  marginAtCap: number;
  healthyAtCap: boolean;
  /** Analyses the price could fund at 0% margin - the absolute ceiling. */
  breakEvenCredits: number;
  /** @deprecated Compatibility field. */
  breakEvenAnalyses: number;
}

export function estimateEconomics(
  offer: PlanOffer,
  country: string | null | undefined,
  perAnalysisUsd: number = AI_COST.currentPerAnalysis,
): OfferEconomics {
  const market = getMarket(country);
  const units = offer.priceMinor / 100;
  const revenueUsd = offer.currency === "USD" ? units : units / market.usdRate;
  const creditsAtCap = offer.credits;
  const costAtCapUsd = creditsAtCap * perAnalysisUsd;
  const marginAtCap = revenueUsd > 0 ? (revenueUsd - costAtCapUsd) / revenueUsd : 0;
  return {
    offer,
    revenueUsd,
    creditsAtCap,
    analysesAtCap: creditsAtCap,
    costAtCapUsd,
    marginAtCap,
    healthyAtCap: marginAtCap >= TARGET_MARGIN,
    breakEvenCredits: perAnalysisUsd > 0 ? Math.floor(revenueUsd / perAnalysisUsd) : 0,
    breakEvenAnalyses: perAnalysisUsd > 0 ? Math.floor(revenueUsd / perAnalysisUsd) : 0,
  };
}

/** Serialisable payload for GET /api/pricing. */
export function buildPricingPayload(country: string | null | undefined) {
  const code = normalizeCountry(country);
  const market = MARKETS[code];
  const offers = getOffers(code);
  return {
    country: code,
    currency: market.currency,
    taxNote: market.taxNote,
    monetisationStatus: market.monetisationStatus,
    /**
     * Flip with PRICING_V2_ENABLED=true once the numbers are approved. Until
     * then the Mini App keeps rendering its existing plan cards, so this
     * endpoint can ship without repricing anyone.
     */
    enabled: String(process.env.PRICING_V2_ENABLED || "").toLowerCase() === "true",
    renewalCopy:
      "This is a pass, not an auto-renewing subscription. It expires after the period shown and nothing is charged automatically.",
    /**
     * `usd` is a display-only conversion for the global rails (Stars, TON, card).
     * Local rails always charge the fixed `priceMinor` amount above.
     */
    offers: offers.map((offer) => ({
      ...offer,
      stars: PLAN_STARS[offer.id] ?? 0,
      usd:
        offer.priceMinor > 0 && market.usdRate > 0
          ? Number((offer.priceMinor / 100 / market.usdRate).toFixed(2))
          : 0,
    })),
    paymentMethods: getPaymentMethods(code),
    minorUnit: 2,
    localizedCopy: {
      free: "3 credits per day for the first 7 days; purchased credits remain available",
      popular: "Most popular",
      bestValue: "Best value",
      changePlan: "Switch plan",
      fairUse: "Fair use applies to the pass total.",
    },
  };
}
