// Preserve the exact JSON/Markdown/HTML inputs used for a dated report.
//
// Layout:
//   archive/YYYY-MM-DD/latest/*             latest run for safe --date rendering
//   archive/YYYY-MM-DD/runs/RUN_ID/*        immutable run copies

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const REPORT_DATE_OVERRIDE = process.env.REPORT_DATE_OVERRIDE;

const DATA_FILES = [
  ["data/market-snapshot.json", "market-snapshot.json"],
  ["data/briefings.json", "briefings.json"],
  ["data/news-digest.json", "news-digest.json"],
  ["data/yahoo-snapshot.json", "yahoo-snapshot.json"],
  ["data/stooq-snapshot.json", "stooq-snapshot.json"],
  ["data/market-supplements.json", "market-supplements.json"],
  ["data/watchlist-prices.json", "watchlist-prices.json"],
  ["data/stock-watchlist.json", "stock-watchlist.json"],
  ["data/macro-history.json", "macro-history.json"]
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function readJSON(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function safeRunId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "");
}

async function copyIfExists(relativeSource, archivedName, destinations, copied) {
  const source = path.join(ROOT, relativeSource);
  if (!existsSync(source)) return;
  const info = await stat(source);
  for (const destination of destinations) {
    await copyFile(source, path.join(destination, archivedName));
  }
  copied.push({
    source: relativeSource,
    archivedAs: archivedName,
    bytes: info.size
  });
}

async function writeJSONToDestinations(name, value, destinations, copied) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  for (const destination of destinations) {
    await writeFile(path.join(destination, name), text, "utf8");
  }
  copied.push({
    source: "generated",
    archivedAs: name,
    bytes: Buffer.byteLength(text)
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await readJSON(SNAPSHOT_PATH);
  const reportDate = args.date || REPORT_DATE_OVERRIDE || snapshot.reportDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate || "")) {
    throw new Error("Report date missing. Run build:data first or pass --date YYYY-MM-DD.");
  }

  const archivedAt = new Date();
  const runId = args["run-id"] || safeRunId(archivedAt);
  const baseDir = path.join(ARCHIVE_DIR, reportDate);
  const latestDir = path.join(baseDir, "latest");
  const runDir = path.join(baseDir, "runs", runId);
  await mkdir(latestDir, { recursive: true });
  await mkdir(runDir, { recursive: true });

  const destinations = [latestDir, runDir];
  const copied = [];
  for (const [source, name] of DATA_FILES) {
    await copyIfExists(source, name, destinations, copied);
  }

  const briefings = existsSync(BRIEFINGS_PATH) ? await readJSON(BRIEFINGS_PATH) : [];
  const briefing = Array.isArray(briefings) ? briefings.find((item) => item.date === reportDate) : null;
  if (briefing) {
    await writeJSONToDestinations("briefing.json", briefing, destinations, copied);
  }

  await copyIfExists(`posts/${reportDate}.md`, "briefing.md", destinations, copied);
  await copyIfExists(`reports/${reportDate}.html`, "report.html", destinations, copied);

  const manifest = {
    reportDate,
    runId,
    archivedAt: archivedAt.toISOString(),
    generatedAt: snapshot.generatedAt || null,
    latestPath: `archive/${reportDate}/latest`,
    runPath: `archive/${reportDate}/runs/${runId}`,
    reportCalendar: snapshot.reportCalendar || null,
    files: copied,
    note: "latest is overwritten by the newest run for this report date; runs/* keeps each generated copy."
  };
  await writeJSONToDestinations("manifest.json", manifest, destinations, []);

  console.log(`[archive-report-data] archived ${reportDate} run ${runId}`);
  console.log(`[archive-report-data] latest -> ${path.relative(ROOT, latestDir)}`);
  console.log(`[archive-report-data] run    -> ${path.relative(ROOT, runDir)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
