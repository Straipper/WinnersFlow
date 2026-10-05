import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';

const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function validateCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!EMAIL_RE.test(normalizedEmail)) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password is too long.';
  return null;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession({ userId, userAgent, ipAddress }) {
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(`
    INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
    VALUES ($1,$2,$3,$4,$5)
  `, [userId, tokenHash, userAgent?.slice(0, 1000) ?? null, ipAddress ?? null, expiresAt]);
  return { token, expiresAt };
}

export async function getUserFromToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await query(`
    SELECT u.id, u.email, u.username, u.display_name, u.role, u.created_at, u.updated_at, u.last_login_at,
           s.id AS session_id, s.expires_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
    LIMIT 1
  `, [tokenHash]);
  const user = rows[0];
  if (!user) return null;
  await query('UPDATE auth_sessions SET last_used_at=now() WHERE id=$1', [user.session_id]);
  delete user.session_id;
  return user;
}

export async function revokeToken(token) {
  if (!token) return;
  await query('DELETE FROM auth_sessions WHERE token_hash=$1', [hashToken(token)]);
}

export async function cleanupExpiredSessions() {
  await query('DELETE FROM auth_sessions WHERE expires_at <= now()');
}
