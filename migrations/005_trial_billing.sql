-- DT FLOW STEP 20 — 3-day trial + Stripe subscription billing
-- Stripe stores payment credentials. DT FLOW stores only Stripe IDs/status.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_invoice_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_status TEXT;
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer ON subscriptions(provider_customer_id);
