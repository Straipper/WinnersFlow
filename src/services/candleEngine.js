const INTERVAL_MS = {
  '1min': 60_000,
  '5min': 300_000,
  '15min': 900_000,
  '30min': 1_800_000,
  '45min': 2_700_000,
  '1h': 3_600_000,
};

const states = new Map();

function key(symbol, interval) {
  return `${symbol}:${interval}`;
}

function floorTime(timestamp, interval) {
  const ms = INTERVAL_MS[interval] ?? INTERVAL_MS['5min'];
  const t = new Date(timestamp).getTime();
  return Math.floor(t / ms) * ms;
}

export function updateCandle({ symbol, price, timestamp, dayVolume = 0, interval = '5min' }) {
  const s = String(symbol || '').toUpperCase();
  const p = Number(price);
  if (!s || !Number.isFinite(p)) return null;

  const startMs = floorTime(timestamp || new Date().toISOString(), interval);
  const k = key(s, interval);
  const previous = states.get(k);
  let volume = 0;

  if (Number.isFinite(Number(dayVolume))) {
    const currentDayVolume = Number(dayVolume);
    if (previous && currentDayVolume >= previous.dayVolume) {
      volume = currentDayVolume - previous.dayVolume;
    }
    states.set(k, { ...(previous || {}), dayVolume: currentDayVolume });
  }

  if (!previous || previous.startMs !== startMs) {
    const candle = {
      datetime: new Date(startMs).toISOString(),
      open: p,
      high: p,
      low: p,
      close: p,
      volume,
      complete: false,
    };
    states.set(k, { ...candle, startMs, dayVolume: Number(dayVolume) || 0 });
    return candle;
  }

  const candle = {
    datetime: previous.datetime,
    open: previous.open,
    high: Math.max(previous.high, p),
    low: Math.min(previous.low, p),
    close: p,
    volume: Number(previous.volume || 0) + volume,
    complete: false,
  };
  states.set(k, { ...candle, startMs, dayVolume: Number(dayVolume) || previous.dayVolume || 0 });
  return candle;
}

export function clearCandleState() {
  states.clear();
}
