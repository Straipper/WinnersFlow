import { query } from '../db/pool.js';

export async function createJournalEntry(input) {
  const { rows } = await query(`
    INSERT INTO journal_entries
      (user_id, setup_id, symbol, side, entry_price, exit_price, pnl, notes, metadata,
       setup_snapshot, result_status, r_multiple, outcome_reason, opened_at, closed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`, [
      input.userId,
      input.setupId ?? null,
      input.symbol,
      input.side ?? null,
      input.entryPrice ?? null,
      input.exitPrice ?? null,
      input.pnl ?? null,
      input.notes ?? null,
      input.metadata ?? {},
      input.setupSnapshot ?? {},
      input.resultStatus ?? (input.exitPrice == null ? 'open' : null),
      input.rMultiple ?? null,
      input.outcomeReason ?? null,
      input.openedAt ?? null,
      input.closedAt ?? null
    ]);
  return rows[0];
}

export async function listJournalEntries(userId, limit = 100) {
  const { rows } = await query(`
    SELECT j.*, s.status AS setup_status, s.flow_detected, s.level_identified,
           s.five_min_close_confirmed, s.confidence AS setup_confidence
    FROM journal_entries j
    LEFT JOIN setups s ON s.id=j.setup_id
    WHERE j.user_id=$1
    ORDER BY j.created_at DESC
    LIMIT $2`, [userId, limit]);
  return rows;
}

export async function getJournalEntry(userId, id) {
  const { rows } = await query(`
    SELECT j.*, s.status AS setup_status, s.metadata AS setup_metadata,
           s.flow_detected, s.level_identified, s.price_action_waiting,
           s.five_min_close_confirmed, s.confidence AS setup_confidence,
           s.detected_at, s.confirmed_at
    FROM journal_entries j
    LEFT JOIN setups s ON s.id=j.setup_id
    WHERE j.user_id=$1 AND j.id=$2
    LIMIT 1`, [userId, id]);
  return rows[0] ?? null;
}

export async function updateJournalEntry(userId, id, input) {
  const { rows } = await query(`
    UPDATE journal_entries
    SET entry_price=COALESCE($3,entry_price),
        exit_price=COALESCE($4,exit_price),
        pnl=COALESCE($5,pnl),
        notes=COALESCE($6,notes),
        metadata=COALESCE($7,metadata),
        result_status=COALESCE($8,result_status),
        r_multiple=COALESCE($9,r_multiple),
        outcome_reason=COALESCE($10,outcome_reason),
        opened_at=COALESCE($11,opened_at),
        closed_at=COALESCE($12,closed_at),
        updated_at=now()
    WHERE user_id=$1 AND id=$2
    RETURNING *`, [userId, id, input.entryPrice ?? null, input.exitPrice ?? null, input.pnl ?? null,
      input.notes ?? null, input.metadata ?? null, input.resultStatus ?? null, input.rMultiple ?? null,
      input.outcomeReason ?? null, input.openedAt ?? null, input.closedAt ?? null]);
  return rows[0] ?? null;
}

export async function getJournalStats(userId) {
  const { rows } = await query(`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE result_status='win')::int AS wins,
      COUNT(*) FILTER (WHERE result_status='loss')::int AS losses,
      COUNT(*) FILTER (WHERE result_status='breakeven')::int AS breakeven,
      COALESCE(SUM(pnl),0)::numeric AS total_pnl,
      COALESCE(AVG(pnl) FILTER (WHERE pnl IS NOT NULL),0)::numeric AS avg_pnl,
      COALESCE(AVG(r_multiple) FILTER (WHERE r_multiple IS NOT NULL),0)::numeric AS avg_r
    FROM journal_entries WHERE user_id=$1`, [userId]);
  return rows[0];
}
