import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "fred-series.json");
const OUTPUT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const YAHOO_PATH = path.join(ROOT, "data", "yahoo-snapshot.json");
const API_BASE = "https://api.stlouisfed.org/fred/series/observations";
const DEMO_MODE = process.argv.includes("--demo");
const REPORT_DATE_OVERRIDE = process.env.REPORT_DATE_OVERRIDE;
const DEMO_ANCHOR_REPORT_DATE = "2026-04-27";

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function differenceInDays(leftDateString, rightDateString) {
  const left = new Date(`${leftDateString}T00:00:00Z`);
  const right = new Date(`${rightDateString}T00:00:00Z`);
  return Math.round((left.getTime() - right.getTime()) / 86400000);
}

function subtractBusinessDays(dateString, count) {
  const date = new Date(`${dateString}T00:00:00Z`);
  let remaining = count;

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return date.toISOString().slice(0, 10);
}

function toTimeZoneDateString(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function signed(value, digits = 2) {
  if (value === null || Number.isNaN(value)) {
    return "N/A";
  }

  const rounded = round(value, digits).toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function basisPoints(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  const points = Math.round(value * 100);
  return points > 0 ? `+${points}bp` : `${points}bp`;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toneFromCounts(positive, negative) {
  if (positive > negative) {
    return "강세";
  }

  if (negative > positive) {
    return "약세";
  }

  return "혼조";
}

function latestTwoValidObservations(observations) {
  const valid = observations.filter((item) => item.value !== "." && item.value !== null);

  if (valid.length === 0) {
    throw new Error("No valid observations returned.");
  }

  return {
    latest: valid[0],
    previous: valid[1] || valid[0]
  };
}

function businessDaysBetween(observationDate, reportDate) {
  const current = new Date(`${observationDate}T00:00:00Z`);
  const end = new Date(`${reportDate}T00:00:00Z`);

  if (current >= end) {
    return 0;
  }

  let businessDays = 0;
  while (current < end) {
    current.setUTCDate(current.getUTCDate() + 1);
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
  }

  return businessDays;
}

function freshnessStatus(ageBusinessDays, threshold) {
  if (ageBusinessDays <= threshold) {
    return "fresh";
  }

  if (ageBusinessDays <= threshold + 2) {
    return "delayed";
  }

  return "stale";
}

function freshnessLabel(status, ageBusinessDays) {
  if (status === "fresh") {
    return ageBusinessDays === 0 ? "당일 기준" : `허용 범위 ${ageBusinessDays}영업일`;
  }

  if (status === "delayed") {
    return `지연 ${ageBusinessDays}영업일`;
  }

  return `오래됨 ${ageBusinessDays}영업일`;
}

function annotateFreshness(item, reportDate, defaultThreshold) {
  const threshold = item.freshWithinBusinessDays ?? defaultThreshold;
  const businessDaysOld = businessDaysBetween(item.observationDate, reportDate);
  const status = freshnessStatus(businessDaysOld, threshold);

  return {
    ...item,
    freshWithinBusinessDays: threshold,
    freshness: {
      status,
      businessDaysOld,
      label: freshnessLabel(status, businessDaysOld),
      referenceDate: reportDate
    }
  };
}

function validateDateOverride(value) {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("REPORT_DATE_OVERRIDE must be in YYYY-MM-DD format.");
  }

  return value;
}

function normalizeSeriesItem(item, latest, previous, mode) {
  const latestValue = Number(latest.value);
  const previousValue = Number(previous.value);
  const absoluteChange = round(latestValue - previousValue, 6);
  const percentChange = previousValue === 0 ? null : round(((latestValue - previousValue) / previousValue) * 100, 4);

  return {
    id: item.id,
    label: item.label,
    group: item.group,
    format: item.format,
    decimals: item.decimals,
    latestValue,
    previousValue,
    absoluteChange,
    percentChange,
    observationDate: latest.date,
    previousObservationDate: previous.date,
    sourceUrl: `https://fred.stlouisfed.org/series/${item.id}`,
    mode,
    freshWithinBusinessDays: item.freshWithinBusinessDays
  };
}

function demoObservationOffsets(group) {
  if (group === "rates" || group === "commodities") {
    return { latest: 2, previous: 3 };
  }

  return { latest: 1, previous: 2 };
}

function demoStep(item) {
  if (item.format === "percent") {
    return 0.03;
  }

  if (item.format === "usd") {
    return 1.4;
  }

  if (item.format === "krw") {
    return 7;
  }

  const scaled = Math.abs(item.demoLatest) * 0.004;
  return scaled > 1 ? scaled : 1;
}

function buildDemoSeries(item, reportDate) {
  const variantOffset = differenceInDays(reportDate, DEMO_ANCHOR_REPORT_DATE);
  const offsets = demoObservationOffsets(item.group);
  const latestDate = subtractBusinessDays(reportDate, offsets.latest);
  const previousDate = subtractBusinessDays(reportDate, offsets.previous);
  const step = demoStep(item);
  const baseDelta = item.demoLatest - item.demoPrevious;
  const direction = baseDelta === 0 ? 1 : Math.sign(baseDelta);
  const flip = Math.abs(variantOffset) % 2 === 1 ? -1 : 1;
  const magnitude = Math.max(Math.abs(baseDelta), step * 0.35) * (1 + Math.abs(variantOffset) * 0.18);
  const latestValue = round(item.demoLatest + variantOffset * step, 6);
  const previousValueRaw = latestValue - (direction * flip * magnitude);
  const previousValue = round(Math.max(previousValueRaw, 0.01), 6);
  const latest = {
    date: latestDate,
    value: String(Math.max(latestValue, 0.01))
  };
  const previous = {
    date: previousDate,
    value: String(previousValue)
  };

  return normalizeSeriesItem(item, latest, previous, "demo");
}

async function fetchFredSeries(item, apiKey) {
  const url = new URL(API_BASE);
  url.searchParams.set("series_id", item.id);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "10");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED request failed for ${item.id}: ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.observations)) {
    throw new Error(`Unexpected FRED payload for ${item.id}`);
  }

  const { latest, previous } = latestTwoValidObservations(payload.observations);
  return normalizeSeriesItem(item, latest, previous, "fred-api");
}

