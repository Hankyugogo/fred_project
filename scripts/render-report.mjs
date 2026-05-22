// scripts/render-report.mjs — entry point.
//
// Reads data/* JSON files and emits the editorial report HTML.
// All rendering logic lives in scripts/render-report/{utils,styles,sections}.mjs.
//
// Usage:
//   node scripts/render-report.mjs                          # latest briefing → report.html
//   node scripts/render-report.mjs --date 2026-05-06        # specific date
//   REPORT_DATE_OVERRIDE=2026-05-06 node scripts/render-report.mjs
//
// Optional data (gracefully missing):
//   data/macro-history.json    — 5y daily series → enables 1주/1개월/1년 비교
//                                 AND the 10Y-2Y vs NASDAQ overlay chart
//                                 (fetch via: node scripts/fetch-macro-history.mjs)
//   data/stock-watchlist.json  — enables §09 워치리스트
//                                 (build via: npm run build:stocks)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyPreferredTermsToText, loadPreferredReplacements } from "./editorial-copy.mjs";
import { reportStyles } from "./render-report/styles.mjs";
import {
  renderTape, renderMasthead, renderIndexMatrix, renderVerdicts,
  renderDataAndCurve, renderIssues, renderSectors, renderTimeline,
  renderPositioning, renderEssay, renderWatchlist, renderFreshness, renderColophon
} from "./render-report/sections.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const MACRO_HISTORY_PATH = path.join(ROOT, "data", "macro-history.json");
const STOCK_WATCHLIST_PATH = path.join(ROOT, "data", "stock-watchlist.json");
const REPORTS_DIR = path.join(ROOT, "reports");
const LATEST_REPORT_PATH = path.join(ROOT, "report.html");
const REPORT_DATE_OVERRIDE = process.env.REPORT_DATE_OVERRIDE;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

async function readJSON(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
async function readJSONOptional(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

function escapeForTitle(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml({ snapshot, briefing, macroHistory, stockWatchlist }) {
  const title = briefing?.title
    ? `${briefing.title} · ${briefing.date} | FRED Market Briefing`
    : `FRED Market Briefing · ${snapshot.reportDate || ""}`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeForTitle(title)}</title>
<meta name="description" content="${escapeForTitle(briefing?.overnightLead || "FRED 기반 일일 시장 브리핑")}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,700;0,8..60,800;0,8..60,900;1,8..60,400&family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
${reportStyles()}
</head>
<body>
${renderTape(snapshot)}
${renderMasthead(snapshot, briefing)}
<main>
${renderIndexMatrix(snapshot, briefing, macroHistory)}
${renderVerdicts(snapshot)}
${renderDataAndCurve(snapshot, macroHistory)}
${renderIssues(briefing)}
${renderSectors(snapshot)}
${renderTimeline(snapshot, briefing)}
${renderPositioning(briefing)}
${renderEssay(briefing)}
${renderWatchlist(stockWatchlist)}
${renderFreshness(snapshot)}
</main>
${renderColophon(snapshot, briefing)}
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const snapshot = await readJSON(SNAPSHOT_PATH);
  const briefings = await readJSON(BRIEFINGS_PATH);
  const macroHistory = await readJSONOptional(MACRO_HISTORY_PATH);
  const stockWatchlist = await readJSONOptional(STOCK_WATCHLIST_PATH);

  const targetDate = args.date || REPORT_DATE_OVERRIDE || snapshot.reportDate || briefings[0]?.date;
  const briefing = briefings.find((b) => b.date === targetDate) || briefings[0];
  if (!briefing) throw new Error("No briefing record found. Run publish first.");

  if (!macroHistory) {
    console.warn("[render-report] data/macro-history.json 없음 — 1주/1개월/1년 비교 + 10Y-2Y vs 나스닥 차트가 비활성화됩니다. 해결: node scripts/fetch-macro-history.mjs");
  }
  if (!stockWatchlist) {
    console.warn("[render-report] data/stock-watchlist.json 없음 — §09 워치리스트 섹션은 비활성화됩니다. 해결: npm run build:stocks");
  }

  const replacements = await loadPreferredReplacements(ROOT);
  const html = applyPreferredTermsToText(buildHtml({ snapshot, briefing, macroHistory, stockWatchlist }), replacements);
  const reportPath = path.join(REPORTS_DIR, `${briefing.date}.html`);
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(reportPath, html, "utf8");
  await writeFile(LATEST_REPORT_PATH, html, "utf8");

  console.log(`[render-report] wrote ${reportPath}`);
  console.log(`[render-report] updated ${LATEST_REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
