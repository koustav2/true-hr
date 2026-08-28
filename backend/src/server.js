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
app.set('trust proxy', true);

// ── Security headers (API-only service: no CSP needed, keep the rest) ───────
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

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
app.get('/health', (req, res) => res.json({ ok: true, service: 'truehr-api' }));
app.get('/health/ready', async (req, res) => {
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
