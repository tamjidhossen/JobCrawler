import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';


const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Safety guards
const MAX_LISTING_PAGES = 8;   // Max pagination pages per company
const MAX_DETAIL_LINKS  = 40;  // Max job detail pages per company

// Cache directory (on-disk, not in memory)
const CACHE_DIR = path.resolve('data/cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    logger.info('[Browser] Launching Playwright Chromium (headless with bypass)...');
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list'
      ]
    });
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    logger.info('[Browser] Closing instance...');
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Render a URL with Playwright and return full HTML.
 * Includes advanced evasion parameters and fast scrolling for dynamic content.
 */
export async function renderPage(url, timeoutMs = 30000) {
  logger.verbose(`[Playwright] Preparing page context for URL: ${url}`);
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    bypassCSP: true
  });

  const page = await context.newPage();

  // Inject evasion scripts
  await page.addInitScript(() => {
    // 1. Remove webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. Mock chrome object
    window.chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', CAN_RUN: 'can_run', RUNNING: 'running' },
        getDetails: () => {},
        getIsInstalled: () => {},
        install: () => {}
      },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
      }
    };

    // 3. Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chrome PDF Viewer" },
        { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chromium PDF Viewer" }
      ]
    });

    // 4. Mock languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // 5. Mock permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );
  });

  // Block heavy non-content assets for speed
  await page.route(/\.(png|jpg|jpeg|gif|webp|woff2?|mp4|webm|pdf|zip|svg)(\?.*)?$/i, r => r.abort());
  await page.route(/\/(analytics|tracking|gtag|hotjar|segment|amplitude|mixpanel)\//i, r => r.abort());

  try {
    // Step 1 — Navigate; fires as soon as HTML is parsed (never hangs)
    logger.verbose(`[Playwright] Navigating to ${url} with waitUntil: domcontentloaded`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    logger.verbose(`[Playwright] 'domcontentloaded' reached for ${url}`);

    // Step 2 — Try to wait for full resource load (15s cap)
    logger.verbose(`[Playwright] Waiting for 'load' state (up to 15s) for ${url}`);
    await page.waitForLoadState('load', { timeout: 15000 }).then(() => {
      logger.verbose(`[Playwright] 'load' state successfully reached for ${url}`);
    }).catch(() => {
      logger.info(`  [Playwright] 'load' state skipped (slow resources): ${url}`);
    });

    // Step 3 — Best-effort networkidle: only 5 seconds, silently skip if busy
    logger.verbose(`[Playwright] Waiting for 'networkidle' state (up to 5s) for ${url}`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).then(() => {
      logger.verbose(`[Playwright] 'networkidle' state successfully reached for ${url}`);
    }).catch(() => {
      logger.verbose(`[Playwright] 'networkidle' state skipped (network busy) for ${url}`);
    });

    // Step 4 — Fast scrolling to trigger lazy-loaded dynamic contents (like in infinite scrolls)
    logger.verbose(`[Playwright] Fast scrolling page down and up to trigger lazy load...`);
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight / 3);
      await new Promise(r => setTimeout(r, 200));
      window.scrollTo(0, (document.body.scrollHeight / 3) * 2);
      await new Promise(r => setTimeout(r, 200));
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 300));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 100));
    }).catch(() => { /* ignore scrolling errors if page structure is unusual */ });

    // Step 5 — Short settle for JS-rendered content, extended if there are sub-frames/iframes or if it is a known job board
    const isJobBoard = /dover\.com|lever\.co|greenhouse\.io|ashbyhq\.com|pinpointhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com/i.test(url);
    const frameCount = page.frames().length;
    const settleTime = (frameCount > 1 || isJobBoard) ? 5000 : 1500;
    logger.verbose(`[Playwright] Settling for ${settleTime}ms to let dynamic content render (sub-frames: ${frameCount - 1}, job-board: ${isJobBoard})...`);
    await page.waitForTimeout(settleTime);

    let html = await page.content();
    
    // Proactively capture all embedded iframe content to support embedded job board widgets (Dover, Ashby, Greenhouse, Lever, etc.)
    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        const frameUrl = frame.url();
        if (frameUrl && frameUrl !== 'about:blank') {
          try {
            const frameContent = await frame.content();
            html += `\n\n<!-- Frame: ${frameUrl} -->\n\n` + frameContent;
            logger.verbose(`[Playwright] Captured iframe content from: ${frameUrl} (${frameContent.length} chars)`);
          } catch (frameErr) {
            logger.verbose(`[Playwright] Non-fatal: Could not access frame content: ${frameErr.message}`);
          }
        }
      }
    } catch (e) {
      logger.verbose(`[Playwright] Non-fatal: Error in frame loop: ${e.message}`);
    }

    logger.verbose(`[Playwright] Extracted HTML content: ${html.length} characters`);
    return html;
  } finally {
    logger.verbose(`[Playwright] Closing page context for ${url}`);
    await context.close();
  }
}

