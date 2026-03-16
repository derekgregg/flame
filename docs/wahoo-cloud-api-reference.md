# Wahoo Cloud API — Comprehensive Reference

> Compiled March 2026 from official documentation and community sources.

---

## 1. Overview

The **Wahoo Cloud API** allows developers to connect Wahoo users to third-party mobile and web applications. It uses OAuth 2.0 for authorization and provides endpoints to manage:

- User profile data (height, weight, birth date, gender, email)
- Workout history (create, read, update, delete)
- Workout summaries (aggregated metrics per workout)
- FIT file uploads and downloads (the raw activity data format)
- Training plans (structured workout files)
- Routes (GPS course files)
- Power zones (FTP, critical power, zone thresholds)
- Webhooks for real-time workout upload notifications

**Base URL:** `https://api.wahooligan.com`

**API Reference (interactive docs):** https://cloud-api.wahooligan.com/

**Developer Portal:** https://developers.wahooligan.com/cloud

The API is oriented around Wahoo's hardware ecosystem (ELEMNT bike computers, KICKR trainers, TICKR heart rate monitors) but is not limited to Wahoo-recorded workouts — you can upload FIT files from any source.

**Key limitation:** Completed workouts from non-Wahoo third-party apps are NOT available via the API. If a user records on a third-party app and syncs to Wahoo, you cannot read the workout summary. The `fitness_app_id` field distinguishes sources: values < 1000 are Wahoo-originated, values > 1000 are third-party.

---

## 2. Authentication

### OAuth 2.0 Flow

Wahoo uses standard OAuth 2.0 Authorization Code flow.

**Endpoints:**
- Authorization: `https://api.wahooligan.com/oauth/authorize`
- Token exchange: `https://api.wahooligan.com/oauth/token`

**Standard flow:**
1. Redirect user to authorization endpoint with `client_id`, `redirect_uri`, `scope`, `response_type=code`
2. User grants permissions on Wahoo's consent screen
3. Wahoo redirects back with an authorization `code`
4. Exchange code for `access_token` and `refresh_token` via POST to token endpoint

**PKCE flow** is also supported for non-confidential applications (mobile/SPA):
- Code challenge methods: `plain` and `S256`
- Code verifier character set: `[A-Z]`, `[a-z]`, `[0-9]`, `.`, `-`, `~`, `_`

### Token Lifecycle

- **Access token expiration:** 2 hours
- **Refresh tokens:** Long-lived, but unrevoked tokens are automatically deleted after 60 days
- **Token limit:** Maximum 10 unrevoked access tokens per user (effective January 1, 2026)
- **Critical implementation note:** Refresh tokens immediately before making API calls. Token refresh alone does NOT revoke previous tokens — only a successful API call using the new token triggers revocation of old tokens.

### Scopes

| Scope | Description |
|-------|-------------|
| `email` | Access user's email address |
| `user_read` | Access user profile data. **Required** — API returns 403 without this scope |
| `user_write` | Update user profile fields |
| `workouts_read` | Read workout history and summaries |
| `workouts_write` | Create and modify workouts |
| `plans_read` | Access training plans |
| `plans_write` | Create and modify training plans |
| `power_zones_read` | Read power zone configurations |
| `power_zones_write` | Create and modify power zones |
| `routes_read` | Access routes |
| `routes_write` | Create and modify routes |
| `offline_data` | **Required for webhooks.** Receive webhook data when the app is closed |

### Deauthorization

`DELETE /v1/permissions` — Revokes app access. Optional cascading actions:
- Delete upcoming incomplete workouts
- Delete plans created/shared by the app

---

## 3. Key Endpoints

All endpoints require `Authorization: Bearer {access_token}` header and `Content-Type: application/json`.

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/user` | Retrieve authenticated user's profile |
| `PUT` | `/v1/user` | Update user (first name, last name, height, weight, birth date, gender, email) |

### Workouts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/workouts` | Create a workout |
| `GET` | `/v1/workouts/:id` | Retrieve a specific workout |
| `PUT` | `/v1/workouts/:id` | Update a workout |
| `GET` | `/v1/workouts` | List all workouts (paginated, default 30 per page) |
| `DELETE` | `/v1/workouts/:id` | Delete a workout |

**Workout fields:**
- `id`, `name`, `starts` (ISO 8601), `minutes`, `workout_token`
- `workout_type_id` (see taxonomy below)
- `plan_id` (single plan reference) or `plan_ids` (array of plan options)
- `route_id`
- `workout_summary` (nested object — the summary metrics)
- `created_at`, `updated_at`

**Daycode system:** Integer representing days since January 1, 2020. Example: September 12, 2024 = daycode 1716.

