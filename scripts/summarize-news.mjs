// Translate and summarize English RSS headlines into Korean economic-newspaper style.
// Reads data/news-digest.json, calls Gemini with a structured JSON prompt,
// adds koreanTitle/koreanSummary to every item, replaces theme/editorial summaries.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { callGeminiJson } from "./lib/gemini-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIGEST_PATH = path.join(ROOT, "data", "news-digest.json");
const STYLE_PATH = path.join(ROOT, "config", "editorial-style.json");

const SUMMARIZE_MODEL = process.env.GEMINI_SUMMARIZE_MODEL || "gemini-2.5-flash";
const SUMMARY_ITEM_LIMIT = Number(process.env.GEMINI_SUMMARY_ITEM_LIMIT || 8);

const SOURCE_KOREAN_MAP = {
  "Federal Reserve": "연방준비제도",
  "Fed Speeches": "연준 연설",
  "MarketWatch Top Stories": "마켓워치",
  "MarketWatch MarketPulse": "마켓워치",
  "MarketWatch Realtime": "마켓워치",
  "The Wall Street Journal": "월스트리트저널",
  "WSJ": "월스트리트저널",
  "The Washington Post": "워싱턴포스트",
  "Bloomberg": "블룸버그",
  "Reuters": "로이터",
  "Financial Times": "파이낸셜타임스",
  "CNBC": "CNBC",
  "Investopedia": "인베스토피디아",
  "The Economic Times": "이코노믹타임스",
  "Wealth Professional Canada": "웰스프로페셔널 캐나다",
  "MEXC Exchange": "MEXC",
  "CryptoRank": "크립토랭크",
  "Yahoo Finance": "야후파이낸스",
  "WBFF": "WBFF",
  "富途牛牛": "푸투뉴뉴"
};

function buildSystemInstruction(style) {
  return [
    "너는 한국 경제지 조선비즈 마감시황의 데일리 뉴스 데스크 에디터다.",
    "영문 헤드라인과 1줄 설명을 한국 경제지에 그대로 실릴 만한 한국어 제목과 본문 요약으로 옮긴다.",
    "다음 규칙을 반드시 지킨다.",
    "1) 한국어 제목은 30자 이내로 사실 중심. 큰따옴표·말장난·이모지 사용 금지.",
    "2) 한국어 본문 요약은 2~3문장. 첫 문장은 사실, 둘째 문장은 배경 또는 시장 함의, 가능하면 셋째 문장에 한국 시장이나 투자자에게 주는 시사점.",
    "3) 종결어미는 '거래를 마쳤다 / 기록했다 / 나타났다 / 마감했다 / 분석된다 / 전망된다 / 평가된다 / 주목된다'를 우선 사용. '~인 모습이다, ~로 보인다, ~할 수 있다, ~인 편이다, ~한 편이 좋다' 금지.",
    "4) 영어 단어를 한국어 본문에 그대로 노출하지 않는다. 'S&P 500'은 'S&P500', 'Nasdaq'은 '나스닥 종합지수', 'Fed'는 '연방준비제도(연준)', 'FOMC'는 '연방공개시장위원회(FOMC)', 'CPI'는 '소비자물가지수(CPI)', 'PCE'는 '개인소비지출 물가지수(PCE)', 'GDP'는 '국내총생산(GDP)', 'WTI'는 '서부텍사스산원유(WTI)', 'BOJ'는 '일본은행', 'BoE'는 '영란은행', 'BoC'는 '캐나다은행' 등 한국 언론 표기를 따른다.",
    "5) 번역투('~에 따르면', '~의 측면에서', '~을 가지고 있다', '~을 보여주고 있다', '다소', '최근 몇 달 동안')를 쓰지 않는다.",
    "6) 일반 라이프스타일·금융상품 안내 기사 등 매크로/시장과 무관한 기사는 koreanSummary 첫 문장에 '시장 직접 영향은 제한적이다'를 명시한 뒤 사실만 한 문장으로 요약한다.",
    "7) 모든 출력은 반드시 요청된 JSON 스키마에 맞춰 반환한다. 키 외 다른 텍스트는 출력하지 않는다.",
    style?.voice ? `에디터 톤 가이드: ${style.voice}` : ""
  ].filter(Boolean).join("\n");
}

