// scripts/notify-build-payload.mjs — Build the notification payload from briefings.json.
//
// Reads data/briefings.json (latest entry) and outputs key fields to
// $GITHUB_OUTPUT so that downstream notification steps (email, telegram)
// can use them via ${{ steps.payload.outputs.<key> }}.
//
// Outputs:
//   subject         — Email subject line
//   summary_text    — Plain text summary (1~2 lines, ~200 chars)
//   summary_md      — Markdown-flavored summary for Telegram (with line breaks)
//   report_url      — GitHub Pages URL to the latest report
//   report_date     — YYYY-MM-DD
//   has_report      — "true" if a report.html exists
//
// Usage in workflow:
//   - run: node scripts/notify-build-payload.mjs >> $GITHUB_OUTPUT
//     env:
//       PAGES_BASE_URL: https://hankyugogo.github.io/fred_project

import { readFile } from "node:fs/promises";
import { existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const REPORT_PATH = path.join(ROOT, "report.html");
const PAGES_BASE_URL = process.env.PAGES_BASE_URL || "https://hankyugogo.github.io/fred_project";

function escapeMultiline(value) {
  // GITHUB_OUTPUT requires multiline values via heredoc syntax.
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function emitOutput(key, value) {
  const line = `${key}=${escapeMultiline(value)}\n`;
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, line);
  else process.stdout.write(line);
}

function emitMultiline(key, value) {
  const sep = "EOF_" + Math.random().toString(36).slice(2, 10);
  const block = `${key}<<${sep}\n${value}\n${sep}\n`;
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, block);
  else process.stdout.write(block);
}

function buildPlainSummary(briefing) {
  const lines = [];
  if (briefing.headline) lines.push(briefing.headline);
  else if (briefing.title) lines.push(briefing.title);
  if (Array.isArray(briefing.topThreeLines) && briefing.topThreeLines.length) {
    briefing.topThreeLines.slice(0, 3).forEach((l, i) => lines.push(`${i + 1}. ${l}`));
  } else if (Array.isArray(briefing.highlights) && briefing.highlights.length) {
    briefing.highlights.slice(0, 3).forEach((l, i) => lines.push(`${i + 1}. ${l}`));
  }
  if (briefing.overnightLead) {
    lines.push("");
    lines.push(briefing.overnightLead.slice(0, 400));
  }
  return lines.join("\n");
}

function buildTelegramMarkdown(briefing, reportUrl) {
  const esc = (s) => String(s ?? "").replace(/([_*[\]()~`>#+=|{}.!-])/g, "\\$1");
  const lines = [];
  if (briefing.title) lines.push(`*${esc(briefing.title)}*`);
  if (briefing.headline) lines.push(`_${esc(briefing.headline)}_`);
  lines.push("");
  if (Array.isArray(briefing.topThreeLines) && briefing.topThreeLines.length) {
    briefing.topThreeLines.slice(0, 3).forEach((l) => lines.push(`• ${esc(l)}`));
  } else if (Array.isArray(briefing.highlights) && briefing.highlights.length) {
    briefing.highlights.slice(0, 3).forEach((l) => lines.push(`• ${esc(l)}`));
  }
  lines.push("");
  lines.push(`📊 [전체 리포트 보기](${reportUrl})`);
  return lines.join("\n");
}

async function main() {
  if (!existsSync(BRIEFINGS_PATH)) {
    console.error(`[notify] briefings.json not found at ${BRIEFINGS_PATH}`);
    emitOutput("has_report", "false");
    process.exit(0);
  }

  const briefings = JSON.parse(await readFile(BRIEFINGS_PATH, "utf8"));
  if (!Array.isArray(briefings) || !briefings.length) {
    console.error("[notify] briefings array is empty");
    emitOutput("has_report", "false");
    process.exit(0);
  }

  // Latest by date string sort
  const briefing = briefings.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const reportDate = briefing.date || new Date().toISOString().slice(0, 10);
  const reportUrl = `${PAGES_BASE_URL}/report.html`;

  const subject = `[데일리 리포트 · ${reportDate}] ${briefing.title || "미국 마감 브리핑"}`;
  const summaryText = buildPlainSummary(briefing);
  const summaryMd = buildTelegramMarkdown(briefing, reportUrl);

  emitOutput("subject", subject);
  emitMultiline("summary_text", summaryText);
  emitMultiline("summary_md", summaryMd);
  emitOutput("report_url", reportUrl);
  emitOutput("report_date", reportDate);
  emitOutput("has_report", existsSync(REPORT_PATH) ? "true" : "false");

  console.log(`[notify] payload built for ${reportDate}`);
  console.log(`  subject: ${subject}`);
  console.log(`  url: ${reportUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
