import { Router } from 'express';
import { z } from 'zod';
import { analyzeSofia, analyzeSofiaBatch } from '../services/sofiaEngine.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20);

router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const outputsize = req.query.outputsize
      ? z.coerce.number().int().min(50).max(1000).parse(req.query.outputsize)
      : 220;
    const data = await analyzeSofia(symbol, { outputsize });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const symbols = String(req.query.symbols || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) return res.status(400).json({ ok: false, error: 'symbols query parameter is required' });
    const data = await analyzeSofiaBatch(symbols);
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

export default router;
