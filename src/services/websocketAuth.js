import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getAccessState } from '../middleware/access.js';
import { query } from '../db/pool.js';

const TICKET_TTL_MS = 60_000;
const usedTickets = new Map();

function secret() {
  return env.APP_SIGNING_SECRET || env.STRIPE_WEBHOOK_SECRET || 'dev-only-dt-flow-signing-secret-change-me';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

export async function issueMarketSocketTicket(user) {
  const access = await getAccessState(user);
  if (!access.allowed) {
    const error = new Error('Active WinnersFlow access is required for live market data.');
    error.status = 402;
    throw error;
  }
  const payload = {
    sub: user.id,
    role: user.role,
    exp: Date.now() + TICKET_TTL_MS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export async function verifyMarketSocketTicket(ticket) {
  if (typeof ticket !== 'string' || !ticket) return null;
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature) return null;
  const expected = Buffer.from(sign(encoded));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload?.sub || !payload?.exp || payload.exp < Date.now() || !payload?.nonce) return null;
  if (usedTickets.has(payload.nonce)) return null;
  usedTickets.set(payload.nonce, payload.exp);
  for (const [nonce, exp] of usedTickets) if (exp < Date.now()) usedTickets.delete(nonce);

  const result = await query(`SELECT id,email,username,display_name,role FROM users WHERE id=$1 LIMIT 1`, [payload.sub]);
  const user = result.rows[0];
  if (!user) return null;
  const access = await getAccessState(user);
  if (!access.allowed) return null;
  return { user, access };
}
