-- Upload tracking table
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size INTEGER,
  activity_name TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  activity_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);

-- Enrichment columns on activities (from file parsing)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS normalized_power INTEGER;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS avg_cadence SMALLINT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_cadence SMALLINT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS avg_heart_rate SMALLINT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_heart_rate SMALLINT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS calories INTEGER;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS lap_data JSONB;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS enrichment_data JSONB;

-- Create Supabase Storage bucket for uploads (run via Supabase dashboard or API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false);
