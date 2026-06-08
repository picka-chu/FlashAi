import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { getLiveMatchPreview, getLiveMatches, getMatchDetails, getUpcomingMatches, searchMatches } from "./services/footballService";
import { generateSupportReply, getDefaultFaqs } from "./services/supportService";
import CreditResetScheduler from "./tasks/creditResetScheduler.js";
import { InMemoryRateLimiter } from "./middleware/rateLimit";
import { registerLeaderboardRoutes } from "./routes/leaderboard";
import { getTelegramUserFromInitData, validateTelegramInitData } from "./middleware/auth";

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
const bootstrapAdminId = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;

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

const PLAN_DAILY_LIMITS: Record<string, { credits: number; betSlipAnalysis: number }> = {
  free: { credits: 3, betSlipAnalysis: 1 },
  monthly_basic: { credits: 10, betSlipAnalysis: 2 },
  monthly_pro: { credits: 16, betSlipAnalysis: 6 },
  admin: { credits: 999, betSlipAnalysis: 999 },
};

const PLAN_PRICE_USD: Record<string, number> = {
  monthly_basic: 8.99,
  monthly_pro: 14.99,
};
const USD_TO_STARS_RATE = 50;
const PLAN_PRICE_STARS: Record<string, number> = {
  monthly_basic: 500,
  monthly_pro: 800,
};
const PLAN_PRICE_TON: Record<string, number> = {
  monthly_basic: 6.86,
  monthly_pro: 11.5,
};

const signupCreditsRaw = Number(process.env.SIGNUP_CREDITS ?? 3);
const signupCredits = Number.isFinite(signupCreditsRaw) && signupCreditsRaw >= 0 ? Math.floor(signupCreditsRaw) : 3;
const referralRewardRaw = Number(process.env.REFERRAL_REWARD_CREDITS ?? 2);
const referralRewardCredits = Number.isFinite(referralRewardRaw) && referralRewardRaw >= 0 ? Math.floor(referralRewardRaw) : 2;
const DEFAULT_APP_URL = process.env.DEFAULT_APP_URL || "https://flashai-siuj.onrender.com";

function getPlanCreditAllocation(planId: string) {
  return PLAN_CREDITS[planId] ?? 0;
}

function getPlanDurationDays(planId: string): number {
  if (planId === "monthly_basic" || planId === "monthly_pro") return 30;
  return 0;
}

async function applyPlanCredits(telegramId: number, planId: string) {
  const { data: existingUser, error: fetchError } = await supabase
    .from("users")
    .select("credits,plan_expires_at")
    .eq("telegram_id", telegramId)
    .single();

  if (fetchError) throw fetchError;

  const creditsToAdd = getPlanCreditAllocation(planId);
  const nextCredits = (existingUser?.credits || 0) + creditsToAdd;
  const durationDays = getPlanDurationDays(planId);
  const now = new Date();
  const currentExpiry = existingUser?.plan_expires_at ? new Date(existingUser.plan_expires_at) : null;
  const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const planExpiryAt = durationDays > 0
    ? new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const basePayload: any = {
    plan: planId,
    credits: nextCredits,
    last_active: now.toISOString(),
    last_credit_reset: now.toISOString(),
  };

  try {
    const payload = { ...basePayload, plan_expires_at: planExpiryAt };
    const { error: updateError } = await supabase
      .from("users")
      .update(payload)
      .eq("telegram_id", telegramId);
    if (updateError) throw updateError;
  } catch (updateError: any) {
    // Legacy schema fallback (plan_expires_at column missing).
    if (updateError?.code !== "42703") throw updateError;
    const { error: fallbackError } = await supabase
      .from("users")
      .update(basePayload)
      .eq("telegram_id", telegramId);
    if (fallbackError) throw fallbackError;
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

type HistoryStatus = "pending" | "won" | "lost";

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
    status: row.status || "pending",
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
  }));
}

async function setUserHistory(telegramId: number, history: UserHistoryItem[]) {
  const trimmed = history.slice(0, 100);
  
  // Delete old history for this user
  const { error: deleteError } = await supabase.from("user_history").delete().eq("telegram_id", telegramId);
  if (deleteError) {
    console.error("Failed to delete old user history:", deleteError.message);
  }

  if (trimmed.length > 0) {
    const rows = trimmed.map((item) => ({
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
    }));

    let { error: insertError } = await supabase.from("user_history").insert(rows);
    if (insertError && String(insertError.message || "").toLowerCase().includes("analysis_payload")) {
      const legacyRows = rows.map(({ analysis_payload, ...row }) => row);
      const legacyInsert = await supabase.from("user_history").insert(legacyRows);
      insertError = legacyInsert.error;
    }

    if (insertError) {
      console.error("Failed to insert user history:", insertError.message);
    }
  }
}

