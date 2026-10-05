import WebSocket from 'ws';

const BASE = 'https://api.optionwhales.io/v1';

function key(){ return process.env.OPTIONWHALES_API_KEY || ''; }
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

export async function getOptionsFlow(ticker, {limit=25}={}){
  const symbol=String(ticker).trim().toUpperCase();
  return owFetch(`/options-flow/ticker/${encodeURIComponent(symbol)}/ticks`, {limit});
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

export function normalizeOptionsRows(payload){
  const rows = payload?.data?.rows || payload?.data?.ticks || payload?.rows || payload?.ticks || payload?.data || [];
  return Array.isArray(rows) ? rows.map((r,i)=>({
    id:r.event_id || r.id || `${r.timestamp || r.ts || i}-${r.option_ticker || r.contract || ''}`,
    timestamp:r.timestamp || r.ts || r.time || null,
    contract:r.option_ticker || r.contract || r.symbol || null,
    optionType:r.option_type || r.type || null,
    strike:r.strike ?? null,
    expiration:r.expiration || null,
    contracts:r.total_contracts ?? r.contracts ?? r.size ?? null,
    premium:r.premium ?? r.total_premium ?? r.notional ?? null,
    direction:r.direction || r.side || null,
    orderType:r.order_type || r.trade_type || null,
    spot:r.spot_price ?? r.underlying_price ?? null,
    source:'optionwhales',
  })) : [];
}

export function normalizeDarkRows(payload){
  const rows = payload?.data?.prints || payload?.data?.rows || payload?.prints || payload?.rows || payload?.data || [];
  return Array.isArray(rows) ? rows.map((r,i)=>({
    id:r.event_id || r.id || `${r.timestamp || r.ts || i}-${r.price || ''}-${r.size || ''}`,
    timestamp:r.timestamp || r.ts || r.time || null,
    price:r.price ?? r.trade_price ?? null,
    shares:r.shares ?? r.size ?? r.volume ?? null,
    notional:r.notional ?? r.trade_value ?? null,
    venue:r.venue || r.exchange || null,
    nbboLocation:r.nbbo_location || r.location || null,
    source:'optionwhales',
  })) : [];
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
