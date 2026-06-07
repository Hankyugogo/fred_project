// Fetch deterministic market-close supplements for FRED series that often lag.
// Output: data/market-supplements.json, consumed by build-briefing.mjs and fetch-macro-history.mjs.

import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "market-supplements.json");
const FETCH_TIMEOUT_MS = 30_000;
const TREASURY_XML_BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
const execFileAsync = promisify(execFile);

const treasuryCache = new Map();

const SYMBOLS = [
  {
    id: "SP500",
    label: "S&P 500",
    group: "equities",
    yahoo: "^GSPC",
    stooq: "^spx",
    naverWorldIndex: ".INX",
    format: "index",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/%5EGSPC",
    stooqSourceUrl: "https://stooq.com/q/?s=%5Espx"
  },
  {
    id: "NASDAQCOM",
    label: "나스닥종합지수",
    group: "equities",
    yahoo: "^IXIC",
    stooq: "^ndq",
    naverWorldIndex: ".IXIC",
    format: "index",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/%5EIXIC",
    stooqSourceUrl: "https://stooq.com/q/?s=%5Endq"
  },
  {
    id: "DJIA",
    label: "다우지수",
    group: "equities",
    yahoo: "^DJI",
    stooq: "^dji",
    naverWorldIndex: ".DJI",
    format: "index",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/%5EDJI",
    stooqSourceUrl: "https://stooq.com/q/?s=%5Edji"
  },
  {
    id: "VIXCLS",
    label: "VIX",
    group: "volatility",
    yahoo: "^VIX",
    naverWorldIndex: ".VIX",
    format: "index",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/%5EVIX"
  },
  {
    id: "DGS2",
    label: "미 국채 2년물",
    group: "rates",
    yahoo: null,
    treasuryField: "BC_2YEAR",
    format: "percent",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"
  },
  {
    id: "DGS10",
    label: "미 국채 10년물",
    group: "rates",
    yahoo: "^TNX",
    treasuryField: "BC_10YEAR",
    format: "percent",
    decimals: 2,
    scale: 0.1,
    replacementPolicy: "replace",
    note: "미 재무부 Daily Treasury Rates를 우선 사용하고 실패 시 ^TNX 대용 시세를 쓴다.",
    sourceUrl: "https://finance.yahoo.com/quote/%5ETNX"
  },
  {
    id: "DEXKOUS",
    label: "달러/원 환율",
    group: "fx",
    yahoo: "KRW=X",
    stooq: "usdkrw",
    naverExchange: "FX_USDKRW",
    format: "krw",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/KRW=X",
    stooqSourceUrl: "https://stooq.com/q/?s=usdkrw"
  },
  {
    id: "DEXJPUS",
    label: "달러/엔 환율",
    group: "fx",
    yahoo: "JPY=X",
    stooq: "usdjpy",
    naverDerivedUsdJpy: true,
    format: "index",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/JPY=X",
    stooqSourceUrl: "https://stooq.com/q/?s=usdjpy"
  },
  {
    id: "DCOILWTICO",
    label: "WTI 유가",
    group: "commodities",
    yahoo: "CL=F",
    stooq: "cl.f",
    format: "usd",
    decimals: 2,
    replacementPolicy: "proxy",
    note: "FRED WTI 현물 지연 시 NYMEX WTI 근월물 종가를 최신 시장 대용치로 쓴다.",
    sourceUrl: "https://finance.yahoo.com/quote/CL=F",
    stooqSourceUrl: "https://stooq.com/q/?s=cl.f"
  },
  {
    id: "DCOILBRENTEU",
    label: "브렌트유",
    group: "commodities",
    yahoo: "BZ=F",
    format: "usd",
    decimals: 2,
    replacementPolicy: "proxy",
    note: "FRED Brent 현물 지연 시 ICE Brent 근월물 종가를 최신 시장 대용치로 쓴다.",
    sourceUrl: "https://finance.yahoo.com/quote/BZ=F"
  },
  {
    id: "GOLD",
    label: "금",
    group: "commodities",
    yahoo: "GC=F",
    stooq: "gc.f",
    format: "usd",
    decimals: 2,
    replacementPolicy: "proxy",
    sourceUrl: "https://finance.yahoo.com/quote/GC=F",
    stooqSourceUrl: "https://stooq.com/q/?s=gc.f"
  },
  {
    id: "COPPER",
    label: "구리",
    group: "commodities",
    yahoo: "HG=F",
    stooq: "hg.f",
    format: "usd",
    decimals: 2,
    scale: 0.01,
    replacementPolicy: "proxy",
    note: "Stooq HG.F는 센트 단위로 제공되어 0.01 스케일을 적용한다.",
    sourceUrl: "https://finance.yahoo.com/quote/HG=F",
    stooqSourceUrl: "https://stooq.com/q/?s=hg.f"
  },
  {
    id: "BTC",
    label: "비트코인",
    group: "crypto",
    yahoo: "BTC-USD",
    stooq: "btcusd",
    format: "usd",
    decimals: 2,
    replacementPolicy: "replace",
    sourceUrl: "https://finance.yahoo.com/quote/BTC-USD",
    stooqSourceUrl: "https://stooq.com/q/?s=btcusd"
  }
];

