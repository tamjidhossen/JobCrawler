import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { companyNameFromUrl } from '../utils/company-name.js';
import { getCountryFromLocation } from '../utils/location.js';

const dbDir = path.resolve('data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'jobs.db');
logger.info(`Initializing SQLite database at: ${dbPath}`);

export const db = new Database(dbPath);

// Enable WAL mode for performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  // 1. Companies Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      career_url TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',          -- active | paused | error
      last_error TEXT,
      last_scraped_at TEXT,
      last_listing_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add last_listing_hash column to existing DB if missing
  try {
    db.exec(`ALTER TABLE companies ADD COLUMN last_listing_hash TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }


  // 2. Jobs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      country TEXT,
      department TEXT,
      job_type TEXT,                         -- Full-time, Part-time, Contract, Internship, etc.
      job_url TEXT,
      salary_range TEXT,
      fingerprint TEXT NOT NULL,             -- Unique signature to identify duplicate/same job
      status TEXT DEFAULT 'new',            -- new | active | removed
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      removed_at TEXT,
      raw_snippet TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  // Add country column to existing DB if missing
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN country TEXT`);
    logger.info('Added country column to jobs table.');
  } catch (err) {
    // Ignore error if column already exists
  }

  // 3. Scheduler Config Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      interval_hours REAL DEFAULT 6.0,
      is_running INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);


  // 4. Scrape Logs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      status TEXT NOT NULL,                  -- success | error
      jobs_found INTEGER DEFAULT 0,
      new_jobs INTEGER DEFAULT 0,
      removed_jobs INTEGER DEFAULT 0,
      error_message TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_scrape_logs_company ON scrape_logs(company_id);
  `);

  // Seed default scheduler config if empty
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM scheduler_config').get();
  if (rowCount.count === 0) {
    db.prepare(`
      INSERT INTO scheduler_config (id, interval_hours, is_running)
      VALUES (1, 6.0, 1)
    `).run();
    logger.info('Seeded default scheduler configuration (6 hours, running).');
  }

  // Cleanup/Migrate incorrectly parsed company names (e.g. named "Career" or "Careers")
  try {
    const badCompanies = db.prepare("SELECT id, career_url, name FROM companies WHERE name IN ('Career', 'Careers')").all();
    if (badCompanies.length > 0) {
      logger.info(`Found ${badCompanies.length} companies with name "Career"/"Careers". Migrating to correct names...`);
      for (const comp of badCompanies) {
        const correctName = companyNameFromUrl(comp.career_url);
        if (correctName && correctName !== 'Career' && correctName !== 'Careers') {
          db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(correctName, comp.id);
          logger.info(`Migrated company ID ${comp.id}: "${comp.name}" -> "${correctName}"`);
        }
      }
    }
  } catch (err) {
    logger.error('Failed to migrate company names', { error: err.message });
  }

  // Migrate existing jobs without country
  try {
    const jobsWithoutCountry = db.prepare('SELECT id, location FROM jobs WHERE country IS NULL').all();
    if (jobsWithoutCountry.length > 0) {
      logger.info(`Found ${jobsWithoutCountry.length} jobs without country. Migrating country names...`);
      const updateStmt = db.prepare('UPDATE jobs SET country = ? WHERE id = ?');
      db.transaction((jobs) => {
        for (const job of jobs) {
          const country = getCountryFromLocation(job.location);
          updateStmt.run(country, job.id);
        }
      })(jobsWithoutCountry);
      logger.info('Successfully completed country migration for all existing jobs.');
    }
  } catch (err) {
    logger.error('Failed to migrate country for existing jobs', { error: err.message });
  }

  logger.info('Database tables initialized and indexed successfully.');
}
