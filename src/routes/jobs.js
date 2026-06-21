import express from 'express';
import * as queries from '../db/queries.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get list of unique locations
router.get('/locations', (req, res) => {
  try {
    const locations = queries.getUniqueLocations();
    res.json(locations);
  } catch (err) {
    logger.error('Failed to get locations list', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve locations list.' });
  }
});

// Get filtered list of jobs
router.get('/', (req, res) => {
  try {
    const keyword = req.query.keyword || '';
    const titleKeyword = req.query.titleKeyword || '';
    const excludeTitleKeyword = req.query.excludeTitleKeyword || '';
    const locations = req.query.locations || '';
    const status = req.query.status || '';
    const jobType = req.query.jobType || '';
    const techOnly = req.query.techOnly || '';
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 25;
    const offset = (page - 1) * limit;

    const result = queries.getFilteredJobs({
      keyword,
      titleKeyword,
      excludeTitleKeyword,
      locations,
      status,
      jobType,
      techOnly,
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

// Generate Telegram message preview for currently filtered jobs
router.post('/telegram-preview', (req, res) => {
  try {
    const keyword = req.body.keyword || '';
    const titleKeyword = req.body.titleKeyword || '';
    const excludeTitleKeyword = req.body.excludeTitleKeyword || '';
    const locations = req.body.locations || '';
    const status = req.body.status || '';
    const jobType = req.body.jobType || '';
    const techOnly = req.body.techOnly || '';

    // Fetch all matching jobs without pagination limits
    const result = queries.getFilteredJobs({
      keyword,
      titleKeyword,
      excludeTitleKeyword,
      locations,
      status,
      jobType,
      techOnly,
      limit: null,
      offset: 0
    });

    const jobs = result.jobs;
    if (jobs.length === 0) {
      return res.json({ text: '', count: 0 });
    }

    // Helper to escape HTML tags for Telegram parse_mode: HTML
    const escapeHTML = (text) => {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    // Group by company
    const grouped = {};
    jobs.forEach(job => {
      if (!grouped[job.company_name]) {
        grouped[job.company_name] = [];
      }
      grouped[job.company_name].push(job);
    });

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const todayStr = new Date().toLocaleDateString('en-US', dateOptions);

    let message = `<b>📅 Jobs Broadcast — ${todayStr}</b>\n`;
    message += `Total Vetted Postings: <b>${jobs.length}</b>\n\n`;
    for (const [company, companyJobs] of Object.entries(grouped)) {
      message += `<b>🏢 ${escapeHTML(company)}</b>\n`;
      companyJobs.forEach(job => {
        const details = [];
        if (job.location) details.push(escapeHTML(job.location));
        if (job.salary_range) details.push(escapeHTML(job.salary_range));
        else if (job.job_type) details.push(escapeHTML(job.job_type));

        const detailsStr = details.length > 0 ? ` | ${details.join(' | ')}` : '';
        const escapedTitle = escapeHTML(job.title);

        if (job.job_url) {
          message += `• <a href="${escapeHTML(job.job_url)}">${escapedTitle}</a>${detailsStr}\n`;
        } else {
          message += `• ${escapedTitle}${detailsStr}\n`;
        }
      });
      message += `\n`;
    }

    res.json({ text: message.trim(), count: jobs.length });
  } catch (err) {
    logger.error('Failed to generate Telegram preview', { error: err.message });
    res.status(500).json({ error: 'Failed to generate Telegram preview.' });
  }
});

// Helper for resilient fetch requests with retry logic and detailed error parsing
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      const isLastAttempt = attempt === retries;
      let errMsg = err.message;
      
      if (err.cause) {
        if (err.cause.name === 'AggregateError' && Array.isArray(err.cause.errors)) {
          errMsg = `${err.message} (Cause: AggregateError: [${err.cause.errors.map(e => e.message).join(', ')}])`;
        } else {
          errMsg = `${err.message} (Cause: ${err.cause.message || err.cause})`;
        }
      } else if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
        errMsg = `AggregateError: [${err.errors.map(e => e.message).join(', ')}]`;
      }

      logger.warn(`Fetch attempt ${attempt} failed. Url: ${url}. Error: ${errMsg}`);
      
      if (isLastAttempt) {
        const finalErr = new Error(errMsg);
        finalErr.originalError = err;
        throw finalErr;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
    }
  }
}

// Send message to Telegram group
router.post('/telegram-send', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({ error: 'Telegram credentials are not configured on the server.' });
  }

  try {
    // Split message into chunks of max 4000 characters to prevent hitting Telegram's 4096 limit
    const chunks = [];
    if (text.length <= 4000) {
      chunks.push(text);
    } else {
      const lines = text.split('\n');
      let currentChunk = '';
      for (const line of lines) {
        if ((currentChunk + '\n' + line).length > 4000) {
          chunks.push(currentChunk.trim());
          currentChunk = line;
        } else {
          currentChunk = currentChunk ? currentChunk + '\n' + line : line;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
    }

    for (const chunk of chunks) {
      const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetchWithRetry(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      const resData = await response.json();
      if (!response.ok || !resData.ok) {
        throw new Error(resData.description || `Telegram API returned status ${response.status}`);
      }
    }

    res.json({ message: 'Message sent successfully to Telegram!' });
  } catch (err) {
    logger.error('Failed to send Telegram message', { error: err.message });
    res.status(500).json({ error: `Failed to send Telegram message: ${err.message}` });
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