function buildDerived(series) {
  const byId = Object.fromEntries(series.map((item) => [item.id, item]));
  const twoYear = byId.DGS2;
  const tenYear = byId.DGS10;
  const usdKrw = byId.DEXKOUS;
  const usdJpy = byId.DEXJPUS;

  const out = [];

  if (twoYear && tenYear) {
    const spread = round(tenYear.latestValue - twoYear.latestValue, 4);
    const previousSpread = round(tenYear.previousValue - twoYear.previousValue, 4);
    out.push({
      id: "UST10Y_UST2Y_SPREAD",
      label: "10Y-2Y Curve Spread",
      group: "rates",
      format: "percent",
      decimals: 2,
      latestValue: spread,
      previousValue: previousSpread,
      absoluteChange: round(spread - previousSpread, 4),
      percentChange: previousSpread === 0 ? null : round(((spread - previousSpread) / previousSpread) * 100, 4),
      observationDate: tenYear.observationDate,
      previousObservationDate: tenYear.previousObservationDate,
      sourceUrl: null,
      mode: tenYear.mode,
      derived: true,
      freshWithinBusinessDays: Math.max(twoYear.freshWithinBusinessDays ?? 2, tenYear.freshWithinBusinessDays ?? 2)
    });
  }

  // 원-엔(JPY/KRW) 100엔당 원: USDKRW / USDJPY × 100
  if (usdKrw && usdJpy &&
      Number.isFinite(usdKrw.latestValue) && Number.isFinite(usdJpy.latestValue) &&
      usdJpy.latestValue !== 0 && usdJpy.previousValue !== 0) {
    const latest = round((usdKrw.latestValue / usdJpy.latestValue) * 100, 2);
    const previous = round((usdKrw.previousValue / usdJpy.previousValue) * 100, 2);
    const absoluteChange = round(latest - previous, 2);
    const percentChange = previous === 0 ? null : round(((latest - previous) / previous) * 100, 2);
    // freshness ties to whichever leg is more delayed
    const olderLeg = (usdKrw.freshness?.businessDaysOld ?? 0) >= (usdJpy.freshness?.businessDaysOld ?? 0)
      ? usdKrw
      : usdJpy;
    out.push({
      id: "JPYKRW",
      label: "원-엔 환율(100엔당)",
      group: "korea",
      format: "krw",
      decimals: 2,
      latestValue: latest,
      previousValue: previous,
      absoluteChange,
      percentChange,
      observationDate: olderLeg.observationDate,
      previousObservationDate: olderLeg.previousObservationDate,
      sourceUrl: null,
      mode: olderLeg.mode,
      derived: true,
      derivedFrom: ["DEXKOUS", "DEXJPUS"],
      freshWithinBusinessDays: Math.max(usdKrw.freshWithinBusinessDays ?? 2, usdJpy.freshWithinBusinessDays ?? 2)
    });
  }

  return out;
}

