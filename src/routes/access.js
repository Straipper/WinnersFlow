import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAccessState } from '../middleware/access.js';

const router = express.Router();

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, access: await getAccessState(req.user) });
  } catch (error) { next(error); }
});

export default router;
