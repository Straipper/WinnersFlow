import { Router } from 'express';
import { z } from 'zod';
import { getFlow } from '../services/flowEngine.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);

router.get('/:symbol', (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const windowMs = req.query.windowMs === undefined ? undefined : z.coerce.number().int().min(30_000).max(3_600_000).parse(req.query.windowMs);
    const largeVolume = req.query.largeVolume === undefined ? undefined : z.coerce.number().positive().parse(req.query.largeVolume);
    res.json({ ok: true, data: getFlow(symbol, { windowMs, largeVolume }) });
  } catch (error) { next(error); }
});

export default router;