function summarizeFreshness(items, reportDate) {
  const delayedItems = items.filter((item) => item.freshness.status === "delayed");
  const staleItems = items.filter((item) => item.freshness.status === "stale");
  const attentionItems = [...delayedItems, ...staleItems].sort(
    (a, b) => b.freshness.businessDaysOld - a.freshness.businessDaysOld
  );

  return {
    reportDate,
    status: staleItems.length > 0 ? "attention" : delayedItems.length > 0 ? "watch" : "healthy",
    freshCount: items.length - delayedItems.length - staleItems.length,
    delayedCount: delayedItems.length,
    staleCount: staleItems.length,
    items: attentionItems.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.freshness.status,
      observationDate: item.observationDate,
      businessDaysOld: item.freshness.businessDaysOld,
      freshnessLabel: item.freshness.label,
      sourceUrl: item.sourceUrl
    }))
  };
}

function assessDataQuality(series, reportDate) {
  const coreIds = new Set(["SP500", "NASDAQCOM", "DJIA", "DGS2", "DGS10", "VIXCLS"]);
  const coreItems = series.filter((item) => coreIds.has(item.id));
  const contextItems = series.filter((item) => !coreIds.has(item.id));
  const coreDelayedCount = coreItems.filter((item) => item.freshness.status === "delayed").length;
  const coreStaleCount = coreItems.filter((item) => item.freshness.status === "stale").length;
  const contextDelayedCount = contextItems.filter((item) => item.freshness.status === "delayed").length;
  const contextStaleCount = contextItems.filter((item) => item.freshness.status === "stale").length;
  const blockedNarrativeItems = contextItems.filter((item) => item.freshness.status === "stale");
  const score = Math.max(
    0,
    100 - (coreStaleCount * 30) - (coreDelayedCount * 15) - (contextStaleCount * 12) - (contextDelayedCount * 6)
  );
  const publicationStatus = coreStaleCount > 0 ? "hold" : (coreDelayedCount > 0 || contextStaleCount > 0 ? "caution" : "ready");
  const publicationLabel = publicationStatus === "ready"
    ? "정상 발행"
    : publicationStatus === "caution"
      ? "일부 지표 지연 반영"
      : "자동 발행 보류 검토";
  const confidence = score >= 88 && coreDelayedCount === 0 && coreStaleCount === 0
    ? "high"
    : score >= 68 && coreStaleCount === 0
      ? "medium"
      : "low";
  const confidenceLabel = confidence === "high"
    ? "자료 상태 양호"
    : confidence === "medium"
      ? "보조지표 확인 필요"
      : "핵심지표 확인 필요";
  const warnings = [];

  if (coreStaleCount > 0) {
    warnings.push(`핵심 판단 지표 ${coreStaleCount}건의 기준일이 오래돼 자동 해석의 강도를 낮춰야 합니다.`);
  }

  if (coreDelayedCount > 0) {
    warnings.push(`핵심 판단 지표 ${coreDelayedCount}건의 기준일이 지연돼 당일 해석 강도를 낮춰야 합니다.`);
  }

  if (contextStaleCount > 0) {
    warnings.push(`보조 해석용 시계열 ${contextStaleCount}건은 오래돼 핵심 서술에서 제외했습니다.`);
  }

  if (contextDelayedCount > 0) {
    warnings.push(`보조 해석용 시계열 ${contextDelayedCount}건은 지연 상태라 방향 확인용으로만 사용했습니다.`);
  }

  return {
    reportDate,
    score,
    confidence,
    confidenceLabel,
    publicationStatus,
    publicationLabel,
    warnings,
    blockedNarrativeIds: blockedNarrativeItems.map((item) => item.id),
    blockedNarrativeLabels: blockedNarrativeItems.map((item) => item.label),
    coreFreshCount: coreItems.length - coreDelayedCount - coreStaleCount,
    coreDelayedCount,
    coreStaleCount,
    contextDelayedCount,
    contextStaleCount
  };
}

function isNarrativeUsable(item) {
  return Boolean(item) && item.freshness.status !== "stale";
}

