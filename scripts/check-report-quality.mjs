import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const NEWS_PATH = path.join(ROOT, "data", "news-digest.json");
const STOCK_WATCHLIST_PATH = path.join(ROOT, "data", "stock-watchlist.json");
const POSTS_DIR = path.join(ROOT, "posts");
const MIN_DATA_QUALITY_SCORE = Number(process.env.MIN_DATA_QUALITY_SCORE || 50);

const TRUSTED_NEWS_SOURCES = new Set([
  "Associated Press",
  "AP",
  "Bloomberg",
  "CNBC",
  "Federal Reserve",
  "Fed Speeches",
  "Financial Times",
  "Investing.com",
  "MarketWatch",
  "Reuters",
  "The Wall Street Journal",
  "Wall Street Journal",
  "WSJ",
  "Yahoo Finance",
  "연방준비제도",
  "연준 연설",
  "마켓워치",
  "로이터",
  "블룸버그",
  "월스트리트저널"
]);

const SENSITIVE_CLAIM_PATTERNS = [
  /(케빈\s*워시|워시).{0,80}(연준|연방준비제도|FOMC).{0,80}(의장|임명|선출|지명)/u,
  /(연준|연방준비제도).{0,30}의장.{0,30}(임명|선출|지명)/u,
  /\bwarsh-led fed\b/i,
  /\b(?:warsh|powell replacement|fed chair|fed chairman|fomc chair).{0,90}\b(?:appoint|appointed|appointment|nominate|nominated|nomination|name|named|elect|elected|select|selected|lead|led)\b/i,
  /\bwarsh.{0,140}(?:federal reserve|fomc|federal open market committee|board of governors).{0,140}(?:chair|chairman)\b/i,
  /\bwarsh.{0,140}(?:takes oath|selected|selects|chairman)\b/i
];

function readJson(file, fallback = null) {
  if (!existsSync(file)) return Promise.resolve(fallback);
  return readFile(file, "utf8").then((text) => JSON.parse(text));
}

async function readTextOptional(file) {
  if (!existsSync(file)) return "";
  return readFile(file, "utf8");
}

function itemText(item) {
  return [
    item?.title,
    item?.koreanTitle,
    item?.description,
    item?.summary,
    item?.koreanSummary
  ].filter(Boolean).join(" ");
}

function isTrustedItem(item) {
  if (item?.sourceType === "official" || item?.credibility === "official" || item?.credibility === "established") {
    return true;
  }
  return TRUSTED_NEWS_SOURCES.has(item?.sourceKorean || item?.source || "");
}

function hasTrustedSensitiveSupport(news) {
  const items = [
    ...(news?.topItems || []),
    ...(news?.themes || []).flatMap((theme) => theme.items || []),
    ...(news?.items || [])
  ];
  return items.some((item) =>
    isTrustedItem(item) && SENSITIVE_CLAIM_PATTERNS.some((pattern) => pattern.test(itemText(item)))
  );
}

function buildBlockedTerms(snapshot) {
  const ids = snapshot?.analysis?.dataQuality?.blockedNarrativeIds || [];
  const labels = snapshot?.analysis?.dataQuality?.blockedNarrativeLabels || [];
  const termsById = {
    DEXKOUS: ["달러/원", "원달러"],
    DTWEXBGS: ["달러지수", "DXY", "광의 달러지수"],
    DEXJPUS: ["달러/엔", "달러엔"],
    DCOILWTICO: ["WTI", "서부텍사스산원유"],
    DCOILBRENTEU: ["브렌트유"]
  };
  const terms = new Set(labels);
  ids.forEach((id) => (termsById[id] || []).forEach((term) => terms.add(term)));
  return Array.from(terms);
}

function findKospiValue(stockWatchlist) {
  const stocks = Array.isArray(stockWatchlist?.stocks) ? stockWatchlist.stocks : [];
  const kospi = stocks.find((item) => item.ticker === "^KS11");
  if (Number.isFinite(kospi?.quote?.price)) return kospi.quote.price;
  const signal = stockWatchlist?.macroBackdrop?.signals?.find((item) => /코스피/.test(item.label || ""));
  return Number.isFinite(signal?.value) ? signal.value : null;
}

function checkSensitiveClaims(text, news, issues) {
  if (hasTrustedSensitiveSupport(news)) return;
  SENSITIVE_CLAIM_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) {
      issues.push("공식·주요 출처로 지지되지 않은 연준 인사/의장 관련 확정 표현이 있습니다.");
    }
  });
}

function checkBlockedNarrativeTerms(text, snapshot, issues) {
  const caveatPattern = /기준일|늦|오래|제외|제한|보충|확인|지연/u;
  buildBlockedTerms(snapshot).forEach((term) => {
    let index = text.indexOf(term);
    while (index >= 0) {
      const context = text.slice(Math.max(0, index - 70), index + term.length + 70);
      if (!caveatPattern.test(context)) {
        issues.push(`오래된 보조 지표 "${term}"이 기준일·제한 문구 없이 사용됐습니다.`);
        return;
      }
      index = text.indexOf(term, index + term.length);
    }
  });
}

