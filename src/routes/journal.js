import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createJournalEntry, getJournalEntry, getJournalStats, listJournalEntries, updateJournalEntry } from '../repositories/journalRepository.js';

const router = Router();
router.use(requireAuth);

const idSchema = z.string().uuid();
const createSchema = z.object({
  setupId: z.string().uuid().optional().nullable(),
  symbol: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/),
  side: z.enum(['long','short']).optional().nullable(),
  entryPrice: z.number().finite().optional().nullable(),
  exitPrice: z.number().finite().optional().nullable(),
  pnl: z.number().finite().optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
  setupSnapshot: z.record(z.string(), z.any()).optional(),
  resultStatus: z.enum(['open','win','loss','breakeven','cancelled']).optional().nullable(),
  rMultiple: z.number().finite().optional().nullable(),
  outcomeReason: z.string().max(2000).optional().nullable(),
  openedAt: z.string().datetime().optional().nullable(),
  closedAt: z.string().datetime().optional().nullable()
});

const updateSchema = createSchema.partial().omit({symbol:true, side:true, setupId:true, setupSnapshot:true});

router.get('/', async (req,res,next)=>{
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100),1),250);
    res.json({ok:true,data:await listJournalEntries(req.user.id,limit)});
  } catch(e){next(e);}
});

router.get('/stats', async (req,res,next)=>{
  try { res.json({ok:true,data:await getJournalStats(req.user.id)}); } catch(e){next(e);}
});

router.get('/:id', async (req,res,next)=>{
  try {
    const id=idSchema.parse(req.params.id);
    const entry=await getJournalEntry(req.user.id,id);
    if(!entry) return res.status(404).json({error:'Journal entry not found'});
    res.json({ok:true,data:entry});
  } catch(e){next(e);}
});

router.post('/', async (req,res,next)=>{
  try {
    const input=createSchema.parse(req.body);
    // Snapshot the setup at journal creation when a setup is supplied.
    if(input.setupId && !input.setupSnapshot) {
      const { query } = await import('../db/pool.js');
      const { rows } = await query('SELECT * FROM setups WHERE id=$1 LIMIT 1',[input.setupId]);
      if(rows[0]) input.setupSnapshot=rows[0];
    }
    const entry=await createJournalEntry({...input,userId:req.user.id});
    res.status(201).json({ok:true,data:entry});
  } catch(e){next(e);}
});

router.patch('/:id', async (req,res,next)=>{
  try {
    const id=idSchema.parse(req.params.id);
    const input=updateSchema.parse(req.body);
    const entry=await updateJournalEntry(req.user.id,id,input);
    if(!entry) return res.status(404).json({error:'Journal entry not found'});
    res.json({ok:true,data:entry});
  } catch(e){next(e);}
});

export default router;
