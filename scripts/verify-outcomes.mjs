// Compare archived daily briefing calls with later market outcomes.
//
// Writes:
//   archive/YYYY-MM-DD/latest/outcome-validation.json
//   archive/YYYY-MM-DD/validations/VALIDATION_RUN_ID.json
//   data/outcome-validations.json
//
// In batch mode (no --date), dates whose validation is already "complete" for
// every requested horizon are skipped and reused as-is, so re-running this
// daily does not keep appending duplicate validation files for dates that can
// no longer change. Pass --force to re-validate everything anyway, or --date
// to target one date explicitly (always re-runs).

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyPreferredTermsDeep, loadPreferredReplacements } from "./editorial-copy.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const MACRO_HISTORY_PATH = path.join(ROOT, "data", "macro-history.json");
const OUTPUT_INDEX_PATH = path.join(ROOT, "data", "outcome-validations.json");

const DEFAULT_HORIZONS = [1, 5];
const EQUITY_IDS = ["SP500", "NASDAQCOM", "DJIA"];
const OBSERVATION_IDS = ["SP500", "NASDAQCOM", "DJIA", "DGS10", "DGS2", "VIXCLS", "DEXKOUS", "DCOILWTICO"];

const DIRECTION_THRESHOLDS = {
  equityPct: 0.15,
  rateAbs: 0.02,
  volatilityAbs: 0.5
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
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

async function readJSONOptional(file) {
  if (!existsSync(file)) return null;
  return readJSON(file);
}

function safeValidationRunId(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "");
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return round(((to - from) / from) * 100, 4);
}

