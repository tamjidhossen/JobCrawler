import { GoogleGenAI } from '@google/genai';
import { readFileChunked } from './cleaner.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODEL POOL — ordered by priority (most generous limits first)
// Source: your AI Studio rate limits dashboard
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_POOL = [
  // Gemma: unlimited TPM, 1500 RPD — best for large text batches
  { id: 'gemma-4-31b-it',        rpm: 15, rpd: 1500, supportsSchema: false },
  // Gemini Flash Lite: 500 RPD (best Gemini option for daily volume)
  { id: 'gemini-3.1-flash-lite', rpm: 15, rpd: 500,  supportsSchema: true  },
  // Remaining Gemini models: 20 RPD each — use as last resorts
  { id: 'gemini-2.5-flash-lite', rpm: 10, rpd: 20,   supportsSchema: true  },
  { id: 'gemini-2.5-flash',      rpm: 5,  rpd: 20,   supportsSchema: true  },
  { id: 'gemini-3-flash-preview',rpm: 5,  rpd: 20,   supportsSchema: true  },
  { id: 'gemini-3.5-flash',      rpm: 5,  rpd: 20,   supportsSchema: true  },
];

// Per-model runtime state — tracks calls made today + last-used timestamp
const modelState = Object.fromEntries(
  MODEL_POOL.map(m => [m.id, {
    rdpUsed:       0,        // requests used today
    lastReset:     today(),  // the date string when rdpUsed was last zeroed
    coolingUntil:  0,        // epoch ms — don't use model until this time
    lastCallAt:    0,        // epoch ms of last API call
  }])
);

function today() {
  return new Date().toISOString().slice(0, 10); // "2026-06-16"
}

/** Reset daily counter if it's a new day */
function refreshDailyCounter(modelId) {
  const s = modelState[modelId];
  const d = today();
  if (s.lastReset !== d) {
    s.rdpUsed  = 0;
    s.lastReset = d;
    logger.info(`[ModelPool] Daily counter reset for ${modelId}`);
  }
}

/** Mark a model as rate-limited / cooling for a given duration */
function cooldown(modelId, ms) {
  modelState[modelId].coolingUntil = Date.now() + ms;
  logger.warn(`[ModelPool] ${modelId} cooling down for ${(ms / 1000).toFixed(0)}s`);
}

/**
 * Pick the best available model right now.
 * Returns the model config, or null if everything is exhausted.
 */
function pickModel() {
  const now = Date.now();

  for (const m of MODEL_POOL) {
    refreshDailyCounter(m.id);
    const s = modelState[m.id];

    if (s.coolingUntil > now) {
      continue;
    }

    if (s.rdpUsed >= m.rpd) {
      continue;
    }

    // Enforce per-model RPM by checking time since last call
    const minGapMs = Math.ceil(60000 / m.rpm); // ms between calls
    const elapsed  = now - s.lastCallAt;
    if (elapsed < minGapMs) {
      const wait = minGapMs - elapsed;
      logger.verbose(`[ModelPool] Selected ${m.id} with RPM wait: ${wait}ms`);
      return { model: m, waitMs: wait };
    }

    logger.verbose(`[ModelPool] Selected ${m.id} immediately`);
    return { model: m, waitMs: 0 };
  }

  logger.warn(`[ModelPool] All models exhausted or rate-limited`);
  return null; // all models exhausted
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON schema for the expected job extraction output
// ─────────────────────────────────────────────────────────────────────────────
const JOB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    jobs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title:        { type: 'STRING' },
          description:  { type: 'STRING' },
          location:     { type: 'STRING' },
          department:   { type: 'STRING' },
          job_type:     { type: 'STRING' },
          job_url:      { type: 'STRING' },
          salary_range: { type: 'STRING' },
        },
        required: ['title'],
      },
    },
  },
  required: ['jobs'],
};

// JSON schema described in text, for models that don't support responseSchema
const SCHEMA_DESCRIPTION = `
Return a JSON object with this exact structure:
{
  "jobs": [
    {
      "title": "Job Title (required)",
      "description": "Role summary up to 500 chars",
      "location": "City, Country or Remote or Hybrid",
      "department": "Team or department name",
      "job_type": "Full-time | Part-time | Contract | Internship",
      "job_url": "Direct URL to the job posting",
      "salary_range": "e.g. $100K-$130K (if mentioned)"
    }
  ]
}
If no jobs found, return: { "jobs": [] }
`;

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'your_gemini_api_key_here') {
      throw new Error('GEMINI_API_KEY not set in .env');
    }
    _client = new GoogleGenAI({ apiKey: key });
  }
  return _client;
}

