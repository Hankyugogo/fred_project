import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const NEWS_DIGEST_PATH = path.join(ROOT, "data", "news-digest.json");
const POSTS_DIR = path.join(ROOT, "posts");

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value, decimals = 2) {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function formatValue(item) {
  if (!item || item.latestValue === null || item.latestValue === undefined || Number.isNaN(item.latestValue)) {
    return "N/A";
  }

  if (item.format === "percent") {
    return `${formatNumber(item.latestValue, item.decimals ?? 2)}%`;
  }

  if (item.format === "usd") {
    return `$${formatNumber(item.latestValue, item.decimals ?? 2)}`;
  }

  if (item.format === "krw") {
    return `${formatNumber(item.latestValue, item.decimals ?? 2)} KRW`;
  }

  return formatNumber(item.latestValue, item.decimals ?? 2);
}

function signed(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  const rounded = round(value, digits).toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function formatPercent(value, digits = 2) {
  return value === null || value === undefined || Number.isNaN(value) ? "N/A" : `${signed(value, digits)}%`;
}

function formatPercentPoint(value, digits = 2) {
  return value === null || value === undefined || Number.isNaN(value) ? "N/A" : `${signed(value, digits)}%p`;
}

function formatDelta(item) {
  const absoluteDigits = item.decimals ?? 2;
  const absoluteText = item.format === "percent"
    ? `${signed(item.absoluteChange, absoluteDigits)}%p`
    : signed(item.absoluteChange, absoluteDigits);

  if (item.percentChange === null || item.percentChange === undefined || Number.isNaN(item.percentChange)) {
    return absoluteText;
  }

  return `${absoluteText}, ${signed(item.percentChange, 2)}%`;
}

function formatNewsDate(value) {
  if (!value) {
    return "시간 확인 필요";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "시간 확인 필요";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getGroup(snapshot, groupId) {
  return snapshot.groups.find((group) => group.id === groupId);
}

function getItem(snapshot, itemId) {
  for (const group of snapshot.groups) {
    const found = group.items.find((item) => item.id === itemId);
    if (found) {
      return found;
    }
  }

  return null;
}

function getItems(snapshot, ids) {
  return ids.map((id) => getItem(snapshot, id)).filter(Boolean);
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxBy(items, selector) {
  return items.reduce((best, item) => (best === null || selector(item) > selector(best) ? item : best), null);
}

function minBy(items, selector) {
  return items.reduce((best, item) => (best === null || selector(item) < selector(best) ? item : best), null);
}

function eqMoveLabel(value) {
  const abs = Math.abs(value ?? 0);

  if (abs < 0.15) {
    return "보합권";
  }

  if (abs < 0.6) {
    return value > 0 ? "완만한 상승" : "완만한 하락";
  }

  if (abs < 1.2) {
    return value > 0 ? "상승" : "하락";
  }

  return value > 0 ? "강한 상승" : "강한 하락";
}

function classifyVix(vix) {
  const value = vix?.latestValue;

  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      label: "변동성 확인 불가",
      desc: "변동성지수(VIX) 자료가 확보되지 않아 시장 스트레스 판단을 보류한다."
    };
  }

  if (value < 15) {
    return {
      label: "변동성 낮음",
      desc: `변동성지수는 ${formatNumber(value, 2)}로 낮은 수준에 머물렀다. 시장은 비교적 평온한 흐름을 이어갔다.`
    };
  }

  if (value < 20) {
    return {
      label: "변동성 안정",
      desc: `변동성지수는 ${formatNumber(value, 2)}로 안정적인 흐름을 보였다. 시장 참가자의 헤지 수요는 평년 수준에 그쳤다.`
    };
  }

  if (value < 25) {
    return {
      label: "변동성 상승",
      desc: `변동성지수는 ${formatNumber(value, 2)}로 평년 대비 한 단계 높아졌다. 방어 수요가 늘어 추가 자산 가격 변동에 대한 경계감이 커진 것으로 분석된다.`
    };
  }

  return {
    label: "변동성 확대",
    desc: `변동성지수는 ${formatNumber(value, 2)}로 큰 폭의 변동성 확대 구간에 들어섰다. 시장 스트레스가 높아 주가 반등이 나타나도 지속성을 별도로 확인해야 한다.`
  };
}

function classifyCurve(curve) {
  const value = curve?.latestValue;
  const change = curve?.absoluteChange ?? 0;

  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      label: "판단 보류",
      direction: "확인 필요",
      desc: "곡선 데이터를 확인하지 못했습니다."
    };
  }

  const direction = Math.abs(change) < 0.03 ? "변화 제한" : change > 0 ? "장단기 금리차 확대" : "장단기 금리차 축소";

  if (value > 0.75) {
    return {
      label: "정상 곡선 가파름",
      direction,
      desc: `장단기 금리차는 ${formatPercentPoint(value)}로 가파른 정상 곡선이 형성됐다. 경기 둔화보다 기간 프리미엄과 성장 기대가 함께 반영된 구간으로 평가된다.`
    };
  }

  if (value > 0.15) {
    return {
      label: "정상 곡선",
      direction,
      desc: `장단기 금리차는 ${formatPercentPoint(value)}로 역전 구간을 벗어났다. 다만 장기금리의 상단 부담이 주가 밸류에이션에는 여전히 제약 요인으로 작용한다.`
    };
  }

  if (value > -0.15) {
    return {
      label: "곡선 평탄",
      direction,
      desc: `장단기 금리차는 ${formatPercentPoint(value)}로 방향성이 약한 평탄 구간이다. 장단기 금리 해석보다 단기 이벤트에 따라 변동이 커질 가능성이 있다.`
    };
  }

  return {
    label: "장단기 금리 역전",
    direction,
    desc: `장단기 금리차는 ${formatPercentPoint(value)}로 역전 구간에 머물렀다. 경기 둔화 시그널이 잔존하는 만큼 보수적 해석이 필요하다.`
  };
}

function classifyTenYear(tenYear, fedFunds) {
  const value = tenYear?.latestValue;
  const change = tenYear?.absoluteChange ?? 0;
  const policyGap = value !== undefined && value !== null && fedFunds?.latestValue !== undefined && fedFunds?.latestValue !== null
    ? round(value - fedFunds.latestValue, 2)
    : null;
  const direction = Math.abs(change) < 0.03 ? "정체" : change > 0 ? "상승" : "하락";

  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      label: "장기금리 자료 미확보",
      direction,
      desc: "미 국채 10년물 자료가 확보되지 않아 금리 흐름 해석을 보류한다.",
      policyGap
    };
  }

  if (value >= 4.5) {
    return {
      label: "장기금리 높음",
      direction,
      desc: `미 국채 10년물 금리는 ${formatValue(tenYear)}로 주가 밸류에이션 부담이 큰 구간이다. 금리가 더 오를 경우 성장주의 할인율 부담이 한층 커질 가능성이 있다.`,
      policyGap
    };
  }

  if (value >= 4.0) {
    return {
      label: "장기금리 중상단",
      direction,
      desc: `미 국채 10년물 금리는 ${formatValue(tenYear)}로 주가와 공존이 가능하나 추세적 밸류에이션 확장을 동시에 허용하기는 어려운 수준이다.`,
      policyGap
    };
  }

  return {
    label: "장기금리 완화",
    direction,
    desc: `미 국채 10년물 금리는 ${formatValue(tenYear)}로 금리 부담이 상대적으로 덜한 구간이다.`,
    policyGap
  };
}