/**
 * Extract clean text from HTML and collect all same-domain links.
 *
 * Link strategy (FIXED from previous version):
 *   - Collect ALL same-origin links
 *   - Exclude only obvious non-job pages (login, blog, press, etc.)
 *   - Let Gemini decide what's a job description — not our heuristic
 *
 * Returns { text: string, links: string[] }
 */
function extractTextAndLinks(html, baseUrl) {
  logger.verbose(`[Cheerio] Extracting text and links from URL: ${baseUrl}. HTML length: ${html.length} chars`);
  const $ = cheerio.load(html);

  // ── Remove boilerplate HTML ─────────────────────────────────
  const beforeCleanup = html.length;
  $('script, style, noscript, iframe, svg, path, head, img, video, audio').remove();
  $('header, footer, nav, aside').remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $('[class*="cookie"], [class*="consent"], [class*="gdpr"], [id*="cookie"]').remove();
  logger.verbose(`[Cheerio] Cleaned boilerplate tags/elements.`);

  // ── Collect links BEFORE stripping them ────────────────────
  let baseOrigin = '';
  try { baseOrigin = new URL(baseUrl).origin; } catch { /* skip */ }

  // Helper to determine if a URL/anchor combination should be excluded
  function shouldExclude(urlStr, anchorText) {
    // 1. Normalize anchor text
    const normAnchor = anchorText.replace(/\s+/g, ' ').trim().toLowerCase();

    // 2. Strict anchor keyword matching
    const EXCLUDE_ANCHORS_LOCAL = [
      'about us', 'about', 'services', 'service', 'technology', 'technologies', 'capabilities', 'capability',
      'works', 'work', 'clients', 'client', 'blog', 'blogs', 'news', 'career', 'careers',
      'faq', 'faqs', 'faq\'s', 'faq`s', 'contact', 'contact us', 'privacy policy', 'privacy',
      'terms of use', 'terms of service', 'terms & conditions', 'terms', 'cookies', 'cookie', 'policy',
      'solutions', 'solution', 'products', 'product', 'pricing', 'portfolio', 'partner', 'partners',
      'testimonial', 'testimonials', 'home', 'our team', 'team', 'culture', 'values', 'benefits',
      'perks', 'life at', 'join our team', 'join us', 'developers'
    ];

    if (normAnchor && EXCLUDE_ANCHORS_LOCAL.some(kw => normAnchor === kw || normAnchor.startsWith(kw + ' ') || normAnchor.endsWith(' ' + kw))) {
      return true;
    }

    // 3. Path-level keyword matching with job-safety overrides
    let pathname = '';
    try {
      pathname = new URL(urlStr).pathname.toLowerCase();
    } catch {
      return false; // Let general parser handle malformed URLs
    }

    // Obvious system/third-party/file paths
    const SYSTEM_EXCLUDES = [
      /\/(login|signin|sign-in|signup|sign-up|register|auth)(\/|$|\?)/i,
      /\/(linkedin|twitter|facebook|instagram|github|youtube)\.com/i,
      /\.(pdf|zip|doc|docx|xlsx|csv)(\?|$)/i,
      /^mailto:|^tel:|^javascript:/i
    ];
    if (SYSTEM_EXCLUDES.some(p => p.test(urlStr))) {
      return true;
    }

    // Keywords that indicate static company sections
    const EXCLUDE_PATH_KEYWORDS = [
      'about', 'service', 'services', 'technology', 'technologies', 'capabilities', 'capability',
      'work', 'works', 'client', 'clients', 'blog', 'blogs', 'news', 'faq', 'faqs',
      'contact', 'privacy', 'terms', 'cookie', 'cookies', 'policy', 'policies',
      'solutions', 'solution', 'products', 'product', 'pricing', 'portfolio',
      'partner', 'partners', 'testimonial', 'testimonials', 'team', 'culture',
      'values', 'benefits', 'perks', 'gallery', 'insights', 'comparison', 'calculator',
      'case-study', 'case-studies'
    ];

    // Job-related keywords that act as safe overrides (to keep actual job detail pages)
    const JOB_INDICATORS = [
      'job', 'jobs', 'career', 'careers', 'apply', 'vacancy', 'vacancies',
      'position', 'positions', 'opening', 'openings', 'recruitment', 'hire'
    ];

    const pathSegments = pathname.split('/').filter(Boolean);
    const hasExcludeKeyword = pathSegments.some(segment => 
      EXCLUDE_PATH_KEYWORDS.some(kw => segment === kw || segment.includes(kw))
    );
    const hasJobIndicator = pathSegments.some(segment => 
      JOB_INDICATORS.some(kw => segment === kw || segment.includes(kw))
    );

    if (hasExcludeKeyword && !hasJobIndicator) {
      return true;
    }

    return false;
  }

  const links = new Set();
  let rawLinkCount = 0;
  let differentOriginCount = 0;
  let excludedPatternCount = 0;
  let equalsBaseCount = 0;
  let parseErrorCount = 0;

  $('a[href]').each((_, el) => {
    rawLinkCount++;
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('#')) return;

    const anchorText = $(el).text();

    let abs;
    try {
      const urlObj = new URL(href, baseUrl);
      urlObj.hash = ''; // Strip hash/anchor tags to avoid crawling the same page multiple times
      abs = urlObj.toString();
    } catch {
      parseErrorCount++;
      return;
    }

    // Only same-origin links
    if (!abs.startsWith(baseOrigin)) {
      differentOriginCount++;
      return;
    }

    // Skip the exact base URL itself
    if (abs === baseUrl || abs === baseUrl + '/') {
      equalsBaseCount++;
      return;
    }

    // Apply smart keyword and path exclusions
    if (shouldExclude(abs, anchorText)) {
      excludedPatternCount++;
      return;
    }

    links.add(abs);
  });

  logger.verbose(`[Cheerio] Link scan: ${rawLinkCount} raw links evaluated. Filtered: ${differentOriginCount} different origin, ${excludedPatternCount} excluded, ${equalsBaseCount} base URL, ${parseErrorCount} parse errors. Accepted: ${links.size} same-origin candidates.`);
  if (links.size > 0) {
    logger.verbose(`[Cheerio] Accepted links: ${JSON.stringify([...links])}`);
  }

  // ── Extract clean readable text ─────────────────────────────
  // Try main content containers first, fall back to body
  let target = $('main, [role="main"], #main-content, #content, article');
  if (!target.length) {
    target = $('body');
    logger.verbose(`[Cheerio] Content container (main/article) not found, falling back to body`);
  } else {
    logger.verbose(`[Cheerio] Extracting text from main content container(s)`);
  }

  const text = target.text()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .filter(line => {
      const l = line.trim().toLowerCase();
      // Drop common boilerplate single-line fragments
      return !(
        l.length === 0 ||
        l === 'cookie settings' ||
        l === 'accept all cookies' ||
        l === 'privacy policy' ||
        l === 'all rights reserved'
      );
    })
    .join('\n')
    .trim();

  logger.verbose(`[Cheerio] Text clean-up complete: ${text.length} chars extracted`);
  return { text, links: [...links] };
}

