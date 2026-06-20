import { db } from './schema.js';

// ==========================================
// COMPANIES QUERIES
// ==========================================

export const getCompanies = () => {
  return db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'active') as active_jobs_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'new') as new_jobs_count
    FROM companies c
    ORDER BY c.name ASC
  `).all();
};

export const getCompanyById = (id) => {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
};

export const getCompanyByUrl = (url) => {
  return db.prepare('SELECT * FROM companies WHERE career_url = ?').get(url);
};

export const insertCompany = (name, careerUrl) => {
  const info = db.prepare(`
    INSERT INTO companies (name, career_url, status)
    VALUES (?, ?, 'active')
  `).run(name, careerUrl);
  return info.lastInsertRowid;
};

export const updateCompany = (id, { name, career_url, status }) => {
  return db.prepare(`
    UPDATE companies
    SET name = COALESCE(?, name),
        career_url = COALESCE(?, career_url),
        status = COALESCE(?, status),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(name, career_url, status, id);
};

export const updateCompanyScraped = (id, timeStr = new Date().toISOString()) => {
  return db.prepare(`
    UPDATE companies
    SET last_scraped_at = ?,
        last_error = NULL,
        status = CASE WHEN status = 'error' THEN 'active' ELSE status END
    WHERE id = ?
  `).run(timeStr, id);
};

export const updateCompanyError = (id, errorMsg) => {
  return db.prepare(`
    UPDATE companies
    SET last_error = ?,
        status = 'error'
    WHERE id = ?
  `).run(errorMsg, id);
};

export const deleteCompany = (id) => {
  return db.prepare('DELETE FROM companies WHERE id = ?').run(id);
};

export const updateCompanyListingHash = (id, hash) => {
  return db.prepare(`
    UPDATE companies
    SET last_listing_hash = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(hash, id);
};

// ==========================================
// JOBS QUERIES
// ==========================================

export const getFilteredJobs = ({ keyword, titleKeyword, excludeTitleKeyword, companyId, status, jobType, techOnly, limit = 25, offset = 0 }) => {
  let query = `
    SELECT j.*, c.name as company_name 
    FROM jobs j
    JOIN companies c ON j.company_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (keyword) {
    const kws = keyword.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length > 0) {
      const clause = kws.map(() => `(j.title LIKE ? OR j.description LIKE ? OR j.location LIKE ? OR c.name LIKE ?)`).join(' OR ');
      query += ` AND (${clause})`;
      kws.forEach(kw => {
        const pattern = `%${kw}%`;
        params.push(pattern, pattern, pattern, pattern);
      });
    }
  }

  if (titleKeyword) {
    const kws = titleKeyword.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length > 0) {
      const clause = kws.map(() => `j.title LIKE ?`).join(' OR ');
      query += ` AND (${clause})`;
      kws.forEach(kw => {
        params.push(`%${kw}%`);
      });
    }
  }

  if (excludeTitleKeyword) {
    const kws = excludeTitleKeyword.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length > 0) {
      const clause = kws.map(() => `j.title NOT LIKE ?`).join(' AND ');
      query += ` AND (${clause})`;
      kws.forEach(kw => {
        params.push(`%${kw}%`);
      });
    }
  }

  if (techOnly === 'true' || techOnly === true) {
    const techKeywords = ['dev', 'developer', 'devops', 'qa', 'engineer', 'intern', 'architect', 'programmer', 'analyst', 'data', 'designer', 'support', 'admin', 'system', 'security', 'software', 'frontend', 'backend', 'fullstack', 'tech', 'technology', 'scrum', 'product manager'];
    const clause = techKeywords.map(() => `j.title LIKE ?`).join(' OR ');
    query += ` AND (${clause})`;
    techKeywords.forEach(kw => {
      params.push(`%${kw}%`);
    });
  }

  if (companyId) {
    query += ` AND j.company_id = ?`;
    params.push(companyId);
  }

  if (status) {
    query += ` AND j.status = ?`;
    params.push(status);
  }

  if (jobType) {
    query += ` AND j.job_type = ?`;
    params.push(jobType);
  }

  // Count query for pagination
  const countQuery = `SELECT COUNT(*) as total FROM (${query})`;
  const totalCount = db.prepare(countQuery).get(...params).total;

  // Order and Paginate
  query += ` ORDER BY j.status = 'new' DESC, j.last_seen_at DESC, j.first_seen_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const jobs = db.prepare(query).all(...params);

  return {
    jobs,
    total: totalCount,
    limit,
    offset
  };
};

export const getJobStats = () => {
  return db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM jobs WHERE status = 'new') as new_count,
      (SELECT COUNT(*) FROM jobs WHERE status = 'active') as active_count,
      (SELECT COUNT(*) FROM jobs WHERE status = 'removed') as removed_count,
      (SELECT COUNT(*) FROM companies) as company_count
  `).get();
};

