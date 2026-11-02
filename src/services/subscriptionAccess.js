export function isSubscriptionAccessAllowed(subscription) {
  if (!subscription) return false;

  if (subscription.provider === 'paypal') {
    return subscription.status === 'active' &&
      subscription.last_payment_status === 'succeeded';
  }

  return subscription.status === 'trialing' ||
    subscription.status === 'active';
}
