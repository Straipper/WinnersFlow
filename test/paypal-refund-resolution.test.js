import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePayPalRefundOutcome } from '../src/services/paypalWebhookEvents.js';

const sale = (id, time, status) => ({ id, time, status });
const resource = id => ({ id });
const refundResource = saleId => ({ id: `refund-${saleId}`, sale_id: saleId });

test('partial refund of latest payment preserves access', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      refundResource('sale-new'),
      [sale('sale-new', '2026-11-02T10:00:00Z', 'PARTIALLY_REFUNDED')]
    ),
    'succeeded'
  );
});

test('full refund of latest payment revokes access', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      refundResource('sale-new'),
      [sale('sale-new', '2026-11-02T10:00:00Z', 'REFUNDED')]
    ),
    'failed'
  );
});

test('old full refund does not revoke access after a newer completed payment', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      refundResource('sale-old'),
      [
        sale('sale-old', '2026-10-01T10:00:00Z', 'REFUNDED'),
        sale('sale-new', '2026-11-02T10:00:00Z', 'COMPLETED')
      ]
    ),
    'succeeded'
  );
});

test('old reversal does not revoke access after a newer completed payment', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REVERSED',
      resource('sale-old'),
      [
        sale('sale-old', '2026-10-01T10:00:00Z', 'COMPLETED'),
        sale('sale-new', '2026-11-02T10:00:00Z', 'COMPLETED')
      ]
    ),
    'succeeded'
  );
});

test('reversal of latest payment revokes access', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REVERSED',
      resource('sale-new'),
      [sale('sale-new', '2026-11-02T10:00:00Z', 'COMPLETED')]
    ),
    'failed'
  );
});

test('latest payment remains authoritative if an older payment was reversed', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REVERSED',
      resource('sale-old'),
      [
        sale('sale-old', '2026-10-01T10:00:00Z', 'COMPLETED'),
        sale('sale-new', '2026-11-02T10:00:00Z', 'PARTIALLY_REFUNDED')
      ]
    ),
    'succeeded'
  );
});

test('unknown or pending latest transaction is not guessed', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      refundResource('sale-new'),
      [sale('sale-new', '2026-11-02T10:00:00Z', 'PENDING')]
    ),
    null
  );
});

test('missing target transaction is not guessed', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      refundResource('missing-sale'),
      [sale('sale-new', '2026-11-02T10:00:00Z', 'COMPLETED')]
    ),
    null
  );
});


test('refund webhook matches sale_id, not the refund resource id', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      { id: 'refund-123', sale_id: 'sale-123' },
      [sale('sale-123', '2026-11-02T10:00:00Z', 'REFUNDED')]
    ),
    'failed'
  );
});

test('refund webhook without sale_id is not guessed from refund id', () => {
  assert.equal(
    resolvePayPalRefundOutcome(
      'PAYMENT.SALE.REFUNDED',
      { id: 'refund-123' },
      [sale('refund-123', '2026-11-02T10:00:00Z', 'REFUNDED')]
    ),
    null
  );
});
