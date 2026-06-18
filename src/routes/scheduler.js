import express from 'express';
import * as queries from '../db/queries.js';
import { scheduler } from '../services/scheduler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get scheduler configuration & status
router.get('/', (req, res) => {
  try {
    const config = queries.getSchedulerConfig();
    res.json({
      ...config,
      is_scraping: scheduler.isScraping
    });
  } catch (err) {
    logger.error('Failed to get scheduler config', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve scheduler configuration.' });
  }
});

// Update scheduler configuration (interval, start/pause)
router.put('/', async (req, res) => {
  const { interval_hours, is_running } = req.body;

  try {
    const parsedInterval = interval_hours !== undefined ? parseFloat(interval_hours) : null;
    const parsedRunning = is_running !== undefined ? (is_running ? 1 : 0) : null;

    queries.updateSchedulerConfig(parsedInterval, parsedRunning);

    // Apply immediately to running scheduler
    if (parsedRunning !== null) {
      if (parsedRunning === 1) {
        scheduler.start();
      } else {
        scheduler.stop();
      }
    } else {
      // Re-trigger tick to calculate new next run if interval changed
      scheduler.stop();
      scheduler.start();
    }

    const updated = queries.getSchedulerConfig();
    res.json({
      message: 'Scheduler configuration updated successfully.',
      config: {
        ...updated,
        is_scraping: scheduler.isScraping
      }
    });
  } catch (err) {
    logger.error('Failed to update scheduler config', { error: err.message });
    res.status(500).json({ error: 'Failed to update scheduler configuration.' });
  }
});

// Trigger scraping for all companies immediately in the background
router.post('/scrape-all', async (req, res) => {
  try {
    const result = await scheduler.triggerManualScrapeAll();
    res.json(result);
  } catch (err) {
    logger.error('Failed to trigger manual scrape cycle', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Retrieve recent scrape logs
router.get('/logs', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  try {
    const logs = queries.getRecentLogs(limit);
    res.json(logs);
  } catch (err) {
    logger.error('Failed to get scrape logs', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve scrape logs.' });
  }
});

export default router;
