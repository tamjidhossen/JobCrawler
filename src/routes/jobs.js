import express from 'express';
import * as queries from '../db/queries.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get filtered list of jobs
router.get('/', (req, res) => {
  try {
    const keyword = req.query.keyword || '';
    const titleKeyword = req.query.titleKeyword || '';
    const companyId = req.query.companyId ? parseInt(req.query.companyId) : null;
    const status = req.query.status || '';
    const jobType = req.query.jobType || '';
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 25;
    const offset = (page - 1) * limit;

    const result = queries.getFilteredJobs({
      keyword,
      titleKeyword,
      companyId,
      status,
      jobType,
      limit,
      offset
    });

    res.json({
      jobs: result.jobs,
      pagination: {
        total: result.total,
        page,
        limit,
        pages: Math.ceil(result.total / limit)
      }
    });
  } catch (err) {
    logger.error('Failed to get jobs list', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve jobs list.' });
  }
});

// Get global statistics
router.get('/stats', (req, res) => {
  try {
    const stats = queries.getJobStats();
    res.json(stats);
  } catch (err) {
    logger.error('Failed to get job statistics', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve statistics.' });
  }
});

// Delete/Dismiss a job listing
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    queries.deleteJob(id);
    res.json({ message: 'Job dismissed successfully.' });
  } catch (err) {
    logger.error(`Failed to delete job ID ${id}`, { error: err.message });
    res.status(500).json({ error: 'Failed to delete job.' });
  }
});

export default router;