async function getCachedRegistration(telegramId: number): Promise<{ phone?: string; name?: string } | null> {
  try {
    const { data } = await supabase
      .from("api_cache")
      .select("data")
      .eq("endpoint", `registration_${telegramId}`)
      .maybeSingle();
    return data?.data || null;
  } catch {
    return null;
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
  // rather than silently awarding "lost" via the 24h guardrail.
  if (isNonResolvableMarket(mk)) return "pending";

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

async function resolveHistoryItemResult(item: UserHistoryItem): Promise<UserHistoryItem> {
  if (item.status !== "pending") {
    return item;
  }

  const createdAtMs = new Date(item.created_at).getTime();
  const isOlderThan24h = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) >= (24 * 60 * 60 * 1000);

  const tryResolveFromAllScoreboard = async (): Promise<UserHistoryItem | null> => {
    try {
      const dates = [getUtcDateString(-1), getUtcDateString(0)];
      for (const date of dates) {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${date}`;
        const res = await axios.get(url);
        const events = Array.isArray(res.data?.events) ? res.data.events : [];

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

          return { ...item, status: result, resolved_at: new Date().toISOString() };
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  try {
    if (item.fixtureId?.startsWith("espn_")) {
      const parts = item.fixtureId.split("_");
      const eventId = parts[1];
      const leagueSlug = parts[2] || "eng.1";
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`;
      const summary = await axios.get(summaryUrl);

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
      return { ...item, status: result, resolved_at: new Date().toISOString() };
    }
  } catch {
    // Fallback to scoreboard resolution below.
  }

  const resolvedByTeams = await tryResolveFromAllScoreboard();
  if (resolvedByTeams) return resolvedByTeams;

  // 24h guardrail: after a day, if the match should be over but we still can't resolve it,
  // mark as lost — UNLESS the market is one we can never resolve from scoreline data.
  if (isOlderThan24h && !isNonResolvableMarket(normalizeMarket(item.predictionMarket))) {
    return { ...item, status: "lost", resolved_at: new Date().toISOString() };
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

  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX = 25;
  const rateLimiter = new InMemoryRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX);

  const getRequestIp = (c: any) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const isRateLimited = (identifier: string) => rateLimiter.isRateLimited(identifier);

  const hasValidTelegramAuth = (initData?: string | null) =>
    Boolean(initData && validateTelegramInitData(initData, botToken));

  const ADMIN_TASKS_KEY = "admin_tasks_v1";

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
    if (PLAN_PRICE_TON[normalizedPlanId]) return PLAN_PRICE_TON[normalizedPlanId];
    const usd = getPlanUsdPrice(normalizedPlanId);
    if (!usd || !Number.isFinite(tonPerUsdRate) || tonPerUsdRate <= 0) return 0;
    return Number((usd * tonPerUsdRate).toFixed(2));
  };
  const getTonPerUsdRate = async (): Promise<number> => {
    const envRate = Number(process.env.USD_TO_TON_RATE || 0);
    if (Number.isFinite(envRate) && envRate > 0) return envRate;

    const now = Date.now();
    if (cachedRates && now - cachedRates.updatedAt < RATES_TTL_MS && cachedRates.tonUsd > 0) {
      return 1 / cachedRates.tonUsd;
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
    return 1 / tonUsd;
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
    
    // Log API calls and page loads (exclude assets)
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api") || (c.req.method === "GET" && !url.pathname.includes("."))) {
      try {
        const initData = c.req.header("X-TG-Init-Data");
        const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
        
        await supabase.from("usage_logs").insert({
          telegram_id: tgUser?.id || null,
          endpoint: url.pathname,
          method: c.req.method,
          duration_ms: ms,
          status: c.res.status
        });
      } catch (err) {
        // Silent fail for logging
      }
    }
  });

  // Security Headers Middleware
  app.use("*", async (c, next) => {
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
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
  app.post("/api/payments/lemonsqueezy-webhook", async (c) => {
    try {
      const rawBody = await c.req.raw.text();
      const body = JSON.parse(rawBody);
      const eventName = body.meta?.event_name;
      
      if (!eventName) {
        return c.json({ error: "Invalid webhook payload" }, 400);
      }

      // Verify webhook signature
      const LEMONSQUEEZY_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
      if (LEMONSQUEEZY_WEBHOOK_SECRET) {
        const signature = c.req.header("X-Signature");
        if (!signature) {
          return c.json({ error: "Missing signature" }, 401);
        }
        
        const crypto = await import('crypto');
        const hmac = crypto.createHmac('sha256', LEMONSQUEEZY_WEBHOOK_SECRET);
        const digest = hmac.update(rawBody).digest('hex');
        
        const provided = Buffer.from(signature, 'utf8');
        const expected = Buffer.from(digest, 'utf8');
        const isValidSignature = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

        if (!isValidSignature) {
          return c.json({ error: "Invalid signature" }, 401);
        }
      }

      // Handle order completed event
      if (['order_created', 'order_paid', 'subscription_payment_success'].includes(eventName)) {
        const orderData = body.data?.attributes;
        const customData = orderData?.custom;
        
        if (!customData?.telegram_id || !customData?.plan_id) {
          console.error("Lemon Squeezy webhook: Missing telegram_id or plan_id in custom data");
          return c.json({ received: true });
        }

        const telegramId = Number(customData.telegram_id);
        const planId = customData.plan_id;
        const paymentRef = String(orderData?.identifier || orderData?.order_number || body.data?.id || '');

        if (!paymentRef) {
          console.error("Lemon Squeezy webhook: Missing payment reference");
          return c.json({ received: true });
        }

        // Idempotency guard: skip already-processed events
        const { data: existingTx } = await supabase
          .from('transactions')
          .select('id')
          .eq('provider_payment_charge_id', paymentRef)
          .eq('type', 'lemonsqueezy')
          .maybeSingle();

        if (existingTx?.id) {
          return c.json({ received: true, duplicate: true });
        }

        // Apply plan credits
        await applyPlanCredits(telegramId, planId);

        // Log transaction
        await supabase.from('transactions').insert({
          telegram_id: telegramId,
          amount: orderData?.total || 0,
          currency: 'USD',
          status: 'completed',
          provider_payment_charge_id: paymentRef,
          type: 'lemonsqueezy'
        });

        // Notify user via bot
        if (bot) {
          await bot.telegram.sendMessage(telegramId, `✅ Payment received! Your account has been upgraded to ${planId.toUpperCase()} plan.`);
        }

        console.log(`Lemon Squeezy payment processed for user ${telegramId}, plan ${planId}`);
      }

      return c.json({ received: true });
    } catch (e: any) {
      console.error("Lemon Squeezy webhook error:", e.message);
      return c.json({ error: "Webhook processing failed" }, 500);
    }
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
        return c.json({ error: "Live matches are available on paid plans only." }, 403);
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
    try {
      const { getTopFixturesFromSearch } = await import("./services/geminiService.js");
      const topFixtures = await getTopFixturesFromSearch().catch(() => []);
      const matches = await getUpcomingMatches(topFixtures);
      return c.json(matches);
    } catch (error: any) {
      console.error("Football upcoming API error:", error?.message || error);
      return c.json({ error: "Failed to fetch upcoming matches" }, 500);
    }
  });

  app.get("/api/football/search", async (c) => {
    try {
      const q = (c.req.query("q") || "").trim();
      if (!q) return c.json([]);
      const matches = await searchMatches(q);
      return c.json(matches);
    } catch (error: any) {
      console.error("Football search API error:", error?.message || error);
      return c.json({ error: "Failed to search matches" }, 500);
    }
  });

  app.post("/api/football/details/:fixtureId", async (c) => {
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
    try {
      const home = c.req.query("home");
      const away = c.req.query("away");
      if (!home || !away) return c.json({ error: "Missing home or away team" }, 400);
      
      const { fetchMatchH2H } = await import("./services/geminiService.js");
      const data = await fetchMatchH2H(home, away);
      return c.json(data);
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

    // Auto-downgrade expired subscriptions.
    if (
      (effectivePlan === "monthly_basic" ||
        effectivePlan === "monthly_pro") &&
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
    
    // Check if 24 hours have passed since last reset
    const shouldReset = !lastCreditReset || 
      (now.getTime() - lastCreditReset.getTime()) >= (24 * 60 * 60 * 1000);

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

    try {
      const { matchString: rawMatchString, matchId } = await c.req.json();
      if (typeof rawMatchString !== "string" || !rawMatchString.trim() || rawMatchString.length > 200) {
        return c.json({ error: "Invalid match string" }, 400);
      }
      const matchString = rawMatchString.replace(/[^\w\s\-\.]/g, "").trim();
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
      const registration = user.phone ? null : await getCachedRegistration(telegramId);
      if (!user.phone && !registration?.phone) {
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

      // 2. Perform Analysis
      const { analyzeMatchWithSearch } = await import("./services/geminiService.js");
      const runTimedAnalysis = () => Promise.race([
        analyzeMatchWithSearch(matchString),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AI analysis timeout")), 45_000))
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

      const topPrediction = result?.predictions?.[0];
      let home = "Home";
      let away = "Away";
      if (matchId) {
        try {
          const fixtureDetails = await getMatchDetails(matchId);
          home = fixtureDetails?.home?.name || home;
          away = fixtureDetails?.away?.name || away;
        } catch {
          // Fallback to generic names if fixture lookup fails.
        }
      }
      const newHistoryItem: UserHistoryItem = {
        id: crypto.randomUUID(),
        fixtureId: String(matchId || "").startsWith("espn_") ? String(matchId) : null,
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
        const history = await getUserHistory(telegramId);
        await setUserHistory(telegramId, [newHistoryItem, ...history]);
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

    try {
      const { images } = await c.req.json();
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser) return c.json({ error: "User not identified" }, 401);
      if (!Array.isArray(images) || images.length === 0) {
        return c.json({ error: "At least one image is required." }, 400);
      }

      const telegramId = tgUser.id;

      // 1. Fetch User and Run Daily Sync
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();

      if (userError || !user) return c.json({ error: "User not found" }, 404);
      const registration = user.phone ? null : await getCachedRegistration(telegramId);
      if (!user.phone && !registration?.phone) {
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
      return c.json({ error: "Failed to analyze bet slip" }, 500);
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

      const { analyzeMatchWithSearch } = await import("./services/geminiService.js");
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

        result = await withTimeout(analyzeMatchWithSearch(`${matchString} (LIVE)`, structuredContext), 30_000);
      } catch (analysisError: any) {
        const reason = analysisError?.message || "Unknown analysis error";
        console.warn(`Live AI analysis fallback engaged: ${reason}`);
        result = {
          matchId: matchString,
          predictions: [
            {
              market: "No strong edge detected",
              confidence: 55,
              reasoning: "Live model was temporarily unavailable. Please retry shortly for a deeper AI read."
            }
          ],
          overallReasoning: "Live AI is under heavy demand. Core live data is available, but advanced reasoning is temporarily degraded.",
          teamData: {
            home: { name: liveData.teams.home.name, form: "LIVE", injuries: [], keyStats: [] },
            away: { name: liveData.teams.away.name, form: "LIVE", injuries: [], keyStats: [] }
          }
        };
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

      return c.json({
        result,
        newCredits: Number(updatedUser.credits || 0),
        liveData,
        analysisType: "live"
      });
    } catch (error: any) {
      console.error("Analyze live API error:", error?.message || error);
      return c.json({ error: "Failed to analyze live match" }, 500);
    }
  });

  app.get("/api/espn", async (c) => {
    const urlObj = new URL(c.req.url);
    const league = urlObj.searchParams.get("league") || "eng.1";
    const endpoint = urlObj.searchParams.get("endpoint") || "scoreboard";
    const ttl = urlObj.searchParams.get("ttl") || "300";
    
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
      if (Date.now() - updatedAt < parseInt(ttl) * 1000) {
        return c.json(cached.data);
      }
    }

    try {
      const response = await axios.get(espnUrl.toString());
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
    try {
      const { matchId, teams } = await c.req.json();
      if (!matchId) return c.json({ error: "Missing matchId" }, 400);

      const { data: cached } = await supabase
        .from("api_cache")
        .select("*")
        .eq("endpoint", "trending_picks")
        .single();

      let trendingData = cached?.data || {};
      
      if (!trendingData[matchId]) {
        trendingData[matchId] = { clicks: 0, teams };
      }
      
      // Add a small random multiplier to make it look like users are active
      const randomBoost = Math.floor(Math.random() * 3) + 1;
      trendingData[matchId].clicks += randomBoost;
      trendingData[matchId].last_clicked = new Date().toISOString();

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
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
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

  if (botToken) {
    bot = new Telegraf(botToken);

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
          .select("role")
          .eq("telegram_id", telegramId)
          .maybeSingle();

        isAdminUser = Boolean(isBootstrapAdmin || existingUser?.role === "admin");
        
        const profilePhoto = await getTelegramProfilePhotoUrl(telegramId, bot);
        await supabase.from("users").upsert({
          telegram_id: telegramId,
          name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
          username: ctx.from.username || "",
          photo_url: profilePhoto || null,
          referrer_id: startPayload && !isNaN(Number(startPayload)) && Number(startPayload) !== telegramId ? Number(startPayload) : null,
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
        [Markup.button.webApp("🚀 Get Started", `${appUrl}`)]
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

        // 2. Perform registration/update with atomic credit handling
        const profilePhoto = await getTelegramProfilePhotoUrl(telegramId, bot);
        const registrationPayload = {
          telegram_id: telegramId,
          name: fullName,
          username: ctx.from.username || "",
          photo_url: profilePhoto || null,
          phone,
          credits: signupCreditsToApply,
          plan: existingUser?.plan || 'free',
          last_active: new Date().toISOString()
        };

        let { data: user, error } = await supabase
          .from("users")
          .upsert(registrationPayload, { onConflict: 'telegram_id' })
          .select()
          .single();

        if (error) {
          console.error("Registration error:", error);

          // Fallback for legacy schema where users.phone does not exist yet.
          // Keep user reachable by caching the registration contact so app can verify signup.
          if (error.code === "42703" && String(error.message || "").toLowerCase().includes("phone")) {
            const { data: fallbackUser, error: fallbackError } = await supabase
              .from("users")
              .upsert({
                telegram_id: telegramId,
                name: fullName,
                username: ctx.from.username || "",
                photo_url: profilePhoto || null,
                credits: signupCreditsToApply,
                plan: existingUser?.plan || 'free',
                last_active: new Date().toISOString()
              }, { onConflict: 'telegram_id' })
              .select()
              .single();

            if (fallbackError) {
              console.error("Registration fallback error:", fallbackError);
              return ctx.reply("❌ Registration failed. Please try again later.");
            }

            await supabase.from("api_cache").upsert({
              endpoint: `registration_${telegramId}`,
              data: {
                telegram_id: telegramId,
                name: fullName,
                username: ctx.from.username || "",
                phone,
                registered_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            }, { onConflict: "endpoint" });

            user = fallbackUser;
            await ctx.reply("✅ Registration successful. Your account is now active.");
            return;
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
                 const { error: incrementError } = await supabase.rpc('increment_user_credits', {
                   target_telegram_id: existingUser.referrer_id,
                   amount: rewardAmount
                 });
                 rewardApplied = !incrementError;
               }

               if (!rewardApplied) {
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
          [Markup.button.callback("👤 My Profile", "profile_tab")]
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

      try {
        const creditsToAdd = await applyPlanCredits(telegramId, planId);

        // Log transaction
        await supabase.from('transactions').insert({
          telegram_id: telegramId,
          amount: amount,
          currency: 'XTR',
          status: 'completed',
          provider_payment_charge_id: ctx.message.successful_payment.provider_payment_charge_id,
          type: 'stars'
        });

        await ctx.reply(`🎉 Payment Successful! Your account has been upgraded to ${planId.toUpperCase()} plan. Enjoy your ${creditsToAdd} daily credits!`);
      } catch (err: any) {
        console.error("Failed to update user after payment:", err.message);
        ctx.reply("⚠️ Payment received but failed to update your plan. Please contact support with your payment ID.");
      }
    });

    bot.launch().catch(err => console.error("❌ Bot launch failed:", err));

    let lastReminderDate = "";
    const maybeSendMatchdayReminders = async () => {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      if (lastReminderDate === todayKey) return;
      if (now.getUTCHours() < 9) return; // Send once after 09:00 UTC

      try {
        const upcoming = await getUpcomingMatches();
        const todaysMatches = (upcoming || []).filter((m: any) => String(m?.fixture?.date || "").startsWith(todayKey)).slice(0, 3);
        if (!todaysMatches.length) return;

        const reminderLines = todaysMatches.map((m: any) =>
          `• ${m?.teams?.home?.name || "Home"} vs ${m?.teams?.away?.name || "Away"}`
        );
        const message = `⚽ Matchday Reminder\n\nToday's highlighted fixtures:\n${reminderLines.join("\n")}\n\nOpen Flash AI for analysis before kickoff.`;

        const { data: recipients } = await supabase
          .from("users")
          .select("telegram_id")
          .neq("plan", "free")
          .limit(500);

        for (const recipient of recipients || []) {
          try {
            await bot.telegram.sendMessage(Number(recipient.telegram_id), message, Markup.inlineKeyboard([
              [Markup.button.webApp("Open Flash AI", appUrl)],
            ]));
          } catch {
            // Continue broadcasting to remaining recipients.
          }
        }
        lastReminderDate = todayKey;
      } catch (err) {
        console.error("Matchday reminder task failed:", err);
      }
    };

    // ── Daily Pro Accumulator ─────────────────────────────────────────────────
    // Fires once per day after 09:30 UTC, picks up to 4 of today's matches,
    // runs them through Gemini, and sends the combined accumulator slip to
    // every monthly_pro user via Telegram.
    let lastAccumulatorDate = "";
    const maybeSendDailyAccumulator = async () => {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      if (lastAccumulatorDate === todayKey) return;
      if (now.getUTCHours() < 9 || (now.getUTCHours() === 9 && now.getUTCMinutes() < 30)) return;

      try {
        const upcoming = await getUpcomingMatches();
        const todaysMatches = (upcoming || [])
          .filter((m: any) => String(m?.fixture?.date || "").startsWith(todayKey))
          .slice(0, 4);

        if (todaysMatches.length < 2) {
          console.log("Accumulator skipped — fewer than 2 matches today.");
          return;
        }

        const { analyzeMatchWithSearch } = await import("./services/geminiService.js");

        // Analyse each match and pick the single top prediction per match
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
          } catch {
            // If one match fails analysis, skip it rather than aborting the whole slip
          }
        }

        if (legs.length < 2) {
          console.log("Accumulator skipped — not enough successful analyses.");
          return;
        }

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

        lastAccumulatorDate = todayKey;
        console.log(`Daily accumulator sent to ${sentCount} Pro users.`);
      } catch (err) {
        console.error("Daily accumulator task failed:", err);
      }
    };

    setInterval(() => {
      maybeSendMatchdayReminders().catch(() => undefined);
      maybeSendDailyAccumulator().catch(() => undefined);
    }, 60 * 60 * 1000);
    maybeSendMatchdayReminders().catch(() => undefined);
    maybeSendDailyAccumulator().catch(() => undefined);
  }

  // Auth/Signup Request Endpoint
  app.get("/api/auth/me", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const params = new URLSearchParams(initData || "");
      const userParam = params.get("user");
      if (!userParam) return c.json({ error: "Missing Telegram user payload" }, 400);

      const tgUser = JSON.parse(decodeURIComponent(userParam));
      const isBootstrapAdmin = Boolean(bootstrapAdminId && tgUser?.id === bootstrapAdminId);

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
          credits: isBootstrapAdmin ? 999 : 3,
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

      const registration = !user.phone ? await getCachedRegistration(tgUser.id) : null;

      return c.json({
        user: {
          ...user,
          phone: user.phone || registration?.phone || null,
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

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const history = await getUserHistory(tgUser.id);
      const settled = await Promise.allSettled(history.map((item) => resolveHistoryItemResult(item)));
      const resolved = settled.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        console.warn("History item resolve fallback:", result.reason);
        return history[index];
      });

      const hasChanges = resolved.some((item, index) => item.status !== history[index]?.status || item.resolved_at !== history[index]?.resolved_at);
      if (hasChanges) {
        await setUserHistory(tgUser.id, resolved);
      }

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
    const initData = c.req.header("X-TG-Init-Data");
    try {
      const body = await c.req.json().catch(() => ({} as any));
      const isValidTelegramAuth = hasValidTelegramAuth(initData);
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      const bodyTelegramId = Number(body?.telegramId || 0);
      const telegramId = tgUser?.id || bodyTelegramId;
      if (!telegramId || (!isValidTelegramAuth && !bodyTelegramId)) {
        return c.json({ error: "Invalid Telegram authentication" }, 401);
      }
      if (tgUser?.id && bodyTelegramId && tgUser.id !== bodyTelegramId) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }

      const name = String(body?.name || "").trim();
      const username = String(body?.username || "").trim();
      const photo_url = body?.photo_url ? String(body.photo_url).trim() : null;
      if (!name) return c.json({ error: "Name is required" }, 400);

      const { data, error } = await supabase
        .from("users")
        .upsert({ telegram_id: telegramId, name, username, photo_url, last_active: new Date().toISOString() }, { onConflict: "telegram_id" })
        .select("id,telegram_id,name,username,phone,credits,plan,role,photo_url")
        .single();

      if (error) throw error;
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
      const subject = String(body?.subject || "").trim();
      const details = String(body?.details || "").trim();
      const category = String(body?.category || "general").trim().toLowerCase();

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

  app.post("/api/user/report", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const body = await c.req.json().catch(() => ({} as any));
      const subject = String(body?.subject || "").trim();
      const details = String(body?.details || "").trim();
      const category = String(body?.category || "general").trim().toLowerCase();

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

  // Lemon Squeezy Checkout Endpoint
  app.post("/api/payments/create-lemonsqueezy-checkout", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, planId, planName, price } = await c.req.json();
      
      if (!telegramId || !planId) {
        return c.json({ error: "Missing required parameters" }, 400);
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

      // Map plan IDs to product/variant IDs in Lemon Squeezy
      const VARIANT_MAP: Record<string, string> = {
        'monthly_basic': process.env.LEMONSQUEEZY_VARIANT_MONTHLY_BASIC || 'monthly-basic',
        'monthly_pro': process.env.LEMONSQUEEZY_VARIANT_MONTHLY_PRO || 'monthly-pro',
      };

      const variantId = VARIANT_MAP[planId] || planId;

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
                  telegram_id: String(telegramId),
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

      // 1. Check if user already completed the task
      const { data: taskLog } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('telegram_id', normalizedTelegramId)
        .eq('task_id', normalizedTaskId)
        .single();

      if (taskLog) {
        return c.json({ error: "Task already completed" }, 400);
      }

      // 2. Perform verification for specific tasks
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

      // 3. Log completion and award reward
      const { error: logError } = await supabase.from('user_tasks').insert({
        telegram_id: normalizedTelegramId,
        task_id: normalizedTaskId,
        completed_at: new Date().toISOString()
      });

      if (logError) throw logError;

      const { data: user } = await supabase
        .from('users')
        .select('credits')
        .eq('telegram_id', normalizedTelegramId)
        .single();
      const newCredits = (user?.credits || 0) + taskReward;
      await supabase
        .from('users')
        .update({ credits: newCredits })
        .eq('telegram_id', normalizedTelegramId);

      return c.json({ success: true, newCredits, rewardedCredits: taskReward });
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

      const payload = {
        telegram_id: tgUser.id,
        wallet_address: normalizedAddress,
        chain: String(chain || '').trim() || null,
        wallet_name: String(walletName || '').trim() || null,
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

  // Verify TON Payment Endpoint
  app.post("/api/payments/verify-ton-payment", async (c) => {
    // Validate Telegram Init Data
    const initData = c.req.header("X-TG-Init-Data");
    if (!hasValidTelegramAuth(initData)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, planId, amount, txHash: rawTxHash } = await c.req.json();
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      const effectiveTelegramId = tgUser?.id || Number(telegramId || 0);
      const normalizedPlanId = String(planId || "").trim();
      const txHash = String(rawTxHash || "").trim().slice(0, 256);
      const tonReceiverAddress = process.env.TON_RECEIVER_ADDRESS;
      const toncenterApiKey = process.env.TONCENTER_API_KEY;
      
      if (!effectiveTelegramId || !normalizedPlanId || !txHash) {
        return c.json({ error: "Missing required parameters" }, 400);
      }
      if (!tonReceiverAddress || !toncenterApiKey) {
        return c.json({ error: "TON payments are coming soon." }, 503);
      }
      if (tgUser?.id && Number(telegramId || 0) && tgUser.id !== Number(telegramId || 0)) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }

      const tonPerUsdRate = await getTonPerUsdRate();
      const expectedTonAmount = getExpectedTonAmount(normalizedPlanId, tonPerUsdRate);
      if (!expectedTonAmount) {
        return c.json({ error: "Unsupported or invalid plan for TON payment" }, 400);
      }
      const expectedNanoTon = BigInt(Math.round(expectedTonAmount * 1e9));

      const txLookup = await axios.get("https://toncenter.com/api/v2/getTransactions", {
        params: {
          address: tonReceiverAddress,
          limit: 100,
        },
        headers: {
          "X-API-Key": toncenterApiKey,
        },
        timeout: 12_000,
      });

      const chainTransactions = Array.isArray(txLookup?.data?.result) ? txLookup.data.result : [];
      const matchingTx = chainTransactions.find((chainTx: any) => {
        const chainHash = String(chainTx?.transaction_id?.hash || "");
        if (!chainHash || !(chainHash === txHash || chainHash.includes(txHash) || txHash.includes(chainHash))) {
          return false;
        }
        const inMsg = chainTx?.in_msg || {};
        const destination = String(inMsg?.destination || chainTx?.account || "").toLowerCase();
        const value = BigInt(String(inMsg?.value || 0));
        if (destination && destination !== String(tonReceiverAddress).toLowerCase()) return false;
        return value >= expectedNanoTon;
      });

      if (!matchingTx) {
        return c.json({ error: "TON transaction not confirmed for expected receiver/amount." }, 400);
      }

      // 1) Replay protection: reject already-processed TON tx hashes
      const { data: existingProcessedTx, error: existingProcessedTxError } = await supabase
        .from("processed_transactions")
        .select("id")
        .eq("tx_hash", txHash)
        .maybeSingle();
      if (existingProcessedTxError && existingProcessedTxError.code !== "PGRST116") {
        throw existingProcessedTxError;
      }
      if (existingProcessedTx?.id) {
        return c.json({ error: "Transaction already processed" }, 409);
      }

      // Reserve tx hash first to prevent concurrent replay.
      const { error: processedTxInsertError } = await supabase
        .from("processed_transactions")
        .insert({
          tx_hash: txHash,
          telegram_id: effectiveTelegramId,
          plan_id: normalizedPlanId,
          provider: "ton",
          processed_at: new Date().toISOString(),
        });
      if (processedTxInsertError) {
        if (processedTxInsertError.code === "23505") {
          return c.json({ error: "Transaction already processed" }, 409);
        }
        throw processedTxInsertError;
      }

      try {
        // 2. Log the transaction in the database
        const { error: txError } = await supabase.from('transactions').insert({
          telegram_id: effectiveTelegramId,
          amount: Number(amount || expectedTonAmount || 0),
          currency: 'TON',
          status: 'completed',
          provider_payment_charge_id: txHash.substring(0, 100),
          type: 'ton'
        });

        if (txError) throw txError;

        // 3. Apply plan + credits consistently
        await applyPlanCredits(effectiveTelegramId, normalizedPlanId);

        // 4. Notify the user via Bot
        if (bot) {
          await bot.telegram.sendMessage(effectiveTelegramId, `✅ TON payment received! Your account is now on ${normalizedPlanId.toUpperCase()} plan.`);
        }
      } catch (processingError) {
        // Compensating action: release tx hash reservation so user can retry safely.
        await supabase.from("processed_transactions").delete().eq("tx_hash", txHash);
        throw processingError;
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
    let tasks = await getCachedCollection<any>(ADMIN_TASKS_KEY);
    if (!tasks.length) {
      const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(200);
      tasks = data || [];
    }
    tasks.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return c.json(tasks);
  });

  app.post("/api/admin/tasks", adminOnly, async (c) => {
    const body = await c.req.json();
    const tasks = await getCachedCollection<any>(ADMIN_TASKS_KEY);

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

    await setCachedCollection(ADMIN_TASKS_KEY, [task, ...tasks]);
    try {
      const { error: dbError } = await supabase.from("tasks").insert({
        title: task.title,
        description: task.description,
        reward: task.reward,
        url: task.url,
        active: task.active,
      });
      if (dbError) {
        console.error("DB insert failed for tasks:", dbError);
      }
    } catch {}
    return c.json(task);
  });

  app.delete("/api/admin/tasks/:id", adminOnly, async (c) => {
    const id = c.req.param("id");
    const tasks = await getCachedCollection<any>(ADMIN_TASKS_KEY);
    await setCachedCollection(ADMIN_TASKS_KEY, tasks.filter((t) => t.id !== id));
    try {
      await supabase.from("tasks").delete().eq("id", id);
    } catch {}
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
    const { telegramId, role } = await c.req.json();
    const { error } = await supabase
      .from("users")
      .update({ role })
      .eq("telegram_id", telegramId);
      
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
      dbQuery = dbQuery.or(`name.ilike.%${query}%,username.ilike.%${query}%,telegram_id.eq.${Number(query) || 0}`);
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
    let tasks = await getCachedCollection<any>(ADMIN_TASKS_KEY);
    if (!tasks.length) {
      const { data } = await supabase.from("tasks").select("*").eq("active", true);
      tasks = data || [];
    }
    return c.json(tasks.filter((t) => t.active !== false));
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

    const initData = c.req.header("X-TG-Init-Data") || "";
    const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
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
    const id = c.req.param("id");
    const { type } = await c.req.json().catch(() => ({ type: "view" }));

    const ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    const next = ads.map((ad) => {
      if (ad.id !== id) return ad;
      if (type === 'click') return { ...ad, clicks: Number(ad.clicks || 0) + 1 };
      return { ...ad, views: Number(ad.views || 0) + 1 };
    });
    await setCachedCollection(ADMIN_ADS_KEY, next);

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

  app.get("/api/common/cache", async (c) => {
    try {
      const key = c.req.query("key");
      if (!key) return c.json({ data: null }, 400);

      const { data } = await supabase
        .from("api_cache")
        .select("*")
        .eq("endpoint", key)
        .single();
      
      return c.json({ data: data?.data || null });
    } catch (e: any) {
      console.error(`Cache fetch failed for endpoint`, e.message);
      return c.json({ data: null }, 500);
    }
  });

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
  setInterval(refreshLiveCache, CACHE_INTERVAL);

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

// TON Payment Verification Polling
const checkTonPayments = async () => {
  try {
    const tonReceiverAddress = process.env.TON_RECEIVER_ADDRESS;
    const toncenterApiKey = process.env.TONCENTER_API_KEY;

    if (!tonReceiverAddress || !toncenterApiKey) {
      return;
    }

    const { data: pendingTxs } = await supabase
      .from('transactions')
      .select('*')
      .eq('currency', 'TON')
      .eq('status', 'pending_verification');

    if (!pendingTxs || pendingTxs.length === 0) return;

    for (const tx of pendingTxs) {
      try {
        const res = await axios.get("https://toncenter.com/api/v2/getTransactions", {
          params: {
            address: tonReceiverAddress,
            limit: 20,
          },
          headers: {
            "X-API-Key": toncenterApiKey,
          },
        });

        const transactions = res.data?.result || [];
        const isConfirmed = transactions.some((chainTx: any) => {
          const hash = chainTx?.transaction_id?.hash || "";
          return typeof tx.provider_payment_charge_id === "string" && hash.includes(tx.provider_payment_charge_id);
        });

        if (isConfirmed) {
          await supabase.from('transactions').update({ status: 'completed' }).eq('id', tx.id);
          
          if (process.env.TELEGRAM_BOT_TOKEN) {
            const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
            await bot.telegram.sendMessage(tx.telegram_id, `✅ Your TON transaction has been confirmed on the blockchain! Thank you for your purchase.`);
          }
        }
      } catch (err) {
        console.error("Error confirming tx:", tx.id, err);
      }
    }
  } catch (error) {
    console.error("TON payment polling failed:", error);
  }
};
setInterval(checkTonPayments, 30000); // Check every 30 seconds

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("⚠️ Uncaught exception:", error);
});

startServer().catch((error) => {
  console.error("❌ Server bootstrap failed:", error);
});
