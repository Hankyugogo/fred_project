import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "news-sources.json");
const OUTPUT_PATH = path.join(ROOT, "data", "news-digest.json");
const REPORT_DATE_OVERRIDE = process.env.REPORT_DATE_OVERRIDE;

const CATEGORY_LABELS = {
  policy: "정책/연준",
  macro: "매크로 지표",
  markets: "시장 반응",
  corporate: "기업/실적",
  risk: "위험 요인"
};

const CATEGORY_KEYWORDS = {
  policy: [
    "fed", "federal reserve", "fomc", "powell", "rate", "rates", "treasury",
    "yield", "yields", "minutes", "tariff", "white house", "congress"
  ],
  macro: [
    "inflation", "cpi", "pce", "jobs", "payroll", "unemployment", "gdp",
    "consumer", "spending", "income", "manufacturing", "ism", "pmi", "housing"
  ],
  markets: [
    "stocks", "stock", "s&p", "nasdaq", "dow", "wall street", "bond", "bonds",
    "dollar", "oil", "gold", "market", "markets", "futures", "volatility"
  ],
  corporate: [
    "earnings", "profit", "revenue", "guidance", "apple", "microsoft", "nvidia",
    "amazon", "meta", "alphabet", "tesla", "ai", "chip", "chips"
  ],
  risk: [
    "china", "ukraine", "israel", "iran", "shutdown", "debt", "credit",
    "bank", "banks", "default", "geopolitical", "war", "sanction"
  ]
};

const ESTABLISHED_NEWS_SOURCES = new Set([
  "Associated Press",
  "AP",
  "Bloomberg",
  "CNBC",
  "Financial Times",
  "Investing.com",
  "MarketWatch",
  "Reuters",
  "The Wall Street Journal",
  "Wall Street Journal",
  "WSJ",
  "Yahoo Finance"
]);
const LOW_SIGNAL_SOURCES = new Set([
  "Bitget",
  "Coinpedia",
  "CryptoRank",
  "Invezz",
  "MEXC",
  "MEXC Exchange",
  "The Daily Hodl",
  "U.Today",
  "Whalesbook"
]);
const CRYPTO_CENTRIC_SOURCES = new Set([
  "Bitget",
  "Coinpedia",
  "CryptoRank",
  "MEXC",
  "MEXC Exchange",
  "The Daily Hodl",
  "U.Today",
  "Whalesbook"
]);
const LOW_SIGNAL_TITLE_PATTERNS = [
  /\bmy\b/i,
  /\bi['’]ve\b/i,
  /\bmarried\b/i,
  /\bretirement\b/i,
  /\bmillionaire\b/i,
  /\binheritance\b/i,
  /\bhusband\b/i,
  /\bwife\b/i,
  /\btoilet\b/i,
  /\bct scan\b/i,
  /\bsocial security\b/i
];
const CRYPTO_TITLE_PATTERNS = [
  /\bbitcoin\b/i,
  /\bcrypto(?:currency)?\b/i,
  /\beth(?:ereum)?\b/i,
  /\bbtc\b/i,
  /\b비트코인\b/u,
  /\b가상자산\b/u
];
const FED_LEADERSHIP_CLAIM_PATTERNS = [
  /\bwarsh-led fed\b/i,
  /\b(?:warsh|powell replacement|fed chair|fed chairman|fomc chair).{0,90}\b(?:appoint|appointed|appointment|nominate|nominated|nomination|name|named|elect|elected|select|selected|lead|led)\b/i,
  /\b(?:appoint|appointed|appointment|nominate|nominated|nomination|name|named|elect|elected|select|selected).{0,90}\b(?:fed chair|fed chairman|fomc chair|federal reserve chair)\b/i,
  /\bwarsh.{0,140}(?:federal reserve|fomc|federal open market committee|board of governors).{0,140}(?:chair|chairman)\b/i,
  /\bwarsh.{0,140}(?:takes oath|selected|selects|chairman)\b/i
];

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

function validateDateOverride(value) {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("REPORT_DATE_OVERRIDE must be in YYYY-MM-DD format.");
  }

  return value;
}

function decodeEntities(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, key) => named[key] || match)
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decodeEntities(value.replace(/<[^>]*>/g, " "));
}

function getTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function getAtomLink(block) {
  const match = block.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? decodeEntities(match[1]) : "";
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function splitBlocks(xml, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, "gi");
  let match = regex.exec(xml);

  while (match) {
    blocks.push(match[0]);
    match = regex.exec(xml);
  }

  return blocks;
}

