import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { startEmailWorker } from './services/emailQueue.js';
import { startExpiryWorker } from './services/expiryWorker.js';
import { startSettlementWorker } from './services/settlementWorker.js';
import { startNotificationScheduler } from './services/notificationScheduler.js';
import { pool } from './db/pool.js';

const app = express();
// One hop only (the host nginx). `true` trusts every hop, which makes req.ip
// the leftmost X-Forwarded-For entry — a value the client sets. The rate
// limiters key on it, so rotating the header defeated the login and
// password-reset limits entirely. Set TRUST_PROXY_HOPS if a CDN is added.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// ── Security headers ───────────────────────────────────────────────────────
// "API-only, no CSP needed" was the old reasoning, and it was wrong: this API
// serves files people uploaded, from the same origin as the portal. Uploads are
// now type-checked and sent as downloads, but a CSP is the layer that holds if
// any of that is ever bypassed — nothing this API returns should be allowed to
// execute or to fetch anything.
//
// 'none' across the board is safe here precisely because this is an API: no
// response is a page. Downloads are unaffected — sandbox and frame-ancestors
// govern rendering, not transfer.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'script-src': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
      'sandbox': [],
    },
  },
  crossOriginResourcePolicy: false,
}));

// ── CORS: allowlist via CORS_ORIGINS="https://truehr.co.in,https://www.truehr.co.in"
// (unset = allow all, for local dev and same-origin proxy setups).
const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));

app.use(express.json({ limit: '20mb' })); // signature data URLs + offer-letter PDFs can be large
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ── Rate limits ──────────────────────────────────────────────────────────────
// Brute-force protection on credential endpoints; generous global ceiling.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — try again in a few minutes' },
});
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, limit: 1500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/web-sso', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api', apiLimiter);

// ── Health probes ────────────────────────────────────────────────────────────
// Mounted twice on purpose. nginx only forwards `^~ /api/`, so the bare paths
// were unreachable from outside and both documented verification commands 404'd
// — nothing was actually watching the API.
const health = (req, res) => res.json({ ok: true, service: 'truehr-api' });
app.get('/health', health);
app.get('/api/health', health);
app.get(['/health/ready', '/api/health/ready'], async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
  catch { res.status(503).json({ ok: false, db: 'down' }); }
});

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[truehr-api] listening on http://localhost:${config.port} (${config.env})`);
  startEmailWorker();
  startExpiryWorker();
  startSettlementWorker();
  startNotificationScheduler();
});

// ── Graceful shutdown (docker stop / deploys): drain HTTP, then close the pool.
function shutdown(signal) {
  console.log(`[truehr-api] ${signal} received — shutting down`);
  server.close(() => {
    pool.end().catch(() => {}).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // hard stop safety net
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