function getCleanItemMap(digest) {
  const map = new Map();
  const collect = (item) => {
    if (!item || !item.id || map.has(item.id)) return;
    map.set(item.id, {
      id: item.id,
      title: item.title,
      source: item.source,
      sourceKorean: SOURCE_KOREAN_MAP[item.source] || item.source,
      category: item.category,
      categoryLabel: item.categoryLabel,
      description: item.description || "",
      publishedAt: item.publishedAt
    });
  };
  (digest.topItems || []).forEach(collect);
  (digest.themes || []).forEach((theme) => (theme.items || []).forEach(collect));
  return map;
}

function buildItemPrompt(items) {
  const payload = items.map((item) => ({
    id: item.id,
    sourceEnglish: item.source,
    sourceKorean: item.sourceKorean,
    category: item.categoryLabel,
    publishedAt: item.publishedAt,
    headline: item.title,
    description: item.description
  }));

  return [
    "다음은 미국 경제·시장 관련 영문 뉴스 헤드라인이다.",
    "각 항목을 한국 경제지 조선비즈 마감시황 톤의 한국어 제목과 본문 요약으로 옮겨라.",
    "요청 JSON:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "응답 JSON 스키마:",
    "{",
    '  "items": [',
    "    {",
    '      "id": "...",',
    '      "koreanTitle": "30자 이내 한국어 제목",',
    '      "koreanSummary": "2~3문장의 한국어 본문 요약"',
    "    }",
    "  ]",
    "}",
    "응답 외 다른 텍스트는 절대 출력하지 마라."
  ].join("\n");
}

function buildThemePrompt(themes) {
  const payload = themes.map((theme) => ({
    category: theme.category,
    label: theme.label,
    headlines: (theme.items || []).slice(0, 5).map((item) => ({
      title: item.title,
      source: SOURCE_KOREAN_MAP[item.source] || item.source,
      description: item.description || ""
    }))
  }));

  return [
    "다음은 카테고리별 미국 시장 뉴스 묶음이다.",
    "각 카테고리에 대해 조선비즈 마감시황 톤으로 1~2문장 한국어 요약을 작성하라.",
    "기사 제목을 영어 그대로 인용하지 말고, 카테고리 안에서 가장 중요한 흐름을 한국 경제지 톤으로 정리한다.",
    "요청 JSON:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "응답 JSON 스키마:",
    "{",
    '  "themes": [',
    '    { "category": "...", "koreanSummary": "1~2문장 한국어 요약" }',
    "  ],",
    '  "editorialSummary": "전체 뉴스 흐름을 2문장으로 압축한 데일리 데스크 한 줄"',
    "}",
    "응답 외 다른 텍스트는 절대 출력하지 마라."
  ].join("\n");
}

const ITEM_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          koreanTitle: { type: "STRING" },
          koreanSummary: { type: "STRING" }
        },
        required: ["id", "koreanTitle", "koreanSummary"]
      }
    }
  },
  required: ["items"]
};

const THEME_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    themes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          koreanSummary: { type: "STRING" }
        },
        required: ["category", "koreanSummary"]
      }
    },
    editorialSummary: { type: "STRING" }
  },
  required: ["themes", "editorialSummary"]
};

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function summarizeItems(items, systemInstruction) {
  // Keep the daily pipeline to one Gemini call by default. The report writer can still use
  // raw English titles for lower-priority items, and this preserves quota for final rewrite.
  const selected = items.slice(0, Math.max(0, SUMMARY_ITEM_LIMIT));
  const chunks = selected.length ? [selected] : [];
  const merged = new Map();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    process.stderr.write(`  - 요약 batch ${i + 1}/${chunks.length} (${chunk.length}건)...\n`);
    try {
      const { json } = await callGeminiJson({
        prompt: buildItemPrompt(chunk),
        systemInstruction,
        model: SUMMARIZE_MODEL,
        temperature: 0.35,
        maxOutputTokens: 8192,
        thinkingBudget: 0,
        responseSchema: ITEM_RESPONSE_SCHEMA
      });
      (json.items || []).forEach((entry) => {
        if (entry?.id) merged.set(entry.id, entry);
      });
    } catch (error) {
      process.stderr.write(`    ⚠️ batch ${i + 1} 실패: ${error.message}\n`);
      // Continue with remaining batches; we'll save what we have.
    }
  }
  return merged;
}

