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
    format: "index",
    decimals: 2,
    sourceUrl: "https://finance.yahoo.com/quote/%5EKS11"
  },
  {
    id: "KOSDAQ",
    label: "코스닥",
    group: "korea",
    yahoo: "^KQ11",
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

function isoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function fetchSymbol(spec) {
  const url = buildChartUrl(spec.yahoo);
  process.stderr.write(`  - ${spec.id} (${spec.label}) ${spec.yahoo}... `);
  let payload;
  try {
    payload = await fetchJson(url);
  } catch (error) {
    process.stderr.write(`실패 (${error.message})\n`);
    return { ...spec, error: error.message };
  }

  const result = payload?.chart?.result?.[0];
  if (!result) {
    const errMessage = payload?.chart?.error?.description || "no result";
    process.stderr.write(`실패 (${errMessage})\n`);
    return { ...spec, error: errMessage };
  }

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  // Find the last two valid (non-null) close values, paired with timestamps.
  const validPairs = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (Number.isFinite(closes[i])) {
      validPairs.push({ ts: timestamps[i], close: closes[i] });
    }
  }

  if (validPairs.length === 0) {
    process.stderr.write("실패 (no valid closes)\n");
    return { ...spec, error: "no valid closes" };
  }

  const last = validPairs[validPairs.length - 1];
  const prev = validPairs.length >= 2 ? validPairs[validPairs.length - 2] : null;

  const close = round(last.close, spec.decimals);
  const prevClose = prev ? round(prev.close, spec.decimals) : null;
  const absoluteChange = prev ? round(close - prevClose, spec.decimals) : null;
  const percentChange = prev && prevClose !== 0
    ? round(((close - prevClose) / prevClose) * 100, 2)
    : null;

  process.stderr.write(`${close.toFixed(spec.decimals)} (${isoDate(last.ts)})\n`);

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
    observationDate: isoDate(last.ts),
    previousObservationDate: prev ? isoDate(prev.ts) : null,
    source: "yahoo-finance",
    sourceUrl: spec.sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function main() {
  console.log("Yahoo Finance에서 코스피·코스닥 수집 시작...");
  const items = [];
  for (const spec of SYMBOLS) {
    const result = await fetchSymbol(spec);
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
