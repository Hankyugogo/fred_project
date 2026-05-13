// Rewrite the daily briefing in 조선비즈 마감시황 tone using Gemini.
// Inputs: market-snapshot.json, news-digest.json (already Koreanized),
//         posts/YYYY-MM-DD.md (rule-based draft), briefings.json, editorial-style.json
// Outputs: rewritten posts/YYYY-MM-DD.md and updated briefings.json record.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { callGeminiJson } from "./lib/gemini-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const DIGEST_PATH = path.join(ROOT, "data", "news-digest.json");
const STYLE_PATH = path.join(ROOT, "config", "editorial-style.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const POSTS_DIR = path.join(ROOT, "posts");

// gemini-2.5-flash by default — free tier 1500 req/day, 60 RPM.
// Set GEMINI_REWRITE_MODEL=gemini-2.5-pro for higher quality (5 RPM/25 daily on free tier).
const REWRITE_MODEL = process.env.GEMINI_REWRITE_MODEL || "gemini-2.5-flash";

function pickItem(snapshot, id) {
  for (const group of snapshot.groups) {
    const found = group.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

function compactItem(item) {
  if (!item) return null;
  const out = {
    id: item.id,
    label: item.label,
    latestValue: item.latestValue,
    previousValue: item.previousValue,
    absoluteChange: item.absoluteChange,
    percentChange: item.percentChange,
    format: item.format,
    decimals: item.decimals,
    observationDate: item.observationDate,
    freshnessLabel: item.freshness?.label || null,
    freshnessStatus: item.freshness?.status || null
  };
  if (item.supplementary) {
    out.supplementary = {
      value: item.supplementary.value,
      observationDate: item.supplementary.observationDate,
      sourceName: item.supplementary.sourceName,
      sourceUrl: item.supplementary.sourceUrl,
      confidence: item.supplementary.confidence
    };
  }
  return out;
}

function extractMarketData(snapshot) {
  const ids = [
    "SP500", "NASDAQCOM", "DJIA",
    "KOSPI", "KOSDAQ", "JPYKRW",
    "DGS2", "DGS10", "DFF", "UST10Y_UST2Y_SPREAD",
    "VIXCLS",
    "DEXKOUS", "DTWEXBGS", "DEXJPUS",
    "DCOILWTICO", "DCOILBRENTEU"
  ];
  const items = ids.map((id) => compactItem(pickItem(snapshot, id))).filter(Boolean);
  return {
    reportDate: snapshot.reportDate,
    generatedAt: snapshot.generatedAt,
    items,
    freshnessSummary: snapshot.freshnessSummary,
    contextEnrichment: snapshot.contextEnrichment || null
  };
}

function extractNewsForLLM(digest) {
  if (!digest) return null;
  const themes = (digest.themes || []).map((theme) => ({
    category: theme.category,
    label: theme.label,
    koreanSummary: theme.koreanSummary || theme.summary || "",
    items: (theme.items || []).slice(0, 4).map((item) => ({
      koreanTitle: item.koreanTitle || item.title,
      koreanSummary: item.koreanSummary || "",
      sourceKorean: item.sourceKorean || item.source,
      publishedAt: item.publishedAt,
      link: item.link
    }))
  }));
  const topItems = (digest.topItems || []).slice(0, 8).map((item) => ({
    koreanTitle: item.koreanTitle || item.title,
    koreanSummary: item.koreanSummary || "",
    sourceKorean: item.sourceKorean || item.source,
    publishedAt: item.publishedAt
  }));
  return {
    koreanEditorialSummary: digest.koreanEditorialSummary || digest.editorialSummary || "",
    themes,
    topItems,
    sourceHealth: digest.sourceHealth || null
  };
}

function buildSystemInstruction(style) {
  const forbiddenList = [
    ...(style?.forbiddenEndings || []),
    ...(style?.forbiddenPhrases || [])
  ];
  const sectorBreakdown = (style?.depthGuidance?.koreanSectorBreakdown || []).join(" / ");
  const crossAssetSignals = (style?.depthGuidance?.crossAssetSignals || []).join(", ");

  return [
    "너는 한국 경제일간지 조선비즈의 데일리 마감시황 + 글로벌 매크로 데스크의 시니어 에디터다.",
    "참조 결과물(Agent Hong Daily Intelligence)의 골격을 채택하되, 매크로 인과 깊이·한국 섹터 분해·향후 이벤트 구체성에서 명확히 능가해야 한다.",
    "단순 현황 보고에 그치면 실패다. 모든 분석은 (1) 사실, (2) 사실의 1단계 원인, (3) 1단계 원인의 2단계 매크로 배경, (4) 시장 함의·한국 적용까지 사슬 형태로 풀어쓴다.",
    "",
    "■ 언어·표기 절대 규칙",
    "1) 영문 단어 본문 노출 금지. 'S&P 500'→'S&P500지수', 'Nasdaq'→'나스닥 종합지수', 'Dow'→'다우존스30 산업평균지수', 'KOSPI'→'코스피지수', 'KOSDAQ'→'코스닥지수', 'Treasury yield'→'미 국채 금리', 'Fed'→'연방준비제도(연준)', 'FOMC'→'연방공개시장위원회(FOMC)', 'CPI'→'소비자물가지수(CPI)', 'PCE'→'개인소비지출 물가지수(PCE)', 'GDP'→'국내총생산(GDP)', 'WTI'→'서부텍사스산원유(WTI)', 'Brent'→'브렌트유', 'VIX'→'변동성지수(VIX)', 'BOJ'→'일본은행', 'BoE'→'영란은행', 'BoC'→'캐나다은행', 'EFFR'→'유효 연방기금금리', 'TIPS'→'물가연동국채(TIPS)', 'DXY'→'달러지수(DXY)', 'MOVE'→'채권 변동성지수(MOVE)'.",
    "  - 환율 표기: 달러/원은 'X,XXX.XX원', 달러/엔은 '엔', 원-엔은 '100엔당 X원'. 예: '원-엔 환율은 100엔당 945.20원으로 마감했다.'",
    "  - ETF·종목 티커는 원어 유지하되 한글 풀이를 함께 적는다. 예: 'XLF(미국 금융 ETF)', 'SOXX(미 반도체 ETF)', '삼성전자', 'SK하이닉스'.",
    "2) 종결어미: '마감했다 / 거래를 마쳤다 / 기록했다 / 나타났다 / 그쳤다 / 후퇴했다 / 회복했다 / 분석된다 / 평가된다 / 전망된다 / 관측된다 / 주목된다 / 풀이된다'를 우선 사용. 합쇼체(~습니다) 대신 한다 종결.",
    "3) 다음 표현은 모든 출력에서 절대 사용 금지: " + JSON.stringify(forbiddenList) + ".",
    "4) 번역투 금지: '~에 따르면', '~의 측면에서', '~을 가지고 있다', '~을 보여주고 있다', '다소', '최근 몇 (년|달|주) 동안'.",
    "5) 수치 표기: 콤마 구분, 소수점 정확히 유지. 등락은 절대치(포인트/%포인트)와 퍼센트(%)를 함께. 예: '21.11포인트(0.29%) 오른 7,230.12'.",
    "6) 문장은 짧고 명료. '~고, ~고, ~다' 토막 나열 금지. 마침표로 끊는다.",
    "7) [관찰], [해석], [확인] 같은 메타 라벨을 본문에 노출하지 않는다.",
    "8) 영문 헤드라인을 그대로 인용하지 않는다. 입력으로 받은 koreanTitle/koreanSummary만 활용.",
    "9) 동일 단어를 한 문단 안에서 두 번 이상 반복하지 않는다.",
    "",
    "■ 보충 시세(supplementary) 처리",
    "- 시계열에 supplementary 필드가 있으면 FRED 기준값과 함께 다음과 같이 적시한다.",
    "  예: '달러/원 환율은 FRED 기준 2026-04-24의 1,476.47원, 보충 시세 기준 2026-05-02 1,468.20원(자료: 인베스토피디아)으로 확인된다.'",
    "- supplementary가 없으면 '기준일이 늦어 해석 범위를 제한한다'고만 차분하게 서술한다.",
    "",
    "■ 매크로 인과(causalAnalysis) 의무",
    "- 모든 인과 카드는 표면 → 1단계 원인 → 2단계 원인 → 시장 함의 사슬을 갖춰야 한다.",
    "  나쁜 예: '나스닥이 강세를 보였다. 기술주가 상승했기 때문이다.' (1단계만)",
    "  좋은 예: '나스닥 종합지수의 0.89% 상승은 인공지능(AI) 자본지출 확대 기조와 연결된다. 1분기 국내총생산(GDP) 성장의 상당 부분이 AI 인프라 투자에서 비롯됐다는 분석이 성장주 우위 흐름을 뒷받침했다. 시장은 이를 빅테크 실적의 구조적 모멘텀으로 해석해 주가 밸류에이션 확장을 일부 허용했다.'",
    "- 입력 데이터에서 직접 확인되지 않는 인과는 추정임을 명시한다('관측된다', '분석된다', '추정된다').",
    "",
    "■ 전망(forwardOutlook) 의무",
    "- 모든 전망 카드는 (이벤트명) + (날짜) + (컨센서스 또는 시장 베팅) + (상회/하회 시 시장 반응 가설) 4요소를 갖춰야 한다.",
    "  나쁜 예: '이번 주 경제지표를 주목할 필요가 있다.'",
    "  좋은 예: '5월 8일 4월 비농업 신규고용 발표 — 컨센서스 18만명. 컨센서스를 큰 폭 상회하면 연방준비제도(연준)의 6월 금리인하 베팅이 50% 이하로 후퇴하면서 미 국채 10년물이 4.5% 부근을 재테스트할 가능성이 있다. 컨센서스를 하회하면 반대 방향으로 작용한다.'",
    "- 매크로 캘린더 후보: 연방공개시장위원회(FOMC), 비농업 고용, 소비자물가지수(CPI), 개인소비지출 물가지수(PCE), 소매판매, ISM 제조업·서비스업, 미시간 소비심리, JOLTS, 베이지북, 빅테크 실적, 한국 금통위, 코스피 대장주 실적.",
    "",
    "■ 한국 섹터 분해(koreanCheckpoints, positioning) 의무",
    "- '한국 성장주 변동성 확대' 같은 일반론 금지. 다음 섹터 매핑을 활용해 종목·섹터 단위로 영향을 풀이한다: " + sectorBreakdown,
    "- 임계치는 반드시 숫자로 표기한다. 예: '미 10년물 4.50% 상향 돌파 시', '원달러 1,400선 돌파 시', '코스피 외국인 선물 누적 -2조원 돌파 시'.",
    "",
    "■ 상위 시간축 인사이트(timeframeInsights) 의무",
    "- 기존 데일리 리포트의 흐름은 유지하되, 오늘의 움직임을 주간·월간·분기·연간 흐름 안에서 해석한다.",
    "- weekly/monthly/quarterly/yearly 4개 카드를 모두 채운다.",
    "- 각 카드는 title, coreView, whyItMatters, koreaImpact, watchLevels를 포함한다.",
    "- coreView는 리서치센터식으로 짧고 단정적인 핵심 판단 1문장이다.",
    "- whyItMatters는 매크로 인과를 2단계 이상 설명하는 2문장이다.",
    "- koreaImpact는 한국 8개 기본 섹터(반도체·자동차·2차전지·금융·조선·방산·바이오·인터넷/플랫폼) 중 해당 축을 골라 투자자 노트식으로 연결한다.",
    "- watchLevels는 숫자 임계치 또는 확인 가능한 시장 변수 2~4개다.",
    "",
    "■ 크로스애셋·테크니컬 시그널 활용",
    "가능한 경우 다음 신호를 본문 인과·전망에 녹인다: " + crossAssetSignals + ".",
    "",
    "■ 투자 포지션(positioning) 윤리",
    "- 본 결과물은 정보 제공이며 투자자문이 아니다. '매수하라', '매도하라' 단정 권유 금지.",
    "- 가능성 화법으로 표기한다. 예: '~비중 축소를 검토할 여지가 있다', '~조건이 충족되면 ~ 가능성이 커진다', '~헤지 비중을 늘릴 수 있는 환경이다'.",
    "- triggers는 즉시 확인 가능한 지표·임계치로 2~3개. executionHint는 분할 진입·헤지 비율·축소 비율 같은 구체적 행동 옵션.",
    "",
    "■ 출력 형식",
    "위 모든 구조화 필드(topThreeLines, keyIssues, marketSnapshot, timeframeInsights, koreanCheckpoints, causalAnalysis, forwardOutlook, positioning, commentary, insightSections)를 빠짐없이 채우는 데 집중한다. 마크다운 조립은 후처리에서 자동으로 한다.",
    "",
    "overnightLead는 3~4문장. 첫 문장: 지수 마감 핵심 수치 + 시장 톤. 둘째 문장: 가장 강한 보조축(금리·정책·지정학·실적 중 1축). 셋째 문장: 시장 반응 패턴(섹터 차별화 등). 넷째(선택): 오늘 흐름을 한 줄로 압축한 매크로 해석.",
    "",
    "출력은 반드시 JSON 스키마에 맞춰 반환한다. 마크다운 코드 펜스도 붙이지 말고 JSON만 출력한다.",
    style?.voice ? `톤 가이드: ${style.voice}` : ""
  ].filter(Boolean).join("\n");
}

const SECTION_ITEM_SCHEMA = {
  type: "OBJECT",
  properties: { title: { type: "STRING" }, desc: { type: "STRING" } },
  required: ["title", "desc"]
};

const TIMEFRAME_CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    coreView: { type: "STRING" },
    whyItMatters: { type: "STRING" },
    koreaImpact: { type: "STRING" },
    watchLevels: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["title", "coreView", "whyItMatters", "koreaImpact", "watchLevels"]
};

const KEY_ISSUE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    whatHappened: { type: "STRING" },
    whyMarketReacted: { type: "STRING" },
    whatToWatch: { type: "STRING" }
  },
  required: ["title", "whatHappened", "whyMarketReacted", "whatToWatch"]
};

