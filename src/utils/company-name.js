/**
 * Derives a company name from a career page URL — zero API calls.
 *
 * Strategy:
 *   1. Known ATS domains (greenhouse, lever, etc.) → use the first path segment (company slug)
 *   2. Everything else → use the SLD (second-level domain: the part just before the TLD)
 *      e.g. "career.nextventures.io" → parts[-2] = "nextventures" → "Nextventures"
 *           "careers.google.com"    → parts[-2] = "google"        → "Google"
 *           "stripe.com/jobs"       → parts[-2] = "stripe"        → "Stripe"
 *
 * WHY SLD and not subdomain:
 *   Subdomains like "career", "careers", "jobs", "apply" describe the site
 *   section — not the company. The SLD is always the company's own label.
 */

const ATS_HOSTS = new Set([
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'jobs.workday.com',
  'taleo.net',
  'icims.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'jobvite.com',
  'recruitee.com',
  'breezy.hr',
  'workable.com',
]);

const GENERIC_SUBDOMAINS = new Set([
  'career',
  'careers',
  'job',
  'jobs',
  'work',
  'apply',
  'recruitment',
  'recruiting',
  'talent',
  'portal',
  'dashboard',
  'app',
  'boards',
  'board',
]);

const COMMON_TLDS = new Set([
  'com', 'co', 'org', 'net', 'edu', 'gov', 'ltd', 'ac', 'mil', 'net', 'int'
]);

export function companyNameFromUrl(url) {
  try {
    const parsed   = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const isAts    = [...ATS_HOSTS].some(h => hostname.includes(h));

    if (isAts) {
      // Company slug is typically the first path segment on ATS platforms
      // e.g. "boards.greenhouse.io/netflix/jobs/123" → "netflix"
      const slug = parsed.pathname.split('/').filter(Boolean)[0] || '';
      if (slug && slug.length > 1) {
        return toTitleCase(slug.replace(/[-_]/g, ' '));
      }
    }

    const parts = hostname.split('.');
    
    // Determine SLD index while bypassing double TLDs (e.g. .com.bd, .co.uk)
    let sldIndex = parts.length - 2;
    if (sldIndex > 0 && COMMON_TLDS.has(parts[sldIndex].toLowerCase())) {
      sldIndex--;
    }

    let sld = parts[sldIndex] || parts[0];

    // If sld itself is a generic subdomain (like "career" or "jobs"),
    // check if we can fall back to another segment of the hostname.
    if (GENERIC_SUBDOMAINS.has(sld.toLowerCase()) && parts.length > 2) {
      for (let i = 0; i < parts.length - 1; i++) {
        if (!GENERIC_SUBDOMAINS.has(parts[i].toLowerCase()) && !COMMON_TLDS.has(parts[i].toLowerCase())) {
          sld = parts[i];
          break;
        }
      }
    }

    return toTitleCase(sld.replace(/[-_]/g, ' '));
  } catch {
    return 'Unknown Company';
  }
}

function toTitleCase(str) {
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
