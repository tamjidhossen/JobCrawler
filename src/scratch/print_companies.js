import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../data/jobs.db');
const db = new Database(dbPath);

const companies = db.prepare(`
  SELECT c.*, 
    (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'active') as active_jobs_count,
    (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'new') as new_jobs_count
  FROM companies c
  ORDER BY c.name ASC
`).all();

const escapeHTML = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

if (companies.length === 0) {
  console.log('No tracked companies in the database.');
  process.exit(0);
}

let response = '<b>🏢 Tracked Companies List</b>\n\n';
companies.forEach((c, idx) => {
  const statusEmoji = c.status === 'active' ? '🟢' : c.status === 'error' ? '🔴' : '🟡';
  const lastScrapedStr = c.last_scrape_at ? new Date(c.last_scrape_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : 'Never';
  
  response += `${idx + 1}. <b>${escapeHTML(c.name)}</b> (${statusEmoji} <i>${c.status}</i>)\n`;
  response += `• URL: <a href="${escapeHTML(c.career_url)}">Careers Link</a>\n`;
//   response += `• Last Scraped: ${lastScrapedStr}\n`;
//   response += `• Jobs: <b>${c.active_jobs_count}</b> active | <b>${c.new_jobs_count}</b> new\n\n`;
});

console.log(response.trim());
db.close();
