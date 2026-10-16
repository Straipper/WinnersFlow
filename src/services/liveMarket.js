import WebSocket, { WebSocketServer } from 'ws';
import { getProvider, getQuote, getCandles } from './marketData.js';
import { updateCandle } from './candleEngine.js';
import { processFlowTick } from './flowEngine.js';
import { verifyMarketSocketTicket } from './websocketAuth.js';
import { getMarketSession } from './marketSession.js';

const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];
const DEFAULT_INTERVAL = '5min';
const clients = new Map();
const latestQuotes = new Map();
let upstream = null;
let upstreamSessionId = null;
let upstreamConnecting = false;
let upstreamSymbols = new Set();
function parseTimestampMs(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.abs(n) < 1e12 ? n * 1000 : n;
  }
  return Date.parse(value);
}


function normalizeSymbols(symbols = []) {
  return [...new Set(symbols.map(s => String(s).trim().toUpperCase()).filter(Boolean))].slice(0, 100);
}

function send(client, payload) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}

function broadcast(symbol, payload) {
  for (const c of clients.values()) {
    if (c.symbols.has(symbol)) send(c.ws, payload);
  }
}

function broadcastCandle(symbol, candle, interval = DEFAULT_INTERVAL) {
  for (const c of clients.values()) {
    if (c.symbols.has(symbol) && c.intervals.has(interval)) {
      send(c.ws, { type: 'candle', symbol, interval, data: candle, source: candle.source || 'live_aggregate' });
    }
  }
}

function providerConfig() {
  return {
    provider: getProvider().provider,
    stockflowKey: process.env.STOCKFLOW_API_KEY || "",
  };
}

async function sendHistoricalCandles(client, symbols) {
  for (const symbol of symbols) {
    try {
      const data = await getCandles(symbol, DEFAULT_INTERVAL, 200);
      send(client.ws, {
        type: 'candle_snapshot',
        symbol,
        interval: DEFAULT_INTERVAL,
        data,
        source: "stockflow_tradier_rest",
      });
    } catch (error) {
      send(client.ws, { type: 'error', scope: 'candle_snapshot', symbol, message: error.message });
    }
  }
}

function rebuildSubscriptions() {
  const all = new Set();
  for (const c of clients.values()) {
    for (const symbol of c.symbols) all.add(symbol);
  }
  upstreamSymbols = all;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
  if (upstreamSessionId && all.size) {
    upstream.send(JSON.stringify({
      symbols: [...all],
      filter: ["quote", "timesale"],
      sessionid: upstreamSessionId,
      linebreak: true,
    }));
  }
}

function handleQuote({ symbol, price, volume, tradeSize, tradeId, exchange, tradeSide, timestamp, source }) {
  if (!String(source || "").startsWith("stockflow_tradier_")) return;
  const timestampMs = parseTimestampMs(timestamp);
  if (!Number.isFinite(timestampMs)) return;
  const normalizedTimestamp = new Date(timestampMs).toISOString();
  const normalizedPrice = Number(price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) return;
  const s = String(symbol).toUpperCase();
const quoteBook = latestQuotes.get(s) || {};
const bid = Number(quoteBook.bid) || null;
const ask = Number(quoteBook.ask) || null;

let inferredSide = null;
if (tradeSize > 0) {
  const tradePrice = Number(price);
  if (ask !== null && tradePrice >= ask) inferredSide = 'buy';
  else if (bid !== null && tradePrice <= bid) inferredSide = 'sell';
}
  const quote = {
    type: 'quote',
    symbol: s,
    price: normalizedPrice,
    volume: volume == null ? (Number(quoteBook.volume) || 0) : (Number(volume) || 0),
    timestamp: normalizedTimestamp,
    source,
    market: getMarketSession(new Date(normalizedTimestamp)),
  };
  broadcast(s, quote);

  const candle = updateCandle({
    symbol: s,
    price: quote.price,
    timestamp: quote.timestamp,
    dayVolume: quote.volume,
    interval: DEFAULT_INTERVAL,
  });
  if (candle) broadcastCandle(s, candle, DEFAULT_INTERVAL);

  const flow = processFlowTick({
    symbol: s,
    price: quote.price,
    dayVolume: quote.volume,
    tradeSize,
    tradeId,
    exchange,
    timestamp: quote.timestamp,
    tradeSide: inferredSide,
    source,

  });
  if (flow) {
    for (const c of clients.values()) {
      if (c.symbols.has(s)) send(c.ws, { type: 'flow', symbol: s, data: flow });
    }
  }
}

