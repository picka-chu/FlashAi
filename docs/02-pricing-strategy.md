# Pricing Strategy — Country-Aware Plan

**Goal:** one price list per market, fixed in local currency, that clears a 65% gross margin when a user runs the pass to its hard cap.

Source of truth: `backend/config/marketPricing.ts`. Live endpoint: `GET /api/pricing?country=XX`.

---

## 1. Why the current pricing fails

| Current | Problem |
|---|---|
| `$8.99` / `$14.99` shown **first** to Ethiopian users (`Profile.tsx:1365`) | 1,460 ETB / 2,430 ETB = 22% / 37% of an average formal wage. Nobody converts at that. |
| ETB derived from live USD (`chapaService.getChapaPricing`) | FX drifts ~1% a month; the same plan costs a different amount every renewal. |
| Called "per month" | **Nothing auto-renews.** Chapa/Telebirr/CBE Birr are one-time pushes. You are selling a 30-day pass and calling it a subscription — that is a refund and chargeback generator. |
| Credits (10 / 16) vs analyses (2 / 6 per day) | Two currencies for one thing. Users cannot tell what they bought. |
| 6 analyses/day on Pro | At $0.025–0.06 per grounded analysis, 180 analyses/month can cost **$4.50–10.80** against $14.99. Margin is only safe because almost nobody uses it. |
| Stars at 500 / 800 | `USD_TO_STARS_RATE = 50` marks up ~11%, but Stars already cost you ~35%. Net on Basic is ~$6.50 against a $8.99 list. |

---

## 2. The price list

All prices are **fixed**. Nothing is computed from an FX rate at checkout.

| Market | Day pass | 7-day | 30-day Basic | 30-day Pro | Basic as % of monthly wage |
|---|---|---|---|---|---|
| 🇪🇹 Ethiopia | **59 ETB** | **199 ETB** | **499 ETB** | **999 ETB** | 7.7% |
| 🇰🇪 Kenya | **49 KES** | **159 KES** | **399 KES** | **799 KES** | 2.5% |
| 🇳🇬 Nigeria | **₦500** | **₦1,500** | **₦3,990** | **₦7,900** | 5.7% |
| 🇬🇭 Ghana | **GH₵5** | **GH₵15** | **GH₵39** | **GH₵79** | 6.6% |
| 🇹🇿 Tanzania | **TZS 900** | **TZS 2,900** | **TZS 7,900** | **TZS 15,900** | 6.6% |
| 🇺🇬 Uganda | **UGX 1,500** | **UGX 4,900** | **UGX 11,900** | **UGX 23,900** | 2.0% |
| 🇿🇦 South Africa | **R9** | **R29** | **R69** | **R129** | 1.3% |
| 🌍 Rest of world | **$0.99** | **$2.99** | **$6.99** | **$12.99** | — |

USD equivalent at the 26 Nov 2026 rate (161.54 ETB, 129.98 KES, 1,366.83 NGN, 11.88 GHS, 2,668.41 TZS, 4,085.84 UGX, 17.53 ZAR):

| Market | Basic USD | Pro USD | Old Basic USD | Change |
|---|---|---|---|---|
| ET | $3.09 | $6.18 | $8.99 | −66% |
| KE | $3.07 | $6.15 | $8.99 | −66% |
| NG | $2.92 | $5.78 | $8.99 | −68% |
| GH | $3.28 | $6.65 | $8.99 | −63% |
| TZ | $2.96 | $5.96 | $8.99 | −67% |
| UG | $2.91 | $5.85 | $8.99 | −68% |
| ZA | $3.94 | $7.36 | $8.99 | −56% |
| Global | $6.99 | $12.99 | $8.99 | −22% |

**Why cut so hard:** the anchor is not your old price, it is what the customer already pays. Showmax Mobile is KES 200, ₦2,000, GH₵24.30, R50. A niche analytics tool priced above the local streaming bundle does not convert. You win on volume and on the day pass, not on a $9 sticker.

---

## 3. Unit economics at the hard cap

