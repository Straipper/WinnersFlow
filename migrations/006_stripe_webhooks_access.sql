-- DT FLOW STEP 22 — Stripe webhook idempotency + server-side access control
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type ON stripe_webhook_events(event_type, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_period ON subscriptions(user_id, status, current_period_end DESC);
