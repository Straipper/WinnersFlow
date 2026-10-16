const states = new Map();

const DEFAULTS = {
  windowMs: 5 * 60_000,
  largeVolume: 25_000,
  minPriceMove: 0,
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function key(symbol) {
  return normalizeSymbol(symbol);
}

function getState(symbol) {
  const k = key(symbol);
  if (!states.has(k)) states.set(k, { lastPrice: null, lastDayVolume: null, lastTickAt: null, lastTradeAt: null, events: [], seenTradeIds: new Map() });
  return states.get(k);
}

function prune(events, now, windowMs) {
  const cutoff = now - windowMs;
  return events.filter(e => e.timestampMs >= cutoff);
}

/**
 * Builds flow metrics from individually identified, recent Tradier timesale events.
 * Quote updates and cumulative-volume changes are not treated as individual trades.
 * Buy/sell direction is inferred from the contemporaneous bid/ask when available;
 * otherwise price movement is only a fallback classification, not verified aggressor side.
 */
export function processFlowTick({ symbol, price, dayVolume = 0, tradeSize = 0, tradeId, exchange, tradeSide, timestamp, source }, options = {}) {
  const s = normalizeSymbol(symbol);
  const p = num(price, NaN);
  if (!s || !Number.isFinite(p)) return null;

  const cfg = { ...DEFAULTS, ...options };
  const state = getState(s);
  const now = timestamp == null ? NaN : new Date(timestamp).getTime();
  if (!Number.isFinite(now)) return null;
  state.lastTickAt = new Date(now).toISOString();
  const previousPrice = state.lastPrice;
  const previousDayVolume = state.lastDayVolume;
  const currentDayVolume = num(dayVolume, NaN);
const currentTradeSize = num(tradeSize, 0);

const allowedTradeSources = new Set([
  "stockflow_tradier_timesale",
]);
const tradeAgeMs = Date.now() - now;
const verifiedLiveTrade =
  currentTradeSize > 0 &&
  tradeId !== undefined &&
  tradeId !== null &&
  String(tradeId).trim() !== "" &&
  allowedTradeSources.has(String(source || "").toLowerCase()) &&
  tradeAgeMs >= 0 &&
  tradeAgeMs <= 60_000;

if (currentTradeSize > 0 && verifiedLiveTrade) {
  const normalizedTradeId = String(tradeId).trim();
  const dedupeWindowMs = Math.max(cfg.windowMs, 5 * 60_000);

  for (const [seenId, seenAt] of state.seenTradeIds) {
    if (seenAt < now - dedupeWindowMs) state.seenTradeIds.delete(seenId);
  }

  if (state.seenTradeIds.has(normalizedTradeId)) {
    return summarizeFlow(s, state.lastPrice, state.events, now, cfg);
  }

  state.seenTradeIds.set(normalizedTradeId, now);
  while (state.seenTradeIds.size > 5000) {
    state.seenTradeIds.delete(state.seenTradeIds.keys().next().value);
  }

  state.lastTradeAt = new Date(now).toISOString();
  const normalizedTradeSide = tradeSide === "buy" || tradeSide === "sell" ? tradeSide : null;
  const inferredTradeSide = normalizedTradeSide ?? (previousPrice !== null && p > previousPrice + cfg.minPriceMove ? "buy" : previousPrice !== null && p < previousPrice - cfg.minPriceMove ? "sell" : "neutral");

  const event = {
    id: `${s}-${now}-${Math.round(Math.random() * 1e6)}`,
    symbol: s,
    side: inferredTradeSide,
    price: p,
    volume: currentTradeSize,
    notional: p * currentTradeSize,
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    large: p * currentTradeSize >= 100000,
    tradeId,
    exchange,
    source: source || 'live_trade',
  };

  state.events.push(event);
  state.events = prune(state.events, now, cfg.windowMs);
  state.lastPrice = p;
  if (Number.isFinite(currentDayVolume)) state.lastDayVolume = currentDayVolume;

  return summarizeFlow(s, p, state.events, now, cfg);
}

let volumeDelta = 0;
  if (Number.isFinite(currentDayVolume) && Number.isFinite(previousDayVolume) && currentDayVolume >= previousDayVolume) {
    volumeDelta = currentDayVolume - previousDayVolume;
  }

  let side = 'neutral';
  if (previousPrice !== null) {
    if (p > previousPrice + cfg.minPriceMove) side = 'buy';
    else if (p < previousPrice - cfg.minPriceMove) side = 'sell';
  }

  state.lastPrice = p;
  if (Number.isFinite(currentDayVolume)) state.lastDayVolume = currentDayVolume;

  if (volumeDelta <= 0) {
    state.events = prune(state.events, now, cfg.windowMs);
    return summarizeFlow(s, p, state.events, now, cfg);
  }

  // Quote-volume deltas are not verified individual trades.
  // Do not add them to the active trade-flow event list.
  state.events = prune(state.events, now, cfg.windowMs);
  return summarizeFlow(s, p, state.events, now, cfg);
}

function summarizeFlow(symbol, price, events, now, cfg) {
  let buyVolume = 0;
  let sellVolume = 0;
  let neutralVolume = 0;
  let buyNotional = 0;
  let sellNotional = 0;
  let largeBuys = 0;
  let largeSells = 0;

  for (const e of events) {
    if (e.side === 'buy') { buyVolume += e.volume; buyNotional += e.notional; if (e.large) largeBuys += 1; }
    else if (e.side === 'sell') { sellVolume += e.volume; sellNotional += e.notional; if (e.large) largeSells += 1; }
    else neutralVolume += e.volume;
  }

  const totalDirectional = buyVolume + sellVolume;
  const deltaVolume = buyVolume - sellVolume;
  const pressure = totalDirectional > 0 ? deltaVolume / totalDirectional : 0;
  const side = pressure > 0.15 ? 'buy' : pressure < -0.15 ? 'sell' : 'neutral';

  return {
    symbol,
    price,
    lastTickAt: null,
    windowMs: cfg.windowMs,
    from: new Date(now - cfg.windowMs).toISOString(),
    to: new Date(now).toISOString(),
    buyVolume,
    sellVolume,
    neutralVolume,
    deltaVolume,
    buyNotional,
    sellNotional,
    pressure,
    side,
    largeBuys,
    largeSells,
    eventCount: events.length,
    latestEvents: events.slice(-20).reverse(),
    source: events.length > 0 ? 'live_trade_tape' : 'no_verified_trades',
    caveat: events.length > 0 ? 'Flow uses verified individual Tradier timesale events; trade side is inferred from bid/ask when available, otherwise price movement.' : 'No verified individual trade events are available in the selected window; buy/sell flow is not confirmed.',
  };
}

export function getFlow(symbol, options = {}) {
  const s = normalizeSymbol(symbol);
  const state = getState(s);
  const now = Date.now();
  state.events = prune(state.events, now, options.windowMs ?? DEFAULTS.windowMs);
  return { ...summarizeFlow(s, state.lastPrice, state.events, now, { ...DEFAULTS, ...options }), lastTickAt: state.lastTickAt, lastTradeAt: state.lastTradeAt };
}

export function resetFlow() {
  states.clear();
}
