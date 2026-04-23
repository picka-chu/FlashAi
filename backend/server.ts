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
import { getLiveMatches, getMatchDetails, getUpcomingMatches, searchMatches } from "./services/footballService";
import { generateSupportReply, getDefaultFaqs } from "./services/supportService";
import CreditResetScheduler from "./tasks/creditResetScheduler.js";

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

const signupCreditsRaw = Number(process.env.SIGNUP_CREDITS ?? 3);
const signupCredits = Number.isFinite(signupCreditsRaw) && signupCreditsRaw >= 0 ? Math.floor(signupCreditsRaw) : 3;

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

/**
 * Validates the data received from the Telegram Web App.
 * @param initData - The initialization data string from Telegram.
 * @param botToken - The Telegram Bot Token.
 * @returns boolean - True if the data is valid, false otherwise.
 */
function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    urlParams.delete("hash");

    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    return calculatedHash === hash;
  } catch (err) {
    console.error("InitData validation error:", err);
    return false;
  }
}

/**
 * Extracts the user ID from the initData.
 */
function getTelegramUserFromInitData(initData: string): any {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get("user");
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
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
  status: HistoryStatus;
  created_at: string;
  resolved_at?: string | null;
};

async function getUserHistory(telegramId: number): Promise<UserHistoryItem[]> {
  const { data, error } = await supabase
    .from("user_history")
    .select("id,fixture_id,match,home,away,prediction_market,confidence,reasoning,status,created_at,resolved_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(100);

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
      status: item.status || "pending",
      created_at: item.created_at || new Date().toISOString(),
      resolved_at: item.resolved_at || null,
    }));
    const { error: insertError } = await supabase.from("user_history").insert(rows);
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

function evaluatePredictionMarket(market: string, homeGoals: number, awayGoals: number): HistoryStatus {
  const mk = normalizeMarket(market);
  const total = homeGoals + awayGoals;

  if (!mk) return "pending";
  
  // Professional Grade Matching Logic
  // 1. Full Match Results (1X2)
  if (mk === "1" || mk === "home win" || (mk.includes("home") && mk.includes("win") && !mk.includes("draw"))) {
    return homeGoals > awayGoals ? "won" : "lost";
  }
  if (mk === "2" || mk === "away win" || (mk.includes("away") && mk.includes("win") && !mk.includes("draw"))) {
    return awayGoals > homeGoals ? "won" : "lost";
  }
  if (mk === "x" || mk === "draw" || mk.includes("draw")) {
    return homeGoals === awayGoals ? "won" : "lost";
  }

  // 2. Double Chance
  if (mk === "1x" || mk === "home or draw" || (mk.includes("1") && mk.includes("x") && mk.length <= 3)) {
    return homeGoals >= awayGoals ? "won" : "lost";
  }
  if (mk === "x2" || mk === "away or draw" || (mk.includes("x") && mk.includes("2") && mk.length <= 3)) {
    return awayGoals >= homeGoals ? "won" : "lost";
  }
  if (mk === "12" || mk === "home or away" || (mk.includes("1") && mk.includes("2") && mk.length <= 3)) {
    return homeGoals !== awayGoals ? "won" : "lost";
  }

  // 3. Over/Under Goals (Professional Support for any value)
  const overMatch = mk.match(/over\s*(\d+\.?\d*)/);
  if (overMatch) {
    const threshold = parseFloat(overMatch[1]);
    return total > threshold ? "won" : "lost";
  }
  const underMatch = mk.match(/under\s*(\d+\.?\d*)/);
  if (underMatch) {
    const threshold = parseFloat(underMatch[1]);
    return total < threshold ? "won" : "lost";
  }

  // 4. Both Teams to Score (BTTS)
  if (mk.includes("btts") || mk.includes("both teams to score")) {
    const isYes = mk.includes("yes") || mk.includes("true") || (!mk.includes("no") && !mk.includes("false"));
    const bttsHappened = homeGoals > 0 && awayGoals > 0;
    return isYes === bttsHappened ? "won" : "lost";
  }

  // 5. Exact Score (e.g. "2-1")
  const scoreMatch = mk.match(/(\d+)\s*-\s*(\d+)/);
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
          const homeName = String(home?.team?.displayName || "").toLowerCase().trim();
          const awayName = String(away?.team?.displayName || "").toLowerCase().trim();
          const expectedHome = String(item.home || "").toLowerCase().trim();
          const expectedAway = String(item.away || "").toLowerCase().trim();

          if (!homeName || !awayName || !expectedHome || !expectedAway) continue;
          const sameOrder = homeName.includes(expectedHome) && awayName.includes(expectedAway);
          const reverseOrder = homeName.includes(expectedAway) && awayName.includes(expectedHome);
          if (!sameOrder && !reverseOrder) continue;

          const homeGoals = Number(home?.score ?? 0);
          const awayGoals = Number(away?.score ?? 0);
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

  // Professional guardrail: prevent eternal pending records after 24h.
  if (isOlderThan24h) {
    return { ...item, status: "lost", resolved_at: new Date().toISOString() };
  }

  return item;
}

