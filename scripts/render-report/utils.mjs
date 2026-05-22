// utils.mjs — formatting, lookup, math helpers (matched to actual JSON schema)

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtNum(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function signed(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = Number(value).toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

// `value` here is in percentage-points already (e.g. 0.06 = 6bp).
export function bp(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const bps = Math.round(value * 100);
  return `${bps > 0 ? "+" : ""}${bps}bp`;
}

export function tone(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

export function arrowFor(value) {
  if (!Number.isFinite(value) || value === 0) return "→";
  return value > 0 ? "↑" : "↓";
}

// snapshot.groups[].items[] → flat array, with groupLabel attached
export function flattenMetrics(snapshot) {
  if (!snapshot?.groups) return [];
  return snapshot.groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupLabel: group.label, groupId: group.id }))
  );
}

export function findMetric(snapshot, id) {
  return flattenMetrics(snapshot).find((item) => item.id === id);
}

// Returns the change in the metric's native unit (bp for rates, % for others)
export function metricChange(item) {
  if (!item) return null;
  // For percent-formatted (rate) items, absoluteChange is in percentage points already.
  if (item.format === "percent") return { value: item.absoluteChange, isBp: true };
  // For everything else, prefer percentChange.
  return { value: item.percentChange, isBp: false };
}

// Format the change for display, with sign.
export function formatChange(item) {
  const c = metricChange(item);
  if (!c || c.value === null || c.value === undefined || !Number.isFinite(c.value)) return "—";
  return c.isBp ? bp(c.value) : `${signed(c.value, 2)}%`;
}

export function changeTone(item) {
  const c = metricChange(item);
  return c ? tone(c.value) : "flat";
}

export function formatValue(item) {
  if (!item || item.latestValue === null || item.latestValue === undefined) return "—";
  if (item.format === "percent") return `${fmtNum(item.latestValue, item.decimals ?? 2)}%`;
  if (item.format === "usd") return `$${fmtNum(item.latestValue, item.decimals ?? 2)}`;
  return fmtNum(item.latestValue, item.decimals ?? 2);
}

// Format yyyy-mm-dd into M/D
export function shortMD(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export function dowEn(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return DOW_EN[d.getUTCDay()];
}
export function dowKr(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return DOW_KR[d.getUTCDay()];
}

export function formatDateTimeKST(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d).replace(/\.\s/g, "-").replace(/\.$/, "").trim();
}

// Build a tiny delta-bar marker SVG from prev/latest. This is our replacement
// for sparklines (snapshot doesn't carry a time series).
// width 200 × height 42. Shows previous as a hollow tick on the left, latest as
// a filled tick on the right; the bar between them is colored by direction.
export function deltaBar(prev, latest, isUp) {
  if (!Number.isFinite(prev) || !Number.isFinite(latest)) return null;
  const w = 200, h = 42, pad = 6;
  const min = Math.min(prev, latest);
  const max = Math.max(prev, latest);
  const span = max - min || Math.abs(latest || 1) * 0.01 || 1;
  // map values to x using a generous padding so the diff is visible even when small
  const lo = min - span * 0.6;
  const hi = max + span * 0.6;
  const xFor = (v) => pad + ((v - lo) / (hi - lo)) * (w - pad * 2);
  const xPrev = xFor(prev), xLast = xFor(latest);
  const y = h / 2;
  return { xPrev, xLast, y, w, h };
}

// ──────────────────────────────────────────────────────────────────────
// MULTI-PERIOD HISTORY HELPERS
// ──────────────────────────────────────────────────────────────────────

// Find a history series in macro-history.json by id (FRED-style upper-case).
export function historyById(macroHistory, id) {
  if (!macroHistory || !Array.isArray(macroHistory.items)) return null;
  return macroHistory.items.find((it) => it.id === id) || null;
}

// Returns the close value as of N trading days before the latest point.
// daysAgo: integer count of *available* history points to step back.
export function priorClose(series, daysAgo) {
  if (!series || !Array.isArray(series.history) || series.history.length === 0) return null;
  const h = series.history;
  const idx = h.length - 1 - daysAgo;
  if (idx < 0) return null;
  return h[idx]?.close ?? null;
}

// Compute the percent change between latest close and N trading days ago.
// Returns null if not enough data.
export function pctChangeOver(series, daysAgo) {
  if (!series || !Array.isArray(series.history) || series.history.length < 2) return null;
  const h = series.history;
  const latest = h[h.length - 1]?.close;
  const ref = priorClose(series, daysAgo);
  if (!Number.isFinite(latest) || !Number.isFinite(ref) || ref === 0) return null;
  return ((latest - ref) / ref) * 100;
}

// Same but absolute (for rates we report bp via *100).
export function absChangeOver(series, daysAgo) {
  if (!series || !Array.isArray(series.history) || series.history.length < 2) return null;
  const h = series.history;
  const latest = h[h.length - 1]?.close;
  const ref = priorClose(series, daysAgo);
  if (!Number.isFinite(latest) || !Number.isFinite(ref)) return null;
  return latest - ref;
}

// Standard period windows in trading days
export const PERIODS = [
  { id: "1W", label: "1주", days: 5 },
  { id: "1M", label: "1개월", days: 21 },
  { id: "1Y", label: "1년", days: 252 }
];

// Format a period change appropriately for rate vs price metrics.
// kind: "rate" → bp;  others → %
export function formatPeriodChange(series, daysAgo, kind = "price") {
  if (kind === "rate") {
    const abs = absChangeOver(series, daysAgo);
    if (!Number.isFinite(abs)) return { text: "—", tone: "flat", value: null };
    return { text: bp(abs), tone: tone(abs), value: abs };
  }
  const pct = pctChangeOver(series, daysAgo);
  if (!Number.isFinite(pct)) return { text: "—", tone: "flat", value: null };
  return { text: `${signed(pct, 2)}%`, tone: tone(pct), value: pct };
}

// ──────────────────────────────────────────────────────────────────────
// LINE CHART PATH BUILDERS (1y daily series → SVG paths)
// ──────────────────────────────────────────────────────────────────────

// Build line + area path strings for an array of closes.
// Returns { line, area, dots, w, h, lastX, lastY, minY, maxY, minVal, maxVal }
export function buildLineChart(values, opts = {}) {
  const w = opts.width ?? 320;
  const h = opts.height ?? 110;
  const padX = opts.padX ?? 4;
  const padY = opts.padY ?? 8;
  if (!Array.isArray(values) || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - padX * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = padX + stepX * i;
    const y = padY + (1 - (v - min) / range) * (h - padY * 2);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return {
    line, area, w, h,
    lastX: pts[pts.length - 1][0],
    lastY: pts[pts.length - 1][1],
    firstX: pts[0][0],
    firstY: pts[0][1],
    minVal: min,
    maxVal: max
  };
}

// Trim history to a single value series (closes only)
export function closes(series) {
  if (!series || !Array.isArray(series.history)) return [];
  return series.history.map((p) => p.close).filter(Number.isFinite);
}

export function freshnessChipClass(status) {
  if (status === "stale") return "stale";
  if (status === "delayed") return "delayed";
  return "fresh";
}
export function freshnessChipLabel(status) {
  if (status === "stale") return "오래됨";
  if (status === "delayed") return "지연";
  return "최신";
}
