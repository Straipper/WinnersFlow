import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { env } from '../config/env.js';
import { getStripe, requireStripeConfig, getConfiguredPrice } from '../services/stripe.js';
import { sendTemplate, sendAdminTemplate } from '../services/email.js';
import { trackUniqueUserEvent } from '../services/analytics.js';
import { rateLimit } from '../middleware/security.js';

const router = express.Router();

router.post('/checkout', requireAuth, rateLimit({ scope: 'billing-checkout', windowMs: 10 * 60_000, max: 8 }), async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts have free DT FLOW access and do not need Checkout.' });
    }
    requireStripeConfig();
    const stripe = getStripe();
    const price = await getConfiguredPrice();

    const existing = await query(
      `SELECT provider_customer_id, provider_subscription_id, status
       FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const previous = existing.rows[0];
    if (previous && ['trialing', 'active', 'past_due', 'incomplete', 'unpaid'].includes(previous.status)) {
      return res.status(409).json({ error: 'This account already has a Stripe subscription or trial.', status: previous.status });
    }

    const customerId = previous?.provider_customer_id || undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      customer_email: customerId ? undefined : req.user.email,
      client_reference_id: req.user.id,
      line_items: [{ price: price.id, quantity: 1 }],
      payment_method_collection: 'always',
      payment_method_types: ['card'],
      billing_address_collection: 'auto',
      subscription_data: {
          metadata: { user_id: req.user.id, plan_code: 'dt_flow_pro', trial_days: '0', monthly_price_usd: '18.99' },
      },
      metadata: { user_id: req.user.id, plan_code: 'dt_flow_pro' },
      success_url: `${env.APP_URL}/portal?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/pricing?checkout=cancelled`,
    });

    trackUniqueUserEvent({ eventName: 'checkout_started', userId: req.user.id, metadata: { external_id: session.id, checkout_session_id: session.id } }).catch(() => {});
    res.json({ ok: true, checkoutUrl: session.url, sessionId: session.id, plan: { currency: 'USD', amount: 18.99, interval: 'month', trialDays: 0 } });
  } catch (e) { next(e); }
});



router.post('/paypal/create-subscription', requireAuth, rateLimit({ scope: 'paypal-checkout', windowMs: 10 * 60_000, max: 8 }), async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts have free WinnersFlow access.' });
    }
    if (env.PAYPAL_MODE === 'live' && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_PLAN_ID)) {
      return res.status(503).json({ error: 'PayPal is not fully configured.' });
    }
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_PLAN_ID) {
      return res.status(503).json({ error: 'PayPal is not configured yet.' });
    }

    const existing = await query(
      `SELECT provider, status FROM subscriptions
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (existing.rows[0] && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(existing.rows[0].status)) {
      return res.status(409).json({ error: 'This account already has an active or unresolved subscription.', status: existing.rows[0].status });
    }

    const created = await paypalRequest('/v1/billing/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: env.PAYPAL_PLAN_ID,
        custom_id: String(req.user.id),
        subscriber: { email_address: req.user.email },
        application_context: {
          brand_name: 'WinnersFlow',
          user_action: 'SUBSCRIBE_NOW',
          return_url: `${env.APP_URL}/welcome.html?payment=paypal&paypal=return`,
          cancel_url: `${env.APP_URL}/pricing?checkout=cancelled`
        }
      })
    });

    const approvalUrl = created.links?.find(link => link.rel === 'approve')?.href;
    if (!created.id || !approvalUrl) {
      throw new Error('PayPal did not return a subscription approval URL.');
    }

    await query(
      `INSERT INTO subscriptions
       (user_id,provider,provider_customer_id,provider_subscription_id,status,plan_code)
       VALUES ($1,'paypal',NULL,$2,'incomplete','dt_flow_pro')
       ON CONFLICT (provider_subscription_id) DO NOTHING`,
      [req.user.id, created.id]
    );

    trackUniqueUserEvent({
      eventName: 'checkout_started',
      userId: req.user.id,
      metadata: { external_id: created.id, provider: 'paypal' }
    }).catch(() => {});

    res.json({
      ok: true,
      approvalUrl,
      subscriptionId: created.id,
      plan: { currency: 'USD', amount: 18.99, interval: 'month', trialDays: 0 }
    });
  } catch (e) {
    next(e);
  }
});

