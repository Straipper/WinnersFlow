import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const billing = readFileSync('src/routes/billing.js', 'utf8');
const migration = readFileSync('migrations/010_paypal_event_ordering.sql', 'utf8');
const a = billing.indexOf("router.post('/paypal/webhook'");
const b = billing.indexOf("router.post('/portal'", a);
const route = billing.slice(a, b);

test('timestamp is validated before event id is recorded', () => {
  assert.ok(route.indexOf('Invalid PayPal event create_time') < route.indexOf('INSERT INTO paypal_webhook_events'));
});
test('stale subscription events are ignored', () => {
  assert.match(route, /paypal_last_event_time=EXCLUDED\.paypal_last_event_time/);
  assert.match(route, /EXCLUDED\.paypal_last_event_time > subscriptions\.paypal_last_event_time/);
  assert.match(route, /if \(!subscriptionWrite\.rowCount\)/);
  assert.match(route, /received: true, stale: true/);
  assert.match(route, /eventTime/);
});
test('event marker and subscription write share one transaction', () => {
  assert.match(route, /client = await pool\.connect\(\)/);
  assert.match(route, /await client\.query\('BEGIN'\)/);
  assert.match(route, /const recorded = await client\.query\(/);
  assert.match(route, /const subscriptionWrite = await client\.query\(/);
  assert.match(route, /await client\.query\('COMMIT'\)/);
  assert.match(route, /await client\.query\('ROLLBACK'\)/);
  assert.match(route, /client\.release\(\)/);

  const detailFetch = route.indexOf(
    'await paypalRequest(`/v1/billing/subscriptions/'
  );
  const transactionStart = route.indexOf('client = await pool.connect()');
  const eventInsert = route.indexOf('INSERT INTO paypal_webhook_events');
  const subscriptionWrite = route.indexOf(
    'const subscriptionWrite = await client.query('
  );

  assert.ok(detailFetch >= 0, 'PayPal subscription details must be fetched');
  assert.ok(transactionStart > detailFetch,
    'transaction must start after the external PayPal request');
  assert.ok(eventInsert > transactionStart,
    'event marker must be inserted inside the transaction');
  assert.ok(subscriptionWrite > eventInsert,
    'subscription write must follow the event marker in the transaction');
});

test('migration adds the nullable event timestamp', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS paypal_last_event_time TIMESTAMPTZ/);
});


test('older payment failure cannot overwrite a newer successful payment', () => {
  // Confirm the production SQL has the ordering and payment-state guards.
  assert.match(route, /EXCLUDED\.paypal_last_event_time > subscriptions\.paypal_last_event_time/);
  assert.match(route, /subscriptions\.last_payment_status='failed'/);
  assert.match(route, /EXCLUDED\.last_payment_status IS DISTINCT FROM 'succeeded'/);
  assert.match(route, /last_payment_status=COALESCE\(EXCLUDED\.last_payment_status,subscriptions\.last_payment_status\)/);

  // Model the SQL rules without connecting to a database.
  function applyEvent(current, event) {
    if (current && event.time <= current.time) return current;

    let status = event.status;
    if (
      status === 'active' &&
      current?.lastPaymentStatus === 'failed' &&
      event.paymentStatus !== 'succeeded'
    ) {
      status = 'past_due';
    }

    return {
      time: event.time,
      status,
      lastPaymentStatus: event.paymentStatus ?? current?.lastPaymentStatus ?? null
    };
  }

  let state = null;

  state = applyEvent(state, {
    time: 100, status: 'past_due', paymentStatus: 'failed'
  });
  assert.equal(state.status, 'past_due');

  state = applyEvent(state, {
    time: 200, status: 'active', paymentStatus: 'succeeded'
  });
  assert.deepEqual(state, {
    time: 200, status: 'active', lastPaymentStatus: 'succeeded'
  });

  const afterOldFailure = applyEvent(state, {
    time: 150, status: 'past_due', paymentStatus: 'failed'
  });

  assert.deepEqual(afterOldFailure, state);
  assert.equal(afterOldFailure.status, 'active');
  assert.equal(afterOldFailure.lastPaymentStatus, 'succeeded');
});