function buildEquityProfile(snapshot) {
  const equities = getItems(snapshot, ["SP500", "NASDAQCOM", "DJIA"]);
  const positive = equities.filter((item) => (item.percentChange ?? 0) > 0.12).length;
  const negative = equities.filter((item) => (item.percentChange ?? 0) < -0.12).length;
  const averageMove = round(mean(equities.map((item) => item.percentChange ?? 0)), 2);
  const leader = maxBy(equities, (item) => item.percentChange ?? Number.NEGATIVE_INFINITY);
  const laggard = minBy(equities, (item) => item.percentChange ?? Number.POSITIVE_INFINITY);

  let tone = "혼조";
  if (positive >= 2 && averageMove > 0.2) {
    tone = "강세";
  } else if (negative >= 2 && averageMove < -0.2) {
    tone = "약세";
  }

  let leadershipLabel = "광범위한 동행";
  let leadershipDesc = "세 지수의 방향이 비교적 같은 축으로 움직였습니다.";
  let leadershipShort = "광범위한 동행";

  const nasdaq = getItem(snapshot, "NASDAQCOM");
  const sp = getItem(snapshot, "SP500");
  const dow = getItem(snapshot, "DJIA");

  if ((nasdaq?.percentChange ?? 0) - Math.max(sp?.percentChange ?? 0, dow?.percentChange ?? 0) > 0.35) {
    leadershipLabel = "성장주 주도";
    leadershipDesc = `나스닥이 ${formatPercent(nasdaq?.percentChange, 2)}를 기록하며 대형 성장주가 상대적으로 견조했습니다.`;
    leadershipShort = "나스닥 주도";
  } else if ((dow?.percentChange ?? 0) - Math.max(sp?.percentChange ?? 0, nasdaq?.percentChange ?? 0) > 0.35) {
    leadershipLabel = "다우지수 상대 강세";
    leadershipDesc = `다우지수가 ${formatPercent(dow?.percentChange, 2)}를 기록하며 전통 대형주가 상대적으로 견조했습니다.`;
    leadershipShort = "다우지수 견조";
  } else if (leader && laggard && Math.abs((leader.percentChange ?? 0) - (laggard.percentChange ?? 0)) > 0.5) {
    leadershipLabel = `${leader.label} 상대 강세`;
    leadershipDesc = `${leader.label} ${formatPercent(leader.percentChange, 2)}가 가장 강했고, ${laggard.label} ${formatPercent(laggard.percentChange, 2)}가 가장 약했습니다.`;
    leadershipShort = `${leader.label} 견조`;
  }

  return {
    equities,
    positive,
    negative,
    averageMove,
    leader,
    laggard,
    tone,
    leadershipLabel,
    leadershipDesc,
    leadershipShort
  };
}

