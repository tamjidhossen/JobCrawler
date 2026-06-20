import * as queries from '../db/queries.js';
import { crawlCompany, closeBrowser } from './scraper.js';
import { batchExtractJobs } from './gemini.js';
import { processJobDiffs, generateFingerprint } from './diff-engine.js';
import { logger } from '../utils/logger.js';

class SchedulerService {
  constructor() {
    this.timer = null;
    this.isScraping = false;
  }

  /** Start the scheduler loop */
  async start() {
    if (this.timer) {
      logger.info('Scheduler already running.');
      return;
    }
    logger.info('Starting Scheduler service...');

    // Prevent immediate scrape on startup if overdue
    const config = queries.getSchedulerConfig();
    if (config && config.is_running) {
      const lastRun = config.last_run_at ? new Date(config.last_run_at).getTime() : 0;
      const intervalMs = config.interval_hours * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastRun >= intervalMs) {
        const nowStr = new Date(now).toISOString();
        const nextStr = new Date(now + intervalMs).toISOString();
        queries.updateSchedulerRunTimes(nowStr, nextStr);
        logger.info(`[Scheduler] Scrape cycle was overdue on startup. Resetting schedule (next run in ${config.interval_hours} hours) to prevent immediate crawling.`);
      }
    }

    await this.tick();
  }

  /** Stop the scheduler loop */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      logger.info('Scheduler service stopped.');
    }
  }

  /** Clock tick — decides whether to run now or schedule next run */
  async tick() {
    try {
      const config = queries.getSchedulerConfig();
      if (!config) {
        this.timer = setTimeout(() => this.tick(), 60000);
        return;
      }

      if (!config.is_running) {
        logger.info('Scheduler paused. Re-checking in 1 minute...');
        this.timer = setTimeout(() => this.tick(), 60000);
        return;
      }

      const lastRun = config.last_run_at ? new Date(config.last_run_at).getTime() : 0;
      const intervalMs = config.interval_hours * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastRun >= intervalMs) {
        this.runScrapeCycle().catch(err => {
          logger.error('Scrape cycle error', { error: err.message });
        });
      } else {
        const nextRunTime = lastRun + intervalMs;
        const delay = Math.max(10000, nextRunTime - now);
        queries.updateSchedulerRunTimes(config.last_run_at, new Date(nextRunTime).toISOString());
        logger.info(`Next scrape in ${(delay / 60000).toFixed(2)} minutes.`);
        this.timer = setTimeout(() => this.tick(), delay);
      }
    } catch (err) {
      logger.error('Scheduler tick error', { error: err.message });
      this.timer = setTimeout(() => this.tick(), 60000);
    }
  }

  /**
   * Runs a full scrape cycle for all active companies.
   * 
   * THE CORRECT PIPELINE PER COMPANY:
   *   1. Crawl ALL listing pages (follow pagination) with Playwright
   *   2. Crawl ALL discovered job detail links with Playwright
   *   3. Save accumulated text to local cache file
   *   4. Send ONE batch Gemini call (chunked only if text is huge)
   *   5. Run local diff engine to detect new/active/removed
   *   6. Write results to DB
   */
  async runScrapeCycle() {
    if (this.isScraping) {
      logger.warn('Scrape cycle already in progress. Skipping.');
      return;
    }

    this.isScraping = true;
    const cycleStart = Date.now();
    logger.info('═'.repeat(60));
    logger.info('SCRAPE CYCLE STARTED');
    logger.info('═'.repeat(60));

    try {
      const companies = queries.getCompanies();
      const activeCompanies = companies.filter(c => 
        (c.status === 'active' || c.status === 'error') && 
        c.career_url && 
        c.career_url.startsWith('http')
      );

      if (activeCompanies.length === 0) {
        logger.info('No active companies to scrape.');
        return;
      }

      logger.info(`Processing ${activeCompanies.length} companies...`);

      for (let i = 0; i < activeCompanies.length; i++) {
        const company = activeCompanies[i];
        logger.info(`\n[Company ${i + 1}/${activeCompanies.length}] ${company.name}`);

        try {
          await this.processCompany(company);
        } catch (err) {
          logger.error(`Failed to process "${company.name}": ${err.message}`);
          queries.updateCompanyError(company.id, err.message);
          queries.insertScrapeLog({
            company_id: company.id,
            status: 'error',
            error_message: err.message
          });
        }

        // Short delay between companies — Playwright stays alive, Gemini rate limiter handles itself
        if (i < activeCompanies.length - 1) {
          logger.info('Pausing 5s before next company...');
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      // Close browser after ALL companies are done
      await closeBrowser();

      // Update scheduler run times
      const config = queries.getSchedulerConfig();
      if (config) {
        const nextRun = new Date(cycleStart + config.interval_hours * 3600000).toISOString();
        queries.updateSchedulerRunTimes(new Date(cycleStart).toISOString(), nextRun);
        logger.info(`Next cycle scheduled at: ${nextRun}`);
      }

      logger.info(`\n${'═'.repeat(60)}`);
      logger.info(`SCRAPE CYCLE COMPLETE — ${((Date.now() - cycleStart) / 1000).toFixed(1)}s`);
      logger.info('═'.repeat(60));

    } catch (err) {
      logger.error('Critical cycle error', { error: err.message });
    } finally {
      this.isScraping = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.tick();
    }
  }

  /**
   * Processes a single company through the full pipeline:
   * Crawl everything first → save local cache → one Gemini batch → diff → DB
   */
  async processCompany(company) {
    const startTime = Date.now();

    // Fetch active jobs and listing hash from DB
    const activeJobs = queries.getActiveJobs(company.id);
    const activeUrls = activeJobs.map(j => j.job_url).filter(Boolean);
    const oldHash = company.last_listing_hash;

    // ── STEP 1 & 2: Crawl listing pages and check for changes ───────────
    logger.info(`[${company.name}] Step 1: Crawling listing pages (change detection)...`);
    const crawlResult = await crawlCompany(company, activeUrls, oldHash);
    const { filePath, listingPages, detailPages, fileSizeKb, listingHash, hashMatched, detailLinks } = crawlResult;

    if (!filePath) {
      throw new Error('Crawler did not produce an output file.');
    }

    // CASE A: Listing hash matched - early exit
    if (hashMatched) {
      // Update last_seen_at for all active jobs
      for (const job of activeJobs) {
        queries.updateJobLastSeen(job.id);
      }

      queries.updateCompanyScraped(company.id);
      queries.insertScrapeLog({
        company_id: company.id,
        status: 'success',
        jobs_found: activeJobs.length,
        new_jobs: 0,
        removed_jobs: 0,
        duration_ms: Date.now() - startTime
      });

      logger.info(
        `[${company.name}] ✓ Done (hash matched) in ${((Date.now() - startTime) / 1000).toFixed(1)}s — ` +
        `0 new, 0 removed, ${activeJobs.length} total active jobs (0 Gemini API calls)`
      );
      return;
    }

    // CASE B: Listing hash did not match, but we have detail links (Multi-page site)
    if (detailLinks && detailLinks.length > 0) {
      const stillActiveJobs = activeJobs.filter(j => detailLinks.includes(j.job_url));
      const removedJobs = activeJobs.filter(j => !detailLinks.includes(j.job_url));

      logger.info(`[${company.name}] URL diff: ${stillActiveJobs.length} still active, ${removedJobs.length} removed from listings, ${detailPages} new details crawled.`);

      // Update still active jobs last_seen_at
      for (const job of stillActiveJobs) {
        queries.updateJobLastSeen(job.id);
      }

      // Mark removed jobs as removed
      const removedCount = queries.markJobsRemovedByIds(removedJobs.map(j => j.id));

      let newJobsCount = 0;
      let newExtractedJobs = [];

      // Only call extraction if there are new detail pages crawled
      if (detailPages > 0) {
        logger.info(`[${company.name}] Step 3: Sending new details to Gemini (reading file in chunks)...`);
        newExtractedJobs = await batchExtractJobs(company.name, company.career_url, filePath);
        
        for (const rawJob of newExtractedJobs) {
          const fingerprint = generateFingerprint(rawJob, company.id);
          const jobData = {
            company_id: company.id,
            title: rawJob.title,
            description: rawJob.description || '',
            location: rawJob.location || '',
            department: rawJob.department || '',
            job_type: rawJob.job_type || '',
            job_url: rawJob.job_url || '',
            salary_range: rawJob.salary_range || '',
            fingerprint
          };
          try {
            const result = queries.upsertJob(jobData);
            if (result.isNew || result.revived) {
              newJobsCount++;
            }
          } catch (err) {
            logger.error(`Failed to upsert job "${jobData.title}": ${err.message}`);
          }
        }
      } else {
        logger.info(`[${company.name}] Step 3: Skipping extraction (0 new job details).`);
      }

      queries.updateCompanyScraped(company.id);
      queries.updateCompanyListingHash(company.id, listingHash);

      const totalJobsFound = stillActiveJobs.length + newExtractedJobs.length;

      queries.insertScrapeLog({
        company_id: company.id,
        status: 'success',
        jobs_found: totalJobsFound,
        new_jobs: newJobsCount,
        removed_jobs: removedCount,
        duration_ms: Date.now() - startTime
      });

      logger.info(
        `[${company.name}] ✓ Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s — ` +
        `${listingPages} listing + ${detailPages} detail pages | ` +
        `+${newJobsCount} new, -${removedCount} removed, ${totalJobsFound} total active`
      );
      return;
    }

    // CASE C: Fallback to original full flow (Single-page site or no detail links)
    logger.info(`[${company.name}] No detail links found. Falling back to full extraction.`);
    logger.info(`[${company.name}] Step 3: Sending all page text to Gemini (reading file in chunks)...`);
    const extractedJobs = await batchExtractJobs(company.name, company.career_url, filePath);
    if (extractedJobs.length === 0) {
      logger.warn(`[${company.name}] Gemini extracted 0 jobs. Page may require auth or use unsupported rendering.`);
    }

    logger.info(`[${company.name}] Step 4: Running diff on ${extractedJobs.length} extracted jobs...`);
    const diffResult = await processJobDiffs(company.id, extractedJobs);

    queries.updateCompanyScraped(company.id);
    queries.updateCompanyListingHash(company.id, listingHash);
    
    queries.insertScrapeLog({
      company_id: company.id,
      status: 'success',
      jobs_found: diffResult.jobsFound,
      new_jobs: diffResult.newJobsCount,
      removed_jobs: diffResult.removedJobsCount,
      duration_ms: Date.now() - startTime
    });

    logger.info(
      `[${company.name}] ✓ Done (fallback) in ${((Date.now() - startTime) / 1000).toFixed(1)}s — ` +
      `${listingPages} listing + ${detailPages} detail pages | ` +
      `${extractedJobs.length} jobs | ` +
      `+${diffResult.newJobsCount} new, -${diffResult.removedJobsCount} removed`
    );
  }

  /** Trigger immediate full cycle */
  async triggerManualScrapeAll() {
    if (this.isScraping) throw new Error('A scraping cycle is already running.');
    this.runScrapeCycle().catch(err => {
      logger.error('Manual scrape all error', { error: err.message });
    });
    return { status: 'triggered', message: 'Full scrape cycle started in the background.' };
  }

  /** Trigger immediate scrape for a single company */
  async triggerManualScrapeCompany(companyId) {
    const company = queries.getCompanyById(companyId);
    if (!company) throw new Error('Company not found.');

    if (this.isScraping) {
      // Don't block — queue it
      logger.warn(`Scraper busy — ${company.name} will be scraped in the next scheduled cycle.`);
      return { status: 'queued', message: 'Scraper is currently busy. Company will be scraped in the next cycle.' };
    }

    (async () => {
      this.isScraping = true;
      logger.info(`Manual single scrape triggered for: ${company.name}`);
      try {
        await this.processCompany(company);
      } catch (err) {
        logger.error(`Manual scrape failed for "${company.name}": ${err.message}`);
        queries.updateCompanyError(company.id, err.message);
        queries.insertScrapeLog({
          company_id: company.id,
          status: 'error',
          error_message: err.message
        });
      } finally {
        this.isScraping = false;
        await closeBrowser();
      }
    })().catch(err => {
      logger.error('Unhandled single-company scrape error', { error: err.message });
      this.isScraping = false;
    });

    return { status: 'triggered', message: `Scraping "${company.name}" in the background.` };
  }
}

export const scheduler = new SchedulerService();
