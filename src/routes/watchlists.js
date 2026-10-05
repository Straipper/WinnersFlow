import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { addSymbol, createWatchlist, deleteWatchlist, ensureDefaultWatchlist, getWatchlist, listWatchlists, removeSymbol, renameWatchlist, reorderSymbols } from '../repositories/watchlistRepository.js';

const router=Router();
router.use(requireAuth);
const id=z.string().uuid();
const name=z.string().trim().min(1).max(80);
const symbol=z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);

router.get('/', async (req,res,next)=>{ try {
  await ensureDefaultWatchlist(req.user.id);
  res.json({ok:true,data:await listWatchlists(req.user.id)});
} catch(e){next(e);} });

router.post('/', async (req,res,next)=>{ try {
  const input=z.object({name}).parse(req.body);
  res.status(201).json({ok:true,data:await createWatchlist(req.user.id,input.name)});
} catch(e){next(e);} });

router.get('/:id', async (req,res,next)=>{ try {
  const item=await getWatchlist(req.user.id,id.parse(req.params.id));
  if(!item) return res.status(404).json({error:'Watchlist not found'});
  res.json({ok:true,data:item});
} catch(e){next(e);} });

router.patch('/:id', async (req,res,next)=>{ try {
  const input=z.object({name}).parse(req.body);
  const item=await renameWatchlist(req.user.id,id.parse(req.params.id),input.name);
  if(!item) return res.status(404).json({error:'Watchlist not found'});
  res.json({ok:true,data:item});
} catch(e){next(e);} });

router.delete('/:id', async (req,res,next)=>{ try {
  const watchlistId=id.parse(req.params.id);
  const deleted=await deleteWatchlist(req.user.id,watchlistId);
  if(!deleted) return res.status(404).json({error:'Watchlist not found'});
  res.json({ok:true});
} catch(e){next(e);} });

router.post('/:id/items', async (req,res,next)=>{ try {
  const input=z.object({symbol,sortOrder:z.number().int().min(0).max(100000).optional()}).parse(req.body);
  const item=await addSymbol(req.user.id,id.parse(req.params.id),input.symbol.toUpperCase(),input.sortOrder);
  if(!item) return res.status(404).json({error:'Watchlist not found'});
  res.status(201).json({ok:true,data:item});
} catch(e){next(e);} });

router.delete('/:id/items/:symbol', async (req,res,next)=>{ try {
  const removed=await removeSymbol(req.user.id,id.parse(req.params.id),symbol.parse(req.params.symbol).toUpperCase());
  if(!removed) return res.status(404).json({error:'Watchlist item not found'});
  res.json({ok:true});
} catch(e){next(e);} });

router.put('/:id/items/order', async (req,res,next)=>{ try {
  const input=z.object({symbols:z.array(symbol).max(500)}).parse(req.body);
  const item=await getWatchlist(req.user.id,id.parse(req.params.id));
  if(!item) return res.status(404).json({error:'Watchlist not found'});
  res.json({ok:true,data:await reorderSymbols(req.user.id,item.id,input.symbols.map(s=>s.toUpperCase()))});
} catch(e){next(e);} });

export default router;
