import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { emailConfigured, sendTemplate } from '../services/email.js';
const router=express.Router();
router.get('/status',requireAuth,(req,res)=>res.json({ok:true,configured:emailConfigured()}));
router.post('/test',requireAuth,async(req,res,next)=>{try{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const to=req.body?.to||req.user.email;const result=await sendTemplate('welcome',to,{username:'DT FLOW Admin',userId:req.user.id});res.json({ok:true,...result});}catch(e){next(e);}});
export default router;