router.post('/paypal/webhook', async (req, res, next) => {
  let paypalEventId = null;
  try {
    if (!env.PAYPAL_WEBHOOK_ID) {
      return res.status(503).json({ error: 'PayPal webhook is not configured.' });
    }

    const headers = req.headers;
    const verification = await paypalRequest('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        transmission_id: headers['paypal-transmission-id'],
        transmission_time: headers['paypal-transmission-time'],
        cert_url: headers['paypal-cert-url'],
        auth_algo: headers['paypal-auth-algo'],
        transmission_sig: headers['paypal-transmission-sig'],
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: req.body
      })
    });

    if (verification.verification_status !== 'SUCCESS') {
      return res.status(400).json({ error: 'PayPal webhook signature verification failed.' });
    }

    const event = req.body || {};
    if (!event.id) {
      return res.status(400).json({ error: 'PayPal webhook event ID is missing.' });
    }

    const eventType = event.event_type || '';
    const supportedEventTypes = new Set([
      'BILLING.SUBSCRIPTION.CREATED',
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.UPDATED',
      'BILLING.SUBSCRIPTION.SUSPENDED',
      'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.EXPIRED',
      'BILLING.SUBSCRIPTION.RE-ACTIVATED',
      'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED',
      'PAYMENT.SALE.COMPLETED',
      'PAYMENT.SALE.DENIED'
    ]);
    if (!supportedEventTypes.has(eventType)) {
      return res.json({ received: true, ignored: true, type: eventType || 'unknown' });
    }

    const recorded = await query(
      `INSERT INTO paypal_webhook_events (id, event_type)
       VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.id, event.event_type || 'unknown']
    );
    if (!recorded.rowCount) {
      return res.json({ received: true, duplicate: true });
    }
    paypalEventId = event.id;

    const resource = event.resource || {};
    const isSubscriptionLifecycleEvent =
      /^BILLING\.SUBSCRIPTION\.(CREATED|ACTIVATED|UPDATED|SUSPENDED|CANCELLED|EXPIRED|RE-ACTIVATED)$/.test(eventType);
    const subscriptionId = (isSubscriptionLifecycleEvent ? resource.id : null) ||
      resource.billing_agreement_id ||
      resource.subscription_id ||
      resource.supplementary_data?.related_ids?.subscription_id;

    if (!subscriptionId) {
      const error = new Error(`PayPal ${eventType} event is missing a subscription ID.`);
      error.status = 400;
      throw error;
    }

    const detail = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const existing = await query(
      `SELECT user_id FROM subscriptions
       WHERE provider='paypal' AND provider_subscription_id=$1 LIMIT 1`,
      [subscriptionId]
    );
    const storedUserId = existing.rows[0]?.user_id;
    const paypalUserId = detail.custom_id ? String(detail.custom_id) : null;

    if (storedUserId && paypalUserId && String(storedUserId) !== paypalUserId) {
      const error = new Error('PayPal subscription account mismatch.');
      error.status = 400;
      throw error;
    }

    const userId = storedUserId || paypalUserId;
    if (!userId) {
      const error = new Error('PayPal subscription is not linked to a WinnersFlow account.');
      error.status = 400;
      throw error;
    }
    if (!storedUserId) {
      const user = await query('SELECT id FROM users WHERE id=$1 LIMIT 1', [userId]);
      if (!user.rows[0]) {
        const error = new Error('PayPal subscription references an unknown WinnersFlow account.');
        error.status = 400;
        throw error;
      }
    }

    const statusMap = {
      ACTIVE: 'active',
      APPROVAL_PENDING: 'incomplete',
      APPROVED: 'incomplete',
      SUSPENDED: 'paused',
      CANCELLED: 'canceled',
      EXPIRED: 'canceled'
    };
    const paymentFailed =
      eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' ||
      eventType === 'PAYMENT.SALE.DENIED';
    const status = statusMap[detail.status];
    if (!status) {
      const error = new Error('Unrecognized PayPal subscription status.');
      error.status = 400;
      throw error;
    }

    const periodStart = detail.start_time ? Math.floor(Date.parse(detail.start_time) / 1000) : null;
    const periodEnd = detail.billing_info?.next_billing_time
      ? Math.floor(Date.parse(detail.billing_info.next_billing_time) / 1000)
      : null;
    const payerId = detail.subscriber?.payer_id || null;

    await query(
      `INSERT INTO subscriptions
       (user_id,provider,provider_customer_id,provider_subscription_id,status,plan_code,
        current_period_start,current_period_end,cancel_at_period_end,last_payment_status)
       VALUES ($1,'paypal',$2,$3,$4,'dt_flow_pro',to_timestamp($5),to_timestamp($6),false,$7)
       ON CONFLICT (provider_subscription_id) DO UPDATE SET
        user_id=EXCLUDED.user_id,
        provider='paypal',
        provider_customer_id=EXCLUDED.provider_customer_id,
        status=EXCLUDED.status,
        plan_code=EXCLUDED.plan_code,
        current_period_start=COALESCE(EXCLUDED.current_period_start,subscriptions.current_period_start),
        current_period_end=COALESCE(EXCLUDED.current_period_end,subscriptions.current_period_end),
        last_payment_status=COALESCE(EXCLUDED.last_payment_status,subscriptions.last_payment_status),
        updated_at=now()`,
      [
        userId,
        payerId,
        subscriptionId,
        status,
        periodStart,
        periodEnd,
        eventType === 'PAYMENT.SALE.COMPLETED' ||
        eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED'
          ? 'succeeded'
          : paymentFailed ? 'failed' : null
      ]
    );

    if (status === 'active') {
      trackUniqueUserEvent({
        eventName: 'subscription_active',
        userId,
        metadata: { external_id: subscriptionId, provider: 'paypal' }
      }).catch(() => {});
    }

    res.json({ received: true, type: eventType });
  } catch (e) {
    if (paypalEventId) {
      await query('DELETE FROM paypal_webhook_events WHERE id=$1', [paypalEventId]).catch(() => {});
    }
    next(e);
  }
});

router.post('/portal', requireAuth, rateLimit({ scope: 'billing-portal', windowMs: 10 * 60_000, max: 12 }), async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts have free DT FLOW access and do not need billing management.' });
    }
    requireStripeConfig();
    const stripe = getStripe();
    const { rows } = await query(
      `SELECT provider_customer_id, provider_subscription_id, status
       FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const subscription = rows[0];
    if (!subscription?.provider_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer is linked to this account yet.' });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${env.APP_URL}/portal?billing=returned`,
    });
    res.json({ ok: true, portalUrl: portal.url });
  } catch (e) { next(e); }
});

