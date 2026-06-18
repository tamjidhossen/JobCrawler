import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './src/db/schema.js';
import { scheduler } from './src/services/scheduler.js';
import { logger } from './src/utils/logger.js';

// Load route routers
import companiesRouter from './src/routes/companies.js';
import jobsRouter from './src/routes/jobs.js';
import schedulerRouter from './src/routes/scheduler.js';

// Load env vars
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB schema & connections
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/companies', companiesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/scheduler', schedulerRouter);

// Fallback to SPA index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start scheduler service
scheduler.start();

// Start web server
const server = app.listen(PORT, () => {
  logger.info(`Job Tracker web dashboard is running on: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  logger.info('Shutting down server gracefully...');
  scheduler.stop();
  server.close(() => {
    logger.info('Express server closed.');
    process.exit(0);
  });
}
