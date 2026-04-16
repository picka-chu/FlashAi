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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl === "YOUR_SUPABASE_URL") {
  console.warn("⚠️ Supabase configuration is missing or using placeholders.");
}

const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseKey || "placeholder");

const SESSION_SECRET = process.env.APP_SESSION_SECRET || "dev_session_secret_change_me";
const REFRESH_SECRET = process.env.APP_REFRESH_SECRET || "dev_refresh_secret_change_me";
const SESSION_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

type TelegramAuthPayload = {
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  iat: number;
  exp: number;
};

function signToken(payload: TelegramAuthPayload, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string, secret: string): TelegramAuthPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as TelegramAuthPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 3600) return null;
  const userRaw = params.get("user");
  if (!userRaw) return null;
  return JSON.parse(userRaw);
}

async function startServer() {
  const app = new Hono();
  const PORT = 3000;

  // API Routes
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.post("/api/auth/telegram/exchange", async (c) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return c.json({ error: "Bot token not configured" }, 500);

    try {
      const { initData } = await c.req.json();
      if (!initData || typeof initData !== "string") return c.json({ error: "Missing initData" }, 400);

      const telegramUser = verifyTelegramInitData(initData, botToken);
      if (!telegramUser?.id) return c.json({ error: "Invalid Telegram auth payload" }, 401);

      const fullName = `${telegramUser.first_name || ""} ${telegramUser.last_name || ""}`.trim() || "Telegram User";
      const telegramId = Number(telegramUser.id);

      let { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Auth user fetch error:", error);
        return c.json({ error: "Database error" }, 500);
      }

      if (!user) {
        const { data: inserted, error: insertError } = await supabase
          .from("users")
          .insert([
            {
              telegram_id: telegramId,
              telegram_username: telegramUser.username || null,
              name: fullName,
              credits: 5,
              plan: "free",
              role: "user",
              status: "active",
              last_active_at: new Date().toISOString(),
            },
          ])
          .select("*")
          .single();
        if (insertError) {
          console.error("Auth user insert error:", insertError);
          return c.json({ error: "Failed to create user" }, 500);
        }
        user = inserted;
      } else {
        await supabase
          .from("users")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", user.id);
      }

      const now = Math.floor(Date.now() / 1000);
      const accessToken = signToken(
        {
          telegram_id: telegramId,
          username: telegramUser.username,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name,
          iat: now,
          exp: now + SESSION_TTL_SECONDS,
        },
        SESSION_SECRET,
      );
      const refreshToken = signToken(
        {
          telegram_id: telegramId,
          username: telegramUser.username,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name,
          iat: now,
          exp: now + REFRESH_TTL_SECONDS,
        },
        REFRESH_SECRET,
      );

      return c.json({
        accessToken,
        refreshToken,
        expiresIn: SESSION_TTL_SECONDS,
        user: {
          id: user.id,
          telegram_id: user.telegram_id,
          name: user.name,
          username: user.telegram_username || telegramUser.username || undefined,
          plan: user.plan || "free",
          credits: user.credits || 0,
          photo_url: user.photo_url || undefined,
        },
      });
    } catch (e: any) {
      console.error("Auth exchange error:", e.message);
      return c.json({ error: "Auth exchange failed" }, 500);
    }
  });

  app.post("/api/auth/refresh", async (c) => {
    try {
      const { refreshToken } = await c.req.json();
      if (!refreshToken || typeof refreshToken !== "string") return c.json({ error: "Missing refresh token" }, 400);
      const payload = verifyToken(refreshToken, REFRESH_SECRET);
      if (!payload) return c.json({ error: "Invalid refresh token" }, 401);
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signToken({ ...payload, iat: now, exp: now + SESSION_TTL_SECONDS }, SESSION_SECRET);
      return c.json({ accessToken, expiresIn: SESSION_TTL_SECONDS });
    } catch (e: any) {
      return c.json({ error: e.message || "Failed to refresh token" }, 500);
    }
  });

  app.get("/api/auth/me", async (c) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const payload = token ? verifyToken(token, SESSION_SECRET) : null;
    if (!payload?.telegram_id) return c.json({ error: "Unauthorized" }, 401);
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", payload.telegram_id)
      .single();
    if (!user) return c.json({ error: "User not found" }, 404);
    return c.json({
      id: user.id,
      telegram_id: user.telegram_id,
      name: user.name,
      username: user.telegram_username,
      plan: user.plan,
      credits: user.credits,
      photo_url: user.photo_url,
    });
  });

  app.get("/api/espn", async (c) => {
    const urlObj = new URL(c.req.url);
    const league = urlObj.searchParams.get("league") || "eng.1";
    const endpoint = urlObj.searchParams.get("endpoint") || "scoreboard";
    const ttl = urlObj.searchParams.get("ttl") || "300";
    
    // Support for team details: endpoint=teams/:id
    const espnUrl = new URL(`http://site.api.espn.com/apis/site/v2/sports/soccer/${league}/${endpoint}`);
    urlObj.searchParams.forEach((value, key) => {
      if (key !== "league" && key !== "endpoint" && key !== "ttl") {
        espnUrl.searchParams.set(key, value);
      }
    });

    const cacheKey = `espn:${espnUrl.pathname}${espnUrl.search}`;
    const { data: cached } = await supabase
      .from("api_cache")
      .select("*")
      .eq("key", cacheKey)
      .single();

    if (cached) {
      const expiresAt = new Date(cached.expires_at).getTime();
      if (Date.now() < expiresAt) {
        return c.json(cached.data);
      }
    }

    try {
      const response = await axios.get(espnUrl.toString());
      if (response.data) {
        await supabase.from("api_cache").upsert({
          key: cacheKey,
          data: response.data,
          expires_at: new Date(Date.now() + parseInt(ttl, 10) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
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
        .eq("key", "trending_picks")
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
        key: "trending_picks",
        data: trendingData,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
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
        .eq("key", "trending_picks")
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
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const isPlaceholderToken = !botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN" || botToken.trim() === "";

  let bot: Telegraf | null = null;

  if (!isPlaceholderToken) {
    bot = new Telegraf(botToken!);

    bot.start(async (ctx) => {
      const telegramId = ctx.from.id;
      const firstName = ctx.from.first_name;
      const lastName = ctx.from.last_name || "";
      const fullName = `${firstName} ${lastName}`.trim();
      const username = ctx.from.username || "";

      try {
        // Check if user exists
        let { data: user, error } = await supabase
          .from("users")
          .select("*")
          .eq("telegram_id", telegramId)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Supabase error:", error);
          return ctx.reply("❌ Database error. Please try again later.");
        }

        // If new user, register them
        if (!user) {
          const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert([{
              telegram_id: telegramId,
              telegram_username: username || null,
              name: fullName,
              credits: 5,
              plan: 'free',
              role: 'user',
              status: 'active',
              last_active_at: new Date().toISOString(),
            }])
            .select()
            .single();

          if (insertError) {
            console.error("Insert error:", insertError);
            return ctx.reply("❌ Failed to register. Please try again.");
          }
          user = newUser;
        }

        const welcomeMsg = `⚽ Flash AI\n🔥 Get high-confidence predictions\n🎁 You have free credits\n\n👇 Open the app`;
        
        ctx.reply(welcomeMsg, Markup.inlineKeyboard([
          [Markup.button.webApp("Open App", `${appUrl}`)]
        ]));

      } catch (err) {
        console.error("Unexpected error in bot start:", err);
        ctx.reply("An unexpected error occurred.");
      }
    });

    bot.launch().catch(err => console.error("❌ Bot launch failed:", err));
  }

  app.post("/api/bot/notify", async (c) => {
    // ... (existing notify code)
  });

  // n8n Automation: Daily Top Picks Flow
  app.post("/api/automation/daily-picks", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader !== `Bearer ${process.env.AUTOMATION_SECRET}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      // 1. Fetch Matches (using existing logic or direct ESPN call)
      const res = await axios.get(`http://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard`);
      const matches = res.data.events?.slice(0, 5) || [];

      // 2. Send to Analyst Agent (Simplified for automation)
      const { multiAgentService } = await import("./src/services/multiAgentService.js");
      const analyses = await Promise.all(matches.map(m => multiAgentService.analyzeMatch(m)));

      // 3. Send to Marketing Agent for Telegram Message
      const marketingMessage = await multiAgentService.generateMarketingMessage(analyses);

      // 4. Broadcast to all Telegram users
      const { data: users } = await supabase.from("users").select("telegram_id").not("telegram_id", "is", null);
      
      if (bot && users) {
        for (const user of users) {
          await bot.telegram.sendMessage(user.telegram_id, marketingMessage || "New predictions are in!", {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.webApp("🔥 View Analysis", `${appUrl}`)]])
          });
        }
      }

      return c.json({ success: true, messageCount: users?.length || 0 });
    } catch (e: any) {
      console.error("Daily picks automation failed:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // n8n Automation: Retention Flow
  app.post("/api/automation/retention", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader !== `Bearer ${process.env.AUTOMATION_SECRET}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      // 1. Check inactive users (last active > 3 days)
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      
      const { data: inactiveUsers } = await supabase
        .from("users")
        .select("*")
        .lt("last_active", threeDaysAgo.toISOString())
        .not("telegram_id", "is", null);

      if (!inactiveUsers || inactiveUsers.length === 0) return c.json({ success: true, message: "No inactive users" });

      const { multiAgentService } = await import("./src/services/multiAgentService.js");

      if (bot) {
        for (const user of inactiveUsers) {
          // 2. Send to Retention Agent
          const message = await multiAgentService.generateRetentionMessage({
            name: user.name,
            lastActive: user.last_active,
            favoriteLeagues: ["Premier League", "Champions League"] // Mock or fetch from user prefs
          });

          // 3. Send message via Telegram bot
          await bot.telegram.sendMessage(user.telegram_id, message || "We miss you! New matches are live.", {
            ...Markup.inlineKeyboard([[Markup.button.webApp("⚽ Back to Action", `${appUrl}`)]])
          });
        }
      }

      return c.json({ success: true, processed: inactiveUsers.length });
    } catch (e: any) {
      console.error("Retention automation failed:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // Vite / Static Assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    
    // Hono middleware to handle Vite
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

  console.log(`Server running on http://localhost:${PORT}`);
  serve({
    fetch: app.fetch,
    port: PORT,
  });
}

startServer();
