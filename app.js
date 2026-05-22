function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateLabel(value) {
  if (!value) {
    return "날짜 확인 중";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PUBLIC_COPY_REPLACEMENTS = [
  ["위험선호 우위", "주식시장 강세"],
  ["위험자산 선호가 우위인 장세", "투자심리가 개선된 장세"],
  ["위험자산 선호가 우위", "투자심리가 개선"],
  ["위험선호 회복", "투자심리 회복"],
  ["위험회피", "방어 심리"],
  ["리스크온+금리부담", "강세+금리부담"],
  ["리스크온", "투자심리개선"],
  ["리스크오프", "방어심리"],
  ["정량브리핑", "데이터기반"],
  ["정량 레짐", "시장 흐름"],
  ["리스크 레짐", "시장 분위기"],
  ["오늘의 시장 레짐", "오늘의 시장 흐름"],
  ["데이터 신뢰도", "자료 상태"],
  ["신뢰도 높음", "자료 상태 양호"],
  ["신뢰도 보통", "보조지표 확인 필요"],
  ["신뢰도 낮음", "핵심지표 확인 필요"],
  ["발행 주의", "일부 지표 지연 반영"],
  ["발행 가능", "정상 발행"],
  ["발행 보류 권고", "자동 발행 보류 검토"],
  ["Dow Jones Industrial Average", "다우지수"],
  ["NASDAQ Composite", "나스닥종합지수"],
  ["US Treasury 10Y", "미 국채 10년물"],
  ["US Treasury 2Y", "미 국채 2년물"],
  ["Effective Fed Funds Rate", "실효 연방기금금리"],
  ["CBOE VIX", "VIX"],
  ["USD/KRW Spot", "달러/원 환율"],
  ["Broad Dollar Index", "광의 달러지수"],
  ["WTI Spot", "WTI 유가"],
  [" 상대 우위", " 상대 강세"],
  [" 우위", " 강세"]
];

function publicCopy(value) {
  return PUBLIC_COPY_REPLACEMENTS.reduce(
    (text, [from, to]) => text.split(from).join(to),
    String(value ?? "")
  );
}

function publicHtml(value) {
  return escapeHtml(publicCopy(value));
}

function formatNumber(value, decimals) {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function formatValue(item) {
  if (item.latestValue === null || item.latestValue === undefined) {
    return "N/A";
  }

  if (item.format === "percent") {
    return `${formatNumber(item.latestValue, item.decimals ?? 2)}%`;
  }

  if (item.format === "usd") {
    return `$${formatNumber(item.latestValue, item.decimals ?? 2)}`;
  }

  if (item.format === "krw") {
    return `${formatNumber(item.latestValue, item.decimals ?? 2)} KRW`;
  }

  return formatNumber(item.latestValue, item.decimals ?? 2);
}

function formatDelta(item) {
  const absolute = item.absoluteChange;
  const percent = item.percentChange;

  if (absolute === null || absolute === undefined) {
    return "변화 없음";
  }

  const sign = absolute > 0 ? "+" : "";
  const absoluteDigits = item.format === "percent" ? item.decimals ?? 2 : item.decimals ?? 2;
  const absoluteText = item.format === "percent"
    ? `${sign}${formatNumber(absolute, absoluteDigits)}%p`
    : `${sign}${formatNumber(absolute, absoluteDigits)}`;

  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return absoluteText;
  }

  const percentSign = percent > 0 ? "+" : "";
  return `${absoluteText} (${percentSign}${formatNumber(percent, 2)}%)`;
}

function toneClass(item) {
  if ((item.absoluteChange ?? 0) > 0) {
    return "up";
  }

  if ((item.absoluteChange ?? 0) < 0) {
    return "down";
  }

  return "flat";
}

function freshnessClass(item) {
  return item.freshness?.status || "fresh";
}

function renderHealthBadge(summary) {
  const badge = document.getElementById("data-health");
  const status = summary?.status || "healthy";
  badge.className = `health-badge ${status}`;

  if (status === "attention") {
    badge.textContent = `오래된 시계열 ${summary.staleCount}건`;
    return;
  }

  if (status === "watch") {
    badge.textContent = `지연 시계열 ${summary.delayedCount}건`;
    return;
  }

  badge.textContent = "기준일 상태 양호";
}

function renderStatusCard(summary) {
  const card = document.getElementById("status-card");
  const pill = document.getElementById("status-pill");
  const copy = document.getElementById("status-copy");
  const list = document.getElementById("status-list");

  if (!summary || (summary.delayedCount === 0 && summary.staleCount === 0)) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  pill.className = `status-pill ${summary.status}`;

  if (summary.status === "attention") {
    pill.textContent = "주의";
    copy.textContent = `오래된 시계열 ${summary.staleCount}건, 지연 시계열 ${summary.delayedCount}건이 있습니다. 카드별 기준일을 함께 보고 해석하세요.`;
  } else {
    pill.textContent = "체크";
    copy.textContent = `지연 시계열 ${summary.delayedCount}건이 있습니다. 최신 주식·금리 카드부터 우선 해석하는 편이 안전합니다.`;
  }

  list.innerHTML = summary.items
    .map((item) => {
      const source = item.sourceUrl
        ? `<a href="${item.sourceUrl}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>`
        : "derived";

      return `
        <li class="status-item ${escapeHtml(item.status)}">
          <strong>${publicHtml(item.label)}</strong>
          <span>${publicHtml(item.freshnessLabel)} · 기준일 ${escapeHtml(item.observationDate)} · ${source}</span>
        </li>
      `;
    })
    .join("");
}

function renderGroups(groups) {
  const container = document.getElementById("groups");
  container.innerHTML = groups
    .map((group) => {
      const cards = group.items
        .map((item) => {
          const sourceLink = item.sourceUrl
            ? `<a href="${item.sourceUrl}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>`
            : "derived";
          const freshness = item.freshness || { label: "기준일 확인 필요", businessDaysOld: null };
          const freshnessText = freshness.businessDaysOld === 0
            ? `기준일 ${escapeHtml(item.observationDate)}`
            : `기준일 ${escapeHtml(item.observationDate)} · ${publicHtml(freshness.label)}`;
          const warning = freshness.status === "fresh"
            ? ""
            : `<p class="metric-warning ${escapeHtml(freshness.status)}">이 카드는 최신 데이터보다 ${publicHtml(freshness.label)} 상태입니다.</p>`;

          return `
            <article class="metric-card ${escapeHtml(freshnessClass(item))}">
              <div class="metric-top">
                <div>
                  <p class="metric-label">${publicHtml(item.label)}</p>
                  <span class="metric-id">${sourceLink}</span>
                </div>
                <span class="freshness-badge ${escapeHtml(freshness.status || "fresh")}">${publicHtml(freshness.label)}</span>
              </div>
              <p class="metric-value">${formatValue(item)}</p>
              <p class="metric-delta ${toneClass(item)}">${formatDelta(item)}</p>
              <p class="metric-meta">${freshnessText}</p>
              ${warning}
            </article>
          `;
        })
        .join("");

      return `
        <section class="group-block">
          <div class="group-copy">
            <h3>${publicHtml(group.label)}</h3>
            <p>${publicHtml(group.description)}</p>
          </div>
          <div class="metric-grid">${cards}</div>
        </section>
      `;
    })
    .join("");
}

function renderLiveSnapshot(snapshot) {
  document.getElementById("headline").textContent = publicCopy(snapshot.headline);
  document.getElementById("subheadline").textContent = publicCopy(snapshot.subheadline);
  document.getElementById("generated-at").textContent = `생성 시각 ${formatDate(snapshot.generatedAt)}`;
  document.getElementById("mode-badge").textContent = snapshot.mode === "demo" ? "DEMO DATA" : "FRED API";
  document.getElementById("api-doc-link").href = snapshot.source.apiDocsUrl;
  renderHealthBadge(snapshot.freshnessSummary);
  renderStatusCard(snapshot.freshnessSummary);

  const highlights = document.getElementById("highlights");
  highlights.innerHTML = snapshot.highlights.map((item) => `<li>${publicHtml(item)}</li>`).join("");

  const notes = document.getElementById("notes");
  notes.innerHTML = snapshot.notes.map((item) => `<li>${publicHtml(item)}</li>`).join("");

  renderGroups(snapshot.groups);
}

function renderBriefingTags(tags = []) {
  const container = document.getElementById("briefing-tags");
  container.innerHTML = tags.map((tag) => `<span class="tag-pill">${publicHtml(tag)}</span>`).join("");
}

function renderBriefingIndices(indices = {}) {
  const items = [
    { label: "S&P500", data: indices.sp },
    { label: "Nasdaq", data: indices.nasdaq },
    { label: "Dow", data: indices.dow }
  ];

  const container = document.getElementById("briefing-indices");
  container.innerHTML = items
    .map(({ label, data }) => {
      const change = data?.chg || "N/A";
      const tone = change.startsWith("+") ? "up" : change.startsWith("-") ? "down" : "flat";

      return `
        <article class="idx-card">
          <span>${label}</span>
          <strong>${escapeHtml(data?.level || "—")}</strong>
          <em class="${tone}">${escapeHtml(change)}</em>
        </article>
      `;
    })
    .join("");
}

function renderBriefingQuality(quality) {
  const container = document.getElementById("briefing-quality");

  if (!quality) {
    container.innerHTML = "";
    return;
  }

  const scoreText = typeof quality.score === "number" ? `${quality.score}/100` : "점수 없음";
  container.innerHTML = `
    <article class="quality-card ${escapeHtml(quality.confidence || "neutral")}">
      <span>자료 상태</span>
      <strong>${publicHtml(quality.confidenceLabel || "확인 필요")}</strong>
    </article>
    <article class="quality-card ${escapeHtml(quality.publicationStatus || "neutral")}">
      <span>보고서 상태</span>
      <strong>${publicHtml(quality.publicationLabel || "확인 필요")}</strong>
    </article>
    <article class="quality-card neutral">
      <span>점검 점수</span>
      <strong>${escapeHtml(scoreText)}</strong>
    </article>
  `;
}

function renderBriefingNews(newsBrief) {
  const container = document.getElementById("briefing-news");

  if (!newsBrief || !Array.isArray(newsBrief.topItems) || newsBrief.topItems.length === 0) {
    container.innerHTML = "";
    return;
  }

  const themes = (newsBrief.themes || []).slice(0, 3)
    .map((theme) => `
      <article class="news-theme">
        <span>${escapeHtml(theme.label || "뉴스")}</span>
        <p>${publicHtml(theme.koreanSummary || theme.summary || "요약 없음")}</p>
      </article>
    `)
    .join("");
  const headlines = newsBrief.topItems.slice(0, 5)
    .map((item) => {
      const display = item.koreanTitle || item.title;
      const sourceLabel = item.sourceKorean || item.source || "source";
      const summary = item.koreanSummary
        ? `<p class="news-summary-line">${publicHtml(item.koreanSummary)}</p>`
        : "";
      return `
        <li>
          <a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">${escapeHtml(display)}</a>
          <span>${escapeHtml(sourceLabel)} · ${escapeHtml(item.categoryLabel || "뉴스")}</span>
          ${summary}
        </li>
      `;
    })
    .join("");
  const health = newsBrief.sourceHealth
    ? `<p class="news-health">출처 ${escapeHtml(newsBrief.sourceHealth.okCount)}개 수집, ${escapeHtml(newsBrief.sourceHealth.failedCount)}개 실패</p>`
    : "";

  container.innerHTML = `
    <div class="news-head">
      <span>주요 뉴스</span>
      ${health}
    </div>
    <p class="news-summary">${publicHtml(newsBrief.koreanEditorialSummary || newsBrief.editorialSummary || "뉴스 요약을 확인 중입니다.")}</p>
    <div class="news-theme-grid">${themes}</div>
    <ul class="news-headlines">${headlines}</ul>
  `;
}

function renderArchiveFreshness(summary) {
  const container = document.getElementById("archive-freshness");
  if (!summary) {
    container.className = "archive-freshness";
    container.innerHTML = "<p>기준일 정보를 확인하지 못했습니다.</p>";
    return;
  }

  container.className = `archive-freshness ${summary.status}`;

  if (summary.status === "healthy") {
    container.innerHTML = `
      <p class="archive-freshness-title">기준일 상태 양호</p>
      <p>이 브리핑에 포함된 핵심 시리즈는 모두 허용한 최신 범위 안에 있습니다.</p>
    `;
    return;
  }

  const lines = summary.items
    .map((item) => `<li>${publicHtml(item.label)} · ${escapeHtml(item.observationDate)} · ${publicHtml(item.freshnessLabel)}</li>`)
    .join("");

  container.innerHTML = `
    <p class="archive-freshness-title">기준일 주의</p>
    <p>오래된 시계열 ${summary.staleCount}건, 지연 시계열 ${summary.delayedCount}건이 있습니다.</p>
    <ul>${lines}</ul>
  `;
}

function renderBriefingInsights(sections = {}) {
  const groups = [
    { key: "topStory", label: "오늘의 핵심 사건", tone: "시장 해설" },
    { key: "marketReaction", label: "자산별 흐름", tone: "시장 반응" },
    { key: "watchNow", label: "지금 확인할 변수", tone: "확인 포인트" },
    { key: "positioning", label: "한국장 시사점", tone: "투자 참고" }
  ];

  const container = document.getElementById("briefing-insights");
  container.innerHTML = groups
    .map((group) => {
      const items = Array.isArray(sections[group.key]) ? sections[group.key] : [];
      const content = items.length > 0
        ? items
          .map((item) => `
            <article class="archive-insight-item">
              <h5>${publicHtml(item.title || "요약")}</h5>
              <p>${publicHtml(item.desc || "설명 없음")}</p>
            </article>
          `)
          .join("")
        : `<article class="archive-insight-item"><p>이 섹션 데이터가 아직 없습니다.</p></article>`;

      return `
        <section class="archive-insight-section">
          <div class="archive-insight-head">
            <span>${publicHtml(group.tone)}</span>
            <strong>${group.label}</strong>
          </div>
          ${content}
        </section>
      `;
    })
    .join("");
}

function renderPostMarkdown(text) {
  const lines = text.split("\n");
  let html = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      html += '<div class="post-gap"></div>';
      continue;
    }

    if (line.startsWith("### ")) {
      html += `<h4 class="post-sub-title">${publicHtml(line.slice(4))}</h4>`;
      continue;
    }

    if (line.startsWith("## ")) {
      html += `<h3 class="post-sec-title">${publicHtml(line.slice(3))}</h3>`;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      html += `<p class="post-item-title">${publicHtml(line)}</p>`;
      continue;
    }

    if (line.startsWith("- ")) {
      html += `<p class="post-bullet">${publicHtml(line.slice(2))}</p>`;
      continue;
    }

    html += `<p class="post-line">${publicHtml(line)}</p>`;
  }

  return html;
}

