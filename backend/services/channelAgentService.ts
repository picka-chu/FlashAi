import type { SupabaseClient } from "@supabase/supabase-js";
import { Markup, type Telegraf } from "telegraf";
import { GoogleGenAI } from "@google/genai";
import { getBsdH2H, getFootballNews, getUpcomingMatches } from "./footballService.js";
import { escapeHtml, normalizeTimezone } from "./notificationService.js";

export type ChannelAgentJob = "morning_brief" | "featured_match" | "newsroom";

interface ChannelAgentOptions {
  supabase: SupabaseClient;
  bot: Telegraf;
  appUrl: string;
  channelId?: string;
  timezone?: string;
}

interface ChannelMatch {
  id: string;
  home: string;
  away: string;
  league: string;
  kickoff: string;
  kickoffLabel: string;
  dateKey: string;
}

interface ChannelNews {
  headline: string;
  description: string;
  url: string;
  league: string;
  source: string;
  published: string;
}

interface ChannelContext {
  job: ChannelAgentJob;
  dateKey: string;
  dateLabel: string;
  timezone: string;
  isToday: boolean;
  fixtures: ChannelMatch[];
  featured: ChannelMatch | null;
  h2h: any;
  news: ChannelNews[];
  appUrl: string;
}

interface ChannelCopy {
  headline: string;
  standfirst: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
  closing: string;
}

interface RunOptions {
  force?: boolean;
  dryRun?: boolean;
}

const JOB_SLOTS: Array<{ job: ChannelAgentJob; hour: number; minute: number }> = [
  { job: "morning_brief", hour: 8, minute: 0 },
  { job: "featured_match", hour: 13, minute: 0 },
  { job: "newsroom", hour: 18, minute: 0 },
];

const JOB_META: Record<ChannelAgentJob, { label: string; hashtags: string }> = {
  morning_brief: {
    label: "☀️ FLASH AI · MORNING BRIEF",
    hashtags: "#FlashAI #Matchday #Football",
  },
  featured_match: {
    label: "🎯 FLASH AI · MATCH SPOTLIGHT",
    hashtags: "#FlashAI #MatchSpotlight #Football",
  },
  newsroom: {
    label: "📰 FLASH AI · NEWSROOM",
    hashtags: "#FlashAI #FootballNews",
  },
};

const TICK_INTERVAL = 5 * 60 * 1000;
const POST_WINDOW_MINUTES = 45;
const MAX_POST_LENGTH = 3900;

const firstEnv = (...names: string[]) => {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const normalizeChannelId = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const linkMatch = raw.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]+)/i);
  if (linkMatch) return `@${linkMatch[1]}`;
  if (/^-?\d+$/.test(raw)) return raw;
  return raw.startsWith("@") ? raw : `@${raw}`;
};

const collectGeminiKeys = () => unique([
  firstEnv("GEMINI_CHANNEL_KEY", "GEMINI_CHANNEL_KEY_1"),
  process.env.GEMINI_CHANNEL_KEY_1 || "",
  process.env.GEMINI_CHANNEL_KEY_2 || "",
  process.env.GEMINI_CHANNEL_KEY_3 || "",
  firstEnv("GEMINI_AGENT_KEY", "GEMINI_AGENT_KEY_1"),
  process.env.GEMINI_AGENT_KEY_1 || "",
  process.env.GEMINI_AGENT_KEY_2 || "",
  process.env.GEMINI_API_KEY || "",
  process.env.GOOGLE_AI_API_KEY || "",
  process.env.GOOGLE_API_KEY || "",
  ...Array.from({ length: 9 }, (_, index) => process.env[`GEMINI_API_KEY_${index + 1}`] || ""),
  process.env.GEMINI_PREDICTION_KEY || "",
  ...Array.from({ length: 3 }, (_, index) => process.env[`GEMINI_PREDICTION_KEY_${index + 1}`] || ""),
  process.env.GEMINI_SUPPORT_KEY || "",
  ...Array.from({ length: 3 }, (_, index) => process.env[`GEMINI_SUPPORT_KEY_${index + 1}`] || ""),
].map((value) => String(value || "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")).filter(Boolean));