function buildFxNarrative(usdKrw, dollarIndex, freshnessSummary) {
  const staleFx = freshnessSummary.items.filter((item) => item.id === "DEXKOUS" || item.id === "DTWEXBGS");

  if (staleFx.length > 0) {
    return {
      label: "기준일 지연",
      summary: "달러·원화 시계열의 기준일이 늦었다.",
      desc: "달러·원화 계열은 FRED 기준일이 늦어 보충 시세를 함께 확인해야 한다."
    };
  }

  if (!usdKrw && !dollarIndex) {
    return {
      label: "자료 미확보",
      summary: "환율 자료가 확보되지 않았다.",
      desc: "환율 계열 자료가 확인되지 않아 외환 흐름 해석을 보류한다."
    };
  }

  const usdKrwChange = usdKrw?.percentChange ?? 0;
  const dollarChange = dollarIndex?.percentChange ?? 0;

  if (usdKrwChange > 0 && dollarChange > 0) {
    return {
      label: "달러 강세",
      summary: "달러 강세 흐름이 뚜렷하다.",
      desc: "달러 강세와 원화 약세가 동반되면서 한국 시장의 외국인 매매 흐름에는 역풍 요인으로 작용할 가능성이 있다."
    };
  }

  if (usdKrwChange < 0 && dollarChange < 0) {
    return {
      label: "달러 약세",
      summary: "달러 약세 흐름이 나타났다.",
      desc: "달러 약세가 동반되면 원화의 상대적 안정과 위험자산 선호 회복을 연결해 분석할 수 있다."
    };
  }

  return {
    label: "방향 혼조",
    summary: "외환 시장 방향이 엇갈렸다.",
    desc: "달러지수와 원화 흐름의 정렬이 약해 환율만으로 단기 방향을 단정하기 어려운 구간이다."
  };
}

function buildOilNarrative(wti, freshnessSummary) {
  const staleOil = freshnessSummary.items.find((item) => item.id === "DCOILWTICO");

  if (staleOil) {
    return {
      label: "기준일 지연",
      summary: "서부텍사스산원유(WTI) 기준일이 늦었다.",
      desc: "WTI는 FRED 기준일이 늦어 인플레이션 압력과 지정학 리스크 판단을 위해 보충 시세를 함께 확인해야 한다."
    };
  }

  if (!wti) {
    return {
      label: "자료 미확보",
      summary: "원자재 자료가 확인되지 않았다.",
      desc: "원자재 자료가 확보되지 않아 인플레이션 측면 해석을 보류한다."
    };
  }

  if ((wti.percentChange ?? 0) > 2) {
    return {
      label: "유가 상승",
      summary: "국제유가는 상승 압력이 두드러졌다.",
      desc: "유가의 빠른 상승은 기대 인플레이션을 자극해 장기금리 상단 부담으로 이어질 가능성이 있다."
    };
  }

  if ((wti.percentChange ?? 0) < -2) {
    return {
      label: "유가 하락",
      summary: "국제유가는 하락 흐름을 나타냈다.",
      desc: "유가 하락은 장기금리 상승 압력과 물가 우려를 한 단계 진정시키는 요인으로 작용한다."
    };
  }

  return {
    label: "유가 안정",
    summary: "국제유가는 좁은 범위에서 등락했다.",
    desc: "유가는 단일 방향의 강한 신호라기보다 다른 매크로 변수와 함께 해석할 보조 지표로 평가된다."
  };
}

