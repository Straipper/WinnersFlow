import express from 'express';
import { query } from '../db/pool.js';
import {
  cleanupExpiredSessions,
  createSession,
  hashPassword,
  normalizeEmail,
  revokeToken,
  validateCredentials,
  verifyPassword,
} from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { getAccessState } from '../middleware/access.js';
import { sendTemplate } from '../services/email.js';
import { trackUniqueUserEvent } from '../services/analytics.js';
import { issueMarketSocketTicket } from '../services/websocketAuth.js';
import { rateLimit } from '../middleware/security.js';

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username ?? user.display_name ?? null,
    displayName: user.display_name ?? null,
    role: user.role,
    createdAt: user.created_at,
  };
}

router.post('/register', rateLimit({ scope: 'auth-register', windowMs: 15 * 60_000, max: 8, message: 'Too many registration attempts. Please try again later.' }), async (req, res, next) => {
  try {
    const { email, password, displayName, username } = req.body ?? {};
    const validationError = validateCredentials(email, password);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedEmail = normalizeEmail(email);
    const normalizedUsername = String(username ?? displayName ?? normalizedEmail.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || `user_${Date.now()}`;
    const existing = await query('SELECT id FROM users WHERE email=$1 OR lower(username)=lower($2) LIMIT 1', [normalizedEmail, normalizedUsername]);
    if (existing.rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await hashPassword(password);
    const { rows } = await query(`
      INSERT INTO users (email, password_hash, username, display_name)
      VALUES ($1,$2,$3,$4)
      RETURNING id,email,username,display_name,role,created_at
    `, [normalizedEmail, passwordHash, normalizedUsername, displayName?.trim()?.slice(0, 80) || null]);

    const session = await createSession({
      userId: rows[0].id,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
    await cleanupExpiredSessions();
    sendTemplate('welcome', rows[0].email, { username: rows[0].display_name || rows[0].email.split('@')[0], userId: rows[0].id }).catch(() => {});
    trackUniqueUserEvent({ eventName: 'signup', userId: rows[0].id, metadata: { external_id: rows[0].id } }).catch(() => {});

    res.status(201).json({ user: publicUser(rows[0]), token: session.token, expiresAt: session.expiresAt });
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    next(error);
  }
});

router.post('/login', rateLimit({ scope: 'auth-login', windowMs: 15 * 60_000, max: 12, message: 'Too many login attempts. Please try again later.' }), async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    const validationError = validateCredentials(email, password);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedEmail = normalizeEmail(email);
    const { rows } = await query(`
      SELECT id,email,password_hash,username,display_name,role,created_at
      FROM users WHERE email=$1 LIMIT 1
    `, [normalizedEmail]);
    const user = rows[0];
    const valid = user?.password_hash ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    const session = await createSession({
      userId: user.id,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
    await cleanupExpiredSessions();
    await query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);

    res.json({ user: publicUser(user), token: session.token, expiresAt: session.expiresAt });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeToken(req.authToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/market-ws-ticket', requireAuth, rateLimit({ scope: 'ws-ticket', windowMs: 60_000, max: 20 }), async (req, res, next) => {
  try {
    const ticket = await issueMarketSocketTicket(req.user);
    res.json({ ok: true, ticket, expiresInSeconds: 60 });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const access = await getAccessState(req.user);
    res.json({ user: publicUser(req.user), access });
  } catch (error) { next(error); }
});

export default router;
