// scripts/fetch-macro-history.mjs
// 매크로 지표 다기간 비교용 1년치 일봉 시계열을 가져온다.
//
// 우선순위:
//   1) fredId 있음 → FRED API (api.stlouisfed.org, FRED_API_KEY 필요)
//   2) fredId 없거나 FRED 실패 → Yahoo Finance v8 chart API
//   3) 모두 실패 → 기존 캐시 유지 (fallback)
//
// 사용법:  node scripts/fetch-macro-history.mjs
// 환경:    FRED_API_KEY (.env 또는 환경변수)
//
// 입력:    config/macro-indicators.json
// 출력:    data/macro-history.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "macro-indicators.json");
const OUTPUT_PATH = path.join(ROOT, "data", "macro-history.json");
const FETCH_TIMEOUT_MS = 30_000;

// FRED observations endpoint
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// render-report needs up to 252 trading days (1년). ~425 calendar days covers it safely.
function fredStartDate() {
  const d = new Date(Date.now() - 425 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function buildYahooChartUrl(symbol) {
  const params = new URLSearchParams({
    range: "1y",
    interval: "1d",
    includePrePost: "false"
  });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "application/json,text/plain,*/*"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function isoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// FRED observations → history[]
// scale은 Yahoo 전용 보정치이므로 FRED 경로에서는 적용하지 않는다.
async function fetchFredHistory(indicator, apiKey) {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", indicator.fredId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("observation_start", fredStartDate());

  const json = await fetchJson(url.toString());
  if (!Array.isArray(json.observations)) throw new Error("FRED: unexpected payload");

  const history = json.observations
    .filter((obs) => obs.value !== "." && obs.value !== null && obs.value !== "")
    .map((obs) => ({
      date: obs.date,
      close: round(parseFloat(obs.value))
    }))
    .filter((row) => row.date && Number.isFinite(row.close));

  if (history.length < 2) throw new Error(`FRED: insufficient history (${history.length})`);

  return {
    id: indicator.id,
    fredId: indicator.fredId,
    yahooSymbol: indicator.yahooSymbol,
    label: indicator.label,
    kind: indicator.kind,
    historyLength: history.length,
    latestDate: history[history.length - 1].date,
    latestClose: history[history.length - 1].close,
    history,
    source: "FRED API",
    error: null
  };
}

// Yahoo Finance chart → history[]
function normalizeYahooHistory(result, scale = 1) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = quote.close?.[i];
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: isoDate(timestamps[i]),
      close: round(close * scale)
    });
  }
  return rows.filter((r) => r.date && Number.isFinite(r.close));
}

async function fetchYahooHistory(indicator) {
  const url = buildYahooChartUrl(indicator.yahooSymbol);
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("empty chart result");
  const history = normalizeYahooHistory(result, indicator.scale || 1);
  if (history.length < 2) throw new Error(`insufficient history (${history.length})`);

  return {
    id: indicator.id,
    fredId: indicator.fredId || null,
    yahooSymbol: indicator.yahooSymbol,
    label: indicator.label,
    kind: indicator.kind,
    historyLength: history.length,
    latestDate: history[history.length - 1].date,
    latestClose: history[history.length - 1].close,
    history,
    source: "Yahoo Finance v8 chart API",
    error: null
  };
}

async function fetchOne(indicator, apiKey, fallback) {
  const hasFred = Boolean(indicator.fredId && apiKey);
  const errors = [];

  // 1) FRED API
  if (hasFred) {
    try {
      return await fetchFredHistory(indicator, apiKey);
    } catch (err) {
      errors.push(`FRED: ${err.message}`);
    }
  }

  // 2) Yahoo Finance
  try {
    return await fetchYahooHistory(indicator);
  } catch (err) {
    errors.push(`Yahoo: ${err.message}`);
  }

  // 3) 캐시 폴백
  const errorMsg = errors.join("; ");
  if (fallback?.history?.length) {
    return {
      ...fallback,
      fallbackUsed: true,
      error: errorMsg,
      fetchedAt: new Date().toISOString()
    };
  }

  return {
    id: indicator.id,
    fredId: indicator.fredId || null,
    yahooSymbol: indicator.yahooSymbol,
    label: indicator.label,
    kind: indicator.kind,
    history: [],
    error: errorMsg
  };
}

async function readPreviousOutput() {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const apiKey = process.env.FRED_API_KEY || null;
  const previous = await readPreviousOutput();
  const fallbackById = new Map((previous?.items || []).map((item) => [item.id, item]));
  const indicators = Array.isArray(config.indicators) ? config.indicators : [];

  if (!apiKey) {
    console.warn("[fetch-macro-history] FRED_API_KEY 없음 — fredId 있는 심볼도 Yahoo로만 시도합니다.");
  }

  console.log(`[fetch-macro-history] fetching ${indicators.length} symbols…`);

  const items = [];
  for (const ind of indicators) {
    const hasFred = Boolean(ind.fredId && apiKey);
    const label = hasFred ? "FRED→Yahoo" : "Yahoo";
    process.stdout.write(`  ${ind.id.padEnd(14)} ${ind.yahooSymbol.padEnd(12)} [${label}] … `);
    const t0 = Date.now();
    const result = await fetchOne(ind, apiKey, fallbackById.get(ind.id));
    const dt = Date.now() - t0;

    if (!result.error) {
      process.stdout.write(`✓ ${result.source} ${result.historyLength}d (${dt}ms)\n`);
    } else if (result.fallbackUsed) {
      process.stdout.write(`fallback ${result.history.length}d (${dt}ms): ${result.error}\n`);
    } else {
      process.stdout.write(`✗ ${result.error}\n`);
    }

    items.push(result);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "FRED API + Yahoo Finance v8 chart API",
    range: "~14mo",
    interval: "1d",
    configPath: "config/macro-indicators.json",
    items
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  const okCount = items.filter((it) => !it.error).length;
  console.log(`[fetch-macro-history] wrote ${OUTPUT_PATH} (${okCount}/${items.length} symbols OK)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
