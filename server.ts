import express from "express";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl === "YOUR_SUPABASE_URL") {
  console.warn("⚠️ Supabase configuration is missing or using placeholders.");
  console.warn("👉 Please add SUPABASE_URL and SUPABASE_ANON_KEY to your Secrets.");
}

const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseKey || "placeholder");

async function startServer() {
  const app = express();
  const PORT = 3000;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  const isPlaceholderToken = !botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN" || botToken.trim() === "";

  let bot: Telegraf | null = null;

  if (!isPlaceholderToken) {
    bot = new Telegraf(botToken!);

    bot.start(async (ctx) => {
      const telegramId = ctx.from.id;
      
      if (!supabaseUrl || !supabaseKey || supabaseUrl === "YOUR_SUPABASE_URL") {
        return ctx.reply("⚠️ App configuration incomplete. Please contact the administrator to set up Supabase.");
      }

      try {
        // Check if user exists in Supabase
        const { data: user, error } = await supabase
          .from("users")
          .select("*")
          .eq("telegram_id", telegramId)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("❌ Supabase Query Error:", JSON.stringify(error, null, 2));
          return ctx.reply("❌ Database error. Please ensure the 'users' table exists in Supabase.");
        }

        if (user) {
          if (user.role === "admin") {
            ctx.reply(
              `Welcome back, Admin ${user.full_name}! 🛠️`,
              Markup.inlineKeyboard([
                [Markup.button.webApp("Open Admin Panel", `${appUrl}?startapp=admin`)],
              ])
            );
          } else {
            ctx.reply(
              `Welcome back, ${user.full_name}! ⚽️`,
              Markup.inlineKeyboard([
                [Markup.button.webApp("Open Flash AI", `${appUrl}?startapp=main`)],
              ])
            );
          }
        } else {
          // New user
          ctx.reply(
            "Welcome to Flash AI! ⚽️\n\nYour powerful AI football match predictor. Let's get you started.",
            Markup.inlineKeyboard([
              [Markup.button.webApp("Get Started", `${appUrl}?startapp=onboarding`)],
            ])
          );
        }
      } catch (err) {
        console.error("❌ Unexpected Database Error:", err);
        ctx.reply("An unexpected error occurred. Please try again later.");
      }
    });

    // Handle contact sharing for registration
    bot.on("contact", async (ctx) => {
      const contact = ctx.message.contact;
      const telegramId = contact.user_id;

      if (telegramId !== ctx.from.id) {
        return ctx.reply("Please share your own contact.");
      }

      try {
        const { error } = await supabase.from("users").insert([
          {
            telegram_id: telegramId,
            username: ctx.from.username || "",
            full_name: `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim(),
            phone_number: contact.phone_number,
            role: "user",
          },
        ]);

        if (error) {
          console.error("❌ Supabase Insert Error:", JSON.stringify(error, null, 2));
          return ctx.reply("❌ Failed to register. Please ensure the 'users' table is correctly configured.");
        }

        ctx.reply(
          "Registration successful! 🎉\nNow you can access Flash AI.",
          Markup.inlineKeyboard([
            [Markup.button.webApp("Open Flash AI", `${appUrl}?startapp=main`)],
          ])
        );
      } catch (err) {
        console.error("Registration error:", err);
        ctx.reply("Failed to register. Please try again.");
      }
    });

    bot.launch().then(() => {
      console.log("✅ Telegram bot launched successfully");
    }).catch(err => {
      if (err.response && err.response.error_code === 401) {
        console.error("❌ Telegram Bot Error: 401 Unauthorized. Your TELEGRAM_BOT_TOKEN is invalid.");
      } else {
        console.error("❌ Failed to launch Telegram bot:", err);
      }
    });

    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN is missing or using placeholder. Bot will not start.");
  }

  app.use(express.json());

  app.post("/api/request-contact", async (req, res) => {
    const { telegramId } = req.body;
    if (!bot || !telegramId) return res.status(400).json({ error: "Bot not initialized or missing ID" });

    try {
      await bot.telegram.sendMessage(
        telegramId,
        "To complete your registration, please share your contact details using the button below.",
        Markup.keyboard([
          [Markup.button.contactRequest("Share Contact")],
        ]).oneTime().resize()
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Error sending contact request:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
