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

## Backend deployment (Render Web Service)

- **Root directory:** repository root
- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start`
- **Required environment variables:** see `.env.example` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TONCENTER_API_KEY`, etc.)

The backend server entrypoint is `backend/server.ts` and `PORT` is read from environment for production hosts.
