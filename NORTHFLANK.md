# Deploy Flash AI on Northflank

Flash AI runs as **one combined Node.js service**: the Hono API, Telegram bot and built Vite frontend are served by the same process. Supabase remains the external database.

## Service configuration

1. Create a **Combined Service** from the GitHub repository `picka-chu/FlashAi`.
2. Select the `main` branch and Dockerfile buildpack.
3. Set the Dockerfile path to `/Dockerfile` and build context to the repository root.
4. Add the build arguments below, then build and deploy.
5. Expose the service as public HTTP on port `3000`.
6. Configure the health check as HTTP `GET /api/health` (expected status `200`).
7. Start with **one replica**. The Telegram bot uses long polling and the app runs in-process schedulers; multiple replicas can conflict and duplicate scheduled work.

## Docker build arguments

These values are embedded in the Vite frontend at build time:

| Build argument | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `VITE_TELEGRAM_BOT_USERNAME` | Bot username without `@` |
| `VITE_USD_TO_TON_RATE` | Optional fallback rate, e.g. `0.23` |

The anon key is designed to be public. **Never put the Supabase service-role key or any other secret in a `VITE_*` variable.**

## Runtime environment variables

Required:

- `NODE_ENV=production`
- `PORT=3000`
- `APP_URL=https://YOUR-PUBLIC-NORTHFLANK-DOMAIN` — set this after assigning the public domain; it must be HTTPS for Telegram Web App buttons.
- `TRUST_PROXY=true`
- `TIMEZONE=Africa/Addis_Ababa`
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase service-role key
- `TELEGRAM_BOT_TOKEN` — Telegram bot token

Recommended for full features:

- `TELEGRAM_BOT_USERNAME` — username without `@`
- `ADMIN_TELEGRAM_ID` — numeric Telegram ID for the bootstrap admin
- `GEMINI_API_KEY` or one of the supported numbered Gemini keys
- `BSD_API_KEY` (or `BSD_FOOTBALL_API_KEY`) for football data
- `NOTIFICATIONS_ENABLED=true` if you want the engagement notification scheduler enabled

Add payment-provider secrets and IDs only if those payment methods are enabled. Use Northflank's secret environment variables for all private keys.

## Important deployment notes

- Stop the old Render deployment before starting this deployment with the same Telegram bot token. Telegram long polling should have only one active instance.
- Keep the replica count at one unless the bot polling and all in-process schedulers are moved to separate, coordinated workers.
- The `/api/health` endpoint is a liveness check; it confirms the HTTP process is responding, not that Supabase, Gemini or the football provider is healthy.
- If you change any `VITE_*` build argument, trigger a new image build; changing only runtime variables will not update values already compiled into the frontend.
- Northflank's free Developer Sandbox has resource and usage limits and is intended for hobby projects. Check the current plan allowance before relying on it for a production workload.
