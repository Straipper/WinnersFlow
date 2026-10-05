import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { isAnalyticsEventName, trackEvent } from '../services/analytics.js';
import { rateLimit } from '../middleware/security.js';

const router = express.Router();

const eventSchema = z.object({
  eventName: z.string().min(1).max(64),
  visitorId: z.string().max(128).optional().nullable(),
  sessionId: z.string().max(128).optional().nullable(),
  path: z.string().max(500).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Public event collector for page views and pre-auth funnel events.
router.post('/event', rateLimit({ scope: 'analytics-public', windowMs: 60_000, max: 120 }), async (req, res, next) => {
  try {
    const data = eventSchema.parse(req.body ?? {});
    if (!isAnalyticsEventName(data.eventName)) return res.status(400).json({ error: 'Unsupported analytics event.' });
    const result = await trackEvent(data);
    res.status(201).json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// Authenticated users may record an event with their user id attached.
router.post('/event/authenticated', requireAuth, rateLimit({ scope: 'analytics-auth', windowMs: 60_000, max: 180 }), async (req, res, next) => {
  try {
    const data = eventSchema.parse(req.body ?? {});
    if (!isAnalyticsEventName(data.eventName)) return res.status(400).json({ error: 'Unsupported analytics event.' });
    const result = await trackEvent({ ...data, userId: req.user.id });
    res.status(201).json({ ok: true, ...result });
  } catch (e) { next(e); }
});

export default router;
