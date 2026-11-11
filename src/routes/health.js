import { Router } from 'express';
import { query } from '../db/pool.js';
import pkg from '../../package.json' with { type: 'json' };

const router = Router();

router.get('/', async (req, res) => {
  try {
    await query('SELECT 1');
    res.status(200).json({
      ok: true,
      service: 'dt-flow-api',
      status: 'ready',
      version: pkg.version,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: 'dt-flow-api',
      status: 'database_unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
