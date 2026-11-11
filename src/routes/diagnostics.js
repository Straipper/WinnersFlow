import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { query } from '../db/pool.js';

const router = Router();

router.get('/database', async (req, res, next) => {
  const expected = process.env.WF_DIAGNOSTICS_TOKEN;
  const provided = req.get('x-winnersflow-diagnostics-token') ?? '';

  if (
    !expected ||
    expected.length < 32 ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return res.sendStatus(404);
  }

  try {
    const db = await query(`
      SELECT
        current_database() AS database,
        to_regclass('public.users') IS NOT NULL AS users_table_exists,
        to_regclass('public.schema_migrations') IS NOT NULL AS migration_table_exists,
        to_regclass('public.auth_sessions') IS NOT NULL AS auth_sessions_table_exists
    `);

    const columnsResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
      ORDER BY ordinal_position
    `);

    const columns = columnsResult.rows.map(row => row.column_name);
    const required = [
      'email',
      'password_hash',
      'username',
      'display_name',
      'role',
      'created_at'
    ];

    let migrations = null;
    if (db.rows[0].migration_table_exists) {
      const result = await query(`
        SELECT version
        FROM public.schema_migrations
        ORDER BY version
      `);
      migrations = result.rows.map(row => row.version);
    }

    let users = null;
    if (
      db.rows[0].users_table_exists &&
      columns.includes('password_hash')
    ) {
      const result = await query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE password_hash IS NULL OR btrim(password_hash) = ''
          )::int AS missing_password_hash
        FROM public.users
      `);
      users = result.rows[0];
    }

    res.json({
      ok: true,
      database: db.rows[0],
      userColumns: Object.fromEntries(
        required.map(name => [name, columns.includes(name)])
      ),
      migrations: migrations === null
        ? null
        : { count: migrations.length, versions: migrations },
      users
    });
  } catch (error) {
    next(error);
  }
});


router.get('/admin-account', async (req, res, next) => {
  const expected = process.env.WF_DIAGNOSTICS_TOKEN;
  const provided = req.get('x-winnersflow-diagnostics-token') ?? '';

  if (
    !expected ||
    expected.length < 32 ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return res.sendStatus(404);
  }

  try {
    const result = await query(`
      SELECT
        EXISTS (
          SELECT 1 FROM public.users
          WHERE lower(email) = lower($1)
        ) AS email_found,
        EXISTS (
          SELECT 1 FROM public.users
          WHERE lower(email) = lower($1) AND role = 'admin'
        ) AS email_is_admin,
        EXISTS (
          SELECT 1 FROM public.users
          WHERE lower(username) = lower($2)
        ) AS admin_username_in_use,
        EXISTS (
          SELECT 1 FROM public.users
          WHERE lower(username) = lower($2)
            AND lower(email) <> lower($1)
        ) AS admin_username_conflict
    `, ['admstripe@proton.me', 'admin']);

    res.json({ ok: true, adminAccount: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
