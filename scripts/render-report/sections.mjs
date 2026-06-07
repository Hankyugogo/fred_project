// sections.mjs — renders each section of the new report.
// All field paths match the real `market-snapshot.json` and `briefings.json` schemas.

import {
  escapeHtml, fmtNum, signed, bp, tone, arrowFor,
  flattenMetrics, findMetric, formatValue, formatChange, metricChange, changeTone,
  deltaBar, shortMD, dowEn, dowKr, formatDateTimeKST,
  freshnessChipClass, freshnessChipLabel,
  historyById, pctChangeOver, absChangeOver, PERIODS, formatPeriodChange,
  buildLineChart, closes
} from "./utils.mjs";
import { formatReportCalendarLine } from "../lib/report-calendar.mjs";

/* ─────────────────────── TAPE (top ticker bar) ─────────────────────── */

export function renderTape(snapshot) {
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

export function renderMasthead(snapshot, briefing) {
  const dateLabel = briefing?.date || snapshot.reportDate || "";
  const calendar = snapshot?.reportCalendar || null;
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
        <span>US EQUITY <b>${escapeHtml(calendar?.usEquityReferenceDate || "—")}</b></span>
        <span>KOREA <b>${escapeHtml(calendar?.koreaMarketReferenceDate || "—")}</b></span>
        <span>KOREA STANDARD TIME</span>
      </div>
    </div>
    <span class="kicker"><span class="dot"></span>오늘의 마켓 브리핑<span class="sep">·</span>FRED + 연관 데이터<span class="sep">·</span>일간 정기 발행</span>
    ${calendar ? `<div class="calendar-strip">
      <span>${escapeHtml(formatReportCalendarLine(calendar))}</span>
      <span>${escapeHtml(calendar.note || "")}</span>
    </div>` : ""}
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

function renderPeriodsStrip(item, macroHistory) {
  const series = historyById(macroHistory, item.id);
  if (!series) return "";
  const kind = item.format === "percent" ? "rate" : "price";
  const cells = PERIODS.map((p) => {
    const r = formatPeriodChange(series, p.days, kind);
    return `<div class="p">
      <span class="key">${p.id}</span>
      <span class="v ${r.tone}">${escapeHtml(r.text)}</span>
    </div>`;
  }).join("");
  return `<div class="periods">${cells}</div>`;
}

function metricCell(item, macroHistory) {
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
    ${renderPeriodsStrip(item, macroHistory)}
    <div class="foot"><span>OBS ${escapeHtml(obsDate)}</span><span>PREV ${escapeHtml(prevDate)}</span></div>
  </div>`;
}

export function renderIndexMatrix(snapshot, briefing, macroHistory) {
  // Pick 4 representative metrics across asset classes
  const ids = ["SP500", "DGS10", "VIXCLS", "DEXKOUS"];
  const flat = flattenMetrics(snapshot);
  const cells = ids.map((id) => metricCell(flat.find((x) => x.id === id), macroHistory)).join("");
  const lines = briefing?.topThreeLines || briefing?.highlights || [];
  const lede = lines.length
    ? `<ul class="lede3">${lines.slice(0, 3).map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
    : "";
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 01</div>
      <div>
        <h2>오늘의 시장 지표</h2>
        <p class="lede">미국 주식·금리·변동성·환율 네 축의 종가, 그리고 전일·1주·1개월·1년 대비 변동을 함께 봅니다. 금리는 베이시스포인트(bp), 그 외에는 퍼센트(%)로 표기합니다.</p>
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

export function renderVerdicts(snapshot) {
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

/* ─────────────────────── §03 DATA TABLE + SPREAD vs NASDAQ ─────────────────────── */

function renderDataTable(snapshot, macroHistory, caption) {
  const flat = flattenMetrics(snapshot);
  const rows = flat.map((it) => {
    const chg = formatChange(it);
    const dir = changeTone(it);
    const freshStatus = it.freshness?.status || "fresh";
    const kind = it.format === "percent" ? "rate" : "price";
    const series = historyById(macroHistory, it.id);
    const periods = PERIODS.map((p) => {
      const r = series ? formatPeriodChange(series, p.days, kind) : { text: "—", tone: "flat" };
      return `<td class="num ${r.tone}">${escapeHtml(r.text)}</td>`;
    }).join("");
    return `<tr>
      <td class="lbl-ko">${escapeHtml(it.label)} <span class="chip ${freshnessChipClass(freshStatus)}" style="margin-left:6px;font-size:9px;padding:1px 5px">${escapeHtml(freshnessChipLabel(freshStatus))}</span></td>
      <td>${escapeHtml(it.groupLabel || "")}</td>
      <td class="num">${escapeHtml(formatValue(it))}</td>
      <td class="num ${dir}">${escapeHtml(chg)}</td>
      ${periods}
      <td class="obs">${escapeHtml(it.observationDate || "")}</td>
    </tr>`;
  }).join("");
  return `<table class="data-table">
    <caption>${escapeHtml(caption)}</caption>
    <thead><tr><th>지표</th><th>분류</th><th class="num">종가</th><th class="num">전일</th><th class="num">1주</th><th class="num">1개월</th><th class="num">1년</th><th>관측일</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderDataAndCurve(snapshot, macroHistory) {
  const tbl = renderDataTable(snapshot, macroHistory, "전체 지표 데이터 · 다기간 변동");
  const spreadVsNasdaq = renderSpreadVsNasdaq(macroHistory);
  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 03</div>
      <div>
        <h2>전체 지표 데이터 · 스프레드 vs 나스닥</h2>
        <p class="lede">표는 오늘 마감된 모든 지표의 종가와 1주·1개월·1년 변동을 보여줍니다. 하단 차트는 <b>10년–2년 금리 스프레드</b>가 5년 동안 움직인 흐름을 <b>나스닥 지수</b>와 같은 그래프에 겹쳐, 둘 사이의 상관관계와 시점별 갈림길을 한눈에 보여줍니다.</p>
      </div>
    </div>
    ${tbl}
    ${spreadVsNasdaq}
  </div></section>`;
}

// Renders a dual-axis 5-year line chart: 10Y–2Y spread (bp, left axis) and NASDAQ (right axis)
function renderSpreadVsNasdaq(macroHistory) {
  if (!macroHistory?.items) return "";
  const ten = macroHistory.items.find((i) => i.id === "DGS10");
  const two = macroHistory.items.find((i) => i.id === "DGS2");
  const nas = macroHistory.items.find((i) => i.id === "NASDAQCOM");
  if (!ten?.history?.length || !two?.history?.length || !nas?.history?.length) return "";

  // Align by date, build spread series in bp.
  const twoMap = new Map(two.history.map((p) => [p.date, p.close]));
  const nasMap = new Map(nas.history.map((p) => [p.date, p.close]));
  const aligned = [];
  for (const p of ten.history) {
    const t2 = twoMap.get(p.date);
    const nx = nasMap.get(p.date);
    if (Number.isFinite(p.close) && Number.isFinite(t2) && Number.isFinite(nx)) {
      aligned.push({ date: p.date, spread: (p.close - t2) * 100, nasdaq: nx });
    }
  }
  if (aligned.length < 20) return "";

  const w = 1180, h = 360, padL = 70, padR = 70, padT = 32, padB = 44;
  const stepX = (w - padL - padR) / (aligned.length - 1);
  const spreadVals = aligned.map((a) => a.spread);
  const nasVals = aligned.map((a) => a.nasdaq);
  const sMin = Math.min(0, Math.min(...spreadVals)) - 10;
  const sMax = Math.max(0, Math.max(...spreadVals)) + 10;
  const nMin = Math.min(...nasVals) * 0.96;
  const nMax = Math.max(...nasVals) * 1.04;
  const ySpread = (v) => padT + (1 - (v - sMin) / (sMax - sMin)) * (h - padT - padB);
  const yNas = (v) => padT + (1 - (v - nMin) / (nMax - nMin)) * (h - padT - padB);
  const xFor = (i) => padL + stepX * i;
  const yZero = ySpread(0);

  // Identify inversion bands (spread < 0) as background rectangles
  const inversions = [];
  let openStart = null;
  for (let i = 0; i < aligned.length; i++) {
    const isInv = aligned[i].spread < 0;
    if (isInv && openStart === null) openStart = i;
    else if (!isInv && openStart !== null) {
      if (i - openStart >= 5) inversions.push([openStart, i - 1]);
      openStart = null;
    }
  }
  if (openStart !== null && aligned.length - openStart >= 5) inversions.push([openStart, aligned.length - 1]);

  const spreadPath = aligned.map((a, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${ySpread(a.spread).toFixed(1)}`).join(" ");
  const nasdaqPath = aligned.map((a, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yNas(a.nasdaq).toFixed(1)}`).join(" ");

  const last = aligned[aligned.length - 1];
  const first = aligned[0];

  // Y axis ticks
  const sTickStep = (sMax - sMin) > 400 ? 100 : (sMax - sMin) > 200 ? 50 : 25;
  const sTicks = [];
  for (let v = Math.ceil(sMin / sTickStep) * sTickStep; v <= sMax; v += sTickStep) sTicks.push(v);
  const nTickCount = 5;
  const nTicks = Array.from({ length: nTickCount + 1 }, (_, i) => nMin + ((nMax - nMin) / nTickCount) * i);

  // X axis: year labels (~5)
  const yearLabels = [];
  let seenYears = new Set();
  for (let i = 0; i < aligned.length; i++) {
    const y = aligned[i].date.slice(0, 4);
    if (!seenYears.has(y)) {
      yearLabels.push({ i, year: y });
      seenYears.add(y);
    }
  }

  // Correlation (Pearson) between spread and nasdaq over full window
  const n = aligned.length;
  const sm = spreadVals.reduce((a, v) => a + v, 0) / n;
  const nm = nasVals.reduce((a, v) => a + v, 0) / n;
  let cov = 0, sV = 0, nV = 0;
  for (let i = 0; i < n; i++) {
    const ds = spreadVals[i] - sm;
    const dn = nasVals[i] - nm;
    cov += ds * dn; sV += ds * ds; nV += dn * dn;
  }
  const correlation = cov / Math.sqrt(sV * nV);
  const corrPct = (correlation * 100).toFixed(0);
  const corrLabel = Math.abs(correlation) > 0.6 ? "강한" : Math.abs(correlation) > 0.3 ? "중간" : "약한";
  const corrDir = correlation > 0 ? "양의" : "음의";

  // 5y % change for NASDAQ + spread bp change
  const nasdaqRet = ((last.nasdaq - first.nasdaq) / first.nasdaq) * 100;
  const spreadBpChange = last.spread - first.spread;

  return `<div class="spread-card">
    <div class="spread-head">
      <div>
        <h3>10Y–2Y 스프레드 추이 vs 나스닥 (5년)</h3>
        <p class="sub mono">${escapeHtml(first.date)} → ${escapeHtml(last.date)} · 1영업일 간격</p>
      </div>
      <div class="spread-stats mono">
        <div class="stat">
          <span class="key">현재 스프레드</span>
          <strong class="${last.spread >= 0 ? "up" : "down"}">${last.spread > 0 ? "+" : ""}${Math.round(last.spread)}bp</strong>
        </div>
        <div class="stat">
          <span class="key">5년 변동</span>
          <strong class="${spreadBpChange >= 0 ? "up" : "down"}">${spreadBpChange > 0 ? "+" : ""}${Math.round(spreadBpChange)}bp</strong>
        </div>
        <div class="stat">
          <span class="key">나스닥 (현재)</span>
          <strong>${fmtNum(last.nasdaq, 0)}</strong>
        </div>
        <div class="stat">
          <span class="key">나스닥 5Y</span>
          <strong class="${nasdaqRet >= 0 ? "up" : "down"}">${signed(nasdaqRet, 1)}%</strong>
        </div>
        <div class="stat">
          <span class="key">상관계수</span>
          <strong class="${correlation > 0 ? "up" : "down"}">${corrPct}%</strong>
        </div>
        <div class="stat">
          <span class="key">역전 구간</span>
          <strong class="${inversions.length ? "down" : "up"}">${inversions.length}회</strong>
        </div>
      </div>
    </div>
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="auto" preserveAspectRatio="none" style="display:block">
      ${inversions.map(([a, b]) => {
        const x1 = xFor(a), x2 = xFor(b);
        return `<rect x="${x1.toFixed(1)}" y="${padT}" width="${(x2 - x1).toFixed(1)}" height="${(h - padT - padB).toFixed(1)}" fill="var(--down)" fill-opacity="0.07"/>`;
      }).join("")}
      ${sTicks.map((t) => {
        const y = ySpread(t);
        const isZero = Math.abs(t) < 0.001;
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="${isZero ? "var(--down)" : "var(--grid)"}" stroke-width="${isZero ? 1.2 : 0.5}" ${isZero ? `stroke-dasharray="5 3"` : ""}/>
          <text x="${padL - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="${isZero ? "var(--down)" : "var(--muted)"}" font-weight="${isZero ? 700 : 500}">${t > 0 ? "+" : ""}${Math.round(t)}${isZero ? "bp 역전" : "bp"}</text>`;
      }).join("")}
      ${nTicks.map((t) => {
        const y = yNas(t);
        return `<text x="${(w - padR + 8).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="start" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="var(--accent-2)">${fmtNum(t, 0)}</text>`;
      }).join("")}
      <path d="${nasdaqPath}" fill="none" stroke="var(--accent-2)" stroke-width="1.6" stroke-linejoin="round" opacity="0.85"/>
      <path d="${spreadPath}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="${xFor(aligned.length - 1).toFixed(1)}" cy="${ySpread(last.spread).toFixed(1)}" r="4" fill="var(--accent)"/>
      <circle cx="${xFor(aligned.length - 1).toFixed(1)}" cy="${yNas(last.nasdaq).toFixed(1)}" r="4" fill="var(--accent-2)"/>
      ${yearLabels.map(({ i, year }) =>
        `<text x="${xFor(i).toFixed(1)}" y="${(h - 14).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="var(--muted)">${escapeHtml(year)}</text>`
      ).join("")}
      <text x="${padL - 8}" y="${(padT - 12).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="var(--accent)" font-weight="700">← 스프레드 (bp)</text>
      <text x="${(w - padR + 8).toFixed(1)}" y="${(padT - 12).toFixed(1)}" text-anchor="start" font-family="JetBrains Mono" font-size="9" fill="var(--accent-2)" font-weight="700">나스닥 →</text>
    </svg>
    <p class="explain">
      <b>스프레드(녹색, 좌축)</b>가 0bp 아래로 내려가면 <b>장단기 역전</b>으로 경기 둔화 신호 — 음영 처리한 구간이 역전 시기입니다.
      <b>나스닥(주황색, 우축)</b>과 겹쳐 보면 두 지표가 같은 방향으로 움직이는지, 반대로 움직이는지 한눈에 비교할 수 있습니다.
      5년 데이터 기준 두 시계열의 상관계수는 <b>${corrPct}%</b>로 <b>${corrLabel} ${corrDir} 상관</b>관계입니다.
    </p>
  </div>`;
}

/* ─────────────────────── §04 KEY ISSUES ─────────────────────── */

export function renderIssues(briefing) {
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

export function renderSectors(snapshot) {
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

export function renderTimeline(snapshot, briefing) {
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

export function renderPositioning(briefing) {
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

/* ─────────────────────── §09 WATCHLIST ─────────────────────── */

const TONE_CLASS_KO = {
  positive: "up",
  negative: "down",
  neutral: "flat",
  warn: "warn"
};

// Render a 1y line chart with MA overlays + volume bars for a watchlist stock.
function watchlistChart(stock) {
  const points = stock?.technical?.chart?.points;
  if (!Array.isArray(points) || points.length < 5) return "";

  const closes = points.map((p) => p.close).filter(Number.isFinite);
  const ma20s = points.map((p) => p.ma20).filter(Number.isFinite);
  const ma60s = points.map((p) => p.ma60).filter(Number.isFinite);
  const volumes = points.map((p) => p.volume).filter(Number.isFinite);
  const maxVol = volumes.length ? Math.max(...volumes) : 0;

  // Layout: price area (top) + volume area (bottom)
  const w = 580, h = 240;
  const padL = 56, padR = 14, padT = 14, padB = 26;
  const gap = 8;
  const volH = 50;
  const priceH = h - padT - padB - volH - gap;
  const priceTop = padT;
  const priceBot = padT + priceH;
  const volTop = priceBot + gap;
  const volBot = volTop + volH;

  const stepX = (w - padL - padR) / (points.length - 1);
  const all = [...closes, ...ma20s, ...ma60s];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const yPriceFor = (v) => priceTop + (1 - (v - min) / range) * priceH;
  const yVolFor = (v) => (maxVol > 0 ? volBot - (v / maxVol) * volH : volBot);
  const xFor = (i) => padL + stepX * i;

  function pathOf(key) {
    let started = false;
    let d = "";
    points.forEach((p, i) => {
      const v = p[key];
      if (!Number.isFinite(v)) return;
      const cmd = started ? "L" : "M";
      d += `${cmd}${xFor(i).toFixed(1)},${yPriceFor(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  }
  const linePath = pathOf("close");
  const ma20Path = pathOf("ma20");
  const ma60Path = pathOf("ma60");

  const lastIdx = points.length - 1;
  const lastClose = points[lastIdx]?.close;
  const firstClose = points.find((p) => Number.isFinite(p.close))?.close;
  const isUp = Number.isFinite(lastClose) && Number.isFinite(firstClose) && lastClose >= firstClose;
  const fillColor = isUp ? "var(--up)" : "var(--down)";
  const safeKey = stock.ticker.replace(/[^a-z0-9]/gi, "");

  const areaPath = linePath
    ? `${linePath} L${xFor(lastIdx).toFixed(1)},${priceBot.toFixed(1)} L${padL.toFixed(1)},${priceBot.toFixed(1)} Z`
    : "";

  // y-axis tick labels — auto decimal
  const tickCount = 4;
  const tickRange = max - min;
  const tickDecimals = tickRange < 1 ? 3 : tickRange < 10 ? 2 : tickRange < 100 ? 1 : 0;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const v = min + ((max - min) / tickCount) * i;
    return { v, y: yPriceFor(v) };
  });

  // Volume bars
  const barW = Math.max(1, stepX * 0.7);
  const volBars = points.map((p, i) => {
    if (!Number.isFinite(p.volume) || p.volume <= 0) return "";
    const x = xFor(i);
    const y = yVolFor(p.volume);
    const prev = i > 0 ? points[i - 1]?.close : null;
    const dayUp = Number.isFinite(prev) ? p.close >= prev : true;
    const color = dayUp ? "var(--up)" : "var(--down)";
    return `<rect x="${(x - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(volBot - y).toFixed(1)}" fill="${color}" fill-opacity="0.5"/>`;
  }).join("");

  // Volume axis labels — show max volume scaled
  function formatVolShort(v) {
    if (!Number.isFinite(v)) return "—";
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toString();
  }

  const firstDate = points[0]?.date || "";
  const midDate = points[Math.floor(lastIdx / 2)]?.date || "";
  const lastDate = points[lastIdx]?.date || "";

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="auto" preserveAspectRatio="none" style="display:block">
    <defs>
      <linearGradient id="wl-area-${safeKey}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${fillColor}" stop-opacity=".18"/>
        <stop offset="100%" stop-color="${fillColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${ticks.map((t) => `<line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${w - padR}" y2="${t.y.toFixed(1)}" stroke="var(--grid)" stroke-width=".5"/>
      <text x="${padL - 6}" y="${t.y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${fmtNum(t.v, tickDecimals)}</text>`).join("")}
    ${areaPath ? `<path d="${areaPath}" fill="url(#wl-area-${safeKey})"/>` : ""}
    ${ma60Path ? `<path d="${ma60Path}" fill="none" stroke="var(--amber)" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>` : ""}
    ${ma20Path ? `<path d="${ma20Path}" fill="none" stroke="var(--accent)" stroke-width="1.2" opacity=".75"/>` : ""}
    ${linePath ? `<path d="${linePath}" fill="none" stroke="${fillColor}" stroke-width="1.6" stroke-linejoin="round"/>` : ""}
    ${Number.isFinite(lastClose) ? `<circle cx="${xFor(lastIdx).toFixed(1)}" cy="${yPriceFor(lastClose).toFixed(1)}" r="3" fill="${fillColor}"/>` : ""}

    <!-- volume separator + label -->
    <line x1="${padL}" y1="${volTop.toFixed(1)}" x2="${w - padR}" y2="${volTop.toFixed(1)}" stroke="var(--rule-soft)" stroke-width=".5"/>
    <text x="${padL - 6}" y="${(volTop + 2).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono" font-size="8" fill="var(--muted)" letter-spacing="0.1em">VOL</text>
    <text x="${padL - 6}" y="${(volBot - 2).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono" font-size="8" fill="var(--muted)">${formatVolShort(maxVol)}</text>
    ${volBars}

    <!-- date labels -->
    <text x="${padL}" y="${(h - 6).toFixed(1)}" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${escapeHtml(firstDate)}</text>
    <text x="${((padL + (w - padR)) / 2).toFixed(1)}" y="${(h - 6).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${escapeHtml(midDate)}</text>
    <text x="${(w - padR).toFixed(1)}" y="${(h - 6).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="var(--muted)">${escapeHtml(lastDate)}</text>

    <!-- legend -->
    <g font-family="JetBrains Mono" font-size="9" fill="var(--muted)">
      <line x1="${padL + 4}" y1="${(padT - 4).toFixed(1)}" x2="${padL + 18}" y2="${(padT - 4).toFixed(1)}" stroke="${fillColor}" stroke-width="1.6"/>
      <text x="${padL + 22}" y="${(padT - 1).toFixed(1)}">종가</text>
      <line x1="${padL + 58}" y1="${(padT - 4).toFixed(1)}" x2="${padL + 72}" y2="${(padT - 4).toFixed(1)}" stroke="var(--accent)" stroke-width="1.2"/>
      <text x="${padL + 76}" y="${(padT - 1).toFixed(1)}">MA20</text>
      <line x1="${padL + 112}" y1="${(padT - 4).toFixed(1)}" x2="${padL + 126}" y2="${(padT - 4).toFixed(1)}" stroke="var(--amber)" stroke-width="1" stroke-dasharray="2 3"/>
      <text x="${padL + 130}" y="${(padT - 1).toFixed(1)}">MA60</text>
      <rect x="${padL + 168}" y="${(padT - 8).toFixed(1)}" width="10" height="6" fill="var(--up)" fill-opacity="0.5"/>
      <text x="${padL + 182}" y="${(padT - 1).toFixed(1)}">거래량 (상승일)</text>
      <rect x="${padL + 254}" y="${(padT - 8).toFixed(1)}" width="10" height="6" fill="var(--down)" fill-opacity="0.5"/>
      <text x="${padL + 268}" y="${(padT - 1).toFixed(1)}">거래량 (하락일)</text>
    </g>
  </svg>`;
}

function watchlistMicroFactors(stock) {
  const factors = Array.isArray(stock.microFactors) ? stock.microFactors : [];
  if (!factors.length) return "";
  return `<div class="mf-grid">
    ${factors.map((f) => {
      const score = Math.max(0, Math.min(100, Number(f.score) || 0));
      const barColor = score >= 65 ? "var(--up)" : score >= 40 ? "var(--amber)" : "var(--down)";
      return `<div class="mf">
        <div class="mf-top">
          <span class="mf-label">${escapeHtml(f.label)}</span>
          <span class="mf-score mono">${score}<span style="font-size:9px;color:var(--muted);margin-left:2px">/100</span></span>
        </div>
        <div class="mf-bar"><div class="mf-fill" style="width:${score}%;background:${barColor}"></div></div>
        <p class="mf-note">${escapeHtml(f.note || "")}</p>
      </div>`;
    }).join("")}
  </div>`;
}

function watchlistDrivers(stock) {
  const pos = stock?.macroDrivers?.positive || [];
  const neg = stock?.macroDrivers?.negative || [];
  if (!pos.length && !neg.length) return "";
  return `<div class="drivers-grid">
    <div class="drv-col up">
      <div class="drv-head">우호 요인 +</div>
      <ul>${pos.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
    </div>
    <div class="drv-col down">
      <div class="drv-head">부담 요인 −</div>
      <ul>${neg.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
    </div>
  </div>`;
}

function watchlistTechSummary(stock) {
  const t = stock?.technical;
  if (!t || t.status !== "ready") return "";
  const ind = t.indicators || {};
  const cells = [
    { label: "20일 수익률", value: Number.isFinite(ind.return20d) ? `${signed(ind.return20d, 2)}%` : "—", tone: tone(ind.return20d) },
    { label: "60일 수익률", value: Number.isFinite(ind.return60d) ? `${signed(ind.return60d, 2)}%` : "—", tone: tone(ind.return60d) },
    { label: "RSI(14)", value: Number.isFinite(ind.rsi14) ? fmtNum(ind.rsi14, 0) : "—", tone: ind.rsi14 > 70 ? "warn" : ind.rsi14 < 30 ? "down" : "flat" },
    { label: "MACD 히스토그램", value: Number.isFinite(ind.macdHistogram) ? signed(ind.macdHistogram, 1) : "—", tone: tone(ind.macdHistogram) },
    { label: "연환산 변동성", value: Number.isFinite(ind.annualVolatility20d) ? `${fmtNum(ind.annualVolatility20d, 1)}%` : "—", tone: "flat" },
    { label: "120일 최대낙폭", value: Number.isFinite(ind.drawdown120d) ? `${fmtNum(ind.drawdown120d, 1)}%` : "—", tone: ind.drawdown120d < -20 ? "down" : "flat" },
    { label: "지지선 (20일)", value: Number.isFinite(ind.support20d) ? fmtNum(ind.support20d, 2) : "—", tone: "flat" },
    { label: "저항선 (20일)", value: Number.isFinite(ind.resistance20d) ? fmtNum(ind.resistance20d, 2) : "—", tone: "flat" }
  ];
  return `<div class="tech-grid">
    ${cells.map((c) => `<div class="tech-cell">
      <span class="tk">${escapeHtml(c.label)}</span>
      <strong class="mono ${c.tone}">${escapeHtml(c.value)}</strong>
    </div>`).join("")}
  </div>`;
}

function watchlistOneStock(stock, index) {
  const quote = stock.quote || {};
  const price = Number.isFinite(quote.price) ? fmtNum(quote.price, 2) : "—";
  const currency = quote.currency || stock.currency || "";
  const chgPct = Number.isFinite(quote.changePercent) ? quote.changePercent : null;
  const chgTone = tone(chgPct);
  const chgText = chgPct === null ? "—" : `${signed(chgPct, 2)}%`;
  const arrow = arrowFor(chgPct);
  const macroToneClass = TONE_CLASS_KO[stock.macroToneClass] || "flat";
  const technicalToneClass = TONE_CLASS_KO[stock?.technical?.toneClass] || "flat";

  return `<article class="wl-card">
    <header class="wl-head">
      <div class="wl-head-left">
        <span class="wl-idx mono">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3>${escapeHtml(stock.name)}</h3>
          <p class="wl-sub mono">${escapeHtml(stock.ticker)} · ${escapeHtml(stock.market || "")} · ${escapeHtml(stock.sectorLabel || stock.sector || "")}</p>
        </div>
      </div>
      <div class="wl-price">
        <div class="wl-price-val mono">${price}<span class="wl-cur">${escapeHtml(currency)}</span></div>
        <div class="wl-price-chg mono ${chgTone}">${escapeHtml(arrow)} ${escapeHtml(chgText)} <span style="color:var(--muted);font-weight:500;margin-left:6px">전일 대비</span></div>
      </div>
    </header>

    <div class="wl-tone-row mono">
      <span class="wl-tone-chip ${macroToneClass}">매크로 ${escapeHtml(stock.macroTone || "—")}<span class="sep">·</span>점수 ${Number.isFinite(stock.macroScore) ? stock.macroScore : "—"}/100</span>
      ${stock?.technical?.tone ? `<span class="wl-tone-chip ${technicalToneClass}">기술 ${escapeHtml(stock.technical.tone)}<span class="sep">·</span>점수 ${Number.isFinite(stock.technical.score) ? stock.technical.score : "—"}/100</span>` : ""}
    </div>

    ${stock.thesis ? `<p class="wl-thesis">${escapeHtml(stock.thesis)}</p>` : ""}

    <div class="wl-chart">${watchlistChart(stock)}</div>

    ${stock?.technical?.summary ? `<p class="wl-tech-summary"><span class="wl-tech-label">기술 신호 해석 ·</span> ${escapeHtml(stock.technical.summary)}</p>` : ""}

    ${watchlistTechSummary(stock)}

    ${watchlistDrivers(stock)}

    ${watchlistMicroFactors(stock)}

    <div class="wl-bottom-grid">
      ${Array.isArray(stock.watchLevels) && stock.watchLevels.length ? `<div class="wl-list">
        <span class="wl-list-head">관찰 레벨</span>
        <ul>${stock.watchLevels.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </div>` : ""}
      ${Array.isArray(stock.nextChecks) && stock.nextChecks.length ? `<div class="wl-list">
        <span class="wl-list-head">다음 점검</span>
        <ul>${stock.nextChecks.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </div>` : ""}
      ${Array.isArray(stock.risks) && stock.risks.length ? `<div class="wl-list">
        <span class="wl-list-head">리스크</span>
        <ul>${stock.risks.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </div>` : ""}
    </div>
  </article>`;
}

export function renderWatchlist(stockWatchlist) {
  const stocks = (stockWatchlist?.stocks || []).slice(0, 5);
  if (!stocks.length) return "";
  const backdrop = stockWatchlist?.macroBackdrop;
  const backdropBlock = backdrop ? `<div class="wl-backdrop">
    <div class="wl-backdrop-head">
      <span class="wl-bd-kicker mono">매크로 배경</span>
      <h3>${escapeHtml(backdrop.title || "")}</h3>
      <p>${escapeHtml(backdrop.summary || "")}</p>
    </div>
    <div class="wl-bd-signals">
      ${(backdrop.signals || []).slice(0, 8).map((s) => `<div class="wl-bd-sig">
        <span class="key mono">${escapeHtml(s.label)}</span>
        <strong class="mono">${escapeHtml(s.value)}</strong>
        <span class="chg mono ${s.tone || "flat"}">${escapeHtml(s.change)}</span>
        <span class="note">${escapeHtml(s.note || "")}</span>
      </div>`).join("")}
    </div>
  </div>` : "";

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 09</div>
      <div>
        <h2>관심 종목 워치리스트</h2>
        <p class="lede">${escapeHtml(stockWatchlist?.description || "관심 종목별 매크로·기술·마이크로 분석을 한곳에 묶었습니다.")}</p>
      </div>
    </div>
    ${backdropBlock}
    <div class="wl-stack">
      ${stocks.map((s, i) => watchlistOneStock(s, i)).join("")}
    </div>
  </div></section>`;
}

/* ─────────────────────── §08 COMMENTARY ESSAY ─────────────────────── */

export function renderEssay(briefing) {
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

export function renderFreshness(snapshot) {
  const summary = snapshot?.freshnessSummary;
  const calendar = snapshot?.reportCalendar || null;
  const items = summary?.items || [];
  if (!items.length) return "";

  const summaryBar = `
    <div style="display:flex;gap:18px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em;color:var(--muted);margin:0 0 18px;flex-wrap:wrap">
      <span><span class="chip fresh" style="margin-right:6px">최신</span>${summary.freshCount ?? 0}건</span>
      <span><span class="chip delayed" style="margin-right:6px">지연</span>${summary.delayedCount ?? 0}건</span>
      <span><span class="chip stale" style="margin-right:6px">오래됨</span>${summary.staleCount ?? 0}건</span>
      <span style="margin-left:auto">기준일 ${escapeHtml(summary.reportDate || "")}</span>
      ${calendar?.usEquityReferenceDate ? `<span>미국 주식 ${escapeHtml(calendar.usEquityReferenceDate)}</span>` : ""}
    </div>`;

  return `<section class="section"><div class="shell">
    <div class="section-head">
      <div class="num"><span class="bar"></span>§ 10</div>
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

export function renderColophon(snapshot, briefing) {
  const calendar = snapshot?.reportCalendar || null;
  return `<footer class="colophon"><div class="shell">
    <div class="row">
      <span><b>FRED Market Briefing</b> · 자동 생성 데일리 브리핑</span>
      <span>데이터 출처: FRED (Federal Reserve Bank of St. Louis) · ${escapeHtml(snapshot.source || "")}</span>
    </div>
    <div class="row">
      <span>발행: ${escapeHtml(formatDateTimeKST(snapshot.generatedAt))} KST</span>
      <span>리포트 일자: ${escapeHtml(briefing?.date || snapshot.reportDate || "—")}</span>
      ${calendar?.usEquityReferenceDate ? `<span>미국 주식 기준일: ${escapeHtml(calendar.usEquityReferenceDate)}</span>` : ""}
      ${calendar?.koreaMarketReferenceDate ? `<span>한국 시장 기준일: ${escapeHtml(calendar.koreaMarketReferenceDate)}</span>` : ""}
      <span>모드: ${escapeHtml(snapshot.mode || "fred")}</span>
    </div>
    <div class="row">
      <span>${escapeHtml(briefing?.complianceNote || "본 자료는 정보 제공 목적이며, 어떠한 투자 권유도 포함하지 않습니다. 데이터 정확성은 원자료를 우선합니다.")}</span>
    </div>
  </div></footer>`;
}
