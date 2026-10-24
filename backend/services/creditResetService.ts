import { createClient } from "@supabase/supabase-js";

/**
 * Professional Credit Reset Service
 * Handles daily credit resets at 00:00 UTC for all users
 * Supports timezone-aware resets and maintains audit trail
 */

interface CreditResetConfig {
  supabaseUrl: string;
  supabaseKey: string;
  timezone?: string; // Default: UTC
  batchSize?: number; // Default: 1000
  logEnabled?: boolean; // Default: true
}

interface ResetStats {
  totalUsersProcessed: number;
  usersReset: number;
  usersSkipped: number;
  totalCreditsDistributed: number;
  errors: string[];
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
}

interface PlanConfig {
  dailyCredits: number;
  name: string;
}

const PLAN_CONFIG: Record<string, PlanConfig> = {
  free: { dailyCredits: 3, name: "Free Trial (7 days)" },
  weekly: { dailyCredits: 10, name: "Weekly" },
  monthly: { dailyCredits: 16, name: "Monthly" },
  monthly_basic: { dailyCredits: 10, name: "Monthly Basic" },
  monthly_pro: { dailyCredits: 16, name: "Monthly Pro" },
  admin: { dailyCredits: 999, name: "Administrator" },
};

export class CreditResetService {
  private supabase: any;
  private timezone: string;
  private batchSize: number;
  private logEnabled: boolean;

  constructor(config: CreditResetConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    this.timezone = config.timezone || "UTC";
    this.batchSize = config.batchSize || 1000;
    this.logEnabled = config.logEnabled !== false;
  }

  /**
   * Check if it's midnight in the specified timezone
   */
  private isMidnightNow(): boolean {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === "hour")?.value;
    const minute = parts.find(p => p.type === "minute")?.value;

