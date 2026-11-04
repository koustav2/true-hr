import app from './app.js';
import { config } from './config/index.js';
import { pool } from './db/pool.js';
import { startEmailWorker } from './services/emailQueue.js';
import { startExpiryWorker } from './services/expiryWorker.js';
import { startSettlementWorker } from './services/settlementWorker.js';
import { startExitWorker } from './services/exitWorker.js';
import { startNotificationScheduler } from './services/notificationScheduler.js';

const server = app.listen(config.port, () => {
  console.log(`[truehr-api] listening on http://localhost:${config.port} (${config.env})`);
  startEmailWorker();
  startExpiryWorker();
  startSettlementWorker();
  startExitWorker();
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
// Last line of defence: log a stray rejection instead of letting it end the process.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