function buildEquitySignal(byId) {
  const equities = [byId.SP500, byId.NASDAQCOM, byId.DJIA].filter(Boolean);
  const positive = equities.filter((item) => item.percentChange > 0.15).length;
  const negative = equities.filter((item) => item.percentChange < -0.15).length;
  const leader = [...equities].sort((left, right) => (right.percentChange ?? -Infinity) - (left.percentChange ?? -Infinity))[0];
  const laggard = [...equities].sort((left, right) => (left.percentChange ?? Infinity) - (right.percentChange ?? Infinity))[0];
  const sp = byId.SP500;
  const nasdaq = byId.NASDAQCOM;
  const dow = byId.DJIA;
  const averageMove = average(equities.map((item) => item.percentChange ?? 0)) ?? 0;
  let headline = "혼조";
  let description = "지수 간 방향이 엇갈려 추세 확인보다 종목·섹터 선별이 중요합니다.";

  if (positive === equities.length) {
    headline = "광범위 강세";
    description = "3대 지수가 모두 올라 투자심리가 시장 전반에서 개선됐습니다.";
  } else if (negative === equities.length) {
    headline = "광범위 약세";
    description = "3대 지수가 동반 하락해 방어 심리가 시장 전반에서 커졌습니다.";
  } else if (positive > negative) {
    headline = "선별 강세";
    description = "상승 종목이 우세하지만 지수 간 온도차가 남아 있어 추세 확인은 더 필요합니다.";
  } else if (negative > positive) {
    headline = "선별 약세";
    description = "하락 종목이 우세해 방어적 해석이 필요하지만 일방적인 투매로 보기에는 확인이 부족합니다.";
  }

  let leadership = "지수 전반 동행";
  if (leader?.id === "NASDAQCOM" && (leader.percentChange - (sp?.percentChange ?? leader.percentChange)) >= 0.5) {
    leadership = "기술주 주도";
  } else if (leader?.id === "DJIA" && (leader.percentChange - (sp?.percentChange ?? leader.percentChange)) >= 0.4) {
    leadership = "전통 대형주 견조";
  } else if (leader?.id === "SP500" && Math.abs((nasdaq?.percentChange ?? 0) - (dow?.percentChange ?? 0)) <= 0.35) {
    leadership = "대형주 전반 동행";
  }

  const label = leadership === "지수 전반 동행" || leadership === "대형주 전반 동행"
    ? headline
    : `${leadership} ${headline}`;
  const evidence = equities.map((item) => `${item.label} ${signed(item.percentChange)}%`).join(", ");
  const leaderLine = leader && laggard
    ? `${leader.label}가 ${signed(leader.percentChange)}%로 상대 강도가 가장 높았고, ${laggard.label}는 ${signed(laggard.percentChange)}%였습니다.`
    : "";

  return {
    label,
    description: `${description} ${leaderLine}`.trim(),
    evidence,
    averageMove,
    positive,
    negative,
    leaderId: leader?.id || null
  };
}

function buildRateSignal(byId, curve) {
  const tenYear = byId.DGS10;
  const twoYear = byId.DGS2;
  if (!tenYear || !twoYear) {
    return null;
  }

  const up10 = tenYear.absoluteChange >= 0.03;
  const down10 = tenYear.absoluteChange <= -0.03;
  const up2 = twoYear.absoluteChange >= 0.03;
  const down2 = twoYear.absoluteChange <= -0.03;
  let label = "금리 방향 혼재";
  let description = "장단기 금리 방향이 엇갈려 밸류에이션과 경기 신호를 함께 봐야 합니다.";
  let direction = "mixed";

  if (up10 && up2) {
    label = "금리 상방 재가격";
    description = "장단기 금리가 함께 올라 할인율 부담이 커졌습니다.";
    direction = "up";
  } else if (down10 && down2) {
    label = "금리 하향 안정";
    description = "장단기 금리가 함께 내려 밸류에이션 부담이 완화됐습니다.";
    direction = "down";
  } else if (tenYear.absoluteChange > 0 && twoYear.absoluteChange <= 0) {
    label = "커브 스티프닝";
    description = "장기물 금리가 상대적으로 높아져 장기 할인율 부담이 다시 부각됐습니다.";
    direction = "mixed";
  } else if (tenYear.absoluteChange < 0 && twoYear.absoluteChange >= 0) {
    label = "장기금리 완화";
    description = "장기물 금리가 눌리며 성장·인플레이션 기대가 일부 진정됐습니다.";
    direction = "down";
  }

  const curveText = curve ? `10Y-2Y ${signed(curve.latestValue)}%p (${basisPoints(curve.absoluteChange)})` : "10Y-2Y N/A";
  return {
    label,
    description,
    direction,
    evidence: `10년물 ${tenYear.latestValue.toFixed(2)}% (${basisPoints(tenYear.absoluteChange)}), 2년물 ${twoYear.latestValue.toFixed(2)}% (${basisPoints(twoYear.absoluteChange)}), ${curveText}`
  };
}