### Workout Summaries

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/workouts/:id/workout_summary` | Retrieve workout summary |
| `POST` | `/v1/workouts/:id/workout_summary` | Create/update summary (**DEPRECATED** — migrate to file uploads) |

**Summary fields (all decimal values returned as strings in JSON):**

| Field | Description |
|-------|-------------|
| `id` | Summary ID |
| `ascent_accum` | Total elevation gain |
| `cadence_avg` | Average cadence (RPM) |
| `calories_accum` | Total calories burned |
| `distance_accum` | Total distance |
| `duration_active_accum` | Active duration (excludes pauses) |
| `duration_paused_accum` | Total paused time |
| `duration_total_accum` | Total elapsed time |
| `heart_rate_avg` | Average heart rate (BPM) |
| `power_avg` | Average power (watts) |
| `power_bike_np_last` | Normalized Power |
| `power_bike_tss_last` | Training Stress Score (TSS) |
| `speed_avg` | Average speed |
| `work_accum` | Total work (kJ) |
| `time_zone` | Timezone of the workout |
| `manual` | Boolean — was this a manual entry? |
| `edited` | Boolean — was this summary edited? |
| `fitness_app_id` | Source app identifier |
| `file` | Object with `url` for FIT file download |
| `name`, `created_at`, `updated_at` | Metadata |

### Workout File Uploads

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/workout_file_uploads` | Upload a FIT file for async processing |
| `GET` | `/v1/workout_file_uploads/:token` | Check upload processing status |

**Upload status values:** `pending`, `in_progress`, `complete`, `error`, `duplicate`

Processing is asynchronous — typically completes within 5 seconds but can take up to several hours.

### Plans

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/plans` | Create plan (requires base64-encoded JSON file) |
| `GET` | `/v1/plans/:id` | Retrieve a plan |
| `PUT` | `/v1/plans/:id` | Update a plan |
| `GET` | `/v1/plans` | List plans (supports `external_id` query filter) |
| `GET` | `/v1/workouts/:workout_id/plans` | Get all plans for a specific workout |
| `DELETE` | `/v1/plans/:id` | Delete a plan |

**Plan fields:** `id`, `user_id`, `name`, `description`, `file` (object with URL), `filename`, `workout_type_family_id`, `workout_type_location_id`, `external_id`, `provider_updated_at`, `deleted`, `created_at`, `updated_at`

**Restrictions:**
- Apps can only access plans they created, unless granted the **Wahoo Plans entitlement** (request via partnerships@wahoofitness.com)
- Plan file retrieval window: 3 days before through 1 day after workout start time
- Wahoo plan files require an active Wahoo subscription

### Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/routes` | Create route (requires base64-encoded FIT file) |
| `GET` | `/v1/routes/:id` | Retrieve a route |
| `PUT` | `/v1/routes/:id` | Update a route |
| `GET` | `/v1/routes` | List routes (supports `external_id` query filter) |
| `DELETE` | `/v1/routes/:id` | Delete a route |

**Route fields:** `id`, `user_id`, `name`, `description`, `file` (object with URL), `filename`, `workout_type_family_id`, `external_id`, `provider_updated_at`, `start_lat`, `start_lng`, `distance`, `ascent`, `descent`, `deleted`, `created_at`, `updated_at`

**Note:** Cloud API routes sync to Wahoo App and ELEMNT computers, but NOT to the ELEMNT App.

