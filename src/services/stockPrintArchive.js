async function query(...args) {
  const db = await import('../db/pool.js');
  return db.query(...args);
}

const ALLOWED_SYMBOLS = new Set([
  'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'META'
]);

export async function archiveStockPrint(event) {
  const symbol = String(event?.symbol || '').trim().toUpperCase();
  const tradeId = String(event?.tradeId ?? '').trim();
  const timestamp = new Date(event?.timestamp);
  const price = Number(event?.price);
  const size = Number(event?.size);
  const exchange = event?.exchange == null
    ? null : String(event.exchange).slice(0, 32);
  const tradeSide = ['buy', 'sell', 'unknown'].includes(event?.tradeSide)
    ? event.tradeSide : null;

  if (!ALLOWED_SYMBOLS.has(symbol) || !tradeId ||
      !Number.isFinite(timestamp.getTime()) ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isSafeInteger(size) || size <= 0) {
    return false;
  }

  const notional = price * size;
  if (!Number.isFinite(notional)) return false;

  await query(`
    INSERT INTO stock_print_archive
      (symbol, trade_id, trade_timestamp, price, size, notional,
       exchange, trade_side)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (symbol, trade_id, trade_timestamp) DO NOTHING
  `, [
    symbol, tradeId, timestamp.toISOString(), price, size,
    notional, exchange, tradeSide
  ]);

  return true;
}

export async function getDelayedStockPrints({
  now = Date.now(), limit = 40
} = {}) {
  const cutoff = new Date(now - 5 * 24 * 60 * 60 * 1000);
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);

  const result = await query(`
    SELECT symbol, trade_timestamp, price, size, notional,
           exchange, trade_side
    FROM stock_print_archive
    WHERE trade_timestamp <= $1
      AND trade_timestamp <= now() - interval '5 days'
      AND trade_side = 'buy'
      AND notional > 1000000
    ORDER BY trade_timestamp DESC
    LIMIT $2
  `, [cutoff.toISOString(), safeLimit]);

  return result.rows;
}
