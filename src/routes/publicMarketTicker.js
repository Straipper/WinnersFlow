import express from 'express';

const SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'MSFT'];

export function createPublicMarketTickerRouter({
  getQuotes,
  now = Date.now,
  cacheTtlMs = 15000,
}) {
  const router = express.Router();
  let cache = { expiresAt: 0, data: null };

  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=10');

    try {
      if (!cache.data || now() >= cache.expiresAt) {
        const quotes = await getQuotes(SYMBOLS);
        cache = {
          data: quotes.map(q => ({
            symbol: q.symbol,
            price: q.price,
            changePct: q.changePct,
            timestamp: q.timestamp,
            source: q.source,
          })),
          expiresAt: now() + cacheTtlMs,
        };
      }

      res.json({ ok: true, data: cache.data });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Market quotes temporarily unavailable',
      });
    }
  });

  return router;
}