export const getActiveJobFingerprints = (companyId) => {
  return db.prepare(`
    SELECT fingerprint FROM jobs 
    WHERE company_id = ? AND status != 'removed'
  `).all(companyId).map(row => row.fingerprint);
};

export const upsertJob = (job) => {
  // Try to find existing job by fingerprint
  const existing = db.prepare('SELECT id, status FROM jobs WHERE fingerprint = ?').get(job.fingerprint);

  if (existing) {
    // If it was previously marked removed, we revive it as 'new' (or 'active')
    const newStatus = existing.status === 'removed' ? 'new' : existing.status;
    db.prepare(`
      UPDATE jobs
      SET last_seen_at = datetime('now'),
          status = ?,
          description = COALESCE(?, description),
          location = COALESCE(?, location),
          department = COALESCE(?, department),
          job_type = COALESCE(?, job_type),
          job_url = COALESCE(?, job_url),
          salary_range = COALESCE(?, salary_range),
          removed_at = NULL
      WHERE id = ?
    `).run(
      newStatus,
      job.description,
      job.location,
      job.department,
      job.job_type,
      job.job_url,
      job.salary_range,
      existing.id
    );
    return { id: existing.id, isNew: false, revived: existing.status === 'removed' };
  } else {
    // Insert new job
    const info = db.prepare(`
      INSERT INTO jobs (
        company_id, title, description, location, department, 
        job_type, job_url, salary_range, fingerprint, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `).run(
      job.company_id,
      job.title,
      job.description,
      job.location,
      job.department,
      job.job_type,
      job.job_url,
      job.salary_range,
      job.fingerprint
    );
    return { id: info.lastInsertRowid, isNew: true, revived: false };
  }
};

export const markJobsRemoved = (companyId, activeFingerprints) => {
  if (activeFingerprints.length === 0) {
    // If no active jobs found in scrape, all current active/new jobs for this company are removed
    const info = db.prepare(`
      UPDATE jobs
      SET status = 'removed',
          removed_at = datetime('now')
      WHERE company_id = ? AND status != 'removed'
    `).run(companyId);
    return info.changes;
  }

  // Mark all jobs not in the list as removed
  const placeholders = activeFingerprints.map(() => '?').join(',');
  const info = db.prepare(`
    UPDATE jobs
    SET status = 'removed',
        removed_at = datetime('now')
    WHERE company_id = ? 
      AND status != 'removed'
      AND fingerprint NOT IN (${placeholders})
  `).run(companyId, ...activeFingerprints);

  return info.changes;
};

export const deleteJob = (id) => {
  return db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
};

export const getActiveJobs = (companyId) => {
  return db.prepare(`
    SELECT id, title, job_url, fingerprint, status FROM jobs
    WHERE company_id = ? AND status != 'removed'
  `).all(companyId);
};

export const updateJobLastSeen = (id) => {
  return db.prepare(`
    UPDATE jobs
    SET last_seen_at = datetime('now')
    WHERE id = ?
  `).run(id);
};

export const markJobsRemovedByIds = (ids) => {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`
    UPDATE jobs
    SET status = 'removed',
        removed_at = datetime('now')
    WHERE id IN (${placeholders})
  `).run(...ids);
  return info.changes;
};

// ==========================================
// SCHEDULER QUERIES
// ==========================================

export const getSchedulerConfig = () => {
  return db.prepare('SELECT * FROM scheduler_config WHERE id = 1').get();
};

export const updateSchedulerConfig = (intervalHours, isRunning) => {
  return db.prepare(`
    UPDATE scheduler_config
    SET interval_hours = COALESCE(?, interval_hours),
        is_running = COALESCE(?, is_running),
        updated_at = datetime('now')
    WHERE id = 1
  `).run(intervalHours, isRunning);
};

export const updateSchedulerRunTimes = (lastRunAt, nextRunAt) => {
  return db.prepare(`
    UPDATE scheduler_config
    SET last_run_at = ?,
        next_run_at = ?
    WHERE id = 1
  `).run(lastRunAt, nextRunAt);
};

// ==========================================
// SCRAPE LOGS QUERIES
// ==========================================

export const insertScrapeLog = (log) => {
  return db.prepare(`
    INSERT INTO scrape_logs (
      company_id, status, jobs_found, new_jobs, removed_jobs, error_message, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.company_id,
    log.status,
    log.jobs_found || 0,
    log.new_jobs || 0,
    log.removed_jobs || 0,
    log.error_message || null,
    log.duration_ms || 0
  );
};

export const getRecentLogs = (limit = 50) => {
  return db.prepare(`
    SELECT l.*, c.name as company_name
    FROM scrape_logs l
    JOIN companies c ON l.company_id = c.id
    ORDER BY l.created_at DESC
    LIMIT ?
  `).all(limit);
};
