import express from 'express';

const SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'MSFT'];

export function createPublicMarketTickerRouter({
  getQuotes,
  now = Date.now,
  cacheTtlMs = 15000,
  staleAfterMs = 15 * 60 * 1000,
}) {
  const router = express.Router();
  let cache = { expiresAt: 0, data: null };

  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=10');

    try {
      if (!cache.data || now() >= cache.expiresAt) {
        const quotes = await getQuotes(SYMBOLS);
        cache = {
          data: quotes.map(q => {
            const timestampMs = typeof q.timestamp === 'string'
              ? Date.parse(q.timestamp)
              : NaN;
            const age = Number.isFinite(timestampMs)
              ? now() - timestampMs
              : null;
            const ageMs = age !== null && age >= 0 ? age : null;

            return {
              symbol: q.symbol,
              price: q.price,
              changePct: q.changePct,
              timestamp: q.timestamp,
              source: q.source,
              ageMs,
              isStale: ageMs === null || ageMs > staleAfterMs,
            };
          }),
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
