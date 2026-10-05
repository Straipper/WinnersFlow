import { Router } from 'express';
import { z } from 'zod';
import { getCandles } from '../services/marketData.js';
import { detectLevels } from '../services/levels.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);
const querySchema = z.object({
  interval: z.enum(['1min','5min','15min','30min','45min','1h','2h','4h','8h','1day','1week','1month']).default('5min'),
  outputsize: z.coerce.number().int().min(30).max(5000).default(200),
  pivotLeft: z.coerce.number().int().min(1).max(10).default(3),
  pivotRight: z.coerce.number().int().min(1).max(10).default(3),
  clusterPct: z.coerce.number().positive().max(0.05).default(0.0025),
  minTouches: z.coerce.number().int().min(1).max(20).default(2),
  maxLevels: z.coerce.number().int().min(2).max(30).default(12),
});

router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const q = querySchema.parse(req.query);
    const candles = await getCandles(symbol, q.interval, q.outputsize);
    const data = detectLevels(candles, q);
    res.json({ ok: true, symbol, interval: q.interval, data });
  } catch (error) { next(error); }
});

export default router;
