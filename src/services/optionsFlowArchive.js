async function query(...args) {
  const db = await import('../db/pool.js');
  return db.query(...args);
}

const ALLOWED_SYMBOLS = new Set([
  'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'META'
]);

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export async function archiveOptionsFlowEvent(event) {
  const ticker = String(event?.ticker || '').trim().toUpperCase();
  const eventId = String(event?.id ?? '').trim();
  const timestamp = new Date(event?.timestamp);
  const contract = String(event?.contract || '').trim();
  const direction = String(event?.direction || '').trim().toUpperCase();
  const contracts = Number(event?.contracts);
  const premium = Number(event?.premium);
  const notional = event?.notional == null ? null : Number(event.notional);
  const confidence = event?.directionConfidence == null
    ? null : Number(event.directionConfidence);

  if (!ALLOWED_SYMBOLS.has(ticker) ||
      !eventId || eventId.length > 200 ||
      !Number.isFinite(timestamp.getTime()) ||
      !contract || contract.length > 100 ||
      direction !== 'BUY' ||
      !Number.isSafeInteger(contracts) || contracts <= 0 ||
      !Number.isFinite(premium) || premium <= 100000 ||
      (notional !== null && (!Number.isFinite(notional) || notional < 0)) ||
      (confidence !== null &&
        (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) {
    return false;
  }

  // Reject explicit cancellation/correction markers if a provider supplies them.
  if (event?.isCancelled === true || event?.isCorrection === true ||
      event?.cancelled === true || event?.corrected === true) {
    return false;
  }

  await query(`
    INSERT INTO options_flow_archive (
      ticker, event_id, event_timestamp, contract,
      option_type, strike, expiration, contracts, premium,
      notional, direction, direction_confidence, order_type
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'BUY',$11,$12
    )
    ON CONFLICT (ticker, event_id, event_timestamp) DO NOTHING
  `, [
    ticker,
    eventId,
    timestamp.toISOString(),
    contract,
    event.optionType || null,
    event.strike == null ? null : Number(event.strike),
    event.expiration || null,
    contracts,
    premium,
    notional,
    confidence,
    event.orderType == null ? null : String(event.orderType).slice(0, 40),
  ]);

  return true;
}

export async function archiveOptionsFlowRows(rows = []) {
  if (!Array.isArray(rows)) return 0;

  let archived = 0;
  for (const row of rows) {
    // Älä niele DB-virheitä: kerääjän täytyy säilyttää sivutuskursori.
    if (await archiveOptionsFlowEvent(row)) archived += 1;
  }
  return archived;
}

export async function getDelayedOptionsFlow({
  now = Date.now(),
  limit = 40,
} = {}) {
  const cutoff = new Date(now - FIVE_DAYS_MS);
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);

  const result = await query(`
    SELECT ticker, event_id, event_timestamp, contract,
           option_type, strike, expiration, contracts,
           premium, notional, direction, direction_confidence,
           order_type
    FROM options_flow_archive
    WHERE event_timestamp <= $1
      AND event_timestamp <= now() - interval '5 days'
      AND direction = 'BUY'
      AND premium > 100000
      AND contracts > 0
    ORDER BY event_timestamp DESC
    LIMIT $2
  `, [cutoff.toISOString(), safeLimit]);

  return result.rows;
}