/**
 * Robustly extract a JSON object from a model's plain-text response.
 *
 * Gemma (and other non-schema models) sometimes:
 *   - Wrap JSON in ```json ... ``` fences
 *   - Add explanatory text before or after the JSON
 *   - Include trailing commas (invalid JSON but common LLM output)
 *   - Leave unquoted object keys
 *
 * We try four strategies in order:
 *   1. Direct JSON.parse (clean response)
 *   2. Extract from ``` code fence
 *   3. Extract between outermost { ... }
 *   4. Repair common LLM JSON mistakes then re-parse
 */
function extractJsonFromText(text) {
  const t = text.trim();
  logger.verbose(`[Gemini] extractJsonFromText: starting extraction (input length: ${t.length} chars)`);

  // Strategy 1 — Clean response, parse directly
  try {
    const parsed = JSON.parse(t);
    logger.verbose(`[Gemini] extractJsonFromText: Strategy 1 (Direct JSON) succeeded`);
    return parsed;
  } catch (err) {
    logger.verbose(`[Gemini] extractJsonFromText: Strategy 1 failed: ${err.message}`);
  }

  // Strategy 2 — Markdown code fence: ```json ... ``` or ``` ... ```
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 2 (Markdown code fence) succeeded`);
      return parsed;
    } catch (err) {
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 2 failed: ${err.message}`);
    }
  }

  // Strategy 3 — Find outermost { ... } or [ ... ] boundaries
  const firstBrace = t.indexOf('{');
  const lastBrace  = t.lastIndexOf('}');
  const firstBracket = t.indexOf('[');
  const lastBracket  = t.lastIndexOf(']');

  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = lastBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = lastBracket;
  }

  if (startIdx !== -1 && endIdx > startIdx) {
    const candidate = t.slice(startIdx, endIdx + 1);
    try {
      const parsed = JSON.parse(candidate);
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 3 (Outermost boundaries) succeeded`);
      return parsed;
    } catch (err) {
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 3 failed: ${err.message}`);
    }

    // Strategy 4 — Repair common LLM JSON mistakes and retry
    try {
      const repaired = candidate
        // Remove trailing commas before } or ]
        .replace(/,(\s*[}\]])/g, '$1')
        // Remove trailing commas at end of object values (e.g. "key": "val",})
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(repaired);
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 4 (JSON mistake repairs) succeeded`);
      return parsed;
    } catch (err) {
      logger.verbose(`[Gemini] extractJsonFromText: Strategy 4 failed: ${err.message}`);
    }
  }

  // Nothing worked
  const preview = t.slice(0, 200).replace(/\n/g, ' ');
  logger.verbose(`[Gemini] extractJsonFromText: All parsing strategies failed. Full raw response:\n${t}`);
  throw new Error(`Could not parse JSON from model response. Preview: "${preview}"`);
}

/**
 * Core API call — uses the selected model and adapts for schema support.
 *
 * If the model supports responseSchema → structured JSON output (most reliable).
 * If not (Gemma) → plain text, ask for JSON in prompt, then parse manually.
 *
 * What Gemini returns:
 *   - With responseSchema: `response.text` is a clean JSON string → JSON.parse()
 *   - Without schema (plain text): `response.text` is a markdown or raw string
 *     → we extract the JSON block ourselves via extractJsonFromText()
 */
async function callModel(model, prompt) {
  const client = getClient();
  logger.verbose(`[Gemini] callModel: invoking ${model.id} (supportsSchema: ${model.supportsSchema}, promptLength: ${prompt.length})`);
  logger.verbose(`[Gemini] Prompt preview: "${prompt.slice(0, 300).replace(/\n/g, ' ')}..."`);

  if (model.supportsSchema) {
    // Structured output — Gemini enforces the schema server-side
    const resp = await client.models.generateContent({
      model: model.id,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema:   JOB_SCHEMA,
        temperature:      0,
      },
    });
    logger.verbose(`[Gemini] Response length: ${resp.text?.length || 0} chars`);
    logger.verbose(`[Gemini] Response preview: "${(resp.text || '').slice(0, 300).replace(/\n/g, ' ')}..."`);
    // resp.text is a JSON string — parse it
    return JSON.parse(resp.text);
  } else {
    // Plain text output — Gemma / unsupported models
    // We embed the schema description in the prompt and parse the response
    const resp = await client.models.generateContent({
      model:    model.id,
      contents: prompt,
      config: {
        temperature: 0,
      },
    });
    logger.verbose(`[Gemini] Response length: ${resp.text?.length || 0} chars`);
    logger.verbose(`[Gemini] Response preview: "${(resp.text || '').slice(0, 300).replace(/\n/g, ' ')}..."`);
    return extractJsonFromText(resp.text);
  }
}

/**
 * Send a prompt to the best available model, with automatic fallback.
 *
 * On 429 → cooldown the model + immediately retry with the next one.
 * On daily limit → mark model exhausted + retry with next.
 * On other errors → short wait + retry same model once, then fall through.
 */
async function callWithFallback(prompt) {
  let attempts = 0;
  const maxTotal = MODEL_POOL.length * 2; // safety cap

  while (attempts < maxTotal) {
    attempts++;

    const pick = pickModel();
    if (!pick) {
      throw new Error('All models are exhausted for today. Try again tomorrow.');
    }

    const { model, waitMs } = pick;

    // Respect per-model RPM gap
    if (waitMs > 0) {
      logger.verbose(`[Gemini] Waiting ${waitMs}ms to respect RPM gap for ${model.id}`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    // Record the call
    const s = modelState[model.id];
    s.lastCallAt = Date.now();
    s.rdpUsed++;

    logger.info(`[Gemini] Using ${model.id} (RPD: ${s.rdpUsed}/${model.rpd})`);

    try {
      return await callModel(model, prompt);
    } catch (err) {
      const msg    = String(err.message || err);
      const status = err.status || err.code || '?';

      // Always log the full error so you can see what actually went wrong
      logger.warn(`[Gemini] ${model.id} error [${status}]: ${msg.slice(0, 300)}`);

      const is429        = status === 429 || /429|quota|rate.?limit/i.test(msg);
      const isCapacity   = /capacity|overloaded|unavailable|503/i.test(msg);
      const isNotFound   = /not.?found|does not exist|unknown model|invalid.*model/i.test(msg);
      const isUnsupported = /not.?support|invalid.*schema|responseSchema|unsupported/i.test(msg);

      if (is429 || isCapacity) {
        cooldown(model.id, 65000); // 65 seconds — just over 1 minute
        logger.warn(`[Gemini] ${model.id} rate-limited or at capacity. Switching model...`);
        continue;
      }

      if (isNotFound) {
        // Model doesn't exist on this API key — disable it permanently for this session
        logger.warn(`[Gemini] ${model.id} not available on this API key. Skipping permanently.`);
        s.rdpUsed = model.rpd; // Mark as exhausted so it's never picked again
        continue;
      }

      if (isUnsupported && model.supportsSchema) {
        // Model can't do structured output — downgrade to plain-text mode and retry
        logger.warn(`[Gemini] ${model.id} doesn't support responseSchema. Retrying in plain-text mode.`);
        model.supportsSchema = false;
        s.rdpUsed--;           // Don't count this failed call
        continue;
      }

      throw err;
    }
  }

  throw new Error('Exceeded max fallback attempts across all models.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a company's crawl cache file in chunks and extract all jobs.
 *
 * - Never loads the full file into memory (uses readFileChunked generator)
 * - ONE Gemini call per chunk (most companies = 1 chunk = 1 API call)
 * - Deduplicates jobs by title across chunks
 * - Automatically rotates models on exhaustion/rate-limits
 *
 * @param {string} companyName
 * @param {string} careerUrl
 * @param {string} cacheFilePath  — path returned by crawlCompany()
 * @returns {Promise<Array>}       — flat deduplicated job objects
 */
export async function batchExtractJobs(companyName, careerUrl, cacheFilePath) {
  const allJobs    = [];
  const seenTitles = new Set();
  let   chunkIndex = 0;
  logger.verbose(`[Gemini] batchExtractJobs: starting extraction for ${companyName} (${careerUrl}) using cache file: ${cacheFilePath}`);

  for await (const chunk of readFileChunked(cacheFilePath, 80000)) {
    chunkIndex++;
    logger.info(`[Gemini] ${companyName} — processing chunk ${chunkIndex} (${chunk.length.toLocaleString()} chars)`);
    logger.verbose(`[Gemini] Chunk ${chunkIndex} content sample: "${chunk.slice(0, 150).replace(/\n/g, ' ')}..."`);

    const schemaModelAvailable = MODEL_POOL.some(m => m.supportsSchema && modelState[m.id].rdpUsed < m.rpd);
    logger.verbose(`[Gemini] Schema model availability: ${schemaModelAvailable}`);
    const prompt = buildPrompt(companyName, careerUrl, chunk, chunkIndex, schemaModelAvailable);

    let result;
    try {
      result = await callWithFallback(prompt);
    } catch (err) {
      logger.error(`[Gemini] Chunk ${chunkIndex} permanently failed: ${err.message}`);
      continue;
    }

    const jobs = Array.isArray(result) ? result : (result?.jobs || []);
    logger.info(`[Gemini] Chunk ${chunkIndex}: ${jobs.length} jobs extracted`);
    logger.verbose(`[Gemini] Extracted jobs list from chunk ${chunkIndex}: ${JSON.stringify(jobs)}`);

    for (const job of jobs) {
      if (!job.title?.trim()) {
        logger.verbose(`[Gemini] Ignored extracted job with empty title: ${JSON.stringify(job)}`);
        continue;
      }
      const key = job.title.trim().toLowerCase();
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        allJobs.push(job);
        logger.verbose(`[Gemini] Accepted unique job title: "${job.title}"`);
      } else {
        logger.verbose(`[Gemini] Filtered duplicate job title: "${job.title}"`);
      }
    }
  }

  logger.info(`[Gemini] ${companyName}: total ${allJobs.length} unique jobs across ${chunkIndex} chunk(s)`);
  return allJobs;
}

