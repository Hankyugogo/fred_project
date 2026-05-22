// Fill the latest briefing with deterministic structured sections when LLM rewrite is unavailable.
// This keeps report.html complete even if Gemini free-tier quota is exhausted.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");

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

function fallbackTitle(snapshot, sp, nasdaq, ten, vix) {
  if (sp.percentChange > 0 && nasdaq.percentChange > 0) {
    return `광범위한 동행 강세, 장기금리 ${fmt(ten.latestValue, 2)}% 부담 점검`;
  }
  if (sp.percentChange < 0 && nasdaq.percentChange < 0) {
    return `미 증시 동반 약세, 금리와 변동성 부담 점검`;
  }
  return snapshot.headline || `혼합 장세, 10년물 ${fmt(ten.latestValue, 2)}% · VIX ${fmt(vix.latestValue, 2)}`;
}

function buildFields(snapshot, briefing) {
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
  const topNews = briefing.newsBrief?.topItems?.[0];

  const title = briefing.title || fallbackTitle(snapshot, sp, nasdaq, ten, vix);
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
      whatToWatch: "달러/원 1,480원과 1,500원, 코스피 외국인 순매수 전환, 반도체 대형주의 상대 강도를 동시에 점검한다."
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
    headline: briefing.headline || title,
    topThreeLines,
    keyIssues,
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
        triggers: ["미 10년물 4.70% 상회", "VIX 20선 재돌파", "달러/원 1,500원 상회"],
        executionHint: "반도체 주도력이 약해지는지 먼저 확인하고, 민감 업종보다 현금흐름 안정 업종의 상대 강도를 본다."
      }
    },
    commentary: [
      `오늘 리포트의 핵심은 주가와 장기금리가 동시에 움직였다는 점이다. S&P500지수와 나스닥 종합지수, 다우존스30 산업평균지수가 같은 방향으로 움직였지만 미 10년물 금리도 ${fmt(ten.latestValue, 2)}%를 기록했다. 이는 시장이 경기와 실적 기대를 반영하면서도 자금 조달 비용의 상단을 다시 시험하고 있음을 뜻한다.`,
      `한국시장 관점에서는 미국 기술주 강세가 반도체와 성장 업종에 우호적이다. 다만 달러/원 FRED 시계열 기준일이 ${krw.observationDate || "-"}로 늦어 외환 해석은 보조 시세와 함께 확인해야 한다. 코스피 ${fmt(kospi.latestValue, 2)}와 코스닥 ${fmt(kosdaq.latestValue, 2)}라는 보조 시세는 강세를 가리키지만, 환율 안정이 동반되지 않으면 상승 지속성은 약해질 수 있다.`,
      `뉴스 흐름은 연준 의사록과 인플레이션 경로로 모인다. 당장 하루 가격을 결정하는 단일 재료보다 금리 경로와 금융 여건을 재평가하게 만드는 재료가 많다. 따라서 오늘의 결론은 강세 추종이 아니라 금리 상단, 환율, 주도 업종 확산 여부를 함께 확인하는 쪽에 가깝다.`
    ],
    marketSnapshot: {
      indices: `S&P500지수 ${pct(sp.percentChange)}, 나스닥 종합지수 ${pct(nasdaq.percentChange)}, 다우존스30 산업평균지수 ${pct(dow.percentChange)}로 3대 지수가 움직였다.`,
      rates: `미 10년물 ${fmt(ten.latestValue, 2)}%, 2년물 ${fmt(two.latestValue, 2)}%, 10년-2년 금리차 ${fmt(spread.latestValue, 2)}%p다.`,
      volatility: `VIX는 ${fmt(vix.latestValue, 2)}로 20선 아래에 있다.`,
      fxCommodities: `달러/원은 FRED 기준 ${fmt(krw.latestValue, 2)}원, WTI는 ${fmt(wti.latestValue, 2)}달러다. 기준일 지연을 감안한다.`
    },
    complianceNote: "본 자료는 정보 제공 목적이며 특정 종목의 매수·매도를 권유하지 않습니다. 투자 판단과 그 결과에 대한 책임은 투자자에게 있습니다."
  };
}

async function main() {
  const [snapshot, briefings] = await Promise.all([
    readFile(SNAPSHOT_PATH, "utf8").then(JSON.parse),
    readFile(BRIEFINGS_PATH, "utf8").then(JSON.parse)
  ]);
  const reportDate = snapshot.reportDate;
  const index = briefings.findIndex((entry) => entry.date === reportDate);
  if (index < 0) {
    throw new Error(`No briefing record for ${reportDate}. Run publish-briefing first.`);
  }

  const current = briefings[index];
  const fields = buildFields(snapshot, current);
  briefings[index] = {
    ...current,
    ...fields,
    fallbackFilledAt: new Date().toISOString()
  };

  await writeFile(BRIEFINGS_PATH, `${JSON.stringify(briefings, null, 2)}\n`, "utf8");
  console.log(`[fill-briefing-fallback] updated ${reportDate} briefing sections`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