    // Allow 1-minute window around midnight for execution
    return hour === "00" && (minute === "00" || minute === "01");
  }

  /** Calendar date (`YYYY-MM-DD`) in the configured timezone. */
  private getDateKey(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  /** Offset (ms) of the configured timezone at the given instant. */
  private getTimeZoneOffsetMs(date: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const values: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    }

    const asUtc = Date.UTC(
      values.year,
      (values.month || 1) - 1,
      values.day || 1,
      values.hour || 0,
      values.minute || 0,
      values.second || 0,
    );
    return asUtc - date.getTime();
  }

  /**
   * Get the start of today in the specified timezone as a precise instant.
   */
  private getTodayStartInTimezone(): Date {
    const [year, month, day] = this.getDateKey(new Date()).split("-").map(Number);
    const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
    const offset = this.getTimeZoneOffsetMs(new Date(utcGuess));
    return new Date(utcGuess - offset);
  }

  /**
   * Check if user needs credit reset (last reset was on an earlier calendar
   * day in the configured timezone).
   */
  private shouldResetUserCredits(lastResetTime: Date | null): boolean {
    if (!lastResetTime) return true;
    return this.getDateKey(new Date(lastResetTime)) < this.getDateKey(new Date());
  }

  /**
   * Get daily credit quota for a user based on their plan
   */
  private getDailyQuota(plan: string, createdAt: Date): number {
    const config = PLAN_CONFIG[plan] || PLAN_CONFIG.free;

    // Free credits expire after 7 days
    if (plan === "free") {
      const now = new Date();
      const accountAgeMs = now.getTime() - new Date(createdAt).getTime();
      const isWithinFreeWindow = accountAgeMs <= 7 * 24 * 60 * 60 * 1000;
      if (!isWithinFreeWindow) {
        return 0;
      }
    }

    return config.dailyCredits;
  }

  /**
   * Reset credits for a single user
   */
  private async resetUserCredits(
    telegramId: number,
    plan: string,
    createdAt: Date,
    currentCredits: number
  ): Promise<{ success: boolean; newCredits: number; granted: number; error?: string }> {
    try {
      const dailyQuota = this.getDailyQuota(plan, createdAt);
      const newCredits = Math.max(currentCredits, dailyQuota);
      const granted = Math.max(0, newCredits - currentCredits);

      const now = new Date();
      const { error } = await this.supabase
        .from("users")
        .update({
          credits: newCredits,
          last_credit_reset: now.toISOString(),
          last_active: now.toISOString()
        })
        .eq("telegram_id", telegramId);

      if (error) {
        throw error;
      }

      // Only write an audit row when credits were actually granted.
      if (granted > 0) {
        await this.logCreditTransaction(
          telegramId,
          granted,
          currentCredits,
          newCredits,
          "daily_reset"
        );
      }

      return { success: true, newCredits, granted };
    } catch (error: any) {
      return {
        success: false,
        newCredits: currentCredits,
        granted: 0,
        error: error.message || "Unknown error"
      };
    }
  }

  /**
   * Log credit transaction for audit trail
   */
  private async logCreditTransaction(
    telegramId: number,
    amount: number,
    balanceBefore: number,
    balanceAfter: number,
    type: string
  ): Promise<void> {
    try {
      await this.supabase.from("credit_transactions").insert({
        telegram_id: telegramId,
        amount,
        transaction_type: type,
        description: "Daily midnight credit reset",
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        created_at: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Failed to log credit transaction:", error.message);
    }
  }

  /**
   * Main reset function - processes all users needing reset
   */
  async resetAllUserCredits(): Promise<ResetStats> {
    const stats: ResetStats = {
      totalUsersProcessed: 0,
      usersReset: 0,
      usersSkipped: 0,
      totalCreditsDistributed: 0,
      errors: [],
      startTime: new Date(),
      endTime: new Date(),
      duration: 0
    };

    try {
      if (this.logEnabled) {
        console.log(`[CreditReset] Starting midnight reset at ${stats.startTime.toISOString()}`);
      }

      // Fetch all users in batches
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: users, error } = await this.supabase
          .from("users")
          .select("telegram_id, plan, credits, created_at, last_credit_reset, plan_expires_at")
          .order("telegram_id", { ascending: true })
          .range(offset, offset + this.batchSize - 1);

        if (error) {
          if (stats.errors.length < 100) {
            stats.errors.push(`Batch fetch error at offset ${offset}: ${error.message}`);
          }
          break;
        }

        if (!users || users.length === 0) {
          hasMore = false;
          break;
        }

        // Process each user in the batch
        for (const user of users) {
          stats.totalUsersProcessed++;

          const lastReset = user.last_credit_reset ? new Date(user.last_credit_reset) : null;
          if (!this.shouldResetUserCredits(lastReset)) {
            stats.usersSkipped++;
            continue;
          }

          // Expired paid plans fall back to the free tier instead of
          // continuing to receive paid-plan quotas forever.
          const planExpired =
            user.plan !== "admin" &&
            user.plan_expires_at &&
            new Date(user.plan_expires_at).getTime() < Date.now();
          const effectivePlan = planExpired ? "free" : user.plan;

          if (planExpired) {
            await this.supabase
              .from("users")
              .update({ plan: "free", plan_expires_at: null })
              .eq("telegram_id", user.telegram_id);
          }

          const result = await this.resetUserCredits(
            user.telegram_id,
            effectivePlan,
            user.created_at,
            user.credits
          );

          if (result.success) {
            stats.usersReset++;
            stats.totalCreditsDistributed += result.granted;
          } else if (stats.errors.length < 100) {
            stats.errors.push(
              `Failed to reset credits for user ${user.telegram_id}: ${result.error}`
            );
          }
        }

        offset += this.batchSize;
      }

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      if (this.logEnabled) {
        console.log(`[CreditReset] Completed in ${stats.duration}ms`);
        console.log(`[CreditReset] Summary:`, {
          processed: stats.totalUsersProcessed,
          reset: stats.usersReset,
          skipped: stats.usersSkipped,
          creditsDistributed: stats.totalCreditsDistributed,
          errors: stats.errors.length
        });
      }

      return stats;
    } catch (error: any) {
      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
      stats.errors.push(`Fatal error: ${error.message}`);

      if (this.logEnabled) {
        console.error("[CreditReset] Fatal error:", error);
      }

      return stats;
    }
  }

  /**
   * Health check - verify service can connect to database
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from("users")
        .select("telegram_id", { count: "exact", head: true })
        .limit(1);

      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Get reset statistics for monitoring
   */
  async getResetStatistics(): Promise<{
    usersNeedingReset: number;
    lastResetTime: string | null;
  }> {
    try {
      const todayStart = this.getTodayStartInTimezone();

      const { count, error } = await this.supabase
        .from("users")
        .select("telegram_id", { count: "exact", head: true })
        .lt("last_credit_reset", todayStart.toISOString());

      if (error) throw error;

      const { data: lastReset } = await this.supabase
        .from("credit_transactions")
        .select("created_at")
        .eq("transaction_type", "daily_reset")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        usersNeedingReset: count || 0,
        lastResetTime: lastReset?.created_at || null
      };
    } catch (error: any) {
      console.error("Failed to get reset statistics:", error.message);
      return {
        usersNeedingReset: 0,
        lastResetTime: null
      };
    }
  }
}

export default CreditResetService;
