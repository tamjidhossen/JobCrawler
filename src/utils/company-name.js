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

    // For all non-ATS domains, take the SLD (second-level domain).
    // This is the part at index -2 (just before the TLD).
    //
    // Examples:
    //   career.nextventures.io   → parts = ['career','nextventures','io']  → SLD = 'nextventures'
    //   careers.shopify.com      → parts = ['careers','shopify','com']      → SLD = 'shopify'
    //   stripe.com               → parts = ['stripe','com']                 → SLD = 'stripe'
    //   www.amazon.jobs          → parts = ['amazon','jobs']                → SLD = 'amazon'
    const parts = hostname.split('.');

    // Second-to-last part = SLD (always the company domain label)
    const sld = parts[parts.length - 2] || parts[0];

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