function buildChartUrl(symbol, host = "query1.finance.yahoo.com") {
  const params = new URLSearchParams({
    range: "10d",
    interval: "1d",
    includePrePost: "false"
  });
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

function buildStooqQuoteUrl(symbol) {
  const params = new URLSearchParams({
    s: symbol,
    f: "sd2t2ohlcp",
    h: "",
    e: "csv"
  });
  return `https://stooq.com/q/l/?${params}`;
}

function buildNaverWorldIndexUrl(symbol) {
  return `https://api.stock.naver.com/index/${encodeURIComponent(symbol)}/basic`;
}

function buildNaverExchangeUrl(symbol) {
  return `https://api.stock.naver.com/marketindex/exchange/${encodeURIComponent(symbol)}`;
}

function kstYearMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}${map.month}`;
}

function previousYearMonth(yyyymm) {
  const year = Number(yyyymm.slice(0, 4));
  const month = Number(yyyymm.slice(4, 6));
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildTreasuryXmlUrl(yyyymm) {
  const params = new URLSearchParams({
    data: "daily_treasury_yield_curve",
    field_tdr_date_value_month: yyyymm
  });
  return `${TREASURY_XML_BASE}?${params}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
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

async function fetchJsonWithCurl(url) {
  const { stdout } = await execFileAsync("curl", [
    "-L",
    "-s",
    "--http1.1",
    "-H",
    "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "-H",
    "Accept: application/json,text/plain,*/*",
    url
  ], {
    timeout: FETCH_TIMEOUT_MS + 5000,
    maxBuffer: 5 * 1024 * 1024
  });

  const text = stdout.trim();
  if (!text) {
    throw new Error("curl returned empty response");
  }
  return JSON.parse(text);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "fred-market-briefing/1.0 (+market-supplements)",
        accept: "text/csv,text/plain,*/*"
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooChart(symbol) {
  const errors = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = buildChartUrl(symbol, host);
    try {
      return await fetchJson(url);
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
    try {
      return await fetchJsonWithCurl(url);
    } catch (error) {
      errors.push(`${host}/curl: ${error.message}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function fetchStooqQuote(symbol) {
  return await fetchText(buildStooqQuoteUrl(symbol));
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<d:${tag}[^>]*>([^<]+)</d:${tag}>`));
  return match ? match[1] : null;
}

function parseTreasuryYieldRows(xml) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry) => {
    const date = tagValue(entry, "NEW_DATE")?.slice(0, 10) || null;
    const row = { date };
    ["BC_2YEAR", "BC_10YEAR"].forEach((field) => {
      const value = Number(tagValue(entry, field));
      row[field] = Number.isFinite(value) ? value : null;
    });
    return row;
  }).filter((row) => row.date);
}

