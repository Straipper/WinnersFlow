import express from 'express';
import { query } from '../db/pool.js';
import { diagnoseOptionWhales } from '../services/optionWhalesDiagnostics.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/access.js';
import { getAnalyticsOverview } from '../services/analytics.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);
router.get('/optionwhales-diagnostics', async (req, res, next) => {
  try {
    res.json({
      ok: true,
      diagnostics: await diagnoseOptionWhales(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/overview', async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days ?? '30', 10) || 30));
    res.json({ ok: true, analytics: await getAnalyticsOverview({ days }) });
  } catch (e) { next(e); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const [users, active, trialing, canceled, revenue] = await Promise.all([
      query(`SELECT count(*)::int AS count FROM users`),
      query(`SELECT count(*)::int AS count FROM subscriptions WHERE status='active'`),
      query(`SELECT count(*)::int AS count FROM subscriptions WHERE status='trialing'`),
      query(`SELECT count(*)::int AS count FROM subscriptions WHERE status='canceled'`),
      query(`SELECT count(*)::int AS count FROM subscriptions WHERE status='active' AND plan_code='dt_flow_pro'`),
    ]);
    res.json({ ok:true, metrics:{
      totalUsers: users.rows[0].count,
      activeSubscribers: active.rows[0].count,
      trialUsers: trialing.rows[0].count,
      canceledSubscriptions: canceled.rows[0].count,
      activePaidPlans: revenue.rows[0].count,
    }});
  } catch(e){ next(e); }
});

router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const status = String(req.query.status ?? 'all');
    const page = Math.max(1, Number.parseInt(req.query.page ?? '1',10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit ?? '50',10) || 50));
    const offset = (page-1)*limit;
    const params = [];
    const where = [];
    if(q){ params.push(`%${q}%`); where.push(`(u.email ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`); }
    if(status !== 'all'){
      params.push(status);
      if(status === 'none') where.push(`s.status IS NULL`);
      else where.push(`s.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await query(`SELECT count(*)::int AS count FROM users u LEFT JOIN LATERAL (SELECT status FROM subscriptions WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1) s ON true ${whereSql}`, params);
    params.push(limit, offset);
    const result = await query(`
      SELECT u.id,u.email,u.username,u.display_name,u.role,u.created_at,u.last_login_at,
             s.status,s.plan_code,s.trial_ends_at,s.current_period_end,s.cancel_at_period_end,
             s.provider_customer_id,s.provider_subscription_id
      FROM users u
      LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1) s ON true
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    res.json({ok:true,page,limit,total:countResult.rows[0].count,users:result.rows});
  } catch(e){ next(e); }
});

router.get('/users/:id', async (req,res,next)=>{
  try {
    const user = await query(`SELECT id,email,username,display_name,role,created_at,updated_at,last_login_at FROM users WHERE id=$1`,[req.params.id]);
    if(!user.rowCount) return res.status(404).json({error:'User not found'});
    const subscriptions = await query(`SELECT id,provider,provider_customer_id,provider_subscription_id,status,plan_code,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,last_payment_status,created_at,updated_at FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC`,[req.params.id]);
    const sessions = await query(`SELECT created_at,last_used_at,expires_at,user_agent,ip_address FROM auth_sessions WHERE user_id=$1 ORDER BY last_used_at DESC LIMIT 20`,[req.params.id]);
    res.json({ok:true,user:user.rows[0],subscriptions:subscriptions.rows,sessions:sessions.rows});
  } catch(e){next(e);}
});

export default router;
