import { query } from "../db/pool.js";

export async function createSetup(input) {
  const { rows } = await query(`
    INSERT INTO setups (user_id, symbol, timeframe, status, flow_detected, level_identified, price_action_waiting, five_min_close_confirmed, entry_price, level_price, stop_price, target_price, confidence, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *`,
    [input.userId ?? null, input.symbol, input.timeframe ?? "5m", input.status ?? "watching", input.flowDetected ?? false, input.levelIdentified ?? false, input.priceActionWaiting ?? true, input.fiveMinCloseConfirmed ?? false, input.entryPrice ?? null, input.levelPrice ?? null, input.stopPrice ?? null, input.targetPrice ?? null, input.confidence ?? null, input.metadata ?? {}]
  );
  return rows[0];
}

export async function confirmSetup(setupId) {
  const { rows } = await query(`
    UPDATE setups
    SET status='confirmed', five_min_close_confirmed=true, confirmed_at=now()
    WHERE id=$1
      AND flow_detected=true
      AND level_identified=true
      AND price_action_waiting=true
    RETURNING *`, [setupId]);
  return rows[0] ?? null;
}
