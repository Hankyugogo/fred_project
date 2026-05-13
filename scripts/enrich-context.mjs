// Enrich market-snapshot.json with cross-asset context the FRED data does not cover:
//   - Daily moves of US sector ETFs (XLF, XLK, XLE, SOXX, XLV, XLP, XLY, XLI, XLU, XLRE)
//   - Cross-asset signals (DXY, gold, copper, MOVE, real-yield)
//   - Upcoming macro/earnings calendar (next 1-2 weeks) with consensus expectations
//
// All gathered via Gemini Google Search grounding so we get the most recent values
// without adding extra API keys. Two-pass: grounded answer -> structured JSON extraction.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { callGemini, callGeminiJson } from "./lib/gemini-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const ENRICH_MODEL = process.env.GEMINI_ENRICH_MODEL || "gemini-2.5-flash";

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

async function fetchSectorEtfs(today) {
  const tickers = ["XLF", "XLK", "XLE", "SOXX", "XLV", "XLP", "XLY", "XLI", "XLU", "XLRE"];
  const grounded = await callGemini({
    prompt: [
      `For each of the following US sector ETFs, find the most recent trading-day close and percent change vs. the prior session. Today (KST) is ${today}.`,
      "Tickers: " + tickers.join(", "),
      "For each, return: ticker, close (USD), percentChange (%), close date.",
      "Use Yahoo Finance, Investing.com, MarketWatch, or similar.",
      "Be concise."
    ].join("\n"),
    systemInstruction: "You are a US sector ETF data fetcher. Use Google Search to find the latest closing prices.",
    model: ENRICH_MODEL,
    temperature: 0.1,
    maxOutputTokens: 2048,
    useGrounding: true
  });

  const sourceList = grounded.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.uri}`).join("\n");
  const extract = await callGeminiJson({
    prompt: [
      "Below is a grounded report on US sector ETF closes. Extract a structured array.",
      "",
      "TEXT:",
      grounded.text,
      "",
      "GROUNDING SOURCES:",
      sourceList || "(none)",
      "",
      "Return JSON: { \"items\": [ { \"ticker\": \"XLF\", \"close\": 51.2, \"percentChange\": 0.76, \"observationDate\": \"YYYY-MM-DD\", \"label\": \"미국 금융 ETF\" }, ... ] }",
      "Korean labels:",
      " - XLF=미국 금융 ETF, XLK=미국 기술 ETF, XLE=미국 에너지 ETF, SOXX=미국 반도체 ETF, XLV=미국 헬스케어 ETF,",
      " - XLP=미국 필수소비재 ETF, XLY=미국 임의소비재 ETF, XLI=미국 산업재 ETF, XLU=미국 유틸리티 ETF, XLRE=미국 부동산 ETF.",
      "If a ticker is not found in the text, omit it from the array (do not fabricate)."
    ].join("\n"),
    model: ENRICH_MODEL,
    temperature: 0,
    maxOutputTokens: 4096,
    thinkingBudget: 0,
    responseSchema: {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              ticker: { type: "STRING" },
              close: { type: "NUMBER" },
              percentChange: { type: "NUMBER" },
              observationDate: { type: "STRING" },
              label: { type: "STRING" }
            },
            required: ["ticker", "percentChange", "label"]
          }
        }
      },
      required: ["items"]
    }
  });

  return {
    items: extract.json.items || [],
    groundingSources: grounded.sources.slice(0, 8),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchCrossAssetSignals(today) {
  const grounded = await callGemini({
    prompt: [
      `Today (KST) is ${today}. Find the latest values for these cross-asset risk indicators:`,
      "1. ICE US Dollar Index (DXY) - current level + percent change",
      "2. Gold spot (XAU/USD) - current price + percent change",
      "3. Copper spot or front-month futures - current price + percent change",
      "4. ICE BofA MOVE Index (US Treasury bond market volatility) - current level + recent change",
      "5. US 10-year TIPS real yield - current level",
      "6. ACM 10-year Treasury term premium (if available, latest published value)",
      "Sources: Bloomberg, Reuters, CME, ICE, Federal Reserve Bank of New York, MarketWatch, Investing.com.",
      "Return concise list with values, dates, and sources."
    ].join("\n"),
    systemInstruction: "You are a cross-asset macro analyst. Use Google Search to gather the most recent values for each indicator.",
    model: ENRICH_MODEL,
    temperature: 0.1,
    maxOutputTokens: 2048,
    useGrounding: true
  });

  const sourceList = grounded.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.uri}`).join("\n");
  const extract = await callGeminiJson({
    prompt: [
      "Extract structured cross-asset signal data from the text below.",
      "",
      "TEXT:",
      grounded.text,
      "",
      "GROUNDING SOURCES:",
      sourceList || "(none)",
      "",
      "Return JSON with these keys (use null if not available):",
      "{",
      "  \"dxy\": { \"value\": number, \"percentChange\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string },",
      "  \"gold\": { \"value\": number, \"percentChange\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string },",
      "  \"copper\": { \"value\": number, \"percentChange\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string },",
      "  \"moveIndex\": { \"value\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string },",
      "  \"realYield10y\": { \"value\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string },",
      "  \"termPremium10y\": { \"value\": number, \"observationDate\": \"YYYY-MM-DD\", \"sourceName\": string }",
      "}"
    ].join("\n"),
    model: ENRICH_MODEL,
    temperature: 0,
    maxOutputTokens: 3072,
    thinkingBudget: 0
  });

  return {
    signals: extract.json,
    groundingSources: grounded.sources.slice(0, 8),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchEventCalendar(today) {
  const grounded = await callGemini({
    prompt: [
      `Today (KST) is ${today}. List the most important US/global macro events and major company earnings releases scheduled in the next 14 calendar days.`,
      "Categories to cover:",
      "- US economic data: nonfarm payrolls, CPI, PCE, retail sales, ISM manufacturing/services, JOLTS, GDP, initial claims, consumer confidence",
      "- Federal Reserve: FOMC meetings, FOMC minutes, Fed officials' speeches",
      "- Treasury auctions (3Y, 10Y, 30Y)",
      "- Big tech earnings: Apple, Microsoft, Nvidia, Amazon, Meta, Alphabet, Tesla — and any scheduled in the period",
      "- Korean macro: Bank of Korea (한국은행) policy meeting, Korean export/CPI data",
      "- Geopolitical: Iran/Hormuz developments, OPEC+ meetings, US-China trade",
      "For each event include: date (YYYY-MM-DD), event name (Korean), consensus expectation if a data release, and why it matters in 1 sentence."
    ].join("\n"),
    systemInstruction: "You are a macro calendar analyst. Use Google Search to find scheduled events and consensus expectations from Bloomberg, Reuters, FactSet, Investing.com economic calendar, MarketWatch.",
    model: ENRICH_MODEL,
    temperature: 0.1,
    maxOutputTokens: 3000,
    useGrounding: true
  });

  const sourceList = grounded.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.uri}`).join("\n");
  const extract = await callGeminiJson({
    prompt: [
      "Extract the macro event calendar from the text below as a structured array.",
      "",
      "TEXT:",
      grounded.text,
      "",
      "GROUNDING SOURCES:",
      sourceList || "(none)",
      "",
      "Return JSON:",
      "{",
      "  \"events\": [",
      "    {",
      "      \"date\": \"YYYY-MM-DD\",",
      "      \"category\": \"economic-data | fomc | earnings | auction | korean-macro | geopolitical | other\",",
      "      \"name\": \"한국어 이벤트명\",",
      "      \"consensus\": \"컨센서스 또는 시장 베팅 (해당 시)\",",
      "      \"importance\": \"high | medium | low\",",
      "      \"whyItMatters\": \"한 문장 설명\"",
      "    }",
      "  ]",
      "}",
      "사건명은 한국 경제지 표기로 한국어로 적되, 종목명은 영문 + 한글 풀이를 함께 적는다.",
      "Sort by date ascending. 최대 20개로 제한."
    ].join("\n"),
    model: ENRICH_MODEL,
    temperature: 0,
    maxOutputTokens: 8192,
    thinkingBudget: 0
  });

  return {
    events: extract.json.events || [],
    groundingSources: grounded.sources.slice(0, 8),
    fetchedAt: new Date().toISOString()
  };
}

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const today = todayKstString();

  console.log(`크로스애셋 컨텍스트 수집 시작 (${today}, 모델: ${ENRICH_MODEL})...`);

  const errors = [];
  const result = {
    generatedAt: new Date().toISOString(),
    today,
    model: ENRICH_MODEL
  };

  try {
    process.stderr.write("  - 미국 섹터 ETF 등락... ");
    result.sectorEtfs = await fetchSectorEtfs(today);
    process.stderr.write(`${result.sectorEtfs.items.length}건\n`);
  } catch (error) {
    process.stderr.write(`실패 (${error.message})\n`);
    errors.push({ step: "sectorEtfs", message: error.message });
  }

  try {
    process.stderr.write("  - 크로스애셋 시그널(DXY, 금, 구리, MOVE, 실질금리, 기간 프리미엄)... ");
    result.crossAssetSignals = await fetchCrossAssetSignals(today);
    process.stderr.write("완료\n");
  } catch (error) {
    process.stderr.write(`실패 (${error.message})\n`);
    errors.push({ step: "crossAsset", message: error.message });
  }

  try {
    process.stderr.write("  - 향후 14일 매크로·실적 캘린더... ");
    result.eventCalendar = await fetchEventCalendar(today);
    process.stderr.write(`${result.eventCalendar.events.length}건\n`);
  } catch (error) {
    process.stderr.write(`실패 (${error.message})\n`);
    errors.push({ step: "calendar", message: error.message });
  }

  if (errors.length > 0) {
    result.errors = errors;
  }

  snapshot.contextEnrichment = result;
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `컨텍스트 수집 완료 → market-snapshot.json (섹터 ${result.sectorEtfs?.items?.length ?? 0}건, ` +
    `이벤트 ${result.eventCalendar?.events?.length ?? 0}건, 오류 ${errors.length}건)`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
