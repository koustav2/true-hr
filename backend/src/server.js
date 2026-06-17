import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { startEmailWorker } from './services/emailQueue.js';
import { startExpiryWorker } from './services/expiryWorker.js';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '20mb' })); // signature data URLs + offer-letter PDFs can be large
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'truehr-api' }));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[truehr-api] listening on http://localhost:${config.port}`);
  startEmailWorker();
  startExpiryWorker();
});
