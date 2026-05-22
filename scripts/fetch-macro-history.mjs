// scripts/fetch-macro-history.mjs
// 매크로 지표 다기간 비교용 1년치 일봉 시계열을 Yahoo Finance에서 받아온다.
//
// 사용법:  node scripts/fetch-macro-history.mjs
// 환경:    별도 환경변수 없음 (공개 chart API 사용)
//
// 입력:    config/macro-indicators.json
// 출력:    data/macro-history.json
//
// fetch-watchlist-prices.mjs의 Yahoo 부분을 단순화·재사용한 형태.

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

function buildChartUrl(symbol) {
  const params = new URLSearchParams({
    range: "5y",
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

function normalizeHistory(result, scale = 1) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = quote.close?.[i];
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: isoDate(timestamps[i]),
      open: round((quote.open?.[i] ?? null) * scale),
      high: round((quote.high?.[i] ?? null) * scale),
      low: round((quote.low?.[i] ?? null) * scale),
      close: round(close * scale)
    });
  }
  return rows.filter((r) => r.date);
}

async function fetchOne(indicator) {
  const url = buildChartUrl(indicator.yahooSymbol);
  try {
    const json = await fetchJson(url);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("empty chart result");
    const history = normalizeHistory(result, indicator.scale || 1);
    return {
      id: indicator.id,
      fredId: indicator.fredId || null,
      yahooSymbol: indicator.yahooSymbol,
      label: indicator.label,
      kind: indicator.kind,
      currency: result.meta?.currency || null,
      exchangeName: result.meta?.exchangeName || null,
      instrumentType: result.meta?.instrumentType || null,
      historyLength: history.length,
      latestDate: history[history.length - 1]?.date || null,
      latestClose: history[history.length - 1]?.close ?? null,
      history,
      error: null
    };
  } catch (err) {
    return {
      id: indicator.id,
      fredId: indicator.fredId || null,
      yahooSymbol: indicator.yahooSymbol,
      label: indicator.label,
      kind: indicator.kind,
      history: [],
      error: String(err.message || err)
    };
  }
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
  const previous = await readPreviousOutput();
  const fallbackById = new Map((previous?.items || []).map((item) => [item.id, item]));
  const indicators = Array.isArray(config.indicators) ? config.indicators : [];
  console.log(`[fetch-macro-history] fetching ${indicators.length} symbols from Yahoo Finance…`);

  const items = [];
  for (const ind of indicators) {
    process.stdout.write(`  ${ind.id.padEnd(14)} ${ind.yahooSymbol.padEnd(12)} … `);
    const t0 = Date.now();
    const result = await fetchOne(ind);
    const dt = Date.now() - t0;
    if (result.error) {
      const fallback = fallbackById.get(ind.id);
      if (fallback?.history?.length) {
        items.push({
          ...fallback,
          fallbackUsed: true,
          error: result.error,
          fetchedAt: new Date().toISOString()
        });
        process.stdout.write(`fallback ${fallback.history.length}d (${dt}ms): ${result.error}\n`);
        continue;
      }
      process.stdout.write(`✗ ${result.error}\n`);
    } else {
      process.stdout.write(`✓ ${result.historyLength}d (${dt}ms)\n`);
    }
    items.push(result);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance v8 chart API",
    range: "5y",
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