function buildVolatilitySignal(byId, equitySignal) {
  const vix = byId.VIXCLS;
  if (!vix) {
    return null;
  }

  let label = "변동성 중립";
  let description = "변동성 지표만으로는 주가 방향을 강하게 확인하기 어렵습니다.";
  let conflicted = false;
  let confirmation = "neutral";

  if (vix.absoluteChange <= -0.5 && equitySignal.averageMove >= 0) {
    label = "투자심리 개선 확인";
    description = "주가 상승을 VIX 하락이 확인해 단기 심리는 비교적 안정적이었습니다.";
    confirmation = "supportive";
  } else if (vix.absoluteChange >= 0.5 && equitySignal.averageMove > 0) {
    label = "헤지 수요 잔존";
    description = "주가가 올랐지만 VIX도 함께 올라 상승 흐름의 지속성은 더 확인할 필요가 있습니다.";
    conflicted = true;
    confirmation = "conflicted";
  } else if (vix.absoluteChange >= 0.5 && equitySignal.averageMove <= 0) {
    label = "방어 심리 확인";
    description = "주가 약세에 변동성 상승이 겹쳐 전형적인 방어 흐름이었습니다.";
    confirmation = "risk-off";
  } else if (vix.absoluteChange <= -0.5 && equitySignal.averageMove < 0) {
    label = "변동성 둔화";
    description = "지수는 약했지만 VIX가 내려 단기 패닉으로 볼 정도는 아니었습니다.";
    conflicted = true;
    confirmation = "conflicted";
  }

  return {
    label,
    description,
    conflicted,
    confirmation,
    evidence: `VIX ${vix.latestValue.toFixed(2)} (${signed(vix.percentChange)}%, ${signed(vix.absoluteChange)}pt)`
  };
}

function buildDollarSignal(byId) {
  const usdKrw = byId.DEXKOUS;
  const broadDollar = byId.DTWEXBGS;
  const usable = [usdKrw, broadDollar].filter(isNarrativeUsable);

  if (usable.length === 0) {
    return {
      label: "환율 신호 제외",
      description: "달러 관련 시계열이 오래돼 당일 핵심 해석에서는 제외했습니다.",
      evidence: null,
      usable: false
    };
  }

  const dollarMoves = [
    usdKrw ? usdKrw.percentChange : null,
    broadDollar ? broadDollar.percentChange : null
  ].filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
  const direction = average(dollarMoves) ?? 0;
  let label = "달러 신호 혼재";
  let description = "달러 방향성은 있으나 환율과 달러지수가 같은 강도로 확인되지는 않았습니다.";

  if (direction >= 0.15) {
    label = "달러 강세";
    description = "달러 강세 압력이 유지돼 신흥시장과 원화 체감에는 부담 요인입니다.";
  } else if (direction <= -0.15) {
    label = "달러 완화";
    description = "달러 강세 압력이 누그러져 위험자산에는 부담이 다소 완화됐습니다.";
  }

  const parts = [];
  if (isNarrativeUsable(usdKrw)) {
    parts.push(`USD/KRW ${signed(usdKrw.percentChange)}%`);
  }

  if (isNarrativeUsable(broadDollar)) {
    parts.push(`BBDI ${signed(broadDollar.percentChange)}%`);
  }

  return {
    label,
    description,
    evidence: parts.join(", "),
    usable: true
  };
}

