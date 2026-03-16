# Garmin API Reference — Comprehensive Developer Guide

*Researched March 2026. Based on official Garmin developer documentation, the Health REST API Specification v2.9.6, the Garmin Connect Developer Program Agreement (FRM-0952 Rev. B), and the API Brand Guidelines v6.30.2025.*

---

## 1. Overview — What APIs Does Garmin Offer?

Garmin has two completely separate developer ecosystems:

### Garmin Connect Developer Program (the one we care about)

This is the server-side REST API program for accessing user health/fitness data. It contains **five APIs**, all under one program umbrella:

| API | Purpose | Direction |
|-----|---------|-----------|
| **Health API** | All-day wellness metrics (steps, HR, sleep, stress, body battery, SpO2, body composition, respiration) | Garmin -> You |
| **Activity API** | Detailed activity/workout data including FIT/GPX/TCX file downloads | Garmin -> You |
| **Women's Health API** | Menstrual cycle tracking & pregnancy tracking data | Garmin -> You |
| **Training API** | Push structured workouts and training plans to users' devices | You -> Garmin |
| **Courses API** | Push GPS courses/routes to users' devices | You -> Garmin |

You can use any or all APIs in a single application. All use OAuth 2.0 (migrating from OAuth 1.0a, which retires 12/31/2026).

### Garmin Connect IQ

This is a completely separate program for building watch apps, watch faces, data fields, and widgets that run ON Garmin devices. Not relevant for our use case. No interdependency with the Connect Developer Program.

### Garmin Health SDK

A mobile SDK (Android/iOS) for reading Garmin data directly from the device via Bluetooth, bypassing Garmin Connect cloud. Targeted at clinical/research applications. Not relevant for a web app.

### Which APIs Are Relevant for Us?

For getting detailed ride data with power: **Activity API** is the primary one. It provides:
- Activity summary data (JSON) with key metrics
- Full FIT/GPX/TCX file downloads with per-second granularity
- Activity Details endpoint (premium) with per-second samples including `powerInWatts`

The **Health API** supplements with daily summaries, heart rate trends, body composition, stress, and VO2 max.

---

## 2. Authentication

### Current State: OAuth 1.0a -> OAuth 2.0 Migration

Garmin is transitioning from OAuth 1.0a to OAuth 2.0 with PKCE. **OAuth 1.0a will be retired on 12/31/2026.** New integrations should use OAuth 2.0.

### OAuth 2.0 PKCE Flow

**Endpoints:**

| Purpose | URL |
|---------|-----|
| Authorization | `https://apis.garmin.com/tools/oauth2/authorizeUser` |
| Token Exchange | `https://diauth.garmin.com/di-oauth2-service/oauth/token` |
| User Permissions | `https://apis.garmin.com/wellness-api/rest/user/permissions` |
| User Registration | `https://apis.garmin.com/wellness-api/rest/user/registration` |
| OAuth Confirmation | `https://connect.garmin.com/oauth2Confirm` |

**Flow:**
1. Generate a cryptographically random `code_verifier`
2. Create `code_challenge` from verifier using S256 (SHA256)
3. Redirect user to authorization endpoint with `code_challenge` and `code_challenge_method=S256`
4. User logs into Garmin Connect and grants permissions
5. Garmin redirects back with an authorization code
6. Exchange authorization code + `code_verifier` for access token and refresh token
7. Use access token in `Authorization: Bearer {access_token}` header

**Token response includes:** `access_token`, `token_type`, `expires_in`, `refresh_token`, `refresh_token_expires_in`

**Token refresh:** When access tokens expire, use the refresh token to get a new access token.

### Legacy OAuth 1.0a Flow (being retired)

Three-step process:
1. **Request Token:** `POST https://connectapi.garmin.com/oauth-service/oauth/request_token`
2. **User Authorization:** `GET https://connect.garmin.com/oauthConfirm` with `oauth_token` and `oauth_callback`
3. **Access Token Exchange:** Exchange authorized request token + verifier for user access token

Request signing uses HMAC-SHA1. Parameters must be sorted alphabetically. Signing key = `ConsumerSecret&RequestTokenSecret`.

### Key Migration Note

After migration to OAuth 2.0, the User Access Token is NO LONGER the primary user identifier. You must use User ID instead. Retrieve User IDs for all existing users BEFORE migrating.

### Credentials

