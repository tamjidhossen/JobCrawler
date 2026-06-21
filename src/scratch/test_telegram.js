import dns from 'dns';
import dotenv from 'dotenv';

// Mock logger
const logger = {
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Force Node.js DNS to prefer IPv4
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

// Helper for resilient fetch requests with retry logic and detailed error parsing
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      const isLastAttempt = attempt === retries;
      let errMsg = err.message;
      
      if (err.cause) {
        if (err.cause.name === 'AggregateError' && Array.isArray(err.cause.errors)) {
          errMsg = `${err.message} (Cause: AggregateError: [${err.cause.errors.map(e => e.message).join(', ')}])`;
        } else {
          errMsg = `${err.message} (Cause: ${err.cause.message || err.cause})`;
        }
      } else if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
        errMsg = `AggregateError: [${err.errors.map(e => e.message).join(', ')}]`;
      }

      logger.warn(`Fetch attempt ${attempt} failed. Url: ${url}. Error: ${errMsg}`);
      
      if (isLastAttempt) {
        const finalErr = new Error(errMsg);
        finalErr.originalError = err;
        throw finalErr;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
    }
  }
}

async function runTest() {
  console.log('--- Test 1: Successful Connection to Telegram ---');
  const token = process.env.TELEGRAM_BOT_TOKEN || '8636910703:AAGXN8a4-zF7a0W14_d7tpxSxfriiCfDtOo';
  const url = `https://api.telegram.org/bot${token}/getMe`;
  try {
    const res = await fetchWithRetry(url, {}, 3, 100);
    const data = await res.json();
    console.log('Success connecting to Telegram on first try!', data.ok);
  } catch (err) {
    console.error('Test 1 failed:', err.message);
  }

  console.log('\n--- Test 2: Failing Connection (Invalid Domain / Timeout simulation) ---');
  const badUrl = 'https://invalid-domain-does-not-exist-12345.org/';
  try {
    await fetchWithRetry(badUrl, {}, 3, 100);
  } catch (err) {
    console.log('Test 2 caught final expected error:', err.message);
  }
}

runTest();

