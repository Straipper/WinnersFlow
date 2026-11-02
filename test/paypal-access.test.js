import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubscriptionAccessAllowed } from '../src/services/subscriptionAccess.js';

test('PayPal active without a successful payment is denied', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'paypal',
    status: 'active',
    last_payment_status: null
  }), false);
});

test('PayPal active after a successful payment is allowed', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'paypal',
    status: 'active',
    last_payment_status: 'succeeded'
  }), true);
});

test('PayPal active after a failed payment is denied', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'paypal',
    status: 'active',
    last_payment_status: 'failed'
  }), false);
});

test('PayPal incomplete subscription is denied', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'paypal',
    status: 'incomplete',
    last_payment_status: null
  }), false);
});

test('Stripe active subscription retains access', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'stripe',
    status: 'active',
    last_payment_status: null
  }), true);
});

test('Stripe active trial retains access', () => {
  assert.equal(isSubscriptionAccessAllowed({
    provider: 'stripe',
    status: 'trialing',
    last_payment_status: null
  }), true);
});

test('missing subscription is denied', () => {
  assert.equal(isSubscriptionAccessAllowed(null), false);
});
