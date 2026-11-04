import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(new URL('../src/routes/billing.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/013_stripe_event_ordering.sql', import.meta.url), 'utf8');

test('migration adds Stripe timestamp independently of PayPal', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS stripe_last_event_time TIMESTAMPTZ/i);
  assert.doesNotMatch(migration, /paypal_last_event_time/i);
});

test('subscription upsert stores Stripe event timestamp', () => {
  assert.match(route, /stripe_last_event_time=EXCLUDED\.stripe_last_event_time/);
  assert.match(route, /subscriptions\.stripe_last_event_time IS NULL/);
  assert.match(route, /EXCLUDED\.stripe_last_event_time/);
  assert.match(route, /subscriptions\.provider='stripe'/);
});

test('both Stripe subscription event paths pass event.created', () => {
  const calls = route.match(/upsertSubscription\(\{[^}]*eventCreated:\s*event\.created[^}]*\}\)/gs) || [];
  assert.equal(calls.length, 2);
});

test('invoice updates match exact Stripe subscription and user', () => {
  assert.match(route, /provider='stripe'\s+AND provider_subscription_id=\$4/s);
  assert.match(route, /WHERE user_id=\$3/);
  assert.match(route, /stripe_last_event_time\s*<=\s*to_timestamp\(\$5\)/);
});

test('customer lookup is restricted to Stripe provider', () => {
  assert.match(route, /WHERE provider='stripe' AND provider_customer_id=\$1/);
});

test('payment notifications require a successful matching update', () => {
  assert.match(route, /if \(updated\.rowCount > 0\)/);
});