async function fetchTreasuryYieldRows() {
  const months = [kstYearMonth(), previousYearMonth(kstYearMonth())];
  const rows = [];

  for (const month of months) {
    if (!treasuryCache.has(month)) {
      const xml = await fetchText(buildTreasuryXmlUrl(month));
      treasuryCache.set(month, parseTreasuryYieldRows(xml));
    }
    rows.push(...treasuryCache.get(month));
  }

  const byDate = new Map(rows.map((row) => [row.date, row]));
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function isoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeChartResult(spec, result) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const rawClose = quote.close?.[i];
    if (!Number.isFinite(rawClose)) continue;
    rows.push({
      date: isoDate(timestamps[i]),
      close: rawClose * (spec.scale || 1)
    });
  }

  const valid = rows.filter((row) => row.date && Number.isFinite(row.close));
  if (valid.length < 2) {
    throw new Error(`insufficient chart rows (${valid.length})`);
  }

  const latest = valid[valid.length - 1];
  const previous = valid[valid.length - 2];
  const latestValue = round(latest.close, spec.decimals);
  const previousValue = round(previous.close, spec.decimals);
  const absoluteChange = latestValue === null || previousValue === null
    ? null
    : round(latestValue - previousValue, spec.decimals);
  const percentChange = previousValue === null || previousValue === 0 || absoluteChange === null
    ? null
    : round((absoluteChange / previousValue) * 100, 4);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate: latest.date,
    previousObservationDate: previous.date,
    source: "Yahoo Finance v8 chart API",
    sourceSymbol: spec.yahoo,
    sourceUrl: spec.sourceUrl,
    replacementPolicy: spec.replacementPolicy,
    note: spec.note || null,
    fetchedAt: new Date().toISOString()
  };
}

function parseCsvLine(line) {
  return line.split(",").map((cell) => cell.trim());
}

