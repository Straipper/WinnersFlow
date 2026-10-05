import { Router } from 'express';
import { z } from 'zod';
import { clearAlert, evaluateAlert, getActiveAlerts, scanAlerts } from '../services/alertEngine.js';

const router = Router();
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9./_-]+$/);

router.get('/', (req, res) => res.json({ ok: true, data: getActiveAlerts() }));

router.get('/scan', async (req, res, next) => {
  try {
    const symbols = String(req.query.symbols || 'NVDA,AAPL,MSFT,AMD,TSLA,META')
      .split(',').map(s => s.trim()).filter(Boolean);
    res.json({ ok: true, data: await scanAlerts(symbols) });
  } catch (e) { next(e); }
});

router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    res.json({ ok: true, data: await evaluateAlert(symbol) });
  } catch (e) { next(e); }
});

router.delete('/:symbol', (req, res, next) => {
  try {
    const symbol = symbolSchema.parse(req.params.symbol);
    res.json({ ok: true, removed: clearAlert(symbol) });
  } catch (e) { next(e); }
});

export default router;
