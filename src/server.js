import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import health from './routes/health.js';
import market from './routes/market.js';
import auth from './routes/auth.js';
import flow from './routes/flow.js';
import advancedFlow from './routes/advancedFlow.js';
import levels from './routes/levels.js';
import setup from './routes/setup.js';
import confirm from './routes/confirm.js';
import scanner from './routes/scanner.js';
import sofia from './routes/sofia.js';
import albert from './routes/albert.js';
import alerts from './routes/alerts.js';
import backtest from './routes/backtest.js';
import journal from './routes/journal.js';
import watchlists from './routes/watchlists.js';
import billing, { handleStripeWebhook } from './routes/billing.js';
import access from './routes/access.js';
import email from './routes/email.js';
import admin from './routes/admin.js';
import analytics from './routes/analytics.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { requireAuth } from './middleware/auth.js';
import { requireProductAccess } from './middleware/access.js';
import { attachLiveMarket } from './services/liveMarket.js';
import { addRequestId, rateLimit, securityHeaders } from './middleware/security.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const app=express();
app.disable('x-powered-by');
app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
app.use(addRequestId);
app.use(securityHeaders);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
const allowedOrigins = env.CORS_ORIGIN.split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin denied'));
  },
  credentials: false,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Stripe-Signature','X-Request-Id'],
}));
app.use(rateLimit({ scope: 'global', windowMs: 60_000, max: 600 }));
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req,res,next) => {
  try {
    const result = await handleStripeWebhook(req.body, req.get('stripe-signature'));
    res.json(result);
  } catch (e) { next(e); }
});
app.use(express.json({limit:'50kb', strict:true}));
app.use(morgan('tiny'));
app.use(express.static(PUBLIC_DIR));
app.get('/',(req,res)=>res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/portal',(req,res)=>res.sendFile(path.join(PUBLIC_DIR, 'portal.html')));
app.use('/api/health',health);
app.use('/api/auth',auth);
app.use('/api/billing',billing);
app.use('/api/access',access);
app.use('/api/email',email);
app.use('/api/admin',admin);
app.use('/api/analytics',analytics);

// Core DT FLOW product endpoints require both authentication and an active
// trial/subscription. Admin accounts bypass billing through requireProductAccess.
const productGuard = [requireAuth, requireProductAccess];
app.use('/api/market',...productGuard,market);
app.use('/api/flow',...productGuard,flow);
app.use('/api/flow-data',...productGuard,advancedFlow);
app.use('/api/levels',...productGuard,levels);
app.use('/api/setup',...productGuard,setup);
app.use('/api/confirm',...productGuard,confirm);
app.use('/api/scanner',...productGuard,scanner);
app.use('/api/sofia',...productGuard,sofia);
app.use('/api/albert',...productGuard,albert);
app.use('/api/alerts',...productGuard,alerts);
app.use('/api/backtest',...productGuard,backtest);
app.use('/api/journal',...productGuard,journal);
app.use('/api/watchlists',...productGuard,watchlists);
app.use(notFound);
app.use(errorHandler);

const server=http.createServer(app);
attachLiveMarket(server);
const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down DT FLOW...`);
  server.close(async () => {
    try {
      const { pool } = await import('./db/pool.js');
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 15_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
server.listen(env.PORT,()=>console.log(`DT FLOW API listening on :${env.PORT}`));
