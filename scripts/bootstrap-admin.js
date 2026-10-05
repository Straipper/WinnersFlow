import 'dotenv/config';
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/services/auth.js';

const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@dtflow.local';
const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!password || password.length < 12) {
  throw new Error('Set ADMIN_BOOTSTRAP_PASSWORD to a strong password of at least 12 characters.');
}

const existing = await query('SELECT id FROM users WHERE email=$1 OR lower(username)=lower($2) LIMIT 1', [email.toLowerCase(), username.toLowerCase()]);
if (existing.rowCount) {
  await query('UPDATE users SET role=\'admin\', username=$2 WHERE id=$1', [existing.rows[0].id, username.toLowerCase()]);
  console.log(`Admin role ensured for ${email}`);
} else {
  const hash = await hashPassword(password);
  await query(`INSERT INTO users (email,password_hash,username,display_name,role) VALUES ($1,$2,$3,$4,'admin')`, [email.toLowerCase(), hash, username.toLowerCase(), 'DT FLOW Admin']);
  console.log(`Admin created: ${email}`);
}
await pool.end();
