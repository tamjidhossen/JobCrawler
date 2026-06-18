import crypto from 'crypto';
import * as queries from '../db/queries.js';
import { logger } from '../utils/logger.js';

/**
 * Generates a unique, deterministic fingerprint for a job posting.
 */
export function generateFingerprint(job, companyId) {
  const cleanTitle = (job.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanLocation = (job.location || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawString = `${cleanTitle}|${cleanLocation}|${companyId}`;
  return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Compares the scraped jobs for a company with the jobs currently stored in the database.
 * Inserts new jobs, revives previously removed jobs, updates active jobs, and marks vanished jobs as removed.
 * 
 * @param {number} companyId - ID of the company
 * @param {Array} scrapedJobs - Array of scraped job objects
 * @returns {Promise<{jobsFound: number, newJobsCount: number, removedJobsCount: number}>}
 */
export async function processJobDiffs(companyId, scrapedJobs) {
  logger.info(`Running Diff Engine for company ID: ${companyId}. Scraped jobs count: ${scrapedJobs.length}`);
  logger.verbose(`[Diff] Scraped jobs titles: ${JSON.stringify(scrapedJobs.map(j => j.title))}`);
  
  let newJobsCount = 0;
  let revivedJobsCount = 0;
  const activeFingerprints = [];

  // 1. Process scraped jobs (insert/update)
  for (const rawJob of scrapedJobs) {
    if (!rawJob.title) {
      logger.warn('Skipping scraped job with no title', { rawJob });
      continue;
    }

    const fingerprint = generateFingerprint(rawJob, companyId);
    activeFingerprints.push(fingerprint);

    const jobData = {
      company_id: companyId,
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
      if (result.isNew) {
        newJobsCount++;
      } else if (result.revived) {
        revivedJobsCount++;
        logger.info(`Revived job: "${jobData.title}" for company ID ${companyId}`);
      }
    } catch (err) {
      logger.error(`Failed to upsert job "${jobData.title}": ${err.message}`);
    }
  }

  // 2. Identify and mark removed jobs (jobs in DB that are not in the current scraped list)
  let removedJobsCount = 0;
  try {
    logger.verbose(`[Diff] Active fingerprints for comparison: ${JSON.stringify(activeFingerprints)}`);
    removedJobsCount = queries.markJobsRemoved(companyId, activeFingerprints);
    logger.info(`Diff results for company ID ${companyId}: ${scrapedJobs.length} found, ${newJobsCount} new, ${revivedJobsCount} revived, ${removedJobsCount} removed.`);
  } catch (err) {
    logger.error(`Failed to mark removed jobs for company ID ${companyId}: ${err.message}`);
  }

  return {
    jobsFound: scrapedJobs.length,
    newJobsCount: newJobsCount + revivedJobsCount, // count revived as new additions for UI dashboard highlights
    removedJobsCount
  };
}