async function summarizeThemes(themes, systemInstruction) {
  if (themes.length === 0) {
    return { themeMap: new Map(), editorialSummary: null };
  }
  process.stderr.write(`  - 카테고리 요약(${themes.length}개) 생성...\n`);
  try {
    const { json } = await callGeminiJson({
      prompt: buildThemePrompt(themes),
      systemInstruction,
      model: SUMMARIZE_MODEL,
      temperature: 0.35,
      // Korean text is verbose in tokens; allow plenty of headroom for 4 themes + editorial line.
      maxOutputTokens: 4096,
      thinkingBudget: 0,
      responseSchema: THEME_RESPONSE_SCHEMA
    });
    const themeMap = new Map();
    (json.themes || []).forEach((entry) => {
      if (entry?.category) themeMap.set(entry.category, entry.koreanSummary);
    });
    return { themeMap, editorialSummary: json.editorialSummary || null };
  } catch (error) {
    process.stderr.write(`    ⚠️ 카테고리 요약 실패 (계속 진행): ${error.message}\n`);
    return { themeMap: new Map(), editorialSummary: null };
  }
}

function applySummaries(digest, summaryMap, themeMap, editorialSummary) {
  const apply = (item) => {
    if (!item) return item;
    const found = summaryMap.get(item.id);
    if (found) {
      item.koreanTitle = found.koreanTitle;
      item.koreanSummary = found.koreanSummary;
    }
    item.sourceKorean = SOURCE_KOREAN_MAP[item.source] || item.source;
    return item;
  };

  if (Array.isArray(digest.topItems)) {
    digest.topItems = digest.topItems.map(apply);
  }
  if (Array.isArray(digest.themes)) {
    digest.themes = digest.themes.map((theme) => {
      if (Array.isArray(theme.items)) {
        theme.items = theme.items.map(apply);
      }
      const themeKo = themeMap.get(theme.category);
      if (themeKo) {
        theme.koreanSummary = themeKo;
      }
      return theme;
    });
  }
  if (editorialSummary) {
    digest.koreanEditorialSummary = editorialSummary;
  }
  digest.koreanizedAt = new Date().toISOString();
  return digest;
}

async function main() {
  const [digestText, styleText] = await Promise.all([
    readFile(DIGEST_PATH, "utf8"),
    readFile(STYLE_PATH, "utf8").catch(() => "{}")
  ]);
  const digest = JSON.parse(digestText);
  const style = JSON.parse(styleText);

  const itemMap = getCleanItemMap(digest);
  const items = Array.from(itemMap.values());
  if (items.length === 0) {
    console.log("뉴스 항목이 없어 요약을 생략합니다.");
    return;
  }

  console.log(`뉴스 ${items.length}건을 한국어로 변환합니다 (모델: ${SUMMARIZE_MODEL}).`);

  const systemInstruction = buildSystemInstruction(style);

  // Sequential execution so partial progress is preserved even if a later step fails.
  const summaryMap = await summarizeItems(items, systemInstruction);
  const themeResult = { themeMap: new Map(), editorialSummary: null };

  applySummaries(digest, summaryMap, themeResult.themeMap, themeResult.editorialSummary);

  await writeFile(DIGEST_PATH, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  console.log(`뉴스 한국어 요약을 ${DIGEST_PATH}에 반영했습니다.`);
  console.log(`- 항목별 koreanTitle/koreanSummary: ${summaryMap.size}건`);
  console.log(`- 카테고리 koreanSummary: ${themeResult.themeMap.size}건`);
  if (themeResult.editorialSummary) {
    console.log(`- 데스크 한 줄: ${themeResult.editorialSummary}`);
  }
  if (items.length > SUMMARY_ITEM_LIMIT) {
    console.warn(`⚠️ Gemini 호출 절감을 위해 상위 ${SUMMARY_ITEM_LIMIT}건만 한국어 요약했습니다. 나머지는 원문 제목을 유지합니다.`);
  }
  if (summaryMap.size === 0) {
    console.warn("⚠️ 뉴스 요약이 실패했습니다. 원문 제목을 유지하고 파이프라인은 계속 진행합니다.");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
