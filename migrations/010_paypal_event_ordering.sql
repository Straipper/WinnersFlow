-- Track PayPal webhook event ordering per subscription.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paypal_last_event_time TIMESTAMPTZ;
