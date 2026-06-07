// Fill the latest briefing with deterministic structured sections when LLM rewrite is unavailable.
// This keeps report.html complete even if Gemini free-tier quota is exhausted.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatReportCalendarLine } from "./lib/report-calendar.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const NEWS_PATH = path.join(ROOT, "data", "news-digest.json");
const POSTS_DIR = path.join(ROOT, "posts");

const TRUSTED_NEWS_SOURCES = new Set([
  "Federal Reserve",
  "Fed Speeches",
  "MarketWatch",
  "Reuters",
  "Bloomberg",
  "The Wall Street Journal",
  "WSJ",
  "CNBC",
  "Investing.com",
  "연방준비제도",
  "연준 연설",
  "마켓워치",
  "로이터",
  "블룸버그",
  "월스트리트저널"
]);
const SENSITIVE_NEWS_PATTERNS = [
  /\bwarsh-led fed\b/i,
  /\b(?:warsh|powell replacement|fed chair|fed chairman|fomc chair).{0,90}\b(?:appoint|appointed|appointment|nominate|nominated|nomination|name|named|elect|elected|select|selected|lead|led)\b/i,
  /\bwarsh.{0,140}(?:federal reserve|fomc|federal open market committee|board of governors).{0,140}(?:chair|chairman)\b/i,
  /\bwarsh.{0,140}(?:takes oath|selected|selects|chairman)\b/i,
  /(케빈\s*워시|워시).{0,80}(연준|연방준비제도|FOMC).{0,80}(의장|임명|선출|지명)/u,
  /(연준|연방준비제도).{0,30}의장.{0,30}(임명|선출|지명)/u
];

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function bp(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)}bp`;
}

function flatMetrics(snapshot) {
  return (snapshot.groups || []).flatMap((group) =>
    (group.items || []).map((item) => ({ ...item, groupLabel: group.label }))
  );
}

function pick(metrics, id) {
  return metrics.find((item) => item.id === id) || {};
}

function newsText(item) {
  return [item?.title, item?.koreanTitle, item?.description, item?.summary, item?.koreanSummary]
    .filter(Boolean)
    .join(" ");
}

function isTrustedNewsItem(item) {
  if (item?.sourceType === "official" || item?.credibility === "official" || item?.credibility === "established") return true;
  return TRUSTED_NEWS_SOURCES.has(item?.sourceKorean || item?.source || "");
}

function isSafeNewsItem(item) {
  if (item?.usePolicy === "withhold_from_llm" || item?.claimRisk === "high") return false;
  const sensitive = SENSITIVE_NEWS_PATTERNS.some((pattern) => pattern.test(newsText(item)));
  return !sensitive || isTrustedNewsItem(item);
}

function sanitizeNewsBrief(news) {
  if (!news) {
    return {
      koreanEditorialSummary: "뉴스 요약은 품질 게이트 통과 항목이 부족해 지표 중심으로 해석한다.",
      topItems: [],
      themes: [],
      sourceHealth: null
    };
  }
  const topItems = (news.topItems || []).filter(isSafeNewsItem).slice(0, 8);
  const themes = (news.themes || [])
    .map((theme) => {
      const items = (theme.items || []).filter(isSafeNewsItem).slice(0, 5);
      const lead = items[0];
      const leadTitle = lead?.koreanTitle || lead?.title || "품질 게이트 통과 항목";
      return {
        ...theme,
        summary: `${theme.label || "뉴스"} 흐름은 '${leadTitle}' 중심으로 제한해 해석한다.`,
        koreanSummary: theme.koreanSummary && !SENSITIVE_NEWS_PATTERNS.some((pattern) => pattern.test(theme.koreanSummary))
          ? theme.koreanSummary
          : `${theme.label || "뉴스"} 흐름은 품질 게이트를 통과한 항목만 반영한다.`,
        items
      };
    })
    .filter((theme) => theme.items.length > 0)
    .slice(0, 5);

  return {
    koreanEditorialSummary: news.koreanEditorialSummary || news.editorialSummary || "뉴스 요약은 지표와 함께 보조적으로 해석한다.",
    topItems,
    themes,
    sourceHealth: news.sourceHealth || null,
    guardrails: {
      sanitizedAt: new Date().toISOString(),
      omittedCount: (news.topItems || []).length - topItems.length
    }
  };
}

function fallbackTitle(snapshot, sp, nasdaq, ten, vix) {
  if (sp.percentChange > 0 && nasdaq.percentChange > 0) {
    return `광범위한 동행 강세, 장기금리 ${fmt(ten.latestValue, 2)}% 부담 점검`;
  }
  if (sp.percentChange < 0 && nasdaq.percentChange < 0) {
    return `미 증시 동반 약세, 금리와 변동성 부담 점검`;
  }
  return snapshot.headline || `혼합 장세, 10년물 ${fmt(ten.latestValue, 2)}% · VIX ${fmt(vix.latestValue, 2)}`;
}

function buildFields(snapshot, briefing, newsDigest) {
  const metrics = flatMetrics(snapshot);
  const sp = pick(metrics, "SP500");
  const nasdaq = pick(metrics, "NASDAQCOM");
  const dow = pick(metrics, "DJIA");
  const kospi = pick(metrics, "KOSPI");
  const kosdaq = pick(metrics, "KOSDAQ");
  const ten = pick(metrics, "DGS10");
  const two = pick(metrics, "DGS2");
  const spread = pick(metrics, "UST10Y_UST2Y_SPREAD");
  const vix = pick(metrics, "VIXCLS");
  const krw = pick(metrics, "DEXKOUS");
  const wti = pick(metrics, "DCOILWTICO");
  const newsBrief = sanitizeNewsBrief(newsDigest || briefing.newsBrief);
  const topNews = newsBrief.topItems?.[0];

  const title = fallbackTitle(snapshot, sp, nasdaq, ten, vix);
  const overnightLead = `미국 증시는 S&P500지수 ${pct(sp.percentChange)}, 나스닥 종합지수 ${pct(nasdaq.percentChange)}, 다우존스30 산업평균지수 ${pct(dow.percentChange)}로 마감했다. 미 국채 10년물 금리는 ${fmt(ten.latestValue, 2)}%를 기록해 주가 강세와 금리 부담이 동시에 남은 장세다. 변동성지수(VIX)는 ${fmt(vix.latestValue, 2)}로 20선 아래에 있어 급격한 위험 회피는 제한적이었다. 다만 달러/원과 원자재 일부 시계열은 기준일이 늦어 핵심 인과보다 보조 참고로만 다룬다.`;
  const topThreeLines = [
    `미국 3대 지수는 S&P500지수 ${pct(sp.percentChange)}, 나스닥 종합지수 ${pct(nasdaq.percentChange)}, 다우존스30 산업평균지수 ${pct(dow.percentChange)}로 마감했다.`,
    `미 국채 10년물 금리는 ${fmt(ten.latestValue, 2)}%, 2년물 금리는 ${fmt(two.latestValue, 2)}%이며 10년-2년 금리차는 ${fmt(spread.latestValue, 2)}%p를 기록했다.`,
    `한국시장 보조 시세는 코스피 ${fmt(kospi.latestValue, 2)}, 코스닥 ${fmt(kosdaq.latestValue, 2)}다. 달러/원 FRED 기준일은 ${krw.observationDate || "-"}로 지연 상태다.`
  ];

  const keyIssues = [
    {
      title: "미국 3대 지수 동반 움직임",
      whatHappened: `S&P500지수는 ${fmt(sp.latestValue, 2)}로 ${pct(sp.percentChange)} 움직였고, 나스닥 종합지수는 ${fmt(nasdaq.latestValue, 2)}로 ${pct(nasdaq.percentChange)} 변동했다. 다우존스30 산업평균지수는 ${fmt(dow.latestValue, 2)}로 ${pct(dow.percentChange)}를 기록했다.`,
      whyMarketReacted: "주요 지수가 같은 방향으로 움직이면 단기 위험 선호가 회복됐다는 뜻이다. 다만 금리도 함께 오르는 구간에서는 상승의 지속성이 기업 이익과 주도 업종 확산에 더 크게 좌우된다.",
      whatToWatch: `나스닥 종합지수 ${fmt(nasdaq.latestValue, 0)}선과 S&P500지수 ${fmt(sp.latestValue, 0)}선 유지 여부를 먼저 확인한다.`
    },
    {
      title: "장기금리 상단 재확인",
      whatHappened: `미 국채 10년물 금리는 ${fmt(ten.latestValue, 2)}%로 전일 대비 ${bp(ten.absoluteChange)} 움직였다. 2년물은 ${fmt(two.latestValue, 2)}%, 10년-2년 금리차는 ${fmt(spread.latestValue, 2)}%p다.`,
      whyMarketReacted: "장기금리 상승은 경기 기대와 기간 보상의 재평가를 반영한다. 동시에 성장주 평가에는 제약으로 작용하므로 주가 상승과 금리 상승이 공존하는 구간에서는 지수보다 업종 확산을 확인해야 한다.",
      whatToWatch: "미 10년물 4.70% 상향 돌파 여부와 4.50% 하향 안정 여부를 함께 본다."
    },
    {
      title: "변동성은 20선 아래",
      whatHappened: `변동성지수(VIX)는 ${fmt(vix.latestValue, 2)}로 전일 대비 ${pct(vix.percentChange)} 움직였다.`,
      whyMarketReacted: "VIX가 20선 아래에 있으면 급격한 방어 심리는 제한적이다. 그러나 금리와 원자재 가격이 높은 구간에서는 작은 재료에도 헤지 수요가 다시 늘 수 있다.",
      whatToWatch: "VIX 20선 재돌파, 미 10년물 4.70% 부근 반응, 주요 지수의 장중 저점 이탈 여부를 함께 확인한다."
    },
    {
      title: "한국시장 강세와 환율 기준일 지연",
      whatHappened: `코스피 보조 시세는 ${fmt(kospi.latestValue, 2)}, 코스닥은 ${fmt(kosdaq.latestValue, 2)}로 집계됐다. 달러/원 FRED 시계열은 ${fmt(krw.latestValue, 2)}원, 기준일은 ${krw.observationDate || "-"}다.`,
      whyMarketReacted: "미국 지수 강세와 한국 지수 보조 시세가 같은 방향을 가리킨다. 다만 원화 관련 FRED 데이터가 지연돼 외국인 매매와 환율 해석은 보수적으로 처리해야 한다.",
      whatToWatch: "달러/원은 기준일 지연 상태이므로 1,480원과 1,500원을 보조 확인선으로 두고, 코스피 외국인 순매수 전환과 반도체 대형주의 상대 강도를 동시에 점검한다."
    },
    {
      title: "정책 뉴스는 연준 의사록과 인플레이션 경로에 집중",
      whatHappened: topNews
        ? `뉴스 우선순위는 ${topNews.sourceKorean || topNews.source || "주요 출처"}의 '${topNews.koreanTitle || topNews.title}'가 가장 높게 잡혔다.`
        : "뉴스 수집은 정책/연준, 매크로 지표, 시장 반응 항목을 중심으로 분류됐다.",
      whyMarketReacted: "연준 의사록과 물가 관련 뉴스는 하루 가격보다 향후 금리 경로와 금융 여건을 재평가하게 만드는 재료다.",
      whatToWatch: "다음 연준 발언에서 물가 목표, 추가 긴축 가능성, 금융 여건 평가 문구가 반복되는지 확인한다."
    }
  ];

  return {
    title,
    headline: title,
    overnightLead,
    topThreeLines,
    highlights: [
      `미 3대 지수 동행: S&P500 ${pct(sp.percentChange)}, 나스닥 ${pct(nasdaq.percentChange)}, 다우 ${pct(dow.percentChange)}.`,
      `미 10년물 ${fmt(ten.latestValue, 2)}%, 2년물 ${fmt(two.latestValue, 2)}%로 금리 상단 확인 필요.`,
      `VIX ${fmt(vix.latestValue, 2)}로 20선 아래, 단기 위험 회피는 제한적.`,
      `달러/원·원자재 시계열은 기준일 지연으로 보조 참고에 한정.`
    ],
    keyIssues,
    marketSnapshot: {
      indices: `S&P500지수 ${pct(sp.percentChange)}, 나스닥 종합지수 ${pct(nasdaq.percentChange)}, 다우존스30 산업평균지수 ${pct(dow.percentChange)}로 3대 지수가 움직였다.`,
      rates: `미 10년물 ${fmt(ten.latestValue, 2)}%, 2년물 ${fmt(two.latestValue, 2)}%, 10년-2년 금리차 ${fmt(spread.latestValue, 2)}%p다.`,
      volatility: `VIX는 ${fmt(vix.latestValue, 2)}로 20선 아래에 있다.`,
      sectors: "섹터별 상세 등락은 별도 보강 데이터가 없으면 단정하지 않는다. 기술주와 반도체는 나스닥 흐름을 통해 간접 확인한다.",
      fxCommodities: `달러/원은 FRED 기준 ${fmt(krw.latestValue, 2)}원, WTI는 ${fmt(wti.latestValue, 2)}달러다. 두 항목 모두 기준일 지연을 감안해 보조 참고로 제한한다.`
    },
    koreanCheckpoints: [
      `코스피는 ${fmt(kospi.latestValue, 2)} 기준으로 미국 기술주 강세가 반도체 대형주까지 이어지는지 확인한다.`,
      `달러/원은 FRED 기준 ${fmt(krw.latestValue, 2)}원이며 데이터 기준일이 ${krw.observationDate || "-"}로 늦다. 1,480원과 1,500원을 한국시장 해석의 1차 범위로 둔다.`,
      `미 10년물 ${fmt(ten.latestValue, 2)}%가 4.70% 위로 확장되면 2차전지, 바이오, 인터넷/플랫폼 등 장기 성장 업종의 변동성 확대 가능성을 점검한다.`
    ],
    positioning: {
      mainScenario: {
        view: "주가 강세는 인정하되 장기금리 상단을 함께 확인하는 중립적 위험자산 우위",
        reasoning: `미국 3대 지수가 같은 방향으로 움직였고 VIX가 ${fmt(vix.latestValue, 2)}로 20선 아래에 있다. 다만 미 10년물 금리가 ${fmt(ten.latestValue, 2)}%까지 올라 금리 상단 확인이 필요하다.`,
        pros: "지수 동반 상승, 나스닥 상대 강세, 코스피·코스닥 보조 시세 강세가 우호 요인이다.",
        cons: "장기금리 상승, 환율 데이터 지연, 원자재 지표 지연이 판단의 제약 요인이다.",
        triggers: [`나스닥 ${fmt(nasdaq.latestValue, 0)}선 유지`, "VIX 20선 이하", "미 10년물 4.70% 이하 안정"],
        executionHint: "추격 매수보다 주도 업종의 장중 유지력과 금리 반응을 확인한 뒤 비중을 조절한다."
      },
      altScenario: {
        condition: "미 10년물 4.70% 상향 돌파와 VIX 20선 재진입이 동시에 나타나는 경우",
        view: "지수 상승에도 방어적 포지션을 늘리는 대체 시나리오",
        reasoning: "금리와 변동성이 동시에 높아지면 성장주 중심의 상승 탄력이 약해지고 한국시장에서는 외국인 매매와 환율 민감도가 커질 수 있다.",
        triggers: ["미 10년물 4.70% 상회", "VIX 20선 재돌파", "달러/원 기준일 지연 해소 후 1,500원 상회"],
        executionHint: "반도체 주도력이 약해지는지 먼저 확인하고, 민감 업종보다 현금흐름 안정 업종의 상대 강도를 본다."
      }
    },
    commentary: [
      `오늘 리포트의 핵심은 주가와 장기금리가 동시에 움직였다는 점이다. S&P500지수와 나스닥 종합지수, 다우존스30 산업평균지수가 같은 방향으로 움직였지만 미 10년물 금리도 ${fmt(ten.latestValue, 2)}%를 기록했다. 이는 시장이 경기와 실적 기대를 반영하면서도 자금 조달 비용의 상단을 다시 시험하고 있음을 뜻한다.`,
      `한국시장 관점에서는 미국 기술주 강세가 반도체와 성장 업종에 우호적이다. 다만 달러/원 FRED 시계열 기준일이 ${krw.observationDate || "-"}로 늦어 외환 해석은 보조 시세와 함께 확인해야 한다. 코스피 ${fmt(kospi.latestValue, 2)}와 코스닥 ${fmt(kosdaq.latestValue, 2)}라는 보조 시세는 강세를 가리키지만, 환율 안정이 동반되지 않으면 상승 지속성은 약해질 수 있다.`,
      `뉴스 흐름은 연준 의사록과 인플레이션 경로로 모인다. 당장 하루 가격을 결정하는 단일 재료보다 금리 경로와 금융 여건을 재평가하게 만드는 재료가 많다. 따라서 오늘의 결론은 강세 추종이 아니라 금리 상단, 환율, 주도 업종 확산 여부를 함께 확인하는 쪽에 가깝다.`
    ],
    causalAnalysis: [
      {
        title: "주가 강세와 금리 부담의 공존",
        desc: `S&P500지수와 나스닥 종합지수가 동반 상승했지만 미 10년물 금리는 ${fmt(ten.latestValue, 2)}%에 머물렀다. 주가 강세는 위험 선호 회복을 뜻하지만, 장기금리가 높은 구간에서는 밸류에이션 확장이 제한된다. 따라서 다음 흐름은 지수 상승보다 주도 업종 확산과 금리 상단 안정 여부가 좌우한다.`
      },
      {
        title: "변동성 안정의 조건",
      desc: `VIX가 ${fmt(vix.latestValue, 2)}로 20선 아래에 있으면 단기 헤지 수요는 제한적이다. 다만 금리와 환율이 동시에 불안정해지면 낮은 변동성은 빠르게 되돌릴 수 있다. 한국시장에서는 반도체 주도력과 외국인 매매 흐름을 함께 확인해야 한다.`
      }
    ],
    forwardOutlook: [
      {
        title: "다음 물가 지표와 금리 반응",
        desc: "다음 개인소비지출 물가지수(PCE) 또는 소비자물가지수(CPI) 발표에서 컨센서스 상회가 나오면 미 10년물 4.70% 재시험 가능성이 커진다. 반대로 둔화 신호가 확인되면 성장주 밸류에이션 부담은 완화될 수 있다."
      },
      {
        title: "연준 발언과 금융 여건 평가",
        desc: "다음 연준 발언에서는 물가 목표, 금융 여건, 금리 인하 시점에 대한 문구를 확인해야 한다. 매파적 발언이 반복되면 달러와 장기금리가 한국 성장주에 부담으로 작용할 수 있다."
      }
    ],
    timeframeInsights: {
      weekly: {
        title: "주간 관점: 금리 상단 확인",
        coreView: `이번 주 핵심은 미 10년물 ${fmt(ten.latestValue, 2)}% 부근을 시장이 흡수하는지 여부다.`,
        whyItMatters: "주가와 금리가 함께 높아지면 상승의 질은 실적과 업종 확산에 더 의존한다. 금리 상단이 낮아지지 않으면 성장주 반등은 짧아질 수 있다.",
        koreaImpact: "반도체는 나스닥 흐름에 우호적이지만 2차전지·바이오·인터넷/플랫폼은 금리 부담에 더 민감하다.",
        watchLevels: ["미 10년물 4.70%", "VIX 20선", `나스닥 ${fmt(nasdaq.latestValue, 0)}선`]
      },
      monthly: {
        title: "월간 관점: 환율 확인 필요",
        coreView: "달러/원 시계열은 기준일이 늦어 월간 외국인 매매 흐름 판단은 보조 시세 확인이 필요하다.",
        whyItMatters: "환율이 안정되지 않으면 한국 증시의 상승 지속성은 약해진다. 미국 지수 강세가 있어도 원화 약세가 동반되면 외국인 매매가 흔들릴 수 있다.",
        koreaImpact: "자동차·조선은 환율 방어력이 있지만 바이오·인터넷/플랫폼은 금리와 환율 동반 상승에 취약하다.",
        watchLevels: ["달러/원 기준일 지연 해소 후 1,480원", "달러/원 기준일 지연 해소 후 1,500원", "코스피 외국인 순매수 전환"]
      },
      quarterly: {
        title: "분기 관점: 실적 모멘텀 검증",
        coreView: "분기 흐름은 실적 개선이 금리 부담을 넘어서는지에 달려 있다.",
        whyItMatters: "금리가 높은 구간에서는 기대만으로 밸류에이션을 넓히기 어렵다. 실제 이익 전망이 상향돼야 상승 지속성이 생긴다.",
        koreaImpact: "반도체·조선·방산은 실적 모멘텀이 확인되면 상대 강도를 유지할 수 있다. 2차전지와 바이오는 금리 안정이 필요하다.",
        watchLevels: ["미 10년물 4.50~4.70%", "나스닥 상대강도", "한국 반도체 대형주 매매 흐름"]
      },
      yearly: {
        title: "연간 관점: 고금리와 성장 테마의 공존",
        coreView: "연간 핵심은 인공지능(AI) 투자 사이클과 고금리 환경의 공존이다.",
        whyItMatters: "AI 투자는 반도체와 전력 인프라 수요를 지지한다. 그러나 고금리는 장기 성장주의 현재가치 평가를 계속 압박한다.",
        koreaImpact: "반도체·전력기기·조선·방산은 구조적 테마와 연결된다. 바이오·인터넷/플랫폼은 금리 하락과 실적 회복이 함께 필요하다.",
        watchLevels: ["미 10년물 4.00~4.50%", "연준 금리 인하 횟수", "달러 방향성"]
      }
    },
    insightSections: {
      topStory: [
        { title: "시장 판정", desc: `미 3대 지수는 동반 움직임을 보였고 VIX는 ${fmt(vix.latestValue, 2)}로 20선 아래에 있다.` },
        { title: "자료 제약", desc: "달러/원과 원자재 일부 시계열은 기준일이 늦어 보조 참고로 제한한다." }
      ],
      marketReaction: [
        { title: "지수와 금리", desc: `S&P500 ${pct(sp.percentChange)} / 나스닥 ${pct(nasdaq.percentChange)} / 미 10년물 ${fmt(ten.latestValue, 2)}%.` },
        { title: "변동성", desc: `VIX ${fmt(vix.latestValue, 2)}로 단기 위험 회피는 제한적이다.` }
      ],
      watchNow: [
        { title: "확인 변수", desc: "미 10년물 4.70%, VIX 20선, 달러/원 기준일 지연 해소 후 1,500원을 우선 본다." },
        { title: "한국 연결", desc: "반도체 대형주의 상대 강도와 외국인 매매 흐름 전환 여부가 중요하다." }
      ],
      positioning: [
        { title: "기본", desc: "강세는 인정하되 금리 상단과 환율을 확인하는 중립적 위험자산 우위다." },
        { title: "대체", desc: "금리와 VIX가 동시에 오르면 방어적 포지션을 늘리는 쪽으로 전환한다." }
      ]
    },
    tags: ["미국증시", "금리", "VIX", "코스피", "환율확인", "데이터품질"],
    newsBrief,
    complianceNote: "본 자료는 정보 제공 목적이며 특정 종목의 매수·매도를 권유하지 않습니다. 투자 판단과 그 결과에 대한 책임은 투자자에게 있습니다."
  };
}

function buildMarkdown(reportDate, fields, snapshot) {
  const lines = [];
  lines.push(`# ${fields.title}`);
  lines.push("");
  lines.push(`*${reportDate} KST · 미국 증시 데일리 매크로 브리핑*`);
  if (snapshot?.reportCalendar) {
    lines.push(formatReportCalendarLine(snapshot.reportCalendar));
    if (snapshot.reportCalendar.note) {
      lines.push(snapshot.reportCalendar.note);
    }
  }
  lines.push("");
  lines.push("## 오버나잇 리드");
  lines.push(fields.overnightLead);
  lines.push("");
  lines.push("## 한 줄 요약");
  fields.highlights.forEach((line) => lines.push(`- ${line}`));
  lines.push("");
  lines.push("## 핵심 3줄");
  fields.topThreeLines.forEach((line) => lines.push(`- ${line}`));
  lines.push("");
  lines.push("## 간밤 주요 이슈");
  fields.keyIssues.forEach((issue, index) => {
    lines.push(`### ${index + 1}) ${issue.title}`);
    lines.push(`- 무슨 일이 있었는지: ${issue.whatHappened}`);
    lines.push(`- 시장이 왜 반응했는지: ${issue.whyMarketReacted}`);
    lines.push(`- 무엇을 보면 되는지: ${issue.whatToWatch}`);
    lines.push("");
  });
  lines.push("## 미국 증시 요약");
  lines.push(`- 지수: ${fields.marketSnapshot.indices}`);
  lines.push(`- 금리·채권: ${fields.marketSnapshot.rates}`);
  lines.push(`- 변동성: ${fields.marketSnapshot.volatility}`);
  lines.push(`- 섹터: ${fields.marketSnapshot.sectors}`);
  lines.push(`- 외환·원자재: ${fields.marketSnapshot.fxCommodities}`);
  lines.push("");
  lines.push("## 매크로 인과 분석");
  fields.causalAnalysis.forEach((card) => {
    lines.push(`### ${card.title}`);
    lines.push(card.desc);
    lines.push("");
  });
  lines.push("## 한국 투자자 체크포인트");
  fields.koreanCheckpoints.forEach((line) => lines.push(`- ${line}`));
  lines.push("");
  lines.push("## 향후 변수와 전망");
  fields.forwardOutlook.forEach((card) => {
    lines.push(`### ${card.title}`);
    lines.push(card.desc);
    lines.push("");
  });
  lines.push("## 투자 포지션 참고");
  lines.push("> 본 결과물은 정보 제공이며 투자자문이 아니다.");
  lines.push("");
  lines.push(`**주 시나리오:** ${fields.positioning.mainScenario.view}`);
  lines.push(`- 근거: ${fields.positioning.mainScenario.reasoning}`);
  lines.push(`- 유리한 자산·섹터: ${fields.positioning.mainScenario.pros}`);
  lines.push(`- 불리한 자산·섹터: ${fields.positioning.mainScenario.cons}`);
  lines.push("- 즉시 확인할 신호:");
  fields.positioning.mainScenario.triggers.forEach((trigger) => lines.push(`  - ${trigger}`));
  lines.push(`- 실행 힌트: ${fields.positioning.mainScenario.executionHint}`);
  lines.push("");
  lines.push(`**보조 시나리오:** ${fields.positioning.altScenario.view}`);
  lines.push(`- 발동 조건: ${fields.positioning.altScenario.condition}`);
  lines.push("");
  lines.push("## 짧은 해설");
  fields.commentary.forEach((paragraph) => {
    lines.push(paragraph);
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push("> **고지** — 본 브리핑은 자동 수집된 공개 자료에 기반한 정보 제공 콘텐츠이며 투자자문이 아닙니다. 모든 매수·매도 결정은 투자자 본인의 판단과 책임으로 이뤄져야 합니다.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [snapshot, briefings, newsDigest] = await Promise.all([
    readFile(SNAPSHOT_PATH, "utf8").then(JSON.parse),
    readFile(BRIEFINGS_PATH, "utf8").then(JSON.parse),
    readFile(NEWS_PATH, "utf8").then(JSON.parse).catch(() => null)
  ]);
  const reportDate = snapshot.reportDate;
  const index = briefings.findIndex((entry) => entry.date === reportDate);
  if (index < 0) {
    throw new Error(`No briefing record for ${reportDate}. Run publish-briefing first.`);
  }

  const current = briefings[index];
  const fields = buildFields(snapshot, current, newsDigest);
  briefings[index] = {
    ...current,
    ...fields,
    fallbackFilledAt: new Date().toISOString()
  };

  await writeFile(BRIEFINGS_PATH, `${JSON.stringify(briefings, null, 2)}\n`, "utf8");
  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(path.join(POSTS_DIR, `${reportDate}.md`), buildMarkdown(reportDate, fields, snapshot), "utf8");
  console.log(`[fill-briefing-fallback] updated ${reportDate} briefing sections`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
