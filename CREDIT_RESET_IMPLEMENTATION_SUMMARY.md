# Credit reset implementation history

This document records the original daily-refill implementation. Its old statements that every paid plan receives a daily credit allocation are **superseded** by the current entitlement model in [CREDIT_RESET_SYSTEM.md](CREDIT_RESET_SYSTEM.md).

## Current source of truth

- Free trial: 3 credits per day for the first 7 days.
- Paid passes: finite credit pools; no daily refill.
- Pass credits expire when the pass expires.
- Separately purchased credit-pack credits do not expire and remain usable after pass expiry.
- Match analysis costs 1 credit; bet-slip analysis costs 3 credits.
- The scheduled reset service processes expiry even when a user's last daily reset is current.

## Relevant implementation

- `backend/services/creditResetService.ts`: scheduled reset and pass-expiry processing.
- `backend/tasks/creditResetScheduler.ts`: scheduler lifecycle.
- `backend/server.ts`: request-time credit synchronisation and atomic balance deduction.
- `supabase/migrations/20261126_pricing_credit_fixes.sql`: purchase RPC and pack/pass balance semantics.
- `CREDIT_RESET_SYSTEM.md`: current deployment and operational guide.

## Deployment reminder

Apply the Supabase migrations in order before deploying the matching backend. Test a pass purchase, top-up purchase, pass expiry, and top-up redemption after expiry in staging. Do not use the original daily-refill assumptions from this historical document.