function compareDates(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function flattenSnapshotItems(snapshot) {
  return (snapshot?.groups || []).flatMap((group) => group.items || []);
}

function historyMap(macroHistory) {
  return new Map((macroHistory?.items || []).map((item) => [item.id, item]));
}

function rowsAfter(historyItem, baseDate, horizonSessions) {
  const rows = (historyItem?.history || [])
    .filter((row) => row.date && Number.isFinite(Number(row.close)))
    .sort((a, b) => compareDates(a.date, b.date));
  return rows.filter((row) => compareDates(row.date, baseDate) > 0).slice(0, horizonSessions);
}

function buildObservation(snapshotItem, historyItem, horizonSessions) {
  if (!snapshotItem) {
    return { id: historyItem?.id || null, status: "missing_source_item" };
  }
  if (!historyItem?.history?.length) {
    return {
      id: snapshotItem.id,
      label: snapshotItem.label,
      baseDate: snapshotItem.observationDate,
      baseValue: snapshotItem.latestValue,
      status: "missing_history"
    };
  }

  const futureRows = rowsAfter(historyItem, snapshotItem.observationDate, horizonSessions);
  const target = futureRows[horizonSessions - 1];
  if (!target) {
    return {
      id: snapshotItem.id,
      label: snapshotItem.label,
      baseDate: snapshotItem.observationDate,
      baseValue: snapshotItem.latestValue,
      horizonSessions,
      status: "pending",
      availableFutureSessions: futureRows.length,
      latestHistoryDate: historyItem.latestDate || historyItem.history.at(-1)?.date || null
    };
  }

  const baseValue = Number(snapshotItem.latestValue);
  const actualValue = Number(target.close);
  return {
    id: snapshotItem.id,
    label: snapshotItem.label,
    baseDate: snapshotItem.observationDate,
    baseValue,
    targetDate: target.date,
    actualValue,
    horizonSessions,
    absoluteChange: round(actualValue - baseValue, 6),
    percentChange: pctChange(baseValue, actualValue),
    status: "complete"
  };
}

function textFromDriver(driver) {
  return [driver?.verdict, driver?.desc, driver?.evidence].filter(Boolean).join(" ");
}

function expectedEquityDirection(briefing, snapshot) {
  const driver = snapshot?.analysis?.drivers?.find((item) => item.title === "주식");
  const text = textFromDriver(driver) || [
    briefing?.title,
    briefing?.overnightLead,
    ...(briefing?.highlights || [])
  ].filter(Boolean).join(" ");

  if (/혼조|엇갈|확인\s*제한|방향보다\s*확인/u.test(text)) return "mixed";
  if (/약세|방어|하락|조정|위험\s*회피/u.test(text)) return "down";
  if (/강세|개선|상승|견조|위험자산/u.test(text)) return "up";
  return "mixed";
}

function expectedRateDirection(snapshot) {
  const driver = snapshot?.analysis?.drivers?.find((item) => item.title === "금리");
  const text = textFromDriver(driver);

  if (/혼재|엇갈|방향\s*혼재|함께\s*봐야/u.test(text)) return "mixed";
  if (/완화|하향|하락|내려|눌리/u.test(text)) return "down";
  // "확대" is deliberately excluded here: it fires on "금리차 확대" (curve steepening),
  // which says nothing about the level direction this check scores against.
  if (/상방|상승|부담|재가격|올라/u.test(text)) return "up";
  return "mixed";
}

function expectedVolatilityDirection(snapshot, briefing) {
  const driver = snapshot?.analysis?.drivers?.find((item) => item.title === "변동성");
  const text = textFromDriver(driver) || [
    briefing?.overnightLead,
    ...(briefing?.highlights || [])
  ].filter(Boolean).join(" ");

  if (/혼재|엇갈|중립/u.test(text)) return "mixed";
  if (/개선|안정|하락|둔화|20선\s*아래|위험\s*회피는\s*제한/u.test(text)) return "down";
  if (/방어|상승|확대|헤지|경계/u.test(text)) return "up";
  return "mixed";
}

function classifyEquityOutcome(observations) {
  const complete = EQUITY_IDS.map((id) => observations.get(id)).filter((item) => item?.status === "complete");
  if (complete.length < 2) return "pending";
  const avg = complete.reduce((sum, item) => sum + (item.percentChange || 0), 0) / complete.length;
  const up = complete.filter((item) => (item.percentChange || 0) > DIRECTION_THRESHOLDS.equityPct).length;
  const down = complete.filter((item) => (item.percentChange || 0) < -DIRECTION_THRESHOLDS.equityPct).length;
  if (up > down && avg > DIRECTION_THRESHOLDS.equityPct) return "up";
  if (down > up && avg < -DIRECTION_THRESHOLDS.equityPct) return "down";
  return "mixed";
}

function classifyRateOutcome(observations) {
  const tenYear = observations.get("DGS10");
  const twoYear = observations.get("DGS2");
  if (tenYear?.status !== "complete" || twoYear?.status !== "complete") return "pending";
  const tenMove = tenYear.absoluteChange || 0;
  const twoMove = twoYear.absoluteChange || 0;
  if (tenMove >= DIRECTION_THRESHOLDS.rateAbs && twoMove >= DIRECTION_THRESHOLDS.rateAbs) return "up";
  if (tenMove <= -DIRECTION_THRESHOLDS.rateAbs && twoMove <= -DIRECTION_THRESHOLDS.rateAbs) return "down";
  return "mixed";
}

function classifyVolatilityOutcome(observations) {
  const vix = observations.get("VIXCLS");
  if (vix?.status !== "complete") return "pending";
  const move = vix.absoluteChange || 0;
  if (move >= DIRECTION_THRESHOLDS.volatilityAbs) return "up";
  if (move <= -DIRECTION_THRESHOLDS.volatilityAbs) return "down";
  return "mixed";
}

function compareDirection(expected, actual) {
  if (actual === "pending") return "pending";
  if (expected === actual) return "hit";
  if (expected === "mixed" && actual !== "pending") return "partial";
  return "miss";
}

function scoreChecks(checks) {
  const scored = checks.filter((check) => check.result !== "pending");
  if (scored.length === 0) {
    return { status: "pending", score: null, classification: "pending", hitCount: 0, partialCount: 0, missCount: 0 };
  }
  const points = scored.reduce((sum, check) => {
    if (check.result === "hit") return sum + 1;
    if (check.result === "partial") return sum + 0.5;
    return sum;
  }, 0);
  const score = round((points / scored.length) * 100, 1);
  return {
    status: "complete",
    score,
    classification: score >= 67 ? "confirmed" : score >= 34 ? "mixed" : "miss",
    hitCount: scored.filter((check) => check.result === "hit").length,
    partialCount: scored.filter((check) => check.result === "partial").length,
    missCount: scored.filter((check) => check.result === "miss").length
  };
}

function collectWatchLevelTexts(briefing) {
  const out = [];
  Object.values(briefing?.timeframeInsights || {}).forEach((section) => {
    (section?.watchLevels || []).forEach((item) => out.push(String(item)));
  });
  Object.values(briefing?.insightSections || {}).flat().forEach((item) => {
    if (item?.title && /확인|변수|임계/u.test(item.title)) out.push(String(item.desc || ""));
  });
  return [...new Set(out.filter(Boolean))];
}

function parseNumber(text) {
  const value = Number(String(text || "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function parseWatchLevel(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const parsers = [
    { id: "VIXCLS", re: /VIX\s*([0-9]+(?:\.[0-9]+)?)/iu },
    { id: "DGS10", re: /(?:미\s*)?10년물\s*([0-9]+(?:\.[0-9]+)?)(?:\s*~\s*([0-9]+(?:\.[0-9]+)?))?/u },
    { id: "DEXKOUS", re: /달러\/원.*?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:원)?/u },
    { id: "NASDAQCOM", re: /나스닥\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/u },
    { id: "SP500", re: /S&P\s*500\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/iu }
  ];

  for (const parser of parsers) {
    const match = clean.match(parser.re);
    if (!match) continue;
    const thresholds = match.slice(1).filter(Boolean).map(parseNumber).filter(Number.isFinite);
    if (thresholds.length > 0) {
      return { text: clean, id: parser.id, thresholds };
    }
  }
  return { text: clean, id: null, thresholds: [], status: "unparsed" };
}

function evaluateWatchLevel(parsed, snapshotItems, macroById, horizonSessions) {
  if (!parsed.id) return parsed;
  const sourceItem = snapshotItems.find((item) => item.id === parsed.id);
  const historyItem = macroById.get(parsed.id);
  if (!sourceItem || !historyItem?.history?.length) {
    return { ...parsed, status: "missing_history" };
  }
  const futureRows = rowsAfter(historyItem, sourceItem.observationDate, horizonSessions);
  if (futureRows.length === 0) {
    return { ...parsed, status: "pending", baseDate: sourceItem.observationDate, baseValue: sourceItem.latestValue };
  }
  const values = futureRows.map((row) => Number(row.close)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const base = Number(sourceItem.latestValue);
  const touchedThresholds = parsed.thresholds.filter((threshold) => {
    if (!Number.isFinite(base)) return min <= threshold && threshold <= max;
    if (base <= threshold) return max >= threshold;
    return min <= threshold;
  });
  return {
    ...parsed,
    status: touchedThresholds.length > 0 ? "touched" : "not_touched",
    baseDate: sourceItem.observationDate,
    baseValue: base,
    checkedThroughDate: futureRows.at(-1)?.date || null,
    min,
    max,
    touchedThresholds
  };
}

function buildHorizonEvaluation({ horizonSessions, snapshot, briefing, snapshotItems, macroById }) {
  const observations = new Map();
  OBSERVATION_IDS.forEach((id) => {
    const snapshotItem = snapshotItems.find((item) => item.id === id);
    const historyItem = macroById.get(id);
    observations.set(id, buildObservation(snapshotItem, historyItem, horizonSessions));
  });

  const checks = [
    {
      id: "equity-follow-through",
      label: "주식 방향성",
      expected: expectedEquityDirection(briefing, snapshot),
      actual: classifyEquityOutcome(observations)
    },
    {
      id: "rate-follow-through",
      label: "금리 방향성",
      expected: expectedRateDirection(snapshot),
      actual: classifyRateOutcome(observations)
    },
    {
      id: "volatility-follow-through",
      label: "변동성 방향성",
      expected: expectedVolatilityDirection(snapshot, briefing),
      actual: classifyVolatilityOutcome(observations)
    }
  ].map((check) => ({
    ...check,
    result: compareDirection(check.expected, check.actual)
  }));

  const watchLevels = collectWatchLevelTexts(briefing)
    .map(parseWatchLevel)
    .map((item) => evaluateWatchLevel(item, snapshotItems, macroById, horizonSessions));

  return {
    horizonSessions,
    ...scoreChecks(checks),
    checks,
    observations: Object.fromEntries(observations),
    watchLevels
  };
}

function isFullyResolved(existing, horizons) {
  if (!existing || existing.overall?.status !== "complete") return false;
  const byHorizon = new Map((existing.horizons || []).map((item) => [item.horizonSessions, item]));
  return horizons.every((horizonSessions) => byHorizon.get(horizonSessions)?.status === "complete");
}

async function listArchiveDates() {
  if (!existsSync(ARCHIVE_DIR)) return [];
  const entries = await readdir(ARCHIVE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function validateDate(reportDate, macroHistory, validationRunId, horizons, replacements) {
  const latestDir = path.join(ARCHIVE_DIR, reportDate, "latest");
  const snapshot = await readJSONOptional(path.join(latestDir, "market-snapshot.json"));
  const briefing = await readJSONOptional(path.join(latestDir, "briefing.json"));
  const manifest = await readJSONOptional(path.join(latestDir, "manifest.json"));

  if (!snapshot || !briefing) {
    return {
      reportDate,
      status: "skipped",
      reason: "archive latest snapshot or briefing is missing"
    };
  }

  const validatedAt = new Date().toISOString();
  const macroById = historyMap(macroHistory);
  const snapshotItems = flattenSnapshotItems(snapshot);
  const horizonEvaluations = horizons.map((horizonSessions) =>
    buildHorizonEvaluation({ horizonSessions, snapshot, briefing, snapshotItems, macroById })
  );
  const completed = horizonEvaluations.filter((item) => item.status === "complete");
  const overallScore = completed.length
    ? round(completed.reduce((sum, item) => sum + item.score, 0) / completed.length, 1)
    : null;
  const overallClassification = overallScore === null
    ? "pending"
    : overallScore >= 67
      ? "confirmed"
      : overallScore >= 34
        ? "mixed"
        : "miss";
  // "complete" must mean every requested horizon resolved, not just the first
  // one — otherwise a still-pending 5-session horizon gets treated as done.
  const overallStatus = completed.length === 0
    ? "pending"
    : completed.length === horizonEvaluations.length
      ? "complete"
      : "partial";

  const validation = applyPreferredTermsDeep({
    schemaVersion: 1,
    reportDate,
    briefingTitle: briefing.title || null,
    sourceRunId: manifest?.runId || null,
    sourceGeneratedAt: manifest?.generatedAt || snapshot.generatedAt || null,
    validatedAt,
    validationRunId,
    basis: {
      macroHistoryGeneratedAt: macroHistory.generatedAt || null,
      macroHistoryRange: macroHistory.range || null,
      note: "Directional follow-through check. This evaluates whether later market data aligned with the report's stated risk framing; it is not a trading P/L backtest."
    },
    overall: {
      status: overallStatus,
      score: overallScore,
      classification: overallClassification
    },
    horizons: horizonEvaluations
  }, replacements);

  const validationsDir = path.join(ARCHIVE_DIR, reportDate, "validations");
  await mkdir(validationsDir, { recursive: true });
  await writeFile(path.join(validationsDir, `${validationRunId}.json`), `${JSON.stringify(validation, null, 2)}\n`, "utf8");
  await writeFile(path.join(latestDir, "outcome-validation.json"), `${JSON.stringify(validation, null, 2)}\n`, "utf8");

  return validation;
}

function slimResult(result) {
  if (result.status === "skipped") return result;
  return {
    reportDate: result.reportDate,
    briefingTitle: result.briefingTitle,
    sourceRunId: result.sourceRunId,
    validatedAt: result.validatedAt,
    overall: result.overall,
    horizons: result.horizons.map((item) => ({
      horizonSessions: item.horizonSessions,
      status: item.status,
      score: item.score,
      classification: item.classification,
      hitCount: item.hitCount,
      partialCount: item.partialCount,
      missCount: item.missCount
    })),
    archivePath: `archive/${result.reportDate}/latest/outcome-validation.json`
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const macroHistory = await readJSON(MACRO_HISTORY_PATH);
  const validationRunId = args["run-id"] || safeValidationRunId();
  const horizons = String(args.horizons || DEFAULT_HORIZONS.join(","))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (horizons.length === 0) {
    throw new Error("--horizons must include at least one positive integer.");
  }

  const dates = args.date
    ? [args.date]
    : await listArchiveDates();

  if (dates.length === 0) {
    console.log("[verify-outcomes] no archived report dates found.");
    return;
  }

  const results = [];
  const replacements = await loadPreferredReplacements(ROOT);
  const skipResolved = !args.date && !args.force;
  for (const reportDate of dates) {
    if (skipResolved) {
      const existing = await readJSONOptional(path.join(ARCHIVE_DIR, reportDate, "latest", "outcome-validation.json"));
      if (isFullyResolved(existing, horizons)) {
        results.push(existing);
        console.log(`[verify-outcomes] ${reportDate}: already resolved, skipping (${existing.overall.classification})`);
        continue;
      }
    }

    const result = await validateDate(reportDate, macroHistory, validationRunId, horizons, replacements);
    results.push(result);
    if (result.status === "skipped") {
      console.log(`[verify-outcomes] skipped ${reportDate}: ${result.reason}`);
    } else {
      console.log(`[verify-outcomes] ${reportDate}: ${result.overall.classification}${result.overall.score === null ? "" : ` (${result.overall.score}/100)`}`);
    }
  }

  await mkdir(path.dirname(OUTPUT_INDEX_PATH), { recursive: true });
  const index = {
    generatedAt: new Date().toISOString(),
    validationRunId,
    basis: {
      macroHistoryGeneratedAt: macroHistory.generatedAt || null,
      horizons
    },
    results: results.map(slimResult)
  };
  await writeFile(OUTPUT_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`[verify-outcomes] wrote ${path.relative(ROOT, OUTPUT_INDEX_PATH)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
