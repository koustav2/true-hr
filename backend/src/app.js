import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import routes from './routes/index.js';
import v2routes from './routes/v2/index.js';
import { markVersion } from './utils/apiVersion.js';
import { notFound, errorHandler } from './middleware/error.js';
import { pool } from './db/pool.js';

// The Express app, without listen() or workers, so tests can mount it on a
// throwaway port (scripts/v2/_harness.js). server.js is the process entry.
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
if (process.env.HTTP_LOG !== '0') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ── Rate limits ──────────────────────────────────────────────────────────────
// Brute-force protection on credential endpoints; generous global ceiling.
const authLimiter = rateLimit({
  // AUTH_RATE_LIMIT exists for the automated suites only; production uses 20.
  windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — try again in a few minutes' },
});
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, limit: 1500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});
// The demo form is the only unauthenticated write on the API, so it gets a far
// tighter ceiling than the rest: a genuine visitor books once, and a handful of
// attempts an hour is already generous for somebody mistyping their email.
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 8,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please email us instead' },
});
app.use(['/api/public/', '/api/v2/public/'], publicFormLimiter);
for (const p of ['/auth/login', '/auth/web-sso', '/auth/forgot-password', '/auth/reset-password', '/auth/set-password']) {
  app.use([`/api${p}`, `/api/v2${p}`], authLimiter);
}
app.use('/api', apiLimiter);

// ── Health probes ────────────────────────────────────────────────────────────
// Mounted twice on purpose. nginx only forwards `^~ /api/`, so the bare paths
// were unreachable from outside and both documented verification commands 404'd
// — nothing was actually watching the API.
const health = (req, res) => res.json({ ok: true, service: 'truehr-api' });
app.get('/health', health);
app.get(['/api/health', '/api/v2/health'], health);
app.get(['/health/ready', '/api/health/ready', '/api/v2/health/ready'], async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
  catch { res.status(503).json({ ok: false, db: 'down' }); }
});

// v2 first: its own routes (new endpoints, changed contracts), then every v1
// route, which reads req.apiVersion where behaviour differs. v1 is untouched.
app.use('/api/v2', markVersion(2), v2routes, routes);
app.use('/api', markVersion(1), routes);
app.use(notFound);
app.use(errorHandler);

export default app;
