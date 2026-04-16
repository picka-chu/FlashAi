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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl === "YOUR_SUPABASE_URL") {
  console.warn("⚠️ Supabase configuration is missing or using placeholders.");
}

const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseKey || "placeholder");

async function startServer() {
  const app = new Hono();
  const PORT = 3000;

  // API Routes
  app.get("/api/health", (c) => c.json({ status: "ok" }));

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
              name: fullName,
              credits: 5,
              plan: 'free',
              role: 'user'
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
