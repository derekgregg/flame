-- Multi-platform schema migration
-- Decouples identity from Strava, adds platform_connections, dedup support

-- 1. Create users table (platform-agnostic identity)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  profile_pic TEXT,
  weight REAL,
  share_with_group BOOLEAN DEFAULT false,
  is_tracked BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create platform_connections table
CREATE TABLE IF NOT EXISTS platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('strava', 'wahoo', 'garmin')),
  platform_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at BIGINT,
  scopes TEXT,
  platform_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_user_id ON platform_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_pc_lookup ON platform_connections(platform, platform_user_id);

-- 3. Create oauth_state table (transient, for PKCE and cross-request state)
CREATE TABLE IF NOT EXISTS oauth_state (
  state TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '10 minutes')
);

-- 4. Add new columns to activities table
ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'strava';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS source_activity_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- 5. Migrate existing data: athletes -> users + platform_connections
-- Create a user for each existing athlete
INSERT INTO users (id, display_name, profile_pic, weight, share_with_group, is_tracked, created_at)
SELECT
  gen_random_uuid(),
  firstname || ' ' || lastname,
  profile_pic,
  weight,
  COALESCE(share_with_group, false),
  COALESCE(is_tracked, true),
  COALESCE(created_at, now())
FROM athletes
ON CONFLICT DO NOTHING;

-- Create a mapping table to link old athlete IDs to new user IDs
-- (We use a temp approach: match by name + profile_pic since those are unique enough)
CREATE TEMP TABLE athlete_user_map AS
SELECT a.id AS athlete_id, u.id AS user_id
FROM athletes a
JOIN users u ON u.display_name = (a.firstname || ' ' || a.lastname)
  AND COALESCE(u.profile_pic, '') = COALESCE(a.profile_pic, '');

-- Create platform_connections for each athlete (Strava)
INSERT INTO platform_connections (user_id, platform, platform_user_id, access_token, refresh_token, token_expires_at)
SELECT
  m.user_id,
  'strava',
  a.id::text,
  a.access_token,
  a.refresh_token,
  a.token_expires_at
FROM athletes a
JOIN athlete_user_map m ON m.athlete_id = a.id
ON CONFLICT (platform, platform_user_id) DO NOTHING;

-- Update activities with user_id and source info
UPDATE activities SET
  user_id = m.user_id,
  source_activity_id = activities.id::text
FROM athlete_user_map m
WHERE activities.athlete_id = m.athlete_id
  AND activities.user_id IS NULL;

-- 6. Create dedup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_dedup
  ON activities(user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_source
  ON activities(source_platform, source_activity_id) WHERE source_activity_id IS NOT NULL;

-- 7. Clean up expired oauth_state entries (can run periodically)
-- DELETE FROM oauth_state WHERE expires_at < now();

-- Note: The athletes table is kept for now as a fallback.
-- Once the migration is verified, it can be dropped.
-- DO NOT drop it yet — the old code may still reference it during rollout.
