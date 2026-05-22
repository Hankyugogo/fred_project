// Minimal Gemini REST client. No external dependencies.
// Uses fetch (Node 22+) and process.env.GEMINI_API_KEY (auto-loaded via --env-file=.env).

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_RETRIES = 4;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Some free-tier accounts get a tight per-minute cap (observed: ~20/min). Hold to an 8-second
// floor between calls across the whole process so we stay below the limit even on stricter
// accounts. Override via GEMINI_MIN_INTERVAL_MS env variable.
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS || 8000);

let lastCallAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - now);
  if (wait > 0) {
    await sleep(wait);
  }
  lastCallAt = Date.now();
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env or export it before running.");
  }
  return key;
}

function buildEndpoint(model) {
  const m = model || DEFAULT_MODEL;
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(response) {
  const candidates = response?.candidates ?? [];
  if (candidates.length === 0) {
    return "";
  }
  const parts = candidates[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function extractRetryDelaySeconds(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    const details = parsed?.error?.details || [];
    for (const detail of details) {
      const type = detail?.["@type"] || "";
      if (type.includes("RetryInfo") && detail.retryDelay) {
        const match = String(detail.retryDelay).match(/^([\d.]+)s$/);
        if (match) return parseFloat(match[1]);
      }
    }
    const msg = parsed?.error?.message || "";
    const messageMatch = msg.match(/retry in\s+([\d.]+)s/i);
    if (messageMatch) return parseFloat(messageMatch[1]);
  } catch (_) {
    /* ignore */
  }
  return null;
}

function isResourceExhaustedQuota(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    const status = parsed?.error?.status;
    const message = String(parsed?.error?.message || "");
    return status === "RESOURCE_EXHAUSTED" && /quota|free_tier_requests|billing/i.test(message);
  } catch (_) {
    return /RESOURCE_EXHAUSTED|free_tier_requests|current quota|billing details/i.test(String(rawBody || ""));
  }
}

function extractGroundingSources(response) {
  const candidates = response?.candidates ?? [];
  const meta = candidates[0]?.groundingMetadata;
  if (!meta) {
    return [];
  }
  const chunks = meta.groundingChunks ?? [];
  return chunks
    .map((chunk) => {
      const web = chunk?.web;
      if (!web?.uri) {
        return null;
      }
      return { uri: web.uri, title: web.title || "" };
    })
    .filter(Boolean);
}

/**
 * Call Gemini.
 * @param {object} options
 * @param {string} options.prompt - User prompt text.
 * @param {string} [options.systemInstruction] - System guidance.
 * @param {string} [options.model] - Model id, default gemini-2.5-flash.
 * @param {number} [options.temperature]
 * @param {number} [options.maxOutputTokens]
 * @param {number} [options.thinkingBudget] - 0 disables internal reasoning (recommended for
 *   mechanical extractions). Positive integer caps it. Negative or undefined uses dynamic.
 *   Note: gemini-2.5-pro does not support 0 (minimum 128).
 * @param {boolean} [options.useGrounding] - Enable Google Search tool.
 * @param {object} [options.responseSchema] - JSON schema for structured output.
 * @param {boolean} [options.json] - Force application/json output.
 * @param {boolean} [options.autoRetryOnMaxTokens] - If true and MAX_TOKENS hit, retry once with
 *   doubled maxOutputTokens. Default true.
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @returns {Promise<{ text: string, sources: Array<{uri:string,title:string}>, raw: object, finishReason: string }>}
 */
export async function callGemini(options) {
  const {
    prompt,
    systemInstruction,
    model = DEFAULT_MODEL,
    temperature = 0.4,
    maxOutputTokens = 4096,
    thinkingBudget,
    useGrounding = false,
    responseSchema = null,
    json = false,
    autoRetryOnMaxTokens = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES
  } = options;

  if (!prompt || typeof prompt !== "string") {
    throw new Error("callGemini: prompt is required.");
  }

  if (useGrounding && (json || responseSchema)) {
    throw new Error("callGemini: useGrounding cannot be combined with json/responseSchema (Gemini API restriction).");
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (useGrounding) {
    body.tools = [{ googleSearch: {} }];
  }

  if (json || responseSchema) {
    body.generationConfig.responseMimeType = "application/json";
    if (responseSchema) {
      body.generationConfig.responseSchema = responseSchema;
    }
  }

  // Thinking budget: 2.5 series uses internal reasoning tokens that share the output budget.
  // Setting 0 disables reasoning entirely — ideal for mechanical extractions where the model
  // does not need to "think" before producing structured output.
  if (typeof thinkingBudget === "number") {
    body.generationConfig.thinkingConfig = { thinkingBudget };
  }

  const endpoint = buildEndpoint(model);
  let lastError = null;
  let didMaxTokensRetry = false;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Global rate-limit shaping. Honour the floor between every call.
    await throttle();

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": getApiKey()
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        const error = new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 600)}`);
        error.status = res.status;
        error.quotaExceeded = res.status === 429 && isResourceExhaustedQuota(errBody);
        if (error.quotaExceeded) {
          throw error;
        }
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          let waitMs;
          if (res.status === 429) {
            // Prefer (1) Retry-After header → (2) RetryInfo.retryDelay in body
            // → (3) "Please retry in N s" in message → (4) attempt-based fallback.
            const retryAfter = Number(res.headers.get("retry-after"));
            const bodyDelay = extractRetryDelaySeconds(errBody);
            const seconds = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter
              : (bodyDelay && bodyDelay > 0 ? bodyDelay : 60 * attempt);
            // Pad by 2 seconds to make sure the quota window has actually rolled over.
            waitMs = Math.ceil(seconds * 1000) + 2000;
            process.stderr.write(
              `    ⏳ 429 rate limit — Gemini 지시 ${seconds.toFixed(1)}초 대기 후 재시도 (${attempt}/${maxRetries})\n`
            );
          } else {
            waitMs = 500 * 2 ** (attempt - 1);
          }
          lastError = error;
          await sleep(waitMs);
          continue;
        }
        throw error;
      }

      const payload = await res.json();
      const finishReason = payload?.candidates?.[0]?.finishReason;
      const text = extractText(payload);

      if (!text && finishReason && finishReason !== "STOP") {
        const error = new Error(`Gemini returned empty text (finishReason=${finishReason}).`);
        error.finishReason = finishReason;
        if (attempt < maxRetries) {
          lastError = error;
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      // Partial output (JSON truncated mid-string) when MAX_TOKENS hit.
      // Surface it explicitly so callers can retry with higher budget.
      if (finishReason === "MAX_TOKENS") {
        if (autoRetryOnMaxTokens && !didMaxTokensRetry) {
          didMaxTokensRetry = true;
          const newBudget = Math.min(body.generationConfig.maxOutputTokens * 2, 32768);
          process.stderr.write(
            `    ↻ MAX_TOKENS — 출력 예산을 ${body.generationConfig.maxOutputTokens} → ${newBudget}로 두 배 확대 후 재시도\n`
          );
          body.generationConfig.maxOutputTokens = newBudget;
          // Disable thinking on the retry to leave the entire budget for output.
          body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
          continue;
        }
        const error = new Error(
          `Gemini hit MAX_TOKENS — response was truncated (got ${text.length} chars). ` +
          `Increase maxOutputTokens and retry.`
        );
        error.finishReason = finishReason;
        error.truncatedText = text;
        throw error;
      }

      return {
        text,
        sources: extractGroundingSources(payload),
        raw: payload,
        finishReason
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const isAbort = error?.name === "AbortError";
      const status = error?.status;
      if (error?.quotaExceeded) {
        throw error;
      }
      const retryable = isAbort || (typeof status === "number" && RETRYABLE_STATUS.has(status));
      if (retryable && attempt < maxRetries) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("callGemini: exhausted retries.");
}

/**
 * Call Gemini and parse the JSON response.
 * Defaults thinkingBudget to 0 — structured extraction tasks don't benefit from internal
 * reasoning and disabling it gives the entire output budget back to the actual response.
 * Pass thinkingBudget explicitly (e.g. 2048) for creative structured outputs.
 */
export async function callGeminiJson(options) {
  const merged = {
    thinkingBudget: 0,
    ...options,
    json: true
  };
  const result = await callGemini(merged);
  const trimmed = result.text.trim();
  // Strip markdown fences if model wrapped output in ```json ... ```
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return { ...result, json: parsed };
  } catch (error) {
    const head = cleaned.slice(0, 200);
    throw new Error(`Failed to parse Gemini JSON output. Head: ${head}`);
  }
}
