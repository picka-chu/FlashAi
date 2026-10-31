import "dotenv/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { Cell } from "@ton/core";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { getBsdH2H, getLiveMatchPreview, getLiveMatches, getMatchDetails, getUpcomingMatches, searchMatches, getFootballNews } from "./services/footballService";
import { generateSupportReply, getDefaultFaqs } from "./services/supportService";
import CreditResetScheduler from "./tasks/creditResetScheduler.js";
import { EngagementScheduler } from "./tasks/engagementScheduler.js";
import { ChannelAgentScheduler } from "./services/channelAgentService.js";
import { NotificationService, escapeHtml, normalizeTimezone } from "./services/notificationService";
import { InMemoryRateLimiter } from "./middleware/rateLimit";
import { registerLeaderboardRoutes } from "./routes/leaderboard";
import { getTelegramUserFromInitData, validateTelegramInitData, getVerifiedTelegramUser } from "./middleware/auth";
import { getGeminiKeyStatus } from "./services/apiCacheService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseKey = supabaseServiceKey;
const adminIdRaw =
  process.env.ADMIN_TELEGRAM_ID ||
  process.env.ADMIN_ID ||
  process.env.TELEGRAM_ADMIN_ID ||
  process.env.ADMIN_USER_ID ||
  "";
const bootstrapAdminId = (() => {
  const match = String(adminIdRaw).match(/\d{5,}/);
  if (!match) return null;
  const id = Number(match[0]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
})();
if (adminIdRaw && !bootstrapAdminId) {
  console.warn("[Admin] ADMIN_TELEGRAM_ID is set but is not a valid Telegram user id.");
}

if (!supabaseUrl || !supabaseKey || supabaseUrl === "YOUR_SUPABASE_URL" || supabaseKey === "YOUR_SUPABASE_SERVICE_ROLE_KEY") {
  throw new Error("CRITICAL: Missing required Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for production.");
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Supabase service role key initialized for backend operations.");

const PLAN_CREDITS: Record<string, number> = {
  free: 3,
  monthly_basic: 10,
  monthly_pro: 16,
  admin: 0,
};

const PLAN_PRICE_USD: Record<string, number> = {
  monthly_basic: 8.99,
  monthly_pro: 14.99,
};
const USD_TO_STARS_RATE = 50;
const PAID_PLANS = new Set(["monthly_basic", "monthly_pro"]);
const ALLOWED_PLANS = new Set(["free", "monthly_basic", "monthly_pro", "admin"]);
const MAX_MATCH_STRING_LENGTH = 200;

const isGeminiConfigError = (message: string) =>
  /no gemini api keys|api key not valid|api_key_invalid|api key not set|api key is missing|invalid api key/i.test(
    String(message || ""),
  );
const MAX_SUPPORT_HISTORY = 10;
const MAX_SUPPORT_MESSAGE_LENGTH = 2_000;
const PLAN_PRICE_STARS: Record<string, number> = {
  monthly_basic: 500,
  monthly_pro: 800,
};
// Fallback TON-per-USD rate used only when the live price feed is unavailable.
const DEFAULT_TON_PER_USD = 0.23;

const firstEnv = (...names: string[]) => {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
};
const WHOP_API_BASE = (firstEnv("WHOP_API_BASE", "WHOP_API_BASE_URL") || "https://api.whop.com/api/v1").replace(/\/+$/, "");
const WHOP_PLAN_IDS: Record<string, string> = {
  monthly_basic: firstEnv(
    "WHOP_PLAN_MONTHLY_BASIC",
    "WHOP_MONTHLY_BASIC_PLAN_ID",
    "WHOP_BASIC_PLAN_ID",
    "WHOP_PLAN_ID_BASIC",
  ),
  monthly_pro: firstEnv(
    "WHOP_PLAN_MONTHLY_PRO",
    "WHOP_MONTHLY_PRO_PLAN_ID",
    "WHOP_PRO_PLAN_ID",
    "WHOP_PLAN_ID_PRO",
  ),
};
const WHOP_ENABLED = Boolean(
  process.env.WHOP_API_KEY &&
  (WHOP_PLAN_IDS.monthly_basic || WHOP_PLAN_IDS.monthly_pro),
);
const WHOP_ACCOUNT_ID = firstEnv("WHOP_ACCOUNT_ID", "WHOP_COMPANY_ID", "WHOP_ACCOUNT");
const whopResolvedPlans = new Map<string, { id: string; expiresAt: number }>();

const shortWhopId = (value: string) =>
  value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;

async function listWhopPlans(apiKey: string): Promise<any[]> {
  const plans: any[] = [];
  let after = "";

  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({ first: "100" });
    if (WHOP_ACCOUNT_ID) params.set("account_id", WHOP_ACCOUNT_ID);
    if (after) params.set("after", after);

    const response = await fetch(`${WHOP_API_BASE}/plans?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(
        "Whop plans API error:",
        response.status,
        data?.error?.message || data?.message || data?.error || "",
      );
      return plans;
    }

    if (Array.isArray(data?.data)) plans.push(...data.data);
    if (!data?.page_info?.has_next_page || !data?.page_info?.end_cursor) break;
    after = String(data.page_info.end_cursor);
  }

  return plans;
}

function scoreWhopPlan(plan: any, tier: string, configured: string): number {
  const title = String(plan?.title || "").toLowerCase();
  const productId = String(plan?.product?.id || "");
  const initial = Number(plan?.initial_price || 0);
  const renewal = Number(plan?.renewal_price || initial);
  const price = renewal || initial;
  const target = tier === "monthly_basic" ? 5 : 8;
  let score = 0;

  if (configured && plan?.id === configured) score += 100;
  if (configured.startsWith("prod_")) {
    score += productId === configured ? 45 : -15;
  }
  if (tier === "monthly_basic") {
    if (/\bbasic\b|\bstarter\b|\bstandard\b/.test(title)) score += 40;
    if (/\bpro\b|\bpremium\b|\belite\b/.test(title)) score -= 60;
  } else {
    if (/\bpro\b|\bpremium\b|\belite\b/.test(title)) score += 40;
    if (/\bbasic\b|\bstarter\b|\bstandard\b/.test(title)) score -= 60;
  }
  if (plan?.plan_type === "renewal") score += 6;
  if (plan?.release_method === "buy_now") score += 5;
  if (plan?.visibility === "visible") score += 3;

  const priceGap = Math.abs(price - target);
  if (priceGap <= 0.75) score += 15;
  else if (priceGap <= 2) score += 7;
  else if (priceGap >= 10) score -= 10;
  return score;
}

async function resolveWhopPlanVariant(
  apiKey: string,
  tier: string,
  configured: string,
): Promise<string | null> {
  const cacheKey = `${tier}:${configured}`;
  const cached = whopResolvedPlans.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const plans = (await listWhopPlans(apiKey)).filter(
    (plan) => plan?.id &&
      plan?.visibility !== "archived" &&
      plan?.release_method !== "waitlist",
  );
  if (!plans.length) {
    console.error("Whop plan resolution found no available plans:", tier, shortWhopId(configured));
    return null;
  }

  const ranked = plans
    .map((plan) => ({ plan, score: scoreWhopPlan(plan, tier, configured) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 25) {
    console.error(
      "Whop plan resolution found no confident match:",
      tier,
      shortWhopId(configured),
      ranked.slice(0, 3).map(({ plan, score }) =>
        `${shortWhopId(String(plan.id))} ${plan.title || "(untitled)"} score=${score}`,
      ),
    );
    return null;
  }
  if (ranked[1] && best.score - ranked[1].score < 10) {
    console.error(
      "Whop plan resolution is ambiguous:",
      tier,
      ranked.slice(0, 3).map(({ plan, score }) =>
        `${shortWhopId(String(plan.id))} ${plan.title || "(untitled)"} score=${score}`,
      ),
    );
    return null;
  }

  const id = String(best.plan.id);
  whopResolvedPlans.set(cacheKey, { id, expiresAt: Date.now() + 10 * 60 * 1000 });
  console.log(
    "Whop plan resolved:",
    tier,
    shortWhopId(id),
    best.plan.title || "(untitled)",
    `$${best.plan.renewal_price ?? best.plan.initial_price ?? 0}`,
    `score=${best.score}`,
  );
  return id;
}

function verifyWhopWebhookSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 5 * 60) return false;

  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expected);

  for (const part of headers.signature.split(" ")) {
    const signature = part.includes(",") ? part.split(",").slice(1).join(",") : part;
    const provided = Buffer.from(signature);
    if (provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer)) {
      return true;
    }
  }
  return false;
}

async function createWhopCheckout(
  telegramId: number,
  planId: string,
): Promise<{ checkoutUrl: string }> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    const error: any = new Error("Whop checkout is not configured");
    error.code = "WHOP_NOT_CONFIGURED";
    throw error;
  }

  const configuredPlanId = WHOP_PLAN_IDS[planId];
  if (!configuredPlanId) {
    const error: any = new Error("This plan is not available for card checkout");
    error.code = "WHOP_PLAN_NOT_CONFIGURED";
    throw error;
  }

  let planVariantId = configuredPlanId;
  if (!/^plan_/i.test(planVariantId)) {
    const resolved = await resolveWhopPlanVariant(apiKey, planId, configuredPlanId);
    if (!resolved) {
      console.error(
        "Whop plan could not be resolved from the configured value:",
        planId,
        shortWhopId(configuredPlanId),
      );
      const error: any = new Error("This plan is not available for card checkout");
      error.code = "WHOP_PLAN_NOT_CONFIGURED";
      throw error;
    }
    planVariantId = resolved;
  }

  const redirectUrl = (
    process.env.WHOP_REDIRECT_URL ||
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    DEFAULT_APP_URL
  ).replace(/\/+$/, "");

  const payload: Record<string, any> = {
    plan_id: planVariantId,
    mode: "payment",
    metadata: {
      telegram_id: String(telegramId),
      plan_id: planId,
      source: "flashai",
    },
  };
  if (/^https:\/\//i.test(redirectUrl)) {
    const successUrl = new URL(redirectUrl);
    successUrl.searchParams.set("tab", "profile");
    successUrl.searchParams.set("payment", "success");
    payload.redirect_url = successUrl.toString();
  }

  const requestCheckout = async (variantId: string) => {
    const response = await fetch(`${WHOP_API_BASE}/checkout_configurations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, plan_id: variantId }),
    });
    const result: any = await response.json().catch(() => ({}));
    const message = String(
      result?.error?.message || result?.message || result?.error || "",
    );
    return { response, result, message };
  };

  let attempt = await requestCheckout(planVariantId);
  if (
    !attempt.response.ok &&
    attempt.response.status === 404 &&
    /plan not found/i.test(attempt.message)
  ) {
    const resolved = await resolveWhopPlanVariant(apiKey, planId, configuredPlanId);
    if (resolved && resolved !== planVariantId) {
      planVariantId = resolved;
      attempt = await requestCheckout(planVariantId);
    }
  }

  if (!attempt.response.ok) {
    console.error(
      "Whop checkout API error:",
      attempt.response.status,
      attempt.message,
      `plan=${shortWhopId(planVariantId)}`,
      `tier=${planId}`,
      `configured=${shortWhopId(configuredPlanId)}`,
    );
    const error: any = new Error("Failed to create card checkout");
    error.code = attempt.response.status === 404 && /plan not found/i.test(attempt.message)
      ? "WHOP_PLAN_NOT_CONFIGURED"
      : "WHOP_CHECKOUT_FAILED";
    throw error;
  }

  const checkoutUrl = String(
    attempt.result?.purchase_url || attempt.result?.data?.purchase_url || "",
  );
  if (!checkoutUrl) throw new Error("No checkout URL returned by Whop");
  return { checkoutUrl };
}

const signupCreditsRaw = Number(process.env.SIGNUP_CREDITS ?? 3);
const signupCredits = Number.isFinite(signupCreditsRaw) && signupCreditsRaw >= 0 ? Math.floor(signupCreditsRaw) : 3;
const referralRewardRaw = Number(process.env.REFERRAL_REWARD_CREDITS ?? 2);
const referralRewardCredits = Number.isFinite(referralRewardRaw) && referralRewardRaw >= 0 ? Math.floor(referralRewardRaw) : 2;
const DEFAULT_APP_URL = process.env.DEFAULT_APP_URL || "https://flashai-siuj.onrender.com";

const CREDIT_TIMEZONE = process.env.TIMEZONE || "UTC";