function checkKospiGrounding(text, stockWatchlist, issues) {
  const realKospi = findKospiValue(stockWatchlist);
  if (!Number.isFinite(realKospi)) return;
  const lo = realKospi * 0.75;
  const hi = realKospi * 1.25;
  const re = /코스피(?:200|\s*지수)?[^\d\n]{0,12}([0-9]{1,3}(?:,[0-9]{3}|[0-9]{2,3})(?:\.\d+)?)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (value < lo || value > hi) {
      issues.push(`코스피 수치 "${match[0]}"가 입력값 ${realKospi.toFixed(0)}와 25% 이상 차이납니다.`);
    }
  }
}

function flattenSnapshotItems(snapshot) {
  return (snapshot?.groups || []).flatMap((group) => group.items || []);
}

function hasFreshSupplement(item) {
  const supplementary = item?.supplementary;
  if (!supplementary) return false;
  if (!Number.isFinite(Number(supplementary.value))) return false;
  if (!supplementary.observationDate) return false;
  return String(supplementary.observationDate) > String(item?.observationDate || "");
}

function checkDataFreshnessFloor(snapshot, issues) {
  const quality = snapshot?.analysis?.dataQuality;
  if (!quality) return;
  const coreIds = new Set(["SP500", "NASDAQCOM", "DJIA", "DGS2", "DGS10", "VIXCLS"]);
  const contextStaleWithoutSupplement = flattenSnapshotItems(snapshot)
    .filter((item) => !coreIds.has(item.id))
    .filter((item) => !item.derived)
    .filter((item) => item?.freshness?.status === "stale")
    .filter((item) => !hasFreshSupplement(item));

  if (quality.publicationStatus === "hold" || quality.coreStaleCount > 0) {
    issues.push("핵심 판단 지표가 오래돼 자동 발행 보류 상태입니다.");
  }

  if (Number.isFinite(quality.score) && quality.score < MIN_DATA_QUALITY_SCORE) {
    issues.push(`데이터 품질 점수 ${quality.score}/100이 최소 기준 ${MIN_DATA_QUALITY_SCORE}보다 낮습니다.`);
  }

  if ((quality.coreDelayedCount || 0) >= 3) {
    issues.push(`핵심 판단 지표 ${quality.coreDelayedCount}건이 지연돼 보강 시세 확인 전 발행하기 어렵습니다.`);
  }

  if (contextStaleWithoutSupplement.length >= 2) {
    issues.push(`보조 해석용 시계열 ${contextStaleWithoutSupplement.length}건이 오래돼 보고서 해석 범위를 과도하게 제한합니다.`);
  }
}

function pickNarrativeFields(briefing) {
  const newsBrief = briefing?.newsBrief ? {
    koreanEditorialSummary: briefing.newsBrief.koreanEditorialSummary || briefing.newsBrief.editorialSummary || "",
    topItems: briefing.newsBrief.topItems || [],
    themes: (briefing.newsBrief.themes || []).map((theme) => ({
      category: theme.category,
      label: theme.label,
      koreanSummary: theme.koreanSummary || theme.summary || "",
      items: theme.items || []
    }))
  } : null;

  return {
    title: briefing?.title,
    headline: briefing?.headline,
    overnightLead: briefing?.overnightLead,
    highlights: briefing?.highlights,
    topThreeLines: briefing?.topThreeLines,
    keyIssues: briefing?.keyIssues,
    marketSnapshot: briefing?.marketSnapshot,
    koreanCheckpoints: briefing?.koreanCheckpoints,
    causalAnalysis: briefing?.causalAnalysis,
    forwardOutlook: briefing?.forwardOutlook,
    timeframeInsights: briefing?.timeframeInsights,
    positioning: briefing?.positioning,
    commentary: briefing?.commentary,
    insightSections: briefing?.insightSections,
    newsBrief
  };
}

async function main() {
  const [snapshot, briefings, news, stockWatchlist] = await Promise.all([
    readJson(SNAPSHOT_PATH),
    readJson(BRIEFINGS_PATH, []),
    readJson(NEWS_PATH, null),
    readJson(STOCK_WATCHLIST_PATH, null)
  ]);

  const reportDate = snapshot?.reportDate || briefings[0]?.date;
  const briefing = briefings.find((entry) => entry.date === reportDate) || briefings[0];
  if (!briefing) throw new Error("검사할 briefing record가 없습니다.");

  const markdown = await readTextOptional(path.join(POSTS_DIR, `${briefing.date}.md`));
  const text = `${JSON.stringify(pickNarrativeFields(briefing), null, 2)}\n${markdown}`;
  const issues = [];

  checkSensitiveClaims(text, news, issues);
  checkBlockedNarrativeTerms(text, snapshot, issues);
  checkKospiGrounding(text, stockWatchlist, issues);
  checkDataFreshnessFloor(snapshot, issues);

  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length > 0) {
    console.error(`Report quality check failed (${briefing.date}):`);
    uniqueIssues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Report quality check passed (${briefing.date}).`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
