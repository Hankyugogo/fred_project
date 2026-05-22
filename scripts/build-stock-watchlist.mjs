// scripts/build-stock-watchlist.mjs
// watchlist price history, market snapshot, briefing archive를 결합해 대시보드용 관심종목 분석 JSON을 만든다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "watchlist-stocks.json");
const PRICES_PATH = path.join(ROOT, "data", "watchlist-prices.json");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const OUTPUT_PATH = path.join(ROOT, "data", "stock-watchlist.json");

async function readJsonIfExists(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function avg(values) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function std(values) {
  const nums = values.filter(Number.isFinite);
  if (nums.length < 2) return null;
  const mean = avg(nums);
  const variance = avg(nums.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function movingAverage(history, index, window) {
  const slice = history.slice(Math.max(0, index - window + 1), index + 1).map((row) => row.close);
  return round(avg(slice), 4);
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = null;
  return values.map((value) => {
    if (!Number.isFinite(value)) return prev;
    prev = prev === null ? value : (value * k) + (prev * (1 - k));
    return prev;
  });
}

function rsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function returnOver(history, days) {
  if (history.length <= days) return null;
  const last = history.at(-1)?.close;
  const base = history.at(-(days + 1))?.close;
  return pct(last, base);
}

function calcTechnical(priceItem) {
  const history = (priceItem?.history || []).filter((row) => Number.isFinite(row.close));
  if (history.length < 20) {
    return {
      status: "insufficient",
      asOf: history.at(-1)?.date || null,
      source: priceItem?.source || null,
      sourceUrl: priceItem?.sourceUrl || null,
      historyLength: history.length,
      score: null,
      tone: "확인 필요",
      toneClass: "neutral",
      summary: "기술적 분석에 필요한 가격 이력이 부족합니다.",
      indicators: {},
      chart: { points: history }
    };
  }

  const closes = history.map((row) => row.close);
  const dailyReturns = history.slice(1).map((row, index) => pct(row.close, history[index].close)).filter(Number.isFinite);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdSeries = closes.map((_, index) =>
    Number.isFinite(ema12[index]) && Number.isFinite(ema26[index]) ? ema12[index] - ema26[index] : null
  );
  const macdSignalSeries = ema(macdSeries, 9);
  const last = history.at(-1);
  const prev = history.at(-2);
  const ret20 = returnOver(history, 20);
  const ret60 = returnOver(history, 60);
  const ma20 = movingAverage(history, history.length - 1, 20);
  const ma60 = movingAverage(history, history.length - 1, 60);
  const ma120 = movingAverage(history, history.length - 1, 120);
  const rsi14 = rsi(closes, 14);
  const macd = macdSeries.at(-1);
  const macdSignal = macdSignalSeries.at(-1);
  const macdHistogram = Number.isFinite(macd) && Number.isFinite(macdSignal) ? macd - macdSignal : null;
  const vol20 = std(dailyReturns.slice(-20));
  const support20 = Math.min(...history.slice(-20).map((row) => row.low ?? row.close).filter(Number.isFinite));
  const resistance20 = Math.max(...history.slice(-20).map((row) => row.high ?? row.close).filter(Number.isFinite));
  const high120 = Math.max(...history.slice(-120).map((row) => row.close).filter(Number.isFinite));
  const drawdown120d = Number.isFinite(high120) ? pct(last.close, high120) : null;
  const volumeRatio20d = Number.isFinite(last.volume) ? last.volume / avg(history.slice(-20).map((row) => row.volume)) : null;
  const slope60d = Number.isFinite(ret60) ? ret60 : null;

  let score = 50;
  if (Number.isFinite(ret20)) score += ret20 * 0.9;
  if (Number.isFinite(ret60)) score += ret60 * 0.35;
  if (Number.isFinite(rsi14)) score += rsi14 > 70 ? -6 : rsi14 < 30 ? 6 : (rsi14 - 50) * 0.15;
  if (Number.isFinite(macdHistogram)) score += Math.sign(macdHistogram) * 6;
  if (Number.isFinite(ma20) && Number.isFinite(ma60)) score += ma20 >= ma60 ? 8 : -8;
  score = Math.round(clamp(score));

  const tone = score >= 68 ? "상방 우위" : score <= 38 ? "하방 경계" : "중립";
  const toneClass = score >= 68 ? "positive" : score <= 38 ? "negative" : "neutral";
  const summary = `${tone} 신호입니다. 20거래일 수익률 ${round(ret20, 2)}%, RSI ${round(rsi14, 1)}, 60일 추세 ${round(slope60d, 2)}% 기준으로 판단했습니다.`;

  const chartPoints = history.slice(-180).map((row, index, rows) => {
    const originalIndex = history.length - rows.length + index;
    return {
      date: row.date,
      close: row.close,
      ma20: movingAverage(history, originalIndex, 20),
      ma60: movingAverage(history, originalIndex, 60),
      volume: row.volume ?? null
    };
  });

  return {
    status: "ready",
    asOf: last.date,
    source: priceItem.source || null,
    sourceUrl: priceItem.sourceUrl || null,
    historyLength: history.length,
    score,
    tone,
    toneClass,
    summary,
    indicators: {
      close: last.close,
      return1d: round(pct(last.close, prev?.close), 2),
      return5d: round(returnOver(history, 5), 2),
      return20d: round(ret20, 2),
      return60d: round(ret60, 2),
      ma20,
      ma60,
      ma120,
      rsi14: round(rsi14, 1),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHistogram: round(macdHistogram, 4),
      dailyVolatility20d: round(vol20, 2),
      annualVolatility20d: round(Number.isFinite(vol20) ? vol20 * Math.sqrt(252) : null, 2),
      slope60d: round(slope60d, 2),
      drawdown120d: round(drawdown120d, 2),
      support20d: round(support20, 4),
      resistance20d: round(resistance20, 4),
      volumeRatio20d: round(volumeRatio20d, 2)
    },
    chart: { points: chartPoints }
  };
}

function flattenMetrics(snapshot) {
  return (snapshot?.groups || []).flatMap((group) => (group.items || []).map((item) => ({
    ...item,
    groupId: group.id,
    groupLabel: group.label
  })));
}

function findMetric(snapshot, id) {
  return flattenMetrics(snapshot).find((item) => item.id === id || item.label === id);
}

function buildMacroBackdrop(snapshot, latestBriefing) {
  const spx = findMetric(snapshot, "SP500");
  const ust10 = findMetric(snapshot, "DGS10");
  const vix = findMetric(snapshot, "VIXCLS");
  const krw = findMetric(snapshot, "DEXKOUS");
  const signals = [
    spx && {
      label: "S&P 500",
      value: Number.isFinite(spx.latest) ? `${round(spx.latest, 2)}` : "N/A",
      change: Number.isFinite(spx.percentChange) ? `${spx.percentChange > 0 ? "+" : ""}${round(spx.percentChange, 2)}%` : "N/A",
      tone: spx.percentChange > 0 ? "up" : spx.percentChange < 0 ? "down" : "flat",
      note: "미국 위험자산 선호의 기준 지표입니다."
    },
    ust10 && {
      label: "미 국채 10년물",
      value: Number.isFinite(ust10.latest) ? `${round(ust10.latest, 2)}%` : "N/A",
      change: Number.isFinite(ust10.absoluteChange) ? `${ust10.absoluteChange > 0 ? "+" : ""}${Math.round(ust10.absoluteChange * 100)}bp` : "N/A",
      tone: ust10.absoluteChange > 0 ? "down" : ust10.absoluteChange < 0 ? "up" : "flat",
      note: "성장주와 한국 증시 할인율을 좌우합니다."
    },
    vix && {
      label: "VIX",
      value: Number.isFinite(vix.latest) ? `${round(vix.latest, 2)}` : "N/A",
      change: Number.isFinite(vix.percentChange) ? `${vix.percentChange > 0 ? "+" : ""}${round(vix.percentChange, 2)}%` : "N/A",
      tone: vix.percentChange > 0 ? "down" : vix.percentChange < 0 ? "up" : "flat",
      note: "변동성 확대 여부를 보여줍니다."
    },
    krw && {
      label: "달러/원",
      value: Number.isFinite(krw.latest) ? `${round(krw.latest, 2)}원` : "N/A",
      change: Number.isFinite(krw.percentChange) ? `${krw.percentChange > 0 ? "+" : ""}${round(krw.percentChange, 2)}%` : "N/A",
      tone: krw.percentChange > 0 ? "down" : krw.percentChange < 0 ? "up" : "flat",
      note: "외국인 매매와 환율 민감 업종의 핵심 변수입니다."
    }
  ].filter(Boolean);

  return {
    reportDate: snapshot?.reportDate || latestBriefing?.date || null,
    title: snapshot?.headline || latestBriefing?.title || "시장 배경 확인",
    summary: latestBriefing?.overnightLead || snapshot?.subheadline || snapshot?.analysis?.lead || "시장 배경 요약이 없습니다.",
    signals
  };
}

function buildSectorSignal(stock, snapshot, priceByTicker) {
  if (stock.benchmarkTicker && priceByTicker.has(stock.benchmarkTicker)) {
    const item = priceByTicker.get(stock.benchmarkTicker);
    const history = item.history || [];
    const last = history.at(-1);
    const prev = history.at(-2);
    return {
      ticker: stock.benchmarkMetric || stock.benchmarkTicker,
      label: stock.benchmarkMetric || stock.benchmarkTicker,
      close: last?.close ?? null,
      percentChange: round(pct(last?.close, prev?.close), 2),
      observationDate: last?.date || null
    };
  }

  const sector = snapshot?.contextEnrichment?.sectorEtfs?.items?.find((item) => item.ticker === stock.sectorEtf);
  if (sector) {
    return {
      ticker: sector.ticker,
      label: sector.label || sector.ticker,
      close: sector.close ?? null,
      percentChange: sector.percentChange ?? null,
      observationDate: sector.observationDate || null
    };
  }
  return null;
}

function macroAdjustment(stock, snapshot, sectorSignal) {
  const spx = findMetric(snapshot, "SP500");
  const ust10 = findMetric(snapshot, "DGS10");
  const vix = findMetric(snapshot, "VIXCLS");
  const krw = findMetric(snapshot, "DEXKOUS");
  let score = 50;

  if (Number.isFinite(spx?.percentChange)) score += spx.percentChange * 4;
  if (Number.isFinite(vix?.percentChange)) score -= vix.percentChange * 0.8;
  if (Number.isFinite(ust10?.absoluteChange)) score -= ust10.absoluteChange * 120;
  if (stock.market === "한국" && Number.isFinite(krw?.percentChange)) score -= krw.percentChange * 5;
  if (stock.inverseMultiplier && Number.isFinite(sectorSignal?.percentChange)) {
    score += -sectorSignal.percentChange * Math.abs(stock.inverseMultiplier) * 4;
  } else if (Number.isFinite(sectorSignal?.percentChange)) {
    score += sectorSignal.percentChange * 2;
  }
  return Math.round(clamp(score));
}

function toneFromScore(score) {
  if (!Number.isFinite(score)) return { macroTone: "확인 필요", macroToneClass: "neutral" };
  if (score >= 65) return { macroTone: "우호", macroToneClass: "positive" };
  if (score <= 40) return { macroTone: "부담", macroToneClass: "negative" };
  return { macroTone: "중립", macroToneClass: "neutral" };
}

function buildForecast(stock, technical, macroScore) {
  const base = Number.isFinite(technical?.indicators?.return20d) ? technical.indicators.return20d : 0;
  const bias = Number.isFinite(macroScore) ? (macroScore - 50) / 12 : 0;
  const score = Math.round(clamp(((technical?.score ?? 50) * 0.55) + ((macroScore ?? 50) * 0.45)));
  const toneClass = score >= 65 ? "positive" : score <= 40 ? "negative" : "neutral";
  const summary = `기술 점수와 매크로 점수를 결합한 정량 점검 결과입니다. ${stock.name}의 단기 방향성은 가격 추세와 시장 배경을 함께 확인해야 합니다.`;
  return {
    score,
    toneClass,
    confidence: technical?.status === "ready" ? "보통" : "낮음",
    confidenceNote: "가격 이력과 일일 매크로 스냅샷만 반영합니다.",
    summary,
    horizons: [
      {
        label: "1주",
        expectedReturnPct: round((base / 4) + bias, 2),
        upProbabilityPct: Math.round(clamp(50 + (score - 50) * 0.6)),
        rangeLowPct: round(-Math.abs(base / 3) - 2, 2),
        rangeHighPct: round(Math.abs(base / 3) + 2, 2)
      },
      {
        label: "1개월",
        expectedReturnPct: round(base + (bias * 2), 2),
        upProbabilityPct: Math.round(clamp(50 + (score - 50) * 0.8)),
        rangeLowPct: round(-Math.abs(base) - 4, 2),
        rangeHighPct: round(Math.abs(base) + 4, 2)
      }
    ]
  };
}

function buildScenario(stock, tone) {
  return {
    base: `${stock.name}은 현재 매크로 배경과 가격 추세를 함께 확인하는 구간입니다.`,
    upside: tone.macroToneClass === "positive"
      ? "우호적인 매크로 신호가 이어지고 가격이 단기 저항선을 넘으면 탄력이 강화될 수 있습니다."
      : "금리·환율·변동성 부담이 완화되면 반등 여지가 생깁니다.",
    downside: tone.macroToneClass === "negative"
      ? "부담 요인이 이어질 경우 단기 지지선 이탈과 변동성 확대를 경계해야 합니다."
      : "거래량 둔화와 매크로 지표 악화가 겹치면 방어적 해석이 필요합니다."
  };
}

function buildRiskFlags(stock, technical) {
  const flags = [...(stock.risks || [])];
  const rsi = technical?.indicators?.rsi14;
  const dd = technical?.indicators?.drawdown120d;
  if (Number.isFinite(rsi) && rsi > 75) flags.push("RSI 과열 구간이라 단기 속도 조절 가능성을 확인해야 합니다.");
  if (Number.isFinite(dd) && dd < -25) flags.push("120거래일 고점 대비 낙폭이 커 변동성 관리가 필요합니다.");
  if (stock.inverseMultiplier) flags.push("레버리지·인버스 상품은 장기 보유 시 경로 의존성과 복리 효과를 반드시 확인해야 합니다.");
  return [...new Set(flags)];
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const prices = await readJsonIfExists(PRICES_PATH, { items: [] });
  const snapshot = await readJsonIfExists(SNAPSHOT_PATH, {});
  const briefings = await readJsonIfExists(BRIEFINGS_PATH, []);
  const latestBriefing = Array.isArray(briefings)
    ? briefings.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0]
    : null;
  const priceByTicker = new Map((prices.items || []).map((item) => [item.ticker, item]));
  const macroBackdrop = buildMacroBackdrop(snapshot, latestBriefing);

  const stocks = (config.stocks || []).map((stock) => {
    const priceItem = priceByTicker.get(stock.ticker);
    const technical = calcTechnical(priceItem);
    const history = priceItem?.history || [];
    const last = history.at(-1);
    const prev = history.at(-2);
    const quote = {
      price: last?.close ?? null,
      changePercent: round(pct(last?.close, prev?.close), 2),
      currency: priceItem?.currency || stock.currency || null,
      source: priceItem?.fallbackUsed ? "watchlist-prices-fallback" : "watchlist-prices"
    };
    const sectorSignal = buildSectorSignal(stock, snapshot, priceByTicker);
    const macroScore = macroAdjustment(stock, snapshot, sectorSignal);
    const tone = toneFromScore(macroScore);
    const forecast = buildForecast(stock, technical, macroScore);
    const riskFlags = buildRiskFlags(stock, technical);

    return {
      ...stock,
      quote,
      price: quote.price,
      changePercent: quote.changePercent,
      macroScore,
      ...tone,
      sectorSignal,
      technical,
      microAnalysis: {
        factors: stock.microFactors || []
      },
      forecast,
      macroSummary: `${macroBackdrop.title}. ${stock.thesis}`,
      riskFlags,
      scenario: buildScenario(stock, tone),
      disclaimer: config.disclaimer
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    title: config.title || "관심 종목 매크로·마이크로 분석",
    description: config.description || "",
    source: {
      snapshotPath: "data/market-snapshot.json",
      briefingsPath: "data/briefings.json",
      priceHistoryPath: "data/watchlist-prices.json",
      configPath: "config/watchlist-stocks.json",
      snapshotGeneratedAt: snapshot?.generatedAt || null,
      latestBriefingDate: latestBriefing?.date || null,
      priceHistoryGeneratedAt: prices?.generatedAt || null
    },
    macroBackdrop,
    stocks,
    disclaimer: config.disclaimer || "본 페이지는 자동 수집 데이터와 사용자가 정의한 종목 메모를 결합한 정보 제공 자료이며 투자자문이 아닙니다."
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`[build-stock-watchlist] wrote ${OUTPUT_PATH} (${stocks.length} stocks)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
