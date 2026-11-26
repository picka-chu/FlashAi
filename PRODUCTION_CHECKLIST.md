# Production launch checklist

This repository contains the application code and deployment configuration. A successful build is not proof that external services, credentials, payment rails, or Telegram configuration are live. Complete and verify every applicable item before opening the app to users.

## Hosting and deployment

- [ ] Use a paid, always-on Render web-service plan for a real public launch. The current `render.yaml` intentionally remains on Render's free plan to avoid changing hosting spend without the owner's approval; the free plan can spin down and is not an appropriate production availability target.
- [ ] Confirm the Render service deploys the `main` branch with the Docker runtime and `/api/health` health check.
- [ ] Set `APP_URL` to the final HTTPS app URL and configure the Telegram Mini App domain with BotFather.
- [ ] Set the frontend build variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_TELEGRAM_BOT_USERNAME`. These are public client configuration values; never put service-role, bot, AI, or payment secrets in a `VITE_*` variable.
- [ ] Confirm the deployed container reports healthy and that a fresh deploy and rollback both work.

## Required backend configuration

Set these as Render environment variables (not in Git):

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (backend only; never expose it to the browser)
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `ADMIN_TELEGRAM_ID` for the intended administrator
- [ ] `BSD_API_KEY` or `BSD_FOOTBALL_API_KEY` for match data
- [ ] At least one supported Gemini key if AI analysis is part of the advertised product
- [ ] `APP_URL`, `TELEGRAM_BOT_USERNAME`, and the correct production timezone

Only configure optional integrations that have been created and tested. For payments, use live credentials only after successful end-to-end tests with the provider's test environment:

- [ ] Whop: plan IDs, API key, webhook signing secret, and the `POST /api/payments/whop-webhook` endpoint.
- [ ] Chapa: matching-environment secret/public keys, webhook secret, Ethiopian merchant settlement setup, and the `POST /api/payments/chapa-webhook` endpoint.
- [ ] TON: verified receiver address and TON Center API key; test intent comments and on-chain confirmation.
- [ ] Telegram Stars: verify invoice creation, successful-payment handling, and duplicate-update handling.

## Database and security

- [ ] Apply `CONSOLIDATED_PRODUCTION_SCHEMA.sql` to the production Supabase project before the first release and verify every migration/RPC completed successfully.
- [ ] Verify Row Level Security is enabled on every user-facing table and test policies with both anonymous and authenticated users.
- [ ] Confirm the service-role key is used only by the backend and rotate any credential ever committed, pasted into chat, or exposed in logs.
- [ ] Verify Telegram `initData` validation, admin authorization, rate limits, and payment webhook signatures against real requests.
- [ ] Configure Supabase backups and perform a restore test. Document who can access production secrets.
- [ ] Review privacy/terms, data retention, support contact, age/eligibility rules, and local legal requirements for the markets served.

## Release verification

- [ ] Complete the GitHub Actions checks: dependency install, TypeScript check, frontend build, and production Docker build.
- [ ] Test Telegram login on iOS, Android, and Telegram Desktop.
- [ ] Test signup, free credits, credit deduction, subscription expiry/reset, and account recovery paths.
- [ ] Test each enabled payment rail end-to-end, including invalid signatures, failed payments, retries, and duplicate webhook deliveries. Confirm credits/subscriptions are granted exactly once.
- [ ] Test API failure behavior when Supabase, Gemini, and the football-data provider are unavailable.
- [ ] Check mobile layout, accessibility basics, loading/error states, and browser console/network errors.
- [ ] Set up uptime/error monitoring, log review, incident contact, and a rollback procedure.

## Applied production hardening\n\n- [x] Applied `20261126170816_production_api_privilege_hardening` to the production Supabase project. Browser roles can read only `ads`, `faqs`, and `tasks`; they have no table write access, no access to backend-only tables or sequences, and no public RPC execution. The backend `service_role` retains its existing access. Future `postgres`-owned migrations inherit least-privilege defaults.\n- [ ] Re-run the end-to-end Telegram, signup, credits, subscription, and payment checks after this database change.\n\n## What this repository change covers

The production container now builds the frontend in a separate stage, installs runtime dependencies separately, runs as the unprivileged Node user, uses direct Node startup, and exposes a lightweight container health check. CI now builds the actual production Docker image in addition to type-checking and building the frontend.

External credentials, Supabase project state, provider dashboards/webhooks, Telegram BotFather configuration, live payment settlement, and hosting billing cannot be verified or provisioned from this repository alone. Do not describe the service as production-ready until the release verification above has been completed.