function buildOilSignal(byId) {
  const wti = byId.DCOILWTICO;

  if (!wti) {
    return null;
  }

  if (!isNarrativeUsable(wti)) {
    return {
      label: "유가 신호 제외",
      description: `${wti.label} 기준일이 ${wti.observationDate}로 오래돼 당일 핵심 해석에서는 제외했습니다.`,
      evidence: `${wti.label} ${wti.observationDate}`,
      usable: false
    };
  }

  let label = "유가 안정";
  let description = "원자재 변동이 크지 않아 인플레이션 해석을 과도하게 바꿀 정도는 아니었습니다.";

  if ((wti.percentChange ?? 0) >= 2) {
    label = "유가 반등";
    description = "유가가 크게 올라 인플레이션 재자극 가능성을 함께 봐야 합니다.";
  } else if ((wti.percentChange ?? 0) <= -2) {
    label = "유가 하락";
    description = "유가가 내려 단기 인플레이션 부담은 다소 완화됐습니다.";
  }

  return {
    label,
    description,
    evidence: `WTI ${wti.latestValue.toFixed(2)}달러 (${signed(wti.percentChange)}%)`,
    usable: true
  };
}

function buildPositioningSignals(equitySignal, rateSignal, volatilitySignal, dataQuality) {
  const items = [];

  if (equitySignal.positive > equitySignal.negative && rateSignal?.direction === "down" && volatilitySignal?.confirmation === "supportive") {
    items.push({
      title: "멀티플 확장 우호",
      desc: "주가 강세에 금리 하락과 VIX 하락이 동반돼 성장주·듀레이션 자산 해석에 우호적입니다."
    });
  } else if (equitySignal.positive > equitySignal.negative && rateSignal?.direction === "up") {
    items.push({
      title: "상승 지속성 점검",
      desc: "주가가 강해도 금리 부담이 남아 있어 추격 매수보다 상승 폭의 질을 먼저 확인하는 편이 낫습니다."
    });
  } else if (equitySignal.negative > equitySignal.positive && rateSignal?.direction === "down") {
    items.push({
      title: "방어주·채권 선호",
      desc: "주가 약세와 금리 하락이 함께 나타나면 방어적 자산 선호가 강화됐을 가능성이 큽니다."
    });
  } else {
    items.push({
      title: "방향보다 확인",
      desc: "지수·금리·변동성 신호가 완전히 정렬되지 않아 섣부른 추세 추종보다 확인 매매가 적절합니다."
    });
  }

  if (dataQuality.confidence === "low") {
    items.push({
      title: "판단 강도 낮추기",
      desc: "오래된 시계열이 남아 있어 공격적 해석보다 관찰 비중을 높이는 편이 안전합니다."
    });
  } else if (dataQuality.confidence === "medium") {
    items.push({
      title: "보조 데이터 분리",
      desc: "핵심 지표는 활용 가능하지만 보조 자산 데이터는 뉴스나 실시간 호가와 교차 확인하는 편이 좋습니다."
    });
  } else {
    items.push({
      title: "데이터 상태 양호",
      desc: "핵심 판단축은 허용 범위 안에 있어 당일 시장 톤을 읽는 데 큰 제약이 없습니다."
    });
  }

  return items.slice(0, 2);
}

