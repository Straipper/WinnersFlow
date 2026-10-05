import { Router } from 'express';
import { z } from 'zod';
import { getCandles, getProvider, getQuote, getQuotes } from '../services/marketData.js';
import { calculateIndicators, latestIndicators } from '../services/indicators.js';
import { getMarketSession } from '../services/marketSession.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);
const candlesQuery = z.object({
  interval: z.enum(['1min','5min','15min','30min','45min','1h','2h','4h','8h','1day','1week','1month']).default('5min'),
  outputsize: z.coerce.number().int().min(1).max(5000).default(200),
});

router.get('/provider', (_req, res) => res.json({ ok: true, ...getProvider() }));

router.get('/session', (_req, res) => res.json({ ok: true, data: getMarketSession() }));

router.get('/quotes', async (req, res, next) => {
  try {
    const symbols = req.query.symbols
      ? String(req.query.symbols).split(',').map(s => symbolSchema.parse(s))
      : undefined;
    res.json({ ok: true, data: await getQuotes(symbols) });
  } catch (error) { next(error); }
});

router.get('/quotes/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    res.json({ ok: true, data: await getQuote(symbol) });
  } catch (error) { next(error); }
});

router.get('/indicators/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const query = candlesQuery.parse(req.query);
    const candles = await getCandles(symbol, query.interval, query.outputsize);
    const series = calculateIndicators(candles);
    res.json({ ok: true, symbol, interval: query.interval, data: series, latest: latestIndicators(candles) });
  } catch (error) { next(error); }
});

router.get('/candles/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const query = candlesQuery.parse(req.query);
    res.json({ ok: true, symbol, interval: query.interval, data: await getCandles(symbol, query.interval, query.outputsize) });
  } catch (error) { next(error); }
});

export default router;
