import type { SupabaseClient } from "@supabase/supabase-js";
import type { Telegraf } from "telegraf";

export type NotificationCategory =
  | "daily_fixtures"
  | "news_digest"
  | "live_alerts"
  | "weekly_recap"
  | "marketing"
  | "transactional"
  | "admin";

export type NotificationPreferenceKey =
  | "daily_fixtures"
  | "live_alerts"
  | "news_digest"
  | "weekly_recap"
  | "marketing";

export interface NotificationPreferences {
  telegram_id: number;
  daily_fixtures: boolean;
  live_alerts: boolean;
  news_digest: boolean;
  weekly_recap: boolean;
  marketing: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string;
  blocked_at: string | null;
}

export interface SendNotificationInput {
  telegramId: number;
  category: NotificationCategory;
  dedupeKey: string;
  text: string;
  keyboard?: any;
  imageUrl?: string;
  /** Transactional/admin messages bypass preferences, quiet hours and caps. */
  bypassPreferences?: boolean;
  /** Pre-fetched preferences for broadcast batches. */
  preferences?: NotificationPreferences;
}

export interface SendNotificationResult {
  sent: boolean;
  reason?: "duplicate" | "disabled" | "quiet_hours" | "capped" | "blocked" | "failed";
  error?: string;
}

const DEFAULT_PREFERENCES: Omit<NotificationPreferences, "telegram_id"> = {
  daily_fixtures: true,
  live_alerts: true,
  news_digest: true,
  weekly_recap: true,
  marketing: true,
  quiet_hours_start: 22,
  quiet_hours_end: 8,
  timezone: "UTC",
  blocked_at: null,
};

const CATEGORY_PREFERENCE: Partial<Record<NotificationCategory, NotificationPreferenceKey>> = {
  daily_fixtures: "daily_fixtures",
  live_alerts: "live_alerts",
  news_digest: "news_digest",
  weekly_recap: "weekly_recap",
  marketing: "marketing",
};

const DAILY_CAPS: Partial<Record<NotificationCategory, number>> = {
  daily_fixtures: 1,
  news_digest: 2,
  live_alerts: 12,
  weekly_recap: 1,
  marketing: 1,
};

