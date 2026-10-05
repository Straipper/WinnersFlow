import { Router } from 'express';
import { z } from 'zod';
import { evaluateSetup } from '../services/setupEngine.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);

router.get('/:symbol', async (req,res,next)=>{
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    const options = {
      interval: req.query.interval ? z.enum(['1min','5min','15min','30min','1h','4h','1day']).parse(req.query.interval) : undefined,
      outputsize: req.query.outputsize ? z.coerce.number().int().min(50).max(5000).parse(req.query.outputsize) : undefined,
      minScore: req.query.minScore ? z.coerce.number().min(1).max(100).parse(req.query.minScore) : undefined,
    };
    res.json({ok:true,data:await evaluateSetup(symbol, options)});
  } catch(e){next(e);}
});
export default router;
