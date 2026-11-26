# Flash AI — Production Playbook

Five documents that together answer: *can this sell, where, how, for how much, and what makes people come back?*

| # | Document | Answers |
|---|---|---|
| 01 | [Market research](01-market-research.md) | Which countries are worth it, what's legal, how big is the prize, what breaks first |
| 02 | [Pricing strategy](02-pricing-strategy.md) | Exact price per country, margin proof, fair use, rollout plan |
| 03 | [Payments matrix](03-payments-matrix.md) | Which rail works where, fees, entity requirements, Telegram ToS constraint |
| 04 | [Growth & affiliates](04-growth-and-affiliates.md) | Referral design, task catalogue, 1xBet/Melbet/Betway deals and compliance |
| 05 | [Habit & responsible design](05-habit-and-responsible-design.md) | How addictive is it today, what to add, what never to build |

---

## The five decisions that matter

1. **Ethiopia is an audience market, not a revenue market.** All betting licences were revoked in Dec 2025 and no operator is licensed. Keep it free; monetise later.
2. **Nigeria first, Kenya second.** Paystack and Flutterwave both support the category and settle locally.
3. **Telegram's ToS requires Stars for in-app digital goods.** Local rails go through an external web checkout, behind a kill switch.
4. **Prices are fixed in local currency**, set at ~2.5–8% of a monthly wage, and every plan clears 65% margin at its hard cap.
5. **Your model names are a generation old.** This is a live outage waiting to happen — patch it before anything else.

---

## Shipping status

| Piece | State |
|---|---|
| `backend/config/marketPricing.ts` | ✅ Written. 8 markets, 4 paid tiers, 32 plan×market combinations all ≥65% margin |
| `backend/routes/pricing.ts` | ✅ Written. `GET /api/pricing`, `GET /api/pricing/economics` (admin) |
| `server.ts` registration | ✅ Wired |
| Live prices | ⏸ **Unchanged.** Gated behind `PRICING_V2_ENABLED` |
| Frontend price cards | ⏸ Pending price approval |
| Referral attribution fix | ⏸ Designed, not implemented (doc 04 §2) |
| Model list update | ⏸ **P0**, patch supplied (doc 02 §7.1) |

---

## Verify the economics yourself

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://<your-api>/api/pricing/economics?country=ET"
```

```json
{
  "country": "ET",
  "perAnalysisUsd": 0.025,
  "targetMargin": 0.65,
  "plans": [ { "offer": { "id": "monthly_basic", "priceMinor": 49900 }, "marginAtCap": 0.676, "healthyAtCap": true } ],
  "healthy": true
}
```

Change any price in `marketPricing.ts` and this endpoint tells you immediately whether the plan still makes money at full usage.

---

## Sources

All claims carry ✅ (documented), ⚠️ (derived/indicative) or ❓ (unverified) markers in the documents. Primary sources include Telegram's Bot Platform ToS and Stars documentation, Google's Gemini API pricing, DataReportal Digital 2026, World Bank, Safaricom, Appsflyer Q3 2026 retention data via Spreadcast, RevenueCat 2026 benchmarks, iGaming Business (Ethiopia), Kenya Law (L.N. 111/2026), and the providers' own pricing pages. Every URL was read on 25–26 Nov 2026.
