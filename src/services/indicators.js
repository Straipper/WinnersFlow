const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a,b)=>a+b,0)/period;
}

export function emaSeries(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let ema = null;
  values.forEach((v,i) => {
    if (!Number.isFinite(v)) { out.push(null); return; }
    if (ema === null) {
      if (i + 1 < period) { out.push(null); return; }
      ema = sma(values.slice(0, i + 1), period);
    } else ema = v * k + ema * (1-k);
    out.push(ema);
  });
  return out;
}

export function rsiSeries(closes, period=14) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains=0, losses=0;
  for (let i=1;i<=period;i++) { const d=closes[i]-closes[i-1]; gains+=Math.max(d,0); losses+=Math.max(-d,0); }
  let avgGain=gains/period, avgLoss=losses/period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100/(1 + avgGain/avgLoss);
  for (let i=period+1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1];
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
    out[i]=avgLoss===0 ? 100 : 100-100/(1+avgGain/avgLoss);
  }
  return out;
}

export function macdSeries(closes, fast=12, slow=26, signal=9) {
  const ef=emaSeries(closes,fast), es=emaSeries(closes,slow);
  const macd=closes.map((_,i)=>ef[i]!==null&&es[i]!==null?ef[i]-es[i]:null);
  const compact=[]; const compactIndex=[];
  macd.forEach((v,i)=>{if(v!==null){compact.push(v);compactIndex.push(i);}});
  const sigCompact=emaSeries(compact,signal);
  const sig=Array(closes.length).fill(null); const hist=Array(closes.length).fill(null);
  compactIndex.forEach((idx,j)=>{if(sigCompact[j]!==null){sig[idx]=sigCompact[j];hist[idx]=macd[idx]-sig[idx];}});
  return {macd, signal:sig, histogram:hist};
}

export function atrSeries(candles, period=14) {
  const tr=Array(candles.length).fill(null), atr=Array(candles.length).fill(null);
  for(let i=0;i<candles.length;i++) {
    const c=candles[i], prev=candles[i-1];
    tr[i]=prev ? Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close)) : c.high-c.low;
  }
  if(candles.length<period) return atr;
  let sum=0; for(let i=0;i<period;i++) sum+=tr[i];
  atr[period-1]=sum/period;
  for(let i=period;i<candles.length;i++) atr[i]=(atr[i-1]*(period-1)+tr[i])/period;
  return atr;
}

export function vwapSeries(candles) {
  const out=[]; let cumulativePV=0,cumulativeVol=0,lastDate=null;
  candles.forEach(c=>{
    const date=new Date(c.datetime).toISOString().slice(0,10);
    if(lastDate && date!==lastDate){cumulativePV=0;cumulativeVol=0;}
    const vol=Number(c.volume)||0; const typical=(c.high+c.low+c.close)/3;
    cumulativePV += typical*vol; cumulativeVol += vol;
    out.push(cumulativeVol>0 ? cumulativePV/cumulativeVol : c.close);
    lastDate=date;
  });
  return out;
}

export function calculateIndicators(candles) {
  const rows=candles.map(c=>({datetime:c.datetime,open:num(c.open),high:num(c.high),low:num(c.low),close:num(c.close),volume:num(c.volume)||0}));
  const closes=rows.map(c=>c.close);
  const ema9=emaSeries(closes,9), ema21=emaSeries(closes,21), ema50=emaSeries(closes,50), ema200=emaSeries(closes,200);
  const rsi14=rsiSeries(closes,14), macd=macdSeries(closes), atr14=atrSeries(rows,14), vwap=vwapSeries(rows);
  return rows.map((c,i)=>({...c,indicators:{ema9:ema9[i],ema21:ema21[i],ema50:ema50[i],ema200:ema200[i],rsi14:rsi14[i],macd:macd.macd[i],macdSignal:macd.signal[i],macdHistogram:macd.histogram[i],atr14:atr14[i],vwap:vwap[i]}}));
}

export function latestIndicators(candles) {
  const series=calculateIndicators(candles);
  return series.at(-1)?.indicators ?? null;
}