function buildNarrativeAnalysis(series, derived, freshnessSummary, reportDate) {
  const byId = Object.fromEntries(series.map((item) => [item.id, item]));
  const curve = derived.find((item) => item.id === "UST10Y_UST2Y_SPREAD");
  const dataQuality = assessDataQuality(series, reportDate);
  const equitySignal = buildEquitySignal(byId);
  const rateSignal = buildRateSignal(byId, curve);
  const volatilitySignal = buildVolatilitySignal(byId, equitySignal);
  const dollarSignal = buildDollarSignal(byId);
  const oilSignal = buildOilSignal(byId);
  const risks = [];

  dataQuality.warnings.forEach((warning) => {
    risks.push({
      title: "데이터 품질 경고",
      desc: warning,
      severity: dataQuality.publicationStatus === "hold" ? "high" : "medium"
    });
  });

  if (equitySignal.positive > 0 && equitySignal.negative > 0) {
    risks.push({
      title: "지수 확인 제한",
      desc: "상승 지수와 하락 지수가 함께 있어 장세 해석을 한 방향으로 단정하기 어렵습니다.",
      severity: "medium"
    });
  }

  if (volatilitySignal?.conflicted) {
    risks.push({
      title: "변동성 확인 불일치",
      desc: "주가 방향과 VIX 방향이 어긋나 단기 추세의 지속성을 단정하기 어렵습니다.",
      severity: "medium"
    });
  }

  if (!oilSignal?.usable) {
    risks.push({
      title: "원자재 신호 제외",
      desc: oilSignal?.description || "유가 데이터가 오래돼 당일 해석에서 제외했습니다.",
      severity: "medium"
    });
  }

  const qualityLine = dataQuality.publicationStatus === "ready"
    ? "주요 지표의 기준일은 보고서 작성에 무리가 없는 수준입니다."
    : dataQuality.publicationStatus === "caution"
      ? "주요 지표는 활용 가능하지만, 일부 보조 지표는 기준일이 늦어 해석 범위를 제한했습니다."
      : "핵심 지표의 기준일이 늦어 자동 발행 전 추가 확인이 필요합니다.";
  const leadParts = [
    `${equitySignal.label} 흐름입니다.`,
    rateSignal ? `${rateSignal.description}` : null,
    volatilitySignal ? `${volatilitySignal.description}` : null,
    qualityLine
  ].filter(Boolean);
  const title = `${equitySignal.label}, 10년물 ${byId.DGS10 ? byId.DGS10.latestValue.toFixed(2) : "N/A"}% · VIX ${byId.VIXCLS ? byId.VIXCLS.latestValue.toFixed(2) : "N/A"}`;
  const deck = `FRED 데이터 기반 브리핑 · ${dataQuality.confidenceLabel} · ${dataQuality.publicationLabel}`;
  const highlights = [
    `오늘의 요약: ${equitySignal.label}. ${rateSignal ? rateSignal.label : "금리 판단 보류"}, ${volatilitySignal ? volatilitySignal.label : "변동성 확인 보류"} 조합입니다.`,
    `핵심 근거: ${equitySignal.evidence}${rateSignal ? ` / ${rateSignal.evidence}` : ""}${volatilitySignal ? ` / ${volatilitySignal.evidence}` : ""}.`,
    `해석 유의: ${dataQuality.warnings[0] || "주요 지표 기준일은 보고서 작성에 무리가 없는 상태입니다."}`
  ];
  const facts = [
    `지수: ${equitySignal.evidence}`,
    rateSignal ? `금리: ${rateSignal.evidence}` : null,
    volatilitySignal ? `변동성: ${volatilitySignal.evidence}` : null,
    dollarSignal.usable ? `달러: ${dollarSignal.evidence}` : null,
    oilSignal?.usable ? `원자재: ${oilSignal.evidence}` : null
  ].filter(Boolean);
  const positioning = buildPositioningSignals(equitySignal, rateSignal, volatilitySignal, dataQuality);
  const sections = {
    topStory: [
      {
        title: "시장 판정",
        desc: `${equitySignal.description}${rateSignal ? ` ${rateSignal.description}` : ""}`
      },
      {
        title: "자료 기준일",
        desc: `${dataQuality.confidenceLabel}, 점수 ${dataQuality.score}/100. ${qualityLine}`
      }
    ],
    marketReaction: [
      {
        title: "지수와 금리",
        desc: `${equitySignal.evidence}${rateSignal ? ` / ${rateSignal.evidence}` : ""}`
      },
      {
        title: "보조 자산 확인",
        desc: [volatilitySignal?.evidence, dollarSignal.evidence, oilSignal?.usable ? oilSignal.evidence : null].filter(Boolean).join(" / ") || "보조 자산 데이터가 부족합니다."
      }
    ],
    watchNow: [
      {
        title: "가장 큰 제약",
        desc: dataQuality.warnings[0] || "핵심 시계열 기준일은 허용 범위 안에 있습니다."
      },
      {
        title: "추가 확인 포인트",
        desc: risks[1]?.desc || (dollarSignal.usable ? dollarSignal.description : oilSignal?.description || "추가 경고는 없습니다.")
      }
    ],
    positioning
  };
  const tags = [
    dataQuality.confidenceLabel,
    dataQuality.publicationLabel,
    equitySignal.leaderId === "NASDAQCOM" ? "기술주주도" : null,
    freshnessSummary.staleCount > 0 ? "오래된시계열주의" : null
  ].filter(Boolean);

  return {
    title,
    deck,
    lead: leadParts.join(" "),
    facts,
    highlights,
    dataQuality,
    drivers: [
      { title: "주식", verdict: equitySignal.label, desc: equitySignal.description, evidence: equitySignal.evidence },
      rateSignal ? { title: "금리", verdict: rateSignal.label, desc: rateSignal.description, evidence: rateSignal.evidence } : null,
      volatilitySignal ? { title: "변동성", verdict: volatilitySignal.label, desc: volatilitySignal.description, evidence: volatilitySignal.evidence } : null,
      dollarSignal.usable ? { title: "달러", verdict: dollarSignal.label, desc: dollarSignal.description, evidence: dollarSignal.evidence } : null
    ].filter(Boolean),
    risks,
    sections,
    tags,
    qualityLine
  };
}

