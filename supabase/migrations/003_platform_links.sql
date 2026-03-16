-- Add platform_links column to store cross-platform activity references
-- e.g. {"strava": "12345", "garmin": "67890"}
ALTER TABLE activities ADD COLUMN IF NOT EXISTS platform_links JSONB DEFAULT '{}';

-- Backfill existing activities with their source platform link
UPDATE activities
SET platform_links = jsonb_build_object(source_platform, source_activity_id)
WHERE source_platform IS NOT NULL
  AND source_activity_id IS NOT NULL
  AND (platform_links IS NULL OR platform_links = '{}');
