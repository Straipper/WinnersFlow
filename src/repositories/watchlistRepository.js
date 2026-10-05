import { query } from '../db/pool.js';

export async function listWatchlists(userId) {
  const { rows } = await query(`
    SELECT w.id, w.name, w.created_at,
      COALESCE(json_agg(
        json_build_object('id', wi.id, 'symbol', wi.symbol, 'sortOrder', wi.sort_order, 'createdAt', wi.created_at)
        ORDER BY wi.sort_order ASC, wi.created_at ASC
      ) FILTER (WHERE wi.id IS NOT NULL), '[]'::json) AS items
    FROM watchlists w
    LEFT JOIN watchlist_items wi ON wi.watchlist_id=w.id
    WHERE w.user_id=$1
    GROUP BY w.id
    ORDER BY w.created_at ASC`, [userId]);
  return rows;
}

export async function getWatchlist(userId, id) {
  const { rows } = await query(`
    SELECT w.id, w.name, w.created_at,
      COALESCE(json_agg(
        json_build_object('id', wi.id, 'symbol', wi.symbol, 'sortOrder', wi.sort_order, 'createdAt', wi.created_at)
        ORDER BY wi.sort_order ASC, wi.created_at ASC
      ) FILTER (WHERE wi.id IS NOT NULL), '[]'::json) AS items
    FROM watchlists w
    LEFT JOIN watchlist_items wi ON wi.watchlist_id=w.id
    WHERE w.user_id=$1 AND w.id=$2
    GROUP BY w.id LIMIT 1`, [userId, id]);
  return rows[0] ?? null;
}

export async function ensureDefaultWatchlist(userId) {
  const { rows } = await query(`
    INSERT INTO watchlists (user_id, name)
    VALUES ($1, 'Main Watchlist')
    ON CONFLICT (user_id, name) DO UPDATE SET name=EXCLUDED.name
    RETURNING id`, [userId]);
  return rows[0].id;
}

export async function createWatchlist(userId, name) {
  const { rows } = await query(`
    INSERT INTO watchlists (user_id, name) VALUES ($1,$2) RETURNING id,name,created_at`, [userId,name]);
  return rows[0];
}

export async function renameWatchlist(userId, id, name) {
  const { rows } = await query(`
    UPDATE watchlists SET name=$3 WHERE user_id=$1 AND id=$2 RETURNING id,name,created_at`, [userId,id,name]);
  return rows[0] ?? null;
}

export async function deleteWatchlist(userId, id) {
  const { rowCount } = await query(`DELETE FROM watchlists WHERE user_id=$1 AND id=$2`, [userId,id]);
  return rowCount > 0;
}

export async function addSymbol(userId, watchlistId, symbol, sortOrder) {
  const { rows } = await query(`
    INSERT INTO watchlist_items (watchlist_id, symbol, sort_order)
    SELECT id, $3, COALESCE($4, (SELECT COALESCE(MAX(sort_order),-1)+1 FROM watchlist_items WHERE watchlist_id=id))
    FROM watchlists WHERE id=$2 AND user_id=$1
    ON CONFLICT (watchlist_id, symbol) DO UPDATE SET sort_order=EXCLUDED.sort_order
    RETURNING *`, [userId,watchlistId,symbol,sortOrder ?? null]);
  return rows[0] ?? null;
}

export async function removeSymbol(userId, watchlistId, symbol) {
  const { rowCount } = await query(`
    DELETE FROM watchlist_items wi USING watchlists w
    WHERE wi.watchlist_id=w.id AND w.user_id=$1 AND w.id=$2 AND wi.symbol=$3`, [userId,watchlistId,symbol]);
  return rowCount > 0;
}

export async function reorderSymbols(userId, watchlistId, symbols) {
  await query('BEGIN');
  try {
    for (let i=0;i<symbols.length;i++) {
      await query(`UPDATE watchlist_items wi SET sort_order=$4
        FROM watchlists w WHERE wi.watchlist_id=w.id AND w.user_id=$1 AND w.id=$2 AND wi.symbol=$3`, [userId,watchlistId,symbols[i],i]);
    }
    await query('COMMIT');
  } catch (e) { await query('ROLLBACK'); throw e; }
  return getWatchlist(userId,watchlistId);
}
