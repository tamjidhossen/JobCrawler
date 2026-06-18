import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const CACHE_DIR = path.resolve('data/cache');

/**
 * saveToCache is kept for backward-compat but no longer the primary
 * caching mechanism — the scraper now writes directly to disk while crawling.
 */
export function saveToCache(companyId, content) {
  try {
    const dir = path.join(CACHE_DIR, String(companyId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}.txt`);
    fs.writeFileSync(file, content, 'utf8');
    return file;
  } catch (err) {
    logger.error('saveToCache failed', { error: err.message });
    return null;
  }
}

/**
 * Read a crawl cache file in chunks of `chunkSize` characters.
 * Yields one chunk at a time — never loads the whole file into memory.
 *
 * Usage:
 *   for await (const chunk of readFileChunked(filePath, 80000)) {
 *     await callGemini(chunk);
 *   }
 */
export async function* readFileChunked(filePath, chunkSize = 80000) {
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  logger.info(`[Cache] Reading ${filePath} (${(fileSize / 1024).toFixed(1)} KB) in ${chunkSize}-char chunks`);

  let position = 0;
  const buf = Buffer.alloc(chunkSize);

  while (position < fileSize) {
    const bytesRead = fs.readSync(fd, buf, 0, chunkSize, position);
    if (bytesRead === 0) break;

    let chunk = buf.slice(0, bytesRead).toString('utf8');

    // If we're in the middle of a file and not at the end, try to split cleanly
    // on a double-newline to avoid cutting mid-sentence
    if (position + bytesRead < fileSize) {
      const lastBreak = chunk.lastIndexOf('\n\n');
      if (lastBreak > chunkSize * 0.7) {
        // Roll back to the clean break point
        chunk = chunk.substring(0, lastBreak + 2);
        position += Buffer.byteLength(chunk, 'utf8');
      } else {
        position += bytesRead;
      }
    } else {
      position += bytesRead;
    }

    yield chunk;
  }

  fs.closeSync(fd);
}

/**
 * Returns the file size in bytes for a given path.
 */
export function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
