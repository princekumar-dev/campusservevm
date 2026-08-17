import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { connectToDatabase, getPool, closeDatabase } from './lib/pg.js';
import { authenticate } from './lib/auth.js';
import { parseAllowedOrigins, validateProductionEnvironment } from './lib/env.js';
import { ensureServiceAccount } from './lib/ensureServiceAccount.js';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

validateProductionEnvironment();

// Render terminates HTTPS in a single reverse-proxy hop. Trusting exactly that
// hop lets Express derive req.ip from X-Forwarded-For without trusting arbitrary
// client-supplied addresses.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      workerSrc: ["'self'", 'blob:']
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// Compress JSON and static responses before they cross the network. Large
// lists, dashboards and report payloads transfer substantially faster while
// already-compressed images and files are left untouched by this middleware.
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS !== 'false' && !req.secure) {
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`)
  }
  next()
})

// Rate limiting - 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Use Express's proxy-aware client IP explicitly. This also prevents
  // express-rate-limit from trying to interpret Render's Forwarded header.
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// CORS configuration for production
const allowedOrigins = parseAllowedOrigins();

app.use(cors({
  origin: function (origin, callback) {
    // Non-browser clients do not send Origin. Authentication still applies.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }

    const msg = `CORS not allowed for origin: ${origin}`;
    return callback(new Error(msg), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-User-Role', 'X-User-Email'],
  maxAge: 86400
}));

// Global CORS is already applied above, explicit OPTIONS handler removed

const payloadLimitMb = Math.min(Math.max(Number(process.env.MAX_REQUEST_SIZE_MB || 10), 1), 25)
app.use(express.json({ limit: `${payloadLimitMb}mb` }));
app.use(express.urlencoded({ limit: `${payloadLimitMb}mb`, extended: false }));

// Lightweight timing middleware to log slow requests (helps diagnose slow deployed API)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    // Atlas-backed requests commonly take around one network round trip. Keep
    // the threshold configurable and reserve warnings for actionable latency.
    const slowRequestThresholdMs = Number(process.env.SLOW_REQUEST_THRESHOLD_MS || 1000);
    if (ms > slowRequestThresholdMs) {
      console.warn(`Slow request: ${req.method} ${req.originalUrl} - ${ms}ms`);
    }
  });
  next();
});

// Cache control for static assets (CSS, JS, images)
app.use((req, res, next) => {
  // For hashed assets (CSS/JS with [hash] in filename), use aggressive caching
  if (req.url.match(/\.(css|js)$/) && req.url.includes('-')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // For HTML files, no caching to ensure users get latest version
  else if (req.url.match(/\.html$/) || req.url === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  // For images and other assets, moderate caching
  else if (req.url.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

// JWT authentication middleware — applied to all /api routes except login
app.use('/api', async (req, res, next) => {
  // Skip auth for OPTIONS preflight, login endpoint, and health probes
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/auth' && req.method === 'POST') return next();
  // Faculty/staff may self-register as requesters. Authenticated user creation
  // still flows through JWT validation and is restricted in the users handler.
  if (req.path === '/users' && req.method === 'POST' && !req.headers.authorization) return next();
  if (req.path === '/health') return next();

  authenticate(req, res, next);
});

// A small server-side cache removes repeated Atlas round trips for the list and
// dashboard APIs. It is deliberately private (keyed by the authenticated user)
// and is cleared for every write, so one user's data is never shared with
// another and successful updates are immediately visible.
const apiReadCache = new Map();
const cacheableApiPaths = new Set([
  '/api/requests', '/api/reports', '/api/purchase-orders', '/api/quotations',
  '/api/work-orders', '/api/service-orders', '/api/vendors', '/api/deliveries',
  '/api/gate', '/api/grn', '/api/stock'
]);
const API_READ_CACHE_MS = Math.max(1000, Number(process.env.API_READ_CACHE_MS || 15000));

app.use('/api', async (req, res, next) => {
  if (req.method !== 'GET') {
    apiReadCache.clear();
    // A read that races an in-progress update must not remain cached after the
    // update succeeds.
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) apiReadCache.clear();
    });
    return next();
  }
  if (!cacheableApiPaths.has(req.path)) return next();

  const user = req.user || {};
  const identity = `${user.id || req.headers['x-user-id'] || ''}:${user.role || req.headers['x-user-role'] || ''}:${user.email || req.headers['x-user-email'] || ''}`;
  const key = `${identity}:${req.originalUrl}`;
  const now = Date.now();
  const existing = apiReadCache.get(key);
  if (existing && existing.expiresAt > now) {
    const cachedResponse = await existing.promise;
    if (cachedResponse) {
      res.setHeader('X-CampusServe-Cache', 'HIT');
      return res.status(cachedResponse.status).json(cachedResponse.body);
    }
  }
  if (existing) apiReadCache.delete(key);

  let resolveResponse;
  const entry = {
    expiresAt: now + API_READ_CACHE_MS,
    promise: new Promise(resolve => { resolveResponse = resolve; })
  };
  apiReadCache.set(key, entry);
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      resolveResponse({ status: res.statusCode, body });
      res.setHeader('X-CampusServe-Cache', 'MISS');
    } else {
      apiReadCache.delete(key);
      resolveResponse(null);
    }
    return originalJson(body);
  };
  res.on('finish', () => {
    if (!res.headersSent || res.statusCode < 200 || res.statusCode >= 300) {
      apiReadCache.delete(key);
      resolveResponse(null);
    }
  });
  next();
});

// Serve static files from /public at the site root (ensures /service-worker.js is available)
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir, {
  setHeaders: (res, filePath) => {
    // Ensure service worker and HTML are not aggressively cached
    if (filePath.endsWith('service-worker.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// API routes
import authHandler from './api/auth.js';
import usersHandler from './api/users.js';
import settingsHandler from './api/settings.js';
import requestsHandler from './api/requests.js';
import quotationsHandler from './api/quotations.js';
import workOrdersHandler from './api/work-orders.js';
import invoicesHandler from './api/invoices.js';
import paymentsHandler from './api/payments.js';
import reportsHandler from './api/reports.js';
import generatePdfHandler from './api/generate-pdf.js';
import grnExportHandler from './api/grn-export.js';
import notificationsRouter from './api/notifications.js';
import stockHandler from './api/stock.js';
import vendorsHandler from './backend/vendors.js';
import purchaseOrdersHandler from './backend/purchase-orders.js';
import serviceOrdersHandler from './backend/service-orders.js';
import deliveriesHandler from './backend/deliveries.js';
import gateHandler from './backend/gate.js';
import grnHandler from './backend/grn.js';

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug', (req, res) => res.json({ message: 'CampusServe API', timestamp: new Date().toISOString() }));
}

// Health endpoint: quick DB connection state and server timestamp
app.get('/api/health', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT 1 as ok')
    const ok = result.rows[0]?.ok === 1
    res.status(ok ? 200 : 503).json({ ok, timestamp: new Date().toISOString(), database: ok ? 'connected' : 'unavailable' });
  } catch (err) {
    res.status(503).json({ ok: false, timestamp: new Date().toISOString(), database: 'unavailable' });
  }
});

app.all('/api/auth', authLimiter, authHandler);
app.all('/api/users', usersHandler);
app.all('/api/settings', settingsHandler);
app.all('/api/requests', requestsHandler);
app.all('/api/quotations', quotationsHandler);
app.all('/api/work-orders', workOrdersHandler);
app.all('/api/invoices', invoicesHandler);
app.all('/api/payments', paymentsHandler);
app.all('/api/reports', reportsHandler);
app.all('/api/generate-pdf', generatePdfHandler);
app.all('/api/grn-export', grnExportHandler);
app.use('/api/notifications', notificationsRouter);
app.all('/api/stock', stockHandler);
app.all('/api/vendors', vendorsHandler);
app.all('/api/purchase-orders', purchaseOrdersHandler);
app.all('/api/service-orders', serviceOrdersHandler);
app.all('/api/deliveries', deliveriesHandler);
app.all('/api/gate', gateHandler);
app.all('/api/grn', grnHandler);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, error: 'API route not found' })
  next()
})

// Nginx normally serves dist directly. This fallback also makes the Node
// process a complete single-service deployment when a reverse proxy is absent.
const distDir = path.join(process.cwd(), 'dist')
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: false, maxAge: '1d' }))
  app.get('/{*splat}', (req, res, next) => {
    if (!req.accepts('html')) return next()
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    return res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  console.error('[REQUEST ERROR]', err?.message || err)
  if (res.headersSent) return next(err)
  return res.status(err?.status || 500).json({ success: false, error: err?.status ? err.message : 'Internal server error' })
})

let server
async function start() {
  await connectToDatabase()
  console.log('PostgreSQL connected and schema verified')
  const serviceAccount = await ensureServiceAccount()
  if (serviceAccount) console.log(`Service portal account ready: ${process.env.SERVICE_PORTAL_EMAIL}`)

  server = app.listen(PORT, HOST, () => {
    console.log(`CampusServe listening on http://${HOST}:${PORT}`)
  })
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`)
  if (server) await new Promise(resolve => server.close(resolve))
  await closeDatabase()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch(error => {
  console.error('Fatal startup error:', error.message)
  process.exit(1)
})

// Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
  process.exitCode = 1
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  process.exit(1)
});