- **Consumer Key / Consumer Secret**: Issued via Developer Portal per application
- **Evaluation Key**: First key generated is rate-limited, for testing only
- **Production Key**: Obtained after passing Partner Verification Tool; not rate-limited

---

## 3. Key Endpoints

All endpoints are under `https://healthapi.garmin.com/wellness-api/rest/`

### Daily Summaries
**`GET /dailies`**

Query params (both required together):
- `uploadStartTimeInSeconds` — Unix timestamp
- `uploadEndTimeInSeconds` — Unix timestamp
- **Max query range: 24 hours** (by upload time, not data time)

**Fields returned:**
- `summaryId`, `calendarDate`, `startTimeInSeconds`, `startTimeOffsetInSeconds`
- `steps`, `distanceInMeters`, `durationInSeconds`
- `activeTimeInSeconds`, `activeKilocalories`, `bmrKilocalories`
- `moderateIntensityDurationInSeconds`, `vigorousIntensityDurationInSeconds`
- `floorsClimbed`
- `minHeartRateInBeatsPerMinute`, `averageHeartRateInBeatsPerMinute`, `maxHeartRateInBeatsPerMinute`, `restingHeartRateInBeatsPerMinute`
- `timeOffsetHeartRateSamples` — **map of timestamp offsets to HR values** (granular HR throughout the day)
- `averageStressLevel`, `maxStressLevel`, `stressDurationInSeconds`
- `restStressDurationInSeconds`, `activityStressDurationInSeconds`
- `lowStressDurationInSeconds`, `mediumStressDurationInSeconds`, `highStressDurationInSeconds`
- `stressQualifier`
- `stepsGoal`, `netKilocaloriesGoal`, `intensityDurationGoalInSeconds`, `floorsClimbedGoal`
- `consumedCalories` (from MyFitnessPal integration)

### Activity Summaries
**`GET /activities`**

**Fields returned:**
- `summaryId`, `startTimeInSeconds`, `startTimeOffsetInSeconds`
- `activityType` — text string (see Activity Types appendix)
- `durationInSeconds`
- `averageBikeCadenceInRoundsPerMinute`, `maxBikeCadenceInRoundsPerMinute`
- `averageRunCadenceInStepsPerMinute`, `maxRunCadenceInStepsPerMinute`
- `averageSwimCadenceInStrokesPerMinute`
- `averageHeartRateInBeatsPerMinute`, `maxHeartRateInBeatsPerMinute`
- `averageSpeedInMetersPerSecond`, `maxSpeedInMetersPerSecond`
- `averagePaceInMinutesPerKilometer`, `maxPaceInMinutesPerKilometer`
- `activeKilocalories`
- `deviceName`
- `distanceInMeters`
- `startingLatitudeInDegree`, `startingLongitudeInDegree`
- `steps`
- `totalElevationGainInMeters`, `totalElevationLossInMeters`
- `numberOfActiveLengths` (swimming)
- `isParent` (boolean), `parentSummaryId` (for multi-sport)
- `manual` (boolean, only for manually created entries)

**NOTE:** Activity summaries do NOT include power data. Power is only in Activity Details or FIT files.

### Activity Details (PREMIUM — requires special access request)
**`GET /activityDetails`**

This is the gold mine. Returns the same summary fields as above PLUS per-second sample data:

**Sample fields (recorded at up to 1-second intervals):**
- `startTimeInSeconds`
- `latitudeInDegree`, `longitudeInDegree` — GPS track
- `elevationInMeters`
- `airTemperatureCelsius`
- `heartRate` — per-second HR
- `speedMetersPerSecond`
- `stepsPerMinute` — running cadence
- `totalDistanceInMeters`
- `timerDurationInSeconds`, `clockDurationInSeconds`, `movingDurationInSeconds`
- **`powerInWatts`** — per-second cycling power
- `bikeCadenceInRPM`
- `swimCadenceInStrokesPerMinute`

**CRITICAL:** Activity Details is a premium data type. You must specifically request access from Garmin support (`connect-support@developer.garmin.com`). It is not included by default.

### Activity Files (added in v2.9.3)
**`GET /activityFiles`**

Returns raw FIT, GPX, and TCX files for activities. These contain the full granular data recorded by the device, including all per-second power, HR, cadence, GPS, elevation, temperature, etc.

### Manually Updated Activities
**`GET /manuallyUpdatedActivities`**

Activities edited or created manually by users on Garmin Connect. Identified by `manual: true`.

