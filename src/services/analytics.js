import { query } from '../db/pool.js';

const EVENT_NAMES = new Set([
  'page_view',
  'signup',
  'trial_started',
  'checkout_started',
  'checkout_completed',
  'payment_succeeded',
  'payment_failed',
  'subscription_active',
  'subscription_canceled',
]);

export function isAnalyticsEventName(name) {
  return EVENT_NAMES.has(String(name || ''));
}

export async function trackEvent({
  eventName,
  userId = null,
  visitorId = null,
  sessionId = null,
  path = null,
  source = null,
  metadata = {},
}) {
  if (!isAnalyticsEventName(eventName)) return { tracked: false, reason: 'unknown_event' };
  const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const result = await query(
    `INSERT INTO analytics_events
      (event_name,user_id,visitor_id,session_id,path,source,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id,created_at`,
    [eventName, userId, visitorId, sessionId, path, source, JSON.stringify(safeMetadata)]
  );
  return { tracked: true, id: result.rows[0].id, createdAt: result.rows[0].created_at };
}

export async function trackUniqueUserEvent({ eventName, userId, metadata = {} }) {
  if (!isAnalyticsEventName(eventName) || !userId) return { tracked: false };
  const externalId = metadata.external_id;
  if (!externalId) return trackEvent({ eventName, userId, metadata });
  const result = await query(
    `INSERT INTO analytics_events (event_name,user_id,metadata)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (event_name,user_id,(metadata->>'external_id'))
     WHERE user_id IS NOT NULL AND metadata ? 'external_id'
     DO NOTHING
     RETURNING id,created_at`,
    [eventName, userId, JSON.stringify(metadata)]
  );
  return result.rowCount
    ? { tracked: true, id: result.rows[0].id, createdAt: result.rows[0].created_at }
    : { tracked: false, duplicate: true };
}

export async function getAnalyticsOverview({ days = 30 } = {}) {
  const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
  const [{ rows: funnel }, { rows: recent }, { rows: daily }, { rows: subscriptions }] = await Promise.all([
    query(`
      SELECT
        count(*) FILTER (WHERE event_name='page_view')::int AS page_views,
        count(DISTINCT visitor_id) FILTER (WHERE event_name='page_view' AND visitor_id IS NOT NULL)::int AS unique_visitors,
        count(DISTINCT user_id) FILTER (WHERE event_name='signup' AND user_id IS NOT NULL)::int AS signups,
        count(DISTINCT user_id) FILTER (WHERE event_name='trial_started' AND user_id IS NOT NULL)::int AS trials,
        count(DISTINCT user_id) FILTER (WHERE event_name='checkout_started' AND user_id IS NOT NULL)::int AS checkout_started,
        count(DISTINCT user_id) FILTER (WHERE event_name='checkout_completed' AND user_id IS NOT NULL)::int AS checkout_completed,
        count(DISTINCT user_id) FILTER (WHERE event_name='payment_succeeded' AND user_id IS NOT NULL)::int AS paid_users,
        count(DISTINCT user_id) FILTER (WHERE event_name='subscription_active' AND user_id IS NOT NULL)::int AS active_users,
        count(DISTINCT user_id) FILTER (WHERE event_name='subscription_canceled' AND user_id IS NOT NULL)::int AS canceled_users,
        count(*) FILTER (WHERE event_name='payment_failed')::int AS payment_failures
      FROM analytics_events
      WHERE created_at >= now() - ($1::int * interval '1 day')`, [safeDays]),
    query(`
      SELECT id,event_name,user_id,visitor_id,path,source,metadata,created_at
      FROM analytics_events
      ORDER BY created_at DESC
      LIMIT 100`),
    query(`
      SELECT date_trunc('day', created_at)::date AS day,
             count(*) FILTER (WHERE event_name='page_view')::int AS page_views,
             count(DISTINCT visitor_id) FILTER (WHERE event_name='page_view' AND visitor_id IS NOT NULL)::int AS unique_visitors,
             count(DISTINCT user_id) FILTER (WHERE event_name='signup' AND user_id IS NOT NULL)::int AS signups,
             count(DISTINCT user_id) FILTER (WHERE event_name='trial_started' AND user_id IS NOT NULL)::int AS trials,
             count(DISTINCT user_id) FILTER (WHERE event_name='payment_succeeded' AND user_id IS NOT NULL)::int AS paid_users
      FROM analytics_events
      WHERE created_at >= now() - ($1::int * interval '1 day')
      GROUP BY 1 ORDER BY 1 ASC`, [safeDays]),
    query(`
      SELECT count(*) FILTER (WHERE status='active')::int AS active_subscriptions,
             count(*) FILTER (WHERE status='trialing')::int AS trialing_subscriptions,
             count(*) FILTER (WHERE status='canceled')::int AS canceled_subscriptions,
             COALESCE(sum(CASE WHEN status='active' THEN 29 ELSE 0 END),0)::numeric AS mrr_usd
      FROM subscriptions`),
  ]);

  const f = funnel[0] || {};
  const pct = (a, b) => b > 0 ? Number(((a / b) * 100).toFixed(2)) : 0;
  const active = subscriptions[0] || {};
  return {
    windowDays: safeDays,
    funnel: {
      pageViews: f.page_views || 0,
      uniqueVisitors: f.unique_visitors || 0,
      signups: f.signups || 0,
      trials: f.trials || 0,
      checkoutStarted: f.checkout_started || 0,
      checkoutCompleted: f.checkout_completed || 0,
      paidUsers: f.paid_users || 0,
      activeUsers: f.active_users || 0,
      canceledUsers: f.canceled_users || 0,
      paymentFailures: f.payment_failures || 0,
    },
    conversion: {
      visitorToSignupPct: pct(f.signups || 0, f.unique_visitors || 0),
      signupToTrialPct: pct(f.trials || 0, f.signups || 0),
      trialToPaidPct: pct(f.paid_users || 0, f.trials || 0),
      checkoutToPaidPct: pct(f.paid_users || 0, f.checkout_started || 0),
    },
    subscriptions: {
      active: active.active_subscriptions || 0,
      trialing: active.trialing_subscriptions || 0,
      canceled: active.canceled_subscriptions || 0,
      mrrUsd: Number(active.mrr_usd || 0),
    },
    daily,
    recent,
  };
}