function parseFeedItems(xml, source) {
  const rssItems = splitBlocks(xml, "item").map((block) => {
    const title = stripTags(getTag(block, "title"));
    const link = stripTags(getTag(block, "link"));
    const pubDate = stripTags(getTag(block, "pubDate") || getTag(block, "dc:date"));
    const description = stripTags(getTag(block, "description") || getTag(block, "summary"));

    return { title, link, pubDate, description };
  });

  const atomItems = rssItems.length > 0 ? [] : splitBlocks(xml, "entry").map((block) => {
    const title = stripTags(getTag(block, "title"));
    const link = getAtomLink(block) || stripTags(getTag(block, "link"));
    const pubDate = stripTags(getTag(block, "published") || getTag(block, "updated"));
    const description = stripTags(getTag(block, "summary") || getTag(block, "content"));

    return { title, link, pubDate, description };
  });

  return [...rssItems, ...atomItems]
    .filter((item) => item.title)
    .map((item) => normalizeNewsItem(item, source));
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/[^a-z0-9가-힣]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferGoogleSource(title) {
  const parts = title.split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function removeGoogleSource(title) {
  return title.replace(/\s+-\s+[^-]+$/u, "").trim();
}

function categorize(title, description, fallback) {
  const text = `${title} ${description}`.toLowerCase();
  const scores = Object.fromEntries(Object.keys(CATEGORY_KEYWORDS).map((key) => [key, 0]));

  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    words.forEach((word) => {
      if (text.includes(word)) {
        scores[category] += 1;
      }
    });
  }

  scores[fallback] = (scores[fallback] || 0) + 0.2;
  return Object.entries(scores).sort((left, right) => right[1] - left[1])[0][0];
}

function scoreItem(item, source) {
  const ageHours = item.publishedAt
    ? Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 3600000)
    : 48;
  const freshness = Math.max(0, 20 - Math.min(20, ageHours / 3));
  const categoryBoost = item.category === "policy" || item.category === "macro" ? 7 : item.category === "markets" ? 5 : item.category === "risk" ? 4 : 1;
  const titleBoost = /fed|federal reserve|powell|inflation|jobs|payroll|gdp|treasury|yield|s&p|nasdaq|dow|oil|dollar/i.test(item.title)
    ? 5
    : 0;
  const sourcePenalty = LOW_SIGNAL_SOURCES.has(item.source) || item.credibility === "low" ? 10 : 0;
  const cryptoPenalty = item.topicFlags?.includes("crypto") ? 8 : 0;
  const claimPenalty = item.claimRisk === "high" ? 45 : item.claimRisk === "medium" ? 12 : 0;

  return Math.round((source.weight || 5) + freshness + categoryBoost + titleBoost - sourcePenalty - cryptoPenalty - claimPenalty);
}

function inferCredibility(sourceName, source) {
  if (source.type === "official") return "official";
  if (source.type === "market-news") return "established";
  if (ESTABLISHED_NEWS_SOURCES.has(sourceName)) return "established";
  if (LOW_SIGNAL_SOURCES.has(sourceName)) return "low";
  return source.type === "news-search" ? "standard" : "standard";
}

function assessClaimPolicy({ title, description, sourceName, source, credibility }) {
  const text = `${title} ${description}`;
  const reasons = [];
  const topicFlags = [];
  const trustedForSensitiveClaims = credibility === "official" || credibility === "established";

  if (CRYPTO_CENTRIC_SOURCES.has(sourceName) || CRYPTO_TITLE_PATTERNS.some((pattern) => pattern.test(text))) {
    topicFlags.push("crypto");
  }

  if (FED_LEADERSHIP_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push("sensitive_fed_leadership_claim");
  }

  if (reasons.length > 0 && !trustedForSensitiveClaims) {
    return {
      credibility,
      claimRisk: "high",
      usePolicy: "withhold_from_llm",
      claimRiskReasons: reasons,
      topicFlags
    };
  }

  if (topicFlags.includes("crypto") && credibility === "low") {
    return {
      credibility,
      claimRisk: "medium",
      usePolicy: "context_only",
      claimRiskReasons: ["crypto_centric_low_signal_source"],
      topicFlags
    };
  }

  return {
    credibility,
    claimRisk: reasons.length > 0 ? "medium" : "low",
    usePolicy: "allow",
    claimRiskReasons: reasons,
    topicFlags
  };
}

function normalizeNewsItem(raw, source) {
  const inferredSource = source.id.startsWith("google") ? inferGoogleSource(raw.title) : "";
  const title = source.id.startsWith("google") ? removeGoogleSource(raw.title) : raw.title;
  const published = parseDate(raw.pubDate);
  const category = categorize(title, raw.description, source.category);
  const sourceName = inferredSource || source.label;
  const credibility = inferCredibility(sourceName, source);
  const policy = assessClaimPolicy({
    title,
    description: raw.description || "",
    sourceName,
    source,
    credibility
  });
  const item = {
    id: `${source.id}:${normalizeTitle(title).slice(0, 80)}`,
    title,
    link: raw.link,
    sourceId: source.id,
    source: sourceName,
    sourceType: source.type,
    category,
    categoryLabel: CATEGORY_LABELS[category] || "기타",
    publishedAt: published ? published.toISOString() : null,
    description: raw.description ? raw.description.slice(0, 280) : "",
    credibility: policy.credibility,
    claimRisk: policy.claimRisk,
    usePolicy: policy.usePolicy,
    claimRiskReasons: policy.claimRiskReasons,
    topicFlags: policy.topicFlags
  };

  return {
    ...item,
    importance: scoreItem(item, source)
  };
}

