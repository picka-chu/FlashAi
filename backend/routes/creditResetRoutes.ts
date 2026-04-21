import { Hono } from "hono";
import CreditResetScheduler from "../tasks/creditResetScheduler.js";

/**
 * Credit Reset Management Routes
 * Provides endpoints for monitoring and managing the credit reset system
 * Protected by admin authentication
 */

export function createCreditResetRoutes(scheduler: CreditResetScheduler) {
  const router = new Hono();

  /**
   * GET /api/admin/credit-reset/status
   * Get current scheduler status
   */
  router.get("/status", (c) => {
    const status = scheduler.getStatus();
    return c.json({
      status: "ok",
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /api/admin/credit-reset/statistics
   * Get reset statistics and monitoring data
   */
  router.get("/statistics", async (c) => {
    try {
      const stats = await scheduler.getStatistics();
      return c.json({
        status: "ok",
        data: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      return c.json({
        status: "error",
        message: error.message
      }, 500);
    }
  });

  /**
   * POST /api/admin/credit-reset/trigger
   * Manually trigger a credit reset (for testing or manual execution)
   * Requires admin authentication
   */
  router.post("/trigger", async (c) => {
    try {
      // TODO: Add proper admin authentication check here
      // For now, just check if request has admin header
      const adminToken = c.req.header("X-Admin-Token");
      if (!adminToken || adminToken !== process.env.ADMIN_API_KEY) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const stats = await scheduler.manualReset();
      return c.json({
        status: "success",
        message: "Credit reset triggered successfully",
        results: {
          processed: stats.totalUsersProcessed,
          reset: stats.usersReset,
          skipped: stats.usersSkipped,
          creditsDistributed: stats.totalCreditsDistributed,
          duration: `${stats.duration}ms`,
          errors: stats.errors
        },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      return c.json({
        status: "error",
        message: error.message
      }, 500);
    }
  });

  /**
   * GET /api/admin/credit-reset/health
   * Health check for the credit reset service
   */
  router.get("/health", async (c) => {
    try {
      const stats = await scheduler.getStatistics();
      return c.json({
        status: "healthy",
        scheduler: scheduler.getStatus(),
        usersNeedingReset: stats.usersNeedingReset,
        lastResetTime: stats.lastResetTime,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      return c.json({
        status: "unhealthy",
        error: error.message
      }, 503);
    }
  });

  return router;
}

export default createCreditResetRoutes;
