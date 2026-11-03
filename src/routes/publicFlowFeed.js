import { Router } from 'express';
import { getDelayedStockPrints } from '../services/stockPrintArchive.js';
import { getDelayedOptionsFlow } from '../services/optionsFlowArchive.js';

const ALLOWED_OPTIONS_TICKERS = new Set([
  'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'META',
]);

export function createPublicFlowFeedRouter({
  getStockPrints = getDelayedStockPrints,
  getOptionsFlow = getDelayedOptionsFlow,
} = {}) {
  const router = Router();

  router.get('/stock-prints', async (req, res) => {
    try {
      const rows = await getStockPrints({ limit: 40 });
      const cutoff = Date.now() - 120 * 60 * 60 * 1000;
      const verifiedRows = rows.filter(row => {
        const timestamp = Date.parse(row?.trade_timestamp);
        const price = Number(row?.price);
        const size = Number(row?.size);
        const notional = Number(row?.notional);

        return row?.trade_side === 'buy' &&
          Number.isFinite(timestamp) && timestamp <= cutoff &&
          typeof row?.symbol === 'string' &&
          Number.isFinite(price) && price > 0 &&
          Number.isFinite(size) && size > 0 &&
          Number.isFinite(notional) && notional > 1000000;
      });

      res.set('Cache-Control', 'public, max-age=30');
      res.json({
        ok: true,
        status: verifiedRows.length ? 'DELAYED_DATA_AVAILABLE' : 'WAITING_FOR_5_DAY_ARCHIVE',
        delayHours: 120,
        data: verifiedRows.map(row => ({
          symbol: row.symbol,
          timestamp: row.trade_timestamp,
          price: Number(row.price),
          size: Number(row.size),
          notional: Number(row.notional),
          exchange: row.exchange ?? null,
          tradeSide: row.trade_side ?? null,
        })),
      });
    } catch {
      res.status(503).json({
        ok: false,
        status: 'FEED_UNAVAILABLE',
        error: 'Stock prints temporarily unavailable',
      });
    }
  });


  router.get('/options-flow', async (req, res) => {
    try {
      const rows = await getOptionsFlow({ limit: 40 });
      const cutoff = Date.now() - 120 * 60 * 60 * 1000;

      const verifiedRows = rows.filter(row => {
        const timestamp = Date.parse(row?.event_timestamp);
        const premium = Number(row?.premium);
        const contracts = Number(row?.contracts);
        const confidence = row?.direction_confidence == null
          ? null : Number(row.direction_confidence);

        return row?.direction === 'BUY' &&
          Number.isFinite(timestamp) && timestamp <= cutoff &&
          typeof row?.ticker === 'string' &&
          ALLOWED_OPTIONS_TICKERS.has(row.ticker.trim().toUpperCase()) &&
          typeof row?.contract === 'string' &&
          row.contract.length > 0 &&
          Number.isSafeInteger(contracts) && contracts > 0 &&
          Number.isFinite(premium) && premium > 100000 &&
          (confidence === null ||
            (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1));
      });

      res.set('Cache-Control', 'public, max-age=30');
      res.json({
        ok: true,
        status: verifiedRows.length
          ? 'DELAYED_DATA_AVAILABLE'
          : 'WAITING_FOR_5_DAY_ARCHIVE',
        delayHours: 120,
        data: verifiedRows.map(row => ({
          ticker: row.ticker,
          timestamp: row.event_timestamp,
          contract: row.contract,
          optionType: row.option_type ?? null,
          strike: row.strike == null ? null : Number(row.strike),
          expiration: row.expiration ?? null,
          contracts: Number(row.contracts),
          premium: Number(row.premium),
          direction: 'BUY',
          directionConfidence: row.direction_confidence == null
            ? null : Number(row.direction_confidence),
          orderType: row.order_type ?? null,
        })),
      });
    } catch {
      res.status(503).json({
        ok: false,
        status: 'FEED_UNAVAILABLE',
        error: 'Options flow temporarily unavailable',
      });
    }
  });

  return router;
}
