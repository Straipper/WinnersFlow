import WebSocket from 'ws';

const BASE = 'https://api.optionwhales.io/v1';

function key(){ return process.env.OPTIONFLOW_API_KEY || ''; }
function headers(){ return { 'X-API-Key': key(), 'Accept': 'application/json' }; }
function requireKey(){ if(!key()) throw new Error('OptionWhales API is not configured'); }

async function owFetch(path, params={}){
  requireKey();
  const url = new URL(BASE + path);
  for(const [k,v] of Object.entries(params)) if(v !== undefined && v !== null && v !== '') url.searchParams.set(k,String(v));
  const res = await fetch(url, { headers: headers() });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw:text }; }
  if(!res.ok) throw new Error(`OptionWhales ${res.status}: ${data?.error || data?.message || res.statusText}`);
  return data;
}

export async function getOptionsFlowSessions(){
  return owFetch('/options-flow/sessions');
}

export async function getOptionsFlow(ticker, {limit=25, session}={}){
  const symbol = String(ticker).trim().toUpperCase();
  let tradingSession = session;

  if (!tradingSession) {
    const sessions = await getOptionsFlowSessions();
    tradingSession = sessions?.latest;
  }

  if (!tradingSession) {
    throw new Error('OptionWhales did not provide a latest trading session');
  }

  return owFetch('/options-flow/tape', {
    ticker: symbol,
    session: tradingSession,
    limit: Math.min(Math.max(Number(limit) || 25, 1), 2000),
  });
}

export async function getDarkPoolPrints(ticker, {limit=25}={}){
  const symbol=String(ticker).trim().toUpperCase();
  return owFetch(`/darkpool/prints/${encodeURIComponent(symbol)}`, {limit});
}

export async function getOptionWhalesStatus(){
  if(!key()) return {configured:false};
  try {
    const [options,dark] = await Promise.all([
      owFetch('/options-flow/health'),
      owFetch('/darkpool/health')
    ]);
    return {configured:true, options, dark};
  } catch(error) { return {configured:true, error:error.message}; }
}