### Epoch Summaries
**`GET /epochs`**

15-minute interval breakdowns of daily wellness metrics (steps, distance, active time, calories, HR, stress).

### Sleep Summaries
**`GET /sleep`**

Sleep duration, classification (light, deep, REM, awake), sleep respiration data (v2.9.6+).

### Body Composition
**`GET /bodyComposition`**

Weight, BMI, muscle mass, body fat percentage.

### Stress Details
**`GET /stressDetails`**

3-minute interval stress scores (1-100 scale). Also includes Body Battery data (v2.8+).

**Stress categories:** rest (1-25), low (26-50), medium (51-75), high (76-100)

### User Metrics
**`GET /userMetrics`**

Fitness age, VO2 max, and other algorithmically calculated per-user metrics.

### Move IQ
**`GET /moveIq`**

Auto-detected activity events based on movement patterns. Note: Wellness data from Move IQ events is already included in Daily and Epoch summaries.

### Pulse Ox
**`GET /pulseOx`**

SpO2 measurements, including on-demand and Acclimation feature data. Also appears in Sleep summaries (v2.8+).

### Respiration
**`GET /respiration`**

Breathing rate data. Added in v2.9.6.

### Menstrual Cycle Tracking
**`GET /menstrualCycleTracking`**

Added in v2.9.5.

### Third-Party Dailies
**`GET /thirdPartyDailies`**

Data from non-Garmin devices (e.g., Fitbit) synced to Garmin Connect. Additional field: `source`. Only the most recent third-party record is retained; Garmin data takes precedence.

### User Endpoints
- **Get User ID:** `GET /user/id`
- **Delete Access Token / Deregister:** Available for user removal

---

## 4. Data Available — Detailed Breakdown

### Summary-Level Data (JSON, available by default)

| Data Type | Available In | Granularity |
|-----------|-------------|-------------|
| Heart Rate (avg/min/max/resting) | Dailies, Activities | Per-activity or daily summary |
| Heart Rate Samples | Dailies (`timeOffsetHeartRateSamples`) | Per-second throughout day |
| Steps | Dailies, Epochs, Activities | Daily, 15-min, per-activity |
| Distance | Dailies, Activities | Daily, per-activity |
| Calories (active + BMR) | Dailies, Activities | Daily, per-activity |
| Elevation gain/loss | Activities | Per-activity |
| Speed/Pace (avg/max) | Activities | Per-activity |
| Bike Cadence (avg/max) | Activities | Per-activity |
| Run Cadence (avg/max) | Activities | Per-activity |
| Swim Cadence | Activities | Per-activity |
| GPS start point | Activities | Lat/long of start |
| Sleep (light/deep/REM/awake) | Sleep | Per-sleep session |
| Stress | Dailies, Stress Details | Daily avg or 3-min intervals |
| Body Battery | Stress Details | 3-min intervals |
| SpO2 | Pulse Ox, Sleep | On-demand or sleep |
| Body Composition | Body Composition | Per-weigh-in |
| VO2 Max / Fitness Age | User Metrics | Algorithmically calculated |
| Respiration | Respiration, Sleep | Per-session |
| Device Name | Activities | Per-activity |

### Per-Second Detailed Data (requires premium access or FIT files)

| Data Type | Source | Notes |
|-----------|--------|-------|
| **Power (watts)** | Activity Details, FIT files | Per-second; requires power meter on device |
| Heart Rate | Activity Details, FIT files | Per-second |
| GPS Track | Activity Details, FIT files | Per-second lat/long |
| Elevation | Activity Details, FIT files | Per-second |
| Speed | Activity Details, FIT files | Per-second |
| Cadence (bike/run/swim) | Activity Details, FIT files | Per-second |
| Temperature | Activity Details, FIT files | Per-second |
| Distance (cumulative) | Activity Details, FIT files | Per-second |

### FIT File Access

FIT (Flexible and Interoperable Data Transfer) is Garmin's proprietary binary format. It contains ALL data the device recorded. Available via the Activity API (`/activityFiles`). Also available in GPX and TCX formats.

FIT files contain the most granular data possible — everything the device sensors captured at their native recording rates. You need the FIT SDK to parse them.

### What You CANNOT Get

- **No live/real-time streaming** — data is only available after device sync to Garmin Connect
- **No segment data** (Strava-style segments are a Strava concept)
- **No social data** (kudos, comments — those are Strava features)
- **No route/segment leaderboards**
- Power data is only present if the user has a power meter paired to their Garmin device

