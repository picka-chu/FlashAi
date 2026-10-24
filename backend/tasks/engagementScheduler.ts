import type { SupabaseClient } from "@supabase/supabase-js";
import { Markup, type Telegraf } from "telegraf";
import { getFootballNews, getLiveMatches, getUpcomingMatches } from "../services/footballService.js";
import {
  escapeHtml,
  NotificationService,
  type NotificationPreferences,
} from "../services/notificationService.js";

interface EngagementSchedulerOptions {
  supabase: SupabaseClient;
  bot: Telegraf | null;
  appUrl: string;
}

const MINUTE = 60_000;
const TICK_INTERVAL = 5 * MINUTE;
const LIVE_INTERVAL = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function utcTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isoWeekKey(date = new Date()): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isWindow(hour: number, minute: number, targetHour: number, targetMinute = 0, windowMinutes = 30): boolean {
  const current = hour * 60 + minute;
  const target = targetHour * 60 + targetMinute;
  return current >= target && current < target + windowMinutes;
}

function safeFixtureId(value: unknown): string {
  return String(value || "").trim().slice(0, 64);
}

export class EngagementScheduler {
  private readonly notifications: NotificationService;
  private dailyTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private runningDaily = false;
  private runningLive = false;
  private stopped = false;

  constructor(private readonly options: EngagementSchedulerOptions) {
    this.notifications = new NotificationService(options.supabase, options.bot);
  }

  start(): void {
    if (this.dailyTimer || this.liveTimer) return;
    this.stopped = false;

    this.dailyTimer = setInterval(() => {
      this.tickDaily().catch((error) => console.error("Engagement daily tick failed:", error));
    }, TICK_INTERVAL);
    this.dailyTimer.unref?.();

    this.liveTimer = setInterval(() => {
      this.runLiveAlerts().catch((error) => console.error("Engagement live tick failed:", error));
    }, LIVE_INTERVAL);
    this.liveTimer.unref?.();

    this.tickDaily().catch((error) => console.error("Engagement daily tick failed:", error));
    console.log("🔔 Engagement notification scheduler started.");
  }

  stop(): void {
    this.stopped = true;
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.dailyTimer = null;
    this.liveTimer = null;
  }

  async runNow(job: "daily_fixtures" | "news_digest" | "weekly_recap" | "marketing" | "live_alerts"): Promise<any> {
    switch (job) {
      case "daily_fixtures":
        return this.runDailyFixtures();
      case "news_digest":
        return this.runNewsDigest();
      case "weekly_recap":
        return this.runWeeklyRecap();
      case "marketing":
        return this.runMarketing();
      case "live_alerts":
        return this.runLiveAlerts();
      default:
        return { skipped: true };
    }
  }

  private async tickDaily(): Promise<void> {
    if (this.stopped || this.runningDaily) return;
    this.runningDaily = true;
    try {
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();

      if (isWindow(hour, minute, 8)) {
        await this.runDailyFixtures();
      }
      if (isWindow(hour, minute, 17)) {
        await this.runNewsDigest();
      }
      if (isWindow(hour, minute, 16, 0, 45)) {
        await this.runMarketing();
      }
      if (now.getUTCDay() === 1 && isWindow(hour, minute, 10)) {
        await this.runWeeklyRecap();
      }
    } finally {
      this.runningDaily = false;
    }
  }

  private async getAudience(): Promise<Array<{ telegram_id: number; name?: string; credits?: number; plan?: string; last_active?: string; created_at?: string }>> {
    const { data, error } = await this.options.supabase
      .from("users")
      .select("telegram_id,name,credits,plan,last_active,created_at")
      .not("telegram_id", "is", null)
      .eq("is_suspended", false)
      .order("telegram_id", { ascending: true })
      .limit(1000);
    if (error) {
      console.error("Notification audience query failed:", error.message);
      return [];
    }
    return (data || []).filter((user: any) => Number.isSafeInteger(Number(user.telegram_id)));
  }

  private async preferenceMap(users: Array<{ telegram_id: number }>): Promise<Map<number, NotificationPreferences>> {
    return this.notifications.getPreferenceMap(users.map((user) => Number(user.telegram_id)));
  }

