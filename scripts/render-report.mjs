// render-report.mjs — 자동 생성된 단일 파일 (drop-in replacement)
// data/market-snapshot.json + data/briefings.json 를 읽어
// report.html 과 reports/<date>.html 을 생성한다.
//
// 사용:  node scripts/render-report.mjs
// 환경:  REPORT_DATE_OVERRIDE=YYYY-MM-DD (선택)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "data", "market-snapshot.json");
const BRIEFINGS_PATH = path.join(ROOT, "data", "briefings.json");
const REPORTS_DIR = path.join(ROOT, "reports");
const LATEST_REPORT_PATH = path.join(ROOT, "report.html");
const REPORT_DATE_OVERRIDE = process.env.REPORT_DATE_OVERRIDE;

// ──────────────────────────────────────────────────────────────────────
// utils
// ──────────────────────────────────────────────────────────────────────
// utils.mjs — formatting, lookup, math helpers (matched to actual JSON schema)
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtNum(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}
function signed(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = Number(value).toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

// `value` here is in percentage-points already (e.g. 0.06 = 6bp).
function bp(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const bps = Math.round(value * 100);
  return `${bps > 0 ? "+" : ""}${bps}bp`;
}
function tone(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}
function arrowFor(value) {
  if (!Number.isFinite(value) || value === 0) return "→";
  return value > 0 ? "↑" : "↓";
}

// snapshot.groups[].items[] → flat array, with groupLabel attached
function flattenMetrics(snapshot) {
  if (!snapshot?.groups) return [];
  return snapshot.groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupLabel: group.label, groupId: group.id }))
  );
}
function findMetric(snapshot, id) {
  return flattenMetrics(snapshot).find((item) => item.id === id);
}

// Returns the change in the metric's native unit (bp for rates, % for others)
function metricChange(item) {
  if (!item) return null;
  // For percent-formatted (rate) items, absoluteChange is in percentage points already.
  if (item.format === "percent") return { value: item.absoluteChange, isBp: true };
  // For everything else, prefer percentChange.
  return { value: item.percentChange, isBp: false };
}

// Format the change for display, with sign.
function formatChange(item) {
  const c = metricChange(item);
  if (!c || c.value === null || c.value === undefined || !Number.isFinite(c.value)) return "—";
  return c.isBp ? bp(c.value) : `${signed(c.value, 2)}%`;
}
function changeTone(item) {
  const c = metricChange(item);
  return c ? tone(c.value) : "flat";
}
function formatValue(item) {
  if (!item || item.latestValue === null || item.latestValue === undefined) return "—";
  if (item.format === "percent") return `${fmtNum(item.latestValue, item.decimals ?? 2)}%`;
  if (item.format === "usd") return `$${fmtNum(item.latestValue, item.decimals ?? 2)}`;
  return fmtNum(item.latestValue, item.decimals ?? 2);
}

