import express from 'express';

const SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'MSFT'];

export function createPublicMarketTickerRouter({
  getQuotes,
  getLiveQuotes = async () => [],
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
        const liveQuotes = await getLiveQuotes(SYMBOLS);
        const liveBySymbol = new Map(
          (Array.isArray(liveQuotes) ? liveQuotes : [])
            .filter(q => {
              if (!q || !SYMBOLS.includes(String(q.symbol).toUpperCase())) return false;
              const timestampMs = typeof q.timestamp === 'string'
                ? Date.parse(q.timestamp) : NaN;
              const ageMs = now() - timestampMs;
              const price = Number(q.price);
              return Number.isFinite(timestampMs) &&
                ageMs >= 0 && ageMs <= 60_000 &&
                Number.isFinite(price) && price > 0;
            })
            .map(q => [String(q.symbol).toUpperCase(), q])
        );

        const missingSymbols = SYMBOLS.filter(symbol => !liveBySymbol.has(symbol));
        const fallbackQuotes = missingSymbols.length
          ? await getQuotes(missingSymbols)
          : [];
        const fallbackBySymbol = new Map(
          fallbackQuotes.map(q => [String(q.symbol).toUpperCase(), q])
        );

        const quotes = SYMBOLS.map(symbol =>
          liveBySymbol.get(symbol) || fallbackBySymbol.get(symbol)
        ).filter(Boolean);

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
              changePct: q.changePct ?? null,
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