function buildRiskRegime(equityProfile, vixProfile, tenYearProfile) {
  const vixElevated = vixProfile.label === "변동성 상승" || vixProfile.label === "변동성 확대";

  if (equityProfile.tone === "강세" && !vixElevated) {
    if (tenYearProfile.direction === "상승" && tenYearProfile.label !== "장기금리 완화") {
      return {
        id: "risk-on-rate-pressure",
        label: "주가 강세 속 장기금리 부담",
        shortLabel: "강세+금리부담",
        lead: "미국 증시가 강세 흐름을 보였으나 장기금리 부담도 동반됐다.",
        desc: "주가지수가 상승했지만 장기금리 재상승이 동반되면서 추가 밸류에이션 확장보다는 기업 이익 모멘텀에 대한 검증이 더 중요해진 국면이다."
      };
    }

    return {
      id: "risk-on",
      label: "위험자산 선호 강화",
      shortLabel: "위험선호강화",
      lead: "미국 증시는 강세 흐름으로 마감했다.",
      desc: "주가 강세와 변동성 안정이 동반되면서 투자심리가 개선된 흐름이 나타났다."
    };
  }

  if (equityProfile.tone === "약세" && vixElevated) {
    return {
      id: "risk-off",
      label: "안전자산 선호 강화",
      shortLabel: "안전자산선호",
      lead: "미국 증시는 약세를 나타내며 방어 심리가 강해졌다.",
      desc: "주가 약세에 변동성 확대가 더해지면서 방어적 자산 배분 흐름이 두드러졌다."
    };
  }

  if (equityProfile.tone === "강세" && vixElevated) {
    return {
      id: "split-risk",
      label: "강세 속 경계감 잔존",
      shortLabel: "강세속경계",
      lead: "주가지수는 올랐지만 경계감도 함께 남았다.",
      desc: "주가가 상승했음에도 변동성이 높아 기술적 반등의 지속성을 추가로 확인해야 하는 국면이다."
    };
  }

  if (equityProfile.tone === "약세" && vixProfile.label === "변동성 안정") {
    return {
      id: "soft-pullback",
      label: "완만한 조정",
      shortLabel: "완만한 조정",
      lead: "미국 증시는 완만한 조정을 받았다.",
      desc: "주가는 밀렸지만 변동성 급등은 동반되지 않아 구조적 흐름의 훼손보다 속도 조절 성격이 강한 것으로 평가된다."
    };
  }

  return {
    id: "mixed",
    label: "방향성 혼조",
    shortLabel: "혼조",
    lead: "미국 증시는 뚜렷한 한 방향보다 혼조 흐름에 가까웠다.",
    desc: "지수, 금리, 변동성 신호의 정렬이 약해 단기 해석을 서두르기 어려운 국면이다."
  };
}

function publicConfidenceLabel(confidence) {
  if (confidence === "high") {
    return "자료 상태 양호";
  }

  if (confidence === "medium") {
    return "보조지표 확인 필요";
  }

  return "핵심지표 확인 필요";
}

function publicPublicationLabel(status) {
  if (status === "ready") {
    return "정상 발행";
  }

  if (status === "caution") {
    return "일부 지표 지연 반영";
  }

  return "자동 발행 보류 검토";
}

function buildQualitySignal(snapshot) {
  const analysisQuality = snapshot.analysis?.dataQuality;

  if (analysisQuality) {
    return {
      score: analysisQuality.score,
      confidence: analysisQuality.confidence,
      confidenceLabel: publicConfidenceLabel(analysisQuality.confidence),
      publicationStatus: analysisQuality.publicationStatus,
      publicationLabel: publicPublicationLabel(analysisQuality.publicationStatus),
      warnings: analysisQuality.warnings || []
    };
  }

  const status = snapshot.freshnessSummary?.status || "healthy";
  const confidence = status === "attention" ? "low" : status === "watch" ? "medium" : "high";
  const publicationStatus = status === "attention" ? "caution" : "ready";
  return {
    score: null,
    confidence,
    confidenceLabel: publicConfidenceLabel(confidence),
    publicationStatus,
    publicationLabel: publicPublicationLabel(publicationStatus),
    warnings: []
  };
}

