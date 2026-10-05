import { evaluateAlbert } from './albertEngine.js';

const norm = s => String(s || '').trim().toUpperCase();
const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];
const activeAlerts = new Map();

function makeKey(symbol, signal) { return `${symbol}:${signal}`; }

export async function evaluateAlert(symbol, options = {}) {
  const s = norm(symbol);
  if (!s) throw new Error('symbol is required');

  const albert = await evaluateAlbert(s, options);
  const triggered = albert.confirmed === true && albert.signal !== 'NOT_CONFIRMED';
  const signal = albert.signal;
  const key = makeKey(s, signal);
  const now = new Date().toISOString();

  if (triggered && !activeAlerts.has(key)) {
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      symbol: s,
      type: 'SETUP_CONFIRMED',
      signal,
      direction: albert.direction,
      price: albert.price,
      message: albert.message,
      createdAt: now,
      source: 'dt_flow_alert_v1'
    };
    activeAlerts.set(key, alert);
    return { triggered: true, fresh: true, alert, albert };
  }

  if (!triggered) {
    // Clear the latch so a later newly-confirmed setup can trigger again.
    for (const [k, value] of activeAlerts) {
      if (value.symbol === s) activeAlerts.delete(k);
    }
  }

  return { triggered, fresh: false, alert: triggered ? activeAlerts.get(key) || null : null, albert };
}

export async function scanAlerts(symbols = DEFAULT_SYMBOLS, options = {}) {
  const selected = [...new Set(symbols.map(norm).filter(Boolean))].slice(0, 50);
  const results = await Promise.allSettled(selected.map(s => evaluateAlert(s, options)));
  return results.map((r, i) => r.status === 'fulfilled'
    ? r.value
    : { triggered: false, fresh: false, alert: null, symbol: selected[i], error: r.reason?.message || 'alert evaluation failed' });
}

export function getActiveAlerts() {
  return [...activeAlerts.values()].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function clearAlert(symbol) {
  const s = norm(symbol);
  let removed = 0;
  for (const [k, value] of activeAlerts) {
    if (value.symbol === s) { activeAlerts.delete(k); removed++; }
  }
  return removed;
}