function buildPrompt(companyName, careerUrl, chunk, chunkIndex, includeSchemaHint) {
  const schemaSection = includeSchemaHint ? '' : `\n${SCHEMA_DESCRIPTION}\n`;

  return `
You are an expert recruitment data extraction engine.

The text below was scraped from the careers site of "${companyName}" (${careerUrl}).
It includes listing pages AND individual job detail pages, each labeled with its source URL.

Extract ALL active individual job postings you can identify.

CRITICAL RULES:
1. DO NOT extract services/consulting offerings or staff augmentation options (e.g. "React.js developers", "Angular.js developers", "Next.js developers", "Hire Developers"). These are services/sales pages, not jobs!
2. DO NOT extract department landing pages, team overviews, or division descriptions (e.g. "Software Engineering", "Manufacturing & Engineering", "ReliSource Partner of Excellence").
3. DO NOT extract corporate news, general portals, culture blogs, picnics, or team activities (e.g. "Life at 6sense: Where Work Meets Joy!").
4. DO NOT extract placeholder labels or navigation buttons like "Apply Now", "Join Our Team", "Open Positions" as job titles.
5. Merge listing + detail page data for the same job into ONE entry — use the most complete version.
6. Do NOT invent data — only extract what is actually in the text.

For each job, extract:
- title: Job title (REQUIRED — skip if absent)
- description: Role summary from the detail page text (up to 500 chars, prefer the detail page over the listing snippet)
- location: City/Country, "Remote", or "Hybrid"
- department: Team or department (e.g. Engineering, Sales, Design)
- job_type: "Full-time", "Part-time", "Contract", "Internship" — leave blank if unknown
- job_url: Direct link to that specific job posting (look at the section label "Job Detail N: <url>" or find the URL in the text)
- salary_range: Only if explicitly stated

${schemaSection}
=== SCRAPED TEXT (chunk ${chunkIndex}) ===
${chunk}
=== END ===
`.trim();
}

/** Log current model pool status — useful for debugging */
export function logModelStatus() {
  logger.info('[ModelPool] Current status:');
  for (const m of MODEL_POOL) {
    refreshDailyCounter(m.id);
    const s   = modelState[m.id];
    const cool = s.coolingUntil > Date.now()
      ? ` (cooling ${((s.coolingUntil - Date.now()) / 1000).toFixed(0)}s)`
      : '';
    logger.info(`  ${m.id}: ${s.rdpUsed}/${m.rpd} RPD used${cool}`);
  }
}
