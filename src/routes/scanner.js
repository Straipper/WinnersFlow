import { Router } from 'express';
import { z } from 'zod';
import { scanSymbols, DEFAULT_SCANNER_SYMBOLS } from '../services/scannerEngine.js';

const router = Router();
const symbolList = z.string().trim().max(1500).optional();

router.get('/', async (req, res, next) => {
  try {
    const symbolsParam = symbolList.parse(req.query.symbols);
    const symbols = symbolsParam ? symbolsParam.split(',') : DEFAULT_SCANNER_SYMBOLS;
    const outputsize = req.query.outputsize
      ? z.coerce.number().int().min(50).max(1000).parse(req.query.outputsize)
      : 220;
    const data = await scanSymbols(symbols, { outputsize });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

export default router;
