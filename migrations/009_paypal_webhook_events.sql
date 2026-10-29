-- PayPal webhook event idempotency
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paypal_webhook_events_type
  ON paypal_webhook_events(event_type, processed_at DESC);
