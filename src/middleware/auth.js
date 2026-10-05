import { getUserFromToken } from '../services/auth.js';

function extractBearer(req) {
  const header = req.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    req.authToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return next();
  getUserFromToken(token)
    .then(user => { req.user = user ?? null; req.authToken = token; next(); })
    .catch(next);
}