const REWRITE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    headline: { type: "STRING" },
    overnightLead: { type: "STRING" },
    topThreeLines: {
      type: "ARRAY",
      description: "오늘의 핵심 3줄. 각 1~2문장.",
      items: { type: "STRING" }
    },
    highlights: { type: "ARRAY", items: { type: "STRING" } },
    keyIssues: {
      type: "ARRAY",
      description: "간밤 주요 이슈 5개. 각 4필드(title, whatHappened, whyMarketReacted, whatToWatch).",
      items: KEY_ISSUE_SCHEMA
    },
    marketSnapshot: {
      type: "OBJECT",
      description: "지수·금리·변동성·섹터·외환원자재 한 줄 요약.",
      properties: {
        indices: { type: "STRING" },
        rates: { type: "STRING" },
        volatility: { type: "STRING" },
        sectors: { type: "STRING" },
        fxCommodities: { type: "STRING" }
      },
      required: ["indices", "rates", "volatility", "sectors", "fxCommodities"]
    },
    koreanCheckpoints: {
      type: "ARRAY",
      description: "한국 투자자 체크포인트 3개. 임계치·섹터 영향 명시.",
      items: { type: "STRING" }
    },
    causalAnalysis: {
      type: "ARRAY",
      description: "매크로 인과 분석 카드 2~4개. 인과 사슬 2~3단계.",
      items: SECTION_ITEM_SCHEMA
    },
    forwardOutlook: {
      type: "ARRAY",
      description: "향후 변수와 전망 카드 2~4개. 이벤트명·날짜·컨센서스·시나리오 분기 명시.",
      items: SECTION_ITEM_SCHEMA
    },
    timeframeInsights: {
      type: "OBJECT",
      description: "데일리 움직임을 상위 시간축 안에서 해석하는 주간·월간·분기·연간 카드.",
      properties: {
        weekly: TIMEFRAME_CARD_SCHEMA,
        monthly: TIMEFRAME_CARD_SCHEMA,
        quarterly: TIMEFRAME_CARD_SCHEMA,
        yearly: TIMEFRAME_CARD_SCHEMA
      },
      required: ["weekly", "monthly", "quarterly", "yearly"]
    },
    positioning: {
      type: "OBJECT",
      description: "투자 포지션 참고. 투자자문이 아닌 가능성 화법.",
      properties: {
        mainScenario: {
          type: "OBJECT",
          properties: {
            view: { type: "STRING" },
            reasoning: { type: "STRING" },
            pros: { type: "STRING" },
            cons: { type: "STRING" },
            triggers: { type: "ARRAY", items: { type: "STRING" } },
            executionHint: { type: "STRING" }
          },
          required: ["view", "reasoning", "pros", "cons", "triggers", "executionHint"]
        },
        altScenario: {
          type: "OBJECT",
          properties: {
            condition: { type: "STRING" },
            view: { type: "STRING" }
          },
          required: ["condition", "view"]
        }
      },
      required: ["mainScenario", "altScenario"]
    },
    commentary: {
      type: "ARRAY",
      description: "짧은 해설 문단 3~4개. 각 2~4문장. 표면→매크로 깊이→한국 적용→행동 가이드.",
      items: { type: "STRING" }
    },
    insightSections: {
      type: "OBJECT",
      description: "대시보드 4탭(topStory, marketReaction, watchNow, positioning). 각 2~3개 카드.",
      properties: {
        topStory: { type: "ARRAY", items: SECTION_ITEM_SCHEMA },
        marketReaction: { type: "ARRAY", items: SECTION_ITEM_SCHEMA },
        watchNow: { type: "ARRAY", items: SECTION_ITEM_SCHEMA },
        positioning: { type: "ARRAY", items: SECTION_ITEM_SCHEMA }
      },
      required: ["topStory", "marketReaction", "watchNow", "positioning"]
    },
    tags: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: [
    "title",
    "overnightLead",
    "topThreeLines",
    "highlights",
    "keyIssues",
    "marketSnapshot",
    "koreanCheckpoints",
    "causalAnalysis",
    "forwardOutlook",
    "timeframeInsights",
    "positioning",
    "commentary",
    "insightSections",
    "tags"
  ]
};

