import { decorateQuote } from './marketSession.js';
const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];
const BASE_URL = 'https://api.twelvedata.com';

const mockBases = { NVDA:184.10, AAPL:255.20, MSFT:510.40, AMD:166.30, TSLA:447.80, META:744.60 };

function config() {
  return {
    provider: (process.env.MARKET_DATA_PROVIDER || 'mock').toLowerCase(),
    apiKey: process.env.MARKET_DATA_API_KEY || '',
    baseUrl: process.env.MARKET_DATA_BASE_URL || BASE_URL,
    prepost: process.env.MARKET_DATA_PREPOST === 'true',
  };
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function mockQuote(symbol) {
  const s = normalizeSymbol(symbol);
  const base = mockBases[s] ?? 100;
  return {
    symbol: s,
    name: s,
    exchange: 'NASDAQ',
    price: Number(base.toFixed(2)),
    open: Number(base.toFixed(2)),
    high: Number(base.toFixed(2)),
    low: Number(base.toFixed(2)),
    close: Number(base.toFixed(2)),
    volume: 0,
    change: 0,
    changePct: 0,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    marketOpen: false,
    source: 'mock',
  };
}

async function twelveData(path, params = {}) {
  const { apiKey, baseUrl } = config();
  if (!apiKey) throw new Error('MARKET_DATA_API_KEY is required when MARKET_DATA_PROVIDER=twelve_data');

  const url = new URL(`${baseUrl}${path}`);
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
  if (data.status === 'error' || data.code) throw new Error(data.message || 'Market data provider error');
  return data;
}

function parseQuote(data) {
  const price = Number(data.close ?? data.price);
  return {
    symbol: normalizeSymbol(data.symbol),
    name: data.name ?? normalizeSymbol(data.symbol),
    exchange: data.exchange ?? null,
    price: Number.isFinite(price) ? price : null,
    open: Number(data.open) || null,
    high: Number(data.high) || null,
    low: Number(data.low) || null,
    close: Number(data.close) || null,
    volume: Number(data.volume) || 0,
    change: Number(data.change) || 0,
    changePct: Number(data.percent_change) || 0,
    currency: data.currency ?? 'USD',
    timestamp: data.timestamp ? new Date(Number(data.timestamp) * 1000).toISOString() : new Date().toISOString(),
    marketOpen: Boolean(data.is_market_open),
    extendedPrice: data.extended_price ? Number(data.extended_price) : null,
    source: 'twelve_data',
  };
}

export function getProvider() {
  const { provider, apiKey } = config();
  return { provider, configured: provider !== 'twelve_data' || Boolean(apiKey) };
}

export async function getQuote(symbol) {
  const s = normalizeSymbol(symbol);
  if (config().provider !== 'twelve_data') return decorateQuote(mockQuote(s));
  const data = await twelveData('/quote', { symbol: s, prepost: config().prepost });
  return decorateQuote(parseQuote(data));
}

export async function getQuotes(symbols = DEFAULT_SYMBOLS) {
  return Promise.all(symbols.map(getQuote));
}

export async function getCandles(symbol, interval = '5min', outputsize = 200) {
  const s = normalizeSymbol(symbol);
  if (config().provider !== 'twelve_data') {
    const q = mockQuote(s);
    const now = Date.now();
    const step = interval === '1min' ? 60000 : interval === '15min' ? 900000 : 300000;
    return Array.from({ length: Math.min(Number(outputsize) || 200, 200) }, (_, i) => ({
      datetime: new Date(now - (199 - i) * step).toISOString(),
      open: q.price,
      high: q.price,
      low: q.price,
      close: q.price,
      volume: 0,
    }));
  }

  const data = await twelveData('/time_series', {
    symbol: s,
    interval,
    outputsize: Math.min(Number(outputsize) || 200, 5000),
    prepost: config().prepost,
  });

  return (data.values || []).slice().reverse().map(row => ({
    datetime: row.datetime,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume) || 0,
  }));
}
