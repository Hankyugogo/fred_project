// Fetch Korean indices and KRW/JPY from Stooq's free CSV endpoint.
// No API key needed; data is end-of-day. Output: data/stooq-snapshot.json which build-briefing
// merges into market-snapshot.json.
//
// Symbols:
//   ^kospi   KOSPI Composite
//   ^kosdaq  KOSDAQ
//   jpykrw   1 JPY in KRW   (used for 원-엔 환율)
//
// CSV format from stooq.com:
//   Date,Open,High,Low,Close,Volume
// We keep the latest close + the previous trading-day close.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "stooq-snapshot.json");

const SYMBOLS = [
  {
    id: "KOSPI",
    label: "코스피",
    group: "korea",
    stooq: "^kospi",
    format: "index",
    decimals: 2,
    sourceUrl: "https://stooq.com/q/?s=^kospi"
  },
  {
    id: "KOSDAQ",
    label: "코스닥",
    group: "korea",
    stooq: "^kosdaq",
    format: "index",
    decimals: 2,
    sourceUrl: "https://stooq.com/q/?s=^kosdaq"
  },
  {
    id: "JPYKRW",
    label: "원-엔 환율(100엔당)",
    group: "korea",
    stooq: "jpykrw",
    format: "krw",
    decimals: 2,
    multiplier: 100, // 원/엔이 일반적으로 100엔당으로 보도되므로 100을 곱한다.
    sourceUrl: "https://stooq.com/q/?s=jpykrw"
  }
];

const CSV_BASE = "https://stooq.com/q/d/l/";
const FETCH_TIMEOUT_MS = 30_000;

function buildCsvUrl(stooqSymbol) {
  // Daily frequency, full available history. We only need the last 2 rows but the API doesn't
  // support range slicing without a paid account; we fetch and tail.
  const params = new URLSearchParams({ s: stooqSymbol, i: "d" });
  return `${CSV_BASE}?${params.toString()}`;
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "fred-market-briefing/1.0 (+korea-indices)",
        accept: "text/csv,*/*"
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Empty response");
    }
    if (trimmed.startsWith("<")) {
      throw new Error(`HTML response (likely blocked): ${trimmed.slice(0, 120)}`);
    }
    if (/no\s*data/i.test(trimmed) && trimmed.length < 200) {
      throw new Error(`Stooq says no data: ${trimmed.slice(0, 120)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function detectDelimiter(headerLine) {
  // Stooq sometimes serves semicolon-delimited CSVs depending on locale.
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = headerLine.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

function parseCsvTail(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], header: [], delimiter: null };
  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cells[idx];
    });
    return row;
  });
  return { rows, header, delimiter };
}

async function fetchSymbol(spec) {
  const url = buildCsvUrl(spec.stooq);
  process.stderr.write(`  - ${spec.id} (${spec.label}) ${spec.stooq}... `);
  let csvText;
  try {
    csvText = await fetchCsv(url);
  } catch (error) {
    process.stderr.write(`실패 (${error.message})\n`);
    return { ...spec, error: error.message };
  }

  const parsed = parseCsvTail(csvText);
  const { rows, header, delimiter } = parsed;
  if (rows.length < 1) {
    process.stderr.write(`실패 (no rows). 응답 머리: ${csvText.slice(0, 160)}\n`);
    return { ...spec, error: "no rows", responseHead: csvText.slice(0, 200) };
  }

  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;

  // Stooq column names sometimes vary (close vs zamkniecie, etc.). Try common aliases.
  const closeKey = ["close", "zamkniecie", "close*", "zamknięcie"].find((k) => last[k] !== undefined);
  const dateKey = ["date", "data"].find((k) => last[k] !== undefined);

  if (!closeKey) {
    process.stderr.write(
      `실패 (close 컬럼을 찾지 못함). delimiter=${JSON.stringify(delimiter)} header=${JSON.stringify(header)} sample=${JSON.stringify(last)}\n`
    );
    return { ...spec, error: "close column missing", header, sample: last };
  }

  const closeRaw = parseFloat(last[closeKey]);
  const prevCloseRaw = prev ? parseFloat(prev[closeKey]) : null;
  if (!Number.isFinite(closeRaw)) {
    process.stderr.write(`실패 (invalid close=${last[closeKey]} key=${closeKey})\n`);
    return { ...spec, error: "invalid close", sample: last };
  }

  const multiplier = spec.multiplier || 1;
  const close = closeRaw * multiplier;
  const prevClose = prevCloseRaw !== null && Number.isFinite(prevCloseRaw)
    ? prevCloseRaw * multiplier
    : null;
  const absoluteChange = prevClose === null ? null : close - prevClose;
  const percentChange = prevClose === null || prevClose === 0
    ? null
    : (absoluteChange / prevClose) * 100;

  const lastDate = dateKey ? last[dateKey] : null;
  const prevDate = dateKey && prev ? prev[dateKey] : null;
  process.stderr.write(`${close.toFixed(spec.decimals)} (${lastDate})\n`);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue: round(close, spec.decimals),
    previousValue: prevClose === null ? null : round(prevClose, spec.decimals),
    absoluteChange: absoluteChange === null ? null : round(absoluteChange, spec.decimals),
    percentChange: percentChange === null ? null : round(percentChange, 2),
    observationDate: lastDate,
    previousObservationDate: prevDate,
    source: "stooq",
    sourceUrl: spec.sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main() {
  console.log("Stooq에서 한국 시장·원엔 환율 수집 시작...");
  const items = [];
  for (const spec of SYMBOLS) {
    const result = await fetchSymbol(spec);
    items.push(result);
  }
  const output = {
    generatedAt: new Date().toISOString(),
    source: "Stooq.com (https://stooq.com)",
    items
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const successful = items.filter((i) => !i.error).length;
  console.log(`Stooq 결과 ${successful}/${items.length}건을 ${OUTPUT_PATH}에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
