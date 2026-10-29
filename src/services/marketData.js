import { isFutureMarketTimestamp } from './marketTimestamp.js';
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

function formatTradierDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function parseTradierDate(value) {
  if (typeof value !== 'string') return new Date(value);
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);

  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/
  );
  if (!match) return new Date(value);

  const [, y, mo, d, h, mi, sec = '0', fraction = ''] = match;
  const ms = Number((fraction + '000').slice(0, 3));
  const wallTime = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms);
  let guess = wallTime;

  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second, ms
    );
    guess = wallTime - (representedAsUtc - guess);
  }
  return new Date(guess);
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
    changePct: numberOrNull(quote.change_percentage),
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

export function aggregateCandles(parsed, interval, sourceInterval, symbol = 'UNKNOWN') {
  let candles;
  const intervalMs = {
    '1min': 60000, '5min': 300000, '15min': 900000,
    '30min': 1800000, '45min': 2700000, '1h': 3600000,
    '2h': 7200000, '4h': 14400000, '8h': 28800000,
    '1day': 86400000, '1week': 604800000
  }[interval];

  if (parsed.length && parsed.every(row => row._ohlc) && sourceInterval === interval) {
    candles = parsed.map(({ _time, _ohlc, ...row }) => row);
  } else {
    if (!intervalMs || parsed.some(row => row._ohlc && !row._time)) {
      throw new Error(`Tradier returned incomplete OHLC data for ${symbol}.`);
    }

    const buckets = new Map();
    const sessionAlignedIntervals = ['30min', '45min', '1h', '2h', '4h', '8h'];
    const nyFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    for (const row of parsed) {
      let bucketTime = Math.floor(row._time / intervalMs) * intervalMs;

      if (sessionAlignedIntervals.includes(interval)) {
        const parts = Object.fromEntries(
          nyFormatter.formatToParts(new Date(row._time))
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
        );
        const hour = Number(parts.hour);
        const minute = Number(parts.minute);
        const localMinutes = hour * 60 + minute;

        if (localMinutes >= 960 && localMinutes < 1200) {
          const year = Number(parts.year);
          const month = Number(parts.month);
          const day = Number(parts.day);
          const utcMinute = Math.floor(row._time / 60000) * 60000;
          const localWallTime = Date.UTC(year, month - 1, day, hour, minute);
          const offsetMs = localWallTime - utcMinute;
          const sessionAnchor = Date.UTC(year, month - 1, day, 16, 0) - offsetMs;
          bucketTime = sessionAnchor
            + Math.floor((row._time - sessionAnchor) / intervalMs) * intervalMs;
        } else if (localMinutes >= 570 && localMinutes < 960) {
          const year = Number(parts.year);
          const month = Number(parts.month);
          const day = Number(parts.day);
          const utcMinute = Math.floor(row._time / 60000) * 60000;
          const localWallTime = Date.UTC(year, month - 1, day, hour, minute);
          const offsetMs = localWallTime - utcMinute;
          const sessionOpen = Date.UTC(year, month - 1, day, 9, 30) - offsetMs;
          const sessionClose = Date.UTC(year, month - 1, day, 16, 0) - offsetMs;
          const regularBucketStart = sessionOpen
            + Math.floor((row._time - sessionOpen) / intervalMs) * intervalMs;
          bucketTime = Math.min(regularBucketStart, sessionClose - intervalMs);
          if (row._time >= sessionClose - intervalMs) {
            bucketTime = sessionOpen
              + Math.floor((row._time - sessionOpen) / intervalMs) * intervalMs;
            if (bucketTime + intervalMs > sessionClose) {
              bucketTime = sessionOpen
                + Math.floor((sessionClose - sessionOpen - 1) / intervalMs) * intervalMs;
            }
          }
        }
      }

      const key = String(bucketTime);
      const candle = buckets.get(key);

      if (!candle) {
        buckets.set(key, {
          datetime: new Date(bucketTime).toISOString(),
          open: row._ohlc ? row.open : row.price,
          high: row._ohlc ? row.high : row.price,
          low: row._ohlc ? row.low : row.price,
          close: row.close ?? row.price,
          volume: row.volume
        });
      } else {
        candle.high = Math.max(candle.high, row._ohlc ? row.high : row.price);
        candle.low = Math.min(candle.low, row._ohlc ? row.low : row.price);
        candle.close = row.close ?? row.price;
        candle.volume += row.volume;
      }
    }
    candles = [...buckets.values()];
  }

  return candles;
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
    const historyIntervals = { '1day': 'daily', '1week': 'weekly', '1month': 'monthly' };

    if (historyIntervals[interval]) {
      const daysPerCandle = { '1day': 2, '1week': 8, '1month': 32 }[interval];
      const lookbackDays = Math.max(30, Math.min(Number(outputsize) || 200, 5000) * daysPerCandle);
      const historyStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const historyData = await stockflowData('/markets/history', {
        symbol: s,
        interval: historyIntervals[interval],
        start: historyStart.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10)
      });
      let historyRows = historyData.history?.day ?? [];
      if (!Array.isArray(historyRows)) historyRows = historyRows ? [historyRows] : [];

      return historyRows.map(row => {
        const close = Number(row.close);
        const open = Number(row.open);
        const high = Number(row.high);
        const low = Number(row.low);
        const date = row.date;
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const parsedDate = new Date(`${date}T00:00:00.000Z`);
        if (
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().slice(0, 10) !== date ||
            isFutureMarketTimestamp(parsedDate.getTime(), now.getTime())
          ) return null;
        if (open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
            high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
        return {
          datetime: parsedDate.toISOString(),
          open, high, low, close,
          volume: Number(row.volume) || 0
        };
      }).filter(Boolean)
        .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
        .slice(-Math.max(1, Math.min(Number(outputsize) || 200, 5000)));
    }

    const sourceInterval = ['30min', '45min', '1h', '2h', '4h', '8h'].includes(interval) ? '15min' : interval;
    const requestedCandles = Math.max(1, Math.min(Number(outputsize) || 200, 5000));
    const candleMs = {
      '1min': 60000, '5min': 300000, '15min': 900000,
      '30min': 1800000, '45min': 2700000, '1h': 3600000,
      '2h': 7200000, '4h': 14400000, '8h': 28800000
    }[interval] || 300000;
    const maxLookbackDays = sourceInterval === '1min' ? 10 : 18;
    const estimatedDays = Math.ceil(requestedCandles * candleMs / (6.5 * 60 * 60 * 1000) * 1.7);
    const lookbackDays = Math.max(2, Math.min(maxLookbackDays, estimatedDays));
    const intradayStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const data = await stockflowData('/markets/timesales', { symbol: s, interval: sourceInterval, start: formatTradierDate(intradayStart), end: formatTradierDate(now) });
    let rows = data.series?.data ?? data.series ?? [];
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    const parsed = rows.map(row => {
      const dateValue = row.datetime ?? row.time ?? row.timestamp;
      if (dateValue == null || String(dateValue).trim() === '') return null;
      const numericDate = Number(dateValue);
      const isNumericDate = Number.isFinite(numericDate);
      const date = isNumericDate
        ? new Date(Math.abs(numericDate) < 1e12 ? numericDate * 1000 : numericDate)
        : parseTradierDate(String(dateValue));
      if (Number.isNaN(date.getTime())) return null;
      if (isFutureMarketTimestamp(date.getTime(), now.getTime())) return null;

      const close = Number(row.close ?? row.price ?? row.last);
      if (!Number.isFinite(close) || close <= 0) return null;

      const rawVolume = row.volume ?? row.size;
      const volume = rawVolume == null || rawVolume === '' ? 0 : Number(rawVolume);
      if (!Number.isFinite(volume) || volume < 0) return null;

      const hasOHLC = ['open', 'high', 'low'].every(k =>
        row[k] != null && row[k] !== '' && Number.isFinite(Number(row[k]))
      );
      if (hasOHLC) {
        const open = Number(row.open), high = Number(row.high), low = Number(row.low);
        if (open <= 0 || high <= 0 || low <= 0 ||
            high < low || high < Math.max(open, close) ||
            low > Math.min(open, close)) return null;
        return {
          datetime: date.toISOString(), open, high, low, close,
          volume,
          _time: date.getTime(), _ohlc: true
        };
      }

      // Tradier timesales commonly supplies individual trade prices, not OHLC bars.
      return {
        datetime: date.toISOString(), price: close,
        volume,
        _time: date.getTime(), _ohlc: false
      };
    }).filter(Boolean).sort((a, b) => a._time - b._time);

    const candles = aggregateCandles(parsed, interval, sourceInterval, s);
    return candles
      .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))
      .slice(-Math.max(1, Math.min(Number(outputsize) || 200, 5000)));
  }
  throw new Error(`Tradier returned no candle data for ${s}.`);
}