function buildPrompt(market, news, draft, freshness) {
  const sections = [];
  sections.push("아래 입력만으로 오늘자 미국 시장 마감 브리핑을 조선비즈 마감시황 톤의 한국어로 작성한다.");
  sections.push("");
  sections.push("【시장 데이터 (FRED 기반 + 보충 시세)】");
  sections.push("```json");
  sections.push(JSON.stringify(market, null, 2));
  sections.push("```");
  sections.push("");
  if (market.contextEnrichment) {
    sections.push("【크로스애셋 컨텍스트 (Gemini 그라운딩)】");
    sections.push("- 섹터 ETF 등락, DXY/금/구리/MOVE/실질금리, 향후 14일 매크로·실적 캘린더가 포함된다.");
    sections.push("- 이 데이터는 본문의 marketSnapshot.sectors, fxCommodities, forwardOutlook 작성에 우선 활용한다.");
    sections.push("```json");
    sections.push(JSON.stringify(market.contextEnrichment, null, 2));
    sections.push("```");
    sections.push("");
  }
  sections.push("【자료 기준일 요약】");
  sections.push("```json");
  sections.push(JSON.stringify(freshness, null, 2));
  sections.push("```");
  sections.push("");
  sections.push("【뉴스 요약 (한국어)】");
  if (news) {
    sections.push("```json");
    sections.push(JSON.stringify(news, null, 2));
    sections.push("```");
  } else {
    sections.push("(수집된 뉴스 없음)");
  }
  sections.push("");
  sections.push("【규칙 기반 초안 (참고용, 그대로 옮기지 말 것)】");
  sections.push("```");
  sections.push(draft || "(초안 없음)");
  sections.push("```");
  sections.push("");
  sections.push("【출력 요구사항 — 모든 필드 채움】");
  sections.push("");
  sections.push("◇ 메타");
  sections.push("- title: 30자 이내. 예: '[데일리 마감] 나스닥 0.89% 강세… 장기금리 4.4%서 정체'");
  sections.push("- headline: 50자 이내 부제.");
  sections.push("- tags: 5~7개의 한국어 키워드.");
  sections.push("");
  sections.push("◇ 상단");
  sections.push("- topThreeLines: 정확히 3개. 각 1~2문장. (1) 지수 마감, (2) 핵심 변수, (3) 시장 반응 패턴.");
  sections.push("- overnightLead: 3~4문장 압축 내러티브. 첫 문장에 지수 마감 + 시장 톤.");
  sections.push("- highlights: 4개. 각 60자 내외. 지수/금리/변동성·외환·원자재/핵심 뉴스 인과.");
  sections.push("");
  sections.push("◇ 본문 핵심");
  sections.push("- keyIssues: 정확히 5개. 각 이슈에 4필드(title, whatHappened, whyMarketReacted, whatToWatch). whatToWatch에는 반드시 구체 임계치 숫자가 들어간다.");
  sections.push("- marketSnapshot: 5필드(indices, rates, volatility, sectors, fxCommodities). 각 1~2문장. sectors는 미국 섹터 ETF(XLF, XLK, XLE, SOXX, XLV, XLP, XLY, XLI, XLU 중 입력에 있거나 일반적으로 알려진 흐름) 4~6개 등락. fxCommodities는 달러지수(DXY)/원달러/유가/금/구리.");
  sections.push("- koreanCheckpoints: 정확히 3개. 임계치 숫자 + 한국 섹터 단위 영향 명시.");
  sections.push("");
  sections.push("◇ 분석·전망");
  sections.push("- causalAnalysis: 2~4개 카드. {title, desc(2~3문장)}. 매크로 인과 사슬 2~3단계 의무.");
  sections.push("- forwardOutlook: 2~4개 카드. {title(이벤트명), desc(2~3문장)}. (이벤트명)+(날짜)+(컨센서스)+(상회/하회 시 시장 반응 가설) 4요소 의무.");
  sections.push("- timeframeInsights: weekly/monthly/quarterly/yearly 4개 카드. 각 카드에 {title, coreView, whyItMatters, koreaImpact, watchLevels[]}를 채운다.");
  sections.push("  · coreView는 리서치센터식 핵심 판단 1문장.");
  sections.push("  · whyItMatters는 주간·월간·분기·연간 시간축에서 오늘 움직임이 왜 중요한지 2문장.");
  sections.push("  · koreaImpact는 반도체·자동차·2차전지·금융·조선·방산·바이오·인터넷/플랫폼 중 관련 섹터를 골라 한국장 적용을 2문장으로 쓴다.");
  sections.push("  · watchLevels는 숫자 임계치나 확인 가능한 변수 2~4개.");
  sections.push("- positioning.mainScenario: 6필드(view, reasoning, pros, cons, triggers[], executionHint). triggers는 임계치 포함 2~3개.");
  sections.push("- positioning.altScenario: 2필드(condition, view). 보조 시나리오 발동 조건 + 그 시 흐름.");
  sections.push("");
  sections.push("◇ 해설");
  sections.push("- commentary: 3~4문단. 1) 표면 vs 속내, 2) 가장 중요한 매크로 변수의 깊이, 3) 한국 시장 적용, 4) 행동 가이드.");
  sections.push("- insightSections: 대시보드용 4탭(topStory, marketReaction, watchNow, positioning). 각 2~3개 {title, desc}.");
  sections.push("");
  sections.push("");
  sections.push("※ markdownBody 필드는 더 이상 만들 필요 없다. 위 구조화 필드들만 정확히 채우면 후처리가 마크다운으로 조립한다.");
  sections.push("");
  sections.push("【응답 형식】");
  sections.push("위 스키마를 만족하는 JSON만 출력한다. 코드 펜스 금지.");
  return sections.join("\n");
}