function buildHighlights(analysis) {
  return analysis.highlights;
}

function buildPayload(config, series, derived, generatedAt, reportDate) {
  const groups = config.groups.map((group) => ({
    ...group,
    items: [...series, ...derived].filter((item) => item.group === group.id)
  }));

  const mode = series.some((item) => item.mode === "fred-api") ? "fred-api" : "demo";
  const freshnessSummary = summarizeFreshness(series, reportDate);
  const analysis = buildNarrativeAnalysis(series, derived, freshnessSummary, reportDate);
  const freshnessNote = freshnessSummary.staleCount > 0
    ? `오래된 시계열 ${freshnessSummary.staleCount}건과 지연 시계열 ${freshnessSummary.delayedCount}건이 있어, 카드의 기준일을 함께 보고 해석해야 합니다.`
    : freshnessSummary.delayedCount > 0
      ? `지연 시계열 ${freshnessSummary.delayedCount}건이 있어, 일부 값은 당일 실시간 해석보다 전일 컨텍스트에 가깝습니다.`
      : "현재 선택한 핵심 시리즈는 모두 허용한 최신 범위 안에 들어왔습니다.";

  return {
    generatedAt: generatedAt.toISOString(),
    reportDate,
    mode,
    source: config.source,
    headline: analysis.title,
    subheadline: analysis.deck,
    highlights: buildHighlights(analysis),
    analysis,
    freshnessSummary,
    notes: [
      analysis.qualityLine,
      freshnessNote,
      "핵심 시계열은 FRED API의 fred/series/observations 엔드포인트를 기준으로 가져옵니다.",
      "주식지수와 변동성 계열 일부는 FRED 안에서도 원 데이터 공급자의 별도 저작권/사용 조건이 붙을 수 있으니 공개 배포 전 각 시리즈 노트를 확인해야 합니다.",
      "뉴스·실적·정책 이벤트를 붙이지 않은 규칙 기반 해석이므로, 원인 설명은 실시간 헤드라인과 함께 교차 확인해야 합니다."
    ],
    groups
  };
}

async function loadYahooExtras(reportDate, defaultThreshold) {
  let raw;
  try {
    raw = JSON.parse(await readFile(YAHOO_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    console.warn(`Yahoo snapshot 읽기 실패: ${error.message}`);
    return [];
  }

  const items = (raw.items || []).filter((item) => !item.error);
  return items.map((item) => annotateFreshness({
    id: item.id,
    label: item.label,
    group: item.group,
    format: item.format,
    decimals: item.decimals ?? 2,
    latestValue: item.latestValue,
    previousValue: item.previousValue,
    absoluteChange: item.absoluteChange,
    percentChange: item.percentChange,
    observationDate: item.observationDate,
    previousObservationDate: item.previousObservationDate,
    sourceUrl: item.sourceUrl,
    mode: "yahoo-finance"
  }, reportDate, defaultThreshold));
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const apiKey = process.env.FRED_API_KEY;
  const reportTimeZone = config.defaults?.reportTimeZone || "Asia/Seoul";
  const defaultThreshold = config.defaults?.freshWithinBusinessDays ?? 2;
  const generatedAt = new Date();
  const reportDate = validateDateOverride(REPORT_DATE_OVERRIDE) || toTimeZoneDateString(generatedAt, reportTimeZone);

  if (!DEMO_MODE && !apiKey) {
    throw new Error("FRED_API_KEY is required. Run with --demo for sample output.");
  }

  const rawSeries = await Promise.all(
    config.series.map((item) => (DEMO_MODE ? buildDemoSeries(item, reportDate) : fetchFredSeries(item, apiKey)))
  );
  const series = rawSeries.map((item) => annotateFreshness(item, reportDate, defaultThreshold));
  const derived = buildDerived(series).map((item) => annotateFreshness(item, reportDate, defaultThreshold));
  const yahooExtras = await loadYahooExtras(reportDate, defaultThreshold);
  const payload = buildPayload(config, [...series, ...yahooExtras], derived, generatedAt, reportDate);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote snapshot to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
