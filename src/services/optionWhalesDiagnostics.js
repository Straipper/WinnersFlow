import {
  getOptionsFlow,
  getDarkPoolPrints,
  getOptionsFlowSessions,
} from './optionWhales.js';

const SAFE_FIELDS = [
  'id', 'event_id', 'ticker', 'symbol',
  'timestamp', 'ts', 'time', 'datetime',
  'occ', 'option_ticker', 'contract', 'contract_symbol',
  'contracts', 'total_contracts', 'contract_count',
  'premium', 'total_premium', 'notional', 'total_notional',
  'direction', 'direction_confidence',
  'order_type', 'trade_type',
  'avg_price', 'avg_bid', 'avg_ask',
  'session', 'latest', 'older_than', 'next_cursor',
  'next_page', 'has_more', 'limit',
];

function describe(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.length && depth < 3
        ? describe(value[0], depth + 1)
        : undefined,
    };
  }
  if (typeof value !== 'object') return { type: typeof value };

  const fields = {};
  for (const [name, item] of Object.entries(value)) {
    fields[name] = describe(item, depth + 1);
  }
  return { type: 'object', fields };
}

function safeValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string') return value.slice(0, 160);
    return value;
  }
  return undefined;
}

function safeSample(value, depth = 0) {
  if (depth > 4 || value == null || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    return value.slice(0, 3).map(item => safeSample(item, depth + 1));
  }

  const out = {};
  for (const [name, item] of Object.entries(value)) {
    if (SAFE_FIELDS.includes(name)) {
      const scalar = safeValue(item);
      if (scalar !== undefined) out[name] = scalar;
      else if (item && typeof item === 'object') {
        out[name] = safeSample(item, depth + 1);
      }
    } else if (['data', 'result', 'results', 'response', 'rows', 'ticks',
      'orders', 'options_flow', 'flow', 'order'].includes(name)) {
      out[name] = safeSample(item, depth + 1);
    }
  }
  return out;
}

export async function diagnoseOptionWhales() {
  const results = {};

  for (const [name, request] of [
    ['sessions', () => getOptionsFlowSessions()],
    ['options', () => getOptionsFlow('NVDA', { limit: 3 })],
    ['darkPool', () => getDarkPoolPrints('NVDA', { limit: 3 })],
  ]) {
    try {
      const raw = await request();
      results[name] = {
        ok: true,
        structure: describe(raw),
        sample: safeSample(raw),
      };
    } catch (error) {
      results[name] = {
        ok: false,
        error: String(error?.message || 'Request failed')
          .replace(/((?:key|token|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
          .slice(0, 200),
      };
    }
  }

  return results;
}
