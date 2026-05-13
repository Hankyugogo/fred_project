// Enrich stale/delayed FRED series with the latest market value from Google-grounded Gemini.
// Adds market-snapshot.json items[i].supplementary = { value, observationDate, sourceName, sourceUrl, fetchedAt }
// so the rewrite step can show 'FRED 기준일 + 보충 시세 + 출처' together.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { callGemini, callGeminiJson } from "./lib/gemini-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const ENRICH_MODEL = process.env.GEMINI_ENRICH_MODEL || "gemini-2.5-flash";

// FRED series id → grounded search prompt + parser hints.
const SERIES_QUERY = {
  DEXKOUS: {
    label: "달러/원 환율",
    grounded: (today) => `What is the most recent USD to KRW spot exchange rate (Korean won per one US dollar)? Today is ${today}. Reply with the value, the timestamp/date of that quote, and the source publication and URL. If multiple quotes exist, prefer the latest from a major financial source (Bloomberg, Reuters, Investing.com, KEB Hana, naver finance).`,
    unit: "KRW",
    decimals: 2
  },
  DTWEXBGS: {
    label: "달러지수",
    grounded: (today) => `What is the most recent value of the US Dollar Index (DXY, ICE)? Today is ${today}. Reply with the index level, the timestamp/date of that quote, and the source publication and URL. Prefer ICE/Bloomberg/Reuters/Investing.com.`,
    unit: "INDEX",
    decimals: 2
  },
  DCOILWTICO: {
    label: "WTI 유가",
    grounded: (today) => `What is the most recent spot price of West Texas Intermediate (WTI) crude oil in USD per barrel? Today is ${today}. Reply with the price, the timestamp/date, and the source publication and URL. Prefer NYMEX/Bloomberg/Reuters/EIA/Investing.com.`,
    unit: "USD",
    decimals: 2
  },
  SP500: {
    label: "S&P 500",
    grounded: (today) => `What is the most recent closing level of the S&P 500 index? Today is ${today}. Reply with the level, the close date (US Eastern), and the source publication and URL.`,
    unit: "INDEX",
    decimals: 2
  },
  NASDAQCOM: {
    label: "나스닥 종합지수",
    grounded: (today) => `What is the most recent closing level of the Nasdaq Composite index? Today is ${today}. Reply with the level, the close date (US Eastern), and the source publication and URL.`,
    unit: "INDEX",
    decimals: 2
  },
  DJIA: {
    label: "다우존스30",
    grounded: (today) => `What is the most recent closing level of the Dow Jones Industrial Average? Today is ${today}. Reply with the level, the close date (US Eastern), and the source publication and URL.`,
    unit: "INDEX",
    decimals: 2
  },
  DGS10: {
    label: "미 국채 10년물",
    grounded: (today) => `What is the most recent yield of the US Treasury 10-year bond? Today is ${today}. Reply with the yield in percent, the date, and the source publication and URL.`,
    unit: "PERCENT",
    decimals: 2
  },
  DGS2: {
    label: "미 국채 2년물",
    grounded: (today) => `What is the most recent yield of the US Treasury 2-year bond? Today is ${today}. Reply with the yield in percent, the date, and the source publication and URL.`,
    unit: "PERCENT",
    decimals: 2
  },
  VIXCLS: {
    label: "변동성지수(VIX)",
    grounded: (today) => `What is the most recent closing value of the CBOE Volatility Index (VIX)? Today is ${today}. Reply with the level, the close date, and the source publication and URL.`,
    unit: "INDEX",
    decimals: 2
  }
};

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    value: { type: "NUMBER" },
    observationDate: { type: "STRING" },
    sourceName: { type: "STRING" },
    sourceUrl: { type: "STRING" },
    confidence: { type: "STRING" }
  },
  required: ["value", "observationDate", "sourceName"]
};

