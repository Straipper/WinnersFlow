import { decorateQuote } from './marketSession.js';
const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];
const ALPACA_BASE_URL = 'https://data.alpaca.markets';
const BASE_URL = 'https://api.twelvedata.com';

const mockBases = { NVDA:184.10, AAPL:255.20, MSFT:510.40, AMD:166.30, TSLA:447.80, META:744.60 };

function config() {
  return {
    provider: (process.env.MARKET_DATA_PROVIDER || 'mock').toLowerCase(),
    apiKey: process.env.MARKET_DATA_API_KEY || '',
    stockflowKey: process.env.STOCKFLOW_API_KEY || '',
    baseUrl: process.env.MARKET_DATA_BASE_URL || BASE_URL,
    prepost: process.env.MARKET_DATA_PREPOST === 'true',
    alpacaKey: process.env.ALPACA_API_KEY || '',
    alpacaSecret: process.env.ALPACA_API_SECRET || '',
    alpacaBaseUrl: process.env.ALPACA_DATA_BASE_URL || ALPACA_BASE_URL,
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

async function alpacaData(path, params = {}) {
  const { alpacaKey, alpacaSecret, alpacaBaseUrl } = config();
  if (!alpacaKey || !alpacaSecret) throw new Error("ALPACA_API_KEY and ALPACA_API_SECRET are required");
  const url = new URL(`${alpacaBaseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "APCA-API-KEY-ID": alpacaKey,
      "APCA-API-SECRET-KEY": alpacaSecret
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Alpaca market data HTTP ${response.status}: ${data.message || "provider error"}`);
  return data;
}

async function alpacaQuote(symbol) {
  const s = normalizeSymbol(symbol);
  const data = await alpacaData("/v2/stocks/bars/latest", { symbols: s, feed: "iex" });
  const bar = data.bars?.[s];
  const price = Number(bar?.c);
  return {
    symbol: s,
    name: s,
    exchange: "IEX",
    price: Number.isFinite(price) ? price : null,
    open: Number(bar?.o) || null,
    high: Number(bar?.h) || null,
    low: Number(bar?.l) || null,
    close: Number(bar?.c) || null,
    volume: Number(bar?.v) || 0,
    change: 0,
    changePct: 0,
    currency: "USD",
    timestamp: bar?.t || new Date().toISOString(),
    marketOpen: true,
    extendedPrice: null,
    source: "alpaca_iex"
  };
}


async function stockflowData(path, params = {}) {
  const { stockflowKey } = config();
  if (!stockflowKey) throw new Error('STOCKFLOW_API_KEY is required when MARKET_DATA_PROVIDER=stockflow');

  const url = new URL(`https://api.tradier.com/v1${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${stockflowKey}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Stockflow (Tradier) HTTP ${response.status}: ${data?.fault?.faultstring || data?.errors?.error || 'provider error'}`);
  }
  return data;
}

async function stockflowQuote(symbol) {
  const s = normalizeSymbol(symbol);
  const data = await stockflowData('/markets/quotes', { symbols: s });
  let quote = data.quotes?.quote;

  if (Array.isArray(quote)) {
    quote = quote.find(item => normalizeSymbol(item.symbol) === s);
  }
  if (!quote?.symbol) throw new Error(`Stockflow returned no quote for ${s}`);

  const numberOrNull = value =>
    value == null || value === '' ? null : Number(value);

  const price = numberOrNull(quote.last ?? quote.close ?? quote.bid ?? quote.ask);
  const rawDate = quote.trade_date ?? quote.date ?? quote.biddate;
  let timestamp = new Date().toISOString();

  if (rawDate != null) {
    const numericDate = Number(rawDate);
    const parsedDate = Number.isFinite(numericDate) && String(rawDate).trim() !== ''
      ? new Date(numericDate)
      : new Date(rawDate);
    if (!Number.isNaN(parsedDate.getTime())) timestamp = parsedDate.toISOString();
  }

  return {
    symbol: s,
    name: quote.description ?? s,
    exchange: quote.exch ?? quote.exchange ?? null,
    price: Number.isFinite(price) ? price : null,
    open: numberOrNull(quote.open),
    high: numberOrNull(quote.high),
    low: numberOrNull(quote.low),
    close: numberOrNull(quote.close ?? quote.last),
    volume: numberOrNull(quote.volume) ?? 0,
    change: numberOrNull(quote.change) ?? 0,
    changePct: numberOrNull(quote.change_percentage) ?? 0,
    currency: 'USD',
    timestamp,
    extendedPrice: null,
    source: 'stockflow_tradier'
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
  const { provider, apiKey, stockflowKey, alpacaKey, alpacaSecret } = config();
  const configured = provider === 'twelve_data' ? Boolean(apiKey) : provider === 'stockflow' ? Boolean(stockflowKey) : provider === 'alpaca' ? Boolean(alpacaKey && alpacaSecret) : true;
  return { provider, configured };
}

export async function getQuote(symbol) {
  const s = normalizeSymbol(symbol);
  if (config().provider === 'stockflow') return decorateQuote(await stockflowQuote(s));
  if (config().provider === 'alpaca') return decorateQuote(await alpacaQuote(s));
  if (config().provider !== 'twelve_data') return decorateQuote(mockQuote(s));
  const data = await twelveData('/quote', { symbol: s, prepost: config().prepost });
  return decorateQuote(parseQuote(data));
}

export async function getQuotes(symbols = DEFAULT_SYMBOLS) {
  return Promise.all(symbols.map(getQuote));
}

export async function getCandles(symbol, interval = '5min', outputsize = 200) {
  const s = normalizeSymbol(symbol);
  if (config().provider === 'stockflow') {
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const formatDate = date => date.toISOString().slice(0, 16).replace('T', ' ');
    const data = await stockflowData('/markets/timesales', { symbol: s, interval, start: formatDate(start), end: formatDate(now) });
    let rows = data.series?.data ?? data.series ?? [];
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    return rows.map(row => {
      const close = Number(row.close ?? row.price ?? row.last);
      const dateValue = row.datetime ?? row.time ?? row.timestamp;
      let datetime = new Date().toISOString();
      if (dateValue != null) {
        const numericDate = Number(dateValue);
        const parsedDate = Number.isFinite(numericDate) && String(dateValue).trim() !== '' ? new Date(numericDate) : new Date(dateValue);
        if (!Number.isNaN(parsedDate.getTime())) datetime = parsedDate.toISOString();
      }
      return { datetime, open: Number(row.open ?? close), high: Number(row.high ?? close), low: Number(row.low ?? close), close, volume: Number(row.volume ?? row.size) || 0 };
    }).filter(row => Number.isFinite(row.close));
  }
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