---

## 5. Webhooks / Push Notifications

Garmin supports TWO notification architectures. You choose one during setup.

### Option A: Ping/Pull Architecture

1. Garmin sends an HTTPS POST to your callback URL containing a **callback URL** (not the data itself)
2. You respond with HTTP 200 within 30 seconds
3. You then call the callback URL to retrieve the actual summary data
4. Summary data endpoints should ONLY be called as a result of Ping notifications, using the exact callback URL provided

### Option B: Push Architecture

1. Garmin sends an HTTPS POST to your callback URL containing the **full summary data directly in the POST body** as JSON
2. You respond with HTTP 200 in a timely manner
3. No secondary API call needed — the data is right there in the request body
4. Data format is identical to what the Ping callback would have returned

### Shared Behavior

- Both use HTTPS POST
- Both implement **exponential backoff** for failed deliveries
- Both have an **"On Hold" feature** — if your endpoint is down, Garmin queues notifications for up to 7 days
- You can subscribe to only the data types you need (don't have to receive everything)
- Data is typically pushed **within minutes** of the user syncing their device
- A final **User Deregistration notification** is sent when a user removes consent

### Notification Types Available

Notifications are available for: Health summaries, Activity summaries, Activity Details, Activity Files, Women's Health data, and User Deregistration events.

### Backfill

Developer web tools include a **Backfill** feature for requesting historical data for users who authorized before your integration was complete.

---

## 6. Rate Limits

Garmin is deliberately vague about specific rate limit numbers in their public documentation. Here is what is documented:

### Evaluation Keys
- Your first consumer key from the Developer Portal is **rate-limited** and should only be used for testing, evaluation, and development
- Specific numbers are not publicly documented

### Production Keys
- Obtained after passing the **Partner Verification Tool**
- Described as "not rate-limited" in Garmin's FAQ, though the developer agreement reserves the right to impose limits
- Section 10.2 of the agreement: "Garmin reserves the right to charge fees for request volume that exceeds any limits set forth in the Application Requirements"
- Section 5.2(f): You must not "use the API in a manner that exceeds reasonable request volume, constitutes excessive or abusive usage"

### Query Constraints
- **Maximum query range: 24 hours** per request (by upload time)
- You query by upload timestamp (when the device synced), not by the activity/summary timestamp
- This is designed around the push/ping model — you fetch data in response to notifications, not by polling

### Practical Guidance
- The push/ping architecture means you rarely need to poll the API at all
- Fetch data when notified, don't build polling loops
- The 24-hour query window is the main practical constraint

### Comparison to Strava
Strava has hard documented limits: 200 requests/15 min, 2,000/day, 100 read/15 min, 1,000 read/day. Garmin's approach is less rigid — they rely on the push model to minimize API calls and handle rate limiting at the evaluation/production key tier level.

---

## 7. Terms of Service / API Agreement

Based on the Garmin Connect Developer Program Agreement (FRM-0952 Rev. B, 14 pages).

### Data Retention

- The API specification states: **"Data persists for seven days post-upload"** on Garmin's servers. Partners should fetch data upon notification receipt rather than relying on the API as permanent storage.
- After 7 days, data may no longer be retrievable from Garmin's API endpoints (forum reports suggest ~18 days in practice, but 7 days is the documented guarantee)
- The agreement's Annex A states data retention period: "For duration of the End User maintaining an account with data importer or until End User exercises rights to delete Personal Data, whichever comes first" — meaning YOUR retention of data you've already fetched is governed by your relationship with the user, not a hard cache limit

### Key Difference from Strava

**Strava mandates a 7-day maximum cache** — you MUST delete data after 7 days regardless. Garmin's agreement does NOT impose a similar hard cache expiration. Once you've fetched the data, you can retain it as long as the user maintains an account with you. This is a MAJOR difference.

### Data Deletion Requirements

- When a user **deauthorizes** (calls deregistration endpoint or revokes consent), you receive a User Deregistration notification. All notifications for that user stop, and API requests with their token are rejected.
- If your app provides a "Delete My Account" or "Opt-Out" mechanism, you MUST call Garmin's deregistration endpoint
- You must comply with Applicable Data Protection Laws (GDPR, etc.) for deletion requests

### Prohibited Uses (Section 5.2)

- No selling, leasing, or sublicensing the API or License Key
- No deriving commercial income without Garmin's prior written permission
- No excessive or abusive API usage
- No misleading users about API capabilities
- No reverse engineering, decompiling, or disassembling
- No scraping, spidering, or automated retrieval beyond API
- No spyware, adware, or malicious software
- No copying or creating derivative works of the API itself
- No using the API to compete with Garmin
- No using data for credit reporting, insurance, or employment decisions (FCRA compliance)
- No life-critical applications
- Cannot use API to build a competing developer API interface for third parties without written approval

### AI / ML Usage

The agreement does NOT contain an explicit blanket prohibition on using data for AI/ML training (unlike Strava which explicitly prohibits model training). However:
- Section 5.2(q): You cannot "combine or integrate the API with any software, technology, services, or materials, unless authorized (i) herein or (ii) by Garmin in writing"
- The API Brand Guidelines require attribution when data is used as "input to analytics, algorithms, machine learning models, artificial intelligence or combined, aggregated or blended with other sources"
- Using data for inference (generating roasts from activity stats, as we do) should be fine with proper attribution
- Using data to train/fine-tune models is a gray area — not explicitly prohibited but the "combine or integrate" clause could be interpreted broadly

### Fees

- Section 10.1: **No license fees** are due under the agreement
- Garmin reserves the right to charge fees in the future with 30 days' notice
- Garmin can charge for request volume exceeding Application Requirements limits
- Some premium data types (Enhanced Beat-to-Beat Interval) require license fees or minimum device orders for commercial use

### Termination

- Garmin can terminate with **30 days' written notice** for any reason (Section 9.2)
- Immediate automatic termination if you violate any terms (Section 9.4)
- Upon termination: cease all API use, destroy all copies of API and Garmin Brand Features
- No press releases about Garmin without prior written approval (Section 8.4)

### Confidentiality

- The API, License Key, Deliverables, and related documentation are Garmin Confidential Information
- You cannot disclose these to anyone outside your employees/contractors with need-to-know

### Liability

- API is provided "AS IS" with no warranties
- Garmin's total aggregate liability: **$1.00** (yes, one dollar)
- You must indemnify Garmin for any breaches

### Governing Law

- New York State law (for US entities)
- International arbitration via ICC for non-US entities

### Data Protection (Section 15)

- Garmin is an independent "controller", NOT a "processor" under GDPR
- You must provide conspicuous privacy notice to users before collecting data
- You must not sell End User Personal Data without lawful consent
- You must respond to data subject rights requests (access, rectify, erase, restrict, port, object)
- EU Standard Contractual Clauses (module one, controller-to-controller) are incorporated for cross-border transfers

---

## 8. Branding Requirements

Based on the API Brand Guidelines (v6.30.2025).

### Core Requirement: Attribution

Every display of Garmin device-sourced data must include **"Garmin [device model]"** attribution. If the device model is unknown via the API, just use **"Garmin"** as the data source.

### Title-Level / Primary Displays (dashboards, activity feeds, overview cards)

- Position attribution directly beneath or adjacent to the primary title/heading
- Must be **above the fold**
- Must be visually associated with the data it supports
- **Never** bury attribution in tooltips, footnotes, or expandable containers
- Can use the Garmin tag logo + device model, OR appropriately sized text

### Secondary Screens (detailed views, reports, settings, historical views)

- Attribution in all expanded views or subscreens
- For multi-entry displays: apply globally (e.g., in header) or per entry
- Screenshots, printouts, and reports must retain visible attribution

### Downstream / Exported Data (CSVs, PDFs, APIs, webhooks)

- Attribution must be adjacent to data and **repeated on each page** in exports
- In API/webhook transfers, receiving systems must preserve attribution (enforce via partner sublicense)
- In social media sharing or embedded experiences, attribution must always remain visible

### Combined / Derived Data (analytics, algorithms, ML, AI, blended sources)

- Must list Garmin as a distinct or contributing data source
- Must NOT imply Garmin endorsement of data from other devices

### Visual / Social Media

- Attribution must be visible in **every image**
- Can use Garmin tag logo + device model, or appropriately sized text

### Logo Rules

- Do NOT alter or animate the Garmin tag logo
- Do NOT use the Garmin tag logo in avatars, badges, or unrelated imagery
- Do NOT use the logo where Garmin device-sourced data is not present
- Do NOT squeeze, stretch, invert, or discolor the logo
- Follow the Consumer Brand Style Guide for logo file usage

### App Authentication Displays

- When showing connection to Garmin, use the **full app name and tile**
- Do NOT abbreviate, truncate, or stylize the Garmin app name

### Acceptable Messaging Examples

- "This chart was created using data provided by Garmin devices."
- "Insights derived in part from Garmin device-sourced data."
- "Model incorporates Garmin [device model] data."

### NOT Acceptable

- "Garmin speed model" (implies Garmin created/endorses the model)

### Enforcement

"Garmin reserves the right to review applications for attribution compliance. Noncompliance may result in suspension or termination of API access."

### Comparison to Strava Branding

| Requirement | Strava | Garmin |
|-------------|--------|--------|
| Attribution | "Powered by Strava" logo | "Garmin [device model]" text or logo |
| Link to source | Required "View on Strava" link in orange (#FC5200) | Not required |
| Name restriction | Cannot use "Strava" in app name | Cannot imply Garmin endorsement |
| Logo modification | Prohibited | Prohibited |
| Per-activity attribution | On every activity card | On every data display |
| Derived data attribution | Not explicitly required | Required even for ML/AI outputs |

Garmin's branding requirements are MORE granular than Strava's (attribution even on exported CSVs, social media images, derived analytics) but do NOT require linking back to Garmin Connect the way Strava requires "View on Strava" links.

---

## 9. Developer Registration & Access

### How to Apply

1. Go to [Garmin Connect Developer Program Access Request Form](https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/)
2. Submit your application describing: your app, its purpose, your company background
3. Garmin confirms status within **2 business days**
4. Upon approval, you get immediate access to the Developer Portal

### Requirements

- **Business use only** — the program is explicitly for businesses, not individual hobbyists
- Must be a corporation, governmental organization, or other legal entity (or an individual of legal age authorized to bind one)
- Garmin reserves the right to approve or decline in its sole discretion

### Cost

- **Free.** No licensing or maintenance fees
- Some premium metrics require license fees or minimum device order quantities for commercial use (e.g., Enhanced Beat-to-Beat Interval)
- Garmin reserves the right to charge fees in the future (30 days' notice)

### Integration Timeline

- Application review: ~2 business days
- Integration call to clarify technical requirements: scheduled after approval
- Typical integration: **1-4 weeks**

### Evaluation -> Production

1. After approval, you receive an **evaluation-level** consumer key (rate-limited)
2. Build and test your integration in the evaluation environment
3. Developer web tools available: Data Viewer, Backfill, Summary Resender, Data Generator, Request Signing demo
4. Use the **Partner Verification Tool** to validate your integration
5. Requirements for production verification:
   - Demonstrate real-time capability (responding to push/ping)
   - Summary endpoints called only upon Ping notification receipt
   - Push notifications responded to with HTTP 200 status in timely manner
   - Data queried from **2+ different Garmin Connect accounts** with recent device uploads
6. After verification: receive production-level key (not rate-limited)

### Contact

- Support: `connect-support@developer.garmin.com`
- Security issues: `security@garmin.com`
- EU Data Protection: `euprivacy@garmin.com`
- Developer contact form: https://www.garmin.com/en-US/forms/developercontactus/

---

## 10. Health API vs Activity API — Which Do We Need?

### Health API

**Purpose:** All-day wellness metrics for corporate wellness, population health, patient monitoring.

**Data format:** JSON summaries

**Best for:** Steps, daily HR trends, sleep, stress, body battery, SpO2, body composition, respiration, VO2 max

**Activity data:** Only basic daily summaries. Not per-activity breakdowns.

**Power data:** NOT available in Health API summaries.

### Activity API

**Purpose:** Detailed fitness activity data for fitness/training platforms.

**Data format:** JSON summaries + FIT/GPX/TCX file downloads

**Best for:** Per-activity metrics, detailed ride/run/swim data, GPS tracks, per-second samples

**Power data:** YES.
- Activity summaries: No power fields (cadence, HR, speed, distance, elevation only)
- Activity Details (premium): `powerInWatts` at up to 1-second intervals
- FIT files: Full power data at native recording rate

### For Our Use Case (Flame — AI roasts on group activities with power data)

**We need the Activity API**, specifically:

1. **Activity summaries** via push/ping webhooks for real-time notification of new activities
2. **Activity Details** (premium access request required) for per-second power, HR, cadence, GPS
3. OR **Activity Files** (FIT download) for the same granular data, parsed client-side

The Health API would be a nice supplement for:
- Body composition data (weight for W/kg calculations)
- VO2 max / fitness age (for roast material)
- Resting HR and stress (more roast material)

### Key Architectural Differences from Strava

| Aspect | Strava | Garmin |
|--------|--------|--------|
| Auth | OAuth 2.0 | OAuth 2.0 PKCE (migrating from 1.0a) |
| Webhooks | Subscription-based, event types | Ping/Pull or Push architecture |
| Activity notification | Webhook event -> fetch activity | Push (data in notification) or Ping (callback URL) |
| Response time requirement | 2 seconds | 30 seconds (Ping) |
| Detailed data | Streams API (per-second) | Activity Details (premium) or FIT files |
| Power data | In activity streams | In Activity Details or FIT files |
| Data retention on their servers | Indefinite | 7 days post-upload |
| Your cache limit | 7-day maximum | No hard cache limit (retain while user has account) |
| File downloads | Not available | FIT, GPX, TCX |
| AI/ML restriction | Explicit prohibition on training | Attribution required; no explicit training ban |
| Rate limits | Hard documented limits | Evaluation (limited) vs Production (unlimited) |
| Access | Self-service OAuth app creation | Business application + approval process |
| Cost | Free | Free (some premium data costs extra) |

---

## Appendix: Data Types & Units

| Measurement | Unit | Type |
|-------------|------|------|
| Timestamps | Unix seconds (since Jan 1, 1970 UTC) | integer |
| Time offset | Seconds from UTC (device display time) | integer |
| Duration | Seconds | integer |
| Distance | Meters | float |
| Heart Rate | Beats per minute | integer |
| Stress | 1-100 scale | integer |
| Calories | Kilocalories | integer |
| Cadence | Rounds/strokes per minute | float |
| Pace | Minutes per kilometer | float |
| Speed | Meters per second | float |
| Elevation | Meters | float |
| Coordinates | Decimal degrees | float |
| Power | Watts | integer |
| Temperature | Celsius | float |

## Appendix: API Version History

| Version | Key Changes |
|---------|-------------|
| v2.6 | Enhanced Sleep validation |
| v2.7 | Pulse Ox summary type |
| v2.8 | Body Battery in Stress summaries, Pulse Ox in Sleep summaries |
| v2.9 | Pulse Ox modifications, on-demand SpO2 |
| v2.9.3 | **Activity Files data type** (FIT/GPX/TCX downloads) |
| v2.9.5 | Menstrual Cycle Tracking |
| v2.9.6 | REM sleep userId in notifications, Respiration Summaries, sleep respiration property |

---

## Sources

- [Garmin Connect Developer Program Overview](https://developer.garmin.com/gc-developer-program/)
- [Health API](https://developer.garmin.com/gc-developer-program/health-api/)
- [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Training API](https://developer.garmin.com/gc-developer-program/training-api/)
- [Women's Health API](https://developer.garmin.com/gc-developer-program/womens-health-api/)
- [Courses API](https://developer.garmin.com/gc-developer-program/courses-api/)
- [Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [Health REST API Specification v2.9.6](https://pdfcoffee.com/healthrestapispecification296worldwide-pdf-free.html)
- [API Brand Guidelines](https://developer.garmin.com/brand-guidelines/api-brand-guidelines/)
- [API Brand Guidelines PDF (v6.30.2025)](https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf)
- [Garmin Connect Developer Program Agreement](https://developerportal.garmin.com/sites/default/files/Garmin%20Connect%20Developer%20Program%20Agreement.pdf)
- [OAuth2 PKCE Specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf)
- [Developer Program Access Request Form](https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/)
- [Garmin Developer Portal](https://developerportal.garmin.com/developer-programs/connect-developer-api)
- [Data Retention Forum Discussion](https://forums.garmin.com/developer/connect-iq/f/showcase/409293/data-retention-period-for-wellness-api)
- [OAuth 1 to OAuth 2 Migration Discussion](https://github.com/stoufa06/php-garmin-connect-api/issues/23)
- [FIT SDK](https://developer.garmin.com/fit/)
- [FIT File Types - Activity](https://developer.garmin.com/fit/file-types/activity/)
- [Health SDK Overview](https://developer.garmin.com/health-sdk/overview/)
