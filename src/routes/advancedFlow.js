import { Router } from 'express';
import { z } from 'zod';
import { getOptionsFlow, getDarkPoolPrints, normalizeOptionsRows, normalizeDarkRows } from '../services/optionWhales.js';
import { getFlow } from '../services/flowEngine.js';

const router=Router();
const symbol=z.string().trim().min(1).max(8).regex(/^[A-Za-z]{1,8}$/);
const type=z.enum(['stocks','options','dark']);

router.get('/:symbol', async (req,res,next)=>{
  try{
    const ticker=symbol.parse(req.params.symbol).toUpperCase();
    const kind=type.parse(req.query.type || 'stocks');
    if(kind==='stocks') return res.json({ok:true,type:kind,status:'LIVE',data:getFlow(ticker),meta:{source:'dtflow_stock_flow',displayStatus:'LIVE'}});
    if(kind==='options'){
      const raw=await getOptionsFlow(ticker,{limit:Math.min(Number(req.query.limit||25),100)});
      const realtime = raw?.data?.realtime === true || raw?.realtime === true;
      const delayMinutes = raw?.data?.delay_minutes ?? raw?.delay_minutes ?? ((raw?.data?.delay_seconds ?? raw?.delay_seconds) != null ? Number(raw?.data?.delay_seconds ?? raw?.delay_seconds) / 60 : null);
      const displayStatus = realtime ? 'LIVE' : (Number(delayMinutes) > 0 ? 'DELAYED' : 'UNCONFIRMED');
      return res.json({ok:true,type:kind,status:displayStatus,data:normalizeOptionsRows(raw),meta:{source:'optionwhales',displayStatus,asOf:raw?.data?.as_of || raw?.as_of || raw?.prints?.[0]?.executed_at || raw?.prints?.[0]?.timestamp || null,delayMinutes}});
    }
    const raw=await getDarkPoolPrints(ticker,{limit:Math.min(Number(req.query.limit||25),100)});
    const realtime = raw?.data?.realtime === true || raw?.realtime === true;
    const delayMinutes = raw?.data?.delay_minutes ?? raw?.delay_minutes ?? ((raw?.data?.delay_seconds ?? raw?.delay_seconds) != null ? Number(raw?.data?.delay_seconds ?? raw?.delay_seconds) / 60 : null);
    const displayStatus = realtime ? 'LIVE' : (Number(delayMinutes) > 0 ? 'DELAYED' : 'UNCONFIRMED');
    return res.json({ok:true,type:kind,status:displayStatus,data:normalizeDarkRows(raw),meta:{source:'optionwhales',displayStatus,asOf:raw?.data?.as_of || raw?.as_of || raw?.prints?.[0]?.executed_at || raw?.prints?.[0]?.timestamp || null,delayMinutes}});
  }catch(e){next(e)}
});

export default router;
