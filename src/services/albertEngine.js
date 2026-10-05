import { analyzeSofia } from './sofiaEngine.js';

const norm = s => String(s || '').trim().toUpperCase();

function condition(label, confirmed, detail) {
  return { label, confirmed: Boolean(confirmed), status: confirmed ? 'CONFIRMED' : 'NOT_CONFIRMED', detail };
}


function buildExitPlan({ price, direction, levels, atr }) {
  const entry = Number(price);
  const a = Number(atr);
  if (!Number.isFinite(entry) || !direction) return null;

  const support = (levels?.support || [])
    .filter(x => Number.isFinite(Number(x.price)) && Number(x.price) < entry)
    .sort((x, y) => Number(y.price) - Number(x.price));
  const resistance = (levels?.resistance || [])
    .filter(x => Number.isFinite(Number(x.price)) && Number(x.price) > entry)
    .sort((x, y) => Number(x.price) - Number(y.price));

  const buffer = Number.isFinite(a) && a > 0 ? a * 0.20 : entry * 0.002;
  let stop = null;
  let target = null;
  let targetLevel = null;

  if (direction === 'long') {
    const s = support[0];
    stop = s ? Number(s.price) - buffer : entry - (Number.isFinite(a) && a > 0 ? a * 1.5 : entry * 0.01);
    targetLevel = resistance[0] || null;
    target = targetLevel ? Number(targetLevel.price) - buffer * 0.5 : null;
  } else if (direction === 'short') {
    const r = resistance[0];
    stop = r ? Number(r.price) + buffer : entry + (Number.isFinite(a) && a > 0 ? a * 1.5 : entry * 0.01);
    targetLevel = support[0] || null;
    target = targetLevel ? Number(targetLevel.price) + buffer * 0.5 : null;
  }

  if (!Number.isFinite(stop) || stop <= 0) return null;
  const risk = Math.abs(entry - stop);

  // If there is no opposing structural level, use a 2R fallback rather than inventing a price level.
  const fallbackTarget = direction === 'long' ? entry + 2 * risk : entry - 2 * risk;
  if (!Number.isFinite(target) || (direction === 'long' ? target <= entry : target >= entry)) target = fallbackTarget;

  const reward = direction === 'long' ? target - entry : entry - target;
  const rr = risk > 0 ? reward / risk : null;
  const quality = rr == null ? 'UNAVAILABLE' : rr >= 1.5 ? 'ACCEPTABLE_RR' : 'LOW_REWARD';

  return {
    entryPrice: Number(entry.toFixed(6)),
    stopLoss: Number(stop.toFixed(6)),
    targetPrice: Number(target.toFixed(6)),
    riskPerShare: Number(risk.toFixed(6)),
    rewardPerShare: Number(Math.max(0, reward).toFixed(6)),
    rewardRisk: rr == null ? null : Number(rr.toFixed(2)),
    targetBasis: targetLevel ? 'next_opposing_structure_level' : '2R_fallback',
    stopBasis: support[0] && direction === 'long' || resistance[0] && direction === 'short'
      ? 'structure_level_plus_ATR_buffer'
      : 'ATR_fallback',
    targetLevel: targetLevel ? { price: Number(targetLevel.price), strength: targetLevel.strength ?? null, touches: targetLevel.touches ?? null } : null,
    quality,
    note: 'Suggested exit levels are rule-based planning references, not guarantees.'
  };
}

export async function evaluateAlbert(symbol, options = {}) {
  const s = norm(symbol);
  if (!s) throw new Error('symbol is required');

  const sofia = await analyzeSofia(s, options);
  const setup = sofia.setup || {};
  const five = sofia.fiveMinute || {};
  const setupConditions = five.conditions || {};

  const flowConfirmed = setupConditions.flowConfirmed === true;
  const levelBreakConfirmed = setupConditions.levelBreakConfirmed === true;
  const trendConfirmed = setupConditions.trendConfirmed === true;
  const momentumConfirmed = setupConditions.momentumConfirmed === true;
  const fiveMinuteCloseConfirmed = five.fiveMinuteCloseConfirmed === true;
  const setupConfirmed = setup.confirmed === true;

  // ALBERT is deliberately fail-closed: every required gate must be true.
  const allConfirmed = Boolean(
    setupConfirmed &&
    flowConfirmed &&
    levelBreakConfirmed &&
    trendConfirmed &&
    momentumConfirmed &&
    fiveMinuteCloseConfirmed &&
    five.confirmed === true
  );

  const direction = allConfirmed ? (five.direction || sofia.direction || null) : null;
  const confirmed = allConfirmed;
  const exitPlan = confirmed ? buildExitPlan({
    price: sofia.price,
    direction,
    levels: sofia.setup?.levels,
    atr: sofia.setup?.indicators?.atr14
  }) : null;

  const conditions = [
    condition('Setup', setupConfirmed, setupConfirmed ? `score ${sofia.setupScore}` : `setup score ${sofia.setupScore || 0} is not sufficient`),
    condition('Flow', flowConfirmed, flowConfirmed ? 'required flow condition confirmed' : 'required flow condition not confirmed'),
    condition('Level / breakout', levelBreakConfirmed, levelBreakConfirmed ? '5M price action broke the relevant level' : 'required level break is not confirmed'),
    condition('Trend', trendConfirmed, trendConfirmed ? 'EMA trend condition confirmed' : 'EMA trend condition not confirmed'),
    condition('Momentum', momentumConfirmed, momentumConfirmed ? 'RSI/MACD momentum condition confirmed' : 'RSI/MACD momentum condition not confirmed'),
    condition('5M close', fiveMinuteCloseConfirmed, fiveMinuteCloseConfirmed ? 'qualifying 5M candle close confirmed' : 'qualifying 5M candle close not confirmed'),
  ];

  let signal = 'NOT_CONFIRMED';
  let message = 'NOT CONFIRMED';
  if (confirmed && direction === 'long') {
    signal = 'BUY_NOW_SETUP_CONFIRMED';
    message = 'BUY NOW | SETUP CONFIRMED';
  } else if (confirmed && direction === 'short') {
    signal = 'SELL_NOW_SETUP_CONFIRMED';
    message = 'SELL NOW | SETUP CONFIRMED';
  }

  const missing = conditions.filter(c => !c.confirmed).map(c => c.label);

  return {
    symbol: s,
    timestamp: new Date().toISOString(),
    confirmed,
    direction,
    signal,
    message,
    status: confirmed ? 'CONFIRMED' : 'NOT_CONFIRMED',
    price: sofia.price ?? null,
    setupScore: sofia.setupScore ?? 0,
    conditions,
    missingConditions: missing,
    sofia,
    source: 'dt_flow_albert_v1',
  };
}
