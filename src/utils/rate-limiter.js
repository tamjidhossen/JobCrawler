import { logger } from './logger.js';

class RateLimiter {
  constructor() {
    this.rpm = parseInt(process.env.GEMINI_RPM) || 8;
    this.tokens = this.rpm;
    this.lastRefill = Date.now();
    this.queue = [];
    this.isProcessing = false;

    // Set interval to refill tokens periodically
    this.refillInterval = setInterval(() => this.refill(), 1000);
  }

  refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const tokensToAdd = (elapsedMs * this.rpm) / 60000; // rpm per minute
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.rpm, this.tokens + tokensToAdd);
      this.lastRefill = now;
      this.processQueue();
    }
  }

  async acquire() {
    return new Promise(resolve => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        const resolve = this.queue.shift();
        resolve();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  destroy() {
    clearInterval(this.refillInterval);
  }
}

export const geminiLimiter = new RateLimiter();