function updateDateParam(date) {
  const url = new URL(window.location.href);
  url.searchParams.set("date", date);
  history.replaceState({}, "", url);
}

function renderBriefingList(briefings, selectedDate, onSelect) {
  const list = document.getElementById("briefing-list");

  list.innerHTML = briefings
    .map((item) => {
      const active = item.date === selectedDate ? "active" : "";
      const tags = (item.tags || []).slice(0, 3).map((tag) => publicCopy(tag)).join(" · ");

      return `
        <li>
          <button class="briefing-item ${active}" data-date="${escapeHtml(item.date)}" type="button">
            <span class="briefing-item-date">${escapeHtml(item.date)}</span>
            <strong>${publicHtml(item.title)}</strong>
            <span class="briefing-item-tags">${publicHtml(tags)}</span>
          </button>
        </li>
      `;
    })
    .join("");

  list.querySelectorAll(".briefing-item").forEach((button) => {
    button.addEventListener("click", () => {
      const next = briefings.find((item) => item.date === button.dataset.date);
      if (next) {
        onSelect(next);
      }
    });
  });
}

async function renderBriefingPost(item) {
  const container = document.getElementById("post-view");

  try {
    const response = await fetch(`${item.file}?v=${item.date}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("post_load_failed");
    }

    const text = await response.text();
    container.innerHTML = renderPostMarkdown(text);
  } catch {
    container.textContent = "브리핑 본문을 불러오지 못했습니다.";
  }
}

async function selectBriefing(item, briefings) {
  document.getElementById("briefing-date").textContent = formatDateLabel(item.date);
  document.getElementById("briefing-title").textContent = publicCopy(item.title);
  document.getElementById("briefing-lead").innerHTML = `<p>${publicHtml(item.overnightLead || "요약이 아직 없습니다.")}</p>`;
  renderBriefingTags(item.tags || []);
  renderBriefingIndices(item.indices || {});
  renderBriefingQuality(item.quality || null);
  renderBriefingNews(item.newsBrief || null);
  renderArchiveFreshness(item.freshnessSummary);
  renderBriefingInsights(item.insightSections || {});
  renderBriefingList(briefings, item.date, (next) => selectBriefing(next, briefings));
  updateDateParam(item.date);
  await renderBriefingPost(item);
}

async function loadArchive() {
  const response = await fetch("./data/briefings.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("briefings_load_failed");
  }

  const briefings = await response.json();
  if (!Array.isArray(briefings) || briefings.length === 0) {
    throw new Error("briefings_empty");
  }

  const dateParam = new URLSearchParams(window.location.search).get("date");
  const selected = briefings.find((item) => item.date === dateParam) || briefings[0];
  await selectBriefing(selected, briefings);
}

function renderArchiveError() {
  document.getElementById("briefing-date").textContent = "브리핑 아카이브 없음";
  document.getElementById("briefing-title").textContent = "아직 생성된 브리핑이 없습니다.";
  document.getElementById("briefing-tags").innerHTML = "";
  document.getElementById("briefing-indices").innerHTML = "";
  document.getElementById("briefing-quality").innerHTML = "";
  document.getElementById("briefing-news").innerHTML = "";
  document.getElementById("briefing-lead").innerHTML = "<p>먼저 publish 명령을 실행해 날짜별 브리핑 파일을 생성해 주세요.</p>";
  document.getElementById("archive-freshness").innerHTML = "";
  document.getElementById("briefing-insights").innerHTML = '<p class="empty-line">표시할 인사이트가 없습니다.</p>';
  document.getElementById("briefing-list").innerHTML = '<li class="empty-line">생성된 브리핑이 없습니다.</li>';
  document.getElementById("post-view").textContent = "브리핑 본문이 없습니다.";
}

function formatStockPercent(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatStockNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function formatStockPrice(value) {
  if (!Number.isFinite(value)) return "N/A";
  const decimals = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 100 ? 1 : 2;
  return formatStockNumber(value, decimals);
}

function stockToneClass(value) {
  if (value === "positive" || value === "up") return "up";
  if (value === "negative" || value === "down") return "down";
  return "flat";
}

function renderWatchlistMacro(data) {
  const macro = data.macroBackdrop || {};
  document.getElementById("stock-headline").textContent = data.title || "관심종목 정량 분석";
  document.getElementById("stock-subheadline").textContent =
    "차트, 기술적 지표, 매크로·마이크로 점수를 결합해 관심종목의 추세를 점검합니다.";
  document.getElementById("stock-generated-at").textContent = `생성 시각 ${formatDate(data.generatedAt)}`;
  document.getElementById("stock-report-date").textContent = macro.reportDate
    ? `브리핑 ${macro.reportDate}`
    : "브리핑 기준일 없음";
  document.getElementById("stock-count").textContent = `종목 ${data.stocks?.length || 0}개`;
  document.getElementById("macro-title").textContent = macro.title || "매크로 배경 확인 필요";
  document.getElementById("macro-summary").textContent = macro.summary || "시장 요약이 없습니다.";
  document.getElementById("stock-disclaimer").textContent =
    data.disclaimer || "관심종목 분석은 정보 제공용 정량 시나리오이며 투자자문이 아닙니다.";

  const signals = Array.isArray(macro.signals) ? macro.signals : [];
  document.getElementById("macro-signals").innerHTML = signals
    .map((signal) => `
      <article class="stock-signal ${stockToneClass(signal.tone)}">
        <span>${escapeHtml(signal.label)}</span>
        <strong>${escapeHtml(signal.value)}</strong>
        <em>${escapeHtml(signal.change)}</em>
        <p>${escapeHtml(signal.note)}</p>
      </article>
    `)
    .join("");
}

function renderWatchlistItems(stocks, selectedTicker, onSelect) {
  const list = document.getElementById("stock-list");
  list.innerHTML = stocks
    .map((stock) => {
      const active = stock.ticker === selectedTicker ? "active" : "";
      return `
        <button class="stock-list-item ${active}" type="button" data-ticker="${escapeHtml(stock.ticker)}">
          <span>${escapeHtml(stock.market || "시장")}</span>
          <strong>${escapeHtml(stock.name || stock.ticker)}</strong>
          <em>${escapeHtml(stock.ticker)} · ${escapeHtml(stock.sectorLabel || stock.sector || "섹터")}</em>
          <b class="${stockToneClass(stock.macroToneClass)}">${escapeHtml(stock.macroTone || "중립")} · ${escapeHtml(stock.macroScore ?? "N/A")}</b>
        </button>
      `;
    })
    .join("");

  list.querySelectorAll(".stock-list-item").forEach((button) => {
    button.addEventListener("click", () => {
      const next = stocks.find((stock) => stock.ticker === button.dataset.ticker);
      if (next) onSelect(next);
    });
  });
}

function stockListItems(items = []) {
  if (!items.length) return '<li class="empty-line">확인 항목 없음</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function stockMicroCards(micro = {}) {
  const rows = [
    ["수요", micro.demand],
    ["이익률", micro.margin],
    ["재무", micro.balanceSheet],
    ["주가 평가", micro.valuation]
  ];
  return rows
    .map(([label, text]) => `
      <article class="micro-card">
        <span>${label}</span>
        <p>${escapeHtml(text || "메모 없음")}</p>
      </article>
    `)
    .join("");
}

function renderStockTrendChart(chart = {}) {
  const points = Array.isArray(chart.points) ? chart.points.filter((point) => Number.isFinite(point.close)) : [];
  if (points.length < 2) {
    return '<div class="chart-empty">차트 데이터 없음</div>';
  }

  const width = 720;
  const height = 260;
  const padding = 24;
  const values = points.flatMap((point) => [point.close, point.ma20, point.ma60]).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(max * 0.02, 1);
  const xStep = (width - (padding * 2)) / (points.length - 1);
  const x = (index) => padding + (index * xStep);
  const y = (value) => height - padding - (((value - min) / span) * (height - (padding * 2)));
  const pathFor = (key) => {
    let started = false;
    return points.map((point, index) => {
      const value = point[key];
      if (!Number.isFinite(value)) return "";
      const command = started ? "L" : "M";
      started = true;
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    }).filter(Boolean).join(" ");
  };
  const last = points.at(-1);

  return `
    <div class="chart-head">
      <span>${escapeHtml(points[0].date)} - ${escapeHtml(last.date)}</span>
      <strong>${formatStockPrice(last.close)}</strong>
    </div>
    <svg class="stock-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="가격 추세 차트">
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" />
      <path class="chart-line close" d="${pathFor("close")}" />
      <path class="chart-line ma20" d="${pathFor("ma20")}" />
      <path class="chart-line ma60" d="${pathFor("ma60")}" />
    </svg>
    <div class="chart-legend">
      <span><i class="close"></i>종가</span>
      <span><i class="ma20"></i>20일선</span>
      <span><i class="ma60"></i>60일선</span>
    </div>
  `;
}

function stockTechnicalCards(technical = {}) {
  const indicators = technical.indicators || {};
  const rows = [
    ["기술 점수", Number.isFinite(technical.score) ? `${technical.score}` : "N/A", technical.tone || "확인 필요"],
    ["1일/5일", `${formatStockPercent(indicators.return1d)} / ${formatStockPercent(indicators.return5d)}`, "단기 탄력"],
    ["20일/60일", `${formatStockPercent(indicators.return20d)} / ${formatStockPercent(indicators.return60d)}`, "중기 수익률"],
    ["이동평균", `${formatStockPrice(indicators.ma20)} / ${formatStockPrice(indicators.ma60)}`, "20일·60일"],
    ["RSI", formatStockNumber(indicators.rsi14, 1), "14일 상대강도"],
    ["MACD", formatStockNumber(indicators.macdHistogram, 2), "히스토그램"],
    ["변동성", formatStockPercent(indicators.dailyVolatility20d), "20일 일간"],
    ["지지/저항", `${formatStockPrice(indicators.support20d)} / ${formatStockPrice(indicators.resistance20d)}`, "20일 범위"]
  ];

  return rows
    .map(([label, value, note]) => `
      <article class="technical-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <em>${escapeHtml(note)}</em>
      </article>
    `)
    .join("");
}

function stockMicroFactorCards(microAnalysis = {}) {
  const factors = Array.isArray(microAnalysis.factors) ? microAnalysis.factors : [];
  if (!factors.length) return '<p class="empty-line">마이크로 점수 없음</p>';
  return factors
    .map((factor) => `
      <article class="micro-factor">
        <div><span>${escapeHtml(factor.label)}</span><strong>${escapeHtml(factor.score)}</strong></div>
        <p>${escapeHtml(factor.note || "")}</p>
      </article>
    `)
    .join("");
}

function stockForecastPanel(forecast = {}) {
  const horizons = Array.isArray(forecast.horizons) ? forecast.horizons : [];
  return `
    <div class="forecast-summary ${stockToneClass(forecast.toneClass)}">
      <div>
        <span>전망 점수</span>
        <strong>${escapeHtml(forecast.score ?? "N/A")}</strong>
      </div>
      <p>${escapeHtml(forecast.summary || "정량 전망 없음")}</p>
      <em>신뢰도 ${escapeHtml(forecast.confidence || "확인 필요")} · ${escapeHtml(forecast.confidenceNote || "")}</em>
    </div>
    <div class="forecast-grid">
      ${horizons.map((horizon) => `
        <article>
          <span>${escapeHtml(horizon.label)}</span>
          <strong>${formatStockPercent(horizon.expectedReturnPct)}</strong>
          <em>상승확률 ${escapeHtml(horizon.upProbabilityPct ?? "N/A")}%</em>
          <p>예상 범위 ${formatStockPercent(horizon.rangeLowPct)} ~ ${formatStockPercent(horizon.rangeHighPct)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWatchlistDetail(stock) {
  const detail = document.getElementById("stock-detail");
  const quote = stock.quote || {};
  const quoteText = Number.isFinite(quote.price)
    ? `${escapeHtml(quote.currency || "")} ${escapeHtml(quote.price)}`
    : "수동 시세 미입력";
  const quoteChange = Number.isFinite(quote.changePercent) ? formatStockPercent(quote.changePercent) : "변동률 없음";
  const sectorSignal = stock.sectorSignal
    ? `${stock.sectorSignal.ticker} ${formatStockPercent(stock.sectorSignal.percentChange)}`
    : "참조 자료 없음";

  detail.innerHTML = `
    <div class="stock-detail-head">
      <div>
        <p class="briefing-date">${escapeHtml(stock.market || "시장")} · ${escapeHtml(stock.sectorLabel || stock.sector || "섹터")}</p>
        <h3>${escapeHtml(stock.name || stock.ticker)}</h3>
        <p class="stock-ticker">${escapeHtml(stock.ticker)}</p>
      </div>
      <div class="stock-score ${stockToneClass(stock.macroToneClass)}">
        <span>${escapeHtml(stock.macroTone || "중립")}</span>
        <strong>${escapeHtml(stock.macroScore ?? "N/A")}</strong>
      </div>
    </div>

    <div class="stock-quote-strip">
      <article><span>시세</span><strong>${quoteText}</strong><em>${quoteChange}</em></article>
      <article><span>참조 신호</span><strong>${escapeHtml(sectorSignal)}</strong><em>${escapeHtml(stock.sectorSignal?.observationDate || "날짜 없음")}</em></article>
      <article><span>포지션 메모</span><strong>${escapeHtml(stock.positionNote || "메모 없음")}</strong></article>
    </div>

    <section class="stock-detail-section">
      <h4>차트·기술적 분석</h4>
      <p>${escapeHtml(stock.technical?.summary || "기술적 분석이 없습니다.")}</p>
      <div class="chart-panel">${renderStockTrendChart(stock.technical?.chart)}</div>
      <div class="technical-grid">${stockTechnicalCards(stock.technical)}</div>
    </section>

    <section class="stock-detail-section">
      <h4>정량 추세 전망</h4>
      ${stockForecastPanel(stock.forecast)}
    </section>

    <section class="stock-detail-section">
      <h4>매크로 연결</h4>
      <p>${escapeHtml(stock.macroSummary || "매크로 요약이 없습니다.")}</p>
      <div class="driver-grid">
        <article>
          <span>긍정 변수</span>
          <ul>${stockListItems(stock.macroDrivers?.positive || [])}</ul>
        </article>
        <article>
          <span>부정 변수</span>
          <ul>${stockListItems(stock.macroDrivers?.negative || [])}</ul>
        </article>
      </div>
    </section>

    <section class="stock-detail-section">
      <h4>마이크로 체크</h4>
      <div class="micro-grid">${stockMicroCards(stock.micro)}</div>
      <div class="micro-factor-grid">${stockMicroFactorCards(stock.microAnalysis)}</div>
    </section>

    <section class="stock-detail-section">
      <h4>시나리오</h4>
      <div class="scenario-grid">
        <article><span>기본</span><p>${escapeHtml(stock.scenario?.base || "기본 시나리오 없음")}</p></article>
        <article><span>상승</span><p>${escapeHtml(stock.scenario?.upside || "상승 시나리오 없음")}</p></article>
        <article><span>하락</span><p>${escapeHtml(stock.scenario?.downside || "하락 시나리오 없음")}</p></article>
      </div>
    </section>

    <section class="stock-detail-section stock-watch-section">
      <div>
        <h4>확인할 임계치</h4>
        <ul>${stockListItems(stock.watchLevels || [])}</ul>
      </div>
      <div>
        <h4>다음 점검</h4>
        <ul>${stockListItems(stock.nextChecks || [])}</ul>
      </div>
      <div>
        <h4>위험 표시</h4>
        <ul>${stockListItems(stock.riskFlags || [])}</ul>
      </div>
    </section>
  `;
}

async function loadWatchlist() {
  const response = await fetch("./data/stock-watchlist.json", { cache: "no-store" });
  if (!response.ok) throw new Error("stock_watchlist_load_failed");

  const data = await response.json();
  const stocks = Array.isArray(data.stocks) ? data.stocks : [];
  renderWatchlistMacro(data);

  if (!stocks.length) {
    document.getElementById("stock-list").innerHTML = '<p class="empty-line">등록된 종목이 없습니다.</p>';
    document.getElementById("stock-detail").innerHTML = '<p class="empty-line">표시할 종목 분석이 없습니다.</p>';
    return;
  }

  const select = (stock) => {
    renderWatchlistItems(stocks, stock.ticker, select);
    renderWatchlistDetail(stock);
  };

  select(stocks[0]);
}

function renderWatchlistError() {
  document.getElementById("stock-headline").textContent = "관심종목 데이터를 불러오지 못했습니다.";
  document.getElementById("stock-subheadline").textContent =
    "npm run build:stocks:full 실행 후 다시 확인하세요.";
  document.getElementById("macro-title").textContent = "종목 분석 데이터 없음";
  document.getElementById("macro-summary").textContent = "관심종목 정량 분석 파일을 확인해야 합니다.";
  document.getElementById("stock-list").innerHTML = '<p class="empty-line">등록된 종목이 없습니다.</p>';
  document.getElementById("stock-detail").innerHTML = '<p class="empty-line">표시할 종목 분석이 없습니다.</p>';
}

async function main() {
  const response = await fetch("./data/market-snapshot.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("snapshot_load_failed");
  }

  const snapshot = await response.json();
  renderLiveSnapshot(snapshot);

  try {
    await loadWatchlist();
  } catch {
    renderWatchlistError();
  }

  try {
    await loadArchive();
  } catch {
    renderArchiveError();
  }
}

main().catch(() => {
  document.getElementById("headline").textContent = "데이터를 불러오지 못했습니다.";
  document.getElementById("subheadline").textContent =
    "먼저 npm run build:demo 또는 FRED_API_KEY 설정 후 npm run build:data 를 실행해 주세요.";
});
