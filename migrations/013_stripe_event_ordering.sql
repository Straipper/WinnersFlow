-- Keep Stripe event ordering independent from PayPal event ordering.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_last_event_time TIMESTAMPTZ;