export function firstValue(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function findRows(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  for (const key of ['data', 'result', 'results', 'response']) {
    const found = findRows(payload[key], keys);
    if (found.length) return found;
  }

  return [];
}

function parseOccContract(value) {
  if (typeof value !== 'string') return {};

  // OCC: symbol padded to 6 chars + YYMMDD + C/P + 8-digit strike
  const match = value.trim().match(/^([A-Z]{1,6})\s*(\d{6})([CP])(\d{8})$/i);
  if (!match) return {};

  const [, underlying, date, cp, strikeDigits] = match;
  const yy = Number(date.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const month = date.slice(2, 4);
  const day = date.slice(4, 6);

  return {
    underlying: underlying.trim(),
    optionType: cp.toUpperCase() === 'C' ? 'CALL' : 'PUT',
    expiration: `${year}-${month}-${day}`,
    strike: Number(strikeDigits) / 1000,
  };
}

export function normalizeOptionsRows(payload) {
  const rows = findRows(payload, [
    'rows', 'ticks', 'orders', 'options_flow', 'flow',
  ]);

  return rows.map((r, i) => {
    const order = r?.order && typeof r.order === 'object'
      ? r.order
      : {};
    const contract = firstValue(
      r?.option_ticker, r?.contract, r?.contract_symbol,
      r?.option_symbol, r?.symbol,
      order.option_ticker, order.contract, order.contract_symbol,
      order.option_symbol, order.symbol
    );
    const occ = parseOccContract(contract);

    const timestamp = firstValue(
      r?.timestamp, r?.ts, r?.time, r?.datetime,
      r?.created_at, r?.trade_time, r?.executed_at,
      order.timestamp, order.ts, order.time, order.datetime,
      order.created_at, order.trade_time, order.executed_at
    );

    return {
      id: String(firstValue(
        r?.event_id, r?.id, order.event_id, order.id,
        `${timestamp || 'unknown'}-${contract || i}`
      )),
      timestamp: timestamp ?? null,
      contract: contract ?? null,
      optionType: (() => {
        const value = firstValue(
          r?.option_type, r?.put_call, r?.call_put,
          order.option_type, order.put_call, order.call_put,
          occ.optionType
        );
        if (value == null) return null;
        const normalized = String(value).trim().toUpperCase();
        if (normalized === 'C' || normalized === 'CALL') return 'CALL';
        if (normalized === 'P' || normalized === 'PUT') return 'PUT';
        return normalized;
      })(),
      strike: firstValue(
        r?.strike, order.strike, occ.strike
      ) ?? null,
      expiration: firstValue(
        r?.expiration, r?.expiry, r?.expiration_date,
        order.expiration, order.expiry, order.expiration_date,
        occ.expiration
      ) ?? null,
      contracts: firstValue(
        r?.total_contracts, r?.contracts, r?.contract_count,
        r?.quantity, r?.size,
        order.total_contracts, order.contracts,
        order.contract_count, order.quantity, order.size
      ) ?? null,
      premium: firstValue(
        r?.premium, r?.total_premium, r?.total_notional,
        r?.notional, r?.total_value,
        order.premium, order.total_premium, order.total_notional,
        order.notional, order.total_value
      ) ?? null,
      direction: firstValue(
        r?.direction, r?.side, r?.sentiment,
        order.direction, order.side, order.sentiment
      ) ?? null,
      orderType: firstValue(
        r?.order_type, r?.trade_type, r?.execution_type,
        order.order_type, order.trade_type, order.execution_type
      ) ?? null,
      spot: firstValue(
        r?.spot_price, r?.underlying_price, r?.underlying_last,
        r?.stock_price,
        order.spot_price, order.underlying_price,
        order.underlying_last, order.stock_price
      ) ?? null,
      source: 'optionwhales',
    };
  });
}

export function normalizeDarkRows(payload) {
  const rows = findRows(payload, [
    'prints', 'rows', 'trades', 'ticks', 'dark_pool', 'darkpool',
  ]);

  return rows.map((r, i) => {
    const trade = r?.trade && typeof r.trade === 'object'
      ? r.trade
      : {};
    const timestamp = firstValue(
      r?.timestamp, r?.ts, r?.time, r?.datetime,
      r?.created_at, r?.executed_at, r?.trade_time,
      r?.execution_time, r?.reported_at,
      trade.timestamp, trade.ts, trade.time, trade.datetime,
      trade.created_at, trade.executed_at, trade.trade_time,
      trade.execution_time, trade.reported_at
    );

    const price = firstValue(
      r?.price, r?.trade_price, r?.execution_price,
      r?.last_price, trade.price, trade.trade_price,
      trade.execution_price, trade.last_price
    );
    const shares = firstValue(
      r?.shares, r?.size, r?.volume, r?.quantity,
      r?.share_size, r?.trade_size,
      trade.shares, trade.size, trade.volume,
      trade.quantity, trade.share_size, trade.trade_size
    );
    const notional = firstValue(
      r?.notional, r?.trade_value, r?.dollar_value,
      r?.total_value, r?.amount, r?.premium,
      trade.notional, trade.trade_value, trade.dollar_value,
      trade.total_value, trade.amount, trade.premium
    );

    return {
      id: String(firstValue(
        r?.event_id, r?.id, trade.event_id, trade.id,
        `${timestamp || 'unknown'}-${price ?? ''}-${shares ?? i}`
      )),
      timestamp: timestamp ?? null,
      price: price ?? null,
      shares: shares ?? null,
      notional: notional ?? null,
      venue: firstValue(
        r?.venue, r?.exchange, r?.market_center,
        trade.venue, trade.exchange, trade.market_center
      ) ?? null,
      nbboLocation: firstValue(
        r?.nbbo_location, r?.nbbo_label, r?.location, r?.price_location,
        trade.nbbo_location, trade.nbbo_label, trade.location, trade.price_location
      ) ?? null,
      source: 'optionwhales',
    };
  });
}

export function createOptionFlowSocket({onEvent,onStatus}={}){
  if(!key()) return null;
  const ws = new WebSocket(`${BASE.replace('https://','wss://')}/ws/flow?api_key=${encodeURIComponent(key())}`);
  ws.on('open',()=>onStatus?.({status:'connected'}));
  ws.on('message',raw=>{ try{ onEvent?.(JSON.parse(raw.toString())); }catch{} });
  ws.on('close',()=>onStatus?.({status:'closed'}));
  ws.on('error',error=>onStatus?.({status:'error',message:error.message}));
  return ws;
}
