// scripts/fetch-watchlist-prices.mjs
// 관심종목의 1년 일봉 시계열을 가져온다.
// 기본은 Yahoo Finance 공개 chart API이고, 한국 지수·종목·ETF는 Yahoo 실패 시
// Naver Finance siseJson으로 우회한다. 그래도 실패하면 기존 같은 종목 데이터를 보존한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "watchlist-stocks.json");
const OUTPUT_PATH = path.join(ROOT, "data", "watchlist-prices.json");
const FETCH_TIMEOUT_MS = 30_000;

function buildChartUrl(symbol) {
  const params = new URLSearchParams({
    range: "1y",
    interval: "1d",
    includePrePost: "false",
    events: "div,splits"
  });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

function buildNaverUrl(symbol) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
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

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
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

function isoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function isoDateFromYmd(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeYahooHistory(result) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = quote.close?.[i];
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: isoDate(timestamps[i]),
      open: round(quote.open?.[i]),
      high: round(quote.high?.[i]),
      low: round(quote.low?.[i]),
      close: round(close),
      volume: Number.isFinite(quote.volume?.[i]) ? quote.volume[i] : null
    });
  }
  return rows.filter((row) => row.date);
}

function parseNaverHistory(text) {
  const rows = [];
  const rowPattern = /\[\s*"(\d{8})"\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,/g;
  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    rows.push({
      date: isoDateFromYmd(match[1]),
      open: round(Number(match[2])),
      high: round(Number(match[3])),
      low: round(Number(match[4])),
      close: round(Number(match[5])),
      volume: Number.isFinite(Number(match[6])) ? Number(match[6]) : null
    });
  }
  return rows.filter((row) => row.date && Number.isFinite(row.close));
}

function inferNaverSymbol(stock, chartSymbol) {
  if (stock.naverSymbol) return stock.naverSymbol;
  const raw = String(stock.ticker || chartSymbol || "").trim();
  if (raw === "^KS11") return "KOSPI";
  if (raw === "^KQ11") return "KOSDAQ";
  const code = raw.match(/^(\d{6})(?:\.(?:KS|KQ))?$/i);
  if (code) return code[1];
  return null;
}

async function fetchYahooOne(stock, chartSymbol) {
  const json = JSON.parse(await fetchText(buildChartUrl(chartSymbol)));
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("empty chart result");
  const history = normalizeYahooHistory(result);
  if (history.length < 2) throw new Error(`insufficient history (${history.length})`);
  return {
    ticker: stock.ticker,
    name: stock.name,
    chartSymbol,
    source: "Yahoo Finance v8 chart API",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(chartSymbol)}`,
    currency: result.meta?.currency || stock.currency || null,
    exchangeName: result.meta?.exchangeName || null,
    instrumentType: result.meta?.instrumentType || null,
    history,
    error: null
  };
}

async function fetchNaverOne(stock, chartSymbol) {
  const naverSymbol = inferNaverSymbol(stock, chartSymbol);
  if (!naverSymbol) throw new Error("Naver symbol unavailable");
  const text = await fetchText(buildNaverUrl(naverSymbol));
  const history = parseNaverHistory(text);
  if (history.length < 2) throw new Error(`insufficient Naver history (${history.length})`);
  return {
    ticker: stock.ticker,
    name: stock.name,
    chartSymbol,
    naverSymbol,
    source: "Naver Finance siseJson",
    sourceUrl: `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(naverSymbol)}`,
    currency: stock.currency || (naverSymbol === "KOSPI" || naverSymbol === "KOSDAQ" ? "pt" : "KRW"),
    exchangeName: "KRX",
    instrumentType: stock.assetClass || null,
    history,
    error: null
  };
}

async function fetchOne(stock, fallbackByTicker) {
  const chartSymbol = stock.chartSymbol || stock.yahooSymbol || stock.ticker;
  const fallback = fallbackByTicker.get(stock.ticker);
  try {
    return await fetchYahooOne(stock, chartSymbol);
  } catch (yahooErr) {
    try {
      const naver = await fetchNaverOne(stock, chartSymbol);
      return {
        ...naver,
        fallbackSource: "naver",
        fallbackReason: `Yahoo: ${yahooErr.message || yahooErr}`
      };
    } catch (naverErr) {
      const error = `Yahoo: ${yahooErr.message || yahooErr}; Naver: ${naverErr.message || naverErr}`;
    if (fallback?.history?.length) {
      return {
        ...fallback,
        ticker: stock.ticker,
        name: stock.name,
        chartSymbol,
        fallbackUsed: true,
          error
      };
    }
    return {
      ticker: stock.ticker,
      name: stock.name,
      chartSymbol,
      source: "Yahoo Finance v8 chart API",
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(chartSymbol)}`,
      currency: stock.currency || null,
      history: [],
        error
    };
    }
  }
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const previous = await readJsonIfExists(OUTPUT_PATH);
  const fallbackByTicker = new Map((previous?.items || []).map((item) => [item.ticker, item]));
  const stocks = Array.isArray(config.stocks) ? config.stocks : [];

  console.log(`[fetch-watchlist-prices] fetching ${stocks.length} watchlist symbols...`);
  const items = [];
  for (const stock of stocks) {
    process.stdout.write(`  ${stock.ticker.padEnd(12)} ... `);
    const t0 = Date.now();
    const result = await fetchOne(stock, fallbackByTicker);
    const dt = Date.now() - t0;
    if (!result.error && result.fallbackSource === "naver") process.stdout.write(`naver ${result.history.length}d (${dt}ms); ${result.fallbackReason}\n`);
    else if (result.error && result.fallbackUsed) process.stdout.write(`fallback ${result.history.length}d (${dt}ms): ${result.error}\n`);
    else if (result.error) process.stdout.write(`failed: ${result.error}\n`);
    else process.stdout.write(`ok ${result.history.length}d (${dt}ms)\n`);
    items.push(result);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance v8 chart API",
    range: "1y",
    interval: "1d",
    configPath: "config/watchlist-stocks.json",
    items
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  const okCount = items.filter((item) => item.history?.length).length;
  console.log(`[fetch-watchlist-prices] wrote ${OUTPUT_PATH} (${okCount}/${items.length} symbols usable)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
