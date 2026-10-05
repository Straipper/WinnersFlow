import { query } from '../db/pool.js';

export async function getAccessState(user) {
  if (!user) return { allowed: false, reason: 'AUTH_REQUIRED', plan: null, subscription: null };

  // Owner/admin access is always free and does not depend on Stripe.
  if (user.role === 'admin') {
    return { allowed: true, reason: 'ADMIN_FREE', plan: 'admin', subscription: null };
  }

  const { rows } = await query(`
    SELECT id, status, plan_code, trial_ends_at, current_period_start,
           current_period_end, cancel_at_period_end, last_payment_status
    FROM subscriptions
    WHERE user_id=$1
    ORDER BY created_at DESC
    LIMIT 1
  `, [user.id]);

  const subscription = rows[0] || null;
  if (!subscription) {
    return { allowed: false, reason: 'NO_SUBSCRIPTION', plan: null, subscription: null };
  }

  // Access is deliberately fail-closed: only a live trial or paid subscription grants access.
  const allowed = subscription.status === 'trialing' || subscription.status === 'active';
  return {
    allowed,
    reason: allowed ? (subscription.status === 'trialing' ? 'TRIAL_ACTIVE' : 'SUBSCRIPTION_ACTIVE') : 'SUBSCRIPTION_NOT_ACTIVE',
    plan: subscription.plan_code,
    subscription,
  };
}

export async function requireProductAccess(req, res, next) {
  try {
    const access = await getAccessState(req.user);
    if (!access.allowed) {
      return res.status(402).json({
        error: 'DT FLOW subscription required',
        code: access.reason,
        access,
      });
    }
    req.access = access;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