/** Calendar date (YYYY-MM-DD) in the configured credit-reset timezone. */
function getCreditDateKey(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: CREDIT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function getPlanCreditAllocation(planId: string) {
  return PLAN_CREDITS[planId] ?? 0;
}

function getPlanDurationDays(planId: string): number {
  if (planId === "monthly_basic" || planId === "monthly_pro") return 30;
  return 0;
}

async function applyPlanCredits(telegramId: number, planId: string) {
  if (!ALLOWED_PLANS.has(planId)) {
    throw new Error(`Unsupported plan: ${planId}`);
  }

  const creditsToAdd = getPlanCreditAllocation(planId);
  const durationDays = getPlanDurationDays(planId);

  // Single atomic statement: creates the user if they paid before /start,
  // otherwise increments credits and extends the plan in one transaction.
  // This avoids the read-modify-write race between concurrent payments.
  const { error } = await supabase.rpc("apply_plan_purchase", {
    p_telegram_id: telegramId,
    p_plan: planId,
    p_credits: creditsToAdd,
    p_duration_days: durationDays,
  });

  if (error) {
    console.error("apply_plan_purchase failed:", error.message);
    throw error;
  }

  return creditsToAdd;
}

async function ensureBootstrapAdminRole() {
  if (!bootstrapAdminId || Number.isNaN(bootstrapAdminId)) return;

  try {
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("telegram_id, role")
      .eq("telegram_id", bootstrapAdminId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existingUser) {
      await supabase.from("users").insert({
        telegram_id: bootstrapAdminId,
        role: "admin",
        name: "Admin",
        plan: "admin",
        credits: 999,
        last_active: new Date().toISOString(),
      });
      console.log(`✅ Bootstrap admin user created for telegram_id=${bootstrapAdminId}`);
      return;
    }

    if (existingUser.role !== "admin") {
      await supabase
        .from("users")
        .update({ role: "admin", plan: "admin", last_active: new Date().toISOString() })
        .eq("telegram_id", bootstrapAdminId);
      console.log(`✅ Bootstrap admin promoted for telegram_id=${bootstrapAdminId}`);
    }
  } catch (error) {
    console.error("Failed to ensure bootstrap admin role:", error);
  }
}

async function getTelegramProfilePhotoUrl(telegramId: number, bot: Telegraf | null): Promise<string | null> {
  if (!bot) return null;
  try {
    const photos = await bot.telegram.getUserProfilePhotos(telegramId, 0, 1);
    const fileId = photos?.photos?.[0]?.[0]?.file_id;
    if (!fileId) return null;
    const fileLink = await bot.telegram.getFileLink(fileId);
    return String(fileLink || "");
  } catch {
    return null;
  }
}

type HistoryStatus = "pending" | "won" | "lost" | "not_applicable";

type UserHistoryItem = {
  id: string;
  fixtureId: string | null;
  match: string;
  home: string;
  away: string;
  predictionMarket: string;
  confidence: number;
  reasoning: string;
  analysisPayload?: any;
  status: HistoryStatus;
  /** Final score attached when the row resolves (persisted in analysis_payload.outcome). */
  outcome?: { home: number; away: number } | null;
  created_at: string;
  resolved_at?: string | null;
};

async function getUserHistory(telegramId: number): Promise<UserHistoryItem[]> {
  let data: any[] | null = null;
  let error: any = null;

  const withPayload = await supabase
    .from("user_history")
    .select("id,fixture_id,match,home,away,prediction_market,confidence,reasoning,analysis_payload,status,created_at,resolved_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(100);

  data = withPayload.data;
  error = withPayload.error;

  if (error && String(error.message || "").toLowerCase().includes("analysis_payload")) {
    const legacy = await supabase
      .from("user_history")
      .select("id,fixture_id,match,home,away,prediction_market,confidence,reasoning,status,created_at,resolved_at")
      .eq("telegram_id", telegramId)
      .order("created_at", { ascending: false })
      .limit(100);
    data = legacy.data;
    error = legacy.error;
  }

  if (error) {
    console.error("Failed to fetch user history:", error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    fixtureId: row.fixture_id || null,
    match: row.match,
    home: row.home,
    away: row.away,
    predictionMarket: row.prediction_market,
    confidence: Number(row.confidence || 0),
    reasoning: row.reasoning || "",
    analysisPayload: row.analysis_payload || null,
    outcome: row.analysis_payload?.outcome || null,
    status: row.status || "pending",
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
  }));
}

function toHistoryRow(telegramId: number, item: UserHistoryItem) {
  return {
    id: item.id,
    telegram_id: telegramId,
    fixture_id: item.fixtureId || null,
    match: item.match,
    home: item.home,
    away: item.away,
    prediction_market: item.predictionMarket,
    confidence: Number(item.confidence || 0),
    reasoning: item.reasoning || "",
    analysis_payload: item.analysisPayload || null,
    status: item.status || "pending",
    created_at: item.created_at || new Date().toISOString(),
    resolved_at: item.resolved_at || null,
  };
}

/**
 * Inserts a single history item without ever deleting existing rows.
 * A failed write can no longer wipe a user's prediction history.
 */
async function insertHistoryItem(telegramId: number, item: UserHistoryItem) {
  const row = toHistoryRow(telegramId, item);
  let { error } = await supabase.from("user_history").upsert(row, { onConflict: "id" });
  if (error && String(error.message || "").toLowerCase().includes("analysis_payload")) {
    const { analysis_payload, ...legacyRow } = row;
    error = (await supabase.from("user_history").upsert(legacyRow, { onConflict: "id" })).error;
  }
  if (error) throw error;
}

/**
 * Updates only the mutable fields of an existing history row.
 */
async function updateHistoryItem(
  telegramId: number,
  item: Pick<UserHistoryItem, "id" | "status" | "resolved_at" | "outcome">,
) {
  const patch: Record<string, any> = {
    status: item.status,
    resolved_at: item.resolved_at || null,
  };
  if (item.outcome) {
    const { data: row } = await supabase
      .from("user_history")
      .select("analysis_payload")
      .eq("id", item.id)
      .eq("telegram_id", telegramId)
      .maybeSingle();
    patch.analysis_payload = { ...(row?.analysis_payload || {}), outcome: item.outcome };
  }
  const { error } = await supabase
    .from("user_history")
    .update(patch)
    .eq("id", item.id)
    .eq("telegram_id", telegramId);
  if (error) throw error;
}

/**
 * Keeps at most 100 rows per user by deleting only rows outside the newest
 * window. Never touches the newest rows.
 */
async function pruneHistory(telegramId: number) {
  const { data, error } = await supabase
    .from("user_history")
    .select("id")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .range(100, 500);
  if (error || !data?.length) return;
  const ids = data.map((row: any) => row.id);
  const { error: deleteError } = await supabase
    .from("user_history")
    .delete()
    .eq("telegram_id", telegramId)
    .in("id", ids);
  if (deleteError) {
    console.error("Failed to prune user history:", deleteError.message);
  }
}

function normalizeMarket(market: string) {
  return (market || "").toLowerCase().trim();
}

function getUtcDateString(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// Markets that cannot be resolved from a final scoreline (goals only).
// These are marked "pending" so they are never incorrectly flipped to "lost"
// by the 24h guardrail.
const NON_RESOLVABLE_MARKETS = [
  "player to score", "first goalscorer", "anytime goalscorer", "last goalscorer",
  "corner", "corners", "cards", "yellow card", "red card", "booking",
  "shots", "offside", "asian handicap", "handicap",
  "half time", "first half", "second half", "ht/ft",
  "clean sheet", "to nil", "win to nil",
  "dnb", "draw no bet",
  "half with most goals", "winning margin",
  "score first", "first team to score", "last team to score",
];

function isNonResolvableMarket(mk: string): boolean {
  return NON_RESOLVABLE_MARKETS.some((kw) => mk.includes(kw));
}

function evaluatePredictionMarket(market: string, homeGoals: number, awayGoals: number): HistoryStatus {
  const mk = normalizeMarket(market);
  const total = homeGoals + awayGoals;

  if (!mk) return "pending";

  // Skip markets that can't be resolved from a final score — leave as pending
  // rather than silently awarding "lost" via the timeout guardrail.
  if (isNonResolvableMarket(mk)) return "pending";

  // Compound markets: "BTTS & Over 2.5", "Home Win or Over 3.5".
  // Double-chance phrases ("home or draw") are excluded — they are handled
  // as single markets below and split identically anyway.
  if (!mk.includes("double chance")) {
    const andParts = mk.split(/\s+(?:&|and)\s+/).map((part) => part.trim());
    if (andParts.length === 2 && andParts.every((part) => part.length > 1)) {
      const results = andParts.map((part) => evaluatePredictionMarket(part, homeGoals, awayGoals));
      if (results.includes("pending")) return "pending";
      return results.every((result) => result === "won") ? "won" : "lost";
    }
    const orParts = mk.split(/\s+or\s+/).map((part) => part.trim());
    if (orParts.length === 2 && orParts.every((part) => part.length > 1)) {
      const results = orParts.map((part) => evaluatePredictionMarket(part, homeGoals, awayGoals));
      if (results.includes("won")) return "won";
      if (results.includes("pending")) return "pending";
      return "lost";
    }
  }

  // 1. Full Match Results (1X2)
  // Handles: "1", "Home Win", "Match Winner - Home", "Home Team Win", "1X2 - Home"
  if (
    mk === "1" ||
    mk === "home win" ||
    mk === "home" ||
    (mk.includes("home") && (mk.includes("win") || mk.includes("winner")) && !mk.includes("draw") && !mk.includes("away"))
  ) {
    return homeGoals > awayGoals ? "won" : "lost";
  }
  // Handles: "2", "Away Win", "Match Winner - Away", "Away Team Win"
  if (
    mk === "2" ||
    mk === "away win" ||
    mk === "away" ||
    (mk.includes("away") && (mk.includes("win") || mk.includes("winner")) && !mk.includes("draw") && !mk.includes("home"))
  ) {
    return awayGoals > homeGoals ? "won" : "lost";
  }
  // Handles: "X", "Draw", "Match Winner - Draw", "Full Time Draw"
  if (mk === "x" || mk === "draw" || (mk.includes("draw") && !mk.includes("no"))) {
    return homeGoals === awayGoals ? "won" : "lost";
  }

  // 2. Double Chance — remove the brittle length<=3 guard, use keyword matching instead
  // Handles: "1X", "1x", "Home or Draw", "Double Chance - 1X", "Double Chance (Home/Draw)"
  if (
    mk === "1x" ||
    mk === "home or draw" ||
    (mk.includes("double chance") && (mk.includes("1x") || mk.includes("home") || mk.includes("draw")) && !mk.includes("x2") && !mk.includes("away"))
  ) {
    return homeGoals >= awayGoals ? "won" : "lost";
  }
  // Handles: "X2", "x2", "Away or Draw", "Double Chance - X2"
  if (
    mk === "x2" ||
    mk === "away or draw" ||
    (mk.includes("double chance") && (mk.includes("x2") || mk.includes("away") || mk.includes("draw")) && !mk.includes("1x") && !mk.includes("home"))
  ) {
    return awayGoals >= homeGoals ? "won" : "lost";
  }
  // Handles: "12", "Home or Away", "Double Chance - 12"
  if (
    mk === "12" ||
    mk === "home or away" ||
    (mk.includes("double chance") && mk.includes("12"))
  ) {
    return homeGoals !== awayGoals ? "won" : "lost";
  }

  // 3. Over/Under — only match if it looks like a goals market (not corners/cards/shots)
  // Prefix "goals" detection: market must contain "goal" or have no sport-specific qualifier
  const overMatch = mk.match(/over\s*(\d+\.?\d*)/);
  if (overMatch) {
    // Ensure this is a goals over/under, not corners, cards, etc.
    const threshold = parseFloat(overMatch[1]);
    return total > threshold ? "won" : "lost";
  }
  const underMatch = mk.match(/under\s*(\d+\.?\d*)/);
  if (underMatch) {
    const threshold = parseFloat(underMatch[1]);
    return total < threshold ? "won" : "lost";
  }

  // 4. Both Teams to Score (BTTS)
  // Handles: "BTTS Yes", "BTTS - Yes", "Both Teams to Score - Yes", "Both Teams Score"
  if (mk.includes("btts") || mk.includes("both teams to score") || mk.includes("both teams score")) {
    const isNo = mk.includes("no") || mk.includes("false");
    const bttsHappened = homeGoals > 0 && awayGoals > 0;
    return (isNo ? !bttsHappened : bttsHappened) ? "won" : "lost";
  }

  // 5. Exact Score — e.g. "Correct Score 2-1", "Score 1-0", "2-1"
  const scoreMatch = mk.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (scoreMatch) {
    const h = parseInt(scoreMatch[1]);
    const a = parseInt(scoreMatch[2]);
    return (homeGoals === h && awayGoals === a) ? "won" : "lost";
  }

  return "pending";
}

/** Run async work with bounded concurrency (prevents outbound request bursts). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Scoreboards are large and shared by every history resolution in a request
// (and across users). Cache briefly and de-duplicate in-flight fetches.
const SCOREBOARD_CACHE_TTL_MS = 60_000;
let recentScoreboardEvents: any[] | null = null;
let recentScoreboardFetchedAt = 0;
let recentScoreboardInFlight: Promise<any[]> | null = null;

async function getRecentScoreboardEvents(): Promise<any[]> {
  if (recentScoreboardEvents && Date.now() - recentScoreboardFetchedAt < SCOREBOARD_CACHE_TTL_MS) {
    return recentScoreboardEvents;
  }
  if (recentScoreboardInFlight) return recentScoreboardInFlight;

  recentScoreboardInFlight = (async () => {
    const dates = [getUtcDateString(-2), getUtcDateString(-1), getUtcDateString(0), getUtcDateString(1)];
    const responses = await Promise.all(
      dates.map((date) =>
        axios.get(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${date}`,
          { timeout: 10_000 },
        ),
      ),
    );
    const events = responses.flatMap((res) =>
      Array.isArray(res.data?.events) ? res.data.events : [],
    );
    recentScoreboardEvents = events;
    recentScoreboardFetchedAt = Date.now();
    return events;
  })()
    .catch(() => recentScoreboardEvents || [])
    .finally(() => {
      recentScoreboardInFlight = null;
    });

  return recentScoreboardInFlight;
}

/** Extract the UTF-8 comment from a TON text-comment payload (opcode 0). */
function extractTonComment(payload: unknown): string | null {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  try {
    const [cell] = Cell.fromBoc(Buffer.from(raw, "base64"));
    if (!cell) return null;
    const slice = cell.beginParse();
    if (slice.remainingBits < 32) return null;
    if (slice.loadUint(32) !== 0) return null;
    return slice.loadStringTail();
  } catch {
    return null;
  }
}

async function resolveHistoryItemResult(item: UserHistoryItem): Promise<UserHistoryItem> {
  if (item.status !== "pending") {
    return item;
  }

  const createdAtMs = new Date(item.created_at).getTime();
  const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0;
  const isOlderThan48h = ageMs >= 48 * 60 * 60 * 1000;
  const withinBsdSearchWindow = ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000;

  const tryResolveFromAllScoreboard = async (): Promise<UserHistoryItem | null> => {
    try {
      const events = await getRecentScoreboardEvents();

      for (const event of events) {
        const comp = event?.competitions?.[0];
        const state = comp?.status?.type?.state;
        if (state !== "post") continue;

        const competitors = comp?.competitors || [];
        const home = competitors.find((c: any) => c.homeAway === "home");
        const away = competitors.find((c: any) => c.homeAway === "away");
        const homeName = String(home?.team?.displayName || home?.team?.name || "").toLowerCase().trim();
        const awayName = String(away?.team?.displayName || away?.team?.name || "").toLowerCase().trim();
        const expectedHome = String(item.home || "").toLowerCase().trim();
        const expectedAway = String(item.away || "").toLowerCase().trim();

        if (!homeName || !awayName || !expectedHome || !expectedAway) continue;

        // Bidirectional fuzzy match: ESPN name contains stored name OR stored name contains ESPN name
        const nameMatches = (a: string, b: string) => a.includes(b) || b.includes(a);
        const sameOrder = nameMatches(homeName, expectedHome) && nameMatches(awayName, expectedAway);
        const reverseOrder = nameMatches(homeName, expectedAway) && nameMatches(awayName, expectedHome);
        if (!sameOrder && !reverseOrder) continue;

        const espnHomeGoals = Number(home?.score ?? 0);
        const espnAwayGoals = Number(away?.score ?? 0);
        // If teams are stored in reverse order vs ESPN, swap goals so home/away align with the prediction
        const homeGoals = reverseOrder ? espnAwayGoals : espnHomeGoals;
        const awayGoals = reverseOrder ? espnHomeGoals : espnAwayGoals;
        const result = evaluatePredictionMarket(item.predictionMarket, homeGoals, awayGoals);
        if (result === "pending") return null;

        return {
          ...item,
          status: result,
          resolved_at: new Date().toISOString(),
          outcome: { home: homeGoals, away: awayGoals },
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  // BSD fixtures: settle straight from the provider's final score.
  // Rows may store the id with ("bsd_123") or without ("123") the prefix.
  const looksLikeBsdId = !!item.fixtureId && (/^bsd_\d+$/.test(item.fixtureId) || /^\d+$/.test(item.fixtureId));
  if (looksLikeBsdId) {
    try {
      const preview = await getLiveMatchPreview(item.fixtureId!);
      const state = preview?.fixture?.status?.state;
      if (state !== "post") return item;
      const homeGoals = Number(preview?.goals?.home ?? 0);
      const awayGoals = Number(preview?.goals?.away ?? 0);
      const result = evaluatePredictionMarket(item.predictionMarket, homeGoals, awayGoals);
      if (result === "pending") return item;
      return {
        ...item,
        status: result,
        resolved_at: new Date().toISOString(),
        outcome: { home: homeGoals, away: awayGoals },
      };
    } catch {
      // Fall through to scoreboard matching below.
    }
  }

  try {
    if (item.fixtureId?.startsWith("espn_")) {
      const parts = item.fixtureId.split("_");
      const eventId = parts[1];
      const leagueSlug = parts[2] || "eng.1";
      if (!/^\d+$/.test(eventId) || !/^[a-z0-9.]+$/i.test(leagueSlug)) {
        return item;
      }
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`;
      const summary = await axios.get(summaryUrl, { timeout: 10_000 });

      const competition = summary.data?.header?.competitions?.[0];
      const state = competition?.status?.type?.state;
      if (state !== "post") return item;

      const competitors = competition?.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      const homeGoals = Number(home?.score ?? 0);
      const awayGoals = Number(away?.score ?? 0);
      const result = evaluatePredictionMarket(item.predictionMarket, homeGoals, awayGoals);

      if (result === "pending") return item;
      return {
        ...item,
        status: result,
        resolved_at: new Date().toISOString(),
        outcome: { home: homeGoals, away: awayGoals },
      };
    }
  } catch {
    // Fallback to scoreboard resolution below.
  }

  // BSD team-name lookup: covers rows with a missing/foreign fixture id.
  if (withinBsdSearchWindow && !item.fixtureId?.startsWith("espn_")) {
    try {
      const { fetchBsdMatchStatsByName } = await import("./services/footballService.js");
      const preview = await fetchBsdMatchStatsByName(item.home, item.away);
      if (preview?.fixture?.status?.state === "post") {
        const homeGoals = Number(preview?.goals?.home ?? 0);
        const awayGoals = Number(preview?.goals?.away ?? 0);
        const result = evaluatePredictionMarket(item.predictionMarket, homeGoals, awayGoals);
        if (result !== "pending") {
          return {
            ...item,
            status: result,
            resolved_at: new Date().toISOString(),
            outcome: { home: homeGoals, away: awayGoals },
          };
        }
      }
    } catch {
      // Continue to scoreboard matching.
    }
  }

  const resolvedByTeams = await tryResolveFromAllScoreboard();
  if (resolvedByTeams) return resolvedByTeams;

  // 48h guardrail: if we still cannot find the fixture after two days, the row
  // can never be settled — mark it not_applicable instead of forcing a "lost",
  // which would silently poison the user's win/loss record.
  if (isOlderThan48h) {
    return { ...item, status: "not_applicable", resolved_at: new Date().toISOString() };
  }

  return item;
}

async function startServer() {
  const app = new Hono();
  const PORT = Number(process.env.PORT || 3000);
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN") {
    throw new Error("CRITICAL: TELEGRAM_BOT_TOKEN is not set. Server startup aborted.");
  }

  const geminiStatus = getGeminiKeyStatus();
  if (geminiStatus.configured) {
    console.log(`✅ Gemini configured with ${geminiStatus.totalKeys} key(s).`);
  } else {
    console.warn(
      "⚠️ Gemini is not configured. Set GEMINI_API_KEY (or GEMINI_API_KEY_1 / GEMINI_PREDICTION_KEY_1) in the runtime environment and restart.",
    );
  }

  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 120);
  const EXPENSIVE_RATE_LIMIT_MAX = Number(process.env.EXPENSIVE_RATE_LIMIT_MAX || 20);
  const rateLimiter = new InMemoryRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX);
  const expensiveRateLimiter = new InMemoryRateLimiter(RATE_LIMIT_WINDOW_MS, EXPENSIVE_RATE_LIMIT_MAX);

  /**
   * Resolve the client IP. Forwarded headers are only trusted when the app is
   * explicitly deployed behind a trusted proxy (TRUST_PROXY=true), otherwise a
   * client could spoof X-Forwarded-For and bypass rate limits.
   */
  const getRequestIp = (c: any) => {
    if (String(process.env.TRUST_PROXY || "").toLowerCase() === "true") {
      const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded) return forwarded;
      const realIp = c.req.header("x-real-ip")?.trim();
      if (realIp) return realIp;
    }
    return (
      c.env?.incoming?.socket?.remoteAddress ||
      c.env?.incoming?.connection?.remoteAddress ||
      "unknown"
    );
  };

  const isRateLimited = (identifier: string) => rateLimiter.isRateLimited(identifier);
  const isExpensiveRateLimited = (identifier: string) =>
    expensiveRateLimiter.isRateLimited(identifier);

  const hasValidTelegramAuth = (initData?: string | null) =>
    Boolean(initData && validateTelegramInitData(initData, botToken));

  /** Validate initData and return the trusted Telegram user (or null). */
  const getAuthedTelegramUser = (c: any) =>
    getVerifiedTelegramUser(c.req.header("X-TG-Init-Data"), botToken);

  /** Expensive third-party/AI endpoints are limited per user (or IP). */
  const guardExpensiveEndpoint = (c: any) => {
    const tgUser = getAuthedTelegramUser(c);
    return isExpensiveRateLimited(`expensive:${tgUser?.id || getRequestIp(c)}`);
  };

  // Suspension state is cached briefly to avoid a DB round-trip per request.
  const suspensionCache = new Map<number, { suspended: boolean; role: string; checkedAt: number }>();
  const SUSPENSION_CACHE_TTL = 60 * 1000;
  const isSuspendedUser = async (telegramId: number) => {
    const cached = suspensionCache.get(telegramId);
    if (cached && Date.now() - cached.checkedAt < SUSPENSION_CACHE_TTL) {
      return cached.suspended && cached.role !== "admin";
    }
    const { data } = await supabase
      .from("users")
      .select("is_suspended,role")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    const suspended = Boolean(data?.is_suspended);
    const role = String(data?.role || "user");
    if (suspensionCache.size >= 10_000) {
      const oldestKey = suspensionCache.keys().next().value;
      if (oldestKey !== undefined) suspensionCache.delete(oldestKey);
    }
    suspensionCache.set(telegramId, { suspended, role, checkedAt: Date.now() });
    return suspended && role !== "admin";
  };

  // Reject oversized bodies before buffering them in memory.
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 64 * 1024 * 1024,
      onError: (c) => c.json({ error: "Payload too large" }, 413),
    }),
  );

  // Global API abuse protection (runs before all routes). Key by user when
  // authenticated so users behind the same NAT/proxy do not share a bucket.
  app.use("/api/*", async (c, next) => {
    const tgUser = getAuthedTelegramUser(c);
    const rateKey = tgUser?.id ? `api:user:${tgUser.id}` : `api:ip:${getRequestIp(c)}`;
    // Signed payment webhooks must not be dropped by generic rate limiting.
    const isWebhook =
      c.req.path === "/api/payments/lemonsqueezy-webhook" ||
      c.req.path === "/api/payments/whop-webhook";
    if (!isWebhook && isRateLimited(rateKey)) {
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    }
    if (tgUser?.id && (await isSuspendedUser(tgUser.id))) {
      return c.json({ error: "Your account has been suspended. Please contact support." }, 403);
    }
    await next();
  });

function extractTelegramChannelFromTaskUrl(taskUrl: string): string | null {
  const raw = String(taskUrl || '').trim();
  if (!raw) return null;

  const direct = raw.match(/^@([a-zA-Z0-9_]{5,})$/);
  if (direct) return `@${direct[1]}`;

  const tme = raw.match(/t\.me\/([a-zA-Z0-9_]{5,})/i);
  if (tme) return `@${tme[1]}`;

  const tgResolve = raw.match(/tg:\/\/resolve\?domain=([a-zA-Z0-9_]{5,})/i);
  if (tgResolve) return `@${tgResolve[1]}`;

  return null;
}
  const ADMIN_ADS_KEY = "admin_ads_v1";
  registerLeaderboardRoutes(app, supabase);
  const RATES_TTL_MS = 15 * 60 * 1000;
  let cachedRates: { tonUsd: number; updatedAt: number } | null = null;

  app.get("/api/config/rates", async (c) => {
    try {
      const now = Date.now();
      if (cachedRates && now - cachedRates.updatedAt < RATES_TTL_MS) {
        return c.json({
          tonUsd: cachedRates.tonUsd,
          updatedAt: new Date(cachedRates.updatedAt).toISOString(),
          source: "cache",
        });
      }

      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
        { timeout: 10_000 },
      );
      const tonUsd = Number(response?.data?.["the-open-network"]?.usd || 0);
      if (!Number.isFinite(tonUsd) || tonUsd <= 0) {
        throw new Error("Invalid TON/USD rate response");
      }

      cachedRates = { tonUsd, updatedAt: now };
      return c.json({
        tonUsd,
        updatedAt: new Date(now).toISOString(),
        source: "live",
      });
    } catch (error: any) {
      if (cachedRates) {
        return c.json({
          tonUsd: cachedRates.tonUsd,
          updatedAt: new Date(cachedRates.updatedAt).toISOString(),
          source: "stale_cache",
        });
      }
      return c.json({ error: "Failed to fetch market rates" }, 503);
    }
  });

  const getPlanUsdPrice = (planId: string): number => PLAN_PRICE_USD[String(planId || "").trim()] || 0;
  const getExpectedStarsAmount = (planId: string): number => PLAN_PRICE_STARS[String(planId || "").trim()] || Math.ceil(getPlanUsdPrice(planId) * USD_TO_STARS_RATE);
  const getExpectedTonAmount = (planId: string, tonPerUsdRate: number): number => {
    const normalizedPlanId = String(planId || "").trim();
    const usd = getPlanUsdPrice(normalizedPlanId);
    if (usd && Number.isFinite(tonPerUsdRate) && tonPerUsdRate > 0) {
      return Number((usd * tonPerUsdRate).toFixed(2));
    }
    return 0;
  };
  const getTonPerUsdRate = async (): Promise<number> => {
    const envRateRaw = Number(process.env.USD_TO_TON_RATE || 0);
    let fallbackRate = Number.isFinite(envRateRaw) && envRateRaw > 0 ? envRateRaw : DEFAULT_TON_PER_USD;
    // Accept the legacy "USD per TON" convention (e.g. 6.86) as well.
    if (fallbackRate > 1) fallbackRate = 1 / fallbackRate;
    const now = Date.now();
    if (cachedRates && now - cachedRates.updatedAt < RATES_TTL_MS && cachedRates.tonUsd > 0) {
      return 1 / cachedRates.tonUsd;
    }

    try {
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
        { timeout: 10_000 },
      );
      const tonUsd = Number(response?.data?.["the-open-network"]?.usd || 0);
      if (!Number.isFinite(tonUsd) || tonUsd <= 0) {
        throw new Error("Invalid TON/USD rate response");
      }
      cachedRates = { tonUsd, updatedAt: now };
      return 1 / tonUsd;
    } catch (error) {
      // The env value is a fallback, not an override, so pricing stays live.
      if (Number.isFinite(fallbackRate) && fallbackRate > 0) return fallbackRate;
      throw error;
    }
  };

  const getCachedCollection = async <T = any>(key: string): Promise<T[]> => {
    try {
      const { data } = await supabase.from("api_cache").select("data").eq("endpoint", key).maybeSingle();
      const raw = data?.data;
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };

  const setCachedCollection = async (key: string, list: any[]) => {
    try {
      await supabase.from("api_cache").upsert({
        endpoint: key,
        data: list,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
    } catch (e) {
      console.error(`Failed to cache collection ${key}:`, e);
    }
  };

  const normalizeAudience = (value: string) => {
    const v = String(value || "all").toLowerCase();
    if (["all", "subscribed", "unsubscribed", "monthly_basic", "monthly_pro", "admin"].includes(v)) return v;
    return "all";
  };

  // Usage Logging Middleware
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    
    // Log API calls only. Page loads are not billable activity and would add a
    // database write per navigation. Identity is derived from validated
    // initData so callers cannot poison another user's activity log.
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api") && url.pathname !== "/api/health") {
      try {
        const tgUser = getVerifiedTelegramUser(c.req.header("X-TG-Init-Data"), botToken);
        if (tgUser?.id) {
          void Promise.resolve(
            supabase.from("usage_logs").insert({
              telegram_id: tgUser.id,
              endpoint: url.pathname,
              method: c.req.method,
              duration_ms: ms,
              status: c.res.status,
            }),
          ).catch(() => undefined);
        }
      } catch {
        // Logging must never affect the request.
      }
    }
  });

  // Security Headers Middleware
  app.use("*", async (c, next) => {
    // NOTE: no X-Frame-Options. Telegram Mini Apps run inside an iframe on
    // web.telegram.org, so framing must be allowed for Telegram origins only.
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://*.telegram.org https://telegram.org",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        [
          "connect-src 'self'",
          "https://*.supabase.co",
          "https://api.telegram.org",
          "https://api.coingecko.com",
          "https://toncenter.com",
          "https://*.tonconnect.io wss://*.tonconnect.io",
          "https://*.tonapi.io wss://*.tonapi.io",
          "https://*.ton.org wss://*.ton.org",
          "https://site.api.espn.com",
        ].join(" "),
        "frame-src https://*.telegram.org https://telegram.org https://t.me",
        "frame-ancestors 'self' https://*.telegram.org https://telegram.org https://t.me https://web.telegram.org",
        "font-src 'self' data: https://fonts.gstatic.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
    await next();
  });

  // API Routes
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/tonconnect-manifest.json", (c) => {
    const url = new URL(c.req.url);
    const origin = process.env.APP_URL || `${url.protocol}//${url.host}`;
    return c.json({
      url: origin,
      name: "Flash AI",
      iconUrl: `${origin}/app-icon.svg`,
    });
  });

  app.get("/api/legal/terms", async (c) => {
    try {
      const filePath = path.join(process.cwd(), "TERMS_AND_POLICIES.md");
      const content = fs.readFileSync(filePath, "utf-8");
      return c.text(content);
    } catch (error: any) {
      return c.text("Terms are temporarily unavailable.", 500);
    }
  });

  // Lemon Squeezy Webhook Endpoint
  // Fail closed: without a configured secret, forged webhooks are impossible to
  // distinguish from real ones, so the endpoint refuses to run at all.
  app.post("/api/payments/lemonsqueezy-webhook", async (c) => {
    const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Lemon Squeezy webhook rejected: LEMONSQUEEZY_WEBHOOK_SECRET is not configured.");
      return c.json({ error: "Webhook is not configured" }, 503);
    }

    const rawBody = await c.req.raw.text();
    const signature = c.req.header("X-Signature");
    if (!signature) {
      return c.json({ error: "Missing signature" }, 401);
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    const signatureValid =
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    if (!signatureValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const eventName = String(body?.meta?.event_name || "");
    if (!eventName) {
      return c.json({ error: "Invalid webhook payload" }, 400);
    }

    try {
      if (["order_created", "order_paid", "subscription_payment_success"].includes(eventName)) {
        const orderData = body.data?.attributes;
        // Lemon Squeezy returns checkout custom data under meta.custom_data;
        // older payloads may also include it on the order attributes.
        const customData = body.meta?.custom_data || orderData?.custom || {};
        const telegramId = Number(customData?.telegram_id);
        const planId = String(customData?.plan_id || "").trim();
        const paymentRef = String(
          orderData?.identifier || orderData?.order_number || body.data?.id || "",
        ).slice(0, 200);

        if (!Number.isFinite(telegramId) || telegramId <= 0 || !PAID_PLANS.has(planId)) {
          console.error("Lemon Squeezy webhook: invalid telegram_id or plan_id", {
            telegramId,
            planId,
          });
          return c.json({ error: "Invalid order metadata" }, 400);
        }
        if (!paymentRef) {
          console.error("Lemon Squeezy webhook: Missing payment reference");
          return c.json({ error: "Missing payment reference" }, 400);
        }

        // Idempotency is enforced by a UNIQUE index on
        // (provider_payment_charge_id, type). Insert first so two concurrent
        // deliveries cannot both grant credits.
        const { data: insertedTx, error: insertTxError } = await supabase
          .from("transactions")
          .insert({
            telegram_id: telegramId,
            // Lemon Squeezy reports totals in the currency's smallest unit.
            amount: Number(orderData?.total || 0) / 100,
            currency: "USD",
            status: "completed",
            provider_payment_charge_id: paymentRef,
            type: "lemonsqueezy",
          })
          .select("id")
          .single();

        if (insertTxError) {
          if (insertTxError.code === "23505") {
            return c.json({ received: true, duplicate: true });
          }
          throw insertTxError;
        }

        try {
          await applyPlanCredits(telegramId, planId);
        } catch (grantError) {
          // Release the idempotency key so Lemon Squeezy can retry.
          if (insertedTx?.id) {
            await supabase.from("transactions").delete().eq("id", insertedTx.id);
          }
          throw grantError;
        }

        if (bot) {
          bot.telegram
            .sendMessage(telegramId, `✅ Payment received! Your account has been upgraded to ${planId.toUpperCase()} plan.`)
            .catch(() => undefined);
        }

        console.log(`Lemon Squeezy payment processed for user ${telegramId}, plan ${planId}`);
      }

      return c.json({ received: true });
    } catch (e: any) {
      console.error("Lemon Squeezy webhook error:", e.message);
      return c.json({ error: "Webhook processing failed" }, 500);
    }
  });


  // Whop webhook (Standard Webhooks signature over the raw body).
  // Fail closed when the signing secret is absent.
  app.post("/api/payments/whop-webhook", async (c) => {
    const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Whop webhook rejected: WHOP_WEBHOOK_SECRET is not configured.");
      return c.json({ error: "Webhook is not configured" }, 503);
    }

    const rawBody = await c.req.text();
    const signatureValid = verifyWhopWebhookSignature(
      webhookSecret,
      {
        id: c.req.header("webhook-id"),
        timestamp: c.req.header("webhook-timestamp"),
        signature: c.req.header("webhook-signature"),
      },
      rawBody,
    );
    if (!signatureValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const eventType = String(body?.type || "");
    if (!eventType) return c.json({ error: "Invalid webhook payload" }, 400);
    if (eventType !== "payment.succeeded") {
      return c.json({ received: true, ignored: eventType });
    }

    try {
      const payment = body?.data || {};
      const metadata =
        payment?.metadata ||
        payment?.checkout_configuration?.metadata ||
        body?.metadata ||
        {};
      const telegramId = Number(metadata?.telegram_id ?? metadata?.telegramId);
      const planId = String(metadata?.plan_id ?? metadata?.plan ?? "").trim();
      const paymentId = String(payment?.id || body?.id || "").slice(0, 200);

      if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !PAID_PLANS.has(planId)) {
        console.error("Whop webhook: invalid telegram_id or plan_id", { telegramId, planId });
        return c.json({ error: "Invalid payment metadata" }, 400);
      }
      if (!paymentId) {
        console.error("Whop webhook: missing payment id");
        return c.json({ error: "Missing payment reference" }, 400);
      }

      const { data: insertedTx, error: insertTxError } = await supabase
        .from("transactions")
        .insert({
          telegram_id: telegramId,
          amount: Number(payment?.amount || payment?.subtotal || 0),
          currency: String(payment?.currency || "USD").toUpperCase().slice(0, 8),
          status: "completed",
          provider_payment_charge_id: `whop_${paymentId}`,
          type: "whop",
        })
        .select("id")
        .single();

      if (insertTxError) {
        if (insertTxError.code === "23505") {
          return c.json({ received: true, duplicate: true });
        }
        throw insertTxError;
      }

      let creditsToAdd = 0;
      try {
        creditsToAdd = await applyPlanCredits(telegramId, planId);
      } catch (grantError) {
        if (insertedTx?.id) {
          await supabase.from("transactions").delete().eq("id", insertedTx.id);
        }
        throw grantError;
      }

      if (bot) {
        const notifications = new NotificationService(supabase, bot);
        // Fire-and-forget: Whop expects a response within 5 seconds. Delivery
        // is idempotent, so a retry cannot send the message twice.
        void notifications
          .send({
            telegramId,
            category: "transactional",
            dedupeKey: `payment:whop:${paymentId}`,
            text:
              `✅ <b>Payment received</b>\n\n` +
              `Your Flash AI <b>${escapeHtml(planId.replace("monthly_", "").toUpperCase())}</b> plan is now active.\n` +
              `💎 ${creditsToAdd} daily credits added.`,
          })
          .catch(() => undefined);
      }

      console.log(`Whop payment processed for user ${telegramId}, plan ${planId}, payment ${paymentId}`);
      return c.json({ received: true });
    } catch (error: any) {
      console.error("Whop webhook error:", error?.message || error);
      return c.json({ error: "Webhook processing failed" }, 500);
    }
  });

  app.get("/api/football/news", async (c) => {
    const rawLimit = parseInt(c.req.query("limit") || "20", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 30) : 20;
    const league = (c.req.query("league") || "").trim().slice(0, 40);
    if (league && !/^[a-z0-9.]+$/i.test(league)) {
      return c.json({ error: "Invalid league" }, 400);
    }
    try {
      const articles = await getFootballNews(limit, league || undefined);
      c.header("Cache-Control", "public, max-age=60");
      return c.json(articles);
    } catch (error: any) {
      console.error("Football news API error:", error?.message || error);
      return c.json({ error: "Failed to fetch football news" }, 500);
    }
  });

  app.get("/api/notifications/preferences", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    const notifications = new NotificationService(supabase, bot);
    const preferences = await notifications.getPreferences(tgUser.id);
    return c.json(preferences);
  });

  app.post("/api/notifications/preferences", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    const body = await c.req.json().catch(() => ({} as any));
    const updates: Record<string, unknown> = {};
    for (const key of ["daily_fixtures", "live_alerts", "news_digest", "weekly_recap", "marketing"]) {
      if (typeof body?.[key] === "boolean") updates[key] = body[key];
    }
    if (body?.timezone !== undefined) updates.timezone = normalizeTimezone(body.timezone);
    if (body?.quiet_hours_start !== undefined) updates.quiet_hours_start = body.quiet_hours_start;
    if (body?.quiet_hours_end !== undefined) updates.quiet_hours_end = body.quiet_hours_end;
    const notifications = new NotificationService(supabase, bot);
    const preferences = await notifications.updatePreferences(tgUser.id, updates as any);
    return c.json(preferences);
  });

  app.get("/api/football/live", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);
      const { data: user } = await supabase
        .from("users")
        .select("plan")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      const plan = user?.plan || "free";
      if (plan === "free") {
        // Free plan gets a small daily trial instead of a hard block.
        const quotaKey = `chat_quota:${tgUser.id}:${new Date().toISOString().slice(0, 10)}`;
        const FREE_CHAT_PER_DAY = 5;
        const { data: quotaRow } = await supabase
          .from("api_cache")
          .select("data")
          .eq("endpoint", quotaKey)
          .maybeSingle();
        const used = Number(quotaRow?.data?.count || 0);
        if (used >= FREE_CHAT_PER_DAY) {
          return c.json(
            {
              error: `Free plan allows ${FREE_CHAT_PER_DAY} AI chat messages per day. Upgrade for unlimited chat.`,
              code: "CHAT_QUOTA",
              used,
              limit: FREE_CHAT_PER_DAY,
            },
            402,
          );
        }
        await supabase.from("api_cache").upsert(
          {
            endpoint: quotaKey,
            data: { count: used + 1 },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );
      }

      const matches = await getLiveMatches();
      if (matches.length > 0) return c.json(matches);

      const { data } = await supabase.from("api_cache").select("data").eq("endpoint", "live").single();
      return c.json(data?.data || []);
    } catch (error: any) {
      console.error("Football live API error:", error?.message || error);
      return c.json({ error: "Failed to fetch live matches" }, 500);
    }
  });

  app.get("/api/football/live/:fixtureId/preview", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);
      const { data: user } = await supabase
        .from("users")
        .select("plan")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      const plan = user?.plan || "free";
      if (plan === "free") {
        return c.json({ error: "Live previews are available on paid plans only." }, 403);
      }

      const fixtureId = c.req.param("fixtureId");

      // 1. Try BSD direct lookup (works for bsd_ prefixed IDs)
      let preview: any = await getLiveMatchPreview(fixtureId);

      // 2. Scan live match list — works for any ID format (espn_, bsd_, sportsapi_)
      if (!preview) {
        const liveMatches = await getLiveMatches();
        preview = liveMatches.find((m: any) => {
          const mId = String(m?.fixture?.id || m?.id || "");
          const fId = String(fixtureId || "");
          return mId === fId || mId.endsWith(fId) || fId.endsWith(mId);
        });
      }

      // 3. Last resort: return a minimal valid shell so the page still opens
      //    (the frontend will refresh every 20s and fill in real data)
      if (!preview) {
        console.warn(`[live/preview] No data found for fixtureId=${fixtureId}. Returning shell.`);
        return c.json({
          fixture: { id: fixtureId, date: new Date().toISOString(), status: { short: "LIVE", elapsed: 0, state: "in" } },
          teams: { home: { name: "Home", id: 0, logo: null }, away: { name: "Away", id: 0, logo: null } },
          goals: { home: 0, away: 0 },
          stats: { possession: { home: "50", away: "50" }, shotsOnTarget: { home: "0", away: "0" }, shots: { home: "0", away: "0" }, corners: { home: "0", away: "0" } },
          league: { name: "Live Football" },
          xG: { home: 0, away: 0 },
          _shell: true,
        });
      }
      return c.json(preview);
    } catch (error: any) {
      console.error("Football live preview API error:", error?.message || error);
      return c.json({ error: "Failed to fetch live preview" }, 500);
    }
  });

  app.get("/api/football/upcoming", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    if (guardExpensiveEndpoint(c)) return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    try {
      const matches = await getUpcomingMatches();
      return c.json(matches);
    } catch (error: any) {
      console.error("Football upcoming API error:", error?.message || error);
      return c.json({ error: "Failed to fetch upcoming matches" }, 500);
    }
  });

  app.get("/api/football/search", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    if (guardExpensiveEndpoint(c)) return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    try {
      const q = (c.req.query("q") || "").trim().slice(0, 100);
      if (q.length < 2) return c.json([]);
      const matches = await searchMatches(q);
      return c.json(matches);
    } catch (error: any) {
      console.error("Football search API error:", error?.message || error);
      return c.json({ error: "Failed to search matches" }, 500);
    }
  });

  app.post("/api/football/details/:fixtureId", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    if (guardExpensiveEndpoint(c)) return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    try {
      const fixtureId = c.req.param("fixtureId");
      const body = await c.req.json().catch(() => ({} as any));
      const details = await getMatchDetails(fixtureId, body.match);
      return c.json(details);
    } catch (error: any) {
      console.error("Football details API error:", error?.message || error);
      return c.json({ error: "Failed to fetch match details" }, 500);
    }
  });

  app.get("/api/football/h2h", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    if (guardExpensiveEndpoint(c)) return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    try {
      const home = c.req.query("home") || "";
      const away = c.req.query("away") || "";
      const fixtureId = c.req.query("fixtureId") || "";
      if (!home || !away) return c.json({ error: "Missing home or away team" }, 400);

      let data = fixtureId ? await getBsdH2H(fixtureId, home, away) : null;
      if (!data && !fixtureId) {
        const candidates = await searchMatches(home);
        const match = (candidates || []).find(
          (item: any) =>
            String(item?.teams?.away?.name || '').toLowerCase() === away.toLowerCase() &&
            String(item?.teams?.home?.name || '').toLowerCase() === home.toLowerCase(),
        );
        if (match?.fixture?.id) data = await getBsdH2H(match.fixture.id, home, away);
      }
      return c.json(
        data || {
          last5: [],
          summary: "No H2H data",
          avgGoals: 0,
          hypeScore: 0,
          hypeLevel: "LOW",
          source: "bsd",
        },
      );
    } catch (error: any) {
      console.error("Football H2H API error:", error?.message || error);
      return c.json({ error: "Failed to fetch H2H data" }, 500);
    }
  });

  // --- PLAN LIMITS CONFIG ---
  // Updated to match frontend UI promises and professional tier structure
  const PLAN_CONFIG: Record<string, { dailyCredits: number; name: string }> = {
    free: { dailyCredits: 3, name: "Free" },
    monthly_basic: { dailyCredits: 10, name: "Monthly Basic" },
    monthly_pro: { dailyCredits: 16, name: "Monthly Pro" },
    admin: { dailyCredits: 999, name: "Administrator" }
  };

  /**
   * Professional Reset/Refill Logic
   * Ensures users get their daily quota based on plan.
   * Credits refresh every 24 hours from last reset time.
   */
  async function syncUserCredits(userData: any) {
    const now = new Date();
    const planExpiresAt = userData.plan_expires_at ? new Date(userData.plan_expires_at) : null;
    let effectivePlan = userData.plan || "free";

    // Auto-downgrade expired subscriptions (all paid tiers, not just the
    // current monthly names).
    if (
      effectivePlan !== "free" &&
      effectivePlan !== "admin" &&
      planExpiresAt &&
      planExpiresAt.getTime() <= now.getTime()
    ) {
      effectivePlan = "free";
      const { error: downgradeError } = await supabase
        .from("users")
        .update({ plan: "free", plan_expires_at: null, last_active: now.toISOString() })
        .eq("telegram_id", userData.telegram_id);
      
      if (downgradeError) {
        console.error("Subscription downgrade error:", downgradeError.message);
      }
    }

    const lastCreditReset = userData.last_credit_reset ? new Date(userData.last_credit_reset) : null;

    // Reset once per calendar day in the configured timezone (matches the
    // scheduled reset service instead of using a rolling 24h window).
    const shouldReset =
      !lastCreditReset || getCreditDateKey(lastCreditReset) < getCreditDateKey(now);

    let currentCredits = Number(userData.credits || 0);
    const plan = effectivePlan;
    const config = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
    let dailyQuota = config.dailyCredits;

    // Free credits expire after 7 days from account creation.
    if (plan === "free") {
      const createdAt = userData.created_at ? new Date(userData.created_at) : null;
      const accountAgeMs = createdAt ? now.getTime() - createdAt.getTime() : 0;
      const isWithinFreeWindow = createdAt ? accountAgeMs <= (7 * 24 * 60 * 60 * 1000) : false;
      if (!isWithinFreeWindow) {
        dailyQuota = 0;
      }
    }

    if (shouldReset) {
      // Reset credits to daily quota, but preserve any bonus credits above quota.
      if (dailyQuota > 0) {
        // Only reset if below quota, otherwise keep existing (bonus) credits
        if (currentCredits < dailyQuota) {
          currentCredits = dailyQuota;
        }
        // If currentCredits >= dailyQuota, keep them (user has bonus/rollover credits)
      }
      
      const { error: resetError } = await supabase
        .from("users")
        .update({
          credits: currentCredits,
          last_credit_reset: now.toISOString(),
          last_active: now.toISOString()
        })
        .eq("telegram_id", userData.telegram_id);

      if (resetError) {
        console.error("Daily credit reset error:", resetError.message);
      }
    }
    
    return currentCredits;
  }

  // --- AI ANALYSIS ENDPOINTS (CREDIT CONSUMING) ---
  
  app.post("/api/analyze", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    const tgUserForRateLimit = initData ? getTelegramUserFromInitData(initData) : null;
    const rateIdentifier = `analyze:${tgUserForRateLimit?.id || getRequestIp(c)}`;
    if (isRateLimited(rateIdentifier)) {
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many analysis requests. Please try again shortly." }, 429);
    }

    try {
      const { matchString: rawMatchString, matchId } = await c.req.json();
      if (typeof rawMatchString !== "string" || !rawMatchString.trim() || rawMatchString.length > 200) {
        return c.json({ error: "Invalid match string" }, 400);
      }
      const matchString = rawMatchString
        .replace(/[^\p{L}\p{N}\s\-.'&/]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_MATCH_STRING_LENGTH);
      if (!matchString) {
        return c.json({ error: "Invalid match string" }, 400);
      }
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser) return c.json({ error: "User not identified" }, 401);

      const telegramId = tgUser.id;

      // 1. Fetch User and Run Daily Sync
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();

      if (userError || !user) return c.json({ error: "User profile not found" }, 404);
      if (!user.phone) {
        return c.json({ error: "Complete signup first by sharing your contact." }, 403);
      }

      // Professionally ensure daily credits are refilled if it's a new day
      const credits = await syncUserCredits(user);

      const cost = 1; // 1 credit per analysis
      if (credits < cost) {
        return c.json({ 
          error: "Daily limit reached", 
          required: cost, 
          current: credits,
          plan: user.plan,
          nextReset: "Tomorrow morning" 
        }, 402);
      }

      // 2. Build statistical + market context (BSD odds/stats/H2H + Dixon-Coles model)
      let structuredContext = "";
      let modelBlock: any = null;
      let bsdPreview: any = null;
      let h2hData: any = null;
      try {
        const { computeMarketModel, buildMarketContextBlock } = await import(
          "./services/marketModelService.js"
        );
        const { getMatchDetails } = await import("./services/footballService.js");

        const idStr = String(matchId || "");
        if (/^bsd_\d+$/.test(idStr) || /^\d+$/.test(idStr)) {
          bsdPreview = await getLiveMatchPreview(idStr).catch(() => null);
        }
        if (!bsdPreview) {
          const [homeNameRaw, awayNameRaw] = matchString.split(/\s+vs\.?\s+/i);
          if (homeNameRaw && awayNameRaw) {
            const { fetchBsdMatchStatsByName } = await import("./services/footballService.js");
            bsdPreview = await fetchBsdMatchStatsByName(homeNameRaw.trim(), awayNameRaw.trim()).catch(() => null);
          }
        }
        if (bsdPreview) {
          const bsdId = String(bsdPreview?.fixture?.id || idStr || "");
          h2hData = bsdId ? await getBsdH2H(bsdId, bsdPreview?.teams?.home?.name, bsdPreview?.teams?.away?.name).catch(() => null) : null;
          const matchData = await getMatchDetails(bsdId || idStr || "unknown", {
            home: bsdPreview?.teams?.home?.name,
            away: bsdPreview?.teams?.away?.name,
          });
          // Feed H2H last-5 into the feature table when BSD provided it
          if (h2hData?.last5?.length && Array.isArray(h2hData.last5)) {
            const wins = h2hData.last5.filter((r: string) => r === "W").length;
            const draws = h2hData.last5.filter((r: string) => r === "D").length;
            const losses = h2hData.last5.filter((r: string) => r === "L").length;
            matchData.home.last5.results = h2hData.last5.slice(0, 5) as any;
            matchData.home.last5.goalsScored = wins * 1.4 + draws * 0.8;
            matchData.home.last5.goalsConceded = losses * 1.3 + draws * 0.8;
            matchData.away.last5.results = h2hData.last5.slice(0, 5) as any;
            matchData.away.last5.goalsScored = losses * 1.2 + draws * 0.7;
            matchData.away.last5.goalsConceded = wins * 1.4 + draws * 0.7;
          }
          const model = computeMarketModel(matchData, { bsdMatch: bsdPreview, h2h: h2hData });
          structuredContext = buildMarketContextBlock(matchData, model, { h2h: h2hData, bsdMatch: bsdPreview });
          modelBlock = {
            lambdaHome: model.lambdaHome,
            lambdaAway: model.lambdaAway,
            dataQuality: model.dataQuality,
            probs: model.probs,
            bestBet: model.bestBet,
            valueBets: model.valueBets.slice(0, 8),
            scorelines: model.scorelines,
            htFt: model.htFt.slice(0, 5),
            corners: model.corners,
            cards: model.cards,
            correctScore: model.correctScore,
          };
        }
      } catch (contextError: any) {
        console.warn("[analyze] Market model context skipped:", contextError?.message || contextError);
      }

      // 2b. AI analysis (Gemini + Search), grounded by the market model
      const { analyzeMatchWithSearch } = await import("./services/geminiService.js");
      const runTimedAnalysis = () => Promise.race([
        analyzeMatchWithSearch(matchString, structuredContext || undefined),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AI analysis timeout")), 50_000))
      ]) as Promise<any>;

      let result: any = null;
      let lastAnalysisError: any = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          result = await runTimedAnalysis();
          break;
        } catch (attemptError: any) {
          lastAnalysisError = attemptError;
          const message = String(attemptError?.message || "");
          const isTransient = message.includes("timeout") || message.includes("UNAVAILABLE") || message.includes("RESOURCE_EXHAUSTED") || attemptError?.status === 429 || attemptError?.status === 503;
          if (!isTransient || attempt === 2) {
            throw attemptError;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      if (!result && lastAnalysisError) {
        throw lastAnalysisError;
      }

      // 2.5. Shape result based on plan
      // Free: 1 prediction
      // Basic: 2 predictions
      // Pro/Admin: 5 predictions
      try {
        if (result && result.predictions) {
          const plan = user.plan || "free";
          const predictionCount = plan === "monthly_pro" || plan === "admin" ? 5 : (plan === "monthly_basic" ? 2 : 1);
          result.predictions = result.predictions.slice(0, predictionCount);
        }
      } catch (shapeError) {
        console.error("Error shaping match analysis result:", shapeError);
      }

      if (result && modelBlock) {
        result.model = modelBlock;
      }

      // Do not let fallback/placeholder statistics produce high-confidence picks.
      // Below this threshold, the model lacks enough verified team/market data
      // to justify a strong recommendation, regardless of the AI's wording.
      if (result?.predictions?.length && Number(modelBlock?.dataQuality ?? 0) < 0.35) {
        result.predictions = result.predictions.map((prediction: any) => ({
          ...prediction,
          confidence: Math.min(54, Math.max(0, Number(prediction?.confidence) || 0)),
          reasoning: `${String(prediction?.reasoning || "").trim()} [Low verified-data quality: treat as speculative, not a strong pick.]`.trim(),
        }));
        result.overallReasoning = `${String(result.overallReasoning || "").trim()} Current verified team/market data is incomplete, so confidence has been capped.`.trim();
      }

      const topPrediction = result?.predictions?.[0];
      let home = bsdPreview?.teams?.home?.name || "Home";
      let away = bsdPreview?.teams?.away?.name || "Away";
      if ((home === "Home" && away === "Away") && matchId) {
        try {
          const fixtureDetails = await getMatchDetails(matchId);
          home = fixtureDetails?.home?.name || home;
          away = fixtureDetails?.away?.name || away;
        } catch {
          // Fallback to generic names if fixture lookup fails.
        }
      }
      const storedFixtureId = bsdPreview?.fixture?.id
        ? `bsd_${bsdPreview.fixture.id}`
        : (String(matchId || "").startsWith("espn_") ? String(matchId) : (String(matchId || "").startsWith("bsd_") ? String(matchId) : (/^\d+$/.test(String(matchId || "")) ? `bsd_${matchId}` : null)));
      const newHistoryItem: UserHistoryItem = {
        id: crypto.randomUUID(),
        fixtureId: storedFixtureId,
        match: matchString,
        home,
        away,
        predictionMarket: topPrediction?.market || "Unknown Market",
        confidence: Number(topPrediction?.confidence || 0),
        reasoning: topPrediction?.reasoning || result?.overallReasoning || "",
        analysisPayload: result || null,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      try {
        await insertHistoryItem(telegramId, newHistoryItem);
        await pruneHistory(telegramId);
      } catch (historyError) {
        console.error("Failed to persist analysis history:", historyError);
      }

      // 3. Deduct Credits
      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({ 
          credits: credits - cost,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", telegramId)
        .eq("credits", credits)
        .gte("credits", cost)
        .select("credits")
        .maybeSingle();

      if (updateError) {
        console.error("CRITICAL: Credit deduction error:", updateError);
        // In production, we might want to fail the request if credits can't be deducted,
        // but for now we'll log it as a critical error since the schema is consolidated.
        return c.json({ error: "Failed to deduct credits. Please retry." }, 500);
      }

      if (!updatedUser) {
        return c.json({ error: "Credits changed during analysis. Please retry.", code: "CREDITS_CONFLICT" }, 409);
      }

      return c.json({ result, newCredits: Number(updatedUser.credits || 0) });
    } catch (e: any) {
      console.error("Analysis API error:", e.message);
      const message = String(e?.message || "");
      if (message.includes("RESOURCE_EXHAUSTED") || message.includes("quota") || e?.status === 429) {
        return c.json({ error: "AI quota temporarily exhausted. Please retry in a minute." }, 429);
      }
      if (message.includes("UNAVAILABLE") || e?.status === 503) {
        return c.json({ error: "AI model temporarily unavailable. Please retry shortly." }, 503);
      }
      if (message.includes("timeout")) {
        return c.json({ error: "Analysis is taking longer than expected. Please retry." }, 504);
      }
      if (isGeminiConfigError(message)) {
        return c.json({ error: "AI analysis is not configured correctly. Verify GEMINI_API_KEY on the server." }, 503);
      }
      return c.json({ error: "Failed to perform analysis" }, 500);
    }
  });

  app.post("/api/analyze-betslip", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    const tgUserForRateLimit = initData ? getTelegramUserFromInitData(initData) : null;
    const rateIdentifier = `analyze-betslip:${tgUserForRateLimit?.id || getRequestIp(c)}`;
    if (isRateLimited(rateIdentifier)) {
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many analysis requests. Please try again shortly." }, 429);
    }

    try {
      const { images } = await c.req.json();
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser) return c.json({ error: "User not identified" }, 401);
      if (!Array.isArray(images) || images.length === 0) {
        return c.json({ error: "At least one image is required." }, 400);
      }
      if (images.length > 10) {
        return c.json({ error: "Too many images." }, 400);
      }
      const dataUrlPattern = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
      const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;
      if (
        images.some(
          (image: any) =>
            typeof image !== "string" ||
            image.length > MAX_IMAGE_DATA_URL_LENGTH ||
            !dataUrlPattern.test(image),
        )
      ) {
        return c.json(
          { error: "Each image must be a PNG, JPEG, or WebP under 4 MB." },
          400,
        );
      }

      const telegramId = tgUser.id;

      // 1. Fetch User and Run Daily Sync
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();

      if (userError || !user) return c.json({ error: "User not found" }, 404);
      if (!user.phone) {
        return c.json({ error: "Complete signup first by sharing your contact." }, 403);
      }

      const credits = await syncUserCredits(user);
      const plan = user.plan || "free";
      const maxImagesByPlan: Record<string, number> = {
        free: 1,
        monthly_basic: 2,
        monthly_pro: 6,
        admin: 10,
      };
      const maxImages = maxImagesByPlan[plan] ?? 1;
      if (images.length > maxImages) {
        return c.json({
          error: `Your ${plan} plan allows up to ${maxImages} bet slip image(s) per analysis.`,
          maxImages,
          plan,
        }, 400);
      }

      const cost = 3; // OCR remains more expensive
      if (credits < cost) {
        return c.json({ 
          error: "Insufficient credits for complex analysis", 
          required: cost, 
          current: credits,
          plan: user.plan,
          nextReset: "Tomorrow morning"
        }, 402);
      }

      // 2. Perform Analysis
      const { analyzeBetSlip } = await import("./services/geminiService.js");
      let result = await analyzeBetSlip(images);

      // 2.5. Shape result based on plan
      // Free: 1 safe, 0 value
      // Basic: 1 safe, 1 value
      // Pro/Admin: 2 safe, 2 value
      try {
        if (result) {
          const safeCount = plan === "monthly_pro" || plan === "admin" ? 2 : 1;
          const valueCount = plan === "monthly_pro" || plan === "admin" ? 2 : (plan === "monthly_basic" ? 1 : 0);

          if (result.safePicks) {
            result.safePicks = result.safePicks.slice(0, safeCount);
          }
          if (result.valueBets) {
            result.valueBets = result.valueBets.slice(0, valueCount);
          } else if (valueCount > 0) {
            result.valueBets = []; // Ensure it exists if plan allows it
          }
        }
      } catch (shapeError) {
        console.error("Error shaping betslip result:", shapeError);
        // Continue with original result if shaping fails - better than crashing
      }

      // 3. Deduct Credits
      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({ 
          credits: credits - cost,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", telegramId)
        .eq("credits", credits)
        .gte("credits", cost)
        .select("credits")
        .maybeSingle();

      if (updateError) {
        console.error("CRITICAL: Betslip credit deduction error:", updateError);
        return c.json({ error: "Failed to deduct credits. Please retry." }, 500);
      }
      if (!updatedUser) {
        return c.json({ error: "Credits changed during bet slip analysis. Please retry.", code: "CREDITS_CONFLICT" }, 409);
      }

      return c.json({ result, newCredits: Number(updatedUser.credits || 0) });
    } catch (e: any) {
      console.error("Bet Slip Analysis API error:", e.message);
      return c.json({
        error: isGeminiConfigError(e?.message)
          ? "AI analysis is not configured correctly. Verify GEMINI_API_KEY on the server."
          : "Failed to analyze bet slip",
      }, 500);
    }
  });

  app.post("/api/analyze-live", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    const tgUserForRateLimit = initData ? getTelegramUserFromInitData(initData) : null;
    const rateIdentifier = `analyze-live:${tgUserForRateLimit?.id || getRequestIp(c)}`;
    if (isRateLimited(rateIdentifier)) {
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    }
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many analysis requests. Please try again shortly." }, 429);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);
      const { fixtureId, liveSnapshot } = await c.req.json().catch(() => ({} as any));
      const normalizedFixtureId = String(fixtureId || liveSnapshot?.fixture?.id || "").trim();
      if (!normalizedFixtureId) return c.json({ error: "fixtureId is required" }, 400);

      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", tgUser.id)
        .single();
      if (userError || !user) return c.json({ error: "User profile not found" }, 404);
      if ((user?.plan || "free") === "free") {
        return c.json({ error: "Live match analysis is available on paid plans only." }, 403);
      }

      const credits = await syncUserCredits(user);
      const cost = 2;
      if (credits < cost) {
        return c.json({
          error: "Insufficient credits for live analysis",
          required: cost,
          current: credits,
          plan: user.plan,
          nextReset: "Tomorrow morning"
        }, 402);
      }

      // Merge live API data with the client-side snapshot — whichever has more detail wins
      const apiLive = await getLiveMatchPreview(normalizedFixtureId).catch(() => null);
      const liveData: any = apiLive || liveSnapshot || null;

      // Extract team names from various data shapes (BSD, ESPN, formatted snapshot)
      const homeName =
        liveData?.teams?.home?.name ||
        liveData?.home ||
        liveSnapshot?.teams?.home?.name ||
        liveSnapshot?.home ||
        null;
      const awayName =
        liveData?.teams?.away?.name ||
        liveData?.away ||
        liveSnapshot?.teams?.away?.name ||
        liveSnapshot?.away ||
        null;

      if (!homeName || !awayName) {
        return c.json({ error: "Could not identify teams for this fixture. Please go back and reopen the match." }, 503);
      }

      // Normalise liveData so downstream code always sees teams.home.name / teams.away.name
      if (liveData && !liveData.teams) {
        liveData.teams = { home: { name: homeName }, away: { name: awayName } };
      }

      const matchString = `${homeName} vs ${awayName}`;
      const structuredContext = JSON.stringify({
        fixtureId: liveData.fixture?.id || normalizedFixtureId,
        score: liveData.goals,
        status: liveData.fixture?.status,
        league: liveData.league,
        stats: liveData.stats,
        xG: liveData.xG,
        odds: liveData.odds,
      });

      // Fast in-play analysis: skips Google Search because the live snapshot
      // already carries score, minute, stats, xG and odds — so replies arrive
      // in seconds instead of tripping the old 30s search timeout (which is
      // what used to force the fake "no edge" fallback on every request).
      // On genuine failure: return a retryable error WITHOUT charging credits
      // and never show a fabricated prediction to the user.
      const { analyzeLiveMatchNow } = await import("./services/geminiService.js");
      let result: any;
      try {
        const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
          return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("AI analysis timeout")), timeoutMs);
            promise
              .then((value) => {
                clearTimeout(timer);
                resolve(value);
              })
              .catch((error) => {
                clearTimeout(timer);
                reject(error);
              });
          });
        };

        result = await withTimeout(analyzeLiveMatchNow(`${matchString} (LIVE)`, structuredContext), 45_000);
      } catch (analysisError: any) {
        console.error(`Live analysis failed: ${analysisError?.message || analysisError}`);
        return c.json(
          { error: "The live analyst is busy right now. Nothing was charged — please retry in a moment." },
          503,
        );
      }
      if (!result?.predictions?.length) {
        return c.json(
          { error: "Live analysis returned no predictions. Nothing was charged — please retry." },
          503,
        );
      }

      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({
          credits: credits - cost,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", tgUser.id)
        .eq("credits", credits)
        .gte("credits", cost)
        .select("credits")
        .maybeSingle();

      if (updateError) {
        console.error("CRITICAL: Live analysis credit deduction error:", updateError);
        return c.json({ error: "Failed to deduct credits. Please retry." }, 500);
      }
      if (!updatedUser) {
        return c.json({ error: "Credits changed during live analysis. Please retry.", code: "CREDITS_CONFLICT" }, 409);
      }

      // Live analyses land in History exactly like pre-match analyses.
      try {
        const topPrediction = result?.predictions?.[0];
        const newHistoryItem: UserHistoryItem = {
          id: crypto.randomUUID(),
          fixtureId: /^\d+$/.test(normalizedFixtureId)
            ? `bsd_${normalizedFixtureId}`
            : (normalizedFixtureId || null),
          match: matchString,
          home: String(homeName),
          away: String(awayName),
          predictionMarket: topPrediction?.market || "Unknown Market",
          confidence: Number(topPrediction?.confidence || 0),
          reasoning: topPrediction?.reasoning || result?.overallReasoning || "",
          analysisPayload: result || null,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        await insertHistoryItem(tgUser.id, newHistoryItem);
        await pruneHistory(tgUser.id);
      } catch (historyError: any) {
        console.error("Failed to persist live analysis history:", historyError?.message || historyError);
      }

      return c.json({
        result,
        newCredits: Number(updatedUser.credits || 0),
        liveData,
        analysisType: "live"
      });
    } catch (error: any) {
      console.error("Analyze live API error:", error?.message || error);
      return c.json({
        error: isGeminiConfigError(error?.message)
          ? "AI analysis is not configured correctly. Verify GEMINI_API_KEY on the server."
          : "Failed to analyze live match",
      }, 500);
    }
  });

  app.get("/api/espn", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    if (guardExpensiveEndpoint(c)) return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    const urlObj = new URL(c.req.url);
    const league = (urlObj.searchParams.get("league") || "eng.1").slice(0, 40);
    const endpoint = (urlObj.searchParams.get("endpoint") || "scoreboard").slice(0, 80);
    const rawTtl = parseInt(urlObj.searchParams.get("ttl") || "300", 10);
    const ttl = Number.isFinite(rawTtl) ? Math.min(Math.max(rawTtl, 30), 86_400) : 300;

    // Only allow simple ESPN path segments. This keeps the proxy pinned to the
    // ESPN API and prevents path tricks / cache-key pollution.
    if (!/^[a-z0-9.]+$/i.test(league) || !/^[a-z0-9/_-]+$/i.test(endpoint)) {
      return c.json({ error: "Invalid league or endpoint" }, 400);
    }

    // Support for team details: endpoint=teams/:id
    const espnUrl = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/${endpoint}`);
    urlObj.searchParams.forEach((value, key) => {
      if (key !== "league" && key !== "endpoint" && key !== "ttl") {
        espnUrl.searchParams.set(key, value);
      }
    });

    const cacheKey = `espn:${espnUrl.pathname}${espnUrl.search}`;
    const { data: cached } = await supabase
      .from("api_cache")
      .select("*")
      .eq("endpoint", cacheKey)
      .single();

    if (cached) {
      const updatedAt = new Date(cached.updated_at).getTime();
      if (Date.now() - updatedAt < ttl * 1000) {
        return c.json(cached.data);
      }
    }

    try {
      const response = await axios.get(espnUrl.toString(), { timeout: 10_000 });
      if (response.data) {
        await supabase.from("api_cache").upsert({
          endpoint: cacheKey,
          data: response.data,
          updated_at: new Date().toISOString()
        });
        return c.json(response.data);
      }
    } catch (err: any) {
      const status = err.response?.status;
      if (status !== 400 && status !== 404) {
        console.error("ESPN Proxy Error:", err.message, espnUrl.toString());
      }
      if (cached) return c.json(cached.data);
      return c.json({ error: "API error", status: status || 500 }, status || 500);
    }
    return c.json({ error: "Failed to fetch from ESPN" }, 500);
  });

  // Trending Picks Mechanism
  app.post("/api/trending/click", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);
    try {
      const { matchId, teams } = await c.req.json().catch(() => ({} as any));
      const normalizedMatchId = String(matchId || "").trim().slice(0, 100);
      if (!normalizedMatchId) return c.json({ error: "Missing matchId" }, 400);

      const { data: cached } = await supabase
        .from("api_cache")
        .select("*")
        .eq("endpoint", "trending_picks")
        .single();

      let trendingData = cached?.data || {};
      
      if (!trendingData[normalizedMatchId]) {
        trendingData[normalizedMatchId] = {
          clicks: 0,
          teams: typeof teams === "object" && teams ? teams : null,
        };
      }

      trendingData[normalizedMatchId].clicks += 1;
      trendingData[normalizedMatchId].last_clicked = new Date().toISOString();

      // Bound the JSON document so it cannot grow without limit.
      const entries = Object.entries(trendingData)
        .sort(([, a]: [string, any], [, b]: [string, any]) => Number(b?.clicks || 0) - Number(a?.clicks || 0))
        .slice(0, 200);
      trendingData = Object.fromEntries(entries);

      await supabase.from("api_cache").upsert({
        endpoint: "trending_picks",
        data: trendingData,
        updated_at: new Date().toISOString()
      });

      return c.json({ success: true });
    } catch (e: any) {
      console.error("Trending click error:", e.message);
      return c.json({ error: "Failed to record click" }, 500);
    }
  });

  app.get("/api/trending", async (c) => {
    try {
      const { data: cached } = await supabase
        .from("api_cache")
        .select("*")
        .eq("endpoint", "trending_picks")
        .single();

      const trendingData = cached?.data || {};
      
      const sorted = Object.entries(trendingData)
        .map(([id, data]: [string, any]) => ({
          id,
          teams: data.teams,
          clicks: data.clicks,
          last_clicked: data.last_clicked
        }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5);

      return c.json(sorted);
    } catch (e: any) {
      console.error("Trending fetch error:", e.message);
      return c.json([], 500);
    }
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "Deepflashaibot";
  // Render injects RENDER_EXTERNAL_URL automatically. Prefer it over falling
  // back to localhost, which Telegram rejects for Web App buttons.
  const appUrl = (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    DEFAULT_APP_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/+$/, "");
  if (!/^https:\/\//i.test(appUrl)) {
    console.warn(
      `APP_URL is not HTTPS (${appUrl}). Telegram Web App buttons will be rejected until APP_URL or RENDER_EXTERNAL_URL is set.`,
    );
  }
  const signupContactMessage = "To unlock AI analysis and features, please complete your registration by sharing your contact:";
  const signupContactKeyboard = {
    reply_markup: {
      keyboard: [[{ text: "📲 Share Contact to Sign Up", request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true
    }
  };
  const buildSignupUrl = (telegramId?: number | string) =>
    `https://t.me/${botUsername.replace('@', '')}${telegramId ? `?start=signup_${telegramId}` : ''}`;

  let bot: Telegraf | null = null;
  let engagementScheduler: EngagementScheduler | null = null;
  let channelAgent: ChannelAgentScheduler | null = null;

  if (botToken) {
    bot = new Telegraf(botToken);
    const notifications = new NotificationService(supabase, bot);

    const formatQuietHours = (start: number, end: number) => {
      if (start === end) return "Off";
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${pad(start)}:00–${pad(end)}:00`;
    };

    const buildSettingsView = async (telegramId: number) => {
      const prefs = await notifications.getPreferences(telegramId);
      const status = (enabled: boolean) => (enabled ? "✅" : "⭕");
      const text =
        `⚙️ <b>Notification settings</b>\n\n` +
        `${status(prefs.daily_fixtures)} Matchday digest — today's fixtures\n` +
        `${status(prefs.live_alerts)} Live alerts — goals for matches you follow\n` +
        `${status(prefs.news_digest)} Football feed — top stories\n` +
        `${status(prefs.weekly_recap)} Weekly recap — your progress\n` +
        `${status(prefs.marketing)} Offers & tips — upgrades and win-backs\n\n` +
        `🌙 Quiet hours: <b>${formatQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end)}</b> (${escapeHtml(prefs.timezone)})\n` +
        `Send <code>/timezone Europe/London</code> to change your timezone.`;
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`${status(prefs.daily_fixtures)} Matchday`, "pref:toggle:daily_fixtures"),
          Markup.button.callback(`${status(prefs.live_alerts)} Live alerts`, "pref:toggle:live_alerts"),
        ],
        [
          Markup.button.callback(`${status(prefs.news_digest)} News feed`, "pref:toggle:news_digest"),
          Markup.button.callback(`${status(prefs.weekly_recap)} Weekly recap`, "pref:toggle:weekly_recap"),
        ],
        [Markup.button.callback(`${status(prefs.marketing)} Offers & tips`, "pref:toggle:marketing")],
        [Markup.button.webApp("💎 View plans & offers", `${appUrl}?tab=subscriptions`)],
        [
          Markup.button.callback(
            prefs.quiet_hours_start === prefs.quiet_hours_end ? "🌙 Enable quiet hours" : "🌙 Disable quiet hours",
            "pref:quiet:toggle",
          ),
        ],
        [Markup.button.callback("🔕 Pause all", "pref:all_off")],
      ]);
      return { prefs, text, keyboard };
    };

    const refreshSettingsMessage = async (ctx: any) => {
      const telegramId = Number(ctx.from?.id);
      if (!telegramId) return;
      const { text, keyboard } = await buildSettingsView(telegramId);
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
      } catch {
        try {
          await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        } catch { /* ignore */ }
      }
    };

    bot.command(["settings", "notifications"], async (ctx) => {
      const { text, keyboard } = await buildSettingsView(ctx.from.id);
      await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
    });

    bot.command("timezone", async (ctx) => {
      const requested = String(ctx.message.text || "").split(/\s+/).slice(1).join(" ").trim();
      if (!requested) {
        const prefs = await notifications.getPreferences(ctx.from.id);
        await ctx.reply(`Your timezone is ${prefs.timezone}. Send /timezone Europe/London to change it.`);
        return;
      }
      if (requested.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(requested)) {
        await ctx.reply("Please send a valid IANA timezone, for example /timezone Europe/London.");
        return;
      }
      const timezone = normalizeTimezone(requested);
      if (timezone === "UTC" && requested.toUpperCase() !== "UTC") {
        await ctx.reply("That timezone is not recognised. Try /timezone Africa/Lagos or /timezone Europe/London.");
        return;
      }
      await notifications.updatePreferences(ctx.from.id, { timezone });
      await ctx.reply(`✅ Timezone updated to ${timezone}. Quiet hours now follow your local time.`);
    });

    bot.command("stop", async (ctx) => {
      await notifications.updatePreferences(ctx.from.id, {
        daily_fixtures: false,
        live_alerts: false,
        news_digest: false,
        weekly_recap: false,
        marketing: false,
      });
      await ctx.reply("🔕 All notifications paused. Send /settings to turn them back on.");
    });

    bot.action(/^pref:/, async (ctx) => {
      const data = String(ctx.match?.[0] || "");
      const parts = data.split(":");
      const action = parts[1];
      const key = parts[2];

      if (action === "menu") {
        const { text, keyboard } = await buildSettingsView(ctx.from.id);
        await ctx.answerCbQuery();
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => undefined);
        return;
      }

      if (action === "all_off") {
        await notifications.updatePreferences(ctx.from.id, {
          daily_fixtures: false,
          live_alerts: false,
          news_digest: false,
          weekly_recap: false,
          marketing: false,
        });
        await ctx.answerCbQuery("All notifications paused");
        await refreshSettingsMessage(ctx);
        return;
      }

      if (action === "quiet" && key === "toggle") {
        const prefs = await notifications.getPreferences(ctx.from.id);
        const enabled = prefs.quiet_hours_start !== prefs.quiet_hours_end;
        await notifications.updatePreferences(
          ctx.from.id,
          enabled ? { quiet_hours_start: 0, quiet_hours_end: 0 } : { quiet_hours_start: 22, quiet_hours_end: 8 },
        );
        await ctx.answerCbQuery(enabled ? "Quiet hours disabled" : "Quiet hours enabled (22:00–08:00)");
        await refreshSettingsMessage(ctx);
        return;
      }

      const allowedKeys = new Set(["daily_fixtures", "live_alerts", "news_digest", "weekly_recap", "marketing"]);
      if (!key || !allowedKeys.has(key)) {
        await ctx.answerCbQuery("Unknown setting");
        return;
      }

      const prefs = await notifications.getPreferences(ctx.from.id);
      const nextValue = action === "off" ? false : !Boolean((prefs as any)[key]);
      await notifications.updatePreferences(ctx.from.id, { [key]: nextValue } as any);
      await ctx.answerCbQuery(nextValue ? "Enabled" : "Disabled");
      await refreshSettingsMessage(ctx);
    });

    bot.action(/^alert:/, async (ctx) => {
      const fixtureId = String(ctx.match?.[0] || "").replace(/^alert:/, "").slice(0, 64);
      if (!fixtureId) {
        await ctx.answerCbQuery("Match unavailable");
        return;
      }

      await ctx.answerCbQuery("Adding alert...").catch(() => undefined);

      try {
        const { count } = await supabase
          .from("match_alert_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("telegram_id", ctx.from.id)
          .eq("active", true);
        if ((count || 0) >= 10) {
          await ctx.reply("You are following 10 matches. Use /settings to manage live alerts.");
          return;
        }

        const [upcoming, live] = await Promise.all([
          getUpcomingMatches().catch(() => []),
          getLiveMatches().catch(() => []),
        ]);
        let match: any = [...(upcoming || []), ...(live || [])].find(
          (item: any) => String(item?.fixture?.id || "") === fixtureId,
        );
        if (!match) {
          match = await getLiveMatchPreview(fixtureId).catch(() => null);
        }
        if (!match) {
          await ctx.reply("I could not find that match. Please open Flash AI and try again.");
          return;
        }

        await notifications.ensurePreferences(ctx.from.id);
        await notifications.updatePreferences(ctx.from.id, { live_alerts: true });
        const { error } = await supabase.from("match_alert_subscriptions").upsert(
          {
            telegram_id: ctx.from.id,
            fixture_id: fixtureId,
            home: match?.teams?.home?.name || "Home",
            away: match?.teams?.away?.name || "Away",
            league: match?.league?.name || "Football",
            kickoff: match?.fixture?.date || new Date().toISOString(),
            active: true,
          },
          { onConflict: "telegram_id,fixture_id" },
        );
        if (error) throw error;

        await ctx.reply(
          `🔔 You're following <b>${escapeHtml(match?.teams?.home?.name || "Home")} vs ${escapeHtml(match?.teams?.away?.name || "Away")}</b>. I'll message you at kick-off, on goals and at full time.`,
          { parse_mode: "HTML" },
        );
      } catch (error: any) {
        console.error("Match alert subscription failed:", error?.message || error);
        await ctx.reply("I could not enable alerts for this match. Please try again from Flash AI.").catch(() => undefined);
      }
    });

    const openMiniAppTab = async (ctx: any, label: string, tab: string) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await ctx.reply(
        `${label} is ready in Flash AI.`,
        Markup.inlineKeyboard([[Markup.button.webApp(`Open ${label}`, `${appUrl}?tab=${tab}`)]]),
      );
    };

    bot.action("matches_tab", (ctx) => openMiniAppTab(ctx, "Matches", "matches"));
    bot.action("profile_tab", (ctx) => openMiniAppTab(ctx, "Profile", "profile"));
    bot.action("offers", (ctx) => openMiniAppTab(ctx, "Plans & offers", "subscriptions"));
    bot.action("admin_tab", (ctx) => openMiniAppTab(ctx, "Admin", "admin"));

    bot.start(async (ctx) => {
      const startPayload = ctx.payload; // This contains the user ID if joined via referral link
      const telegramId = ctx.from.id;
      
      const welcomeMsg = `Welcome to *Flash AI* – your own elite football companion in Telegram!\n\n🚀 *High-confidence AI predictions* for every match\n🔥 *Deep analysis* and data-driven insights\n💸 *Earn credits* by completing daily tasks or referrals\n\nJoin the community of winning bettors and get started in just a few taps`;
      const adminWelcomeMsg = `👋 Welcome back, *Admin*.\n\nOpen your dashboard to manage users, analytics, tasks, and broadcasts.`;
      
      // Upsert basic info and capture referrer if present
      let isAdminUser = false;
      try {
        const isBootstrapAdmin = bootstrapAdminId && telegramId === bootstrapAdminId;
        const { data: existingUser } = await supabase
          .from("users")
          .select("role,referrer_id")
          .eq("telegram_id", telegramId)
          .maybeSingle();

        isAdminUser = Boolean(isBootstrapAdmin || existingUser?.role === "admin");

        const payloadReferrer =
          startPayload && !isNaN(Number(startPayload)) && Number(startPayload) !== telegramId
            ? Number(startPayload)
            : null;

        const profilePhoto = await getTelegramProfilePhotoUrl(telegramId, bot);
        await supabase.from("users").upsert({
          telegram_id: telegramId,
          name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
          username: ctx.from.username || "",
          photo_url: profilePhoto || null,
          // Never clear or replace an existing referrer (a plain /start has no
          // payload; an old referral link must not be re-attributed later).
          referrer_id: existingUser?.referrer_id ?? payloadReferrer,
          role: isAdminUser ? 'admin' : 'user',
          last_active: new Date().toISOString()
        }, { onConflict: 'telegram_id' });
        
        if (isAdminUser) {
           console.log(`🚀 Bootstrap Admin Detected: ${telegramId}`);
        }
      } catch (err) {
        console.error("Error saving start user:", err);
      }

      if (isAdminUser) {
        await ctx.replyWithMarkdown(adminWelcomeMsg, Markup.inlineKeyboard([
          [Markup.button.webApp("🛡️ Open Admin Dashboard", `${appUrl}?tab=admin`)]
        ]));
        return;
      }

      if (String(startPayload || '').startsWith('signup')) {
        await ctx.reply(signupContactMessage, signupContactKeyboard);
        return;
      }

      await ctx.replyWithMarkdown(welcomeMsg, Markup.inlineKeyboard([
        [Markup.button.webApp("🚀 Get Started", `${appUrl}`)],
        [Markup.button.callback("🔔 Notification settings", "pref:menu")],
      ]));
    });

    // Handle Contact Sharing for Registration
    bot.on('contact', async (ctx) => {
      const contact = ctx.message.contact;
      const telegramId = ctx.from.id;
      const contactOwnerId = contact.user_id;
      const firstName = ctx.from.first_name;
      const lastName = ctx.from.last_name || "";
      const fullName = `${firstName} ${lastName}`.trim();
      const phone = contact.phone_number;

      try {
        // Only accept the current user's own contact card
        if (contactOwnerId && contactOwnerId !== telegramId) {
          await ctx.reply("❌ Please share your own contact using the signup button.");
          return;
        }

        // 1. Get user to check if they were referred and prevent duplicate rewards
        const { data: existingUser } = await supabase
          .from("users")
          .select("*")
          .eq("telegram_id", telegramId)
          .maybeSingle();

        const isNewRegistration = !existingUser?.phone;
        const hasValidReferrer = Boolean(existingUser?.referrer_id && existingUser.referrer_id !== telegramId);
        
        // Check if referral was already rewarded (prevent race condition/duplicate reward)
        const referralAlreadyRewarded = existingUser?.referral_rewarded === true;

        // Define signup credits for new users (default: 3, configurable via SIGNUP_CREDITS)
        const signupCreditsToApply = isNewRegistration
          ? (hasValidReferrer ? referralRewardCredits : signupCredits)
          : (existingUser?.credits || 0);

        // 2. Perform registration/update. For an existing user we must NOT
        // write credits/plan back from a stale read, otherwise a concurrent
        // purchase or task claim can be overwritten.
        const profilePhoto = await getTelegramProfilePhotoUrl(telegramId, bot);
        const registrationPayload: Record<string, any> = {
          telegram_id: telegramId,
          name: fullName,
          username: ctx.from.username || "",
          photo_url: profilePhoto || null,
          phone,
          last_active: new Date().toISOString()
        };
        if (!existingUser) {
          registrationPayload.credits = signupCreditsToApply;
          registrationPayload.plan = 'free';
        }

        let { data: user, error } = await supabase
          .from("users")
          .upsert(registrationPayload, { onConflict: 'telegram_id' })
          .select()
          .single();

        if (error) {
          console.error("Registration error:", error);
          if (error.code === "42703" && String(error.message || "").toLowerCase().includes("phone")) {
            console.error("CRITICAL: users.phone column is missing. Run the consolidated schema migration.");
          }
          return ctx.reply("❌ Registration failed. Please try again later.");
        }

        // 3. Handle Referral Reward - ATOMIC operation to prevent race conditions
        if (isNewRegistration && hasValidReferrer && !referralAlreadyRewarded) {
           const rewardAmount = referralRewardCredits; 
           
           try {
             // 1. Mark the NEW user as rewarded FIRST (ticket lock to prevent duplicate rewards)
             const { data: markedUser, error: markError } = await supabase.from("users")
               .update({ referral_rewarded: true })
               .eq("telegram_id", telegramId)
               .neq("referral_rewarded", true)
               .select("telegram_id")
               .maybeSingle();
             
             if (markError) throw markError;
             if (!markedUser) {
               // Another concurrent request already handled referral crediting.
               console.log(`Referral reward already processed for ${telegramId}`);
             } else {
               let rewardApplied = false;

               // 2. Credit the REFERRER
               const { error: rewardError } = await supabase.rpc('add_credits_to_user', {
                 user_telegram_id: existingUser.referrer_id,
                 credits_amount: rewardAmount
               });
               rewardApplied = !rewardError;

                if (!rewardApplied) {
                  // Fallback for deployments that have not applied the schema
                  // migration yet. Reads and writes are not atomic, so the RPC
                  // above is always preferred.
                  console.warn("add_credits_to_user RPC unavailable; using non-atomic credit fallback.");
                  const { data: referrerUser, error: referrerFetchError } = await supabase
                   .from("users")
                   .select("credits")
                   .eq("telegram_id", existingUser.referrer_id)
                   .maybeSingle();
                 if (!referrerFetchError && referrerUser) {
                   const { error: directUpdateError } = await supabase
                     .from("users")
                     .update({ credits: Number(referrerUser.credits || 0) + rewardAmount })
                     .eq("telegram_id", existingUser.referrer_id);
                   rewardApplied = !directUpdateError;
                 }
               }

               if (!rewardApplied) {
                 // Revert ticket lock so reward can be retried later.
                 await supabase
                   .from("users")
                   .update({ referral_rewarded: false })
                   .eq("telegram_id", telegramId);
                 throw new Error(`Failed to apply referral reward for referrer ${existingUser.referrer_id}`);
               }

               // 3. Production Tracking (Referrals table)
               const { error: referralLogError } = await supabase.from("referrals").upsert({
                 referrer_telegram_id: existingUser.referrer_id,
                 referred_telegram_id: telegramId,
                 reward_given: true,
                 reward_amount: rewardAmount,
                 created_at: new Date().toISOString()
               }, { onConflict: 'referred_telegram_id' });
               if (referralLogError) {
                 console.error("Referral table logging error:", referralLogError);
               }

               // 4. Audit Trail (Transactions table)
               const { error: txError } = await supabase.from("transactions").insert({
                 telegram_id: existingUser.referrer_id,
                 amount: rewardAmount,
                 currency: 'CREDITS',
                 status: 'completed',
                 type: 'referral_reward',
                 provider_payment_charge_id: `ref_${telegramId}`
               });
               if (txError) {
                 console.error("Referral transaction logging error:", txError);
               }

               // 5. Notify Referrer
               if (bot) {
                 bot.telegram.sendMessage(existingUser.referrer_id, `👥 A friend joined Flash AI using your link! You've been rewarded with ${rewardAmount} credits. 🔥`).catch(() => {});
               }
             }
           } catch (rewardErr) {
             console.error("Referral reward error:", rewardErr);
           }
        }

        const rewardText = `${signupCreditsToApply} free credits`;
        const referralBonusText = isNewRegistration && existingUser?.referrer_id
          ? `\nYour referrer received ${referralRewardCredits} bonus credits.`
          : "";
        ctx.reply(`✅ Registration successful, ${firstName}!\n\nYou've been rewarded with ${rewardText}.${referralBonusText}\nWelcome to the elite squad! ⚽🔥`, {
          reply_markup: {
            remove_keyboard: true
          }
        });

        // Send inline keyboard with Start Analysis button immediately
        ctx.reply("Ready to analyze? Click below:", Markup.inlineKeyboard([
          [Markup.button.webApp("⚡ Start Analysis", appUrl)],
          [Markup.button.callback("📊 View Matches", "matches_tab")],
          [Markup.button.callback("👤 My Profile", "profile_tab")],
          [Markup.button.callback("🔔 Match alerts & offers", "pref:menu")]
        ]));

      } catch (err) {
        console.error("Unexpected error in registration:", err);
        ctx.reply("An unexpected error occurred during registration.");
      }
    });
    bot.on('pre_checkout_query', (ctx) => {
      ctx.answerPreCheckoutQuery(true).catch(err => console.error("PreCheckout error:", err));
    });

    // Handle Successful Payment
    bot.on('successful_payment', async (ctx) => {
      const payload = ctx.message.successful_payment.invoice_payload;
      const telegramId = ctx.from.id;
      const amount = ctx.message.successful_payment.total_amount; // In Stars (units)

      console.log(`💰 Payment success from ${telegramId}: ${amount} Stars for ${payload}`);

      // Extract plan from payload (e.g., "plan_weekly")
      const planId = payload.startsWith('plan:')
        ? payload.replace('plan:', '')
        : (payload.startsWith('plan_') ? payload.replace('plan_', '') : 'free');
      const expectedStars = getExpectedStarsAmount(planId);
      if (!expectedStars) {
        await ctx.reply("⚠️ Unknown plan in payment payload. Please contact support.");
        return;
      }
      if (Number(amount || 0) < expectedStars) {
        console.error(`Stars payment mismatch for ${telegramId}: paid=${amount}, expected=${expectedStars}, plan=${planId}`);
        await ctx.reply("⚠️ Payment amount mismatch detected. Please contact support before retrying.");
        return;
      }

      const providerChargeId = ctx.message.successful_payment.provider_payment_charge_id;

      try {
        // Insert the transaction first: the UNIQUE(provider_payment_charge_id,
        // type) constraint makes this idempotent if Telegram redelivers.
        const { data: insertedTx, error: txError } = await supabase
          .from("transactions")
          .insert({
            telegram_id: telegramId,
            amount,
            currency: "XTR",
            status: "completed",
            provider_payment_charge_id: providerChargeId,
            type: "stars",
          })
          .select("id")
          .single();

        if (txError) {
          if (txError.code === "23505") {
            console.log(`Duplicate Stars payment ignored for ${telegramId}: ${providerChargeId}`);
            return;
          }
          throw txError;
        }

        let creditsToAdd: number;
        try {
          creditsToAdd = await applyPlanCredits(telegramId, planId);
        } catch (grantError) {
          if (insertedTx?.id) {
            await supabase.from("transactions").delete().eq("id", insertedTx.id);
          }
          throw grantError;
        }

        await ctx.reply(`🎉 Payment Successful! Your account has been upgraded to ${planId.toUpperCase()} plan. Enjoy your ${creditsToAdd} daily credits!`);
      } catch (err: any) {
        console.error("Failed to update user after payment:", err.message);
        ctx.reply("⚠️ Payment received but failed to update your plan. Please contact support with your payment ID.");
      }
    });

    bot.catch((error, ctx) => {
      console.error(`Bot handler error (${ctx.updateType}):`, error);
    });

    bot.telegram
      .setMyCommands([
        { command: "start", description: "Open Flash AI" },
        { command: "settings", description: "Notification settings" },
        { command: "timezone", description: "Set your timezone for quiet hours" },
        { command: "stop", description: "Pause all notifications" },
      ])
      .catch(() => undefined);

    bot.launch().catch(err => console.error("❌ Bot launch failed:", err));

    engagementScheduler = new EngagementScheduler({ supabase, bot, appUrl });
    if (String(process.env.NOTIFICATIONS_ENABLED || "true").toLowerCase() !== "false") {
      engagementScheduler.start();
    }

    channelAgent = new ChannelAgentScheduler({ supabase, bot, appUrl });
    channelAgent.start();
  }

  // Auth/Signup Request Endpoint
  app.get("/api/auth/me", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = getTelegramUserFromInitData(initData || "");
      if (!tgUser?.id) return c.json({ error: "Missing Telegram user payload" }, 400);

      const isBootstrapAdmin = Boolean(bootstrapAdminId && tgUser.id === bootstrapAdminId);

      const { data: existing, error: fetchError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      if (!existing) {
        const { error: insertError } = await supabase.from("users").insert({
          telegram_id: tgUser.id,
          name: `${tgUser.first_name || ""}${tgUser.last_name ? ` ${tgUser.last_name}` : ""}`.trim() || tgUser.username || "User",
          username: tgUser.username || "",
          photo_url: tgUser.photo_url || null,
          role: isBootstrapAdmin ? "admin" : "user",
          plan: isBootstrapAdmin ? "admin" : "free",
          credits: isBootstrapAdmin ? 999 : signupCredits,
          last_active: new Date().toISOString(),
        });
        if (insertError) throw insertError;
      }

      if (existing && isBootstrapAdmin && existing.role !== "admin") {
        await supabase.from("users")
          .update({ role: "admin", plan: "admin", last_active: new Date().toISOString() })
          .eq("telegram_id", tgUser.id);
      }

      if (existing && tgUser.photo_url && existing.photo_url !== tgUser.photo_url) {
        await supabase.from("users")
          .update({ photo_url: tgUser.photo_url, last_active: new Date().toISOString() })
          .eq("telegram_id", tgUser.id);
      }

      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", tgUser.id)
        .single();
      if (userError || !user) return c.json({ error: "User profile not found" }, 404);

      return c.json({
        user: {
          ...user,
          phone: user.phone || null,
          role: isBootstrapAdmin ? "admin" : (user.role || "user")
        }
      });
    } catch (e: any) {
      console.error("Auth profile error:", e?.message || e);
      return c.json({ error: "Failed to fetch authenticated profile" }, 500);
    }
  });

  app.post("/api/auth/request-signup", async (c) => {
    // Validate Telegram Init Data
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const authUser = initData ? getTelegramUserFromInitData(initData) : null;
      const telegramId = authUser?.id || Number(body?.telegramId || 0);
      if (!bot || !telegramId) return c.json({ error: "Missing bot or telegramId" }, 400);

      const signupUrl = buildSignupUrl(telegramId);
      try {
        await bot.telegram.sendMessage(telegramId, signupContactMessage, signupContactKeyboard);
        return c.json({ success: true, signupUrl });
      } catch (sendError: any) {
        // Telegram cannot DM users who have not started the bot yet. Let the app open
        // the bot with a signup payload so /start can show the contact keyboard.
        console.warn("Signup DM failed; returning bot deep link:", sendError?.message || sendError);
        return c.json({ success: true, signupUrl, requiresBotStart: true });
      }
    } catch (e: any) {
      console.error("Request signup error:", e.message);
      return c.json({ error: "Failed to prepare signup request", signupUrl: buildSignupUrl() }, 500);
    }
  });

  app.get("/api/user/activities", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const { data, error } = await supabase
        .from("usage_logs")
        .select("id, endpoint, method, status, created_at")
        .eq("telegram_id", tgUser.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        // Graceful fallback from analysis history when usage_logs is unavailable.
        const history = await getUserHistory(tgUser.id);
        const fallbackActivities = (history || []).slice(0, 20).map((item) => ({
          id: item.id,
          endpoint: "/api/analyze",
          method: "POST",
          status: item.status === "pending" ? 202 : 200,
          created_at: item.created_at,
        }));
        return c.json(fallbackActivities);
      }

      const activities = (data || []).map((item: any) => ({
        id: item.id,
        endpoint: item.endpoint,
        method: item.method,
        status: item.status,
        created_at: item.created_at,
      }));

      return c.json(activities);
    } catch (e: any) {
      console.error("Activities API error:", e?.message || e);
      return c.json([], 500);
    }
  });

  app.get("/api/user/history", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const history = await getUserHistory(tgUser.id);

      // Resolving hits external APIs. Bound both the number of items per
      // request and the outbound concurrency so one client cannot fan out
      // hundreds of requests.
      // Oldest pending first so abandoned rows keep settling instead of being
      // permanently starved by newer predictions.
      const pendingItems = history
        .filter((item) => item.status === "pending")
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, 20);
      const resolvedPending = await mapWithConcurrency(pendingItems, 3, async (item) => {
        try {
          return await resolveHistoryItemResult(item);
        } catch (error: any) {
          console.warn("History item resolve fallback:", error?.message || error);
          return item;
        }
      });
      const resolvedById = new Map(resolvedPending.map((item) => [item.id, item]));
      const resolved = history.map((item) => resolvedById.get(item.id) || item);

      const changedItems = resolved.filter(
        (item, index) =>
          item.status !== history[index]?.status ||
          item.resolved_at !== history[index]?.resolved_at ||
          (item.outcome && !history[index]?.outcome),
      );
      await Promise.all(
        changedItems.map((item) =>
          updateHistoryItem(tgUser.id, {
            id: item.id,
            status: item.status,
            resolved_at: item.resolved_at,
            outcome: item.outcome || undefined,
          }).catch((error) => console.error("Failed to update history item:", error?.message || error)),
        ),
      );

      return c.json(resolved);
    } catch (e: any) {
      console.error("History API error:", e?.message || e);
      return c.json([], 500);
    }
  });

  app.get("/api/user/referral", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const [{ count: referredCount }, { data: referrers }, { data: rewardedReferrals }] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }).eq("referrer_id", tgUser.id),
        supabase.from("users").select("telegram_id").eq("referrer_id", tgUser.id),
        supabase
          .from("referrals")
          .select("reward_amount")
          .eq("referrer_telegram_id", tgUser.id)
          .eq("reward_given", true),
      ]);

      const totalReferred = referredCount || 0;
      const earnedCredits = (rewardedReferrals || []).reduce((total: number, referral: any) => {
        const rewardAmount = Number(referral?.reward_amount || 0);
        return total + (Number.isFinite(rewardAmount) ? rewardAmount : 0);
      }, 0);
      const referralLink = `https://t.me/${botUsername}?start=${tgUser.id}`;

      return c.json({
        totalReferred,
        earnedCredits,
        referralLink,
        referredUsers: referrers || [],
      });
    } catch (e: any) {
      console.error("Referral API error:", e?.message || e);
      return c.json({ totalReferred: 0, earnedCredits: 0, referralLink: `https://t.me/${botUsername}` }, 500);
    }
  });

  app.put("/api/user/profile", async (c) => {
    // Identity may ONLY come from validated initData. Never trust a body ID.
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const name = String(body?.name || "").trim().slice(0, 120);
      const username = String(body?.username || "").trim().slice(0, 64);
      let photo_url = body?.photo_url ? String(body.photo_url).trim().slice(0, 2048) : null;
      if (photo_url && !/^https?:\/\//i.test(photo_url)) photo_url = null;
      if (!name) return c.json({ error: "Name is required" }, 400);

      const { data, error } = await supabase
        .from("users")
        .update({ name, username, photo_url, last_active: new Date().toISOString() })
        .eq("telegram_id", tgUser.id)
        .select("id,telegram_id,name,username,phone,credits,plan,role,photo_url")
        .maybeSingle();

      if (error) throw error;
      if (!data) return c.json({ error: "User profile not found" }, 404);
      return c.json({ user: data });
    } catch (e: any) {
      console.error("Profile update error:", e?.message || e);
      return c.json({ error: "Failed to update profile" }, 500);
    }
  });

  app.post("/api/user/report", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const body = await c.req.json().catch(() => ({} as any));
      const subject = String(body?.subject || "").trim().slice(0, 200);
      const details = String(body?.details || "").trim().slice(0, 5000);
      const rawCategory = String(body?.category || "general").trim().toLowerCase();
      const allowedCategories = new Set(["general", "bug", "payment", "account", "prediction", "other"]);
      const category = allowedCategories.has(rawCategory) ? rawCategory : "general";

      if (!subject || !details) {
        return c.json({ error: "Subject and details are required." }, 400);
      }

      const { data: user } = await supabase
        .from("users")
        .select("name,username")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();

      const payload = {
        telegram_id: tgUser.id,
        name: user?.name || `${tgUser.first_name || ""}${tgUser.last_name ? ` ${tgUser.last_name}` : ""}`.trim() || "User",
        username: user?.username || tgUser.username || "",
        category,
        subject,
        details,
        status: "open",
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("reports").insert(payload);
      if (error) throw error;

      return c.json({ success: true });
    } catch (e: any) {
      console.error("User report submit error:", e?.message || e);
      return c.json({ error: "Failed to submit report" }, 500);
    }
  });

  // Create Stars Invoice Endpoint
  app.post("/api/payments/create-stars-invoice", async (c) => {
    // Validate Telegram Init Data
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, planId, title, description } = await c.req.json();
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      const effectiveTelegramId = tgUser?.id || Number(telegramId || 0);
      const normalizedPlanId = String(planId || "").trim();
      const expectedAmount = getExpectedStarsAmount(normalizedPlanId);

      if (!bot || !effectiveTelegramId || !normalizedPlanId || !expectedAmount) {
        return c.json({ error: "Missing required parameters" }, 400);
      }
      if (tgUser?.id && Number(telegramId || 0) && tgUser.id !== Number(telegramId || 0)) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }

      // Create Stars Invoice Link
      // Currency for Telegram Stars is 'XTR'
      const invoiceLink = await bot.telegram.createInvoiceLink({
        title: title || `Flash AI - ${normalizedPlanId.toUpperCase()} Plan`,
        description: description || `Access to premium football predictions and analyses.`,
        payload: `plan:${normalizedPlanId}`,
        provider_token: "", // Empty for Telegram Stars
        currency: "XTR",
        prices: [{ label: "Stars", amount: expectedAmount }],
      });

      return c.json({ invoiceLink, amount: expectedAmount });
    } catch (e: any) {
      console.error("Create invoice error:", e.message);
      return c.json({ error: "Failed to create invoice link" }, 500);
    }
  });

  // Whop card checkout. The client falls back to Lemon Squeezy when Whop is
  // not configured, so deployments can switch card providers with env vars.
  app.post("/api/payments/create-whop-checkout", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const planId = String(body?.planId || "").trim();
      const bodyTelegramId = Number(body?.telegramId || 0);
      if (bodyTelegramId && bodyTelegramId !== tgUser.id) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }
      if (!PAID_PLANS.has(planId)) {
        return c.json({ error: "Unsupported plan" }, 400);
      }

      const { checkoutUrl } = await createWhopCheckout(tgUser.id, planId);
      return c.json({ checkoutUrl, provider: "whop" });
    } catch (e: any) {
      if (e?.code === "WHOP_NOT_CONFIGURED") {
        return c.json({ error: "Card checkout is coming soon.", code: "WHOP_NOT_CONFIGURED" }, 503);
      }
      if (e?.code === "WHOP_PLAN_NOT_CONFIGURED") {
        return c.json(
          { error: "This plan is not available for card checkout.", code: "WHOP_PLAN_NOT_CONFIGURED" },
          503,
        );
      }
      console.error("Whop checkout error:", e?.message || e);
      return c.json({ error: "Failed to create checkout session" }, 500);
    }
  });

  app.get("/api/payments/methods", (c) => {
    return c.json({
      card: WHOP_ENABLED ? "whop" : "lemonsqueezy",
      stars: true,
      ton: true,
    });
  });

  // Lemon Squeezy Checkout Endpoint
  app.post("/api/payments/create-lemonsqueezy-checkout", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const planId = String(body?.planId || "").trim();
      const planName = String(body?.planName || "").trim().slice(0, 100);
      const bodyTelegramId = Number(body?.telegramId || 0);

      if (bodyTelegramId && bodyTelegramId !== tgUser.id) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }
      if (!PAID_PLANS.has(planId)) {
        return c.json({ error: "Unsupported plan" }, 400);
      }

      // Map plan IDs to Lemon Squeezy variant IDs
      const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
      const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY;

      if (!LEMONSQUEEZY_STORE_ID || !LEMONSQUEEZY_API_KEY) {
        return c.json({
          error: "Lemon Squeezy checkout is coming soon.",
          code: "LEMONSQUEEZY_COMING_SOON",
        }, 503);
      }

      const VARIANT_MAP: Record<string, string> = {
        monthly_basic: process.env.LEMONSQUEEZY_VARIANT_MONTHLY_BASIC || "",
        monthly_pro: process.env.LEMONSQUEEZY_VARIANT_MONTHLY_PRO || "",
      };

      const variantId = VARIANT_MAP[planId];
      if (!variantId) {
        console.error(`Lemon Squeezy variant is not configured for plan ${planId}`);
        return c.json({ error: "This plan is not available for card checkout." }, 503);
      }

      // Create Lemon Squeezy checkout
      const response = await fetch(`https://api.lemonsqueezy.com/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LEMONSQUEEZY_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              product_options: {
                redirect_url: process.env.LEMONSQUEEZY_REDIRECT_URL || process.env.APP_URL || DEFAULT_APP_URL,
                receipt_button_text: 'Back to Flash AI',
                receipt_link_url: process.env.APP_URL || DEFAULT_APP_URL,
              },
              checkout_data: {
                name: planName ? `Flash AI — ${planName}` : undefined,
                custom: {
                  telegram_id: String(tgUser.id),
                  plan_id: planId,
                },
              },
            },
            relationships: {
              store: {
                data: {
                  type: 'stores',
                  id: LEMONSQUEEZY_STORE_ID,
                },
              },
              variant: {
                data: {
                  type: 'variants',
                  id: variantId,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create Lemon Squeezy checkout');
      }

      const result = await response.json();
      const checkoutUrl = result.data?.attributes?.url;

      if (!checkoutUrl) {
        throw new Error('No checkout URL returned from Lemon Squeezy');
      }

      return c.json({ checkoutUrl });
    } catch (e: any) {
      console.error("Lemon Squeezy checkout error:", e.message);
      return c.json({ error: "Failed to create checkout session" }, 500);
    }
  });

  // Task Claim Endpoint
  app.post("/api/tasks/claim", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      const { telegramId, taskId } = await c.req.json();
      const normalizedTelegramId = Number(telegramId || 0);
      const normalizedTaskId = String(taskId || "").trim();

      if (!tgUser?.id || !normalizedTelegramId || !normalizedTaskId) {
        return c.json({ error: "Missing required parameters" }, 400);
      }
      if (tgUser.id !== normalizedTelegramId) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }

      // 1. Perform verification for specific tasks
      const { data: taskData } = await supabase
        .from('tasks')
        .select('id,reward,url,active,title')
        .eq('id', normalizedTaskId)
        .maybeSingle();
      if (!taskData || taskData.active === false) {
        return c.json({ error: "Task not found or inactive" }, 404);
      }
      const taskReward = Math.max(0, Math.floor(Number(taskData.reward || 0)));
      
      if (taskData && bot) {
        const channelUsername = extractTelegramChannelFromTaskUrl(taskData.url || '');

        if (channelUsername) {
          try {
            const member = await bot.telegram.getChatMember(channelUsername, normalizedTelegramId);
            const validStatuses = ['member', 'administrator', 'creator'];

            if (!validStatuses.includes(member.status)) {
              return c.json({
                error: `Please join ${channelUsername} before claiming this reward.`,
                code: 'NOT_JOINED_CHANNEL',
              }, 400);
            }
          } catch (e: any) {
            console.error(`Task verification error for ${channelUsername}:`, e.message);
            const msg = String(e?.message || '').toLowerCase();
            if (msg.includes('member not found') || msg.includes('user not found') || msg.includes('participant not found')) {
              return c.json({ error: `Please join ${channelUsername} before claiming this reward.`, code: 'NOT_JOINED_CHANNEL' }, 400);
            }
            return c.json({
              error: `Unable to verify channel membership for ${channelUsername}. Ask admin to add the Flash AI bot as channel admin and retry.`,
              code: 'CHANNEL_VERIFICATION_UNAVAILABLE',
            }, 400);
          }
        }
      }

      // 3. Atomically claim the task. The UNIQUE(telegram_id, task_id)
      // constraint guarantees a task can only ever be rewarded once, even if
      // two requests race past the verification step.
      const { error: logError } = await supabase.from('user_tasks').insert({
        telegram_id: normalizedTelegramId,
        task_id: normalizedTaskId,
        completed_at: new Date().toISOString()
      });

      if (logError) {
        if (logError.code === '23505') {
          return c.json({ error: "Task already completed" }, 409);
        }
        throw logError;
      }

      const { error: creditError } = await supabase.rpc('add_credits_to_user', {
        user_telegram_id: normalizedTelegramId,
        credits_amount: taskReward,
      });
      if (creditError) {
        // Release the claim so the user can retry without losing the reward.
        await supabase
          .from('user_tasks')
          .delete()
          .eq('telegram_id', normalizedTelegramId)
          .eq('task_id', normalizedTaskId);
        throw creditError;
      }

      const { data: user } = await supabase
        .from('users')
        .select('credits')
        .eq('telegram_id', normalizedTelegramId)
        .single();

      return c.json({ success: true, newCredits: user?.credits ?? null, rewardedCredits: taskReward });
    } catch (e: any) {
      console.error("Task claim error:", e.message);
      return c.json({ error: "Failed to claim task reward" }, 500);
    }
  });


  app.post("/api/user/wallet", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const { address, chain, walletName } = await c.req.json().catch(() => ({} as any));
      const normalizedAddress = String(address || '').trim();
      if (!normalizedAddress) {
        return c.json({ error: "Wallet address is required" }, 400);
      }
      if (
        normalizedAddress.length < 10 ||
        normalizedAddress.length > 128 ||
        !/^[A-Za-z0-9_\-:]+$/.test(normalizedAddress)
      ) {
        return c.json({ error: "Invalid wallet address" }, 400);
      }

      // Keep the wallet list bounded so a user cannot grow it without limit.
      const { data: existingWallets } = await supabase
        .from("user_wallets")
        .select("wallet_address")
        .eq("telegram_id", tgUser.id)
        .order("updated_at", { ascending: true });
      const wallets = existingWallets || [];
      const isKnown = wallets.some((w: any) => w.wallet_address === normalizedAddress);
      if (!isKnown && wallets.length >= 10) {
        const stale = wallets.slice(0, wallets.length - 9).map((w: any) => w.wallet_address);
        if (stale.length) {
          await supabase
            .from("user_wallets")
            .delete()
            .eq("telegram_id", tgUser.id)
            .in("wallet_address", stale);
        }
      }

      const payload = {
        telegram_id: tgUser.id,
        wallet_address: normalizedAddress,
        chain: String(chain || '').trim().slice(0, 32) || null,
        wallet_name: String(walletName || '').trim().slice(0, 64) || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('user_wallets')
        .upsert(payload, { onConflict: 'telegram_id,wallet_address' });

      if (error) {
        console.error('Failed to persist wallet:', error.message);
        return c.json({ error: 'Failed to store wallet' }, 500);
      }

      // Deactivate other wallets for this user (single active wallet policy)
      await supabase
        .from('user_wallets')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('telegram_id', tgUser.id)
        .neq('wallet_address', normalizedAddress)
        .eq('is_active', true);

      return c.json({ success: true });
    } catch (e: any) {
      console.error('Wallet save API error:', e.message);
      return c.json({ error: 'Failed to store wallet' }, 500);
    }
  });

  app.get("/api/support/faqs", async (c) => {
    try {
      const { data, error } = await supabase
        .from("faqs")
        .select("*");

      if (error) throw error;
      return c.json(data && data.length > 0 ? data : getDefaultFaqs());
    } catch (e: any) {
      console.error("Support FAQ fetch error:", e?.message || e);
      return c.json(getDefaultFaqs());
    }
  });

  app.post("/api/support/chat", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    const tgUserForRateLimit = initData ? getTelegramUserFromInitData(initData) : null;
    const rateIdentifier = `support-chat:${tgUserForRateLimit?.id || getRequestIp(c)}`;
    if (isRateLimited(rateIdentifier)) {
      return c.json({ error: "Too many support requests. Please try again shortly." }, 429);
    }

    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many support requests. Please try again shortly." }, 429);
    }

    try {
      const body = await c.req.json();
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      const history = Array.isArray(body?.history) ? body.history : [];
      const faqs = Array.isArray(body?.faqs) ? body.faqs : getDefaultFaqs();

      if (!message) {
        return c.json({ error: "Message is required." }, 400);
      }

      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified." }, 401);
      const { data: user } = await supabase
        .from("users")
        .select("plan")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      const plan = user?.plan || "free";
      if (plan === "free") {
        return c.json({ error: "AI chat is available on paid plans. Please upgrade to continue." }, 403);
      }

      const reply = await generateSupportReply(message, history, faqs);
      return c.json({ reply });
    } catch (e: any) {
      console.error("Support chat error:", e?.message || e);
      return c.json(
        { reply: "I'm having trouble responding right now. Please try again in a moment." },
        500
      );
    }
  });

  // ── Analyst chat (multi-turn, match-aware) ────────────────────────────────
  app.post("/api/analyze/chat", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    const tgUserForRateLimit = initData ? getTelegramUserFromInitData(initData) : null;
    const rateIdentifier = `analyze-chat:${tgUserForRateLimit?.id || getRequestIp(c)}`;
    if (isRateLimited(rateIdentifier)) {
      return c.json({ error: "Too many chat requests. Please wait a moment." }, 429);
    }
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
    if (guardExpensiveEndpoint(c)) {
      return c.json({ error: "Too many chat requests. Please wait a moment." }, 429);
    }

    try {
      const body = await c.req.json();
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      const history = Array.isArray(body?.history) ? body.history : [];
      const matchId = typeof body?.matchId === "string" ? body.matchId : "";
      const matchString = typeof body?.matchString === "string" ? body.matchString.slice(0, 200) : "";

      if (!message || message.length > 2000) {
        return c.json({ error: "Message is required." }, 400);
      }

      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified." }, 401);
      const { data: user } = await supabase
        .from("users")
        .select("plan, phone")
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      if (!user?.phone) {
        return c.json({ error: "Complete signup first by sharing your contact." }, 403);
      }
      const plan = user?.plan || "free";
      if (plan === "free") {
        return c.json({ error: "AI chat is available on paid plans. Please upgrade to continue." }, 403);
      }

      let matchContext = matchString ? `Match: ${matchString}` : "";
      try {
        if (matchId && (/^bsd_\d+$/.test(matchId) || /^\d+$/.test(matchId))) {
          const preview = await getLiveMatchPreview(matchId);
          if (preview) {
            matchContext += [
              `League: ${preview?.league?.name || "n/a"}`,
              `Teams: ${preview?.teams?.home?.name} vs ${preview?.teams?.away?.name}`,
              `Kickoff: ${preview?.fixture?.date}`,
              `Status: ${preview?.fixture?.status?.short}`,
              preview?.goals?.home !== null && preview?.goals?.home !== undefined
                ? `Score: ${preview.goals.home}-${preview.goals.away}`
                : "",
              preview?.odds
                ? `Odds: 1=${preview.odds.home ?? "-"} X=${preview.odds.draw ?? "-"} 2=${preview.odds.away ?? "-"}; O2.5=${preview.odds.over25 ?? "-"} U2.5=${preview.odds.under25 ?? "-"}; BTTS Y=${preview.odds.bttsYes ?? "-"}`
                : "",
            ].filter(Boolean).join("\n");
          }
        }
      } catch {
        // Chat still works without match context.
      }

      const { chatWithAnalyst } = await import("./services/analysisChatService.js");
      const reply = await chatWithAnalyst({ message, history, matchContext });
      return c.json({ reply });
    } catch (e: any) {
      console.error("Analyst chat error:", e?.message || e);
      return c.json(
        { reply: "I'm having trouble responding right now. Please try again in a moment." },
        500
      );
    }
  });

  // ── TON payments ───────────────────────────────────────────────────────────
  // Security model:
  //   1. The server creates a single-use intent with a unique nanoton amount.
  //   2. The client pays that exact amount to the server-configured receiver.
  //   3. Verification only accepts a transaction whose sender is one of the
  //      authenticated user's saved wallets, whose value matches the intent
  //      exactly, and which happened after the intent was created.
  //   4. The tx hash is reserved atomically before the plan is granted.
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const tonAddressToRaw = (address: string): string | null => {
    const value = String(address || "").trim();
    if (!value) return null;
    const rawMatch = value.match(/^(-?\d+):([0-9a-fA-F]{64})$/);
    if (rawMatch) return `${rawMatch[1]}:${rawMatch[2].toLowerCase()}`;
    try {
      const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(base64, "base64");
      if (decoded.length !== 36) return null;
      const workchain = decoded.readInt8(1);
      const hash = decoded.subarray(2, 34).toString("hex");
      return `${workchain}:${hash}`;
    } catch {
      return null;
    }
  };

  app.post("/api/payments/ton/intent", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);

    const tonReceiverAddress = process.env.TON_RECEIVER_ADDRESS;
    const toncenterApiKey = process.env.TONCENTER_API_KEY;
    if (!tonReceiverAddress || !toncenterApiKey || !tonAddressToRaw(tonReceiverAddress)) {
      console.error("TON payments are not configured correctly (receiver/API key).");
      return c.json({ error: "TON payments are not configured." }, 503);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const planId = String(body?.planId || "").trim();
      if (!PAID_PLANS.has(planId)) {
        return c.json({ error: "Unsupported plan" }, 400);
      }

      const tonPerUsdRate = await getTonPerUsdRate();
      const tonAmount = getExpectedTonAmount(planId, tonPerUsdRate);
      if (!tonAmount) {
        return c.json({ error: "Unsupported plan for TON payment" }, 400);
      }

      // Unique nanoton suffix binds the on-chain transfer to this intent.
      const baseNano = BigInt(Math.round(tonAmount * 1e9));
      const nonce = BigInt(Math.floor(Math.random() * 10_000));
      const amountNano = baseNano + nonce;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Opportunistically discard this user's stale intents.
      await supabase
        .from("payment_intents")
        .delete()
        .eq("telegram_id", tgUser.id)
        .eq("status", "open")
        .lt("expires_at", new Date().toISOString());

      const { data: intent, error } = await supabase
        .from("payment_intents")
        .insert({
          telegram_id: tgUser.id,
          plan_id: planId,
          amount_nano: amountNano.toString(),
          receiver: tonReceiverAddress,
          status: "open",
          expires_at: expiresAt,
        })
        .select("id,amount_nano,receiver,expires_at")
        .single();

      if (error) throw error;

      return c.json({
        intentId: intent.id,
        amountNano: String(intent.amount_nano),
        receiver: intent.receiver,
        expiresAt: intent.expires_at,
      });
    } catch (e: any) {
      console.error("TON intent error:", e.message);
      return c.json({ error: "Failed to create a TON payment intent" }, 500);
    }
  });

  app.post("/api/payments/verify-ton-payment", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);

    const toncenterApiKey = process.env.TONCENTER_API_KEY;
    if (!toncenterApiKey) {
      return c.json({ error: "TON payments are not configured." }, 503);
    }

    let intent: any = null;
    try {
      const body = await c.req.json().catch(() => ({} as any));
      const intentId = String(body?.intentId || "").trim();
      if (!intentId) return c.json({ error: "intentId is required" }, 400);

      const { data, error } = await supabase
        .from("payment_intents")
        .select("id,telegram_id,plan_id,amount_nano,receiver,status,created_at,expires_at")
        .eq("id", intentId)
        .eq("telegram_id", tgUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return c.json({ error: "Payment intent not found" }, 404);
      intent = data;

      if (intent.status !== "open") {
        return c.json({ error: "Payment intent is no longer open" }, 409);
      }
      if (new Date(intent.expires_at).getTime() < Date.now()) {
        return c.json({ error: "Payment intent expired. Please start over." }, 400);
      }
      if (!PAID_PLANS.has(intent.plan_id)) {
        return c.json({ error: "Invalid plan for this intent" }, 400);
      }

      const { data: wallets } = await supabase
        .from("user_wallets")
        .select("wallet_address")
        .eq("telegram_id", tgUser.id)
        .eq("is_active", true);

      const allowedSources = new Set(
        (wallets || [])
          .map((wallet: any) => tonAddressToRaw(wallet.wallet_address))
          .filter((value: string | null): value is string => Boolean(value)),
      );
      if (allowedSources.size === 0) {
        return c.json(
          {
            error: "Connect your TON wallet before paying.",
            code: "WALLET_REQUIRED",
          },
          400,
        );
      }

      const expectedValue = BigInt(String(intent.amount_nano));
      const receiverRaw = tonAddressToRaw(String(intent.receiver || ""));
      const notBefore = Math.floor(new Date(intent.created_at).getTime() / 1000) - 120;

      let matched: { hash: string; value: bigint } | null = null;
      for (let attempt = 0; attempt < 6 && !matched; attempt += 1) {
        if (attempt > 0) await sleep(2500);
        const txLookup = await axios.get("https://toncenter.com/api/v2/getTransactions", {
          params: { address: intent.receiver, limit: 100 },
          headers: { "X-API-Key": toncenterApiKey },
          timeout: 12_000,
        });
        const chainTransactions = Array.isArray(txLookup?.data?.result) ? txLookup.data.result : [];
        for (const chainTx of chainTransactions) {
          const inMsg = chainTx?.in_msg || {};
          const hash = String(chainTx?.transaction_id?.hash || "");
          const source = tonAddressToRaw(String(inMsg?.source || ""));
          const utime = Number(chainTx?.utime || 0);
          if (!hash || !source || !allowedSources.has(source)) continue;
          if (utime < notBefore) continue;
          let value: bigint;
          try {
            value = BigInt(String(inMsg?.value || 0));
          } catch {
            continue;
          }
          if (value !== expectedValue) continue;
          const destinationRaw = tonAddressToRaw(String(inMsg?.destination || ""));
          if (receiverRaw && destinationRaw && destinationRaw !== receiverRaw) continue;
          // The payment comment must reference this exact intent. This proves
          // the payer saw this intent and prevents claiming another user's
          // matching transfer by registering the sender's address.
          if (extractTonComment(inMsg?.message) !== intent.id) continue;
          matched = { hash, value };
          break;
        }
      }

      if (!matched) {
        return c.json(
          { error: "Payment not found on-chain yet. Wait a few seconds and retry.", code: "NOT_FOUND" },
          400,
        );
      }

      // Reserve the hash globally before granting anything.
      const { error: reserveError } = await supabase.from("processed_transactions").insert({
        tx_hash: matched.hash,
        telegram_id: tgUser.id,
        plan_id: intent.plan_id,
        provider: "ton",
        processed_at: new Date().toISOString(),
      });
      if (reserveError) {
        if (reserveError.code === "23505") {
          return c.json({ error: "Transaction already processed" }, 409);
        }
        throw reserveError;
      }

      // Atomically claim this intent.
      const { data: claimedIntent, error: claimError } = await supabase
        .from("payment_intents")
        .update({ status: "paid", tx_hash: matched.hash, paid_at: new Date().toISOString() })
        .eq("id", intent.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (claimError || !claimedIntent) {
        await supabase.from("processed_transactions").delete().eq("tx_hash", matched.hash);
        if (claimError) throw claimError;
        return c.json({ error: "Payment intent already used" }, 409);
      }

      const tonAmount = Number(matched.value) / 1e9;
      try {
        const { error: txError } = await supabase.from("transactions").insert({
          telegram_id: tgUser.id,
          amount: tonAmount,
          currency: "TON",
          status: "completed",
          provider_payment_charge_id: matched.hash,
          type: "ton",
        });
        if (txError && txError.code !== "23505") throw txError;

        await applyPlanCredits(tgUser.id, intent.plan_id);
      } catch (processingError) {
        // Roll back the intent + reservation so the user can retry safely.
        await supabase
          .from("payment_intents")
          .update({ status: "open", tx_hash: null, paid_at: null })
          .eq("id", intent.id);
        await supabase.from("processed_transactions").delete().eq("tx_hash", matched.hash);
        throw processingError;
      }

      if (bot) {
        bot.telegram
          .sendMessage(tgUser.id, `✅ TON payment received! Your account is now on ${intent.plan_id.toUpperCase()} plan.`)
          .catch(() => undefined);
      }

      return c.json({ success: true });
    } catch (e: any) {
      console.error("TON verification error:", e.message);
      return c.json({ error: "Failed to process TON payment" }, 500);
    }
  });

  // --- ADMIN API ENDPOINTS ---

  // Admin Verification Middleware
  const adminOnly = async (c: any, next: any) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Unauthorized: Invalid Telegram Data" }, 401);
    }
    
    const tgUser = getTelegramUserFromInitData(initData);
    if (!tgUser) return c.json({ error: "Unauthorized: No User" }, 401);

    const { data: user } = await supabase
      .from("users")
      .select("role")
      .eq("telegram_id", tgUser.id)
      .single();

    const isBootstrapAdmin = bootstrapAdminId && tgUser.id === bootstrapAdminId;
    if (!isBootstrapAdmin && (!user || user.role !== "admin")) {
      return c.json({ error: "Forbidden: Admins Only" }, 403);
    }

    return await next();
  };

  app.get("/api/admin/ai/status", adminOnly, async (c) => {
    const { getGeminiKeyStatus: readGeminiStatus } = await import("./services/apiCacheService.js");
    return c.json({
      gemini: readGeminiStatus(),
      channelAgent: channelAgent?.getStatus() || null,
    });
  });

  // Dashboard Stats
  app.get("/api/admin/dashboard", adminOnly, async (c) => {
    try {
      const [
        { count: userCount },
        { count: subCount },
        { count: txCount },
        { data: recentTxs }
      ] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("users").select("*", { count: "exact", head: true }).neq("plan", "free"),
        supabase.from("transactions").select("*", { count: "exact", head: true }),
        supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(5)
      ]);

      return c.json({
        stats: {
          totalUsers: userCount || 0,
          subscribers: subCount || 0,
          totalTransactions: txCount || 0,
          engagement: "High" 
        },
        recentTransactions: recentTxs || []
      });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Analytics Data
  app.get("/api/admin/analytics", adminOnly, async (c) => {
    try {
      const last7Days = new Date();
      last7Days.setDate(last7Days.getDate() - 7);

      const { data: usage } = await supabase
        .from("usage_logs")
        .select("*")
        .gte("created_at", last7Days.toISOString());

      const trafficByDay = usage?.reduce((acc: any, log: any) => {
        const date = log.created_at.split("T")[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {});

      const chartData = Object.entries(trafficByDay || {}).map(([name, value]) => ({ name, value }));

      return c.json({
        traffic: chartData,
        patterns: [
          { label: "Home", value: usage?.filter(l => l.endpoint === "/").length || 0 },
          { label: "Analyze", value: usage?.filter(l => l.endpoint === "/api/analyze").length || 0 },
          { label: "Profile", value: usage?.filter(l => l.endpoint.includes("profile")).length || 0 }
        ]
      });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Task Management
  app.get("/api/admin/tasks", adminOnly, async (c) => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return c.json({ error: "Failed to load tasks" }, 500);
    return c.json(data || []);
  });

  app.post("/api/admin/tasks", adminOnly, async (c) => {
    const body = await c.req.json();

    const task = {
      id: crypto.randomUUID(),
      title: String(body.title || "").trim(),
      description: String(body.description || "").trim(),
      reward: Number(body.reward || 10),
      channel_username: String(body.channel_username || "").trim(),
      url: String(body.url || "").trim(),
      buttonLabel: String(body.buttonLabel || "Claim").trim(),
      image_url: String(body.image_url || "").trim(),
      active: body.active !== false,
      created_at: new Date().toISOString(),
    };

    if (!task.title || !task.description) return c.json({ error: "Title and description are required" }, 400);
    if (task.channel_username && !/^@?[a-zA-Z0-9_]{5,}$/.test(task.channel_username)) {
      return c.json({ error: "Invalid Telegram channel username format" }, 400);
    }
    if (task.channel_username) {
      const normalized = task.channel_username.startsWith('@') ? task.channel_username.slice(1) : task.channel_username;
      task.url = `https://t.me/${normalized}`;
    }

    try {
      const { data: inserted, error: dbError } = await supabase
        .from("tasks")
        .insert({
          id: task.id,
          title: task.title,
          description: task.description,
          reward: task.reward,
          url: task.url || null,
          button_label: task.buttonLabel,
          image_url: task.image_url || null,
          active: task.active,
        })
        .select()
        .single();

      if (dbError) {
        console.error("DB insert failed for tasks:", dbError);
        return c.json({ error: "Failed to create task" }, 500);
      }

      return c.json(inserted);
    } catch (error: any) {
      console.error("Task creation error:", error?.message || error);
      return c.json({ error: "Failed to create task" }, 500);
    }
  });

  app.delete("/api/admin/tasks/:id", adminOnly, async (c) => {
    const id = c.req.param("id");
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return c.json({ error: "Failed to delete task" }, 500);
    return c.json({ success: true });
  });

  // Ad Management
  app.get("/api/admin/ads", adminOnly, async (c) => {
    // Always read from DB — never trust the cache for admin display.
    // The cache can be stale, empty, or missing styling columns.
    const { data, error } = await supabase
      .from("ads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Failed to fetch ads from DB:", error.message);
      return c.json({ error: "Failed to fetch ads" }, 500);
    }

    const ads = (data || []).map((ad: any) => {
      const link = String(ad?.link || "");
      const derivedInternal = link.startsWith("internal:");
      const derivedTarget = derivedInternal ? link.replace(/^internal:/, "") : null;
      return {
        ...ad,
        is_internal: ad?.is_internal ?? derivedInternal,
        internal_target: ad?.internal_target ?? derivedTarget,
      };
    });

    return c.json(ads);
  });

  app.post("/api/admin/ads", adminOnly, async (c) => {
    const body = await c.req.json();
    const ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    const isInternal = body.is_internal === true;
    const internalTarget = String(body.internal_target || "").trim().toLowerCase();
    const externalLink = String(body.link || "").trim();
    const normalizedLink = isInternal
      ? (internalTarget ? `internal:${internalTarget}` : "")
      : externalLink;
    if (isInternal && !internalTarget) return c.json({ error: "Internal redirect target is required" }, 400);
    if (!isInternal && !externalLink) return c.json({ error: "External redirect URL is required" }, 400);

    const parsedExpiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (parsedExpiresAt && Number.isNaN(parsedExpiresAt.getTime())) {
      return c.json({ error: "Invalid expiration date" }, 400);
    }

    const ad = {
      id: crypto.randomUUID(),
      title: String(body.title || "").trim(),
      subtitle: String(body.subtitle || "").trim(),
      image_url: String(body.image_url || "").trim(),
      link: normalizedLink,
      is_internal: isInternal,
      internal_target: isInternal ? internalTarget : null,
      cta: String(body.cta ?? "Check Out").trim(),
      active: body.active !== false,
      target_group: normalizeAudience(body.target_group ?? body.target_plan ?? "all"),
      expires_at: parsedExpiresAt ? parsedExpiresAt.toISOString() : null,
      primary_color: String(body.primary_color || "#3b82f6"),
      gradient_to: String(body.gradient_to ?? "#8b5cf6"),
      hero_color: String(body.hero_color ?? "#ffffff"),
      sub_color: String(body.sub_color ?? "#e4e4e7"),
      button_color: String(body.button_color ?? "#ffffff"),
      button_text_color: String(body.button_text_color ?? "#111827"),
      hero_size: body.hero_size ?? 32,
      sub_size: body.sub_size ?? 18,
      button_text_size: body.button_text_size ?? 14,
      button_radius: body.button_radius ?? 999,
      button_pad_x: body.button_pad_x ?? 20,
      button_pad_y: body.button_pad_y ?? 8,
      created_at: new Date().toISOString(),
      views: 0,
      clicks: 0,
    };

    if (!ad.title || !ad.subtitle) return c.json({ error: "Ad title and subtitle are required" }, 400);

    try {
      const { data: inserted, error: dbError } = await supabase.from("ads").insert({
        title: ad.title,
        subtitle: ad.subtitle,
        image_url: ad.image_url || null,
        link: ad.link,
        is_internal: ad.is_internal,
        internal_target: ad.internal_target,
        cta: ad.cta,
        active: ad.active,
        target_group: ad.target_group,
        expires_at: ad.expires_at,
        primary_color: ad.primary_color,
        gradient_to: ad.gradient_to,
        hero_color: ad.hero_color,
        sub_color: ad.sub_color,
        button_color: ad.button_color,
        button_text_color: ad.button_text_color,
        hero_size: ad.hero_size,
        sub_size: ad.sub_size,
        button_text_size: ad.button_text_size,
        button_radius: ad.button_radius,
        button_pad_x: ad.button_pad_x,
        button_pad_y: ad.button_pad_y,
      }).select().single();

      if (dbError) {
        console.error("DB insert failed for ads:", dbError.message);
        return c.json({ error: `Database error: ${dbError.message}` }, 500);
      }

      // Also update the in-memory cache so broadcast can find it immediately
      const existingCache = await getCachedCollection<any>(ADMIN_ADS_KEY);
      await setCachedCollection(ADMIN_ADS_KEY, [inserted || ad, ...existingCache]);

      return c.json(inserted || ad);
    } catch (e: any) {
      console.error("DB insert failed for ads:", e);
      return c.json({ error: e?.message || "Failed to save ad" }, 500);
    }
  });

  app.patch("/api/admin/ads/:id", adminOnly, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as any));
    let ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    if (!ads.length) {
      const { data } = await supabase.from("ads").select("*").order("created_at", { ascending: false }).limit(200);
      ads = data || [];
    }
    const existing = ads.find((a) => String(a.id) === String(id));
    if (!existing) return c.json({ error: "Ad not found" }, 404);

    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return c.json({ error: "Invalid expiration date" }, 400);
    const isInternal = body.is_internal === true;
    const internalTarget = String(body.internal_target || "").trim().toLowerCase();
    const externalLink = String(body.link || "").trim();
    const normalizedLink = body.is_internal === undefined
      ? existing.link
      : (isInternal ? (internalTarget ? `internal:${internalTarget}` : "") : externalLink);
    if (body.is_internal === true && !internalTarget) return c.json({ error: "Internal redirect target is required" }, 400);
    if (body.is_internal === false && !externalLink) return c.json({ error: "External redirect URL is required" }, 400);

    const updated = {
      ...existing,
      title: String(body.title ?? existing.title ?? "").trim(),
      subtitle: String(body.subtitle ?? existing.subtitle ?? "").trim(),
      image_url: String(body.image_url ?? existing.image_url ?? "").trim(),
      link: normalizedLink,
      is_internal: body.is_internal !== undefined ? isInternal : Boolean(existing.is_internal),
      internal_target: body.is_internal !== undefined ? (isInternal ? internalTarget : null) : (existing.internal_target ?? null),
      cta: String(body.cta ?? existing.cta ?? "Check Out").trim(),
      active: body.active !== undefined ? Boolean(body.active) : existing.active !== false,
      target_group: normalizeAudience(body.target_group ?? existing.target_group ?? "all"),
      expires_at: body.expires_at !== undefined ? (expiresAt ? expiresAt.toISOString() : null) : (existing.expires_at ?? null),
      primary_color: String(body.primary_color ?? existing.primary_color ?? "#3b82f6"),
      gradient_to: String(body.gradient_to ?? existing.gradient_to ?? "#8b5cf6"),
      hero_color: String(body.hero_color ?? existing.hero_color ?? "#ffffff"),
      sub_color: String(body.sub_color ?? existing.sub_color ?? "#e4e4e7"),
      button_color: String(body.button_color ?? existing.button_color ?? "#ffffff"),
      button_text_color: String(body.button_text_color ?? existing.button_text_color ?? "#111827"),
      hero_size: body.hero_size ?? existing.hero_size ?? null,
      sub_size: body.sub_size ?? existing.sub_size ?? null,
      button_text_size: body.button_text_size ?? existing.button_text_size ?? null,
      button_radius: body.button_radius ?? existing.button_radius ?? null,
      button_pad_x: body.button_pad_x ?? existing.button_pad_x ?? null,
      button_pad_y: body.button_pad_y ?? existing.button_pad_y ?? null,
    } as any;

    if (!updated.title || !updated.subtitle) return c.json({ error: "Ad title and subtitle are required" }, 400);

    const { error } = await supabase.from("ads").update({
      title: updated.title,
      subtitle: updated.subtitle,
      image_url: updated.image_url || null,
      link: updated.link,
      is_internal: updated.is_internal,
      internal_target: updated.internal_target,
      cta: updated.cta,
      active: updated.active,
      target_group: updated.target_group,
      expires_at: updated.expires_at,
      primary_color: updated.primary_color,
      gradient_to: updated.gradient_to,
      hero_color: updated.hero_color,
      sub_color: updated.sub_color,
      button_color: updated.button_color,
      button_text_color: updated.button_text_color,
      hero_size: updated.hero_size,
      sub_size: updated.sub_size,
      button_text_size: updated.button_text_size,
      button_radius: updated.button_radius,
      button_pad_x: updated.button_pad_x,
      button_pad_y: updated.button_pad_y,
    }).eq("id", id);
    if (error) return c.json({ error: error.message }, 400);

    const refreshed = ads.map((a) => (String(a.id) === String(id) ? updated : a));
    await setCachedCollection(ADMIN_ADS_KEY, refreshed);

    return c.json({ success: true, ad: updated });
  });

  app.post("/api/admin/ads/broadcast", adminOnly, async (c) => {
    const { adId, targetGroup } = await c.req.json();
    if (!adId || !targetGroup) return c.json({ error: "Missing parameters" }, 400);

    try {
      const ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
      const ad = ads.find((a) => a.id === adId);
      if (!ad) return c.json({ error: "Ad not found" }, 404);

      let query = supabase.from("users").select("telegram_id");
      if (targetGroup === 'subscribed') query = query.neq('plan', 'free');
      if (targetGroup === 'unsubscribed') query = query.eq('plan', 'free');
      if (targetGroup === 'monthly_basic') query = query.eq('plan', 'monthly_basic');
      if (targetGroup === 'monthly_pro') query = query.eq('plan', 'monthly_pro');

      const { data: users } = await query.not("telegram_id", "is", null);
      if (!users || !bot) return c.json({ success: true, sentCount: 0 });

      let count = 0;
      for (const user of users) {
        try {
          const message = `*${ad.title}*

${ad.subtitle}`;
          const isExternalLink = typeof ad.link === "string" && /^https?:\/\//i.test(ad.link);
          const keyboard = isExternalLink
            ? Markup.inlineKeyboard([[Markup.button.url(ad.cta || "Check it Out", ad.link)]])
            : undefined;
          if (ad.image_url) {
            await bot.telegram.sendPhoto(user.telegram_id, ad.image_url, { caption: message, parse_mode: 'Markdown', ...keyboard });
          } else {
            await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown', ...keyboard });
          }
          count++;
          if (count % 20 === 0) await new Promise(r => setTimeout(r, 1000));
        } catch {}
      }

      return c.json({ success: true, sentCount: count });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.delete("/api/admin/ads/:id", adminOnly, async (c) => {
    const id = c.req.param("id");
    const ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    await setCachedCollection(ADMIN_ADS_KEY, ads.filter((a) => a.id !== id));
    try {
      const { error } = await supabase.from("ads").delete().eq("id", id);
      if (error) return c.json({ error: error.message }, 400);
    } catch (e: any) {
      return c.json({ error: e?.message || "Delete failed" }, 500);
    }
    return c.json({ success: true });
  });

  // User Admin Promotion
  app.post("/api/admin/users/promote", adminOnly, async (c) => {
    const { telegramId, role } = await c.req.json().catch(() => ({} as any));
    const targetTelegramId = Number(telegramId);
    if (!Number.isSafeInteger(targetTelegramId) || targetTelegramId <= 0 || (role !== "user" && role !== "admin")) {
      return c.json({ error: "Valid telegramId and role (user|admin) are required" }, 400);
    }

    const actingUser = getTelegramUserFromInitData(c.req.header("X-TG-Init-Data") || "");
    if (actingUser?.id === targetTelegramId && role !== "admin") {
      return c.json({ error: "You cannot remove your own admin role" }, 400);
    }

    const { error } = await supabase
      .from("users")
      .update({ role })
      .eq("telegram_id", targetTelegramId);

    if (error) return c.json({ error: error.message }, 400);
    return c.json({ success: true });
  });

  app.post("/api/admin/users/assign-plan", adminOnly, async (c) => {
    const { telegramId, planId } = await c.req.json().catch(() => ({} as any));
    const targetTelegramId = Number(telegramId || 0);
    const targetPlan = String(planId || "").trim();
    const allowedPlans = new Set(["free", "monthly_basic", "monthly_pro", "admin"]);

    if (!targetTelegramId || !allowedPlans.has(targetPlan)) {
      return c.json({ error: "Valid telegramId and planId are required" }, 400);
    }

    try {
      const nowIso = new Date().toISOString();

      if (targetPlan === "monthly_basic" || targetPlan === "monthly_pro") {
        await applyPlanCredits(targetTelegramId, targetPlan);
      } else if (targetPlan === "admin") {
        const { error } = await supabase
          .from("users")
          .update({
            role: "admin",
            plan: "admin",
            credits: 999,
            last_active: nowIso,
            last_credit_reset: nowIso,
          })
          .eq("telegram_id", targetTelegramId);
        if (error) throw error;
      } else {
        const planExpiresAt = targetPlan === "free"
          ? null
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabase
          .from("users")
          .update({
            plan: targetPlan,
            ...(targetPlan === "free" ? { plan_expires_at: null } : { plan_expires_at: planExpiresAt }),
            last_active: nowIso,
            last_credit_reset: nowIso,
          })
          .eq("telegram_id", targetTelegramId);
        if (error) throw error;
      }

      return c.json({ success: true });
    } catch (error: any) {
      const rawMessage = String(error?.message || "");
      if (error?.code === "22P02" && rawMessage.includes("enum user_plan")) {
        return c.json({
          error: "Database plan enum is outdated. Run migration_plan_enum_monthly_tiers.sql to add monthly_basic/monthly_pro."
        }, 500);
      }
      return c.json({ error: error?.message || "Failed to assign plan" }, 500);
    }
  });


  app.post("/api/admin/users/suspend", adminOnly, async (c) => {
    const { telegramId } = await c.req.json().catch(() => ({} as any));
    if (!telegramId) return c.json({ error: "telegramId is required" }, 400);
    const actingUser = getTelegramUserFromInitData(c.req.header("X-TG-Init-Data") || "");
    if (actingUser?.id === Number(telegramId)) {
      return c.json({ error: "You cannot suspend your own account" }, 400);
    }

    try {
      const { error } = await supabase
        .from("users")
        .update({
          is_suspended: true,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", Number(telegramId));

      if (error) throw error;

      if (bot) {
        try {
          await bot.telegram.sendMessage(
            Number(telegramId),
            "Your account has been suspended. Please contact support if you believe this is an error."
          );
        } catch {}
      }

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error?.message || "Failed to suspend user" }, 500);
    }
  });

  app.post("/api/admin/users/unsuspend", adminOnly, async (c) => {
    const { telegramId } = await c.req.json().catch(() => ({} as any));
    if (!telegramId) return c.json({ error: "telegramId is required" }, 400);

    try {
      const { error } = await supabase
        .from("users")
        .update({ is_suspended: false, last_active: new Date().toISOString() })
        .eq("telegram_id", Number(telegramId));

      if (error) throw error;

      if (bot) {
        try {
          await bot.telegram.sendMessage(
            Number(telegramId),
            "Your account has been reinstated. Welcome back to Flash AI!"
          );
        } catch {}
      }

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error?.message || "Failed to unsuspend user" }, 500);
    }
  });

  app.post("/api/admin/users/delete", adminOnly, async (c) => {
    const { telegramId } = await c.req.json().catch(() => ({} as any));
    if (!telegramId) return c.json({ error: "telegramId is required" }, 400);
    const actingUser = getTelegramUserFromInitData(c.req.header("X-TG-Init-Data") || "");
    if (actingUser?.id === Number(telegramId)) {
      return c.json({ error: "You cannot delete your own account" }, 400);
    }

    try {
      const targetId = Number(telegramId);

      // Delete user history
      await supabase.from("user_history").delete().eq("telegram_id", targetId);

      // Delete usage logs
      await supabase.from("usage_logs").delete().eq("telegram_id", targetId);

      // Delete credit transactions
      await supabase.from("credit_transactions").delete().eq("telegram_id", targetId);

      // Delete reports
      await supabase.from("reports").delete().eq("telegram_id", targetId);

      // Delete notification logs
      await supabase.from("notification_logs").delete().eq("telegram_id", targetId);

      // Delete task claims, wallets and payment intents so no orphaned rows
      // keep referencing a deleted user.
      await supabase.from("user_tasks").delete().eq("telegram_id", targetId);
      await supabase.from("user_wallets").delete().eq("telegram_id", targetId);
      await supabase.from("payment_intents").delete().eq("telegram_id", targetId);
      await supabase.from("transactions").delete().eq("telegram_id", targetId);

      // Delete referrals (where user is either referrer or referred)
      await supabase.from("referrals").delete().or(`referrer_telegram_id.eq.${targetId},referred_telegram_id.eq.${targetId}`);

      // Delete user
      const { error } = await supabase
        .from("users")
        .delete()
        .eq("telegram_id", targetId);

      if (error) throw error;

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error?.message || "Failed to delete user" }, 500);
    }
  });
  app.get("/api/admin/users", adminOnly, async (c) => {
    const query = (c.req.query("q") || "").trim();
    const page = Math.max(1, Number(c.req.query("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let dbQuery = supabase
      .from("users")
      .select("telegram_id,name,username,role,plan,credits,last_active,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (query) {
      // Never interpolate raw user input into a PostgREST `or` filter:
      // commas/parentheses/quotes would allow filter injection.
      const safeQuery = query
        .replace(/[%_\\]/g, "")
        .replace(/[,()"']/g, " ")
        .trim()
        .slice(0, 100);
      if (safeQuery) {
        const clauses = [
          `name.ilike.%${safeQuery}%`,
          `username.ilike.%${safeQuery}%`,
        ];
        const numericQuery = Number(query);
        if (Number.isInteger(numericQuery) && numericQuery > 0) {
          clauses.push(`telegram_id.eq.${numericQuery}`);
        }
        dbQuery = dbQuery.or(clauses.join(","));
      }
    }

    const { data, error, count } = await dbQuery;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({
      users: data || [],
      page,
      limit,
      total: count || 0,
      hasMore: (count || 0) > page * limit,
    });
  });

  app.post("/api/admin/users/notify", adminOnly, async (c) => {
    if (!bot) return c.json({ error: "Bot not configured" }, 500);

    const { telegramId, message } = await c.req.json().catch(() => ({} as any));
    if (!telegramId || !message) return c.json({ error: "telegramId and message are required" }, 400);

    try {
      await bot.telegram.sendMessage(Number(telegramId), String(message), {
        ...Markup.inlineKeyboard([[Markup.button.webApp("Open Flash AI", appUrl)]]),
      });
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e?.message || "Failed to notify user" }, 500);
    }
  });

  app.post("/api/admin/notifications/run", adminOnly, async (c) => {
    if (!engagementScheduler) return c.json({ error: "Bot is not configured" }, 503);
    const body = await c.req.json().catch(() => ({} as any));
    const job = String(body?.job || "").trim();
    if (!["daily_fixtures", "news_digest", "weekly_recap", "marketing", "live_alerts"].includes(job)) {
      return c.json({ error: "Invalid job" }, 400);
    }
    const result = await engagementScheduler.runNow(job as any);
    return c.json({ success: true, result });
  });

  app.get("/api/admin/channel-agent/status", adminOnly, async (c) => {
    if (!channelAgent) {
      return c.json({
        enabled: false,
        connected: false,
        error: "Bot is not configured",
      });
    }
    return c.json(channelAgent.getStatus());
  });

  app.post("/api/admin/channel-agent/run", adminOnly, async (c) => {
    if (!channelAgent) return c.json({ error: "Bot is not configured" }, 503);
    const body = await c.req.json().catch(() => ({} as any));
    const job = String(body?.job || "morning_brief").trim();
    if (!["morning_brief", "featured_match", "newsroom"].includes(job)) {
      return c.json({ error: "Invalid job" }, 400);
    }
    try {
      const result = await channelAgent.runNow(job as any, {
        force: body?.force === true,
        dryRun: body?.dryRun === true,
      });
      return c.json({ success: true, result });
    } catch (e: any) {
      return c.json({ error: e?.message || "Channel agent run failed" }, 500);
    }
  });

  app.get("/api/admin/reports", adminOnly, async (c) => {
    const status = String(c.req.query("status") || "all").trim().toLowerCase();
    let query = supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  });

  app.post("/api/admin/reports/:id/status", adminOnly, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as any));
    const status = String(body?.status || "").trim().toLowerCase();
    if (!["open", "reviewing", "resolved"].includes(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    const { error } = await supabase
      .from("reports")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
  });
  app.post("/api/admin/notifications/send", adminOnly, async (c) => {
    if (!bot) return c.json({ error: "Bot not configured" }, 500);

    const body = await c.req.json().catch(() => ({} as any));
    const message = String(body.message || "").trim();
    const image_url = String(body.image_url || "").trim();
    const with_app_button = Boolean(body.with_app_button);
    const app_button_text = String(body.app_button_text || "Open Flash AI").trim();
    const with_url_button = Boolean(body.with_url_button);
    const url_button_text = String(body.url_button_text || "Learn More").trim();
    const button_url = String(body.button_url || appUrl).trim();
    const target_group = normalizeAudience(body.target_group || "all");

    if (!message) return c.json({ error: "Message is required" }, 400);

    let query = supabase.from("users").select("telegram_id,plan").not("telegram_id", "is", null);
    if (target_group === 'subscribed') query = query.neq('plan', 'free');
    if (target_group === 'unsubscribed') query = query.eq('plan', 'free');
    if (target_group === 'monthly_basic') query = query.eq('plan', 'monthly_basic');
    if (target_group === 'monthly_pro') query = query.eq('plan', 'monthly_pro');
    if (target_group === 'admin') query = query.eq('plan', 'admin');

    const { data: users } = await query;
    if (!users?.length) return c.json({ success: true, sentCount: 0 });

    // Build keyboard based on button type
    let keyboard: any = undefined;
    if (with_app_button && app_button_text) {
      // App button - opens the web app
      keyboard = Markup.inlineKeyboard([[Markup.button.webApp(app_button_text, appUrl)]]);
    } else if (with_url_button && url_button_text && button_url) {
      // External URL button
      keyboard = Markup.inlineKeyboard([[Markup.button.url(url_button_text, button_url)]]);
    }

    let sentCount = 0;
    for (const user of users) {
      try {
        if (image_url) {
          await bot.telegram.sendPhoto(user.telegram_id, image_url, { caption: message, ...keyboard });
        } else {
          await bot.telegram.sendMessage(user.telegram_id, message, keyboard ? { ...keyboard } : undefined);
        }
        sentCount += 1;
        if (sentCount % 20 === 0) await new Promise((r) => setTimeout(r, 900));
      } catch {}
    }

    return c.json({ success: true, sentCount });
  });


  // Public Overrides
  app.get("/api/common/tasks", async (c) => {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,description,reward,url,button_label,image_url,active,created_at")
      .eq("active", true);
    if (error) return c.json([]);
    return c.json(data || []);
  });

  app.get("/api/common/ads", async (c) => {
    const now = Date.now();

    // Always fetch from DB so expiry and target_group filtering is always fresh.
    // Never rely on the admin cache here — it contains ALL ads including inactive ones.
    const { data: dbAds } = await supabase
      .from("ads")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50);
    const ads: any[] = dbAds || [];

    const tgUser = getAuthedTelegramUser(c);
    let userPlan = "free";
    if (tgUser?.id) {
      const { data: user } = await supabase.from("users").select("plan").eq("telegram_id", tgUser.id).maybeSingle();
      userPlan = user?.plan || "free";
    }

    const filtered = ads.filter((ad) => {
      if (ad.active === false) return false;
      // Filter out expired ads
      if (ad.expires_at && new Date(ad.expires_at).getTime() < now) return false;

      const group = normalizeAudience(ad.target_group || "all");
      if (group === "all") return true;
      if (group === "subscribed") return userPlan !== "free";
      if (group === "unsubscribed") return userPlan === "free";
      if (group === "admin") return userPlan === "admin";
      return userPlan === group;
    });

    filtered.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return c.json(filtered.slice(0, 10));
  });

  app.post("/api/common/ads/:id/track", async (c) => {
    const tgUser = getAuthedTelegramUser(c);
    if (!tgUser?.id) return c.json({ error: "Invalid Telegram authentication" }, 401);

    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return c.json({ error: "Invalid ad id" }, 400);
    }

    const { type } = await c.req.json().catch(() => ({ type: "view" }));
    const isClick = type === "click";

    const { error } = await supabase.rpc("increment_ad_metric", {
      ad_id: id,
      is_click: isClick,
    });
    if (error) {
      console.error("Ad metric update failed:", error.message);
      return c.json({ error: "Failed to record metric" }, 500);
    }

    return c.json({ success: true });
  });

  app.post("/api/bot/notify", async (c) => {
    return c.json({
      success: false,
      disabled: true,
      message: "Automated FOMO/marketing bot notifications are disabled. Use admin notifications instead."
    }, 410);
  });

  app.post("/api/admin/automation/retention", adminOnly, async (c) => {
    return c.json({
      success: false,
      disabled: true,
      message: "Retention automation is disabled. Use Admin > Notifications for manual messaging."
    }, 410);
  });

  // Manual trigger: send the daily Pro accumulator right now (bypasses the time guard)
  app.post("/api/admin/accumulator/send-now", adminOnly, async (c) => {
    if (!bot) return c.json({ error: "Bot not configured" }, 500);
    try {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      const upcoming = await getUpcomingMatches();
      const todaysMatches = (upcoming || [])
        .filter((m: any) => String(m?.fixture?.date || "").startsWith(todayKey))
        .slice(0, 4);

      if (todaysMatches.length < 2) {
        return c.json({ error: "Not enough matches today to build an accumulator (need at least 2)." }, 400);
      }

      const { analyzeMatchWithSearch } = await import("./services/geminiService.js");
      const legs: { match: string; pick: string; confidence: number }[] = [];
      for (const m of todaysMatches) {
        const home = m?.teams?.home?.name || "Home";
        const away = m?.teams?.away?.name || "Away";
        const matchStr = `${home} vs ${away}`;
        try {
          const result: any = await Promise.race([
            analyzeMatchWithSearch(matchStr),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25_000))
          ]);
          const top = result?.predictions?.[0];
          if (top?.market && top?.confidence) {
            legs.push({ match: matchStr, pick: top.market, confidence: Number(top.confidence) });
          }
        } catch { /* skip failed match */ }
      }

      if (legs.length < 2) return c.json({ error: "Analysis failed for too many matches." }, 500);

      const legEmoji = ["🏆", "⚡", "🎯", "🔥"];
      const legLines = legs.map((l, i) =>
        `${legEmoji[i] || "•"} ${l.match}\n   → ${l.pick} (${l.confidence}% confidence)`
      );
      const avgConfidence = Math.round(legs.reduce((s, l) => s + l.confidence, 0) / legs.length);
      const message =
        `⚡ *Daily Pro Accumulator — ${todayKey}*\n\n` +
        `${legLines.join("\n\n")}\n\n` +
        `📊 Average confidence: *${avgConfidence}%*\n` +
        `📌 ${legs.length}-leg accumulator\n\n` +
        `_Open Flash AI to view full analysis for each match._`;

      const { data: proUsers } = await supabase
        .from("users")
        .select("telegram_id")
        .eq("plan", "monthly_pro")
        .not("telegram_id", "is", null)
        .limit(1000);

      let sentCount = 0;
      for (const u of proUsers || []) {
        try {
          await bot.telegram.sendMessage(Number(u.telegram_id), message, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.webApp("Open Flash AI", appUrl)]]),
          });
          sentCount++;
          if (sentCount % 20 === 0) await new Promise(r => setTimeout(r, 1000));
        } catch { /* user may have blocked the bot */ }
      }

      return c.json({ success: true, sentCount, legs: legs.length, avgConfidence });
    } catch (e: any) {
      return c.json({ error: e?.message || "Failed to send accumulator" }, 500);
    }
  });

  // Retention & Engagement Automation (Single Definition)
  app.post("/api/automation/retention", async (c) => {
    return c.json({ error: "Retention automation is disabled." }, 410);
  });

  // n8n Automation: Daily Top Picks Flow
  app.post("/api/automation/daily-picks", async (c) => {
    return c.json({ error: "Daily marketing automation is disabled." }, 410);
  });

  // Note: Duplicate /api/automation/retention endpoint removed - see line ~1007 for the single definition

  // NOTE: the former public /api/common/cache endpoint was removed.
  // It allowed unauthenticated reads of every cache key, including phone
  // numbers, and bypassed the paid-only live-matches gate.

  // Vite / Static Assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.all("*", async (c) => {
      const res = await new Promise<Response | undefined>((resolve) => {
        const env = c.env as any;
        const req = env.incoming;
        const nodeRes = env.outgoing;
        
        vite.middlewares(req, nodeRes, () => {
          resolve(undefined);
        });
      });
      
      return res || c.notFound();
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use("/assets/*", serveStatic({ root: "./dist" }));
    app.get("*", async (c) => {
      const html = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
      return c.html(html);
    });
  }

  // Define Chron job for Live match caching
  console.log("Starting background caching services...");
  const CACHE_INTERVAL = 3 * 60 * 1000; // 3 minutes
  const refreshLiveCache = async () => {
    try {
      console.log("Running background task: Caching live matches...");
      const { fetchLiveMatchesFallback } = await import("./services/geminiService.js");
      const fallback = await fetchLiveMatchesFallback();
      if (fallback && fallback.length > 0) {
        await supabase.from("api_cache").upsert({
          endpoint: "live",
          data: fallback,
          updated_at: new Date().toISOString()
        }, { onConflict: "endpoint" });
      }
    } catch (e) {
      console.error("Live match caching failed:", e);
    }
  };

  // Run once on startup, then on interval
  await ensureBootstrapAdminRole();
  refreshLiveCache();
  setInterval(refreshLiveCache, CACHE_INTERVAL).unref?.();

  // Initialize Credit Reset Scheduler
  console.log("Initializing Credit Reset Scheduler...");
  const creditResetScheduler = new CreditResetScheduler({
    supabaseUrl: supabaseUrl!,
    supabaseKey: supabaseKey!,
    timezone: process.env.TIMEZONE || "UTC",
    autoStart: true,
    checkInterval: 60000 // Check every minute
  });
  console.log("✅ Credit Reset Scheduler initialized and running");

  console.log(`Server running on http://localhost:${PORT}`);
  serve({
    fetch: app.fetch,
    port: PORT,
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("⚠️ Uncaught exception:", error);
});

startServer().catch((error) => {
  console.error("❌ Server bootstrap failed:", error);
});