function buildNewsBrief(newsDigest) {
  if (!newsDigest) {
    return null;
  }

  const topItems = (newsDigest.topItems || []).slice(0, 8).map((item) => ({
    title: item.title,
    koreanTitle: item.koreanTitle || null,
    koreanSummary: item.koreanSummary || null,
    source: item.source,
    sourceKorean: item.sourceKorean || null,
    category: item.category,
    categoryLabel: item.categoryLabel,
    publishedAt: item.publishedAt,
    link: item.link,
    importance: item.importance
  }));
  const themes = (newsDigest.themes || []).slice(0, 4).map((theme) => ({
    category: theme.category,
    label: theme.label,
    summary: theme.summary,
    koreanSummary: theme.koreanSummary || null,
    items: (theme.items || []).slice(0, 3).map((item) => ({
      title: item.title,
      koreanTitle: item.koreanTitle || null,
      koreanSummary: item.koreanSummary || null,
      source: item.source,
      sourceKorean: item.sourceKorean || null,
      publishedAt: item.publishedAt,
      link: item.link
    }))
  }));

  return {
    generatedAt: newsDigest.generatedAt,
    reportDate: newsDigest.reportDate,
    editorialSummary: newsDigest.editorialSummary,
    koreanEditorialSummary: newsDigest.koreanEditorialSummary || null,
    sourceHealth: newsDigest.sourceHealth,
    themes,
    topItems
  };
}

function buildAnalysis(snapshot) {
  const sp = getItem(snapshot, "SP500");
  const nasdaq = getItem(snapshot, "NASDAQCOM");
  const dow = getItem(snapshot, "DJIA");
  const tenYear = getItem(snapshot, "DGS10");
  const twoYear = getItem(snapshot, "DGS2");
  const fedFunds = getItem(snapshot, "DFF");
  const curve = getItem(snapshot, "UST10Y_UST2Y_SPREAD");
  const vix = getItem(snapshot, "VIXCLS");
  const usdKrw = getItem(snapshot, "DEXKOUS");
  const dollarIndex = getItem(snapshot, "DTWEXBGS");
  const wti = getItem(snapshot, "DCOILWTICO");
  const freshness = snapshot.freshnessSummary;
  const equityProfile = buildEquityProfile(snapshot);
  const vixProfile = classifyVix(vix);
  const curveProfile = classifyCurve(curve);
  const tenYearProfile = classifyTenYear(tenYear, fedFunds);
  const fxProfile = buildFxNarrative(usdKrw, dollarIndex, freshness);
  const oilProfile = buildOilNarrative(wti, freshness);
  const riskRegime = buildRiskRegime(equityProfile, vixProfile, tenYearProfile);
  const staleLead = freshness.items[0];
  const policyGapLine = tenYearProfile.policyGap === null
    ? "정책금리와 시장금리의 상대 위치는 확인되지 않았다."
    : `미 국채 10년물 금리는 유효 연방기금금리(EFFR)보다 ${formatPercentPoint(tenYearProfile.policyGap, 2)} 높아 장기 자금 조달 부담이 남아 있다.`;

  const observedSummary = `${riskRegime.lead} S&P500지수가 ${formatPercent(sp?.percentChange, 2)}, 나스닥 종합지수가 ${formatPercent(nasdaq?.percentChange, 2)}, 다우존스30 산업평균지수가 ${formatPercent(dow?.percentChange, 2)} 변동하며 ${equityProfile.leadershipLabel} 흐름이 나타났다.`;
  const ratesSummary = `미 국채 10년물 금리는 ${formatValue(tenYear)}, 2년물 금리는 ${formatValue(twoYear)}, 장단기 금리차는 ${formatPercentPoint(curve?.latestValue, 2)}를 기록하며 ${curveProfile.label} 구간을 유지했다.`;
  const crossAssetSummary = `변동성지수(VIX)는 ${formatValue(vix)}로 ${vixProfile.label} 흐름을 보였다. ${fxProfile.summary} ${oilProfile.summary}`;
  const interpretationSummary = `${riskRegime.desc} ${tenYearProfile.desc} ${policyGapLine}`;
  const cautionSummary = staleLead
    ? `기준일이 가장 늦은 항목은 ${staleLead.label}(${staleLead.observationDate}, ${staleLead.freshnessLabel})이다. 해당 시계열은 보충 시세와 함께 해석해야 한다.`
    : "이번 브리핑의 주요 시계열은 허용 범위 안의 기준일을 유지해 자료 기반 해석에 큰 제약이 없다.";
  const koreaAngle = staleLead && (staleLead.id === "DEXKOUS" || staleLead.id === "DTWEXBGS")
    ? "원화·달러 시계열의 기준일이 늦어 한국 시장 외환 해석은 미 증시·금리 방향을 우선 축으로 두고 보충 시세를 함께 점검하는 접근이 필요하다."
    : `${fxProfile.desc} ${oilProfile.desc}`;
  const executionNote = riskRegime.id === "risk-on-rate-pressure"
    ? "주가 강세만 보고 추격하기보다 장기금리 상단과 주도주의 흐름이 함께 유지되는지 확인하는 접근이 유리하다."
    : riskRegime.id === "risk-off"
      ? "방어 심리가 강해진 국면에서는 단기 반등 시도보다 변동성 완화 여부를 먼저 확인하는 것이 합리적이다."
      : "지수, 금리, 변동성 신호가 엇갈린 국면에서는 단일 지표에 과민 반응하기보다 정렬 여부를 재확인하는 것이 우선이다.";

  const watchList = [
    `${equityProfile.leader?.label ?? "주도 지수"}의 상대 강도가 다음 거래일에도 유지되는지 확인`,
    tenYearProfile.direction === "상승"
      ? "장기금리 상단 압력의 추가 확장 여부 확인"
      : tenYearProfile.direction === "하락"
        ? "장기금리 완화 흐름의 지속성 확인"
        : "장기금리 정체 흐름의 변곡 신호 확인",
    staleLead
      ? `${staleLead.label}의 보충 시세 갱신 여부와 추가 확인`
      : "외환·원자재가 주식·금리 방향과 같은 축으로 정렬되는지 확인"
  ];

  return {
    sp,
    nasdaq,
    dow,
    tenYear,
    twoYear,
    fedFunds,
    curve,
    vix,
    usdKrw,
    dollarIndex,
    wti,
    equityProfile,
    vixProfile,
    curveProfile,
    tenYearProfile,
    fxProfile,
    oilProfile,
    riskRegime,
    observedSummary,
    ratesSummary,
    crossAssetSummary,
    interpretationSummary,
    cautionSummary,
    koreaAngle,
    executionNote,
    watchList
  };
}

