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
let upstreamSymbols = new Set();
let mockTimer = null;

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
    apiKey: process.env.MARKET_DATA_API_KEY || "",
    alpacaKey: process.env.ALPACA_API_KEY || "",
    alpacaSecret: process.env.ALPACA_API_SECRET || "",
    url: process.env.MARKET_DATA_WS_URL || "wss://ws.twelvedata.com/v1/quotes/price",
    alpacaUrl: process.env.ALPACA_DATA_WS_URL || "wss://stream.data.alpaca.markets/v2/iex",
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
        source: ["twelve_data","alpaca"].includes(getProvider().provider) ? 'twelve_data_rest' : 'mock',
      });
    } catch (error) {
      send(client.ws, { type: 'error', scope: 'candle_snapshot', symbol, message: error.message });
    }
  }
}

function rebuildSubscriptions() {
  const all = new Set();
  for (const c of clients.values()) for (const s of c.symbols) all.add(s);
  upstreamSymbols = all;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;

  const provider = getProvider().provider;
  if (provider === "alpaca") {
    if (all.size) upstream.send(JSON.stringify({ action: "subscribe", trades: [...all], quotes: [...all] }));
    return;
  }

  upstream.send(JSON.stringify({ action: "reset" }));
  if (all.size) upstream.send(JSON.stringify({ action: "subscribe", params: { symbols: [...all].join(",") } }));
}


function handleQuote({ symbol, price, volume, tradeSize, tradeId, exchange, tradeSide, timestamp, source }) {
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
    price: Number(price) || null,
    volume: Number(volume) || 0,
    timestamp: timestamp || new Date().toISOString(),
    source,
    market: getMarketSession(new Date(timestamp || Date.now())),
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

  });
  if (flow) {
    for (const c of clients.values()) {
      if (c.symbols.has(s)) send(c.ws, { type: 'flow', symbol: s, data: flow });
    }
  }
}

function connectUpstream() {
  const { provider, apiKey, url, alpacaKey, alpacaSecret, alpacaUrl } = providerConfig();
  if (provider === "alpaca" && (!alpacaKey || !alpacaSecret)) return;
  if (provider === "twelve_data" && !apiKey) return;
  if (upstream && [WebSocket.OPEN, WebSocket.CONNECTING].includes(upstream.readyState)) return;

  if (provider === "alpaca") {
    upstream = new WebSocket(alpacaUrl);

    upstream.on("open", () => {
      upstream.send(JSON.stringify({
        action: "auth",
        key: alpacaKey,
        secret: alpacaSecret
      }));
    });

    upstream.on("message", raw => {
      let messages;
      try { messages = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(messages)) messages = [messages];

      for (const data of messages) {
        if (data.T === "success" && data.msg === "authenticated") {
          rebuildSubscriptions();
          continue;
        }

        if (data.T === "t" && data.S) {
          handleQuote({
            symbol: data.S,
            price: data.p,
            tradeSize: data.s,
            tradeId: data.i,
            exchange: data.x,
            timestamp: data.t || new Date().toISOString(),
            source: "alpaca_iex_trade"
          });
          continue;
        }

        if (data.T === "q" && data.S) {
  latestQuotes.set(data.S, {
    bid: Number(data.bp) || null,
    ask: Number(data.ap) || null,
    timestamp: data.t || new Date().toISOString(),
  });

  handleQuote({
    symbol: data.S,
    price: data.ap || data.bp,
    volume: 0,
    timestamp: data.t || new Date().toISOString(),
    source: "alpaca_iex_quote"
  });
  continue;
}

        for (const c of clients.keys()) {
          send(c, { type: "provider_event", data });
        }
      }
    });
  } else {
    const wsUrl = `${url}?apikey=${encodeURIComponent(apiKey)}`;
    upstream = new WebSocket(wsUrl);

    upstream.on("open", () => rebuildSubscriptions());

    upstream.on("message", raw => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }

      if (data.event === "price" && data.symbol) {
        handleQuote({
          symbol: data.symbol,
          price: data.price,
          volume: data.day_volume,
          timestamp: data.timestamp ? new Date(Number(data.timestamp) * 1000).toISOString() : new Date().toISOString(),
          source: "twelve_data_ws"
        });
      } else {
        for (const c of clients.keys()) {
          send(c, { type: "provider_event", data });
        }
      }
    });
  }

  upstream.on("close", () => {
    upstream = null;
    if (clients.size) setTimeout(connectUpstream, 3000);
  });

  upstream.on("error", () => {});
}

function startMock() {
  if (mockTimer) return;
  mockTimer = setInterval(async () => {
    for (const symbol of upstreamSymbols.size ? upstreamSymbols : DEFAULT_SYMBOLS) {
      try {
        const q = await getQuote(symbol);
        const price = Number((q.price * (1 + (Math.random() - 0.5) * 0.001)).toFixed(4));
        handleQuote({ symbol, price, volume: q.volume || 0, timestamp: new Date().toISOString(), source: 'mock_ws' });
      } catch {}
    }
  }, 1000);
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
        if (["twelve_data","alpaca"].includes(getProvider().provider)) connectUpstream();
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

  if (["twelve_data","alpaca"].includes(getProvider().provider)) connectUpstream();
  else startMock();
  return wss;
}
