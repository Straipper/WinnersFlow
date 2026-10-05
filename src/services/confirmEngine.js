import { getCandles, getQuote } from './marketData.js';
import { getFlow } from './flowEngine.js';
import { detectLevels } from './levels.js';
import { calculateIndicators } from './indicators.js';

const DEFAULTS = {
  interval: '5min', outputsize: 220,
  flowWindowMs: 5 * 60_000,
  flowThreshold: 0.15,
  levelDistancePct: 0.012,
  minRsi: 45, maxRsi: 72,
  minScore: 70,
};
const n=(v,d=null)=>Number.isFinite(Number(v))?Number(v):d;
const norm=s=>String(s||'').trim().toUpperCase();
const pct=(a,b)=>b?Math.abs(a-b)/Math.abs(b):Infinity;

function floor5Minute(ms){ return Math.floor(ms/300000)*300000; }
function candleEpoch(c){
  const raw = c?.timestamp ?? c?.datetime ?? c?.time;
  if (raw == null) return NaN;
  const num=Number(raw);
  if(Number.isFinite(num)) return num < 1e12 ? num*1000 : num;
  const parsed=Date.parse(String(raw));
  return Number.isFinite(parsed)?parsed:NaN;
}
function isClosedFiveMinute(c, now=Date.now()){
  const t=candleEpoch(c); if(!Number.isFinite(t)) return false;
  return t < floor5Minute(now);
}

export async function confirm5mSetup(symbol, options={}){
  const cfg={...DEFAULTS,...options};
  const s=norm(symbol);
  if(cfg.interval!=='5min') throw new Error('STEP_12 requires interval=5min');

  const candles=await getCandles(s,'5min',cfg.outputsize);
  if(!candles?.length) return {symbol:s,confirmed:false,state:'INSUFFICIENT_DATA',source:'dt_flow_5m_confirm_v1'};

  const now=Date.now();
  const closed=candles.filter(c=>isClosedFiveMinute(c,now));
  if(closed.length<3){
    return {symbol:s,confirmed:false,state:'WAITING_FOR_5M_CLOSE',direction:null,priceActionConfirmed:false,fiveMinuteCloseConfirmed:false,source:'dt_flow_5m_confirm_v1'};
  }

  const rows=calculateIndicators(closed);
  const current=rows.at(-1), previous=rows.at(-2);
  const levels=detectLevels(closed,{});
  const flow=getFlow(s,{windowMs:cfg.flowWindowMs});
  const q=await getQuote(s);
  const price=n(q?.price,current?.close);
  const cClose=n(current?.close);
  const support=levels.nearestSupport, resistance=levels.nearestResistance;
  const ind=current?.indicators||{};

  const trendBull=n(ind.ema9)!==null&&n(ind.ema21)!==null&&ind.ema9>ind.ema21;
  const trendBear=n(ind.ema9)!==null&&n(ind.ema21)!==null&&ind.ema9<ind.ema21;
  const momentumBull=n(ind.rsi14)!==null&&ind.rsi14>=cfg.minRsi&&ind.rsi14<=cfg.maxRsi&&n(ind.macdHistogram)!==null&&ind.macdHistogram>0;
  const momentumBear=n(ind.rsi14)!==null&&ind.rsi14<=100-cfg.minRsi&&n(ind.macdHistogram)!==null&&ind.macdHistogram<0;
  const bullishFlow=flow.side==='buy'&&n(flow.pressure,0)>=cfg.flowThreshold;
  const bearishFlow=flow.side==='sell'&&n(flow.pressure,0)<=-cfg.flowThreshold;

  const longBreakout=!!resistance&&cClose>resistance.price&&n(previous?.close)<=resistance.price;
  const shortBreakdown=!!support&&cClose<support.price&&n(previous?.close)>=support.price;
  const longLevel=!!resistance&&longBreakout;
  const shortLevel=!!support&&shortBreakdown;
  const longConfirmed=longLevel&&bullishFlow&&trendBull&&momentumBull;
  const shortConfirmed=shortLevel&&bearishFlow&&trendBear&&momentumBear;

  let state='WAITING_FOR_5M_PRICE_ACTION';
  if(longConfirmed) state='BUY_NOW_SETUP_CONFIRMED';
  else if(shortConfirmed) state='SELL_SETUP_CONFIRMED';
  else if(bullishFlow||bearishFlow) state='FLOW_DETECTED';
  else if(resistance||support) state='LEVEL_IDENTIFIED';

  const direction=longConfirmed?'long':shortConfirmed?'short':null;
  return {
    symbol:s, interval:'5min', timestamp:new Date().toISOString(),
    state, confirmed:Boolean(direction), direction,
    price, confirmationCandle:{datetime:current.datetime,open:current.open,high:current.high,low:current.low,close:current.close,volume:current.volume},
    priceActionConfirmed:Boolean(longLevel||shortLevel),
    fiveMinuteCloseConfirmed:Boolean(longLevel||shortLevel),
    levels:{nearestSupport:support,nearestResistance:resistance},
    flow:{side:flow.side,pressure:flow.pressure,deltaVolume:flow.deltaVolume},
    indicators:ind,
    conditions:{
      flowConfirmed:longConfirmed||shortConfirmed?true:false,
      levelBreakConfirmed:Boolean(longLevel||shortLevel),
      trendConfirmed:direction==='long'?trendBull:direction==='short'?trendBear:false,
      momentumConfirmed:direction==='long'?momentumBull:direction==='short'?momentumBear:false,
    },
    nextStep:direction?'ALBERT_BUY_NOW_OR_SELL_SETUP_CONFIRMED':'WAIT_FOR_NEXT_5M_CLOSE',
    source:'dt_flow_5m_confirm_v1'
  };
}
