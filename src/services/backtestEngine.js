import { getCandles } from './marketData.js';
import { calculateIndicators } from './indicators.js';
import { detectLevels } from './levels.js';

const DEFAULTS = {
  interval: '5min',
  outputsize: 1000,
  minScore: 70,
  flowThreshold: 0.15,
  minRsi: 45,
  maxRsi: 72,
  levelDistancePct: 0.012,
  stopAtr: 1.0,
  targetR: 2.0,
  maxBarsInTrade: 12,
  initialCapital: 10000,
  riskPct: 1,
};
const n=(v,d=null)=>Number.isFinite(Number(v))?Number(v):d;
const pct=(a,b)=>b?Math.abs(a-b)/Math.abs(b):Infinity;
const norm=s=>String(s||'').trim().toUpperCase();

function historicalFlow(rows, i, window=12) {
  const start=Math.max(1,i-window+1); let buy=0,sell=0;
  for(let j=start;j<=i;j++){
    const r=rows[j], p=rows[j-1];
    const vol=Math.max(0,n(r.volume,0));
    if(n(r.close)>n(p.close)) buy+=vol;
    else if(n(r.close)<n(p.close)) sell+=vol;
  }
  const total=buy+sell;
  const pressure=total? (buy-sell)/total : 0;
  return {buyVolume:buy,sellVolume:sell,deltaVolume:buy-sell,pressure,side:pressure>=0.15?'buy':pressure<=-0.15?'sell':'neutral'};
}

function tradeResult({direction, entry, stop, target, future, maxBars}) {
  const end=Math.min(future.length,maxBars);
  for(let k=0;k<end;k++){
    const c=future[k];
    if(direction==='long'){
      const stopHit=n(c.low)<=stop, targetHit=n(c.high)>=target;
      if(stopHit && targetHit) return {exit:stop, reason:'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE', bars:k+1};
      if(stopHit) return {exit:stop, reason:'STOP', bars:k+1};
      if(targetHit) return {exit:target, reason:'TARGET', bars:k+1};
    } else {
      const stopHit=n(c.high)>=stop, targetHit=n(c.low)<=target;
      if(stopHit && targetHit) return {exit:stop, reason:'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE', bars:k+1};
      if(stopHit) return {exit:stop, reason:'STOP', bars:k+1};
      if(targetHit) return {exit:target, reason:'TARGET', bars:k+1};
    }
  }
  const last=future[Math.max(0,end-1)];
  return {exit:n(last.close,entry),reason:'TIME_EXIT',bars:end};
}

