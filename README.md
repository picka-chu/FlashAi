<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e25ceaed-b16a-42f2-8a80-ab48ad79ff0e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Database Migration Chain (Production)

Use this exact sequence in staging/production to avoid schema drift:

1. Freeze legacy tables and move them to `legacy` schema:
   `supabase_legacy_freeze_and_move.sql`
2. Apply canonical schema:
   `supabase_production_migration.sql`
3. Backfill old data into canonical tables:
   `supabase_data_backfill_from_legacy.sql`
