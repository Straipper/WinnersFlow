import { evaluateSetup } from './setupEngine.js';
import { confirm5mSetup } from './confirmEngine.js';
import { getQuote } from './marketData.js';

const norm = s => String(s || '').trim().toUpperCase();
const num = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;

function condition(label, ok, detail) {
  return { label, status: ok ? 'confirmed' : 'pending', detail };
}

function buildNarrative({ symbol, setup, confirm, price }) {
  const parts = [];
  const flow = setup.flow?.side;
  if (flow === 'buy') parts.push('Buying flow is present');
  else if (flow === 'sell') parts.push('Selling flow is present');
  else parts.push('Flow is currently neutral');

  if (setup.levels?.nearestSupport) {
    parts.push(`nearest support is ${setup.levels.nearestSupport.price}`);
  }
  if (setup.levels?.nearestResistance) {
    parts.push(`nearest resistance is ${setup.levels.nearestResistance.price}`);
  }

  if (confirm.fiveMinuteCloseConfirmed) {
    parts.push('the latest closed 5M candle has confirmed price action');
  } else {
    parts.push('the 5M confirmation gate is still waiting for qualifying price action');
  }

  if (confirm.confirmed) {
    parts.push(confirm.direction === 'long'
      ? 'all required long conditions are confirmed'
      : 'all required short conditions are confirmed');
  }

  return `${symbol}: ${parts.join('; ')}. Current price: ${price ?? 'n/a'}.`;
}

export async function analyzeSofia(symbol, options = {}) {
  const s = norm(symbol);
  if (!s) throw new Error('symbol is required');

  const [setup, confirmation, quote] = await Promise.all([
    evaluateSetup(s, options),
    confirm5mSetup(s, { outputsize: options.outputsize }),
    getQuote(s)
  ]);

  const price = num(quote?.price, setup.price);
  const direction = confirmation.direction || setup.direction || null;
  const setupConfirmed = Boolean(setup.confirmed);
  const fiveMinuteConfirmed = Boolean(confirmation.fiveMinuteCloseConfirmed);
  const finalConfirmed = Boolean(confirmation.confirmed);

  const conditions = [
    condition('Flow', setup.flow?.side === 'buy' || setup.flow?.side === 'sell', setup.flow?.side || 'neutral'),
    condition('Level', Boolean(setup.levels?.nearestSupport || setup.levels?.nearestResistance), 'support/resistance identified'),
    condition('Setup', setupConfirmed, setupConfirmed ? `score ${setup.score}` : `score ${setup.score || 0}`),
    condition('5M close', fiveMinuteConfirmed, confirmation.state),
    condition('Final confirmation', finalConfirmed, finalConfirmed ? confirmation.state : 'not confirmed')
  ];

  let status = 'WATCHING';
  if (finalConfirmed) status = 'CONFIRMED';
  else if (setupConfirmed) status = 'SETUP_READY_WAITING_5M';
  else if (setup.state === 'FLOW_DETECTED') status = 'FLOW_DETECTED';
  else if (setup.state === 'LEVEL_IDENTIFIED') status = 'LEVEL_IDENTIFIED';

  const explanation = buildNarrative({ symbol: s, setup, confirm: confirmation, price });

  return {
    symbol: s,
    timestamp: new Date().toISOString(),
    status,
    direction,
    price,
    setupScore: num(setup.score, 0),
    explanation,
    conditions,
    setup: {
      state: setup.state,
      confirmed: setupConfirmed,
      reasons: setup.reasons || [],
      levels: setup.levels,
      flow: setup.flow,
      indicators: setup.indicators
    },
    fiveMinute: {
      state: confirmation.state,
      confirmed: Boolean(confirmation.confirmed),
      priceActionConfirmed: Boolean(confirmation.priceActionConfirmed),
      fiveMinuteCloseConfirmed: fiveMinuteConfirmed,
      conditions: confirmation.conditions || {}
    },
    nextAction: finalConfirmed
      ? (direction === 'long' ? 'BUY_NOW_SETUP_CONFIRMED' : 'SELL_SETUP_CONFIRMED')
      : (setupConfirmed ? 'WAIT_FOR_5M_CONFIRM' : 'WAIT_FOR_SETUP'),
    source: 'dt_flow_sofia_v1'
  };
}

export async function analyzeSofiaBatch(symbols = [], options = {}) {
  const selected = [...new Set(symbols.map(norm).filter(Boolean))].slice(0, 25);
  const results = await Promise.allSettled(selected.map(s => analyzeSofia(s, options)));
  return {
    timestamp: new Date().toISOString(),
    results: results.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { symbol: selected[i], status: 'ERROR', error: r.reason?.message || 'SOFIA analysis error' }),
    source: 'dt_flow_sofia_v1'
  };
}