function todayKstString() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function fetchLatest(seriesId) {
  const recipe = SERIES_QUERY[seriesId];
  if (!recipe) return null;
  const today = todayKstString();

  // Step 1: grounded search for free-form answer with sources.
  const grounded = await callGemini({
    prompt: recipe.grounded(today),
    systemInstruction: "You are a financial data lookup assistant. Use Google Search to find the most recent quote. Always include the date/time of the quote, the publication name, and the canonical URL of the article or data page.",
    model: ENRICH_MODEL,
    temperature: 0.1,
    maxOutputTokens: 1024,
    useGrounding: true
  });

  if (!grounded.text) {
    return { error: "grounded-empty" };
  }

  // Step 2: structured extraction (no grounding, so we can use responseSchema).
  const sourceList = grounded.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.uri}`).join("\n");
  const extractPrompt = [
    "Below is a grounded answer about a financial data point. Extract a structured record.",
    "",
    "TEXT:",
    grounded.text,
    "",
    "GROUNDING SOURCES:",
    sourceList || "(none)",
    "",
    "Return strict JSON matching the schema:",
    "- value: numeric value (no commas)",
    "- observationDate: YYYY-MM-DD (use today if explicit date is not given but the quote is intra-day; otherwise use the date from the source)",
    "- sourceName: the most authoritative source mentioned (e.g., 'Bloomberg', 'Reuters', 'CBOE', 'Federal Reserve', 'Investing.com')",
    "- sourceUrl: best URL from the grounding sources (or the URL mentioned in the text)",
    "- confidence: 'high' if a specific quote and timestamp are cited, 'medium' if a recent close was cited, 'low' if only a range or estimate was given"
  ].join("\n");

  try {
    const extracted = await callGeminiJson({
      prompt: extractPrompt,
      model: ENRICH_MODEL,
      temperature: 0,
      maxOutputTokens: 1024,
      thinkingBudget: 0,
      responseSchema: EXTRACT_SCHEMA
    });
    return {
      ...extracted.json,
      groundedText: grounded.text.trim().slice(0, 800),
      groundingSources: grounded.sources.slice(0, 5),
      fetchedAt: new Date().toISOString(),
      fetcher: `gemini-grounding:${ENRICH_MODEL}`
    };
  } catch (error) {
    return { error: `extract-failed: ${error.message}`, groundedText: grounded.text.slice(0, 400) };
  }
}

function findItem(snapshot, id) {
  for (const group of snapshot.groups) {
    const found = group.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const freshness = snapshot.freshnessSummary;
  const targets = (freshness?.items || [])
    .filter((item) => SERIES_QUERY[item.id])
    .map((item) => item.id);

  if (targets.length === 0) {
    console.log("기준일 지연/오래된 시계열이 없어 enrich를 생략합니다.");
    return;
  }

  console.log(`보충 시세 수집 대상: ${targets.length}건 → ${targets.join(", ")} (모델: ${ENRICH_MODEL})`);

  const results = [];
  for (const id of targets) {
    process.stderr.write(`  - ${id} (${SERIES_QUERY[id].label})...`);
    try {
      const enriched = await fetchLatest(id);
      const target = findItem(snapshot, id);
      if (target && enriched && !enriched.error) {
        target.supplementary = enriched;
        process.stderr.write(` ${enriched.value} (${enriched.observationDate}, ${enriched.sourceName})\n`);
      } else {
        process.stderr.write(` 실패 (${enriched?.error || "no item"})\n`);
        if (target && enriched?.error) {
          target.supplementaryError = enriched.error;
        }
      }
      results.push({ id, enriched });
    } catch (error) {
      process.stderr.write(` 오류: ${error.message}\n`);
      results.push({ id, error: error.message });
    }
  }

  snapshot.enrichmentMeta = {
    generatedAt: new Date().toISOString(),
    model: ENRICH_MODEL,
    requested: targets.length,
    successful: results.filter((r) => r.enriched && !r.enriched.error).length
  };

  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`보충 시세를 market-snapshot.json에 반영했습니다 (${snapshot.enrichmentMeta.successful}/${targets.length}).`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
