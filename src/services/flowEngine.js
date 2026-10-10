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
  if (!states.has(k)) states.set(k, { lastPrice: null, lastDayVolume: null, events: [] });
  return states.get(k);
}

function prune(events, now, windowMs) {
  const cutoff = now - windowMs;
  return events.filter(e => e.timestampMs >= cutoff);
}

/**
 * Builds a practical flow-pressure proxy from the live quote stream.
 * The current provider exposes price + cumulative day volume, not aggressor
 * side / individual trade size. Therefore this is NOT exchange-grade tape/order flow.
 * It classifies incremental volume by uptick/downtick direction.
 */
export function processFlowTick({ symbol, price, dayVolume = 0, tradeSize = 0, tradeId, exchange, tradeSide, timestamp = new Date().toISOString() }, options = {}) {
  const s = normalizeSymbol(symbol);
  const p = num(price, NaN);
  if (!s || !Number.isFinite(p)) return null;

  const cfg = { ...DEFAULTS, ...options };
  const state = getState(s);
  const now = new Date(timestamp).getTime();
  const previousPrice = state.lastPrice;
  const previousDayVolume = state.lastDayVolume;
  const currentDayVolume = num(dayVolume, NaN);
const currentTradeSize = num(tradeSize, 0);

if (currentTradeSize > 0) {
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
    source: 'alpaca_trade',
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

  const event = {
    id: `${s}-${now}-${Math.round(Math.random() * 1e6)}`,
    symbol: s,
    side,
    price: p,
    volume: volumeDelta,
    notional: p * volumeDelta,
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    large: volumeDelta >= cfg.largeVolume,
    source: 'quote_volume_proxy',
  };

  state.events.push(event);
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
    source: events.some(e => e.tradeId !== undefined && e.tradeId !== null) ? 'live_trade_tape' : 'quote_volume_proxy',
    caveat: events.some(e => e.tradeId !== undefined && e.tradeId !== null) ? 'Flow is based on live trade events with buy/sell side inference from bid/ask.' : 'Flow is inferred from live price direction and incremental cumulative volume.',
  };
}

export function getFlow(symbol, options = {}) {
  const s = normalizeSymbol(symbol);
  const state = getState(s);
  const now = Date.now();
  state.events = prune(state.events, now, options.windowMs ?? DEFAULTS.windowMs);
  return summarizeFlow(s, state.lastPrice, state.events, now, { ...DEFAULTS, ...options });
}

export function resetFlow() {
  states.clear();
}