function buildTitle(snapshot, analysis) {
  const ratePhrase = analysis.tenYearProfile.direction === "상승"
    ? "장기금리 재상승"
    : analysis.tenYearProfile.direction === "하락"
      ? "장기금리 완화"
      : "장기금리 정체";

  if (analysis.riskRegime.id === "risk-on-rate-pressure") {
    return `${analysis.equityProfile.leadershipShort} 강세, ${ratePhrase} 부담 점검`;
  }

  if (analysis.riskRegime.id === "risk-on") {
    return `${analysis.equityProfile.leadershipShort} 강세, 변동성 안정`;
  }

  if (analysis.riskRegime.id === "risk-off") {
    return `방어 심리 강화, ${analysis.equityProfile.leadershipShort} · 변동성 확대 점검`;
  }

  return `${analysis.riskRegime.shortLabel}, ${analysis.equityProfile.leadershipShort} · ${ratePhrase} 점검`;
}

function buildOvernightLead(snapshot, analysis, newsBrief) {
  const newsLine = newsBrief?.editorialSummary ? ` ${newsBrief.editorialSummary}` : "";
  return `${analysis.observedSummary} ${analysis.interpretationSummary} ${analysis.cautionSummary}${newsLine}`;
}

function buildInsightSections(snapshot, analysis, newsBrief) {
  const topStory = [
    {
      title: "시장 흐름",
      desc: analysis.riskRegime.desc
    },
    {
      title: analysis.equityProfile.leadershipLabel,
      desc: analysis.equityProfile.leadershipDesc
    }
  ];
  const watchNow = [
    {
      title: "지금 확인할 변수",
      desc: analysis.watchList.join(" / ")
    },
    {
      title: "자료 기준일",
      desc: analysis.cautionSummary
    }
  ];

  if (newsBrief?.themes?.[0]) {
    topStory.push({
      title: "주요 뉴스",
      desc: newsBrief.themes[0].summary
    });
  }

  if (newsBrief?.sourceHealth) {
    watchNow.push({
      title: "뉴스 출처 상태",
      desc: `수집 성공 ${newsBrief.sourceHealth.okCount}개, 실패 ${newsBrief.sourceHealth.failedCount}개입니다. 실패 출처는 리포트 하단에서 따로 확인합니다.`
    });
  }

  return {
    topStory,
    marketReaction: [
      {
        title: "금리와 곡선",
        desc: `${analysis.ratesSummary} ${analysis.tenYearProfile.desc}`
      },
      {
        title: "변동성, 달러, 원자재",
        desc: `${analysis.crossAssetSummary} ${analysis.fxProfile.desc} ${analysis.oilProfile.desc}`
      }
    ],
    watchNow,
    positioning: [
      {
        title: "한국장 시사점",
        desc: analysis.koreaAngle
      },
      {
        title: "실행 메모",
        desc: analysis.executionNote
      }
    ]
  };
}