/**
 * Returns true if a URL looks like a pagination URL for the listing page.
 * We identify these to add to the listing queue, not the detail queue.
 */
function isPaginationUrl(url) {
  return (
    /[?&](page|p|offset|from|start)=\d+/i.test(url) ||
    /\/page\/\d+/i.test(url) ||
    /[?&]pg=\d+/i.test(url)
  );
}

/**
 * Append a page's text to the on-disk temp file for this company.
 * This avoids holding the full crawl in memory.
 *
 * @param {string} filePath - path to the company's temp crawl file
 * @param {string} label    - e.g. "Listing Page 1" or "Detail: Software Engineer"
 * @param {string} text     - cleaned text from that page
 */
function appendToFile(filePath, label, text) {
  logger.verbose(`[CRAWL] Appending block [${label}] to cache file (${text.length} chars)`);
  const block = `\n\n${'─'.repeat(60)}\n[${label}]\n${'─'.repeat(60)}\n${text}\n`;
  fs.appendFileSync(filePath, block, 'utf8');
}

/**
 * Scan for iframe tags containing known third-party job board URLs
 * (e.g. Dover, Lever, Greenhouse, Ashby, etc.) to crawl them directly.
 */
function extractEmbeddedJobBoards(html, baseUrl) {
  const $ = cheerio.load(html);
  const srcs = [];
  const boardDomains = [
    'dover.com',
    'lever.co',
    'greenhouse.io',
    'ashbyhq.com',
    'pinpointhq.com',
    'workable.com',
    'smartrecruiters.com',
    'bamboohr.com',
    'recruitee.com',
    'jobs.cz'
  ];

  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const absUrl = new URL(src, baseUrl).toString();
      const domain = new URL(absUrl).hostname.toLowerCase();
      const isJobBoard = boardDomains.some(d => domain.includes(d)) ||
                         absUrl.toLowerCase().includes('/job/') ||
                         absUrl.toLowerCase().includes('/jobs/') ||
                         absUrl.toLowerCase().includes('/career');
      if (isJobBoard) {
        srcs.push(absUrl);
      }
    } catch {
      // ignore invalid URLs
    }
  });
  return srcs;
}

