import { getCandles } from './marketData.js';
import { getFlow } from './flowEngine.js';
import { detectLevels } from './levels.js';
import { calculateIndicators } from './indicators.js';

const DEFAULTS = {
  interval: '5min', outputsize: 220,
  flowWindowMs: 5 * 60_000,
  flowThreshold: 0.15,
  levelDistancePct: 0.012,
  minRsi: 45, maxRsi: 72,
  minScore: 70,
};

const n = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;
const pct = (a,b) => b ? Math.abs(a-b)/b : Infinity;
const norm = s => String(s || '').trim().toUpperCase();

export async function evaluateSetup(symbol, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const s = norm(symbol);
  const candles = await getCandles(s, cfg.interval, cfg.outputsize);
  const rows = calculateIndicators(candles);
  const current = rows.at(-1);
  const previous = rows.at(-2);
  if (!current) return { symbol:s, confirmed:false, state:'INSUFFICIENT_DATA', score:0 };

  const levels = detectLevels(candles, {});
  const flow = getFlow(s, { windowMs: cfg.flowWindowMs });
  const ind = current.indicators || {};
  const price = n(current.close, 0);
  const support = levels.nearestSupport;
  const resistance = levels.nearestResistance;

  const nearSupport = !!support && pct(price, support.price) <= cfg.levelDistancePct;
  const nearResistance = !!resistance && pct(price, resistance.price) <= cfg.levelDistancePct;
  const bullishFlow = flow.side === 'buy' && n(flow.pressure,0) >= cfg.flowThreshold;
  const bearishFlow = flow.side === 'sell' && n(flow.pressure,0) <= -cfg.flowThreshold;
  const trendBull = n(ind.ema9) !== null && n(ind.ema21) !== null && ind.ema9 > ind.ema21;
  const trendBear = n(ind.ema9) !== null && n(ind.ema21) !== null && ind.ema9 < ind.ema21;
  const momentumBull = n(ind.rsi14) !== null && ind.rsi14 >= cfg.minRsi && ind.rsi14 <= cfg.maxRsi && n(ind.macdHistogram) !== null && ind.macdHistogram > 0;
  const momentumBear = n(ind.rsi14) !== null && ind.rsi14 <= (100-cfg.minRsi) && n(ind.macdHistogram) !== null && ind.macdHistogram < 0;
  const breakout = !!resistance && price > resistance.price && previous && previous.close <= resistance.price;
  const breakdown = !!support && price < support.price && previous && previous.close >= support.price;

  let score = 0;
  const reasons = [];
  if (nearSupport) { score += 25; reasons.push('price_near_support'); }
  if (nearResistance) { score += 20; reasons.push('price_near_resistance'); }
  if (bullishFlow) { score += 30; reasons.push('bullish_flow'); }
  if (bearishFlow) { score += 30; reasons.push('bearish_flow'); }
  if (trendBull) { score += 10; reasons.push('ema_bullish'); }
  if (trendBear) { score += 10; reasons.push('ema_bearish'); }
  if (momentumBull) { score += 15; reasons.push('momentum_bullish'); }
  if (momentumBear) { score += 15; reasons.push('momentum_bearish'); }
  if (breakout) { score += 25; reasons.push('resistance_breakout'); }
  if (breakdown) { score += 25; reasons.push('support_breakdown'); }

  const longSetup = bullishFlow && (nearSupport || breakout) && trendBull && momentumBull;
  const shortSetup = bearishFlow && (nearResistance || breakdown) && trendBear && momentumBear;
  const confirmed = (longSetup || shortSetup) && score >= cfg.minScore;

  let state = 'WAITING';
  if (confirmed && longSetup) state = 'BUY_SETUP_CONFIRMED';
  else if (confirmed && shortSetup) state = 'SELL_SETUP_CONFIRMED';
  else if (bullishFlow || bearishFlow) state = 'FLOW_DETECTED';
  else if (nearSupport || nearResistance) state = 'LEVEL_IDENTIFIED';

  return {
    symbol:s, interval:cfg.interval, timestamp:new Date().toISOString(),
    state, confirmed, direction: confirmed ? (longSetup ? 'long' : 'short') : null,
    score: Math.min(100, score), minScore:cfg.minScore,
    price, currentCandle: current.datetime,
    reasons, levels: { nearestSupport:support, nearestResistance:resistance },
    flow: { side:flow.side, pressure:flow.pressure, deltaVolume:flow.deltaVolume, largeBuys:flow.largeBuys, largeSells:flow.largeSells },
    indicators: ind,
    confirmation: { priceActionConfirmed:false, fiveMinuteCloseConfirmed:false },
    nextStep: confirmed ? 'STEP_12_5M_CONFIRM' : 'WAIT_FOR_5M_PRICE_ACTION',
    source:'dt_flow_setup_engine_v1',
  };
}