// Format yyyy-mm-dd into M/D
function shortMD(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dowEn(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return DOW_EN[d.getUTCDay()];
}
function dowKr(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return DOW_KR[d.getUTCDay()];
}
function formatDateTimeKST(iso) {
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
function deltaBar(prev, latest, isUp) {
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
function freshnessChipClass(status) {
  if (status === "stale") return "stale";
  if (status === "delayed") return "delayed";
  return "fresh";
}
function freshnessChipLabel(status) {
  if (status === "stale") return "오래됨";
  if (status === "delayed") return "지연";
  return "최신";
}


// ──────────────────────────────────────────────────────────────────────
// styles
// ──────────────────────────────────────────────────────────────────────
// styles.mjs — single source of truth for the new report CSS.
// Returns the full <style>…</style> block as a string.
function reportStyles() {
  return `<style>
:root{
  --paper:#f5f3ec;
  --paper-2:#ebe8de;
  --panel:#ffffff;
  --ink:#0e1410;
  --ink-2:#1c241f;
  --muted:#6a7068;
  --muted-2:#8a8f87;
  --rule:#0e1410;
  --rule-soft:#cdcfc6;
  --accent:#0f5e3e;
  --accent-2:#7a3a12;
  --up:#0d8a5a;
  --down:#c43d2e;
  --amber:#a86a18;
  --flat:#606b66;
  --grid:#e3e1d6;
  --hi:#fff7d6;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper);
  color:var(--ink);
  font-family:"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;
  font-size:15px;line-height:1.7;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:inherit;text-decoration:none}
.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.serif{font-family:"Source Serif 4","Noto Serif KR",Georgia,serif}

.shell{max-width:1360px;margin:0 auto;padding:0 28px}

/* tape */
.tape{border-bottom:1px solid var(--rule);background:var(--ink);color:var(--paper);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase}
.tape .row{max-width:1360px;margin:0 auto;padding:8px 28px;display:flex;gap:28px;align-items:center;justify-content:space-between}
.tape .ticks{display:flex;gap:24px;overflow:hidden;white-space:nowrap}
.tape .tick{display:inline-flex;gap:8px;align-items:baseline}
.tape .tick b{font-weight:700;color:var(--paper)}
.tape .tick .v{color:#cfd5cb}
.tape .tick .up{color:#7be0a8}
.tape .tick .down{color:#ff8478}
.tape .right{display:flex;gap:18px;align-items:center;color:#aab2a8}
.tape .live{display:inline-flex;align-items:center;gap:6px;color:#ff8478}
.tape .live::before{content:"";width:6px;height:6px;background:#ff5d4a;border-radius:50%;display:inline-block;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

/* masthead */
.masthead{padding:36px 0 24px;border-bottom:2px solid var(--rule)}
.masthead .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:1px solid var(--rule-soft);margin-bottom:22px}
.masthead .brand{display:flex;align-items:baseline;gap:14px}
.masthead .brand .logo{width:34px;height:34px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-family:"JetBrains Mono",monospace;font-weight:700;font-size:13px;letter-spacing:-.02em;transform:translateY(4px)}
.masthead .brand h1.wordmark{font-family:"Source Serif 4",serif;font-weight:900;font-size:22px;letter-spacing:-.01em;margin:0}
.masthead .brand .sub{color:var(--muted);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-left:6px}
.masthead .meta{display:flex;gap:22px;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.masthead .meta b{color:var(--ink);font-weight:700}
.kicker{display:inline-flex;gap:12px;align-items:center;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:18px}
.kicker .dot{width:6px;height:6px;background:var(--accent);border-radius:50%;display:inline-block}
.kicker .sep{color:var(--rule-soft)}
.hero-grid{display:grid;grid-template-columns:1fr 420px;gap:48px;align-items:end}
h1.hero{font-family:"Source Serif 4",serif;font-weight:800;font-size:clamp(2.6rem,5.4vw,4.8rem);line-height:1;letter-spacing:-.025em;margin:0 0 18px;word-break:keep-all;text-wrap:balance}
h1.hero em{font-style:normal;color:var(--accent)}
.deck{font-size:1.1rem;line-height:1.65;color:var(--ink-2);max-width:780px;border-left:3px solid var(--accent);padding:4px 0 4px 18px;margin:18px 0 0}
.hero-side{border:1px solid var(--rule);background:var(--panel);padding:20px 22px;font-family:"JetBrains Mono",monospace;font-size:12px}
.hero-side h4{margin:0 0 14px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:700;display:flex;justify-content:space-between}
.hero-side h4 span:last-child{color:var(--accent)}
.hero-side .row{display:flex;justify-content:space-between;padding:6px 0;border-top:1px dotted var(--rule-soft);align-items:baseline}
.hero-side .row:first-of-type{border-top:none}
.hero-side .row .lbl{color:var(--muted)}
.hero-side .row .val{font-weight:600;color:var(--ink)}
.hero-side .row .chg{font-size:11px;margin-left:8px}
.hero-side .note{margin-top:14px;padding-top:12px;border-top:1px dotted var(--rule-soft);font-family:"Noto Sans KR";font-size:11px;color:var(--muted);line-height:1.55;letter-spacing:0;text-transform:none}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--flat)}

/* sections */
.section{padding:56px 0;border-bottom:1px solid var(--rule-soft)}
.section:last-of-type{border-bottom:none}
.section-head{display:grid;grid-template-columns:120px 1fr;gap:32px;align-items:start;margin-bottom:32px;padding-bottom:14px;border-bottom:1px solid var(--rule)}
.section-head .num{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.18em;color:var(--accent);font-weight:700;padding-top:8px}
.section-head .num .bar{display:block;width:48px;height:2px;background:var(--accent);margin-bottom:10px}
.section-head h2{margin:0;font-family:"Source Serif 4",serif;font-weight:800;font-size:clamp(1.6rem,2.4vw,2.1rem);line-height:1.15;letter-spacing:-.015em}
.section-head .lede{color:var(--muted);font-size:.96rem;margin:8px 0 0;max-width:760px}

/* INDEX MATRIX */
.matrix{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--rule);background:var(--panel)}
.matrix .cell{padding:22px 22px 18px;border-right:1px solid var(--rule-soft);position:relative}
.matrix .cell:last-child{border-right:none}
.matrix .cell .lbl{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.matrix .cell .ticker{color:var(--ink);font-weight:600}
.matrix .cell .val{font-family:"Source Serif 4",serif;font-weight:700;font-size:2.4rem;line-height:1.05;letter-spacing:-.015em;font-variant-numeric:tabular-nums}
.matrix .cell .val .frac{font-size:1.4rem;color:var(--muted)}
.matrix .cell .chg{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:baseline;margin-top:4px}
.matrix .cell .spark{margin-top:14px;height:42px}
.matrix .cell .foot{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--muted);letter-spacing:.06em;margin-top:10px;padding-top:10px;border-top:1px dashed var(--rule-soft)}
.matrix .cell .arrow{position:absolute;top:22px;right:22px;font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700}

.lede3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px;padding:0;list-style:none;counter-reset:l3}
.lede3 li{background:var(--panel);border:1px solid var(--rule-soft);border-top:3px solid var(--ink);padding:18px 20px;font-size:1rem;line-height:1.7;counter-increment:l3}
.lede3 li::before{content:"0" counter(l3);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.2em;color:var(--accent);font-weight:700;display:block;margin-bottom:8px}

/* verdicts */
.verdicts{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}
.verdict{background:var(--panel);border:1px solid var(--rule-soft);padding:18px;border-top:3px solid var(--accent)}
.verdict.warn{border-top-color:var(--amber)}
.verdict.bear{border-top-color:var(--down)}
.verdict h4{margin:0 0 6px;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;font-family:"JetBrains Mono",monospace;color:var(--muted)}
.verdict .v{font-family:"Source Serif 4",serif;font-size:1.2rem;font-weight:700;margin:0 0 10px}
.verdict p{margin:0;color:var(--ink-2);font-size:.92rem;line-height:1.65}
.verdict .ev{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px dotted var(--rule-soft)}

/* data + curve */
.data-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:32px}
.data-table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-family:"JetBrains Mono",monospace;font-size:13px}
.data-table caption{caption-side:top;text-align:left;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:700;padding:0 0 8px}
.data-table th,.data-table td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--rule-soft)}
.data-table th{background:var(--paper-2);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);font-weight:700;border-bottom:1px solid var(--rule)}
.data-table tbody tr:last-child td{border-bottom:none}
.data-table tbody tr:hover{background:var(--hi)}
.data-table .num{text-align:right;font-variant-numeric:tabular-nums}
.data-table .lbl-ko{font-family:"Noto Sans KR";font-weight:500;color:var(--ink)}
.data-table .obs{color:var(--muted);font-size:11px}

.chip{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;padding:2px 6px;border:1px solid var(--rule-soft);color:var(--muted);text-transform:uppercase}
.chip.fresh{color:var(--up);border-color:rgba(13,138,90,.4);background:rgba(13,138,90,.06)}
.chip.delayed{color:var(--amber);border-color:rgba(168,106,24,.4);background:rgba(168,106,24,.06)}
.chip.stale{color:var(--down);border-color:rgba(196,61,46,.4);background:rgba(196,61,46,.06)}

.curve-card{background:var(--panel);border:1px solid var(--rule);padding:22px}
.curve-card h3{margin:0 0 4px;font-family:"Source Serif 4",serif;font-size:1.15rem;font-weight:700}
.curve-card .sub{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px}

/* sectors */
.sectors{background:var(--panel);border:1px solid var(--rule);padding:22px 24px}
.sector-row{display:grid;grid-template-columns:170px 1fr 90px;gap:16px;align-items:center;padding:8px 0;border-top:1px dotted var(--rule-soft)}
.sector-row:first-child{border-top:none}
.sector-row .name{font-family:"JetBrains Mono",monospace;font-size:12px}
.sector-row .name .ticker{font-weight:700;letter-spacing:.05em;margin-right:8px}
.sector-row .name .ko{color:var(--muted)}
.sector-row .pct{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;text-align:right}
.bar-track{height:14px;position:relative;background:linear-gradient(to right,transparent calc(50% - .5px),var(--rule-soft) calc(50% - .5px),var(--rule-soft) calc(50% + .5px),transparent calc(50% + .5px))}
.bar-fill{position:absolute;top:1px;bottom:1px;background:var(--up)}
.bar-fill.neg{background:var(--down)}

/* key issues */
.issues{display:grid;gap:0}
.issue{display:grid;grid-template-columns:90px 1fr;gap:32px;padding:24px 0;border-top:1px solid var(--rule-soft)}
.issue:first-child{border-top:1px solid var(--rule)}
.issue:last-child{border-bottom:1px solid var(--rule)}
.issue .idx{font-family:"Source Serif 4",serif;font-style:italic;font-size:3.6rem;font-weight:800;color:var(--accent);line-height:.9;letter-spacing:-.03em}
.issue h3{margin:0 0 14px;font-family:"Source Serif 4",serif;font-size:1.45rem;font-weight:700;letter-spacing:-.01em;line-height:1.3;word-break:keep-all}
.issue dl{margin:0;display:grid;grid-template-columns:120px 1fr;gap:8px 18px;border-top:1px solid var(--rule-soft);padding-top:12px}
.issue dt{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;padding-top:3px}
.issue dd{margin:0;color:var(--ink-2);line-height:1.7;font-size:.96rem}

/* timeline */
.timeline-card{background:var(--panel);border:1px solid var(--rule);padding:24px 28px}
.timeline-card h3{margin:0 0 4px;font-family:"Source Serif 4",serif;font-size:1.2rem}
.timeline-card .sub{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px}
.tl-list{display:grid;gap:0;margin-top:18px}
.tl-event{display:grid;grid-template-columns:110px 1fr 100px;gap:18px;align-items:baseline;padding:10px 0;border-top:1px dotted var(--rule-soft)}
.tl-event:first-child{border-top:1px solid var(--rule-soft)}
.tl-event .when{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.06em;color:var(--ink);font-weight:600}
.tl-event .when .day{display:block;font-size:10px;color:var(--muted);letter-spacing:.16em;text-transform:uppercase;font-weight:500}
.tl-event .name{font-size:.95rem;line-height:1.5}
.tl-event .name .ko{color:var(--muted);font-size:.85rem;display:block;margin-top:2px}
.tl-event .imp{justify-self:end;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.tl-event.high .imp{color:var(--down)}
.tl-event.high .when{color:var(--down)}

/* checkpoints */
.checkpoints{display:grid;gap:14px}
.checkpoint{display:grid;grid-template-columns:auto 1fr;gap:18px;background:var(--panel);border:1px solid var(--rule-soft);padding:18px 22px;border-left:3px solid var(--amber)}
.checkpoint .marker{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber);font-weight:700;width:80px;padding-top:3px}
.checkpoint p{margin:0;line-height:1.7;color:var(--ink-2)}

/* positioning */
.pos-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}
.pos-card{background:var(--panel);border:1px solid var(--rule);padding:24px 26px}
.pos-card.alt{background:var(--paper-2);border-style:dashed}
.pos-card .top{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;font-weight:700}
.pos-card.alt .top{color:var(--accent-2)}
.pos-card h3{margin:0 0 16px;font-family:"Source Serif 4",serif;font-size:1.3rem;font-weight:700;line-height:1.35;letter-spacing:-.01em}
.pos-card dl{margin:0;display:grid;grid-template-columns:110px 1fr;gap:6px 18px;font-size:.92rem;line-height:1.7}
.pos-card dt{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700;padding-top:3px}
.pos-card dd{margin:0}
.pos-card ul{margin:6px 0 0;padding-left:18px}
.pos-card ul li{margin-bottom:4px}
.compliance{margin-top:14px;padding:10px 12px;background:rgba(168,106,24,.08);border-left:2px solid var(--amber);font-size:.84rem;color:var(--muted)}

/* essay */
.essay{columns:2;column-gap:48px;column-rule:1px solid var(--rule-soft);font-family:"Noto Sans KR";font-size:1.02rem;line-height:1.85;color:var(--ink-2)}
.essay p{margin:0 0 16px;break-inside:avoid-column}
.essay p:first-child::first-letter{font-family:"Source Serif 4",serif;font-weight:800;font-size:4.2rem;line-height:.85;float:left;padding:8px 12px 0 0;color:var(--accent)}

/* freshness */
.fresh-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--rule);background:var(--panel)}
.fresh-cell{padding:16px 18px;border-right:1px solid var(--rule-soft);border-bottom:1px solid var(--rule-soft)}
.fresh-cell:nth-child(4n){border-right:none}
.fresh-cell .top{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.fresh-cell .lbl{font-size:.92rem;font-weight:600;margin-bottom:4px}
.fresh-cell .obs{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted)}

/* colophon */
.colophon{padding:32px 0 56px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.06em;line-height:1.8}
.colophon .row{display:flex;justify-content:space-between;border-top:1px solid var(--rule);padding-top:18px;margin-top:18px;gap:16px;flex-wrap:wrap}
.colophon b{color:var(--ink)}

/* responsive */
@media (max-width:1100px){
  .hero-grid{grid-template-columns:1fr}
  .matrix{grid-template-columns:repeat(2,1fr)}
  .matrix .cell:nth-child(2){border-right:none}
  .matrix .cell:nth-child(1),.matrix .cell:nth-child(2){border-bottom:1px solid var(--rule-soft)}
  .data-grid,.pos-grid{grid-template-columns:1fr}
  .essay{columns:1}
  .verdicts,.lede3,.fresh-grid{grid-template-columns:repeat(2,1fr)}
  .section-head{grid-template-columns:1fr}
  .issue{grid-template-columns:60px 1fr;gap:18px}
  .issue .idx{font-size:2.4rem}
}
@media (max-width:680px){
  .matrix,.verdicts,.lede3,.fresh-grid{grid-template-columns:1fr}
  .matrix .cell{border-right:none;border-bottom:1px solid var(--rule-soft)}
  .tape .ticks{display:none}
  .shell{padding:0 18px}
}
@media print{
  body{background:#fff}
  .tape{display:none}
  .section{break-inside:avoid;page-break-inside:avoid}
  .shell{max-width:none;padding:0 12mm}
}
</style>`;
}


// ──────────────────────────────────────────────────────────────────────
// sections
// ──────────────────────────────────────────────────────────────────────
// sections.mjs — renders each section of the new report.
// All field paths match the real `market-snapshot.json` and `briefings.json` schemas.

/* ─────────────────────── TAPE (top ticker bar) ─────────────────────── */
function renderTape(snapshot) {
  const wantedIds = ["SP500", "NASDAQCOM", "DJIA", "DGS10", "DGS2", "VIXCLS", "DTWEXBGS", "DCOILWTICO", "DEXKOUS"];
  const aliasLabels = {
    SP500: "SPX", NASDAQCOM: "NDX", DJIA: "DJI", DGS10: "UST10Y", DGS2: "UST2Y",
    VIXCLS: "VIX", DTWEXBGS: "DXY", DCOILWTICO: "WTI", DEXKOUS: "USD/KRW"
  };
  const flat = flattenMetrics(snapshot);
  const ticks = wantedIds
    .map((id) => flat.find((it) => it.id === id))
    .filter(Boolean)
    .map((it) => {
      const chgStr = formatChange(it);
      const dir = changeTone(it);
      const valStr = formatValue(it);
      return `<span class="tick"><b>${escapeHtml(aliasLabels[it.id] || it.id)}</b> <span class="v">${escapeHtml(valStr)}</span> <span class="${dir}">${escapeHtml(chgStr)}</span></span>`;
    })
    .join("");
  const reportTime = formatDateTimeKST(snapshot.generatedAt);
  return `<div class="tape"><div class="row">
    <div class="ticks">${ticks}</div>
    <div class="right"><span class="live">LIVE</span><span>${escapeHtml(reportTime)} KST</span></div>
  </div></div>`;
}

/* ─────────────────────── MASTHEAD ─────────────────────── */

function deriveHeadline(snapshot, briefing) {
  if (briefing?.headline) return escapeHtml(briefing.headline);
  if (briefing?.title) return escapeHtml(briefing.title);
  // Fallback: synthesize from SP500 + DGS10 + VIX
  const sp = findMetric(snapshot, "SP500");
  const ten = findMetric(snapshot, "DGS10");
  const vix = findMetric(snapshot, "VIXCLS");
  const dir = sp && sp.percentChange > 0.3 ? "강세" : sp && sp.percentChange < -0.3 ? "약세" : "혼조";
  const tenStr = ten ? `${fmtNum(ten.latestValue, 2)}%` : "—";
  const vixStr = vix ? fmtNum(vix.latestValue, 2) : "—";
  return `미국 주식 <em>${dir}</em>, 10년물 ${tenStr}와 VIX ${vixStr}`;
}
function renderMasthead(snapshot, briefing) {
  const dateLabel = briefing?.date || snapshot.reportDate || "";
  const dowKrShort = dowKr(dateLabel);
  const dowE = dowEn(dateLabel);
  const issueNum = (() => {
    if (!dateLabel) return "VOL. I";
    const m = dateLabel.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "VOL. I";
    const start = new Date(Date.UTC(Number(m[1]), 0, 1));
    const cur = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const day = Math.floor((cur - start) / 86400000) + 1;
    return `VOL. ${m[1]} · NO. ${String(day).padStart(3, "0")}`;
  })();

  // Top 5 movers (by absolute magnitude of percent change; for rates use bp×→%-equivalent magnitude)
  const flat = flattenMetrics(snapshot);
  const movers = flat
    .map((it) => {
      const c = metricChange(it);
      if (!c || !Number.isFinite(c.value)) return null;
      const mag = c.isBp ? Math.abs(c.value * 100) : Math.abs(c.value);
      return { it, mag };
    })
    .filter(Boolean)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 5);

  const sideRows = movers.map(({ it }) => `<div class="row">
    <span class="lbl">${escapeHtml(it.label)}</span>
    <span class="val">${escapeHtml(formatValue(it))}<span class="chg ${changeTone(it)}">${escapeHtml(formatChange(it))}</span></span>
  </div>`).join("");

  const subtitle = briefing?.overnightLead || briefing?.insightSections?.topStory?.[0]?.desc || "";
  const headlineHtml = deriveHeadline(snapshot, briefing);

  // Replace bold-numbers in deck with subtle highlight
  const deck = escapeHtml(subtitle)
    .replace(/(\d+(?:\.\d+)?%)/g, '<b>$1</b>')
    .replace(/(\d+\.\d+(?=bp))/g, '<b>$1</b>');

  return `<header class="masthead"><div class="shell">
    <div class="top">
      <div class="brand">
        <span class="logo">FM</span>
        <h1 class="wordmark">FRED Market Briefing</h1>
        <span class="sub">Daily Macro Almanac</span>
      </div>
      <div class="meta">
        <span><b>${escapeHtml(issueNum)}</b></span>
        <span>${escapeHtml(dateLabel)} <b>${escapeHtml(dowKrShort)}/${escapeHtml(dowE)}</b></span>
        <span>KOREA STANDARD TIME</span>
      </div>
    </div>
    <span class="kicker"><span class="dot"></span>오늘의 마켓 브리핑<span class="sep">·</span>FRED + 연관 데이터<span class="sep">·</span>일간 정기 발행</span>
    <div class="hero-grid">
      <div>
        <h1 class="hero">${headlineHtml}</h1>
        ${subtitle ? `<p class="deck">${deck}</p>` : ""}
      </div>
      <aside class="hero-side" aria-label="오늘의 주요 변동폭">
        <h4><span>오늘의 주요 변동</span><span>TOP 5</span></h4>
        ${sideRows || `<p style="font-family:'Noto Sans KR';font-size:12px;color:var(--muted);margin:0">데이터 없음</p>`}
        <p class="note">변동폭 절대값 기준. 금리는 베이시스포인트(bp), 그 외에는 퍼센트(%)로 환산해 비교합니다.</p>
      </aside>
    </div>
  </div></header>`;
}

/* ─────────────────────── §01 INDEX MATRIX ─────────────────────── */

function metricCell(item) {
  if (!item) return `<div class="cell"></div>`;
  const chg = formatChange(item);
  const dir = changeTone(item);
  const c = metricChange(item);
  const arrow = arrowFor(c?.value);

  // Value formatting
  let valHtml;
  if (item.format === "percent") {
    const v = Number(item.latestValue);
    if (Number.isFinite(v)) {
      const intPart = Math.trunc(v);
      const frac = Math.abs(v - intPart).toFixed(item.decimals ?? 2).slice(1);
      valHtml = `${intPart}<span class="frac">${frac}%</span>`;
    } else valHtml = "—";
  } else if (item.format === "usd") {
    valHtml = `<span class="frac">$</span>${fmtNum(item.latestValue, item.decimals ?? 2)}`;
  } else {
    valHtml = fmtNum(item.latestValue, item.decimals ?? 2);
  }

  const obsDate = item.observationDate || "";
  const prevDate = item.previousObservationDate || "";

  // Delta visualisation (replaces the sparkline — no series in source data)
  const db = deltaBar(item.previousValue, item.latestValue);
  const barColor = dir === "up" ? "var(--up)" : dir === "down" ? "var(--down)" : "var(--flat)";

  return `<div class="cell">
    <div class="lbl"><span class="ticker">${escapeHtml(item.label)}</span><span>${escapeHtml(item.groupLabel || "")}</span></div>
    <div class="val mono">${valHtml}</div>
    <div class="chg ${dir} mono">${escapeHtml(arrow)} ${escapeHtml(chg)}<span style="color:var(--muted);font-weight:500;margin-left:6px">전일 대비</span></div>
    <div class="spark">${db ? `<svg viewBox="0 0 ${db.w} ${db.h}" preserveAspectRatio="none" width="100%" height="${db.h}">
      <line x1="${db.xPrev.toFixed(1)}" y1="${db.y}" x2="${db.xLast.toFixed(1)}" y2="${db.y}" stroke="${barColor}" stroke-width="3" stroke-linecap="round"></line>
      <circle cx="${db.xPrev.toFixed(1)}" cy="${db.y}" r="3.5" fill="var(--paper)" stroke="${barColor}" stroke-width="1.6"></circle>
      <circle cx="${db.xLast.toFixed(1)}" cy="${db.y}" r="4.2" fill="${barColor}"></circle>
      <text x="${db.xPrev.toFixed(1)}" y="${db.y - 9}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${fmtNum(item.previousValue, item.decimals ?? 2)}</text>
      <text x="${db.xLast.toFixed(1)}" y="${db.y + 18}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="var(--ink)" font-weight="700">${fmtNum(item.latestValue, item.decimals ?? 2)}</text>
    </svg>` : `<div style="height:42px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-family:JetBrains Mono;font-size:10px;letter-spacing:.12em">— PREV DATA UNAVAILABLE —</div>`}</div>
    <div class="foot"><span>OBS ${escapeHtml(obsDate)}</span><span>PREV ${escapeHtml(prevDate)}</span></div>
  </div>`;
}
function renderIndexMatrix(snapshot, briefing) {
  // Pick 4 representative metrics across asset classes
  const ids = ["SP500", "DGS10", "VIXCLS", "DEXKOUS"];
  const flat = flattenMetrics(snapshot);
  const cells = ids.map((id) => metricCell(flat.find((x) => x.id === id))).join("");
  const lines = briefing?.topThreeLines || briefing?.highlights || [];
  const lede = lines.length
    ? `<ul class="lede3">${lines.slice(0, 3).map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
    : "";
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 01</div>
      <div>
        <h2>오늘의 시장 지표</h2>
        <p class="lede">미국 주식·금리·변동성·환율 네 축의 종가와 전일 대비 변화를 한눈에 확인합니다. 변동폭은 전 영업일 대비이며, 금리는 베이시스포인트(bp)로 표시합니다.</p>
      </div>
    </div>
    <div class="matrix">${cells}</div>
    ${lede}
  </div></section>`;
}

/* ─────────────────────── §02 FOUR-AXIS VERDICTS ─────────────────────── */

function readVerdicts(snapshot) {
  const sp = findMetric(snapshot, "SP500");
  const ten = findMetric(snapshot, "DGS10");
  const two = findMetric(snapshot, "DGS2");
  const vix = findMetric(snapshot, "VIXCLS");
  const dxy = findMetric(snapshot, "DTWEXBGS");
  const krw = findMetric(snapshot, "DEXKOUS");

  // Equity
  const eqUp = sp && sp.percentChange > 0;
  const eqStrong = sp && Math.abs(sp.percentChange) > 0.4;
  const eq = {
    title: "주식",
    label: !sp ? "—" : (eqUp && eqStrong) ? "상승 흐름" : (!eqUp && eqStrong) ? "조정 흐름" : "박스권",
    text: sp
      ? `S&P 500이 ${signed(sp.percentChange, 2)}%로 ${formatValue(sp)}에 마감했습니다. ${eqUp ? "위험선호가 우위인 환경입니다." : "차익실현 압력이 우위인 환경입니다."}`
      : "데이터 없음",
    evidence: sp ? `S&P 500 ${formatValue(sp)} · ${signed(sp.percentChange, 2)}%` : "—",
    tone: !sp ? "" : eqUp ? "" : "warn"
  };

  // Rates
  const tenUp = ten && ten.absoluteChange > 0;
  const sameDir = ten && two && Math.sign(ten.absoluteChange) === Math.sign(two.absoluteChange) && ten.absoluteChange !== 0;
  const rates = {
    title: "금리",
    label: !ten || !two ? "—" : sameDir ? (tenUp ? "장·단기 동반 상승" : "장·단기 동반 하락") : "장·단기 엇갈림",
    text: ten && two
      ? `2년물 ${bp(two.absoluteChange)}, 10년물 ${bp(ten.absoluteChange)}. ${tenUp ? "할인율(미래 현금흐름을 현재가치로 깎는 비율)이 높아져 성장주에 부담입니다." : "할인율이 낮아져 듀레이션이 긴 자산에 우호적입니다."}`
      : "데이터 없음",
    evidence: ten && two ? `2Y ${fmtNum(two.latestValue, 2)}% · 10Y ${fmtNum(ten.latestValue, 2)}%` : "—",
    tone: !ten ? "" : tenUp ? "warn" : ""
  };

  // Volatility
  const vixUp = vix && vix.percentChange > 0;
  const eqAndVixUp = eqUp && vixUp;
  const vol = {
    title: "변동성",
    label: !vix ? "—" : eqAndVixUp ? "주가↑인데 VIX↑" : vixUp ? "위험회피 심화" : "안도 분위기",
    text: vix
      ? eqAndVixUp
        ? `VIX ${fmtNum(vix.latestValue, 2)}로 ${signed(vix.percentChange, 2)}%. 주가가 오르면 보통 VIX는 내려가지만 오늘은 함께 올라, 시장이 끌어올리면서도 하락 대비 옵션을 함께 사고 있다는 뜻입니다.`
        : `VIX ${fmtNum(vix.latestValue, 2)}. 옵션 시장은 ${vixUp ? "변동성 확대를 베팅" : "변동성 축소에 베팅"} 중입니다.`
      : "데이터 없음",
    evidence: vix ? `VIX ${fmtNum(vix.latestValue, 2)} · ${signed(vix.percentChange, 2)}%` : "—",
    tone: !vix ? "" : eqAndVixUp ? "warn" : vixUp ? "bear" : ""
  };

  // FX (DXY uses index, KRW uses krw format → use percentChange for both)
  const dxyUp = dxy && dxy.percentChange > 0;
  const krwUp = krw && krw.percentChange > 0;
  const fxAligned = dxy && krw && Math.sign(dxy.percentChange) === Math.sign(krw.percentChange);
  const fx = {
    title: "달러",
    label: !dxy && !krw ? "—" : fxAligned ? (dxyUp ? "달러 강세" : "달러 약세") : "방향성 혼재",
    text: dxy || krw
      ? `${dxy ? `DXY ${signed(dxy.percentChange, 2)}%` : ""}${dxy && krw ? ", " : ""}${krw ? `USD/KRW ${signed(krw.percentChange, 2)}%` : ""}. ${fxAligned ? (dxyUp ? "원화 약세 압력이 동시에 들어옵니다." : "원화 강세 흐름과 일치합니다.") : "두 지표 방향이 어긋나거나 강도가 달라 한쪽 동인이 더 큰 영향을 미친다고 해석됩니다."}`
      : "데이터 없음",
    evidence: dxy && krw ? `DXY ${fmtNum(dxy.latestValue, 2)} · KRW ${fmtNum(krw.latestValue, 2)}` : "—",
    tone: ""
  };

  return [eq, rates, vol, fx];
}
function renderVerdicts(snapshot) {
  const items = readVerdicts(snapshot);
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 02</div>
      <div>
        <h2>오늘의 시장 신호 / 4축 요약</h2>
        <p class="lede">주식·금리·변동성·달러를 각각 하나의 문장으로 요약합니다. 평소와 다른 패턴이 보이는 항목에는 "주가↑인데 VIX↑"처럼 그 의미를 함께 적었습니다.</p>
      </div>
    </div>
    <div class="verdicts">
      ${items.map((it) => `<article class="verdict ${it.tone}">
        <h4>${escapeHtml(it.title)}</h4>
        <p class="v">${escapeHtml(it.label)}</p>
        <p>${escapeHtml(it.text)}</p>
        <p class="ev mono">${escapeHtml(it.evidence)}</p>
      </article>`).join("")}
    </div>
  </div></section>`;
}

/* ─────────────────────── §03 DATA TABLE + YIELD CURVE ─────────────────────── */

function renderDataTable(snapshot, caption) {
  const flat = flattenMetrics(snapshot);
  const rows = flat.map((it) => {
    const chg = formatChange(it);
    const dir = changeTone(it);
    const freshStatus = it.freshness?.status || "fresh";
    return `<tr>
      <td class="lbl-ko">${escapeHtml(it.label)} <span class="chip ${freshnessChipClass(freshStatus)}" style="margin-left:6px;font-size:9px;padding:1px 5px">${escapeHtml(freshnessChipLabel(freshStatus))}</span></td>
      <td>${escapeHtml(it.groupLabel || "")}</td>
      <td class="num">${escapeHtml(formatValue(it))}</td>
      <td class="num ${dir}">${escapeHtml(chg)}</td>
      <td class="obs">${escapeHtml(it.observationDate || "")}</td>
    </tr>`;
  }).join("");
  return `<table class="data-table">
    <caption>${escapeHtml(caption)}</caption>
    <thead><tr><th>지표</th><th>분류</th><th class="num">종가</th><th class="num">변동</th><th>관측일</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderYieldCurve(snapshot) {
  // Use DFF (effective fed funds), DGS2, DGS10 — these are what the snapshot contains
  const ids = ["DFF", "DGS2", "DGS10"];
  const labels = { DFF: "EFFR", DGS2: "2Y", DGS10: "10Y" };
  const flat = flattenMetrics(snapshot);
  const points = ids
    .map((id) => {
      const it = flat.find((x) => x.id === id);
      if (!it || !Number.isFinite(it.latestValue)) return null;
      return {
        label: labels[id],
        value: it.latestValue,
        prev: Number.isFinite(it.previousValue) ? it.previousValue : it.latestValue
      };
    })
    .filter(Boolean);

  // Headline = spread metric if present
  const spread = flat.find((x) => x.id === "UST10Y_UST2Y_SPREAD");
  const headline = spread
    ? `<div style="display:flex;align-items:baseline;gap:18px;margin:8px 0 14px">
        <div style="font-family:'Source Serif 4',serif;font-weight:800;font-size:3.2rem;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${spread.latestValue > 0 ? "+" : ""}${Math.round(spread.latestValue * 100)}<span style="font-size:1.4rem;color:var(--muted)">bp</span></div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="mono ${changeTone(spread)}" style="font-size:12px;font-weight:600">${escapeHtml(formatChange(spread))} 전일 대비</span>
          <span class="mono" style="font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">10Y–2Y · ${spread.latestValue >= 0 ? "정상 곡선" : "역전 곡선"} · 0bp가 침체 임계</span>
        </div>
      </div>`
    : "";

  if (points.length < 2) {
    return `<div class="curve-card"><h3>일드 커브</h3>${headline || `<p class="sub">DATA UNAVAILABLE</p>`}</div>`;
  }

  const w = 380, h = 200, padL = 40, padR = 16, padT = 14, padB = 36;
  const xs = points.map((_, i) => padL + ((w - padL - padR) / (points.length - 1)) * i);
  const allVals = points.flatMap((p) => [p.value, p.prev]);
  const minV = Math.min(...allVals) - 0.05;
  const maxV = Math.max(...allVals) + 0.05;
  const yFor = (v) => padT + (1 - (v - minV) / (maxV - minV)) * (h - padT - padB);

  const linePath = (key) => points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${yFor(p[key]).toFixed(1)}`).join(" ");
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => minV + ((maxV - minV) / yTicks) * i);

  return `<div class="curve-card">
    <h3>장단기 금리 스프레드 (10Y–2Y)</h3>
    <p class="sub">경기 침체 신호의 핵심 지표 · 음수면 역전</p>
    ${headline}
    <svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Yield curve">
      ${tickVals.map((v) => {
        const y = yFor(v).toFixed(1);
        return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--grid)" stroke-width="1"></line>
          <text x="${padL - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${v.toFixed(2)}</text>`;
      }).join("")}
      ${points.map((p, i) => `<text x="${xs[i].toFixed(1)}" y="${h - padB + 16}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="var(--ink)" font-weight="700">${p.label}</text>`).join("")}
      <path d="${linePath("prev")}" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="3 3"></path>
      <path d="${linePath("value")}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"></path>
      ${points.map((p, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${yFor(p.value).toFixed(1)}" r="3.4" fill="var(--accent)"></circle>
        <text x="${xs[i].toFixed(1)}" y="${(yFor(p.value) - 10).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="var(--ink)" font-weight="700">${p.value.toFixed(2)}</text>`).join("")}
      <g font-family="JetBrains Mono" font-size="9" fill="var(--muted)">
        <line x1="${padL + 4}" y1="14" x2="${padL + 24}" y2="14" stroke="var(--accent)" stroke-width="2"></line>
        <text x="${padL + 28}" y="17">오늘</text>
        <line x1="${padL + 68}" y1="14" x2="${padL + 88}" y2="14" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="3 3"></line>
        <text x="${padL + 92}" y="17">전일</text>
      </g>
    </svg>
    <p style="margin:14px 0 0;font-size:.84rem;color:var(--muted);line-height:1.55">
      이 그림은 만기가 짧은 금리(왼쪽)부터 긴 금리(오른쪽)를 차례로 잇습니다.
      <b>우상향</b>이면 정상, <b>평탄·하향</b>이면 경기 둔화 신호로 해석합니다.
    </p>
  </div>`;
}
function renderDataAndCurve(snapshot) {
  const tbl = renderDataTable(snapshot, "전체 지표 데이터");
  const curve = renderYieldCurve(snapshot);
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 03</div>
      <div>
        <h2>전체 지표 데이터 · 일드 커브</h2>
        <p class="lede">표는 오늘 마감된 모든 지표의 종가와 변동폭을 그대로 보여줍니다. 우측 곡선은 만기별 금리를 한 그림으로 묶어, 시장이 단기와 장기를 어떻게 다르게 보는지 비교합니다.</p>
      </div>
    </div>
    <div class="data-grid">
      ${tbl}
      ${curve}
    </div>
  </div></section>`;
}

/* ─────────────────────── §04 KEY ISSUES ─────────────────────── */
function renderIssues(briefing) {
  const issues = (briefing?.keyIssues || []).slice(0, 5);
  if (!issues.length) return "";
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 04</div>
      <div>
        <h2>오늘의 핵심 이슈</h2>
        <p class="lede">데이터 한 줄로 끝낼 수 없는 이슈를 풀어 적습니다. <em>WHAT</em> 어떤 사실인지, <em>WHY</em> 왜 시장이 그렇게 반응했는지, <em>WATCH</em> 앞으로 무엇을 봐야 하는지로 나눕니다.</p>
      </div>
    </div>
    <div class="issues">
      ${issues.map((s, i) => `<article class="issue">
        <div class="idx">${String(i + 1).padStart(2, "0")}</div>
        <div>
          <h3>${escapeHtml(s.title || "")}</h3>
          <dl>
            <dt>WHAT · 사실</dt><dd>${escapeHtml(s.whatHappened || "—")}</dd>
            <dt>WHY · 반응</dt><dd>${escapeHtml(s.whyMarketReacted || "—")}</dd>
            <dt>WATCH · 관측</dt><dd>${escapeHtml(s.whatToWatch || "—")}</dd>
          </dl>
        </div>
      </article>`).join("")}
    </div>
  </div></section>`;
}

/* ─────────────────────── §05 SECTOR HEATMAP ─────────────────────── */

const SECTOR_KO = {
  XLK: "기술", XLF: "금융", XLE: "에너지", XLV: "헬스케어", XLY: "임의소비재",
  XLI: "산업재", XLP: "필수소비재", XLB: "소재", XLRE: "리츠", XLU: "유틸리티",
  XLC: "커뮤니케이션", SOXX: "반도체", SPY: "S&P 500", QQQ: "나스닥 100"
};
function renderSectors(snapshot) {
  const etfs = snapshot?.contextEnrichment?.sectorEtfs?.items || [];
  if (!etfs.length) return "";

  const items = etfs
    .filter((e) => Number.isFinite(e.percentChange))
    .map((e) => ({ ...e, ko: SECTOR_KO[e.ticker] || (e.label || "").replace(/^미국 |\s*ETF\s*$/g, "") }));

  if (!items.length) return "";

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 05</div>
      <div>
        <h2>섹터 히트맵</h2>
        <p class="lede">SPDR 섹터 ETF의 일간 변동폭. 같은 날에도 어떤 업종이 시장 전체를 앞섰고 어떤 업종이 뒤처졌는지 한눈에 보여줍니다.</p>
      </div>
    </div>
    ${renderBars(items)}
  </div></section>`;
}

function renderBars(items) {
  const sorted = items.slice().sort((a, b) => (b.percentChange ?? 0) - (a.percentChange ?? 0));
  const max = Math.max(0.5, ...sorted.map((x) => Math.abs(x.percentChange ?? 0)));
  return `<div class="sectors">${sorted.map((it) => {
    const pct = it.percentChange ?? 0;
    const widthPct = Math.min(50, (Math.abs(pct) / max) * 50);
    const isNeg = pct < 0;
    const left = isNeg ? `${50 - widthPct}%` : "50%";
    const dir = tone(pct);
    return `<div class="sector-row">
      <div class="name"><span class="ticker">${escapeHtml(it.ticker || "")}</span><span class="ko">${escapeHtml(it.ko || it.label || "")}</span></div>
      <div class="bar-track"><div class="bar-fill ${isNeg ? "neg" : ""}" style="left:${left};width:${widthPct.toFixed(2)}%"></div></div>
      <div class="pct ${dir}">${signed(pct, 2)}%</div>
    </div>`;
  }).join("")}</div>`;
}

/* ─────────────────────── §06 TIMELINE + CHECKPOINTS ─────────────────────── */
function renderTimeline(snapshot, briefing) {
  const cal = snapshot?.contextEnrichment?.eventCalendar?.events || [];
  const checks = (briefing?.koreanCheckpoints || []).slice(0, 5);

  const tl = cal.slice(0, 8);
  if (!tl.length && !checks.length) return "";

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 06</div>
      <div>
        <h2>다가오는 일정 · 한국 시장 체크포인트</h2>
        <p class="lede">앞으로 시장을 흔들 수 있는 미국 경제 일정과, 한국 시장 관점에서 봐야 할 임계 수준을 묶어 적습니다.</p>
      </div>
    </div>
    <div class="data-grid">
      ${tl.length ? `<div class="timeline-card">
        <h3>이코노믹 캘린더</h3>
        <p class="sub">UPCOMING U.S. RELEASES</p>
        <div class="tl-list">
          ${tl.map((ev) => {
            const imp = (ev.importance || "").toLowerCase();
            const cls = imp === "high" ? "high" : "";
            const date = ev.date || "";
            const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const dateLabel = m ? `${Number(m[2])}/${Number(m[3])}` : date;
            return `<div class="tl-event ${cls}">
              <div class="when"><span class="day">${escapeHtml(dowKr(date))}</span>${escapeHtml(dateLabel)}</div>
              <div class="name">${escapeHtml(ev.name || "—")}${ev.whyItMatters ? `<span class="ko">${escapeHtml(ev.whyItMatters)}</span>` : ""}</div>
              <div class="imp">${escapeHtml(imp ? imp.toUpperCase() : "MED")}</div>
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}
      <div>
        <div class="checkpoints">
          ${checks.length ? checks.map((line, i) => `<div class="checkpoint">
            <div class="marker">CHECK ${String(i + 1).padStart(2, "0")}</div>
            <p>${escapeHtml(typeof line === "string" ? line : line.text || "")}</p>
          </div>`).join("") : `<p style="color:var(--muted);font-size:.92rem">한국 시장 체크포인트가 비어 있습니다.</p>`}
        </div>
      </div>
    </div>
  </div></section>`;
}

/* ─────────────────────── §07 POSITIONING ─────────────────────── */
function renderPositioning(briefing) {
  const main = briefing?.positioning?.mainScenario;
  const alt = briefing?.positioning?.altScenario;
  if (!main && !alt) return "";

  const renderCard = (data, alt = false) => {
    if (!data) return "";
    const triggers = Array.isArray(data.triggers) ? data.triggers : [];
    return `<article class="pos-card ${alt ? "alt" : ""}">
      <div class="top">${alt ? "ALT CASE · 대체 시나리오" : "BASE CASE · 기본 시나리오"}</div>
      <h3>${escapeHtml(data.view || data.condition || "—")}</h3>
      <dl>
        ${data.reasoning ? `<dt>근거</dt><dd>${escapeHtml(data.reasoning)}</dd>` : ""}
        ${data.pros ? `<dt>긍정 요인</dt><dd>${escapeHtml(data.pros)}</dd>` : ""}
        ${data.cons ? `<dt>부정 요인</dt><dd>${escapeHtml(data.cons)}</dd>` : ""}
        ${triggers.length ? `<dt>트리거</dt><dd><ul>${triggers.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></dd>` : ""}
        ${data.executionHint ? `<dt>실행 힌트</dt><dd>${escapeHtml(data.executionHint)}</dd>` : ""}
        ${alt && data.condition ? `<dt>발동 조건</dt><dd>${escapeHtml(data.condition)}</dd>` : ""}
      </dl>
    </article>`;
  };

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 07</div>
      <div>
        <h2>참고 포지셔닝 · 시나리오</h2>
        <p class="lede">위 4축 신호와 일정을 종합해 가상의 멀티에셋 포트폴리오가 취할 만한 자세를 적습니다. 실제 매매 권유가 아니라 사고의 출발점입니다.</p>
      </div>
    </div>
    <div class="pos-grid">
      ${renderCard(main, false)}
      ${renderCard(alt, true)}
    </div>
    ${briefing?.complianceNote ? `<p class="compliance">${escapeHtml(briefing.complianceNote)}</p>` : `<p class="compliance">본 자료는 정보 제공 목적이며 특정 종목의 매수·매도를 권유하지 않습니다. 투자 판단과 그 결과에 대한 책임은 투자자에게 있습니다.</p>`}
  </div></section>`;
}

/* ─────────────────────── §08 COMMENTARY ESSAY ─────────────────────── */
function renderEssay(briefing) {
  // briefing.commentary is array of paragraphs
  const paragraphs = Array.isArray(briefing?.commentary) ? briefing.commentary : [];
  if (!paragraphs.length) return "";
  const html = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 08</div>
      <div>
        <h2>오늘의 시장 해설</h2>
        <p class="lede">데이터를 잇는 흐름과 맥락을 풀어 적습니다.</p>
      </div>
    </div>
    <div class="essay">${html}</div>
  </div></section>`;
}

/* ─────────────────────── §09 DATA UPDATE STATUS ─────────────────────── */
function renderFreshness(snapshot) {
  const summary = snapshot?.freshnessSummary;
  const items = summary?.items || [];
  if (!items.length) return "";

  const summaryBar = `
    <div style="display:flex;gap:18px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em;color:var(--muted);margin:0 0 18px;flex-wrap:wrap">
      <span><span class="chip fresh" style="margin-right:6px">최신</span>${summary.freshCount ?? 0}건</span>
      <span><span class="chip delayed" style="margin-right:6px">지연</span>${summary.delayedCount ?? 0}건</span>
      <span><span class="chip stale" style="margin-right:6px">오래됨</span>${summary.staleCount ?? 0}건</span>
      <span style="margin-left:auto">기준일 ${escapeHtml(summary.reportDate || "")}</span>
    </div>`;

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 09</div>
      <div>
        <h2>데이터 업데이트 현황</h2>
        <p class="lede">각 지표가 언제 마감된 데이터를 사용했는지 표시합니다. <span class="chip fresh">최신</span>은 당일, <span class="chip delayed">지연</span>은 1영업일, <span class="chip stale">오래됨</span>은 그 이상입니다.</p>
      </div>
    </div>
    ${summaryBar}
    <div class="fresh-grid">
      ${items.map((f) => `<div class="fresh-cell">
        <div class="top">
          <span>${escapeHtml(f.id || "—")}</span>
          <span class="chip ${freshnessChipClass(f.status)}">${escapeHtml(freshnessChipLabel(f.status))}</span>
        </div>
        <div class="lbl">${escapeHtml(f.label || "")}</div>
        <div class="obs">OBS · ${escapeHtml(f.observationDate || "—")} ${f.businessDaysOld ? `· ${f.businessDaysOld}영업일 전` : ""}</div>
      </div>`).join("")}
    </div>
  </div></section>`;
}

/* ─────────────────────── COLOPHON ─────────────────────── */
function renderColophon(snapshot, briefing) {
  return `<footer class="colophon"><div class="shell">
    <div class="row">
      <span><b>FRED Market Briefing</b> · 자동 생성 데일리 브리핑</span>
      <span>데이터 출처: FRED (Federal Reserve Bank of St. Louis) · ${escapeHtml(snapshot.source || "")}</span>
    </div>
    <div class="row">
      <span>발행: ${escapeHtml(formatDateTimeKST(snapshot.generatedAt))} KST</span>
      <span>리포트 일자: ${escapeHtml(briefing?.date || snapshot.reportDate || "—")}</span>
      <span>모드: ${escapeHtml(snapshot.mode || "fred")}</span>
    </div>
    <div class="row">
      <span>${escapeHtml(briefing?.complianceNote || "본 자료는 정보 제공 목적이며, 어떠한 투자 권유도 포함하지 않습니다. 데이터 정확성은 원자료를 우선합니다.")}</span>
    </div>
  </div></footer>`;
}


// ──────────────────────────────────────────────────────────────────────
// entry
// ──────────────────────────────────────────────────────────────────────
function escapeForTitle(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml({ snapshot, briefing }) {
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
${renderIndexMatrix(snapshot, briefing)}
${renderVerdicts(snapshot)}
${renderDataAndCurve(snapshot)}
${renderIssues(briefing)}
${renderSectors(snapshot)}
${renderTimeline(snapshot, briefing)}
${renderPositioning(briefing)}
${renderEssay(briefing)}
${renderFreshness(snapshot)}
</main>
${renderColophon(snapshot, briefing)}
</body>
</html>`;
}

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const briefings = JSON.parse(await readFile(BRIEFINGS_PATH, "utf8"));
  const reportDate = REPORT_DATE_OVERRIDE || snapshot.reportDate || briefings[0]?.date;
  const briefing = briefings.find((item) => item.date === reportDate) || briefings[0];

  if (!briefing) {
    throw new Error("No briefing record found. Run publish first.");
  }

  const html = buildHtml({ snapshot, briefing });
  const reportPath = path.join(REPORTS_DIR, `${briefing.date}.html`);

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(reportPath, html, "utf8");
  await writeFile(LATEST_REPORT_PATH, html, "utf8");

  console.log(`Wrote report to ${reportPath}`);
  console.log(`Updated latest report at ${LATEST_REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
