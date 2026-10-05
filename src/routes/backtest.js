import { Router } from 'express';
import { z } from 'zod';
import { runBacktest } from '../services/backtestEngine.js';

const router=Router();
const symbolSchema=z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);
router.get('/:symbol',async(req,res,next)=>{
  try{
    const symbol=symbolSchema.parse(req.params.symbol);
    const q=req.query;
    const options={
      outputsize:q.outputsize?Number(q.outputsize):undefined,
      minScore:q.minScore?Number(q.minScore):undefined,
      initialCapital:q.initialCapital?Number(q.initialCapital):undefined,
      riskPct:q.riskPct?Number(q.riskPct):undefined,
      targetR:q.targetR?Number(q.targetR):undefined,
      stopAtr:q.stopAtr?Number(q.stopAtr):undefined,
      maxBarsInTrade:q.maxBarsInTrade?Number(q.maxBarsInTrade):undefined,
    };
    Object.keys(options).forEach(k=>options[k]===undefined&&delete options[k]);
    res.json({ok:true,data:await runBacktest(symbol,options)});
  }catch(e){next(e);}
});
export default router;
