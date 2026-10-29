import WebSocket, { WebSocketServer } from 'ws';
import { createReconnectScheduler } from './upstreamReconnect.js';
import { getProvider, getQuote, getCandles } from './marketData.js';
import { updateCandle } from './candleEngine.js';
import { processFlowTick } from './flowEngine.js';
import { inferTradeSide } from './tradeSide.js';
import { verifyMarketSocketTicket } from './websocketAuth.js';
import { getMarketSession } from './marketSession.js';
import { normalizeTradierMessage } from './tradierMessage.js';
import { isFreshMarketTimestamp } from './marketTimestamp.js';

const DEFAULT_SYMBOLS = ['NVDA','AAPL','MSFT','AMD','TSLA','META'];
const DEFAULT_INTERVAL = '5min';
const clients = new Map();
const latestQuotes = new Map();

export function getLatestPublicQuotes(symbols = []) {
  const now = Date.now();
  return symbols.flatMap(rawSymbol => {
    const symbol = String(rawSymbol).trim().toUpperCase();
    const quote = latestQuotes.get(symbol);
    if (!quote) return [];

    const timestampMs = Number(quote.priceTimestampMs);
    const price = Number(quote.price);
    if (!isFreshMarketTimestamp(timestampMs, now) ||
        !Number.isFinite(price) || price <= 0) return [];

    return [{
      symbol,
      price,
      changePct: quote.changePct != null &&
        quote.changePct !== '' &&
        Number.isFinite(Number(quote.changePct))
        ? Number(quote.changePct) : null,
      timestamp: new Date(timestampMs).toISOString(),
      source: quote.priceSource || "stockflow_tradier_stream",
    }];
  });
}
let upstream = null;
let upstreamSessionId = null;
let upstreamConnecting = false;
let liveMarketClosing = false;
let marketWss = null;
let upstreamSymbols = new Set();
let upstreamMessageCount = 0;
let upstreamTimesaleCount = 0;
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
  const all = new Set(DEFAULT_SYMBOLS);
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
      advancedDetails: true,
    }));
    console.log(`[Stockflow] subscription sent: ${all.size} symbols (${[...all].join(", ")})`);
  }
}

