import crypto from 'node:crypto';

const buckets = new Map();
const WINDOW_MS = 60_000;
const CLEANUP_MS = 5 * 60_000;
let lastCleanup = Date.now();

function clientKey(req, scope) {
  const forwarded = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${scope}:${ip}`;
}

export function rateLimit({ windowMs = WINDOW_MS, max = 60, scope = 'default', message = 'Too many requests. Please try again shortly.' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > CLEANUP_MS) {
      for (const [key, value] of buckets) if (now - value.startedAt > value.windowMs) buckets.delete(key);
      lastCleanup = now;
    }
    const key = clientKey(req, scope);
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0, windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.startedAt + windowMs) / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }
    next();
  };
}

export function addRequestId(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  const id = /^[A-Za-z0-9._:-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}
