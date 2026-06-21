const MULTI_TENANT_HOSTS = [
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'breezy.hr',
  'smartrecruiters.com',
  'bamboohr.com',
  'recruitee.com',
  'jobs.ashbyhq.com',
  'pinpointhq.com'
];

/**
 * Normalizes a career URL to avoid duplicates.
 * - Prepends 'https://' if no protocol is present
 * - Strips 'www.' from hostnames
 * - Removes query parameters and hash fragments
 * - Removes trailing slashes
 * @param {string} url - The URL to normalize.
 * @returns {string} The normalized URL.
 */
export function normalizeUrl(url) {
  if (!url) return '';
  let cleaned = url.trim();

  // 1. Prepend protocol if missing
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned;
  }

  try {
    const parsed = new URL(cleaned);
    
    // 2. Strip www. from hostname
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    // 3. Rebuild URL without search params or hashes
    let normalized = parsed.protocol + '//' + host + parsed.pathname;

    // 4. Remove trailing slashes
    normalized = normalized.replace(/\/+$/, '');

    return normalized;
  } catch {
    // Fallback if URL parsing fails
    return cleaned.replace(/\/+$/, '');
  }
}

/**
 * Extracts the normalized hostname from a URL.
 * @param {string} url - The URL.
 * @returns {string} The hostname without 'www.'
 */
export function getHostname(url) {
  try {
    const normalized = normalizeUrl(url);
    const parsed = new URL(normalized);
    return parsed.hostname;
  } catch {
    return '';
  }
}

/**
 * Checks if a hostname is a known path-based multi-tenant platform.
 * @param {string} hostname - The hostname to check.
 * @returns {boolean} True if it is a multi-tenant job board host.
 */
export function isMultiTenantHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return MULTI_TENANT_HOSTS.some(tenant => lower === tenant || lower.endsWith('.' + tenant));
}