function parseNumber(value) {
  if (!value || value === "N/D") return null;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeStooqQuote(spec, csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("empty Stooq quote response");
  }

  const header = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);
  const row = Object.fromEntries(header.map((key, index) => [key, values[index] || ""]));
  if (!row.Date || row.Date === "N/D") {
    throw new Error("Stooq returned N/D");
  }

  const close = parseNumber(row.Close);
  const previous = parseNumber(row.Prev);
  if (!Number.isFinite(close) || !Number.isFinite(previous)) {
    throw new Error(`invalid Stooq close/prev: ${row.Close}/${row.Prev}`);
  }

  const latestValue = round(close * (spec.scale || 1), spec.decimals);
  const previousValue = round(previous * (spec.scale || 1), spec.decimals);
  const absoluteChange = latestValue === null || previousValue === null
    ? null
    : round(latestValue - previousValue, spec.decimals);
  const percentChange = previousValue === null || previousValue === 0 || absoluteChange === null
    ? null
    : round((absoluteChange / previousValue) * 100, 4);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate: row.Date,
    previousObservationDate: null,
    source: "Stooq quote CSV",
    sourceSymbol: spec.stooq,
    sourceUrl: spec.stooqSourceUrl || `https://stooq.com/q/?s=${encodeURIComponent(spec.stooq)}`,
    replacementPolicy: spec.replacementPolicy,
    note: spec.note || null,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeNaverWorldIndex(spec, payload) {
  const close = parseNumber(payload?.closePrice);
  const previousInfo = (payload?.stockItemTotalInfos || []).find((item) => item.code === "lastClosePrice");
  const previous = parseNumber(previousInfo?.value);
  const change = parseNumber(payload?.compareToPreviousClosePrice);
  const observationDate = typeof payload?.localTradedAt === "string"
    ? payload.localTradedAt.slice(0, 10)
    : null;

  if (!observationDate || !Number.isFinite(close) || !Number.isFinite(previous)) {
    throw new Error("invalid Naver world index response");
  }

  const latestValue = round(close * (spec.scale || 1), spec.decimals);
  const previousValue = round(previous * (spec.scale || 1), spec.decimals);
  const absoluteChange = Number.isFinite(change)
    ? round(change * (spec.scale || 1), spec.decimals)
    : latestValue === null || previousValue === null
      ? null
      : round(latestValue - previousValue, spec.decimals);
  const percentChange = Number.isFinite(Number(payload?.fluctuationsRatio))
    ? round(Number(payload.fluctuationsRatio), 4)
    : previousValue === null || previousValue === 0 || absoluteChange === null
      ? null
      : round((absoluteChange / previousValue) * 100, 4);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate,
    previousObservationDate: previousInfo?.keyDesc ? previousInfo.keyDesc.replace(/\.$/, "").replace(/\./g, "-") : null,
    source: "Naver Finance world index API",
    sourceSymbol: spec.naverWorldIndex,
    sourceUrl: `https://m.stock.naver.com/worldstock/index/${encodeURIComponent(spec.naverWorldIndex)}`,
    replacementPolicy: spec.replacementPolicy,
    note: spec.note || null,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeNaverExchangePayload(payload) {
  const data = payload?.exchangeInfo || payload?.result || payload;
  const close = parseNumber(data?.closePrice);
  const rawChange = parseNumber(data?.fluctuations);
  const sign = data?.fluctuationsType?.code === "5" ? -1 : 1;
  const change = Number.isFinite(rawChange) ? sign * Math.abs(rawChange) : null;
  const previous = Number.isFinite(close) && Number.isFinite(change) ? close - change : null;
  const rawRatio = parseNumber(data?.fluctuationsRatio);
  const percentChange = Number.isFinite(rawRatio) ? sign * Math.abs(rawRatio) : null;
  const observationDate = typeof data?.localTradedAt === "string" ? data.localTradedAt.slice(0, 10) : null;

  if (!observationDate || !Number.isFinite(close) || !Number.isFinite(previous)) {
    throw new Error("invalid Naver exchange response");
  }

  return { close, previous, change, percentChange, observationDate, sourceSymbol: data?.reutersCode || null };
}

async function fetchNaverExchange(symbol) {
  return normalizeNaverExchangePayload(await fetchJson(buildNaverExchangeUrl(symbol)));
}

function buildNaverExchangeSupplement(spec, quote, sourceSymbol) {
  const latestValue = round(quote.close * (spec.scale || 1), spec.decimals);
  const previousValue = round(quote.previous * (spec.scale || 1), spec.decimals);
  const absoluteChange = latestValue === null || previousValue === null
    ? null
    : round(latestValue - previousValue, spec.decimals);
  const percentChange = Number.isFinite(quote.percentChange)
    ? round(quote.percentChange, 4)
    : previousValue === null || previousValue === 0 || absoluteChange === null
      ? null
      : round((absoluteChange / previousValue) * 100, 4);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate: quote.observationDate,
    previousObservationDate: null,
    source: "Naver Finance exchange API",
    sourceSymbol,
    sourceUrl: `https://m.stock.naver.com/marketindex/exchange/${encodeURIComponent(sourceSymbol)}`,
    replacementPolicy: spec.replacementPolicy,
    note: spec.note || null,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchNaverDerivedUsdJpy(spec) {
  const [usdKrw, jpyKrw] = await Promise.all([
    fetchNaverExchange("FX_USDKRW"),
    fetchNaverExchange("FX_JPYKRW")
  ]);
  const close = usdKrw.close / (jpyKrw.close / 100);
  const previous = usdKrw.previous / (jpyKrw.previous / 100);
  const observationDate = usdKrw.observationDate < jpyKrw.observationDate ? usdKrw.observationDate : jpyKrw.observationDate;
  return buildNaverExchangeSupplement(spec, {
    close,
    previous,
    percentChange: previous === 0 ? null : ((close - previous) / previous) * 100,
    observationDate
  }, "FX_USDKRW/FX_JPYKRW");
}

function normalizeTreasuryYield(spec, rows) {
  const valid = rows
    .filter((row) => row.date && Number.isFinite(row[spec.treasuryField]))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length < 2) {
    throw new Error(`insufficient Treasury rows (${valid.length})`);
  }

  const latest = valid[valid.length - 1];
  const previous = valid[valid.length - 2];
  const latestValue = round(latest[spec.treasuryField], spec.decimals);
  const previousValue = round(previous[spec.treasuryField], spec.decimals);
  const absoluteChange = latestValue === null || previousValue === null
    ? null
    : round(latestValue - previousValue, spec.decimals);
  const percentChange = previousValue === null || previousValue === 0 || absoluteChange === null
    ? null
    : round((absoluteChange / previousValue) * 100, 4);

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    format: spec.format,
    decimals: spec.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate: latest.date,
    previousObservationDate: previous.date,
    source: "U.S. Treasury Daily Treasury Rates XML",
    sourceSymbol: spec.treasuryField,
    sourceUrl: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
    replacementPolicy: spec.replacementPolicy,
    note: spec.note || null,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchSymbol(spec) {
  const sourceLabel = [spec.treasuryField, spec.stooq, spec.naverWorldIndex, spec.naverExchange, spec.naverDerivedUsdJpy ? "FX_USDKRW/FX_JPYKRW" : null, spec.yahoo].filter(Boolean).join("→");
  process.stderr.write(`  - ${spec.id} (${sourceLabel})... `);
  const errors = [];

  if (spec.treasuryField) {
    try {
      const normalized = normalizeTreasuryYield(spec, await fetchTreasuryYieldRows());
      process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Treasury)\n`);
      return normalized;
    } catch (error) {
      errors.push(`Treasury: ${error.message}`);
    }
  }

  if (spec.stooq) {
    try {
      const normalized = normalizeStooqQuote(spec, await fetchStooqQuote(spec.stooq));
      process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Stooq)\n`);
      return normalized;
    } catch (error) {
      errors.push(`Stooq: ${error.message}`);
    }
  }

  if (spec.naverWorldIndex) {
    try {
      const normalized = normalizeNaverWorldIndex(spec, await fetchJson(buildNaverWorldIndexUrl(spec.naverWorldIndex)));
      process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Naver)\n`);
      return normalized;
    } catch (error) {
      errors.push(`Naver: ${error.message}`);
    }
  }

  if (spec.naverExchange) {
    try {
      const normalized = buildNaverExchangeSupplement(spec, await fetchNaverExchange(spec.naverExchange), spec.naverExchange);
      process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Naver FX)\n`);
      return normalized;
    } catch (error) {
      errors.push(`Naver FX: ${error.message}`);
    }
  }

  if (spec.naverDerivedUsdJpy) {
    try {
      const normalized = await fetchNaverDerivedUsdJpy(spec);
      process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Naver FX derived)\n`);
      return normalized;
    } catch (error) {
      errors.push(`Naver FX derived: ${error.message}`);
    }
  }

  try {
    if (!spec.yahoo) {
      throw new Error("no Yahoo symbol configured");
    }
    const json = await fetchYahooChart(spec.yahoo);
    const result = json?.chart?.result?.[0];
    if (!result) {
      throw new Error(json?.chart?.error?.description || "empty chart result");
    }
    const normalized = normalizeChartResult(spec, result);
    process.stderr.write(`${normalized.latestValue} (${normalized.observationDate}, Yahoo)\n`);
    return normalized;
  } catch (error) {
    errors.push(`Yahoo: ${error.message}`);
    process.stderr.write(`실패 (${errors.join("; ")})\n`);
    return {
      id: spec.id,
      label: spec.label,
      group: spec.group,
      yahoo: spec.yahoo,
      stooq: spec.stooq || null,
      sourceUrl: spec.sourceUrl,
      replacementPolicy: spec.replacementPolicy,
      error: errors.join("; "),
      fetchedAt: new Date().toISOString()
    };
  }
}

async function main() {
  console.log("시장 보강 시세 수집 시작...");
  const items = [];
  for (const spec of SYMBOLS) {
    items.push(await fetchSymbol(spec));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance v8 chart API",
    purpose: "FRED 지연 시 최신 시장 종가/대용 시세로 보강",
    items
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const successful = items.filter((item) => !item.error).length;
  console.log(`시장 보강 결과 ${successful}/${items.length}건을 ${OUTPUT_PATH}에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
