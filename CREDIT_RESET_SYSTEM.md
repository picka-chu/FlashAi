# Flash AI credit and pass lifecycle

## Entitlement model

- Free accounts receive up to **3 trial credits per day for the first 7 days** after signup.
- Paid passes are **finite credit pools**. They do not refill daily.
- Match analysis costs **1 credit**. Bet-slip image analysis costs **3 credits**.
- A paid pass has a fixed validity window: 1, 7 or 30 days depending on the product.
- On pass expiry, unused pass credits are removed. Remaining purchased credit-pack credits survive.
- Credit packs do not extend the plan expiry and do not expire.
- Admin accounts retain the configured administrator allowance.

## Balance accounting

The users table keeps two related values:

- `credits`: total spendable balance (remaining pass credits plus remaining credit-pack credits).
- `credit_balance`: the remaining credit-pack sub-balance.

The backend spends pass credits first. Once the pass portion is exhausted, each analysis reduces both `credits` and `credit_balance` by the amount consumed from the pack. On pass expiry, `credits` is set to the remaining pack balance; pass credits do not leak beyond the paid validity window.

The pricing correction migration also normalizes legacy rows where a credit-pack identifier was stored in `users.plan`. A pack is a top-up, not a subscription plan.

## Reset service

`backend/services/creditResetService.ts` runs on its configured timezone schedule:

1. Fetch users in batches.
2. Downgrade expired passes before deciding whether a daily reset is needed.
3. Preserve only the remaining top-up balance when a pass expires.
4. Apply the free-trial allowance only while the account is within its first 7 days.
5. Leave active paid-pass balances unchanged; they are not replenished.
6. Persist the resulting balance and `last_credit_reset`.

The API's `syncUserCredits` helper applies the same rules when a user starts an analysis, so an expired pass is enforced even if the scheduled job has not run yet.

## Required deployment order

1. Apply `supabase/migrations/20261126_pricing_credit_fixes.sql` after the country/day-pass migration.
2. Deploy the backend and frontend from the same commit.
3. Verify a pass purchase adds only the configured pass credits and extends expiry.
4. Verify a credit-pack purchase adds to both spendable credits and the pack sub-balance without changing the plan expiry.
5. Spend pass credits first, then confirm pack credits decrease in both fields.
6. Expire a pass in staging and confirm only remaining pack credits survive.
7. Confirm paid plans receive no midnight refill and free trial credits stop after day seven.

## Operational notes

- Do not run the new backend against a database that has not applied the migration: the debit path reads and updates `credit_balance`.
- Keep provider fulfilment idempotent. A redirect is not proof of payment; verify the provider transaction before granting credits.
- Monitor AI spend per credit, pass redemptions, pack redemptions, expiry disputes and failed payment fulfilments.
