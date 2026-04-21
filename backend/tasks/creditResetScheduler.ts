import CreditResetService from "../services/creditResetService.js";

/**
 * Credit Reset Scheduler
 * Runs daily credit resets at midnight UTC
 * Can be triggered manually or scheduled via cron job
 */

interface SchedulerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  timezone?: string;
  autoStart?: boolean;
  checkInterval?: number; // milliseconds, default 60000 (1 minute)
}

export class CreditResetScheduler {
  private resetService: CreditResetService;
  private checkInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private lastResetDate: string | null = null;
  private isRunning: boolean = false;

  constructor(config: SchedulerConfig) {
    this.resetService = new CreditResetService({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
      timezone: config.timezone || "UTC",
      logEnabled: true
    });

    this.checkInterval = config.checkInterval || 60000; // Check every minute by default

    if (config.autoStart) {
      this.start();
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log("[CreditResetScheduler] Already running");
      return;
    }

    this.isRunning = true;
    console.log(
      `[CreditResetScheduler] Started with check interval: ${this.checkInterval}ms`
    );

    // Check immediately on start
    this.checkAndReset();

    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkAndReset();
    }, this.checkInterval);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[CreditResetScheduler] Stopped");
  }

  /**
   * Check if it's time to reset and execute if needed
   */
  private async checkAndReset(): Promise<void> {
    try {
      const now = new Date();
      const today = now.toISOString().split("T")[0]; // YYYY-MM-DD

      // Skip if already reset today
      if (this.lastResetDate === today) {
        return;
      }

      // Check if it's midnight (00:00-00:59 UTC)
      if (now.getUTCHours() !== 0) {
        return;
      }

      // Verify service is healthy
      const isHealthy = await this.resetService.healthCheck();
      if (!isHealthy) {
        console.error("[CreditResetScheduler] Health check failed");
        return;
      }

      console.log("[CreditResetScheduler] Executing reset at", now.toISOString());

      // Execute the reset
      const stats = await this.resetService.resetAllUserCredits();

      // Mark as reset for today
      this.lastResetDate = today;

      // Log results
      console.log("[CreditResetScheduler] Reset completed:", {
        processed: stats.totalUsersProcessed,
        reset: stats.usersReset,
        skipped: stats.usersSkipped,
        creditsDistributed: stats.totalCreditsDistributed,
        duration: `${stats.duration}ms`,
        errors: stats.errors.length > 0 ? stats.errors : "none"
      });

      // Alert on errors
      if (stats.errors.length > 0) {
        console.error("[CreditResetScheduler] Errors occurred:", stats.errors);
      }
    } catch (error: any) {
      console.error("[CreditResetScheduler] Unexpected error:", error.message);
    }
  }

  /**
   * Manually trigger a reset (useful for testing or manual execution)
   */
  async manualReset(): Promise<any> {
    console.log("[CreditResetScheduler] Manual reset triggered");
    const stats = await this.resetService.resetAllUserCredits();
    this.lastResetDate = new Date().toISOString().split("T")[0];
    return stats;
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    lastResetDate: string | null;
    checkInterval: number;
  } {
    return {
      isRunning: this.isRunning,
      lastResetDate: this.lastResetDate,
      checkInterval: this.checkInterval
    };
  }

  /**
   * Get reset statistics
   */
  async getStatistics(): Promise<any> {
    return this.resetService.getResetStatistics();
  }
}

export default CreditResetScheduler;