Cost model (verified against Google's Nov 2026 list prices):
- Tokens: ~6k in @ $0.75/M + ~1.5k out @ $3.75/M ≈ **$0.010** per request
- Grounding: **$14 per 1,000 requests = $0.014** per grounded request (5,000 free/month)
- ⇒ **$0.024** per grounded request
- Current path = up to 3 grounded requests = **$0.06** worst case
- Optimised path = 1 grounded request + cached context = **$0.025**

| Plan | Hard cap | Cost at cap | ET margin | KE margin | NG margin | GH margin | TZ margin | UG margin | ZA margin | Global |
|---|---|---|---|---|---|---|---|---|---|---|
| Day pass | 2 | $0.05 | 86% | 87% | 86% | 88% | 85% | 86% | 90% | 95% |
| 7-day | 14 | $0.35 | 72% | 71% | 68% | 72% | 68% | 71% | 79% | 88% |
| Basic | 40 | $1.00 | 68% | 67% | 66% | 70% | 66% | 66% | 75% | 86% |
| Pro | 80 | $2.00 | 68% | 68% | 65% | 70% | 66% | 66% | 73% | 85% |

Every cell clears the 65% target. Verify any change with:

```
GET /api/pricing/economics?country=ET
x-admin-api-key: <ADMIN_API_KEY>
```

It returns `healthy: true/false` for the whole market and the exact margin per plan.

**What happens if you keep 6/day Pro:** 180 analyses × $0.025 = $4.50 cost against $6.18 revenue = 27% margin. Against today's $0.06 unoptimised cost it is **$10.80 — a loss on every active Pro user.** This is the single most important number in this document.

---

## 4. Fair use — the thing that makes the price real

Marketing says "up to 4 analyses/day". The catalogue enforces a **pass total**: 40 analyses on Basic, 80 on Pro, 14 on the 7-day, 2 on the day pass.

Why: a small number of users will hit the daily maximum every day. Without a pass total, those users consume 2–3× the cost the price was designed for. With it, the worst case is bounded and the price is honest.

Copy to use, in this order:
> **30-Day Basic — 499 ETB**
> Up to 2 analyses per day · 40 analyses per pass · expires after 30 days

Never say "unlimited". Never say "per month" unless a real mandate exists.

**Implementation note:** enforcement needs a per-pass counter. Today `syncUserCredits` resets daily; add `pass_started_at`, `pass_analyses_used`, `pass_analyses_cap` on `users` and check them in the analysis route. Until that ships, the cap exists only in the catalogue — acceptable for launch (typical usage is <15/month), but it must ship before you spend on acquisition.

---

## 5. Telegram Stars — the expensive rail

Telegram takes ~35%: the user pays ~$0.0199/star, you receive **$0.013/star**, with a **21-day hold** before Stars become withdrawable.

To net a local price `L`, you must charge `L / 0.65` in user value:

| | Local price | Stars charged | User pays ≈ | You net |
|---|---|---|---|---|
| Basic | $3.09 | **240 ⭐** | $4.78 | $3.12 |
| Pro | $6.18 | **480 ⭐** | $9.55 | $6.24 |
| 7-day | $1.23 | **95 ⭐** | $1.89 | $1.24 |
| Day pass | $0.37 | **30 ⭐** | $0.60 | $0.39 |

Consequences:
1. **Stars buyers pay ~54% more than card/wallet buyers.** That is unavoidable; it is Telegram's cut, not yours.
2. **Stars must never be the default for monthly plans.** Lead with the local rail; offer Stars as "pay with Telegram Stars" secondary.
3. **Withdraw early and often.** 21 days of float on a market with 30-day passes means you are financing growth from working capital.
4. For very small baskets (day pass), Stars is a bad deal for the user. Offer Stars only from the 7-day tier up.

---

## 6. Rollout — do not flip the switch blind

The endpoint ships **inactive**. `PRICING_V2_ENABLED` unset → `buildPricingPayload().enabled === false` → the Mini App keeps rendering the current cards.

| Step | Action | Reversible |
|---|---|---|
| 1 | Deploy `/api/pricing` with flag off | ✅ |
| 2 | Check `/api/pricing/economics` for every market is `healthy: true` | ✅ |
| 3 | Ship new Profile cards behind the flag; test as ET / NG / KE | ✅ |
| 4 | Enable for **new users only** in Nigeria for 14 days | ✅ (flag per country) |
| 5 | Compare conversion + refunds vs control | — |
| 6 | Grandfather existing subscribers at their paid price until expiry | — |
| 7 | Roll out market by market | ✅ |

**Grandfathering rule:** never reprice an active pass. `pass_expires_at` stays as sold. New prices apply at the next purchase. This is both fair and legally safer than mid-term changes.

---

## 7. Required code patches

### 7.1 Model list (P0)

`backend/services/multiAgentService.ts:30-34` — current models are a generation old, and Gemini 1.5 is retired:

```ts
/** Current-gen first, legacy as trailing fallbacks so a deprecation degrades, not breaks. */
const AGENT_MODELS  = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
/** Search grounding is not GA on flash-lite - keep a grounded-capable model first. */
const SEARCH_MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const VISION_MODELS = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
```

Add a boot check that performs one tiny request against `AGENT_MODELS[0]` and logs `CRITICAL: primary model unreachable` on failure, so you learn from logs instead of from churn.

### 7.2 Stop deriving ETB from USD

`backend/services/chapaService.ts` — `getChapaPricing` must read the fixed price from `marketPricing.getOffers("ET")` and only use the FX endpoint for the admin economics view. Keep `DEFAULT_USD_ETB_RATE` for reporting only.

### 7.3 Rename the product surface

| Now | Should be |
|---|---|
| "Monthly Basic" | "30-Day Basic" |
| "per month" | "for 30 days" |
| "4,900 Stars" (implied auto) | "480 ⭐ one-time" |
| "Subscription" in copy | "Pass" |
| Renewal email at day 30 | Reminder at **day 27**, one tap to renew |

---

## 8. A/B tests worth running (after 200 payers)

| Test | Hypothesis | Metric |
|---|---|---|
| Day pass 59 vs 79 ETB | Impulse price beats margin | Paid conversion × margin |
| Basic 499 vs 699 ETB | Anchor to Pro at 999 | ARPU, mix shift |
| "40 analyses per pass" vs "2 per day" | Concrete total converts better | Checkout completion |
| Local rail first vs Stars first | Users distrust Stars pricing | Checkout completion by rail |
| 7-day highlighted as "Most popular" | Lower commitment beats monthly | New-payer count |

One test at a time, minimum 2 weeks, no peeking.

---

## 9. Guardrails

1. **Price never derives from FX at checkout.** Fixed table only.
2. **No plan ships** unless `healthy: true` in `/api/pricing/economics`.
3. **No "unlimited".** No "guaranteed". No countdown timers on odds.
4. **Cancel is as easy as buy** — one tap, no support ticket.
5. **Do not raise prices on an active pass.** Ever.
6. **Review margin quarterly** — Gemini and grounding prices change (3.x Flash doubles on 1 Jan 2027).