const parseJsonFromText = (raw: string) => {
  const value = String(raw || "").trim();
  if (!value) return null;
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || value;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[\[{]/);
    if (start < 0) return null;
    const opener = candidate[start];
    const closer = opener === "{" ? "}" : "]";
    const end = candidate.lastIndexOf(closer);
    if (end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const text = (value: unknown, limit: number) =>
  String(value ?? "").replace(/\r/g, "").trim().slice(0, limit);

const leagueWeight = (league: string) => {
  const value = String(league || "").toLowerCase();
  const weighted: Array<[RegExp, number]> = [
    [/champions league/, 10],
    [/premier league/, 9],
    [/la ?liga/, 8],
    [/serie a/, 7],
    [/bundesliga/, 7],
    [/ligue 1/, 6],
    [/europa league/, 5],
    [/copa libertadores/, 5],
    [/mls/, 4],
    [/fa cup|carabao cup/, 4],
  ];
  return weighted.find(([pattern]) => pattern.test(value))?.[1] || 1;
};

export class ChannelAgentScheduler {
  private readonly supabase: SupabaseClient;
  private readonly bot: Telegraf;
  private readonly appUrl: string;
  private readonly channelId: string;
  private readonly timezone: string;
  private readonly keys: string[];
  private readonly models: string[];
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private keyCursor = 0;
  private readonly running = new Set<string>();
  private readonly posted = new Set<string>();

  constructor(options: ChannelAgentOptions) {
    this.supabase = options.supabase;
    this.bot = options.bot;
    this.appUrl = options.appUrl.replace(/\/+$/, "");
    this.channelId = normalizeChannelId(
      options.channelId ||
      firstEnv("TELEGRAM_CHANNEL_ID", "TELEGRAM_CHANNEL_USERNAME", "FLASH_AI_CHANNEL_ID", "CHANNEL_ID"),
    );
    this.timezone = normalizeTimezone(
      options.timezone ||
      process.env.CHANNEL_AGENT_TIMEZONE ||
      process.env.TIMEZONE ||
      "UTC",
    );
    this.keys = collectGeminiKeys();
    this.models = unique([
      process.env.GEMINI_CHANNEL_MODEL || "",
      process.env.GEMINI_AGENT_MODEL || "",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
  }

  get enabled(): boolean {
    return Boolean(
      this.channelId &&
      String(process.env.CHANNEL_AGENT_ENABLED || "true").toLowerCase() !== "false",
    );
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: Boolean(this.channelId),
      channel: this.channelId,
      timezone: this.timezone,
      geminiConfigured: this.keys.length > 0,
      geminiKeys: this.keys.length,
      model: this.models[0],
      slots: JOB_SLOTS.map((slot) => ({
        job: slot.job,
        time: `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`,
        timezone: this.timezone,
      })),
    };
  }

  start(): void {
    if (this.timer) return;
    if (!this.enabled) {
      console.warn("AI channel editor is idle: set TELEGRAM_CHANNEL_ID and enable CHANNEL_AGENT_ENABLED.");
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((error) => console.error("AI channel editor tick failed:", error));
    }, TICK_INTERVAL);
    this.timer.unref?.();
    this.tick().catch((error) => console.error("AI channel editor tick failed:", error));
    console.log(
      `🗞️ AI channel editor active for ${this.channelId} (${this.timezone}); Gemini keys: ${this.keys.length}.`,
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(job: ChannelAgentJob, options: RunOptions = {}) {
    if (!this.enabled) throw new Error("AI channel editor is not configured");
    const dateKey = this.zonedParts(new Date()).dateKey;
    return this.publish(job, dateKey, options);
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.enabled) return;
    this.ticking = true;
    try {
      const now = new Date();
      const parts = this.zonedParts(now);
      const currentMinutes = parts.hour * 60 + parts.minute;
      for (const slot of JOB_SLOTS) {
        const target = slot.hour * 60 + slot.minute;
        if (currentMinutes >= target && currentMinutes < target + POST_WINDOW_MINUTES) {
          await this.publish(slot.job, parts.dateKey);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private zonedParts(date: Date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    return {
      dateKey: `${get("year")}-${get("month")}-${get("day")}`,
      hour: Number.isFinite(hour) ? hour : date.getUTCHours(),
      minute: Number.isFinite(minute) ? minute : date.getUTCMinutes(),
    };
  }

  private localDateKey(date: Date): string {
    return this.zonedParts(date).dateKey;
  }

  private formatKickoff(date: Date): string {
    if (Number.isNaN(date.getTime())) return "Time TBC";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  private formatDateLabel(date: Date): string {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  private mapMatch(match: any): ChannelMatch | null {
    const home = String(match?.teams?.home?.name || "").trim();
    const away = String(match?.teams?.away?.name || "").trim();
    const kickoff = String(match?.fixture?.date || "").trim();
    const date = new Date(kickoff);
    if (!home || !away || Number.isNaN(date.getTime())) return null;
    return {
      id: String(match?.fixture?.id ?? match?.id ?? ""),
      home,
      away,
      league: String(match?.league?.name || "Football"),
      kickoff,
      kickoffLabel: this.formatKickoff(date),
      dateKey: this.localDateKey(date),
    };
  }

  private selectFeatured(matches: ChannelMatch[]): ChannelMatch | null {
    if (!matches.length) return null;
    return [...matches].sort((left, right) => {
      const leagueGap = leagueWeight(right.league) - leagueWeight(left.league);
      if (leagueGap !== 0) return leagueGap;
      return left.kickoff.localeCompare(right.kickoff);
    })[0];
  }

  private async buildContext(job: ChannelAgentJob): Promise<ChannelContext> {
    const now = new Date();
    const todayKey = this.localDateKey(now);
    const [fixturesRaw, newsRaw] = await Promise.all([
      getUpcomingMatches().catch((error: any) => {
        console.warn("[channel-agent] fixtures unavailable:", error?.message || error);
        return [];
      }),
      getFootballNews(job === "newsroom" ? 8 : 5).catch((error: any) => {
        console.warn("[channel-agent] news unavailable:", error?.message || error);
        return [];
      }),
    ]);

    const allFixtures = (Array.isArray(fixturesRaw) ? fixturesRaw : [])
      .map((match: any) => this.mapMatch(match))
      .filter((match): match is ChannelMatch => Boolean(match));
    const todayFixtures = allFixtures.filter((match) => match.dateKey === todayKey);
    const upcomingFixtures = allFixtures.filter((match) => match.dateKey >= todayKey);
    const fixturePool = (todayFixtures.length ? todayFixtures : upcomingFixtures).slice(0, 6);
    const featured = this.selectFeatured(fixturePool);

    let h2h: any = null;
    if (featured && job === "featured_match" && featured.id) {
      h2h = await getBsdH2H(featured.id, featured.home, featured.away).catch(() => null);
    }

    const news = (Array.isArray(newsRaw) ? newsRaw : [])
      .map((article: any) => ({
        headline: String(article?.headline || "").trim(),
        description: String(article?.description || "").trim(),
        url: String(article?.url || "").trim(),
        league: String(article?.league || "Football"),
        source: String(article?.source || "ESPN"),
        published: String(article?.published || ""),
      }))
      .filter((article) => article.headline && /^https?:\/\//i.test(article.url))
      .slice(0, job === "newsroom" ? 5 : 3);

    return {
      job,
      dateKey: todayKey,
      dateLabel: this.formatDateLabel(now),
      timezone: this.timezone,
      isToday: todayFixtures.length > 0,
      fixtures: fixturePool,
      featured,
      h2h,
      news,
      appUrl: this.appUrl,
    };
  }

  private async publish(job: ChannelAgentJob, dateKey: string, options: RunOptions = {}) {
    const runKey = `${job}:${dateKey}`;
    const marker = `channel_agent:${job}:${dateKey}`;
    if (this.running.has(runKey)) return { sent: false, skipped: "in_progress" };
    this.running.add(runKey);

    try {
      if (!options.force && await this.wasPosted(marker)) {
        return { sent: false, skipped: "already_posted" };
      }

      const context = await this.buildContext(job);
      if (job === "featured_match" && !context.featured) {
        return { sent: false, skipped: "no_featured_match" };
      }
      if (job === "newsroom" && !context.news.length) {
        return { sent: false, skipped: "no_news" };
      }
      if (job === "morning_brief" && !context.fixtures.length && !context.news.length) {
        return { sent: false, skipped: "no_content" };
      }

      const copy = await this.compose(context);
      const message = this.render(context, copy);
      if (options.dryRun) {
        return { sent: false, dryRun: true, preview: message, context };
      }

      const keyboard = this.buildKeyboard(context);
      const sent = await this.bot.telegram.sendMessage(this.channelId, message, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard || {}),
      } as any);

      this.posted.add(marker);
      const { error: markerError } = await this.supabase.from("api_cache").upsert(
        {
          endpoint: marker,
          data: {
            job,
            dateKey,
            channel: this.channelId,
            message_id: sent?.message_id || null,
            posted_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      if (markerError) {
        console.warn("[channel-agent] Posted but failed to save dedupe marker:", markerError.message);
      }
      console.log(`[channel-agent] ${job} published to ${this.channelId} (${dateKey}).`);
      return { sent: true, messageId: sent?.message_id || null, text: message };
    } catch (error: any) {
      const reason =
        error?.response?.description || error?.response?.message || error?.message || String(error);
      const hint = /chat not found|not enough rights|bot is not a member|forbidden/i.test(reason)
        ? " Add the bot as an admin of the channel and verify TELEGRAM_CHANNEL_ID."
        : "";
      console.error(`[channel-agent] ${job} failed:`, reason);
      throw new Error(`Channel post failed: ${reason}.${hint}`);
    } finally {
      this.running.delete(runKey);
    }
  }

  private async wasPosted(marker: string): Promise<boolean> {
    if (this.posted.has(marker)) return true;
    const { data } = await this.supabase
      .from("api_cache")
      .select("endpoint")
      .eq("endpoint", marker)
      .maybeSingle();
    if (data?.endpoint) {
      this.posted.add(marker);
      return true;
    }
    return false;
  }

  private buildKeyboard(context: ChannelContext) {
    const rows: any[] = [];
    if (context.featured) {
      rows.push([Markup.button.url("⚡ Open match centre", this.appUrl)]);
    }
    if (context.job === "newsroom" && context.news[0]) {
      rows.push([Markup.button.url("Read the full story", context.news[0].url)]);
    }
    rows.push([Markup.button.url("Open Flash AI", this.appUrl)]);
    return rows.length ? Markup.inlineKeyboard(rows) : undefined;
  }

  private async compose(context: ChannelContext): Promise<ChannelCopy> {
    const fallback = this.fallbackCopy(context);
    if (!this.keys.length) {
      console.warn("[channel-agent] No Gemini key configured; using editorial fallback.");
      return fallback;
    }

    const prompt = this.buildPrompt(context);
    try {
      const parsed = await this.generateJson(prompt);
      const normalized = this.normalizeCopy(parsed);
      return normalized || fallback;
    } catch (error: any) {
      console.warn("[channel-agent] Gemini copy failed; using editorial fallback:", error?.message || error);
      return fallback;
    }
  }

  private buildPrompt(context: ChannelContext): string {
    const fixtureLines = context.fixtures.map((match) => ({
      league: match.league,
      fixture: `${match.home} vs ${match.away}`,
      kickoff: match.kickoffLabel,
    }));
    const newsLines = context.news.map((article) => ({
      league: article.league,
      headline: article.headline,
      description: article.description,
      source: article.source,
    }));
    const jobInstruction: Record<ChannelAgentJob, string> = {
      morning_brief:
        "Write the morning briefing. Lead with the day's football picture. If isToday is false, say clearly that there are no fixtures today and frame the post as the next matches to watch. Include 3-5 fixtures and the featured match. Add a compact news section from the supplied headlines.",
      featured_match:
        "Write a match spotlight. Use three sections: The stage, The numbers, The Flash read. Use H2H data only when supplied. Offer an analytical angle, never a guaranteed outcome or betting tip.",
      newsroom:
        "Write a newsroom digest. Choose the three strongest supplied stories. Give each its own heading and a tight two-sentence summary, then add one section called Why it matters with a cross-story insight. Attribute ESPN. Do not add facts that are not in the supplied material.",
    };

    return `You are the senior editor of the official Flash AI Telegram channel. You write like an elite football newsroom: authoritative, specific, calm, and concise. Never invent facts, quotes, injuries, odds, scorelines, or statistics. Do not promise outcomes or give betting advice. Do not mention internal data providers. Never say you are an AI. Use only the supplied material.

Job: ${context.job}
${jobInstruction[context.job]}

Date: ${context.dateLabel} (${context.timezone})
Fixtures today: ${context.isToday ? "yes" : "no"}
Fixtures:
${JSON.stringify(fixtureLines, null, 2)}

Featured match:
${JSON.stringify(context.featured, null, 2)}

Head-to-head:
${JSON.stringify(context.h2h, null, 2)}

News:
${JSON.stringify(newsLines, null, 2)}

Return ONLY valid JSON in this exact shape:
{
  "headline": "maximum 75 characters",
  "standfirst": "one sharp sentence, maximum 140 characters",
  "intro": "two sentences, maximum 260 characters",
  "sections": [
    { "heading": "short heading, maximum 36 characters", "body": "maximum 420 characters" }
  ],
  "closing": "one sentence, maximum 180 characters"
}

Use 2-4 sections. Keep the whole post under 1400 characters, or under 1700 for newsroom. No markdown. Plain text inside every JSON string.`;
  }

  private async generateJson(prompt: string): Promise<any> {
    if (!this.keys.length) throw new Error("No Gemini key configured");
    let lastError: any = null;
    const start = this.keyCursor;

    for (let keyOffset = 0; keyOffset < Math.min(this.keys.length, 3); keyOffset += 1) {
      const key = this.keys[(start + keyOffset) % this.keys.length];
      for (const model of this.models) {
        try {
          const ai = new GoogleGenAI({ apiKey: key });
          const result = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              temperature: 0.55,
              maxOutputTokens: 1200,
              responseMimeType: "application/json",
            },
          });
          const parsed = parseJsonFromText(result.text || "");
          if (!parsed) throw new Error("Gemini returned non-JSON copy");
          this.keyCursor = (start + keyOffset + 1) % this.keys.length;
          return parsed;
        } catch (error: any) {
          lastError = error;
          console.warn(
            `[channel-agent] ${model} generation failed:`,
            error?.message || error,
          );
        }
      }
    }
    throw lastError || new Error("All Gemini models failed");
  }

  private normalizeCopy(raw: any): ChannelCopy | null {
    if (!raw || typeof raw !== "object") return null;
    const headline = text(raw.headline, 90);
    const intro = text(raw.intro, 360);
    if (!headline) return null;
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
      .map((section: any) => ({
        heading: text(section?.heading, 48),
        body: text(section?.body, 700),
      }))
      .filter((section: any) => section.heading && section.body)
      .slice(0, 4);
    return {
      headline,
      standfirst: text(raw.standfirst, 180),
      intro,
      sections,
      closing: text(raw.closing, 240) || "Open Flash AI for live scores, match context and AI analysis.",
    };
  }

  private fallbackCopy(context: ChannelContext): ChannelCopy {
    const featured = context.featured;
    if (context.job === "newsroom") {
      const stories = context.news.slice(0, 3);
      return {
        headline: stories[0]?.headline || "The football stories shaping the day",
        standfirst: "A concise read on the stories worth your attention.",
        intro: "The Flash AI newsroom has scanned the latest football headlines and pulled out the three that matter most.",
        sections: stories.map((story) => ({
          heading: story.league,
          body: `${story.headline}. ${story.description || "Read the full report for the latest detail."}`,
        })),
        closing: "Full coverage and match intelligence are available in Flash AI.",
      };
    }

    if (context.job === "featured_match" && featured) {
      const numbers = context.h2h
        ? `Recent H2H: ${context.h2h.summary || "balanced"}. Average match goals: ${context.h2h.avgGoals || "N/A"}.`
        : "The head-to-head picture is tight enough that form and match context will carry the weight.";
      return {
        headline: `${featured.home} vs ${featured.away}: the match to watch`,
        standfirst: `${featured.league} · ${featured.kickoffLabel}`,
        intro: "One fixture stands above the rest on today's card. The stage is set for a measured, high-stakes contest.",
        sections: [
          {
            heading: "The stage",
            body: `${featured.home} meet ${featured.away} in the ${featured.league}. Kick-off is scheduled for ${featured.kickoffLabel}.`,
          },
          {
            heading: "The numbers",
            body: numbers,
          },
          {
            heading: "The Flash read",
            body: "Expect the early phases to be about control and territory. The side that manages transitions cleanly should own the better chances.",
          },
        ],
        closing: "Open Flash AI for live scores, match context and AI analysis.",
      };
    }

    const fixtureLines = context.fixtures.map(
      (match) => `• ${match.kickoffLabel} — ${match.home} vs ${match.away} (${match.league})`,
    );
    const sections: Array<{ heading: string; body: string }> = [];
    if (fixtureLines.length) {
      sections.push({
        heading: context.isToday ? "Today's card" : "Next up",
        body: fixtureLines.join("\n"),
      });
    }
    if (featured) {
      sections.push({
        heading: "Match to watch",
        body: `${featured.home} vs ${featured.away} in the ${featured.league}, kicking off ${featured.kickoffLabel}.`,
      });
    }
    if (context.news.length) {
      sections.push({
        heading: "From the newsroom",
        body: context.news.slice(0, 2).map((story) => `${story.league}: ${story.headline}`).join("\n"),
      });
    }
    return {
      headline: context.isToday ? "Today on the football calendar" : "The next fixtures to circle",
      standfirst: context.isToday
        ? "The matches, the context and the stories setting up the day."
        : "A short break in the schedule does not mean a quiet football week.",
      intro: context.isToday
        ? "Flash AI has the day's card mapped, with the standout fixture and the newsroom stories worth following."
        : "There are no fixtures on today's card, so the newsroom is looking ahead to the next matches that matter.",
      sections,
      closing: "Open Flash AI for live scores, match context and AI analysis.",
    };
  }

  private render(context: ChannelContext, copy: ChannelCopy): string {
    const meta = JOB_META[context.job];
    const sections = copy.sections.slice(0, 4);

    const build = (limitedSections: typeof sections) => {
      const lines = [
        `<b>${meta.label}</b>`,
        `<i>${escapeHtml(context.dateLabel)}</i>`,
        "",
        `<b>${escapeHtml(copy.headline)}</b>`,
      ];
      if (copy.standfirst) lines.push(`<i>${escapeHtml(copy.standfirst)}</i>`);
      if (copy.intro) lines.push("", escapeHtml(copy.intro));
      for (const section of limitedSections) {
        lines.push("", `<b>${escapeHtml(section.heading)}</b>`, escapeHtml(section.body));
      }
      if (copy.closing) lines.push("", escapeHtml(copy.closing));
      lines.push("", `<i>Flash AI · Smart match intelligence</i>`, meta.hashtags);
      return lines.join("\n");
    };

    let message = build(sections);
    while (message.length > MAX_POST_LENGTH && sections.length > 1) {
      sections.pop();
      message = build(sections);
    }
    return message.length > MAX_POST_LENGTH ? message.slice(0, MAX_POST_LENGTH) : message;
  }
}