function handleQuote({ symbol, price, volume, tradeSize, tradeId, exchange, tradeSide, timestamp, source }) {
  if (!String(source || "").startsWith("stockflow_tradier_")) return;
  const timestampMs = parseTimestampMs(timestamp);
  if (!isFreshMarketTimestamp(timestampMs)) return;
  const normalizedTimestamp = new Date(timestampMs).toISOString();
  const normalizedPrice = Number(price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) return;
  const s = String(symbol).toUpperCase();
const quoteBook = latestQuotes.get(s) || {};
const bidAgeMs = timestampMs - Number(quoteBook.bidTimestampMs);
const askAgeMs = timestampMs - Number(quoteBook.askTimestampMs);
const bidFresh = Number.isFinite(bidAgeMs) &&
  bidAgeMs >= 0 && bidAgeMs <= 15_000;
const askFresh = Number.isFinite(askAgeMs) &&
  askAgeMs >= 0 && askAgeMs <= 15_000;
const bid = bidFresh ? (Number(quoteBook.bid) || null) : null;
const ask = askFresh ? (Number(quoteBook.ask) || null) : null;

let inferredSide = null;
if (tradeSize > 0) inferredSide = inferTradeSide(Number(price), bid, ask);
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

const upstreamReconnect = createReconnectScheduler(() => connectUpstream());

function scheduleUpstreamReconnect(delayMs) {
  upstreamReconnect.schedule(delayMs);
}

function connectUpstream() {
  const { provider, stockflowKey } = providerConfig();
  if (liveMarketClosing || provider !== "stockflow" || !stockflowKey) return;
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
      if (liveMarketClosing) {
        upstreamConnecting = false;
        return;
      }
      if (!response.ok || !body.stream?.sessionid || !body.stream?.url) {
        throw new Error(`Tradier streaming session HTTP ${response.status}`);
      }

      console.log("[Stockflow] streaming session created");
      upstreamSessionId = body.stream.sessionid;
      const socket = new WebSocket(body.stream.url);
      upstream = socket;
      upstreamConnecting = false;

      socket.on("open", () => {
        upstreamMessageCount = 0;
        console.log("[Stockflow] streaming socket connected");
        rebuildSubscriptions();
      });
      socket.on("message", raw => {
        const events = normalizeTradierMessage(raw);
        if (!events.length) return;

        upstreamMessageCount += 1;
        if (upstreamMessageCount <= 5) {
          const types = events.map(event => String(event.type || "unknown"));
          console.log(`[Stockflow] message ${upstreamMessageCount}: ${events.length} valid event(s), types=${[...new Set(types)].join(",")}`);
        }

        for (const data of events) {
          const { symbol, timestamp, timestampMs } = data;
          if (!isFreshMarketTimestamp(timestampMs)) continue;
          if (data.type === "timesale") {
            const previousQuote = latestQuotes.get(symbol) || {};
            const bidValue = Number(data.bid);
            const askValue = Number(data.ask);
            latestQuotes.set(symbol, {
              ...previousQuote,
              bid: Number.isFinite(bidValue) && bidValue > 0 ? bidValue : previousQuote.bid,
              ask: Number.isFinite(askValue) && askValue > 0 ? askValue : previousQuote.ask,
              bidTimestampMs: Number.isFinite(bidValue) && bidValue > 0
                ? timestampMs : previousQuote.bidTimestampMs,
              askTimestampMs: Number.isFinite(askValue) && askValue > 0
                ? timestampMs : previousQuote.askTimestampMs,
              ...(Number.isFinite(Number(data.last)) &&
                  Number(data.last) > 0 &&
                  (!Number.isFinite(Number(previousQuote.priceTimestampMs)) ||
                   timestampMs >= Number(previousQuote.priceTimestampMs))
                ? {
                    price: Number(data.last),
                    priceTimestampMs: timestampMs,
                    priceSource: "stockflow_tradier_timesale",
                  }
                : {}),
              timestamp
            });
            upstreamTimesaleCount += 1;
            if (upstreamTimesaleCount <= 5) {
              console.log(`[Stockflow] timesale ${upstreamTimesaleCount} received for ${symbol}`);
            }

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
          } else if (data.type === "quote") {
            const bid = Number(data.bid) || null;
            const ask = Number(data.ask) || null;
            const last = Number(data.last) || null;
            const previousQuote = latestQuotes.get(symbol) || {};
            const quoteVolume = Number(data.volume);

            const bidValid = Number.isFinite(Number(data.bid)) && Number(data.bid) > 0;
            const askValid = Number.isFinite(Number(data.ask)) && Number(data.ask) > 0;
            latestQuotes.set(symbol, {
              ...previousQuote,
              bid: bidValid ? bid : previousQuote.bid,
              ask: askValid ? ask : previousQuote.ask,
              timestamp,
              quoteTimestampMs: timestampMs,
              bidTimestampMs: bidValid && Number.isFinite(data.bidTimestampMs)
                ? data.bidTimestampMs
                : bidValid ? timestampMs : previousQuote.bidTimestampMs,
              askTimestampMs: askValid && Number.isFinite(data.askTimestampMs)
                ? data.askTimestampMs
                : askValid ? timestampMs : previousQuote.askTimestampMs,
              ...(Number.isFinite(last) && last > 0 &&
                  (!Number.isFinite(Number(previousQuote.priceTimestampMs)) ||
                   timestampMs >= Number(previousQuote.priceTimestampMs))
                ? {
                    price: last,
                    priceTimestampMs: timestampMs,
                    priceSource: "stockflow_tradier_quote",
                    changePct: data.change_percentage != null &&
                      data.change_percentage !== '' &&
                      Number.isFinite(Number(data.change_percentage))
                      ? Number(data.change_percentage)
                      : previousQuote.changePct ?? null,
                  }
                : {}),
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
          }
        }
      });
      socket.on("close", (code, reason) => {
        console.error("[Stockflow] streaming socket closed:", code, reason?.toString?.() || "");
        if (upstream === socket) {
          upstream = null;
          upstreamSessionId = null;
          scheduleUpstreamReconnect(3000);
        }
      });
      socket.on("error", error => {
        if (!liveMarketClosing) {
          console.error("[Stockflow] streaming socket error:", error.message);
        }
        if (upstream === socket && socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      });
    } catch (error) {
      upstreamConnecting = false;
      upstream = null;
      upstreamSessionId = null;
      console.error("[Stockflow] streaming connection failed:", error.message);
      if (!liveMarketClosing) scheduleUpstreamReconnect(5000);
    }
  })();
}


export function closeLiveMarket() {
  liveMarketClosing = true;
  upstreamReconnect.cancel();
  upstreamConnecting = false;
  upstreamSessionId = null;

  if (upstream) {
    const socket = upstream;
    upstream = null;
    try {
      socket.removeAllListeners("close");
      if (socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    } catch (error) {
      console.error("[Stockflow] error during shutdown:", error.message);
    }
  }

  for (const client of clients.values()) {
    try { client.ws.close(1001, "Server shutting down"); } catch {}
  }
  clients.clear();

  if (marketWss) {
    const wss = marketWss;
    marketWss = null;
    for (const client of wss.clients) {
      try { client.terminate(); } catch {}
    }
    try { wss.close(); } catch {}
  }
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
  marketWss = wss;
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
