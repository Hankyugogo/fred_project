// Fetch Korean indices from Yahoo Finance v8 chart API.
// No API key required, public endpoint, returns JSON.
//
// Symbols:
//   ^KS11  KOSPI Composite
//   ^KQ11  KOSDAQ
//
// Output: data/yahoo-snapshot.json (consumed by build-briefing.mjs)
//
// 원-엔(JPY/KRW)은 FRED의 DEXKOUS / DEXJPUS × 100 으로 build-briefing.mjs에서 파생 계산한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "yahoo-snapshot.json");

const SYMBOLS = [
  {
    id: "KOSPI",
    label: "코스피",
    group: "korea",
    yahoo: "^KS11",
    naver: "KOSPI",
    format: "index",
    decimals: 2,
    sourceUrl: "https://finance.yahoo.com/quote/%5EKS11"
  },
  {
    id: "KOSDAQ",
    label: "코스닥",
    group: "korea",
    yahoo: "^KQ11",
    naver: "KOSDAQ",
    format: "index",
    decimals: 2,
    sourceUrl: "https://finance.yahoo.com/quote/%5EKQ11"
  }
];

const FETCH_TIMEOUT_MS = 30_000;

function buildChartUrl(symbol) {
  // 5-day daily window — gives us at least latest + previous trading-day close.
  const params = new URLSearchParams({ range: "10d", interval: "1d" });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

function buildNaverUrl(symbol) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const ymd = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({
    symbol,
    requestType: "1",
    startTime: ymd(start),
    endTime: ymd(end),
    timeframe: "day"
  });
  return `https://api.finance.naver.com/siseJson.naver?${params}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Yahoo blocks unidentified bots. Use a benign desktop UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "application/json,text/plain,*/*"
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "text/plain,text/javascript,*/*"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function isoDateFromYmd(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeSuccessfulItem(spec, last, prev, source, sourceUrl) {
  const close = round(last.close, spec.decimals);
  const prevClose = prev ? round(prev.close, spec.decimals) : null;
  const absoluteChange = prev ? round(close - prevClose, spec.decimals) : null;
  const percentChange = prev && prevClose !== 0
    ? round(((close - prevClose) / prevClose) * 100, 2)
    : null;

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue: close,
    previousValue: prevClose,
    absoluteChange,
    percentChange,
    observationDate: last.date,
    previousObservationDate: prev ? prev.date : null,
    source,
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchYahooSymbol(spec) {
  const url = buildChartUrl(spec.yahoo);
  let payload;
  try {
    payload = await fetchJson(url);
  } catch (error) {
    throw new Error(error.message);
  }

  const result = payload?.chart?.result?.[0];
  if (!result) {
    const errMessage = payload?.chart?.error?.description || "no result";
    throw new Error(errMessage);
  }

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  // Find the last two valid (non-null) close values, paired with timestamps.
  const validPairs = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (Number.isFinite(closes[i])) {
      validPairs.push({ date: isoDate(timestamps[i]), close: closes[i] });
    }
  }

  if (validPairs.length === 0) {
    throw new Error("no valid closes");
  }

  const last = validPairs[validPairs.length - 1];
  const prev = validPairs.length >= 2 ? validPairs[validPairs.length - 2] : null;
  return normalizeSuccessfulItem(spec, last, prev, "yahoo-finance", spec.sourceUrl);
}

function parseNaverRows(text) {
  const rows = [];
  const rowPattern = /\[\s*"(\d{8})"\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,/g;
  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    rows.push({
      date: isoDateFromYmd(match[1]),
      close: Number(match[5])
    });
  }
  return rows.filter((row) => row.date && Number.isFinite(row.close));
}

async function fetchNaverSymbol(spec) {
  if (!spec.naver) throw new Error("Naver symbol missing");
  const text = await fetchText(buildNaverUrl(spec.naver));
  const rows = parseNaverRows(text);
  if (!rows.length) throw new Error("Naver response has no rows");
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  return normalizeSuccessfulItem(
    spec,
    last,
    prev,
    "naver-finance-sise-json",
    `https://finance.naver.com/sise/sise_index.naver?code=${encodeURIComponent(spec.naver)}`
  );
}

async function fetchSymbol(spec, fallbackById) {
  process.stderr.write(`  - ${spec.id} (${spec.label}) ${spec.yahoo}... `);
  try {
    const yahoo = await fetchYahooSymbol(spec);
    process.stderr.write(`${yahoo.latestValue.toFixed(spec.decimals)} (${yahoo.observationDate}, Yahoo)\n`);
    return yahoo;
  } catch (yahooError) {
    process.stderr.write(`Yahoo 실패 (${yahooError.message}); Naver 재시도... `);
    try {
      const naver = await fetchNaverSymbol(spec);
      process.stderr.write(`${naver.latestValue.toFixed(spec.decimals)} (${naver.observationDate}, Naver)\n`);
      return naver;
    } catch (naverError) {
      const fallback = fallbackById.get(spec.id);
      if (fallback && !fallback.error) {
        process.stderr.write(`기존값 유지 (${naverError.message})\n`);
        return {
          ...fallback,
          fallbackUsed: true,
          fallbackReason: `Yahoo: ${yahooError.message}; Naver: ${naverError.message}`
        };
      }
      process.stderr.write(`실패 (${naverError.message})\n`);
      return { ...spec, error: `Yahoo: ${yahooError.message}; Naver: ${naverError.message}` };
    }
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
  console.log("Yahoo Finance에서 코스피·코스닥 수집 시작...");
  const previous = await readPreviousOutput();
  const fallbackById = new Map((previous?.items || []).map((item) => [item.id, item]));
  const items = [];
  for (const spec of SYMBOLS) {
    const result = await fetchSymbol(spec, fallbackById);
    items.push(result);
  }
  const output = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance v8 chart API",
    items
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const successful = items.filter((i) => !i.error).length;
  console.log(`Yahoo 결과 ${successful}/${items.length}건을 ${OUTPUT_PATH}에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