  private async sendBatch(
    users: Array<{ telegram_id: number; [key: string]: any }>,
    preferences: Map<number, NotificationPreferences>,
    category: "daily_fixtures" | "news_digest" | "weekly_recap" | "marketing",
    dedupeKey: string,
    build: (user: any) => { text: string; keyboard?: any } | null,
  ): Promise<number> {
    let sent = 0;
    for (const user of users) {
      if (this.stopped) break;
      const telegramId = Number(user.telegram_id);
      const payload = build(user);
      if (!payload) continue;
      const result = await this.notifications.send({
        telegramId,
        category,
        dedupeKey,
        text: payload.text,
        keyboard: payload.keyboard,
        preferences:
          preferences.get(telegramId) || {
            telegram_id: telegramId,
            ...this.notifications.getDefaultPreferences(),
          },
      });
      if (result.sent) {
        sent += 1;
        if (sent % 20 === 0) await sleep(1000);
      }
    }
    return sent;
  }

  async runDailyFixtures(): Promise<{ sent: number; fixtures: number }> {
    const today = dateKey();
    try {
      const matches = (await getUpcomingMatches())
        .filter((match: any) => String(match?.fixture?.date || "").startsWith(today))
        .filter((match: any) => match?.fixture?.status?.state !== "post")
        .slice(0, 5);

      if (!matches.length) return { sent: 0, fixtures: 0 };

      const users = await this.getAudience();
      if (!users.length) return { sent: 0, fixtures: matches.length };
      const preferences = await this.preferenceMap(users);

      const featured = matches[0];
      const featuredName = `${featured?.teams?.home?.name || "Home"} vs ${featured?.teams?.away?.name || "Away"}`;
      const featuredId = safeFixtureId(featured?.fixture?.id);

      const lines = matches.map((match: any) => {
        const home = escapeHtml(match?.teams?.home?.name || "Home");
        const away = escapeHtml(match?.teams?.away?.name || "Away");
        const league = escapeHtml(match?.league?.name || "Football");
        return `• <b>${utcTime(match?.fixture?.date)}</b> — ${home} vs ${away} <i>(${league})</i>`;
      });

      const text =
        `⚽ <b>Today's football slate</b>\n\n${lines.join("\n")}\n\n` +
        `🎯 <b>Featured:</b> ${escapeHtml(featuredName)}\n\n` +
        `Open Flash AI for AI picks, live scores and match analysis.`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp("⚡ Analyze today's matches", this.options.appUrl)],
        featuredId && `alert:${featuredId}`.length <= 64
          ? [Markup.button.callback("🔔 Alert me on this match", `alert:${featuredId}`)]
          : [],
        [Markup.button.callback("⚙️ Notification settings", "pref:menu")],
      ].filter((row) => row.length > 0));

      const sent = await this.sendBatch(
        users,
        preferences,
        "daily_fixtures",
        `daily_fixtures:${today}`,
        () => ({ text, keyboard }),
      );
      console.log(`[engagement] daily fixtures sent to ${sent}/${users.length} users.`);
      return { sent, fixtures: matches.length };
    } catch (error: any) {
      console.error("Daily fixtures notification failed:", error?.message || error);
      return { sent: 0, fixtures: 0 };
    }
  }

  async runNewsDigest(): Promise<{ sent: number; articles: number }> {
    const today = dateKey();
    try {
      const articles = await getFootballNews(3);
      if (!articles.length) return { sent: 0, articles: 0 };

      const users = await this.getAudience();
      if (!users.length) return { sent: 0, articles: articles.length };
      const preferences = await this.preferenceMap(users);

      const lines = articles.map((article: any) => {
        const title = escapeHtml(article.headline);
        const league = escapeHtml(article.league || "Football");
        return `• <a href="${escapeHtml(article.url)}">${title}</a>\n  <i>${league} • ${escapeHtml(article.source || "ESPN")}</i>`;
      });
      const text = `📰 <b>Football feed</b>\n\nThe stories worth knowing today:\n\n${lines.join("\n\n")}`;
      const keyboard = Markup.inlineKeyboard([
        ...articles.slice(0, 3).map((article: any, index: number) => [
          Markup.button.url(`Read story ${index + 1}`, article.url),
        ]),
        [Markup.button.webApp("Open Flash AI", this.options.appUrl)],
        [Markup.button.callback("⚙️ Notification settings", "pref:menu")],
      ]);

      const sent = await this.sendBatch(
        users,
        preferences,
        "news_digest",
        `news_digest:${today}`,
        () => ({ text, keyboard }),
      );
      console.log(`[engagement] news digest sent to ${sent}/${users.length} users.`);
      return { sent, articles: articles.length };
    } catch (error: any) {
      console.error("News digest notification failed:", error?.message || error);
      return { sent: 0, articles: 0 };
    }
  }

  async runWeeklyRecap(): Promise<{ sent: number }> {
    const week = isoWeekKey();
    try {
      const users = await this.getAudience();
      if (!users.length) return { sent: 0 };
      const preferences = await this.preferenceMap(users);

      const sent = await this.sendBatch(
        users,
        preferences,
        "weekly_recap",
        `weekly_recap:${week}`,
        (user) => {
          const name = escapeHtml(String(user.name || "there").split(" ")[0] || "there");
          const credits = Math.max(0, Number(user.credits || 0));
          const text =
            `📊 <b>Your weekly Flash AI recap</b>\n\n` +
            `Hey ${name}, a new football week is here.\n\n` +
            `💎 Credits available: <b>${credits}</b>\n` +
            `⚽ Fresh fixtures and live scores are ready.\n\n` +
            `Stay sharp and make this week count.`;
          return {
            text,
            keyboard: Markup.inlineKeyboard([
              [Markup.button.webApp("⚡ Open Flash AI", this.options.appUrl)],
              [Markup.button.callback("Turn off weekly recap", "pref:off:weekly_recap")],
            ]),
          };
        },
      );
      console.log(`[engagement] weekly recap sent to ${sent}/${users.length} users.`);
      return { sent };
    } catch (error: any) {
      console.error("Weekly recap notification failed:", error?.message || error);
      return { sent: 0 };
    }
  }

  async runMarketing(): Promise<{ sent: number }> {
    const now = new Date();
    const week = isoWeekKey(now);
    try {
      const users = await this.getAudience();
      if (!users.length) return { sent: 0 };
      const preferences = await this.preferenceMap(users);

      const inactiveCutoff = now.getTime() - 3 * 86_400_000;
      const staleCutoff = now.getTime() - 30 * 86_400_000;
      const twoDaysAgo = now.getTime() - 2 * 86_400_000;

      const winback = users.filter((user) => {
        const lastActive = user.last_active ? new Date(user.last_active).getTime() : 0;
        return lastActive > staleCutoff && lastActive < inactiveCutoff;
      });
      const upgrade = users.filter((user) => {
        const lastActive = user.last_active ? new Date(user.last_active).getTime() : 0;
        const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
        return (
          user.plan === "free" &&
          Number(user.credits || 0) <= 1 &&
          lastActive > inactiveCutoff &&
          createdAt > 0 &&
          createdAt < twoDaysAgo
        );
      });

      let sent = 0;
      if (winback.length) {
        sent += await this.sendBatch(
          winback,
          preferences,
          "marketing",
          `winback:${week}`,
          (user) => {
            const name = escapeHtml(String(user.name || "there").split(" ")[0] || "there");
            return {
              text:
                `👋 <b>We saved your spot, ${name}</b>\n\n` +
                `New fixtures, live scores and AI picks are waiting.\n` +
                `Your daily credits are ready — one tap gets you back in the game.`,
              keyboard: Markup.inlineKeyboard([
                [Markup.button.webApp("⚡ Jump back in", this.options.appUrl)],
                [Markup.button.callback("Pause offers", "pref:off:marketing")],
              ]),
            };
          },
        );
      }

      if (upgrade.length) {
        sent += await this.sendBatch(
          upgrade,
          preferences,
          "marketing",
          `upgrade:${dateKey(now)}`,
          () => ({
            text:
              `⚡ <b>You're out of credits for today</b>\n\n` +
              `Upgrade to keep the analysis coming:\n` +
              `• Monthly Basic — 10 daily credits + 2 betslips\n` +
              `• Monthly Pro — 16 daily credits + 6 betslips\n\n` +
              `Plans start at $8.99/month.`,
            keyboard: Markup.inlineKeyboard([
              [Markup.button.webApp("💎 View plans", `${this.options.appUrl}?tab=profile`)],
              [Markup.button.callback("Pause offers", "pref:off:marketing")],
            ]),
          }),
        );
      }

      console.log(`[engagement] marketing sent to ${sent} users (winback=${winback.length}, upgrade=${upgrade.length}).`);
      return { sent };
    } catch (error: any) {
      console.error("Marketing notification failed:", error?.message || error);
      return { sent: 0 };
    }
  }

  async runLiveAlerts(): Promise<{ sent: number; tracked: number }> {
    if (this.stopped || this.runningLive) return { sent: 0, tracked: 0 };
    this.runningLive = true;
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
      const windowEnd = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

      const { data: subscriptions, error } = await this.options.supabase
        .from("match_alert_subscriptions")
        .select("telegram_id,fixture_id,home,away,league,kickoff")
        .eq("active", true)
        .gte("kickoff", windowStart)
        .lte("kickoff", windowEnd)
        .limit(500);

      if (error || !subscriptions?.length) return { sent: 0, tracked: 0 };

      const matches = await getLiveMatches();
      const matchMap = new Map<string, any>();
      for (const match of matches as any[]) {
        const id = String(match?.fixture?.id || "");
        if (id) matchMap.set(id, match);
      }
      if (!matchMap.size) return { sent: 0, tracked: 0 };

      const fixtureIds = [...new Set(subscriptions.map((row: any) => String(row.fixture_id)))];
      const { data: states } = await this.options.supabase
        .from("live_match_state")
        .select("fixture_id,home_score,away_score,status")
        .in("fixture_id", fixtureIds);
      const stateMap = new Map<string, any>((states || []).map((row: any) => [String(row.fixture_id), row]));

      const subscribersByFixture = new Map<string, any[]>();
      for (const row of subscriptions) {
        const id = String(row.fixture_id);
        const list = subscribersByFixture.get(id) || [];
        list.push(row);
        subscribersByFixture.set(id, list);
      }

      const prefs = await this.preferenceMap(
        subscriptions.map((row: any) => ({ telegram_id: Number(row.telegram_id) })),
      );

      let sent = 0;
      for (const fixtureId of fixtureIds) {
        const match = matchMap.get(fixtureId);
        if (!match) continue;

        const homeScore = Number(match?.goals?.home || 0);
        const awayScore = Number(match?.goals?.away || 0);
        const status = String(match?.fixture?.status?.state || "in");
        const statusShort = String(match?.fixture?.status?.short || "");
        const previous = stateMap.get(fixtureId);

        let event: "kickoff" | "goal" | "full_time" | null = null;
        if (!previous) {
          event = status === "in" && homeScore === 0 && awayScore === 0 ? "kickoff" : null;
        } else if (status === "post" && String(previous.status) !== "post") {
          event = "full_time";
        } else if (status === "in" && String(previous.status) !== "in" && homeScore === 0 && awayScore === 0) {
          event = "kickoff";
        } else if (homeScore > Number(previous.home_score) || awayScore > Number(previous.away_score)) {
          event = "goal";
        }

        await this.options.supabase.from("live_match_state").upsert(
          {
            fixture_id: fixtureId,
            home_score: homeScore,
            away_score: awayScore,
            status,
            updated_at: now.toISOString(),
          },
          { onConflict: "fixture_id" },
        );

        if (!event) continue;

        const homeName = escapeHtml(match?.teams?.home?.name || "Home");
        const awayName = escapeHtml(match?.teams?.away?.name || "Away");
        const league = escapeHtml(match?.league?.name || "Live Football");
        const label = `${homeName} vs ${awayName}`;
        const score = `${homeScore}-${awayScore}`;
        const minute = statusShort || (status === "post" ? "FT" : "LIVE");

        const text =
          event === "kickoff"
            ? `🟢 <b>Kick-off</b>\n\n${label}\n${league}`
            : event === "goal"
              ? `🚨 <b>GOAL!</b>\n\n${label}\n<b>${score}</b> • ${escapeHtml(minute)}\n\n<i>${league}</i>`
              : `🏁 <b>Full time</b>\n\n${label}\n<b>${score}</b>\n\n<i>${league}</i>`;

        const eventKey = event === "goal" ? `goal:${homeScore}-${awayScore}` : event;
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.webApp("⚡ Match centre", this.options.appUrl)],
          [Markup.button.callback("🔕 Stop match alerts", "pref:off:live_alerts")],
        ]);

        for (const subscriber of subscribersByFixture.get(fixtureId) || []) {
          const telegramId = Number(subscriber.telegram_id);
          const result = await this.notifications.send({
            telegramId,
            category: "live_alerts",
            dedupeKey: `live:${fixtureId}:${eventKey}`,
            text,
            keyboard,
            preferences:
              prefs.get(telegramId) || {
                telegram_id: telegramId,
                ...this.notifications.getDefaultPreferences(),
              },
          });
          if (result.sent) {
            sent += 1;
            if (sent % 20 === 0) await sleep(1000);
          }
        }

        if (event === "full_time") {
          await this.options.supabase
            .from("match_alert_subscriptions")
            .update({ active: false })
            .eq("fixture_id", fixtureId);
        }
      }

      return { sent, tracked: fixtureIds.length };
    } catch (error: any) {
      console.error("Live alert notification failed:", error?.message || error);
      return { sent: 0, tracked: 0 };
    } finally {
      this.runningLive = false;
    }
  }
}
