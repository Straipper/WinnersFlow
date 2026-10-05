import { Router } from 'express';
import { z } from 'zod';
import { confirm5mSetup } from '../services/confirmEngine.js';
const router=Router();
const symbolSchema=z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);
router.get('/:symbol',async(req,res,next)=>{
  try{
    const symbol=symbolSchema.parse(req.params.symbol);
    const outputsize=req.query.outputsize?z.coerce.number().int().min(50).max(5000).parse(req.query.outputsize):undefined;
    res.json({ok:true,data:await confirm5mSetup(symbol,{outputsize})});
  }catch(e){next(e);}
});
export default router;
