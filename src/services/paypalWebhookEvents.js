export const PAYPAL_SUBSCRIPTION_EVENT_TYPES = Object.freeze([
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
]);

export function getPayPalPaymentOutcome(eventType) {
  if (eventType === 'PAYMENT.SALE.COMPLETED') {
    return 'succeeded';
  }

  if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
    return 'failed';
  }

  // Refund and reversal events require transaction-history verification.
  return null;
}

function getTransactionOutcome(status) {
  if (status === 'COMPLETED' || status === 'PARTIALLY_REFUNDED') {
    return 'succeeded';
  }

  if (status === 'REFUNDED' || status === 'DECLINED') {
    return 'failed';
  }

  return null;
}

export function resolvePayPalRefundOutcome(eventType, resource, transactions) {
  if (
    eventType !== 'PAYMENT.SALE.REFUNDED' &&
    eventType !== 'PAYMENT.SALE.REVERSED'
  ) {
    return null;
  }

  if (!Array.isArray(transactions) || !resource) {
    return null;
  }

  // A refund resource has its own id; sale_id identifies the original sale.
  // A reversal event refers to the sale resource itself.
  const targetSaleId = eventType === 'PAYMENT.SALE.REFUNDED'
    ? resource.sale_id
    : resource.id;

  if (!targetSaleId) {
    return null;
  }

  const validTransactions = transactions.filter(transaction =>
    transaction &&
    transaction.id &&
    Number.isFinite(Date.parse(transaction.time || ''))
  );

  const target = validTransactions.find(
    transaction => String(transaction.id) === String(targetSaleId)
  );

  if (!target) {
    return null;
  }

  const latest = [...validTransactions].sort(
    (a, b) => Date.parse(b.time) - Date.parse(a.time)
  )[0];

  if (!latest) {
    return null;
  }

  // An old refund/reversal must not revoke access after a newer payment.
  if (String(target.id) !== String(latest.id)) {
    return getTransactionOutcome(latest.status);
  }

  if (eventType === 'PAYMENT.SALE.REVERSED') {
    return 'failed';
  }

  if (target.status === 'REFUNDED') {
    return 'failed';
  }

  if (target.status === 'PARTIALLY_REFUNDED') {
    return 'succeeded';
  }

  // PayPal may not yet have updated the transaction status.
  // Returning null makes the webhook retry instead of guessing.
  return null;
}
