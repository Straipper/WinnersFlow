import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYPAL_SUBSCRIPTION_EVENT_TYPES,
  getPayPalPaymentOutcome
} from '../src/services/paypalWebhookEvents.js';

test('official subscription webhook events are supported', () => {
  for (const event of [
    'BILLING.SUBSCRIPTION.CREATED',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.UPDATED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.RE-ACTIVATED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'PAYMENT.SALE.COMPLETED',
    'PAYMENT.SALE.REFUNDED',
    'PAYMENT.SALE.REVERSED'
  ]) {
    assert.ok(PAYPAL_SUBSCRIPTION_EVENT_TYPES.includes(event), event);
  }
});

test('successful subscription sale records a successful payment', () => {
  assert.equal(getPayPalPaymentOutcome('PAYMENT.SALE.COMPLETED'), 'succeeded');
});

test('failed subscription payment revokes payment access', () => {
  assert.equal(
    getPayPalPaymentOutcome('BILLING.SUBSCRIPTION.PAYMENT.FAILED'),
    'failed'
  );
});

test('refunded subscription sale requires transaction verification', () => {
  assert.equal(getPayPalPaymentOutcome('PAYMENT.SALE.REFUNDED'), null);
});

test('reversed subscription sale requires transaction verification', () => {
  assert.equal(getPayPalPaymentOutcome('PAYMENT.SALE.REVERSED'), null);
});

test('lifecycle events do not overwrite the last payment outcome', () => {
  assert.equal(getPayPalPaymentOutcome('BILLING.SUBSCRIPTION.ACTIVATED'), null);
});

test('unsupported and obsolete event names have no payment outcome', () => {
  assert.equal(getPayPalPaymentOutcome('BILLING.SUBSCRIPTION.PAYMENT.COMPLETED'), null);
  assert.equal(getPayPalPaymentOutcome('PAYMENT.SALE.DENIED'), null);
  assert.equal(getPayPalPaymentOutcome('UNKNOWN.EVENT'), null);
});