function buildTags(snapshot, analysis, newsBrief) {
  const quality = buildQualitySignal(snapshot);
  const qualityTag = quality.confidence === "high"
    ? "자료양호"
    : quality.confidence === "medium"
      ? "보조지표확인"
      : "핵심지표확인";
  const publicationTag = quality.publicationStatus === "ready"
    ? "정상발행"
    : quality.publicationStatus === "caution"
      ? "지표지연반영"
      : "발행보류검토";
  const tags = ["FRED", "데이터기반", "미국증시", "금리", qualityTag, publicationTag];

  if (analysis.riskRegime.shortLabel) {
    tags.push(analysis.riskRegime.shortLabel);
  }

  if (analysis.equityProfile.leadershipLabel) {
    tags.push(analysis.equityProfile.leadershipLabel);
  }

  if (analysis.tenYearProfile.direction === "상승") {
    tags.push("장기금리상승");
  } else if (analysis.tenYearProfile.direction === "하락") {
    tags.push("장기금리완화");
  }

  if (snapshot.freshnessSummary.delayedCount > 0) {
    tags.push("지연데이터");
  }

  if (snapshot.freshnessSummary.staleCount > 0) {
    tags.push("기준일주의");
  }

  if (newsBrief?.topItems?.length > 0) {
    tags.push("뉴스결합");
  }

  return [...new Set(tags)].slice(0, 7);
}

function buildBriefingRecord(snapshot, reportDate, analysis, newsBrief) {
  const title = buildTitle(snapshot, analysis);
  const quality = buildQualitySignal(snapshot);

  return {
    date: reportDate,
    title,
    highlights: [
      analysis.observedSummary,
      analysis.ratesSummary,
      analysis.crossAssetSummary,
      newsBrief?.editorialSummary
    ].filter(Boolean),
    tags: buildTags(snapshot, analysis, newsBrief),
    file: `./posts/${reportDate}.md`,
    indices: {
      sp: analysis.sp ? { level: formatNumber(analysis.sp.latestValue, analysis.sp.decimals ?? 2), chg: `${signed(analysis.sp.percentChange, 2)}%` } : { level: "—", chg: "N/A" },
      nasdaq: analysis.nasdaq ? { level: formatNumber(analysis.nasdaq.latestValue, analysis.nasdaq.decimals ?? 2), chg: `${signed(analysis.nasdaq.percentChange, 2)}%` } : { level: "—", chg: "N/A" },
      dow: analysis.dow ? { level: formatNumber(analysis.dow.latestValue, analysis.dow.decimals ?? 2), chg: `${signed(analysis.dow.percentChange, 2)}%` } : { level: "—", chg: "N/A" }
    },
    overnightLead: buildOvernightLead(snapshot, analysis, newsBrief),
    insightSections: buildInsightSections(snapshot, analysis, newsBrief),
    freshnessSummary: snapshot.freshnessSummary,
    quality,
    newsBrief
  };
}