### Power Zones

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/power_zones` | Create power zone |
| `GET` | `/v1/power_zones/:id` | Retrieve a power zone |
| `PUT` | `/v1/power_zones/:id` | Update a power zone |
| `GET` | `/v1/power_zones` | List power zones |
| `DELETE` | `/v1/power_zones/:id` | Delete a power zone |

**Power zone fields:**
- `zone_1` through `zone_7` — threshold values for each zone
- `zone_count` — typically 7 or 8
- `ftp` — Functional Threshold Power
- `critical_power`
- `workout_type_id`, `workout_type_family_id`, `workout_type_location_id`
- `originator_type` — 0 = user-defined
- `fitness_app_id`

---

## 4. Data Available

### Summary Data (via API JSON)

The workout summary endpoint returns **aggregated metrics only** — averages, totals, and maximums. You get:

- **Distance:** `distance_accum`
- **Duration:** `duration_active_accum`, `duration_paused_accum`, `duration_total_accum`
- **Elevation:** `ascent_accum`
- **Heart Rate:** `heart_rate_avg`
- **Power:** `power_avg`, `power_bike_np_last` (Normalized Power), `power_bike_tss_last` (TSS), `work_accum` (kJ)
- **Speed:** `speed_avg`
- **Cadence:** `cadence_avg`
- **Calories:** `calories_accum`

### Streaming / Per-Second Data (via FIT file download)

The API does **not** provide per-second or per-record streaming data through JSON endpoints. However, the workout summary includes a `file` object with a download URL for the **FIT file**. This FIT file is an "activity" type file and contains the full recording with per-second (or per-record) data:

- GPS coordinates (lat/lng per record)
- Heart rate samples
- Power samples
- Cadence samples
- Speed samples
- Elevation samples
- Temperature
- Device information

To access streaming data, you must:
1. `GET /v1/workouts/:id/workout_summary` to obtain the FIT file URL
2. Download the FIT file from the URL in the `file` field
3. Parse the FIT file using a FIT SDK (Garmin's official FIT SDK, or libraries like `fit-file-parser` for JS)

**FIT file downloads do NOT count against rate limits** and do NOT trigger token revocation.

### User Profile Data

- First name, last name
- Email (requires `email` scope)
- Height, weight
- Birth date, gender

### Data Type Note

All decimal values in workout summaries are returned as **strings** in JSON responses (not numbers). Your parser needs to handle this.

---

## 5. Webhooks

Wahoo supports webhooks for real-time notifications when workouts are uploaded.

### Setup

Webhooks are configured per-user via the API with three fields:

- `webhook_enabled` — Boolean, toggle on/off
- `webhook_url` — Your endpoint URL
- `webhook_token` — A security token you define for verification

### Requirements

- The user must have granted the `offline_data` scope
- The user must have a valid (non-expired) access token with that scope
- Your endpoint must respond with HTTP 200

### Delivery

- **Method:** HTTP POST
- **Content-Type:** `application/json`
- **Payload:** Contains `event_type`, `webhook_token` (for verification), `user` object, and nested `workout_summary` and `workout` objects

### Retry Schedule

If Wahoo does not receive an HTTP 200 response:
1. Retry after **30 minutes**
2. Retry after **4 hours**
3. Retry after **24 hours**
4. Final retry after **72 hours**

### Comparison to Strava

Unlike Strava's subscription-based webhook model (where you register a single callback URL for your app and receive events for all athletes), Wahoo's webhooks are **per-user**: you configure the webhook URL and token for each individual user via API calls. There is no global app-level webhook subscription.

---

## 6. Rate Limits

Rate limit information is included in every HTTP response via headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests remaining in the window |
| `X-RateLimit-Reset` | Timestamp when the window resets |

### Limits by Environment

| Time Window | Sandbox | Production |
|-------------|---------|------------|
| 5 minutes | 25 requests | 200 requests |
| 1 hour | 100 requests | 1,000 requests |
| 1 day | 250 requests | 5,000 requests |

### Exempt from Rate Limits

- Authentication requests (OAuth token exchange)
- Token refresh requests
- FIT file downloads

### Exceeding Limits

Returns HTTP `429 Too Many Requests`. The `X-RateLimit-Reset` header tells you when to retry.

### Practical Notes (from community)

The Intervals.icu developer reported hitting 429 errors when syncing many users and had to slow down API calls and request higher production limits from Wahoo. Sandbox limits are extremely restrictive and only suitable for initial development/testing.

---

## 7. Workout Type Taxonomy

### Workout Type IDs (selected)

| ID | Type |
|----|------|
| 0 | Biking |
| 1 | Running |
| 5 | Running (variant) |
| 11-17 | Biking variants (MTB, gravel, etc.) |
| 25-26 | Swimming |
| 27-30 | Snow sports |
| 35-41 | Water sports |
| 42-44 | Fitness/gym |
| 49, 61, 64, 68, 70 | Biking variants |
| 62-63, 65, 66, 69 | Specialty activities |
| 67, 71 | Running variants |

### Location IDs

| ID | Location |
|----|----------|
| 0 | Indoor |
| 1 | Outdoor |
| 255 | Unknown |

### Family IDs

| ID | Family |
|----|--------|
| 0 | Biking |
| 1 | Running |
| 2 | Swimming |
| 3 | Water Sports |
| 4 | Snow Sports |
| 5 | Skating |
| 6 | Gym |
| 9 | Walking |
| 30 | N/A |
| 31 | Other |
| 255 | Unknown |

---

## 8. Terms of Service / API Agreement

Full agreement: https://www.wahoofitness.com/wahoo-api-agreement

### Key Restrictions

**Data usage:**
- You may NOT collect, use, store, aggregate, or transfer Wahoo Data except as expressly permitted
- You may NOT disclose, market, sell, license, or lease Wahoo Data to any third party, including advertisers or data brokers
- You are responsible for complying with all applicable privacy and data protection laws

**Branding requirements:**
- You MUST attribute use of Wahoo API using the links and logos Wahoo provides, in the format specified in their Media Kit
- You must NOT use Wahoo Marks (name, logo) as part of your app name, icon, or branding
- You must NOT use Wahoo Data or Marks in advertisements without express written consent
- You must NOT issue press releases referencing Wahoo without prior written consent
- Wahoo has sole discretion to determine brand guideline compliance and can revoke your license at any time

**API token management:**
- Your API token is confidential — do not share or transfer it
- You are solely responsible for token security

**Monitoring:**
- Wahoo may monitor your API usage to improve the API or ensure compliance

**Support:**
- Wahoo has NO obligation to provide technical support
- You are responsible for all customer and technical support for your application

### Comparison to Strava

| Aspect | Wahoo | Strava |
|--------|-------|--------|
| Data retention limit | Not explicitly specified in API agreement | 7-day cache maximum |
| Branding | Must use Wahoo-provided logos/links per Media Kit | Must display "Powered by Strava" logo, "View on Strava" links in #FC5200 |
| App naming | Cannot use Wahoo marks in app name | Cannot use "Strava" in app name |
| Data selling | Explicitly prohibited | Explicitly prohibited |
| AI/ML training | Not explicitly mentioned | Explicitly prohibited |
| Webhook model | Per-user configuration | App-level subscription |
| Community app exception | Not applicable / not mentioned | Allows shared data for <10K users |
| Deauthorization cleanup | Optional cascading deletes | Must delete all user data |

---

## 9. Developer Registration

### Process

1. **Visit:** https://developers.wahooligan.com/
2. **Register:** Create a developer account at https://developers.wahooligan.com/applications/new
3. **Submit application:** Provide information about your app's purpose and the scopes you need
4. **Wait for approval:** Your application will appear as "pending approval" in the Developer Portal. Wahoo manually reviews all requests.
5. **Receive credentials:** Once approved, you get a `client_id` and `client_secret`

### Approval Process

Wahoo is **currently limiting API access** to approved developers only. This is not a self-service instant-access system like some APIs. You must:
- Describe your application's purpose
- Specify which scopes you need and why
- Wait for Wahoo's review team to approve

### Sandbox vs. Production

- **Sandbox:** Automatically available after registration approval. Very limited rate limits (25/5min, 100/hour, 250/day). Suitable only for development and testing.
- **Production:** Requires going through Wahoo Fitness review. Grants higher rate limits (200/5min, 1000/hour, 5000/day).

### Special Entitlements

- **Wahoo Plans access:** By default, apps can only access plans they created. To access Wahoo's own plans, email partnerships@wahoofitness.com to request the Wahoo Plans entitlement.

### Support Channels

- **API support:** https://wahooapi.zendesk.com/hc/en-us/requests/new
- **Partnerships:** partnerships@wahoofitness.com

---

## 10. HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request |
| 401 | Unauthorized (invalid/expired token) |
| 403 | Forbidden (missing required scope, likely `user_read`) |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 406 | Not Acceptable |
| 410 | Gone (resource deleted) |
| 422 | Unprocessable Entity (validation error) |
| 429 | Rate Limited |
| 500 | Server Error |
| 503 | Service Unavailable |

---

## 11. Datetime and Data Format Notes

- **Datetime format:** ISO 8601 — e.g., `"2023-01-01T12:00:00.000Z"`
- **Decimal values:** Returned as **strings** in JSON, not numbers
- **Pagination:** Default 30 items per page for list endpoints
- **File format:** FIT (Flexible and Interoperable Data Transfer) — Garmin's binary protocol used across the cycling/fitness industry

---

## Sources

- [Wahoo Cloud API Documentation](https://cloud-api.wahooligan.com/)
- [Wahoo Developer Portal](https://developers.wahooligan.com/cloud)
- [Wahoo Developer Home](https://developers.wahooligan.com/)
- [Wahoo API Agreement](https://www.wahoofitness.com/wahoo-api-agreement)
- [Wahoo API Agreement (EU)](https://eu.wahoofitness.com/wahoo-api-agreement)
- [go-wahoo-cloud-api (GitHub)](https://github.com/james-millner/go-wahoo-cloud-api)
- [kotlin-wahoo-cloud-api (GitHub)](https://github.com/james-millner/kotlin-wahoo-cloud-api)
- [Wahoo integration via Terra API](https://tryterra.co/integrations/wahoo)
- [django-allauth Wahoo provider](https://docs.allauth.org/en/dev/socialaccount/providers/wahoo.html)
- [Intervals.icu Forum — Wahoo API Throttling](https://forum.intervals.icu/t/wahoo-error-api-throttling-users/82420)
- [Wahoo App Partners Support](https://support.wahoofitness.com/hc/en-us/articles/23022859474962-Wahoo-App-Partners)