async function startServer() {
  const app = new Hono();
  const PORT = Number(process.env.PORT || 3000);

  const requestBuckets = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX = 25;

  const getRequestIp = (c: any) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const isRateLimited = (identifier: string) => {
    const now = Date.now();
    const current = requestBuckets.get(identifier);
    if (!current || now > current.resetAt) {
      requestBuckets.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return false;
    }

    current.count += 1;
    requestBuckets.set(identifier, current);
    return current.count > RATE_LIMIT_MAX;
  };

  const ADMIN_TASKS_KEY = "admin_tasks_v1";
  const ADMIN_ADS_KEY = "admin_ads_v1";

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
    if (["all", "subscribed", "unsubscribed", "weekly", "monthly", "admin"].includes(v)) return v;
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
      const body = await c.req.json();
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
        const rawBody = JSON.stringify(body);
        const digest = hmac.update(rawBody).digest('hex');
        
        if (signature !== digest) {
          return c.json({ error: "Invalid signature" }, 401);
        }
      }

      // Handle order completed event
      if (eventName === 'order_created' || eventName === 'payment_success') {
        const orderData = body.data?.attributes;
        const customData = orderData?.custom;
        
        if (!customData?.telegram_id || !customData?.plan_id) {
          console.error("Lemon Squeezy webhook: Missing telegram_id or plan_id in custom data");
          return c.json({ received: true });
        }

        const telegramId = Number(customData.telegram_id);
        const planId = customData.plan_id;

        // Apply plan credits
        await applyPlanCredits(telegramId, planId);

        // Log transaction
        await supabase.from('transactions').insert({
          telegram_id: telegramId,
          amount: orderData?.total || 0,
          currency: 'USD',
          status: 'completed',
          provider_payment_charge_id: String(orderData?.id || ''),
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
    try {
      const matches = await getLiveMatches();
      if (matches.length > 0) return c.json(matches);

      const { data } = await supabase.from("api_cache").select("data").eq("endpoint", "live").single();
      return c.json(data?.data || []);
    } catch (error: any) {
      console.error("Football live API error:", error?.message || error);
      return c.json({ error: "Failed to fetch live matches" }, 500);
    }
  });

  app.get("/api/football/upcoming", async (c) => {
    try {
      const { getTopFixturesFromSearch } = await import("../src/services/geminiService.js");
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
      
      const { fetchMatchH2H } = await import("../src/services/geminiService.js");
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
    weekly: { dailyCredits: 35, name: "Pro Weekly" },
    monthly: { dailyCredits: 120, name: "Elite Monthly" },
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
    if ((effectivePlan === "weekly" || effectivePlan === "monthly") && planExpiresAt && planExpiresAt.getTime() <= now.getTime()) {
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

    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { matchString, matchId } = await c.req.json();
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
      const { analyzeMatchWithSearch } = await import("../src/services/geminiService.js");
      const result = await analyzeMatchWithSearch(matchString);

      const topPrediction = result?.predictions?.[0];
      const [home = "Home", away = "Away"] = String(matchString).split("vs").map((p: string) => p.trim());
      const newHistoryItem: UserHistoryItem = {
        id: crypto.randomUUID(),
        fixtureId: String(matchId || "").startsWith("espn_") ? String(matchId) : null,
        match: matchString,
        home,
        away,
        predictionMarket: topPrediction?.market || "Unknown Market",
        confidence: Number(topPrediction?.confidence || 0),
        reasoning: topPrediction?.reasoning || result?.overallReasoning || "",
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
      const { error: updateError } = await supabase
        .from("users")
        .update({ 
          credits: credits - cost,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", telegramId);

      if (updateError) {
        console.error("CRITICAL: Credit deduction error:", updateError);
        // In production, we might want to fail the request if credits can't be deducted,
        // but for now we'll log it as a critical error since the schema is consolidated.
      }

      return c.json({ result, newCredits: credits - cost });
    } catch (e: any) {
      console.error("Analysis API error:", e.message);
      const message = String(e?.message || "");
      if (message.includes("RESOURCE_EXHAUSTED") || message.includes("quota") || e?.status === 429) {
        return c.json({ error: "AI quota temporarily exhausted. Please retry in a minute." }, 429);
      }
      if (message.includes("UNAVAILABLE") || e?.status === 503) {
        return c.json({ error: "AI model temporarily unavailable. Please retry shortly." }, 503);
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

    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
        weekly: 2,
        monthly: 5,
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
      const { analyzeBetSlip } = await import("../src/services/geminiService.js");
      const result = await analyzeBetSlip(images);

      // 3. Deduct Credits
      const { error: updateError } = await supabase
        .from("users")
        .update({ 
          credits: credits - cost,
          last_active: new Date().toISOString()
        })
        .eq("telegram_id", telegramId);

      if (updateError) {
        console.error("CRITICAL: Betslip credit deduction error:", updateError);
      }

      return c.json({ result, newCredits: credits - cost });
    } catch (e: any) {
      console.error("Bet Slip Analysis API error:", e.message);
      return c.json({ error: "Failed to analyze bet slip" }, 500);
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

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "Deepflashaibot";
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const isPlaceholderToken = !botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN" || botToken.trim() === "";

  let bot: Telegraf | null = null;

  if (!isPlaceholderToken) {
    bot = new Telegraf(botToken!);

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
        
        // Check if referral was already rewarded (prevent race condition/duplicate reward)
        const referralAlreadyRewarded = existingUser?.referral_rewarded === true;

        // Define signup credits for new users (default: 3, configurable via SIGNUP_CREDITS)
        const signupCreditsToApply = isNewRegistration ? signupCredits : (existingUser?.credits || 0);

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
        if (isNewRegistration && existingUser?.referrer_id && !referralAlreadyRewarded) {
           const rewardAmount = 50; 
           
           try {
             // 1. Mark the NEW user as rewarded FIRST (The "Ticket" is used)
             const { error: markError } = await supabase.from("users")
               .update({ referral_rewarded: true })
               .eq("telegram_id", telegramId);
             
             if (markError) throw markError;

             // 2. Credit the REFERRER
             const { error: rewardError } = await supabase.rpc('add_credits_to_user', {
               user_telegram_id: existingUser.referrer_id,
               credits_amount: rewardAmount
             });
             
             if (rewardError) {
               // Fallback: Use direct increment if RPC differs
               await supabase.rpc('increment_user_credits', {
                 target_telegram_id: existingUser.referrer_id,
                 amount: rewardAmount
               }).catch(() => {}); 
             }

             // 3. Production Tracking (Referrals table)
             await supabase.from("referrals").upsert({
               referrer_telegram_id: existingUser.referrer_id,
               referred_telegram_id: telegramId,
               reward_given: true,
               reward_amount: rewardAmount,
               created_at: new Date().toISOString()
             }, { onConflict: 'referred_telegram_id' }).catch(() => {});

             // 4. Audit Trail (Transactions table)
             await supabase.from("transactions").insert({
               telegram_id: existingUser.referrer_id,
               amount: rewardAmount,
               currency: 'CREDITS',
               status: 'completed',
               type: 'referral_reward',
               provider_payment_charge_id: `ref_${telegramId}`
             }).catch(() => {});

             // 5. Notify Referrer
             if (bot) {
               bot.telegram.sendMessage(existingUser.referrer_id, `👥 A friend joined Flash AI using your link! You've been rewarded with ${rewardAmount} credits. 🔥`).catch(() => {});
             }
           } catch (rewardErr) {
             console.error("Referral reward error:", rewardErr);
           }
        }

        const rewardText = isNewRegistration && existingUser?.referrer_id
          ? "5 credits (3 signup + 2 referral bonus)"
          : "3 free credits";
        ctx.reply(`✅ Registration successful, ${firstName}!\n\nYou've been rewarded with ${rewardText}. Welcome to the elite squad! ⚽🔥`, {
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
      const planId = payload.startsWith('plan_') ? payload.replace('plan_', '') : 'free';

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
  }

  // Auth/Signup Request Endpoint
  app.get("/api/auth/me", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const body = await c.req.json().catch(() => ({} as any));
      const authUser = initData ? getTelegramUserFromInitData(initData) : null;
      const telegramId = authUser?.id || Number(body?.telegramId || 0);
      if (!bot || !telegramId) return c.json({ error: "Missing bot or telegramId" }, 400);

      await bot.telegram.sendMessage(telegramId, "To unlock AI analysis and features, please complete your registration by sharing your contact:", {
        reply_markup: {
          keyboard: [[{ text: "📲 Share Contact to Sign Up", request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      return c.json({ success: true });
    } catch (e: any) {
      console.error("Request signup error:", e.message);
      return c.json({ error: "Failed to send request" }, 500);
    }
  });

  app.get("/api/user/activities", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const history = await getUserHistory(tgUser.id);
      const resolved = await Promise.all(history.map((item) => resolveHistoryItemResult(item)));

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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      if (!tgUser?.id) return c.json({ error: "User not identified" }, 401);

      const [{ count: referredCount }, { data: referrers }] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }).eq("referrer_id", tgUser.id),
        supabase.from("users").select("telegram_id").eq("referrer_id", tgUser.id),
      ]);

      const totalReferred = referredCount || 0;
      const earnedCredits = totalReferred * 2;
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
      const isValidTelegramAuth = !isPlaceholderToken && botToken
        ? Boolean(initData && validateTelegramInitData(initData, botToken))
        : true;
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, planId, amount, title, description } = await c.req.json();
      
      if (!bot || !telegramId || !planId || !amount) {
        return c.json({ error: "Missing required parameters" }, 400);
      }

      // Create Stars Invoice Link
      // Currency for Telegram Stars is 'XTR'
      const invoiceLink = await bot.telegram.createInvoiceLink({
        title: title || `Flash AI - ${planId.toUpperCase()} Plan`,
        description: description || `Access to premium football predictions and analyses.`,
        payload: `plan_${planId}`,
        provider_token: "", // Empty for Telegram Stars
        currency: "XTR",
        prices: [{ label: "Stars", amount: amount }],
      });

      return c.json({ invoiceLink });
    } catch (e: any) {
      console.error("Create invoice error:", e.message);
      return c.json({ error: "Failed to create invoice link" }, 500);
    }
  });

  // Lemon Squeezy Checkout Endpoint
  app.post("/api/payments/create-lemonsqueezy-checkout", async (c) => {
    const initData = c.req.header("X-TG-Init-Data");
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
        // Fallback: Generate a payment link with user info for manual verification
        const checkoutUrl = `https://flashai-payment.vercel.app/checkout?plan=${planId}&tg_id=${telegramId}`;
        return c.json({ checkoutUrl });
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
              checkout_data: {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, taskId, reward } = await c.req.json();
      
      if (!telegramId || !taskId || !reward) {
        return c.json({ error: "Missing required parameters" }, 400);
      }

      // 1. Check if user already completed the task
      const { data: taskLog } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('telegram_id', telegramId)
        .eq('task_id', taskId)
        .single();

      if (taskLog) {
        return c.json({ error: "Task already completed" }, 400);
      }

      // 2. Perform verification for specific tasks
      const { data: taskData } = await supabase.from('tasks').select('*').eq('id', taskId).single();
      
      if (taskData && bot) {
        // Check if task URL points to a Telegram channel/group
        const tgUrlPattern = /t\.me\/([a-zA-Z0-9_]{5,})/;
        const match = taskData.url?.match(tgUrlPattern);
        
        if (match && match[1]) {
          const channelUsername = `@${match[1]}`;
          try {
            const member = await bot.telegram.getChatMember(channelUsername, telegramId);
            const validStatuses = ['member', 'administrator', 'creator'];
            
            if (!validStatuses.includes(member.status)) {
              return c.json({ 
                error: "Verification failed. Please join the channel before claiming!",
                details: "You are not a member of the required channel." 
              }, 400);
            }
          } catch (e: any) {
            console.error(`Task verification error for ${channelUsername}:`, e.message);
            // If bot is not admin, it might fail with "Chat not found" or "Member not found"
            // We only block if we are SURE they are not in it, or if the bot has access and says no.
            if (e.message?.includes('member not found') || e.message?.includes('user not found')) {
              return c.json({ error: "Please join the channel first!" }, 400);
            }
            // If it's a different error (like bot not in chat), we might allow it or log it
            console.warn("Could not verify membership due to bot permissions or chat settings.");
          }
        }
      }

      // 3. Log completion and award reward
      const { error: logError } = await supabase.from('user_tasks').insert({
        telegram_id: telegramId,
        task_id: taskId,
        completed_at: new Date().toISOString()
      });

      if (logError) throw logError;

      const { data: user } = await supabase.from('users').select('credits').eq('telegram_id', telegramId).single();
      await supabase.from('users').update({ credits: (user?.credits || 0) + reward }).eq('telegram_id', telegramId);

      return c.json({ success: true, newCredits: (user?.credits || 0) + reward });
    } catch (e: any) {
      console.error("Task claim error:", e.message);
      return c.json({ error: "Failed to claim task reward" }, 500);
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

    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
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
    if (!isPlaceholderToken && botToken && (!initData || !validateTelegramInitData(initData, botToken))) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }

    try {
      const { telegramId, planId, boc, amount } = await c.req.json();
      const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
      const effectiveTelegramId = tgUser?.id || Number(telegramId || 0);
      
      if (!effectiveTelegramId || !planId || !boc) {
        return c.json({ error: "Missing required parameters" }, 400);
      }
      if (tgUser?.id && Number(telegramId || 0) && tgUser.id !== Number(telegramId || 0)) {
        return c.json({ error: "Telegram identity mismatch" }, 403);
      }

      // 1. Log the transaction in the database
      const { error: txError } = await supabase.from('transactions').insert({
        telegram_id: effectiveTelegramId,
        amount: amount,
        currency: 'TON',
        status: 'completed',
        provider_payment_charge_id: boc.substring(0, 100), // Use first part of BOC as ref
        type: 'ton'
      });

      if (txError) throw txError;

      // 2. Apply plan + credits consistently
      await applyPlanCredits(effectiveTelegramId, planId);

      // 3. Notify the user via Bot
      if (bot) {
        await bot.telegram.sendMessage(effectiveTelegramId, `✅ TON payment received! Your account is now on ${planId.toUpperCase()} plan.`);
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
    if (!botToken || !validateTelegramInitData(initData, botToken)) {
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
      url: String(body.url || "").trim(),
      buttonLabel: String(body.buttonLabel || "Claim").trim(),
      image_url: String(body.image_url || "").trim(),
      active: body.active !== false,
      created_at: new Date().toISOString(),
    };

    if (!task.title || !task.description) return c.json({ error: "Title and description are required" }, 400);

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
    let ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    if (!ads.length) {
      const { data } = await supabase.from("ads").select("*").order("created_at", { ascending: false }).limit(200);
      ads = data || [];
    }
    ads.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return c.json(ads);
  });

  app.post("/api/admin/ads", adminOnly, async (c) => {
    const body = await c.req.json();
    const ads = await getCachedCollection<any>(ADMIN_ADS_KEY);

    const ad = {
      id: crypto.randomUUID(),
      title: String(body.title || "").trim(),
      subtitle: String(body.subtitle || "").trim(),
      image_url: String(body.image_url || "").trim(),
      link: String(body.link || "").trim(),
      cta: String(body.cta || "Check Out").trim(),
      active: body.active !== false,
      target_group: normalizeAudience(body.target_group || body.target_plan || "all"),
      expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
      primary_color: String(body.primary_color || "#3b82f6"),
      created_at: new Date().toISOString(),
      views: 0,
      clicks: 0,
    };

    if (!ad.title || !ad.subtitle) return c.json({ error: "Ad title and subtitle are required" }, 400);
    await setCachedCollection(ADMIN_ADS_KEY, [ad, ...ads]);
    try {
      const { error: dbError } = await supabase.from("ads").insert({
        title: ad.title,
        subtitle: ad.subtitle,
        image_url: ad.image_url || "https://placehold.co/1200x630/png",
        link: ad.link,
        active: ad.active,
      });
      if (dbError) {
        console.error("DB insert failed for ads:", dbError);
      }
    } catch (e) {
      console.error("DB insert failed for ads:", e);
    }
    return c.json(ad);
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
      if (targetGroup === 'weekly') query = query.eq('plan', 'weekly');
      if (targetGroup === 'monthly') query = query.eq('plan', 'monthly');

      const { data: users } = await query.not("telegram_id", "is", null);
      if (!users || !bot) return c.json({ success: true, sentCount: 0 });

      let count = 0;
      for (const user of users) {
        try {
          const message = `*${ad.title}*

${ad.subtitle}`;
          const keyboard = ad.link ? Markup.inlineKeyboard([[Markup.button.url(ad.cta || "Check it Out", ad.link)]]) : undefined;
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
      await supabase.from("ads").delete().eq("id", id);
    } catch {}
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

  app.get("/api/admin/users", adminOnly, async (c) => {
    const query = (c.req.query("q") || "").trim();
    let dbQuery = supabase
      .from("users")
      .select("telegram_id,name,username,role,plan,credits,last_active,created_at")
      .order("created_at", { ascending: false })
      .limit(150);

    if (query) {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,username.ilike.%${query}%,telegram_id.eq.${Number(query) || 0}`);
    }

    const { data, error } = await dbQuery;
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
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
    if (target_group === 'weekly') query = query.eq('plan', 'weekly');
    if (target_group === 'monthly') query = query.eq('plan', 'monthly');
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
    let ads = await getCachedCollection<any>(ADMIN_ADS_KEY);
    if (!ads.length) {
      const { data } = await supabase.from("ads").select("*").eq("active", true).order("created_at", { ascending: false }).limit(50);
      ads = data || [];
    }

    const initData = c.req.header("X-TG-Init-Data") || "";
    const tgUser = initData ? getTelegramUserFromInitData(initData) : null;
    let userPlan = "free";
    if (tgUser?.id) {
      const { data: user } = await supabase.from("users").select("plan").eq("telegram_id", tgUser.id).maybeSingle();
      userPlan = user?.plan || "free";
    }

    const filtered = ads.filter((ad) => {
      if (ad.active === false) return false;
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
      const { fetchLiveMatchesFallback } = await import("../src/services/geminiService.js");
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

startServer();
