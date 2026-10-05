-- DT FLOW STEP 28 — analytics + conversion funnel
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  visitor_id TEXT,
  session_id TEXT,
  path TEXT,
  source TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_created
  ON analytics_events(visitor_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_event_user_external
  ON analytics_events(event_name, user_id, (metadata->>'external_id'))
  WHERE user_id IS NOT NULL AND metadata ? 'external_id';