const BYPASS_QUIET_HOURS = new Set<NotificationCategory>([
  "live_alerts",
  "transactional",
  "admin",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeTimezone(value: unknown): string {
  const timezone = String(value || "").trim();
  if (!timezone || timezone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(timezone)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function hourInTimezone(date: Date, timezone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(date);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

export function isWithinQuietHours(
  preferences: Pick<NotificationPreferences, "quiet_hours_start" | "quiet_hours_end" | "timezone">,
  now = new Date(),
): boolean {
  const start = Number(preferences.quiet_hours_start);
  const end = Number(preferences.quiet_hours_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const hour = hourInTimezone(now, normalizeTimezone(preferences.timezone));
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export class NotificationService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bot: Telegraf | null,
  ) {}

  async getPreferences(telegramId: number): Promise<NotificationPreferences> {
    const { data } = await this.supabase
      .from("notification_preferences")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (data) {
      return {
        ...DEFAULT_PREFERENCES,
        ...data,
        telegram_id: Number(data.telegram_id),
      } as NotificationPreferences;
    }

    return { telegram_id: telegramId, ...DEFAULT_PREFERENCES };
  }

  async ensurePreferences(telegramId: number): Promise<NotificationPreferences> {
    const existing = await this.getPreferences(telegramId);
    const { data: row } = await this.supabase
      .from("notification_preferences")
      .select("telegram_id")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (row) return existing;

    const { data: inserted, error } = await this.supabase
      .from("notification_preferences")
      .upsert(
        {
          telegram_id: telegramId,
          ...DEFAULT_PREFERENCES,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_id" },
      )
      .select("*")
      .maybeSingle();
    if (error || !inserted) return existing;
    return {
      ...DEFAULT_PREFERENCES,
      ...inserted,
      telegram_id: Number(inserted.telegram_id),
    } as NotificationPreferences;
  }

  async updatePreferences(
    telegramId: number,
    updates: Partial<Omit<NotificationPreferences, "telegram_id">>,
  ): Promise<NotificationPreferences> {
    await this.ensurePreferences(telegramId);
    const cleanUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of [
      "daily_fixtures",
      "live_alerts",
      "news_digest",
      "weekly_recap",
      "marketing",
    ] as const) {
      if (typeof updates[key] === "boolean") cleanUpdates[key] = updates[key];
    }
    if (updates.quiet_hours_start !== undefined) {
      cleanUpdates.quiet_hours_start = Math.min(23, Math.max(0, Math.floor(Number(updates.quiet_hours_start) || 0)));
    }
    if (updates.quiet_hours_end !== undefined) {
      cleanUpdates.quiet_hours_end = Math.min(23, Math.max(0, Math.floor(Number(updates.quiet_hours_end) || 0)));
    }
    if (updates.timezone !== undefined) {
      cleanUpdates.timezone = normalizeTimezone(updates.timezone);
    }

    await this.supabase
      .from("notification_preferences")
      .upsert({ telegram_id: telegramId, ...cleanUpdates }, { onConflict: "telegram_id" });
    return this.getPreferences(telegramId);
  }

  async markBlocked(telegramId: number): Promise<void> {
    await this.supabase
      .from("notification_preferences")
      .upsert(
        { telegram_id: telegramId, blocked_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "telegram_id" },
      );
  }

  private async hasReachedCap(
    telegramId: number,
    category: NotificationCategory,
    now: Date,
  ): Promise<boolean> {
    const cap = DAILY_CAPS[category];
    if (!cap) return false;

    let windowStart = startOfUtcDay(now);
    if (category === "weekly_recap") {
      const day = now.getUTCDay();
      const daysSinceMonday = (day + 6) % 7;
      windowStart = new Date(startOfUtcDay(now).getTime() - daysSinceMonday * 86_400_000);
    }

    const { count } = await this.supabase
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", telegramId)
      .eq("category", category)
      .eq("status", "sent")
      .gte("sent_at", windowStart.toISOString());

    if (category === "marketing") {
      const { count: recentMarketing } = await this.supabase
        .from("notification_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("telegram_id", telegramId)
        .eq("category", "marketing")
        .eq("status", "sent")
        .gte("sent_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      return (recentMarketing || 0) >= 1;
    }

    return (count || 0) >= cap;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    if (!this.bot) return { sent: false, reason: "failed", error: "Bot not configured" };

    const telegramId = Number(input.telegramId);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
      return { sent: false, reason: "failed", error: "Invalid telegram id" };
    }

    const bypass = Boolean(input.bypassPreferences) || input.category === "transactional" || input.category === "admin";
    const preferences = input.preferences || (await this.ensurePreferences(telegramId));

    if (!bypass) {
      if (preferences.blocked_at) return { sent: false, reason: "blocked" };
      const preferenceKey = CATEGORY_PREFERENCE[input.category];
      if (preferenceKey && !preferences[preferenceKey]) {
        return { sent: false, reason: "disabled" };
      }
      if (!BYPASS_QUIET_HOURS.has(input.category) && isWithinQuietHours(preferences)) {
        return { sent: false, reason: "quiet_hours" };
      }
      if (await this.hasReachedCap(telegramId, input.category, new Date())) {
        return { sent: false, reason: "capped" };
      }
    }

    const dedupeKey = String(input.dedupeKey || "").slice(0, 180);
    if (!dedupeKey) return { sent: false, reason: "failed", error: "Missing dedupe key" };

    const deliveryRow = {
      telegram_id: telegramId,
      category: input.category,
      dedupe_key: dedupeKey,
      status: "pending",
    };
    let delivery: { id: string } | null = null;
    const firstInsert = await this.supabase
      .from("notification_deliveries")
      .insert(deliveryRow)
      .select("id")
      .single();

    if (firstInsert.error) {
      if (firstInsert.error.code !== "23505") {
        console.error("Notification delivery insert failed:", firstInsert.error.message);
        return { sent: false, reason: "failed", error: firstInsert.error.message };
      }
      // Duplicate key: block only genuinely delivered/still-claiming rows.
      // A previously failed or crashed attempt must stay retryable, otherwise
      // one transient Telegram error silently kills that user's digest forever.
      const { data: existing } = await this.supabase
        .from("notification_deliveries")
        .select("id,status,created_at")
        .eq("telegram_id", telegramId)
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      const createdAt = Date.parse(existing?.created_at || "");
      const stale =
        existing &&
        (existing.status === "failed" ||
          (existing.status === "pending" &&
            (!Number.isFinite(createdAt) || Date.now() - createdAt > 120_000)));
      if (!stale) return { sent: false, reason: "duplicate" };

      await this.supabase.from("notification_deliveries").delete().eq("id", existing.id);
      const retryInsert = await this.supabase
        .from("notification_deliveries")
        .insert(deliveryRow)
        .select("id")
        .single();
      if (retryInsert.error) {
        if (retryInsert.error.code === "23505") return { sent: false, reason: "duplicate" };
        return { sent: false, reason: "failed", error: retryInsert.error.message };
      }
      delivery = retryInsert.data;
    } else {
      delivery = firstInsert.data;
    }
    if (!delivery) return { sent: false, reason: "failed", error: "Could not claim delivery slot" };

    const options: Record<string, any> = { parse_mode: "HTML" };
    if (input.keyboard) Object.assign(options, input.keyboard);

    try {
      if (input.imageUrl) {
        await this.bot.telegram.sendPhoto(telegramId, input.imageUrl, {
          caption: input.text,
          ...options,
        });
      } else {
        await this.bot.telegram.sendMessage(telegramId, input.text, options);
      }

      await this.supabase
        .from("notification_deliveries")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", delivery.id);
      await this.supabase.from("notification_logs").insert({
        telegram_id: telegramId,
        message_type: input.category,
        message_content: input.text.slice(0, 1000),
        success: true,
      });
      return { sent: true };
    } catch (error: any) {
      const message = String(error?.message || error || "Send failed").slice(0, 500);
      const errorCode = Number(error?.response?.error_code || error?.code || 0);
      const retryAfter = Number(error?.response?.parameters?.retry_after || 0);

      if (errorCode === 429 && retryAfter > 0 && retryAfter <= 20) {
        await sleep(retryAfter * 1000);
        try {
          if (input.imageUrl) {
            await this.bot.telegram.sendPhoto(telegramId, input.imageUrl, {
              caption: input.text,
              ...options,
            });
          } else {
            await this.bot.telegram.sendMessage(telegramId, input.text, options);
          }
          await this.supabase
            .from("notification_deliveries")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", delivery.id);
          return { sent: true };
        } catch (retryError: any) {
          error = retryError;
        }
      }

      if (errorCode === 403 || /bot was blocked|user is deactivated|chat not found/i.test(message)) {
        await this.markBlocked(telegramId);
      }

      await this.supabase
        .from("notification_deliveries")
        .update({ status: "failed", error: message })
        .eq("id", delivery.id);
      await this.supabase.from("notification_logs").insert({
        telegram_id: telegramId,
        message_type: input.category,
        message_content: input.text.slice(0, 1000),
        success: false,
        error_message: message,
      });
      return { sent: false, reason: "failed", error: message };
    }
  }

  async getPreferenceMap(telegramIds: number[]): Promise<Map<number, NotificationPreferences>> {
    const map = new Map<number, NotificationPreferences>();
    if (!telegramIds.length) return map;

    const chunks: number[][] = [];
    for (let index = 0; index < telegramIds.length; index += 500) {
      chunks.push(telegramIds.slice(index, index + 500));
    }
    for (const chunk of chunks) {
      const { data } = await this.supabase
        .from("notification_preferences")
        .select("*")
        .in("telegram_id", chunk);
      for (const row of data || []) {
        map.set(Number(row.telegram_id), {
          ...DEFAULT_PREFERENCES,
          ...row,
          telegram_id: Number(row.telegram_id),
        } as NotificationPreferences);
      }
    }
    return map;
  }

  getDefaultPreferences(): Omit<NotificationPreferences, "telegram_id"> {
    return { ...DEFAULT_PREFERENCES };
  }
}