function isLowSignalTitle(title) {
  return LOW_SIGNAL_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "Mozilla/5.0 fred-market-briefing/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function withinMaxAge(item, maxAgeHours) {
  if (!item.publishedAt) {
    return true;
  }

  const ageHours = (Date.now() - new Date(item.publishedAt).getTime()) / 3600000;
  return ageHours <= maxAgeHours;
}

function dedupeItems(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function isPromotableItem(item) {
  return item.usePolicy !== "withhold_from_llm";
}

function buildThemes(items) {
  const byCategory = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
    const categoryItems = items
      .filter((item) => item.category === category)
      .sort((left, right) => right.importance - left.importance)
      .slice(0, 5);

    return { category, label, items: categoryItems };
  }).filter((section) => section.items.length > 0);

  return byCategory.map((section) => {
    const lead = section.items[0];
    const sourceList = [...new Set(section.items.map((item) => item.source))].slice(0, 3).join(", ");
    const summary = `${section.label} 흐름에서는 '${lead.title}'가 가장 높은 우선순위로 잡혔습니다. 관련 출처는 ${sourceList || "확인 필요"}입니다.`;

    return {
      category: section.category,
      label: section.label,
      summary,
      items: section.items
    };
  });
}

function buildEditorialSummary(themes, failures) {
  if (themes.length === 0) {
    return "수집 가능한 뉴스가 부족해 오늘 브리핑은 주요 지표 중심으로 해석해야 합니다.";
  }

  const labels = themes.slice(0, 3).map((theme) => theme.label).join(", ");
  const failureLine = failures.length > 0
    ? ` 일부 피드 ${failures.length}건은 응답 실패라 출처 폭은 제한됩니다.`
    : "";

  return `오늘 뉴스 흐름은 ${labels} 축을 우선 확인해야 합니다.${failureLine}`;
}

async function fetchSource(source, defaults) {
  const xml = await fetchWithTimeout(source.url, source.timeoutMs || 12000);
  const items = parseFeedItems(xml, source)
    .filter((item) => !isLowSignalTitle(item.title))
    .filter((item) => withinMaxAge(item, source.maxAgeHours || defaults.maxAgeHours))
    .sort((left, right) => right.importance - left.importance)
    .slice(0, source.maxItemsPerSource || defaults.maxItemsPerSource);

  return {
    sourceId: source.id,
    label: source.label,
    ok: true,
    itemCount: items.length,
    items
  };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const defaults = config.defaults || {};
  const generatedAt = new Date();
  const reportDate = validateDateOverride(REPORT_DATE_OVERRIDE)
    || toTimeZoneDateString(generatedAt, defaults.reportTimeZone || "Asia/Seoul");
  const results = await Promise.allSettled(config.feeds.map((source) => fetchSource(source, defaults)));
  const sourceReports = [];
  const failures = [];
  const items = [];

  results.forEach((result, index) => {
    const source = config.feeds[index];
    if (result.status === "fulfilled") {
      sourceReports.push({
        id: source.id,
        label: source.label,
        ok: true,
        itemCount: result.value.itemCount
      });
      items.push(...result.value.items);
      return;
    }

    sourceReports.push({
      id: source.id,
      label: source.label,
      ok: false,
      itemCount: 0,
      error: result.reason?.message || "unknown_error"
    });
    failures.push({
      id: source.id,
      label: source.label,
      error: result.reason?.message || "unknown_error"
    });
  });

  const uniqueItems = dedupeItems(items).sort((left, right) => {
    if (right.importance !== left.importance) {
      return right.importance - left.importance;
    }

    return String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""));
  });
  const promotableItems = uniqueItems.filter(isPromotableItem);
  const themes = buildThemes(promotableItems.length ? promotableItems : uniqueItems);
  const withheldItems = uniqueItems
    .filter((item) => !isPromotableItem(item))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      reasons: item.claimRiskReasons,
      usePolicy: item.usePolicy
    }));
  const payload = {
    generatedAt: generatedAt.toISOString(),
    reportDate,
    sourceHealth: {
      okCount: sourceReports.filter((item) => item.ok).length,
      failedCount: sourceReports.filter((item) => !item.ok).length,
      sources: sourceReports
    },
    editorialSummary: buildEditorialSummary(themes, failures),
    themes,
    topItems: promotableItems.slice(0, 15),
    items: uniqueItems,
    guardrails: {
      withheldCount: withheldItems.length,
      withheldItems
    },
    failures
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote news digest to ${OUTPUT_PATH}`);
  console.log(`Collected ${payload.items.length} items from ${payload.sourceHealth.okCount}/${sourceReports.length} sources`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
