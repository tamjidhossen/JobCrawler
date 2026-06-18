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
async function renderPage(url, timeoutMs = 30000) {
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

    // Step 5 — Short settle for JS-rendered content (React, Vue, etc.)
    logger.verbose(`[Playwright] Settling for 1.5s to let dynamic content render...`);
    await page.waitForTimeout(1500);

    const html = await page.content();
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

  // URL patterns that are clearly NOT job listings
  const EXCLUDE_PATTERNS = [
    /\/(login|signin|sign-in|signup|sign-up|register|auth)(\/|$|\?)/i,
    /\/(about|team|culture|values|benefits|perks)(\/|$|\?)/i,
    /\/(blog|news|press|media|events|podcast|webinar)(\/|$|\?)/i,
    /\/(contact|support|help|faq|legal|privacy|terms|cookies)(\/|$|\?)/i,
    /\/(product|pricing|solutions|customers|case-study)(\/|$|\?)/i,
    /\/(linkedin|twitter|facebook|instagram|github|youtube)\.com/i,
    /^mailto:|^tel:|^javascript:/i,
    /\.(pdf|zip|doc|docx|xlsx|csv)(\?|$)/i,
  ];

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

    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch {
      parseErrorCount++;
      return;
    }

    // Only same-origin links
    if (!abs.startsWith(baseOrigin)) {
      differentOriginCount++;
      return;
    }
    // Skip excluded patterns
    if (EXCLUDE_PATTERNS.some(p => p.test(abs))) {
      excludedPatternCount++;
      return;
    }
    // Skip the exact base URL itself
    if (abs === baseUrl || abs === baseUrl + '/') {
      equalsBaseCount++;
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
    } catch (err) {
      logger.warn(`  Failed: ${err.message}`);
      appendToFile(outFile, `Listing Page ${listingCount} (FAILED: ${url})`, `Error: ${err.message}`);
      continue;
    }

    const { text, links } = extractTextAndLinks(html, url);
    listingTextCombined += text + '\n';
    appendToFile(outFile, `Listing Page ${listingCount}: ${url}`, text);
    logger.info(`    → ${text.length} chars, ${links.length} links found`);

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
      detailLinks: [...detailLinks]
    };
  }

  // ── PHASE 2: Job detail pages ────────────────────────────────
  // Take all non-visited candidate links (excluding urlsToSkip, up to MAX_DETAIL_LINKS)
  const toVisit = [...detailLinks]
    .filter(u => !visited.has(u) && !urlsToSkip.includes(u))
    .slice(0, MAX_DETAIL_LINKS);

  if (toVisit.length > 0) {
    logger.info(`[Phase 2] Visiting ${toVisit.length} job detail pages (skipped ${detailLinks.size - toVisit.length} existing/ignored)...`);

    for (let i = 0; i < toVisit.length; i++) {
      const url = toVisit[i];
      if (visited.has(url)) {
        continue;
      }
      visited.add(url);
      detailCount++;

      logger.info(`  [Detail ${detailCount}/${toVisit.length}] ${url}`);

      let html;
      try {
        html = await renderPage(url, timeoutMs);
      } catch (err) {
        logger.warn(`  Failed: ${err.message}`);
        continue;
      }

      const { text } = extractTextAndLinks(html, url);
      appendToFile(outFile, `Job Detail ${detailCount}: ${url}`, text);
      logger.info(`    → ${text.length} chars`);
    }
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