function lintForbiddenEndings(text, style) {
  const forbidden = style?.forbiddenEndings || [];
  const hits = [];
  forbidden.forEach((pattern) => {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      hits.push({ pattern, index: match.index });
    }
  });
  return hits;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

// Assemble the body markdown deterministically from the structured fields.
// We do not rely on payload.markdownBody — lite/flash models often skip or truncate it.
function assembleStructuredBody(payload) {
  const blocks = [];

  if (Array.isArray(payload.topThreeLines) && payload.topThreeLines.length) {
    blocks.push("## 핵심 3줄");
    payload.topThreeLines.forEach((line) => blocks.push(`- ${line}`));
    blocks.push("");
  }

  if (Array.isArray(payload.keyIssues) && payload.keyIssues.length) {
    blocks.push("## 간밤 주요 이슈");
    payload.keyIssues.forEach((issue, idx) => {
      blocks.push(`### ${idx + 1}) ${issue.title || "이슈"}`);
      if (issue.whatHappened) blocks.push(`- 무슨 일이 있었는지: ${issue.whatHappened}`);
      if (issue.whyMarketReacted) blocks.push(`- 시장이 왜 반응했는지: ${issue.whyMarketReacted}`);
      if (issue.whatToWatch) blocks.push(`- 무엇을 보면 되는지: ${issue.whatToWatch}`);
      blocks.push("");
    });
  }

  if (payload.timeframeInsights) {
    const order = ["weekly", "monthly", "quarterly", "yearly"];
    blocks.push("## 상위 시간축 인사이트");
    order.forEach((key) => {
      const card = payload.timeframeInsights[key];
      if (!card) return;
      blocks.push(`### ${card.title || key}`);
      if (card.coreView) blocks.push(`- 핵심 판단: ${card.coreView}`);
      if (card.whyItMatters) blocks.push(`- 왜 중요한가: ${card.whyItMatters}`);
      if (card.koreaImpact) blocks.push(`- 한국시장 연결: ${card.koreaImpact}`);
      if (Array.isArray(card.watchLevels) && card.watchLevels.length) {
        blocks.push(`- 확인할 임계치: ${card.watchLevels.join(" / ")}`);
      }
      blocks.push("");
    });
  }

  if (payload.marketSnapshot) {
    const m = payload.marketSnapshot;
    blocks.push("## 미국 증시 요약");
    if (m.indices) blocks.push(`- 지수: ${m.indices}`);
    if (m.rates) blocks.push(`- 금리·채권: ${m.rates}`);
    if (m.volatility) blocks.push(`- 변동성: ${m.volatility}`);
    if (m.sectors) blocks.push(`- 섹터: ${m.sectors}`);
    if (m.fxCommodities) blocks.push(`- 외환·원자재: ${m.fxCommodities}`);
    blocks.push("");
  }

  if (Array.isArray(payload.causalAnalysis) && payload.causalAnalysis.length) {
    blocks.push("## 매크로 인과 분석");
    payload.causalAnalysis.forEach((card) => {
      if (card.title) blocks.push(`### ${card.title}`);
      if (card.desc) blocks.push(card.desc);
      blocks.push("");
    });
  }

  if (Array.isArray(payload.koreanCheckpoints) && payload.koreanCheckpoints.length) {
    blocks.push("## 한국 투자자 체크포인트");
    payload.koreanCheckpoints.forEach((line) => blocks.push(`- ${line}`));
    blocks.push("");
  }

  if (Array.isArray(payload.forwardOutlook) && payload.forwardOutlook.length) {
    blocks.push("## 향후 변수와 전망");
    payload.forwardOutlook.forEach((card) => {
      if (card.title) blocks.push(`### ${card.title}`);
      if (card.desc) blocks.push(card.desc);
      blocks.push("");
    });
  }

  if (payload.positioning?.mainScenario) {
    const main = payload.positioning.mainScenario;
    const alt = payload.positioning.altScenario;
    blocks.push("## 투자 포지션 참고");
    blocks.push("> 본 결과물은 정보 제공이며 투자자문이 아니다.");
    blocks.push("");
    if (main.view) blocks.push(`**주 시나리오:** ${main.view}`);
    if (main.reasoning) blocks.push(`- 근거: ${main.reasoning}`);
    if (main.pros) blocks.push(`- 유리한 자산·섹터: ${main.pros}`);
    if (main.cons) blocks.push(`- 불리한 자산·섹터: ${main.cons}`);
    if (Array.isArray(main.triggers) && main.triggers.length) {
      blocks.push(`- 즉시 확인할 신호:`);
      main.triggers.forEach((t) => blocks.push(`  - ${t}`));
    }
    if (main.executionHint) blocks.push(`- 실행 힌트: ${main.executionHint}`);
    blocks.push("");
    if (alt?.condition || alt?.view) {
      blocks.push(`**보조 시나리오:** ${alt.view || ""}`);
      if (alt.condition) blocks.push(`- 발동 조건: ${alt.condition}`);
      blocks.push("");
    }
  }

  if (Array.isArray(payload.commentary) && payload.commentary.length) {
    blocks.push("## 짧은 해설");
    payload.commentary.forEach((p) => {
      blocks.push(p);
      blocks.push("");
    });
  }

  return blocks.join("\n").trim();
}