/**
 * Executes a list of asynchronous tasks concurrently, limited to `limit` active tasks.
 */
async function limitConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * ─────────────────────────────────────────────────────────────────
 * MAIN COMPANY CRAWLER
 * ─────────────────────────────────────────────────────────────────
 *
 * PHASE 1 — Listing pages (follows pagination):
 *   Visit the career URL, collect all same-origin links, follow pagination.
 *   Append each page's text to disk as we go.
 *
 * PHASE 2 — Job detail pages:
 *   From all links collected during Phase 1, visit every candidate link
 *   (excluding pagination, already-visited, and clear non-job URLs).
 *   Append each detail page's text to the same disk file.
 *
 * Returns the path to the on-disk file containing the full crawl.
 * Caller reads from the file — never holds full crawl in memory.
 */
export async function crawlCompany(company, urlsToSkip = [], oldHash = null) {
  const timeoutMs = parseInt(process.env.SCRAPE_TIMEOUT_MS) || 30000;
  const startUrl  = company.career_url;
  const timestamp = Date.now();

  // Create per-company cache directory
  const companyDir = path.join(CACHE_DIR, String(company.id));
  if (!fs.existsSync(companyDir)) {
    fs.mkdirSync(companyDir, { recursive: true });
  }
  const outFile = path.join(companyDir, `${timestamp}.txt`);

  // Write header to file
  fs.writeFileSync(outFile,
    `=== Career Crawl: ${company.name} ===\nURL: ${startUrl}\nTimestamp: ${new Date(timestamp).toISOString()}\n`,
    'utf8'
  );

  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`[CRAWL] ${company.name}`);
  logger.info(`[CRAWL] Output file: ${outFile}`);

  const visited    = new Set();           // All URLs we've rendered
  const listingQ   = [startUrl];          // Pages to treat as listing pages
  const detailLinks = new Set();          // Job detail candidates from listing pages

  let listingCount = 0;
  let detailCount  = 0;
  let listingTextCombined = '';
  let firstPageHtml = '';

  // ── PHASE 1: Listing pages + pagination ─────────────────────
  logger.info('[Phase 1] Crawling listing pages...');

  while (listingQ.length > 0 && listingCount < MAX_LISTING_PAGES) {
    const url = listingQ.shift();
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);
    listingCount++;

    logger.info(`  [Listing ${listingCount}/${MAX_LISTING_PAGES}] ${url}`);

    let html;
    try {
      html = await renderPage(url, timeoutMs);
      if (listingCount === 1) {
        firstPageHtml = html;
      }
    } catch (err) {
      logger.warn(`  Failed: ${err.message}`);
      appendToFile(outFile, `Listing Page ${listingCount} (FAILED: ${url})`, `Error: ${err.message}`);
      continue;
    }

    const { text, links } = extractTextAndLinks(html, url);
    listingTextCombined += text + '\n';
    appendToFile(outFile, `Listing Page ${listingCount}: ${url}`, text);
    logger.info(`    → ${text.length} chars, ${links.length} links found`);

    // Detect embedded job boards in iframes and queue them to crawl directly
    const iframeSrcs = extractEmbeddedJobBoards(html, url);
    for (const src of iframeSrcs) {
      if (!visited.has(src) && !listingQ.includes(src)) {
        logger.info(`    [+iframe board] ${src}`);
        listingQ.push(src);
      }
    }

    // Sort discovered links into pagination vs job detail candidates
    for (const link of links) {
      if (visited.has(link)) {
        continue;
      }
      if (isPaginationUrl(link)) {
        if (!listingQ.includes(link)) {
          logger.info(`    [+page] ${link}`);
          listingQ.push(link);
        }
      } else {
        if (!detailLinks.has(link)) {
          detailLinks.add(link);
        }
      }
    }
  }

  logger.info(`[Phase 1 Done] ${listingCount} listing pages, ${detailLinks.size} detail candidates`);

  // Calculate listing hash
  const listingHash = crypto.createHash('sha256').update(listingTextCombined).digest('hex');
  logger.verbose(`[CRAWL] Calculated listing hash: ${listingHash}`);

  // Check if hash matches oldHash
  if (oldHash && listingHash === oldHash) {
    logger.info(`[CRAWL] Listing hash matches old hash. No changes detected. Skipping Phase 2.`);
    return {
      filePath: outFile,
      listingPages: listingCount,
      detailPages: 0,
      fileSizeKb: (fs.statSync(outFile).size / 1024).toFixed(1),
      listingHash,
      hashMatched: true,
      detailLinks: [...detailLinks],
      extractedJobsLocally: []
    };
  }

  // ── PHASE 2: Job detail pages ────────────────────────────────
  // Take all non-visited candidate links (excluding urlsToSkip, up to MAX_DETAIL_LINKS)
  const toVisit = [...detailLinks]
    .filter(u => !visited.has(u) && !urlsToSkip.includes(u))
    .slice(0, MAX_DETAIL_LINKS);

  if (toVisit.length > 0) {
    const concurrency = parseInt(process.env.SCRAPER_CONCURRENCY) || 3;
    logger.info(`[Phase 2] Visiting ${toVisit.length} job detail pages concurrently (limit: ${concurrency}, skipped ${detailLinks.size - toVisit.length} existing/ignored)...`);

    const tasks = toVisit.map((url, idx) => async () => {
      const pageNum = idx + 1;
      if (visited.has(url)) {
        return;
      }
      visited.add(url);

      logger.info(`  [Detail ${pageNum}/${toVisit.length}] Starting: ${url}`);
      
      try {
        const html = await renderPage(url, timeoutMs);
        const { text } = extractTextAndLinks(html, url);
        appendToFile(outFile, `Job Detail ${pageNum}: ${url}`, text);
        logger.info(`    → [Detail ${pageNum}/${toVisit.length}] Finished: ${url} (${text.length} chars)`);
        detailCount++;
      } catch (err) {
        logger.warn(`  Failed [Detail ${pageNum}/${toVisit.length}] ${url}: ${err.message}`);
      }
    });

    await limitConcurrency(tasks, concurrency);
  } else {
    logger.info(`[Phase 2] 0 new job detail pages to visit.`);
  }

  const fileSizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  logger.info(`[CRAWL DONE] ${company.name} — ${listingCount} listing + ${detailCount} detail pages`);
  logger.info(`[CRAWL DONE] Cache file: ${outFile} (${fileSizeKb} KB)`);
  logger.info(`${'═'.repeat(60)}\n`);

  return {
    filePath: outFile,        // ← caller reads from disk, not from memory
    listingPages: listingCount,
    detailPages: detailCount,
    fileSizeKb,
    listingHash,
    hashMatched: false,
    detailLinks: [...detailLinks]
  };
}
