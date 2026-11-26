# Flash AI pricing and monetisation plan

**Status:** implementation proposal on a feature branch. Do not enable `PRICING_V2_ENABLED` in production until the deployment checklist below is complete.

## 1. Commercial model

Flash AI sells time-limited access passes, not recurring subscriptions. Chapa, TON and Telegram Stars purchases are one-time payments; nothing auto-renews.

- **Credits are the spendable unit.** A match analysis costs 1 credit. A bet-slip analysis costs 3 credits because it includes image/OCR processing.
- **Paid passes are finite pools.** Credits can be used at any time during the pass validity window; there is no daily refill and no daily cap.
- **Pass credits expire with the pass.** A new pass purchase adds its credit allocation and extends the validity window.
- **Credit packs are separate top-ups.** They do not extend a pass and do not expire. They are consumed after pass credits and remain available after a pass expires.
- **Free trial:** 3 credits per day for the first 7 days. After that, only purchased credits remain available.
- Never say “unlimited”, “guaranteed”, “win rate guaranteed”, or “auto-renewing”. Do not imply a prediction guarantees a betting outcome.

## 2. Fixed local prices

Prices are stored in local minor units and are not derived from live FX at checkout.

| Market | Day pass | 7-day pass | 30-day Basic | 30-day Pro |
|---|---:|---:|---:|---:|
| Ethiopia | 59 ETB | 199 ETB | 499 ETB | 999 ETB |
| Kenya | 49 KES | 159 KES | 399 KES | 799 KES |
| Nigeria | 500 NGN | 1,500 NGN | 3,990 NGN | 7,900 NGN |
| Ghana | 5 GHS | 15 GHS | 39 GHS | 79 GHS |
| Tanzania | 900 TZS | 2,900 TZS | 7,900 TZS | 15,900 TZS |
| Uganda | 1,500 UGX | 4,900 UGX | 11,900 UGX | 23,900 UGX |
| South Africa | 9 ZAR | 29 ZAR | 69 ZAR | 129 ZAR |
| Rest of world | $0.99 | $2.99 | $6.99 | $12.99 |

### Pass allowances

| Offer | Credits | Validity | Main positioning |
|---|---:|---:|---|
| Match Day Pass | 1 | 1 day | Try one full analysis |
| 7-Day Pass | 6 | 7 days | Short commitment |
| 30-Day Basic | 16 | 30 days | Core paid tier |
| 30-Day Pro | 31 | 30 days | Full pick board and up to 6 bet-slip images per analysis |

The credit pool is the enforceable lifetime allowance for each purchase. The backend does not refill paid-plan credits daily.

## 3. Credit packs

Credit packs are priced at or above the Basic pass's per-credit price. This avoids selling an unlimited-duration AI credit below the cost floor.

| Pack | Credits | Price formula | Expiry |
|---|---:|---|---|
| 20 credits | 20 | 1.25 × Basic price, rounded up to a whole local currency unit | No expiry |
| 50 credits | 50 | 3.125 × Basic price, rounded up | No expiry |
| 100 credits | 100 | 6.25 × Basic price, rounded up | No expiry |
| 250 credits | 250 | 15.625 × Basic price, rounded up | No expiry |

Packs are currently displayed only in Ethiopia and the global market, where a supported checkout rail can fulfil them. Do not show them in markets where the available checkout integration cannot fulfil them. Telegram Stars are not enabled for credit packs. Whop card checkout is not enabled for packs until product-specific Whop plans are configured.

The database keeps two balances:
- `credits`: total spendable credits (pass pool plus remaining top-ups).
- `credit_balance`: remaining purchased top-up credits.

Consumption spends pass credits first and then reduces both balances for top-up credits. When a pass expires, only the remaining top-up balance survives.

## 4. Unit economics

Use the conservative current budget of **$0.06 per credit** until usage telemetry proves a lower, repeatable cost. The $0.025 optimised path is not the pricing default because the code has not established that cost ceiling in production. The estimate is deliberately conservative; bet-slip submissions cost 3 credits and therefore have a larger allowance deduction.

| Offer | Credit cap | Cost at $0.06/credit |
|---|---:|---:|
| Day pass | 1 | $0.06 |
| 7-day pass | 6 | $0.36 |
| Basic | 16 | $0.96 |
| Pro | 31 | $1.86 |

The lowest USD-equivalent revenues among the current local price points are approximately $0.34 (day), $1.09 (weekly), $2.91 (Basic) and $5.78 (Pro). Corresponding worst-market gross margins before payment fees, tax, refunds and support are approximately 82%, 67%, 67% and 68%. These clear the 65% model target, but the remaining headroom is not large on weekly and monthly tiers. Re-check `GET /api/pricing/economics?country=XX` using the actual cost-per-credit value from provider billing before increasing allowances or discounting.

The economics endpoint must default to `AI_COST.currentPerAnalysis`, not the unshipped optimisation estimate. If the current cost rises, reduce credit allocations or increase prices before acquisition spend.

## 5. Payment and checkout rules

- **Ethiopia:** Chapa is the local checkout rail when merchant onboarding and ETB settlement are configured. TON checkout must use the Ethiopian offer's USD-equivalent price. Hide TON until the localized pricing UI is enabled.
- **Global:** Whop is the card rail; TON is the alternative. Telegram Stars are not shown globally because the fixed Stars ladder would underprice the $6.99/$12.99 plans.
- **Telegram Stars:** pass-only. The seller fee is materially higher than card/wallet processing; keep Stars secondary to local payment methods.
- **Credit packs:** no Stars; only show them where a working payment rail can fulfil the pack.
- A payment is not a subscription. Label every pass with its exact validity period and say “one-time payment”.
- Never activate a plan from a browser redirect alone. Verify payment with the provider and make fulfilment idempotent.

## 6. Market and compliance guardrails

The country status in the catalogue is a screening signal, not legal advice or proof that a paid betting-related product is permitted. Before taking payments in a country, confirm local gambling/affiliate/advertising restrictions, minimum-age requirements, tax/VAT obligations, consumer refund rules, merchant onboarding eligibility and payment-provider terms. Keep paid checkout disabled where those checks are not complete.

Use responsible product language: predictions are informational, odds change, outcomes are uncertain, and users can lose money. Do not use urgency tricks, guaranteed-win claims, or targeting that encourages chasing losses. Apply the applicable legal age in each market; do not assume one universal age threshold.

## 7. Rollout checklist

1. Deploy the backend and database migration with `PRICING_V2_ENABLED` still false.
2. Run the TypeScript check and migration against a staging database.
3. Verify each market's `/api/pricing/economics` response is healthy using the current measured cost.
4. Test pass purchases, pass renewals, pass expiry, credit-pack purchases, credit-pack consumption, and pack survival after pass expiry.
5. Test Chapa amount verification, Stars pass-only behaviour, TON local-price intents, and unsupported-market pack visibility.
6. Enable the flag for a small cohort/market only after legal and merchant checks. Keep the flag reversible.
7. Grandfather active passes: do not change their expiry or remove already-purchased credits mid-term.
8. Review conversion, refunds, support contacts, cost per credit and gross margin weekly during the pilot.

**Do not deploy or enable the pricing flag as part of this code change.** This branch only prepares the code and documentation for a controlled release.