function buildFinalMarkdown(reportDate, payload, snapshot, news) {
  const lines = [];
  lines.push(`# ${payload.title || "데일리 마감 브리핑"}`);
  lines.push("");
  lines.push(`*${reportDate} KST · 미국 증시 데일리 매크로 브리핑*`);
  if (payload.headline) {
    lines.push("");
    lines.push(`> ${payload.headline}`);
  }
  lines.push("");
  lines.push("## 오버나잇 리드");
  lines.push(payload.overnightLead || "리드 본문이 누락됐다.");
  lines.push("");
  if (Array.isArray(payload.highlights) && payload.highlights.length) {
    lines.push("## 한 줄 요약");
    payload.highlights.forEach((line) => lines.push(`- ${line}`));
    lines.push("");
  }
  // Always assemble structured body from the schema fields.
  // payload.markdownBody (when present) is treated as advisory only.
  const structuredBody = assembleStructuredBody(payload);
  if (structuredBody) {
    lines.push(structuredBody);
    lines.push("");
  } else if (typeof payload.markdownBody === "string" && payload.markdownBody.trim()) {
    // Fallback: only if structured fields are completely absent.
    lines.push(payload.markdownBody.trim());
    lines.push("");
  }
  lines.push("## 자료 기준");
  lines.push("### 원시 지표 스냅샷");
  snapshot.groups.forEach((group) => {
    lines.push(`#### ${group.label}`);
    group.items.forEach((item) => {
      const value = formatRawValue(item);
      const delta = formatRawDelta(item);
      const supp = item.supplementary
        ? ` · 보충 시세 ${item.supplementary.value} (${item.supplementary.observationDate}, ${item.supplementary.sourceName || "출처 미상"})`
        : "";
      lines.push(`- ${item.label}: ${value} / 변화 ${delta} / 기준일 ${item.observationDate} / ${item.freshness.label}${supp}`);
    });
    lines.push("");
  });
  if (news?.sourceHealth) {
    lines.push("### 뉴스 수집 상태");
    lines.push(`- 성공 ${news.sourceHealth.okCount}건, 실패 ${news.sourceHealth.failedCount}건.`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("> **고지** — 본 브리핑은 자동 수집된 공개 자료에 기반한 정보 제공 콘텐츠이며 투자자문이 아닙니다. 모든 매수·매도 결정은 투자자 본인의 판단과 책임으로 이뤄져야 합니다.");
  return `${lines.join("\n")}\n`;
}

function formatRawValue(item) {
  if (item.latestValue === null || item.latestValue === undefined || Number.isNaN(item.latestValue)) {
    return "N/A";
  }
  const decimals = item.decimals ?? 2;
  const formatted = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(item.latestValue);
  if (item.format === "percent") return `${formatted}%`;
  if (item.format === "usd") return `$${formatted}`;
  if (item.format === "krw") return `${formatted} KRW`;
  return formatted;
}

function formatRawDelta(item) {
  const decimals = item.decimals ?? 2;
  const sign = (value, digits) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
    const rounded = Number(value).toFixed(digits);
    return Number(value) > 0 ? `+${rounded}` : rounded;
  };
  const absText = item.format === "percent"
    ? `${sign(item.absoluteChange, decimals)}%p`
    : sign(item.absoluteChange, decimals);
  if (item.percentChange === null || item.percentChange === undefined || Number.isNaN(item.percentChange)) {
    return absText;
  }
  return `${absText}, ${sign(item.percentChange, 2)}%`;
}

async function readDraftMarkdown(reportDate) {
  const file = path.join(POSTS_DIR, `${reportDate}.md`);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const snapshot = await readJson(SNAPSHOT_PATH);
  if (!snapshot) {
    throw new Error("market-snapshot.json이 없어 리라이트할 수 없습니다.");
  }
  const reportDate = snapshot.reportDate;

  const [digest, style, briefings, draft] = await Promise.all([
    readJson(DIGEST_PATH),
    readJson(STYLE_PATH, {}),
    readJson(BRIEFINGS_PATH, []),
    readDraftMarkdown(reportDate)
  ]);

  const market = extractMarketData(snapshot);
  const news = extractNewsForLLM(digest);
  const freshness = snapshot.freshnessSummary;

  console.log(`Gemini 본문 리라이트 시작 (${reportDate}, 모델: ${REWRITE_MODEL})...`);
  const { json } = await callGeminiJson({
    prompt: buildPrompt(market, news, draft, freshness),
    systemInstruction: buildSystemInstruction(style),
    model: REWRITE_MODEL,
    temperature: 0.4,
    // Korean briefing has 15+ structured fields with markdownBody as a multi-thousand-char body.
    // Need a generous budget; thinking allowed but capped to leave room for output.
    maxOutputTokens: 16384,
    thinkingBudget: 2048,
    responseSchema: REWRITE_RESPONSE_SCHEMA
  });

  // Editorial lint
  const combined = [
    json.title,
    json.headline,
    json.overnightLead,
    json.markdownBody,
    ...(json.highlights || []),
    JSON.stringify(json.timeframeInsights || {})
  ].join("\n");
  const hits = lintForbiddenEndings(combined, style);
  if (hits.length > 0) {
    console.warn(`⚠️ 금지 종결어미 ${hits.length}건 검출 (자동 수정 권장).`);
    hits.slice(0, 5).forEach((hit) => console.warn(`   · '${hit.pattern}'`));
  }

  // Save markdown
  const finalMarkdown = buildFinalMarkdown(reportDate, json, snapshot, news);
  const markdownPath = path.join(POSTS_DIR, `${reportDate}.md`);
  await writeFile(markdownPath, finalMarkdown, "utf8");
  console.log(`Markdown 본문 저장: ${markdownPath}`);

  // Update briefings.json record for this date
  const recordIndex = briefings.findIndex((entry) => entry.date === reportDate);
  if (recordIndex >= 0) {
    const current = briefings[recordIndex];
    current.title = json.title;
    current.headline = json.headline;
    current.overnightLead = json.overnightLead;
    current.topThreeLines = json.topThreeLines || [];
    current.highlights = json.highlights;
    current.keyIssues = json.keyIssues || [];
    current.marketSnapshot = json.marketSnapshot || null;
    current.koreanCheckpoints = json.koreanCheckpoints || [];
    current.causalAnalysis = json.causalAnalysis || [];
    current.forwardOutlook = json.forwardOutlook || [];
    current.timeframeInsights = json.timeframeInsights || null;
    current.positioning = json.positioning || null;
    current.commentary = json.commentary || [];
    current.insightSections = json.insightSections;
    current.tags = (json.tags || current.tags || []).slice(0, 7);
    current.complianceNote = "본 결과물은 정보 제공이며 투자자문이 아닙니다.";
    current.editorialPass = {
      model: REWRITE_MODEL,
      generatedAt: new Date().toISOString(),
      forbiddenHits: hits.length
    };
    briefings[recordIndex] = current;
    await writeFile(BRIEFINGS_PATH, `${JSON.stringify(briefings, null, 2)}\n`, "utf8");
    console.log(`briefings.json 업데이트 완료 (${reportDate})`);
  } else {
    console.warn(`briefings.json에 ${reportDate} 항목이 없어 인덱스 갱신을 건너뜁니다.`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
