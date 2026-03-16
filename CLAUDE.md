# CLAUDE.md

## Project Overview

Le Directeur is a community web app that generates AI-powered brutally honest cycling commentary on group activities. Athletes connect via OAuth (Strava, Wahoo, Garmin), activities arrive via webhooks, Claude generates roasts, and everything is displayed on a shared leaderboard and personal feed.

## Tech Stack

- **Frontend:** Plain HTML/CSS/JS, built with Vite
- **Backend:** Netlify Functions (`.mjs`, ESM)
- **Database:** Supabase (PostgreSQL)
- **AI:** Claude API (Sonnet) via `@anthropic-ai/sdk`
- **Package manager:** pnpm

## Commands

- `pnpm run build` — Vite production build
- `pnpm run dev` — Local dev via `netlify dev` (port 8888)
- Netlify Functions are at `netlify/functions/`, served under `/api/*`

## Strava API Compliance — CRITICAL

All changes must comply with Strava's API Agreement and Brand Guidelines. Violations can result in app suspension.

### Data Privacy

- **Athletes must opt in** (`share_with_group = true`) before their data is visible to other users on the leaderboard. Never show one athlete's data to another without explicit consent.
- The app qualifies as a **Community Application** (under 10,000 users, group collaboration focus). This is the exception that allows shared data display.

### Data Retention

- **7-day maximum cache.** Activity data must be purged after 7 days. The `purge-old-activities.mjs` scheduled function handles this daily. Never store activities longer than 7 days.
- When an athlete **deauthorizes**, delete all their data (profile + activities) immediately. The webhook handler covers this.
- When an activity is **deleted** on Strava, remove it from our database too.

### Branding

- **Never use "Strava" in the app name.** The app is called "Le Directeur", not "Strava Directeur".
- Display **"Powered by Strava"** attribution using the official unmodified logo (in `src/images/`).
- All activity cards must include a **"View on Strava"** link (`https://www.strava.com/activities/{id}`) in Strava orange (#FC5200), bold or underlined.
- Never imply Strava endorses, sponsors, or developed this app.
- Never use Strava logos as the app icon or modify/animate them.

### AI Usage

- Strava prohibits using API data for **model training**. We only use Claude for **inference** (generating roasts from activity stats). Never use Strava data for fine-tuning, training, or building datasets.

### Rate Limits

- 200 requests per 15 minutes, 2,000 per day (application-wide).
- 100 read requests per 15 minutes, 1,000 per day.
- Use webhooks for new activities — never poll the API.

## Environment Variables

All secrets are in `.env` (gitignored) and set in Netlify dashboard:

`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_SECRET`, `ADMIN_ATHLETE_ID`, `SITE_URL`, `JWT_SECRET`, `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET`, `WAHOO_WEBHOOK_TOKEN`, `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET`

## Git / Deployment

- **Production deploys from the `deploy` branch only.** Pushes to `main` do NOT trigger Netlify deploys. When ready to deploy, merge `main` into `deploy` and push: `git checkout deploy && git merge main && git push origin deploy && git checkout main`
- Day-to-day development happens on `main`. Push freely without burning build credits.
- The Netlify site is `le-directeur.netlify.app`.

## Key Architecture Decisions

- **Background functions:** The backfill uses a Netlify Background Function (`-background.mjs` suffix) because regular functions have a 10s timeout. Background functions get 15 minutes.
- **Webhook processing:** The webhook handler responds to Strava immediately (must reply within 2s), then processes the activity asynchronously.
- **Token refresh:** Strava access tokens expire every 6 hours. `lib/strava.mjs` handles refresh transparently before API calls.
