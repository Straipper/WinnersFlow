import { Router } from 'express';
import { z } from 'zod';
import { getOptionsFlow, getDarkPoolPrints, normalizeOptionsRows, normalizeDarkRows } from '../services/optionWhales.js';
import { getFlow } from '../services/flowEngine.js';

function timestampMs(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(value);
}

function flowStatus(raw, rows) {
  const realtime = raw?.data?.realtime === true || raw?.realtime === true;
  const delayRaw = raw?.data?.delay_minutes ?? raw?.delay_minutes
    ?? ((raw?.data?.delay_seconds ?? raw?.delay_seconds) != null
      ? Number(raw?.data?.delay_seconds ?? raw?.delay_seconds) / 60 : null);
  const delayMinutes = delayRaw == null ? null : Number(delayRaw);

  const candidates = [
    raw?.data?.as_of, raw?.as_of,
    ...(Array.isArray(rows) ? rows.map(row => row?.timestamp) : [])
  ];
  const times = candidates.map(timestampMs).filter(Number.isFinite);
  const latestMs = times.length ? Math.max(...times) : NaN;
  const ageMs = Date.now() - latestMs;

  let displayStatus = 'UNCONFIRMED';
  if (Number.isFinite(delayMinutes) && delayMinutes > 0) {
    displayStatus = 'DELAYED';
  } else if (Number.isFinite(latestMs) && ageMs >= 0 && ageMs > 5 * 60_000) {
    displayStatus = 'STALE';
  } else if (realtime && Number.isFinite(latestMs) && ageMs >= 0 && ageMs <= 5 * 60_000) {
    displayStatus = 'LIVE';
  }

  return {
    displayStatus,
    delayMinutes: Number.isFinite(delayMinutes) ? delayMinutes : null,
    asOf: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null
  };
}

const router=Router();
const symbol=z.string().trim().min(1).max(8).regex(/^[A-Za-z]{1,8}$/);
const type=z.enum(['stocks','options','dark']);

router.get('/:symbol', async (req,res,next)=>{
  try{
    const ticker=symbol.parse(req.params.symbol).toUpperCase();
    const kind=type.parse(req.query.type || 'stocks');
    if(kind==='stocks'){
      const data = getFlow(ticker);
      const now = Date.now();
      const tradeMs = data.lastTradeAt ? Date.parse(data.lastTradeAt) : NaN;
      const ageMs = now - tradeMs;
      const allowedSources = new Set([
        'stockflow_tradier_timesale',
      ]);
      const hasVerifiedRecentTrade = Array.isArray(data.latestEvents) &&
        data.latestEvents.some(event => {
          const eventMs = typeof event?.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
          const eventAgeMs = now - eventMs;
          return event &&
            event.tradeId !== undefined &&
            event.tradeId !== null &&
            String(event.tradeId).trim() !== '' &&
            allowedSources.has(String(event.source || '').toLowerCase()) &&
            Number(event.volume) > 0 &&
            Number(event.price) > 0 &&
            Number(event.notional) > 0 &&
            Number.isFinite(eventMs) &&
            eventAgeMs >= 0 &&
            eventAgeMs <= 60_000;
        });
      const displayStatus =
        Number.isFinite(tradeMs) &&
        ageMs >= 0 &&
        ageMs <= 60_000 &&
        hasVerifiedRecentTrade
          ? 'LIVE'
          : Number.isFinite(tradeMs) && ageMs > 60_000
            ? 'STALE'
            : 'UNCONFIRMED';
      return res.json({
        ok: true,
        type: kind,
        status: displayStatus,
        data: displayStatus === 'LIVE' ? data : null,
        meta: {
          source: 'dtflow_stock_flow',
          displayStatus,
          asOf: data.lastTradeAt || null,
        },
      });
    }
    if(kind==='options'){
    const raw=await getOptionsFlow(ticker,{limit:Math.min(Number(req.query.limit||25),100)});
    const data=normalizeOptionsRows(raw);
    const meta=flowStatus(raw,data);
    return res.json({ok:true,type:kind,status:meta.displayStatus,data,meta:{source:'optionwhales',...meta}});
  }
  const raw=await getDarkPoolPrints(ticker,{limit:Math.min(Number(req.query.limit||25),100)});
  const data=normalizeDarkRows(raw);
  const meta=flowStatus(raw,data);
  return res.json({ok:true,type:kind,status:meta.displayStatus,data,meta:{source:'optionwhales',...meta}});
  }catch(e){next(e)}
});

export default router;
