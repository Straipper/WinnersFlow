const DEFAULTS = {
  pivotLeft: 3,
  pivotRight: 3,
  lookback: 200,
  clusterPct: 0.0025,
  minTouches: 2,
  maxLevels: 12,
};

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .map(c => ({
      datetime: c.datetime,
      open: n(c.open, NaN),
      high: n(c.high, NaN),
      low: n(c.low, NaN),
      close: n(c.close, NaN),
      volume: n(c.volume),
    }))
    .filter(c => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
}

function isPivotHigh(candles, i, left, right) {
  const h = candles[i].high;
  for (let j = i - left; j <= i + right; j++) {
    if (j === i || !candles[j]) continue;
    if (candles[j].high > h) return false;
  }
  return true;
}

function isPivotLow(candles, i, left, right) {
  const l = candles[i].low;
  for (let j = i - left; j <= i + right; j++) {
    if (j === i || !candles[j]) continue;
    if (candles[j].low < l) return false;
  }
  return true;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function trueRanges(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const prevClose = i ? candles[i - 1].close : candles[i].close;
    out.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    ));
  }
  return out;
}

function atr(candles, period = 14) {
  const tr = trueRanges(candles);
  return average(tr.slice(-period));
}

function clusterPoints(points, tolerance) {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const point of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(point.price - last.price) > tolerance) {
      clusters.push({ price: point.price, points: [point] });
    } else {
      last.points.push(point);
      last.price = average(last.points.map(p => p.price));
    }
  }
  return clusters;
}

function scoreCluster(cluster, candles, currentPrice) {
  const touches = cluster.points.length;
  const recency = cluster.points.reduce((sum, p) => sum + (p.index / Math.max(1, candles.length - 1)), 0) / touches;
  const role = cluster.points.reduce((sum, p) => sum + (p.type === 'resistance' ? 1 : -1), 0) >= 0 ? 'resistance' : 'support';
  const distancePct = currentPrice ? Math.abs(cluster.price - currentPrice) / currentPrice : 0;
  const proximity = Math.max(0, 1 - Math.min(distancePct / 0.05, 1));
  const strength = Math.min(100, Math.round(25 * Math.min(touches, 4) + 25 * recency + 25 * proximity));
  return { touches, recency, role, distancePct, strength };
}

export function detectLevels(candlesInput, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const candles = normalizeCandles(candlesInput).slice(-cfg.lookback);
  if (candles.length < cfg.pivotLeft + cfg.pivotRight + 3) {
    return { levels: [], support: [], resistance: [], currentPrice: candles.at(-1)?.close ?? null, atr: 0 };
  }

  const currentPrice = candles.at(-1).close;
  const currentAtr = atr(candles);
  const tolerance = Math.max(currentPrice * cfg.clusterPct, currentAtr * 0.35);
  const points = [];

  for (let i = cfg.pivotLeft; i < candles.length - cfg.pivotRight; i++) {
    if (isPivotHigh(candles, i, cfg.pivotLeft, cfg.pivotRight)) {
      points.push({ price: candles[i].high, type: 'resistance', index: i, datetime: candles[i].datetime });
    }
    if (isPivotLow(candles, i, cfg.pivotLeft, cfg.pivotRight)) {
      points.push({ price: candles[i].low, type: 'support', index: i, datetime: candles[i].datetime });
    }
  }

  const clusters = clusterPoints(points, tolerance);
  const levels = clusters
    .map((cluster, idx) => {
      const meta = scoreCluster(cluster, candles, currentPrice);
      const supportPoints = cluster.points.filter(p => p.type === 'support').length;
      const resistancePoints = cluster.points.filter(p => p.type === 'resistance').length;
      const role = supportPoints > resistancePoints ? 'support' : resistancePoints > supportPoints ? 'resistance' : (cluster.price < currentPrice ? 'support' : 'resistance');
      return {
        id: `level-${idx + 1}`,
        price: Number(cluster.price.toFixed(6)),
        type: role,
        strength: meta.strength,
        touches: meta.touches,
        supportTouches: supportPoints,
        resistanceTouches: resistancePoints,
        distancePct: Number((meta.distancePct * 100).toFixed(3)),
        lastTouch: cluster.points.sort((a, b) => b.index - a.index)[0]?.datetime ?? null,
        source: 'swing_pivot_cluster',
      };
    })
    .filter(level => level.touches >= cfg.minTouches)
    .sort((a, b) => b.strength - a.strength);

  const support = levels.filter(l => l.price <= currentPrice).sort((a, b) => b.price - a.price).slice(0, Math.ceil(cfg.maxLevels / 2));
  const resistance = levels.filter(l => l.price >= currentPrice).sort((a, b) => a.price - b.price).slice(0, Math.ceil(cfg.maxLevels / 2));
  const selected = [...support, ...resistance].sort((a, b) => a.price - b.price).slice(0, cfg.maxLevels);

  const nearestSupport = support[0] ?? null;
  const nearestResistance = resistance[0] ?? null;

  return {
    currentPrice,
    atr: Number(currentAtr.toFixed(6)),
    tolerance: Number(tolerance.toFixed(6)),
    lookback: candles.length,
    levels: selected,
    support,
    resistance,
    nearestSupport,
    nearestResistance,
    source: 'real_candles_swing_pivot_cluster',
  };
}