router.get('/invoices', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return res.json({ ok: true, invoices: [] });
    requireStripeConfig();
    const stripe = getStripe();
    const { rows } = await query(
      `SELECT provider_customer_id FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const customerId = rows[0]?.provider_customer_id;
    if (!customerId) return res.json({ ok: true, invoices: [] });
    const result = await stripe.invoices.list({ customer: customerId, limit: 20 });
    res.json({ ok: true, invoices: result.data.map(i => ({
      id: i.id,
      number: i.number,
      status: i.status,
      amountDue: i.amount_due,
      amountPaid: i.amount_paid,
      currency: i.currency,
      created: i.created,
      hostedInvoiceUrl: i.hosted_invoice_url,
      invoicePdf: i.invoice_pdf,
    })) });
  } catch (e) { next(e); }
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id,provider,provider_customer_id,provider_subscription_id,status,plan_code,
              trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,last_payment_status
       FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ ok: true, subscription: rows[0] || null });
  } catch (e) { next(e); }
});

export async function handleStripeWebhook(rawBody, signature) {
  if (!signature) {
    const error = new Error('Missing Stripe signature');
    error.status = 400;
    throw error;
  }
  const stripe = getStripe();
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  // Idempotency: Stripe can retry events. Ignore an event already processed.
  const inserted = await query(
    `INSERT INTO stripe_webhook_events (id,event_type) VALUES ($1,$2)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id, event.type]
  );
  if (!inserted.rowCount) return { received: true, duplicate: true, type: event.type };

  try {
    const obj = event.data.object;
    const metadata = obj.metadata || {};
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id || null;
    let userId = metadata.user_id || null;

    if (!userId && customerId) userId = await findUserIdByCustomer(customerId);

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = obj;
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (subId && userId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        await upsertSubscription({ userId, customerId: session.customer, subscription: sub, priceId: sub.items.data[0]?.price?.id });
        const ur = await query('SELECT email,display_name FROM users WHERE id=$1', [userId]); const u=ur.rows[0];
        const trialData = { username:u?.display_name || u?.email?.split('@')[0], email:u?.email, trialEndsAt:sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null, userId, eventId:event.id };
        if(u) {
          await trackUniqueUserEvent({ eventName: 'checkout_completed', userId, metadata: { external_id: event.id, checkout_session_id: session.id } }).catch(()=>{});
          if (sub.trial_end) {
            await trackUniqueUserEvent({ eventName: 'trial_started', userId, metadata: { external_id: sub.id, stripe_subscription_id: sub.id } }).catch(()=>{});
            sendTemplate('trialStarted', u.email, trialData).catch(()=>{});
            sendAdminTemplate('adminTrialStarted', trialData).catch(()=>{});
          }
        }
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = obj;
      const uid = userId || await findUserIdByCustomer(customerId);
      if (uid) {
        await upsertSubscription({ userId: uid, customerId, subscription: sub, priceId: sub.items.data[0]?.price?.id });
        const ur = await query('SELECT email,display_name FROM users WHERE id=$1', [uid]); const u=ur.rows[0];
        if(u && event.type==='customer.subscription.updated' && sub.status === 'active') trackUniqueUserEvent({ eventName: 'subscription_active', userId:uid, metadata: { external_id: sub.id, stripe_subscription_id: sub.id } }).catch(()=>{});
        if(u && event.type==='customer.subscription.deleted') {
          trackUniqueUserEvent({ eventName: 'subscription_canceled', userId:uid, metadata: { external_id: event.id, stripe_event_id: event.id } }).catch(()=>{});
          sendTemplate('canceled', u.email, {username:u.display_name || u.email.split('@')[0], userId:uid, eventId:event.id}).catch(()=>{});
          sendAdminTemplate('adminCanceled', {username:u.display_name || u.email.split('@')[0], email:u.email, userId:uid, eventId:event.id}).catch(()=>{});
        }
      }
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const uid = userId || await findUserIdByCustomer(customerId);
      if (uid) {
        await query(
          `UPDATE subscriptions SET last_invoice_id=$1,last_payment_status=$2,updated_at=now()
           WHERE user_id=$3`,
          [obj.id, event.type === 'invoice.payment_failed' ? 'failed' : 'succeeded', uid]
        );
        const ur = await query('SELECT email,display_name FROM users WHERE id=$1', [uid]); const u=ur.rows[0];
        if(u) {
          if(event.type === 'invoice.payment_failed') {
            trackUniqueUserEvent({ eventName:'payment_failed', userId:uid, metadata:{ external_id:event.id, invoice_id:obj.id } }).catch(()=>{});
            const failedData={username:u.display_name || u.email.split('@')[0], email:u.email, userId:uid, eventId:event.id, invoiceId:obj.id};
            sendTemplate('paymentFailed', u.email, failedData).catch(()=>{});
            sendAdminTemplate('adminPaymentFailed', failedData).catch(()=>{});
          } else {
            trackUniqueUserEvent({ eventName:'payment_succeeded', userId:uid, metadata:{ external_id:event.id, invoice_id:obj.id } }).catch(()=>{});
            const amount = Number.isFinite(obj.amount_paid) ? (obj.amount_paid / 100).toFixed(2) : "—";
            const paidData={username:u.display_name || u.email.split('@')[0], email:u.email, amount, currency:obj.currency || 'usd', userId:uid, eventId:event.id, invoiceId:obj.id};
            sendTemplate('paymentSuccess', u.email, paidData).catch(()=>{});
            sendAdminTemplate('adminPaymentSuccess', paidData).catch(()=>{});
          }
        }
      }
    }

    return { received: true, type: event.type };
  } catch (error) {
    // Remove the event marker so Stripe can safely retry after a transient DB/provider error.
    await query('DELETE FROM stripe_webhook_events WHERE id=$1', [event.id]).catch(() => {});
    throw error;
  }
}

