import type { Hono } from "hono";
import {
  AI_COST,
  TARGET_MARGIN,
  buildPricingPayload,
  estimateEconomics,
  getOffers,
  normalizeCountry,
} from "../config/marketPricing.js";

/**
 * Pricing + payment-method discovery for the Mini App.
 *
 * GET /api/pricing?country=ET
 *   Public. Returns the fixed local-currency catalog for the caller's market.
 *
 * GET /api/pricing/economics?country=ET&perAnalysis=0.015
 *   Admin only. Returns worst-case margin per plan so pricing can be reviewed
 *   before a plan ships. Requires x-admin-api-key === ADMIN_API_KEY.
 */
export function registerPricingRoutes(
  app: Hono,
  deps?: { resolveCountry?: (c: any) => Promise<string | null> },
) {
  app.get("/api/pricing", async (c) => {
    const explicit = c.req.query("country");
    const resolved = explicit || (deps?.resolveCountry ? await deps.resolveCountry(c) : null);
    const country =
      resolved ||
      // Telegram may not forward a country; fall back to a CDN hint.
      c.req.header("cf-ipcountry") ||
      c.req.header("x-vercel-ip-country") ||
      c.req.header("x-country-code") ||
      null;

    const payload = buildPricingPayload(country);
    // Prices are market-dependent; never let a CDN pin one country's catalog
    // to another. The Mini App caches per session instead.
    c.header("Cache-Control", "no-store");
    c.header("Vary", "cf-ipcountry, x-vercel-ip-country, x-country-code");
    return c.json(payload);
  });

  app.get("/api/pricing/economics", (c) => {
    const configured = String(process.env.ADMIN_API_KEY || "").trim();
    const supplied = String(c.req.header("x-admin-api-key") || "").trim();
    if (!configured || supplied !== configured) {
      return c.json({ error: "Not authorised" }, 401);
    }

    const country = normalizeCountry(c.req.query("country"));
    const rawCost = Number(c.req.query("perAnalysis"));
    const perAnalysis = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : AI_COST.optimisedPerAnalysis;

    const rows = getOffers(country)
      .filter((offer) => offer.priceMinor > 0)
      .map((offer) => estimateEconomics(offer, country, perAnalysis));

    return c.json({
      country,
      perAnalysisUsd: perAnalysis,
      targetMargin: TARGET_MARGIN,
      costAssumptions: AI_COST,
      plans: rows,
      healthy: rows.every((row) => row.healthyAtCap),
    });
  });
}