function connectUpstream() {
  const { provider, stockflowKey } = providerConfig();
  if (provider !== "stockflow" || !stockflowKey) return;
  if (upstream && [WebSocket.OPEN, WebSocket.CONNECTING].includes(upstream.readyState)) return;
  if (upstreamConnecting) return;
  upstreamConnecting = true;

  (async () => {
    try {
      const response = await fetch("https://api.tradier.com/v1/markets/events/session", {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${stockflowKey}` }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.stream?.sessionid || !body.stream?.url) {
        throw new Error(`Tradier streaming session HTTP ${response.status}`);
      }

      upstreamSessionId = body.stream.sessionid;
      upstream = new WebSocket(body.stream.url);
      upstreamConnecting = false;

      upstream.on("open", () => rebuildSubscriptions());
      upstream.on("message", raw => {
        let events;
        try { events = JSON.parse(raw.toString()); } catch { return; }
        if (!Array.isArray(events)) events = [events];

        for (const data of events) {
          if (!data?.symbol) continue;
          const timestampValue = data.date ?? data.biddate ?? data.askdate;
          const timestampMs = parseTimestampMs(timestampValue);
          if (!Number.isFinite(timestampMs)) continue;
          const timestamp = new Date(timestampMs).toISOString();

          if (data.type === "quote") {
            const symbol = String(data.symbol).toUpperCase();
            const bid = Number(data.bid) || null;
            const ask = Number(data.ask) || null;
            const last = Number(data.last) || null;
            const previousQuote = latestQuotes.get(symbol) || {};
            const quoteVolume = Number(data.volume);
            latestQuotes.set(symbol, {
              bid, ask, timestamp,
              volume: Number.isFinite(quoteVolume) && quoteVolume >= 0
                ? quoteVolume
                : (Number(previousQuote.volume) || 0)
            });
            if (last === null || !Number.isFinite(last) || last <= 0) continue;
            broadcast(symbol, {
              type: "quote", symbol, price: last, bid, ask,
              volume: Number(data.volume) || 0,
              timestamp, source: "stockflow_tradier_quote",
              market: getMarketSession(new Date(timestamp))
            });
          } else if (data.type === "timesale") {
            if (
              data.cancel === true || data.cancel === 1 || data.cancel === "true" ||
              data.correction === true || data.correction === 1 || data.correction === "true"
            ) continue;

            const symbol = String(data.symbol).toUpperCase();
            const previousQuote = latestQuotes.get(symbol) || {};
            const bidValue = Number(data.bid);
            const askValue = Number(data.ask);
            latestQuotes.set(symbol, {
              ...previousQuote,
              bid: Number.isFinite(bidValue) && bidValue > 0 ? bidValue : previousQuote.bid,
              ask: Number.isFinite(askValue) && askValue > 0 ? askValue : previousQuote.ask,
              timestamp
            });

            handleQuote({
              symbol,
              price: data.last,
              volume: undefined,
              tradeSize: Number(data.size) || 0,
              tradeId: data.seq,
              exchange: data.exch,
              timestamp,
              source: "stockflow_tradier_timesale"
            });
          }
        }
      });

      upstream.on("close", () => {
        upstream = null;
        upstreamSessionId = null;
        if (clients.size) setTimeout(connectUpstream, 3000);
      });
      upstream.on("error", error => {
        console.error("[Stockflow] streaming socket error:", error.message);
      });
    } catch (error) {
      upstreamConnecting = false;
      upstream = null;
      upstreamSessionId = null;
      console.error("[Stockflow] streaming connection failed:", error.message);
      if (clients.size) setTimeout(connectUpstream, 5000);
    }
  })();
}


export function attachLiveMarket(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/market',
    verifyClient: (info, done) => {
      const requestUrl = new URL(info.req.url, 'http://localhost');
      const ticket = requestUrl.searchParams.get('ticket');
      verifyMarketSocketTicket(ticket).then(auth => {
        if (!auth) return done(false, 401, 'Unauthorized');
        info.req.dtFlowAuth = auth;
        done(true);
      }).catch(() => done(false, 401, 'Unauthorized'));
    },
  });
  wss.on('connection', (ws, req) => {
    const client = { ws, user: req.dtFlowAuth?.user, symbols: new Set(), intervals: new Set([DEFAULT_INTERVAL]) };
    clients.set(ws, client);
    send(ws, { type:'connected', channel:'market', provider:getProvider() });

    ws.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { send(ws,{type:'error',message:'Invalid JSON'}); return; }
      if (msg.action === 'subscribe') {
        client.symbols = new Set(normalizeSymbols(Array.isArray(msg.symbols) ? msg.symbols : String(msg.symbols || '').split(',')));
        if (!client.symbols.size) client.symbols = new Set(DEFAULT_SYMBOLS);
        client.intervals = new Set(Array.isArray(msg.intervals) && msg.intervals.length ? msg.intervals : [DEFAULT_INTERVAL]);
        send(ws, { type:'subscribed', symbols:[...client.symbols], intervals:[...client.intervals] });
        rebuildSubscriptions();
        if (getProvider().provider === "stockflow") connectUpstream();
        await sendHistoricalCandles(client, [...client.symbols]);
      } else if (msg.action === 'unsubscribe') {
        const remove = new Set(normalizeSymbols(Array.isArray(msg.symbols) ? msg.symbols : String(msg.symbols || '').split(',')));
        for (const s of remove) client.symbols.delete(s);
        send(ws, { type:'unsubscribed', symbols:[...remove] });
        rebuildSubscriptions();
      } else if (msg.action === 'ping') {
        send(ws, { type:'pong', timestamp:new Date().toISOString() });
      }
    });
    ws.on('close', () => { clients.delete(ws); rebuildSubscriptions(); });
  });

  if (getProvider().provider === "stockflow") connectUpstream();
  return wss;
}