export async function runBacktest(symbol, options={}) {
  const cfg={...DEFAULTS,...options};
  const s=norm(symbol);
  if(cfg.interval!=='5min') throw new Error('STEP_17 currently supports interval=5min');
  const candles=await getCandles(s,'5min',Math.min(Math.max(Number(cfg.outputsize)||1000,250),5000));
  if(!candles || candles.length<80) return {symbol:s,status:'INSUFFICIENT_DATA',trades:[],metrics:null,source:'dt_flow_backtest_v1'};
  const rows=candles.map(c=>({...c,open:n(c.open),high:n(c.high),low:n(c.low),close:n(c.close),volume:n(c.volume,0)})).filter(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite));
  const indicators=calculateIndicators(rows);
  const trades=[]; let equity=Number(cfg.initialCapital); let peak=equity; let maxDrawdown=0;
  let inTradeUntil=-1;
  const start=60, end=indicators.length-2;
  for(let i=start;i<=end;i++){
    if(i<=inTradeUntil) continue;
    const cur=indicators[i], prev=indicators[i-1];
    const levels=detectLevels(rows.slice(0,i+1),{});
    const ind=cur.indicators||{}; const price=n(cur.close);
    const flow=historicalFlow(rows,i,12);
    const support=levels.nearestSupport, resistance=levels.nearestResistance;
    const trendBull=n(ind.ema9)!==null&&n(ind.ema21)!==null&&ind.ema9>ind.ema21;
    const trendBear=n(ind.ema9)!==null&&n(ind.ema21)!==null&&ind.ema9<ind.ema21;
    const momentumBull=n(ind.rsi14)!==null&&ind.rsi14>=cfg.minRsi&&ind.rsi14<=cfg.maxRsi&&n(ind.macdHistogram)!==null&&ind.macdHistogram>0;
    const momentumBear=n(ind.rsi14)!==null&&ind.rsi14<=100-cfg.minRsi&&n(ind.macdHistogram)!==null&&ind.macdHistogram<0;
    const bullishFlow=flow.side==='buy'&&flow.pressure>=cfg.flowThreshold;
    const bearishFlow=flow.side==='sell'&&flow.pressure<=-cfg.flowThreshold;
    const breakout=!!resistance&&price>resistance.price&&n(prev.close)<=resistance.price;
    const breakdown=!!support&&price<support.price&&n(prev.close)>=support.price;
    let score=0;
    if(bullishFlow||bearishFlow) score+=30;
    if(trendBull||trendBear) score+=10;
    if(momentumBull||momentumBear) score+=15;
    if(breakout||breakdown) score+=25;
    if((support&&pct(price,support.price)<=cfg.levelDistancePct)||(resistance&&pct(price,resistance.price)<=cfg.levelDistancePct)) score+=20;
    const direction= bullishFlow&&trendBull&&momentumBull&&(breakout|| (support&&pct(price,support.price)<=cfg.levelDistancePct)) ? 'long' : bearishFlow&&trendBear&&momentumBear&&(breakdown || (resistance&&pct(price,resistance.price)<=cfg.levelDistancePct)) ? 'short' : null;
    if(!direction || score<cfg.minScore) continue;
    const next=rows[i+1]; if(!next) continue;
    const entry=n(next.open,price); const atr=n(ind.atr14,Math.abs(n(cur.high)-n(cur.low))); if(!Number.isFinite(atr)||atr<=0) continue;
    const riskDistance=atr*cfg.stopAtr;
    const stop=direction==='long'?entry-riskDistance:entry+riskDistance;
    const target=direction==='long'?entry+riskDistance*cfg.targetR:entry-riskDistance*cfg.targetR;
    const capitalRisk=equity*(Number(cfg.riskPct)/100);
    const qty=capitalRisk/riskDistance;
    const result=tradeResult({direction,entry,stop,target,future:rows.slice(i+2),maxBars:Number(cfg.maxBarsInTrade)});
    const pnlPerUnit=direction==='long'?result.exit-entry:entry-result.exit;
    const pnl=pnlPerUnit*qty;
    equity+=pnl; peak=Math.max(peak,equity); maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);
    const trade={id:trades.length+1,symbol:s,direction,setupCandle:cur.datetime,entryCandle:next.datetime,entry,stop,target,exit:result.exit,reason:result.reason,barsHeld:result.bars,score,flowPressure:flow.pressure,atr,qty,pnl,equity};
    trades.push(trade); inTradeUntil=i+1+result.bars;
  }
  const wins=trades.filter(t=>t.pnl>0).length, losses=trades.filter(t=>t.pnl<0).length;
  const grossProfit=trades.filter(t=>t.pnl>0).reduce((a,t)=>a+t.pnl,0);
  const grossLoss=Math.abs(trades.filter(t=>t.pnl<0).reduce((a,t)=>a+t.pnl,0));
  const winRate=trades.length?wins/trades.length:0;
  const profitFactor=grossLoss?grossProfit/grossLoss:null;
  return {symbol:s,status:'COMPLETED',parameters:cfg,metrics:{trades:trades.length,wins,losses,winRate,winRatePct:winRate*100,grossProfit,grossLoss,netPnl:equity-Number(cfg.initialCapital),finalEquity:equity,profitFactor,maxDrawdownPct:maxDrawdown*100,avgPnl:trades.length?(equity-Number(cfg.initialCapital))/trades.length:0},trades,source:'dt_flow_backtest_v1',methodology:'Historical candle simulation using the same indicator/level concepts as WinnersFlow. Flow is a candle-volume direction proxy, not exchange-grade aggressor-side order flow. Conservative handling is used when stop and target are both touched in one candle.'};
}