async function findUserIdByCustomer(customerId) {
  if (!customerId) return null;
  const r = await query(`SELECT user_id FROM subscriptions WHERE provider_customer_id=$1 ORDER BY created_at DESC LIMIT 1`, [customerId]);
  return r.rows[0]?.user_id || null;
}

async function upsertSubscription({ userId, customerId, subscription, priceId }) {
  await query(`
    INSERT INTO subscriptions (
      user_id,provider,provider_customer_id,provider_subscription_id,status,plan_code,
      stripe_price_id,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end
    ) VALUES ($1,'stripe',$2,$3,$4,'dt_flow_pro',$5,to_timestamp($6),to_timestamp($7),to_timestamp($8),$9)
    ON CONFLICT (provider_subscription_id) DO UPDATE SET
      user_id=EXCLUDED.user_id,
      provider_customer_id=EXCLUDED.provider_customer_id,
      status=EXCLUDED.status,
      plan_code=EXCLUDED.plan_code,
      stripe_price_id=EXCLUDED.stripe_price_id,
      trial_ends_at=EXCLUDED.trial_ends_at,
      current_period_start=EXCLUDED.current_period_start,
      current_period_end=EXCLUDED.current_period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,
      updated_at=now()
  `, [
    userId, customerId, subscription.id, subscription.status, priceId || null,
    subscription.trial_end || null, subscription.current_period_start || null,
    subscription.current_period_end || null, Boolean(subscription.cancel_at_period_end),
  ]);
}


async function paypalRequest(path, options = {}) {
  const base = env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const authData = await auth.json().catch(() => ({}));
  if (!auth.ok || !authData.access_token) {
    const error = new Error('PayPal authentication failed.');
    error.status = 502;
    throw error;
  }

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('PayPal API request failed.');
    error.status = 502;
    throw error;
  }
  return data;
}

export default router;
