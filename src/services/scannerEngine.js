import { evaluateSetup } from './setupEngine.js';
import { confirm5mSetup } from './confirmEngine.js';

export const DEFAULT_SCANNER_SYMBOLS = [
  'NVDA','AAPL','MSFT','AMD','TSLA','META','AMZN','GOOGL','NFLX','AVGO',
  'MU','PLTR','COIN','MSTR','SMCI','QCOM','INTC','CRM','ORCL','ADBE'
];

const norm = s => String(s || '').trim().toUpperCase();

function cleanSymbols(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(raw.map(norm).filter(Boolean))].slice(0, 50);
}

function rank(item) {
  const confirmed = item.confirmation?.confirmed ? 1000 : 0;
  const score = Number(item.setup?.score || 0);
  const flow = Math.abs(Number(item.setup?.flow?.pressure || 0)) * 100;
  const level = item.setup?.levels?.nearestSupport || item.setup?.levels?.nearestResistance ? 10 : 0;
  return confirmed + score + flow + level;
}

async function scanOne(symbol, options) {
  const [setup, confirmation] = await Promise.all([
    evaluateSetup(symbol, options),
    confirm5mSetup(symbol, { outputsize: options.outputsize })
  ]);

  const status = confirmation.confirmed
    ? confirmation.state
    : setup.state;

  return {
    symbol: norm(symbol),
    status,
    direction: confirmation.direction || setup.direction || null,
    score: Math.max(Number(setup.score || 0), confirmation.confirmed ? 100 : 0),
    price: confirmation.price ?? setup.price ?? null,
    setup,
    confirmation,
    rank: 0,
    source: 'dt_flow_scanner_v1'
  };
}

export async function scanSymbols(symbols = DEFAULT_SCANNER_SYMBOLS, options = {}) {
  const selected = cleanSymbols(symbols);
  const cfg = {
    interval: '5min',
    outputsize: 220,
    minScore: 50,
    concurrency: 4,
    ...options
  };

  const results = [];
  for (let i = 0; i < selected.length; i += cfg.concurrency) {
    const batch = selected.slice(i, i + cfg.concurrency);
    const settled = await Promise.allSettled(batch.map(symbol => scanOne(symbol, cfg)));
    for (let j = 0; j < settled.length; j++) {
      const item = settled[j];
      if (item.status === 'fulfilled') results.push(item.value);
      else results.push({ symbol: batch[j], status: 'ERROR', direction: null, score: 0, price: null, error: item.reason?.message || 'Scanner error', source: 'dt_flow_scanner_v1' });
    }
  }

  for (const item of results) item.rank = rank(item);
  results.sort((a,b) => b.rank - a.rank || b.score - a.score || a.symbol.localeCompare(b.symbol));

  return {
    timestamp: new Date().toISOString(),
    interval: '5min',
    scanned: results.length,
    confirmed: results.filter(x => x.confirmation?.confirmed).length,
    active: results.filter(x => ['FLOW_DETECTED','LEVEL_IDENTIFIED','BUY_SETUP_CONFIRMED','SELL_SETUP_CONFIRMED','BUY_NOW_SETUP_CONFIRMED','SELL_SETUP_CONFIRMED'].includes(x.status)).length,
    results,
    source: 'dt_flow_scanner_v1'
  };
}
