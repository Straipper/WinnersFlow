import { decorateQuote } from './marketSession.js';

const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];

function config() {
  return {
    provider: (process.env.MARKET_DATA_PROVIDER || 'stockflow').toLowerCase(),
    stockflowKey: process.env.STOCKFLOW_API_KEY || '',
  };
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
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
  let timestamp = null;

  if (rawDate != null) {
    const numericDate = Number(rawDate);
    const isNumericDate = Number.isFinite(numericDate) && String(rawDate).trim() !== '';
    const parsedDate = isNumericDate
      ? new Date(Math.abs(numericDate) < 1e12 ? numericDate * 1000 : numericDate)
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

export function getProvider() {
  const { provider, stockflowKey } = config();
  return { provider, configured: provider === 'stockflow' && Boolean(stockflowKey) };
}

export async function getQuote(symbol) {
  if (config().provider !== 'stockflow') {
    throw new Error('Only Tradier is supported for stock data.');
  }
  if (!config().stockflowKey) {
    throw new Error('STOCKFLOW_API_KEY is required for Tradier stock data.');
  }
  return decorateQuote(await stockflowQuote(normalizeSymbol(symbol)));
}

export async function getQuotes(symbols = DEFAULT_SYMBOLS) {
  return Promise.all(symbols.map(getQuote));
}

export async function getCandles(symbol, interval = '5min', outputsize = 200) {
  if (config().provider !== 'stockflow') {
    throw new Error('Only Tradier is supported for stock data.');
  }
  if (!config().stockflowKey) {
    throw new Error('STOCKFLOW_API_KEY is required for Tradier stock data.');
  }
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
      const numericDate = Number(dateValue);
      const isNumericDate = dateValue != null && String(dateValue).trim() !== '' && Number.isFinite(numericDate);
      const parsedDate = dateValue == null || String(dateValue).trim() === ''
        ? new Date(NaN)
        : isNumericDate
          ? new Date(Math.abs(numericDate) < 1e12 ? numericDate * 1000 : numericDate)
          : new Date(dateValue);
      if (!Number.isFinite(close) || Number.isNaN(parsedDate.getTime())) return null;
      const datetime = parsedDate.toISOString();
      return { datetime, open: Number(row.open ?? close), high: Number(row.high ?? close), low: Number(row.low ?? close), close, volume: Number(row.volume ?? row.size) || 0 };
    }).filter(Boolean)
      .slice(-Math.max(1, Math.min(Number(outputsize) || 200, 5000)));
  }
  throw new Error(`Tradier returned no candle data for ${s}.`);
}