function buildMarkdown(snapshot, reportDate, record, analysis) {
  const quality = record.quality;
  const newsBrief = record.newsBrief;
  const lines = [];

  lines.push(`FRED 기반 데이터 브리핑 (${reportDate} KST)`);
  lines.push("");
  lines.push(record.title);
  lines.push("");
  lines.push(`시장 흐름: ${analysis.riskRegime.label}`);
  lines.push(`자료 상태: ${quality.confidenceLabel}${quality.score !== null ? ` / 점검 점수 ${quality.score}/100` : ""}`);
  lines.push(`보고서 상태: ${quality.publicationLabel}`);
  lines.push("");
  lines.push("## 핵심 결론");
  lines.push(`- [관찰] ${analysis.observedSummary}`);
  lines.push(`- [해석] ${analysis.interpretationSummary}`);
  lines.push(`- [확인] ${analysis.cautionSummary}`);
  lines.push("");
  lines.push("## 오늘의 시장 흐름");
  lines.push(`### 시장 분위기`);
  lines.push(`- ${analysis.riskRegime.desc}`);
  lines.push(`- 평균 지수 등락률은 ${signed(analysis.equityProfile.averageMove, 2)}%이며, 주도 축은 ${analysis.equityProfile.leadershipLabel}입니다.`);
  lines.push("");
  lines.push("### 금리와 곡선");
  lines.push(`- ${analysis.ratesSummary}`);
  lines.push(`- ${analysis.tenYearProfile.desc}`);
  lines.push(`- 곡선은 ${analysis.curveProfile.direction} 흐름으로, ${analysis.curveProfile.desc}`);
  lines.push("");
  lines.push("### 변동성과 보조 자산");
  lines.push(`- ${analysis.crossAssetSummary}`);
  lines.push(`- ${analysis.vixProfile.desc}`);
  lines.push(`- ${analysis.fxProfile.desc}`);
  lines.push(`- ${analysis.oilProfile.desc}`);
  lines.push("");
  lines.push("## 한국장 시사점");
  lines.push(`- ${analysis.koreaAngle}`);
  lines.push(`- ${analysis.executionNote}`);
  lines.push("");
  lines.push("## 오늘 확인할 변수");
  analysis.watchList.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push("");

  lines.push("## 주요 뉴스와 이벤트");
  if (!newsBrief || newsBrief.topItems.length === 0) {
    lines.push("- 수집 가능한 뉴스가 부족해 이번 본문은 지표 해설 중심으로 작성했습니다.");
  } else {
    lines.push(`- ${newsBrief.editorialSummary}`);
    newsBrief.themes.forEach((theme) => {
      lines.push(`### ${theme.label}`);
      lines.push(`- ${theme.summary}`);
      theme.items.forEach((item) => {
        lines.push(`- ${item.title} (${item.source}, ${formatNewsDate(item.publishedAt)})`);
      });
      lines.push("");
    });
  }

  lines.push("## 자료 기준일과 해석 범위");
  if (quality.warnings.length > 0) {
    quality.warnings.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }
  if (snapshot.freshnessSummary.items.length === 0) {
    lines.push("- 지연되거나 오래된 시계열이 없어 자료 기반 해석에 큰 제약이 없다.");
  } else {
    lines.push("- 아래 항목은 기준일이 늦어 보충 시세를 함께 확인해 해석한다.");
    snapshot.freshnessSummary.items.forEach((item) => {
      lines.push(`- ${item.label}: 기준일 ${item.observationDate}, ${item.freshnessLabel}`);
    });
  }
  lines.push("");
  lines.push("## 원시 지표 스냅샷");
  snapshot.groups.forEach((group) => {
    lines.push(`### ${group.label}`);
    group.items.forEach((item) => {
      lines.push(`- ${item.label}: ${formatValue(item)} / 변화 ${formatDelta(item)} / 기준일 ${item.observationDate} / ${item.freshness.label}`);
    });
    lines.push("");
  });
  lines.push("## 메모와 소스");
  lines.push("- 본문은 FRED 시계열의 관찰값과 공개 RSS/뉴스 검색 헤드라인을 바탕으로 자동 생성한 데이터 해설입니다.");
  if (newsBrief?.sourceHealth) {
    lines.push(`- 뉴스 수집 상태: 성공 ${newsBrief.sourceHealth.okCount}개, 실패 ${newsBrief.sourceHealth.failedCount}개.`);
  }
  snapshot.notes.forEach((item) => {
    lines.push(`- ${item}`);
  });

  return `${lines.join("\n")}\n`;
}

async function readBriefings() {
  try {
    return JSON.parse(await readFile(BRIEFINGS_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readNewsDigest(reportDate) {
  try {
    const digest = JSON.parse(await readFile(NEWS_DIGEST_PATH, "utf8"));
    if (!digest || digest.reportDate !== reportDate) {
      return null;
    }

    return digest;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const reportDate = snapshot.reportDate;
  const newsBrief = buildNewsBrief(await readNewsDigest(reportDate));
  const analysis = buildAnalysis(snapshot);
  const record = buildBriefingRecord(snapshot, reportDate, analysis, newsBrief);
  const markdown = buildMarkdown(snapshot, reportDate, record, analysis);
  const markdownPath = path.join(POSTS_DIR, `${reportDate}.md`);

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(markdownPath, markdown, "utf8");

  const existing = await readBriefings();
  const next = [record, ...existing.filter((item) => item.date !== reportDate)].sort((a, b) => b.date.localeCompare(a.date));
  await mkdir(path.dirname(BRIEFINGS_PATH), { recursive: true });
  await writeFile(BRIEFINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  console.log(`Wrote markdown briefing to ${markdownPath}`);
  console.log(`Updated briefing index at ${BRIEFINGS_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
