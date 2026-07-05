const STORAGE_KEY = "fred-market-briefing.watchlistConfig";
const DEFAULT_CONFIG = {
  title: "관심 종목 매크로·마이크로 분석",
  description: "옵션 페이지에서 관리하는 관심종목 목록입니다.",
  stocks: [],
  disclaimer: "본 페이지는 자동 수집 데이터와 사용자가 정의한 종목 메모를 결합한 정보 제공 자료이며 투자자문이 아닙니다."
};

const state = {
  config: structuredClone(DEFAULT_CONFIG),
  selectedIndex: 0,
  fileHandle: null,
  dirty: false,
  admin: { available: false, currentJobId: null, polling: false }
};

const fields = {
  ticker: "field-ticker",
  name: "field-name",
  market: "field-market",
  assetClass: "field-assetClass",
  sector: "field-sector",
  sectorLabel: "field-sectorLabel",
  currency: "field-currency",
  chartSymbol: "field-chartSymbol",
  naverSymbol: "field-naverSymbol",
  sectorEtf: "field-sectorEtf",
  benchmarkTicker: "field-benchmarkTicker",
  benchmarkMetric: "field-benchmarkMetric",
  inverseOf: "field-inverseOf",
  inverseMultiplier: "field-inverseMultiplier",
  positionNote: "field-positionNote",
  thesis: "field-thesis",
  positive: "field-positive",
  negative: "field-negative",
  demand: "field-demand",
  margin: "field-margin",
  balanceSheet: "field-balanceSheet",
  valuation: "field-valuation",
  microFactors: "field-microFactors",
  watchLevels: "field-watchLevels",
  nextChecks: "field-nextChecks",
  risks: "field-risks"
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(message) {
  $("source-status").textContent = message;
}

function setAdminStatus(message) {
  $("admin-status").textContent = message;
}

function renderAdminControls() {
  const enabled = state.admin.available;
  $("save-admin").disabled = !enabled;
  $("rebuild-watchlist").disabled = !enabled || state.admin.polling;
}

function setJobLog(text, show = true) {
  const log = $("job-log");
  log.hidden = !show;
  log.textContent = text || "";
}

function toLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function fromLines(value) {
  return String(value || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function factorsToText(factors) {
  if (!Array.isArray(factors)) return "";
  return factors
    .map((factor) => [factor.label || "", factor.score ?? "", factor.note || ""].join(" | "))
    .join("\n");
}

function textToFactors(value) {
  return fromLines(value).map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    return {
      label: parts[0] || "점검 항목",
      score: Number.isFinite(Number(parts[1])) ? Number(parts[1]) : 50,
      note: parts.slice(2).join(" | ") || ""
    };
  });
}

function removeEmpty(value) {
  if (Array.isArray(value)) {
    const next = value.map(removeEmpty).filter((item) => item !== undefined);
    return next.length ? next : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, child]) => {
      const cleaned = removeEmpty(child);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}

function normalizeConfig(input) {
  const config = {
    title: input?.title || DEFAULT_CONFIG.title,
    description: input?.description || DEFAULT_CONFIG.description,
    stocks: Array.isArray(input?.stocks) ? input.stocks : [],
    disclaimer: input?.disclaimer || DEFAULT_CONFIG.disclaimer
  };
  return config;
}

function cleanConfig(config) {
  return {
    title: config.title || DEFAULT_CONFIG.title,
    description: config.description || "",
    stocks: (config.stocks || []).map((stock) => removeEmpty(stock)).filter(Boolean),
    disclaimer: config.disclaimer || DEFAULT_CONFIG.disclaimer
  };
}

function createEmptyStock() {
  return {
    ticker: "",
    name: "새 관심종목",
    market: "한국",
    assetClass: "equity",
    sector: "",
    sectorLabel: "",
    currency: "KRW",
    positionNote: "",
    thesis: "",
    macroDrivers: { positive: [], negative: [] },
    micro: { demand: "", margin: "", balanceSheet: "", valuation: "" },
    microFactors: [],
    watchLevels: [],
    nextChecks: [],
    risks: []
  };
}

function getSelectedStock() {
  const stocks = state.config.stocks || [];
  if (!stocks.length) return null;
  if (state.selectedIndex < 0 || state.selectedIndex >= stocks.length) state.selectedIndex = 0;
  return stocks[state.selectedIndex];
}

function setField(id, value) {
  $(id).value = value ?? "";
}

function getField(id) {
  return $(id).value.trim();
}

function fillForm(stock) {
  const disabled = !stock;
  Object.values(fields).forEach((id) => { $(id).disabled = disabled; });
  $("apply-stock").disabled = disabled;
  $("reset-form").disabled = disabled;
  $("duplicate-stock").disabled = disabled;
  $("delete-stock").disabled = disabled;

  if (!stock) {
    Object.values(fields).forEach((id) => setField(id, ""));
    return;
  }

  setField(fields.ticker, stock.ticker);
  setField(fields.name, stock.name);
  setField(fields.market, stock.market || "한국");
  setField(fields.assetClass, stock.assetClass);
  setField(fields.sector, stock.sector);
  setField(fields.sectorLabel, stock.sectorLabel);
  setField(fields.currency, stock.currency);
  setField(fields.chartSymbol, stock.chartSymbol || stock.yahooSymbol || "");
  setField(fields.naverSymbol, stock.naverSymbol);
  setField(fields.sectorEtf, stock.sectorEtf);
  setField(fields.benchmarkTicker, stock.benchmarkTicker);
  setField(fields.benchmarkMetric, stock.benchmarkMetric);
  setField(fields.inverseOf, stock.inverseOf);
  setField(fields.inverseMultiplier, stock.inverseMultiplier ?? "");
  setField(fields.positionNote, stock.positionNote);
  setField(fields.thesis, stock.thesis);
  setField(fields.positive, toLines(stock.macroDrivers?.positive));
  setField(fields.negative, toLines(stock.macroDrivers?.negative));
  setField(fields.demand, stock.micro?.demand);
  setField(fields.margin, stock.micro?.margin);
  setField(fields.balanceSheet, stock.micro?.balanceSheet);
  setField(fields.valuation, stock.micro?.valuation);
  setField(fields.microFactors, factorsToText(stock.microFactors));
  setField(fields.watchLevels, toLines(stock.watchLevels));
  setField(fields.nextChecks, toLines(stock.nextChecks));
  setField(fields.risks, toLines(stock.risks));
}

function stockFromForm(existing = {}) {
  const stock = {
    ...existing,
    ticker: getField(fields.ticker),
    name: getField(fields.name),
    market: getField(fields.market),
    assetClass: getField(fields.assetClass),
    sector: getField(fields.sector),
    sectorLabel: getField(fields.sectorLabel),
    currency: getField(fields.currency),
    chartSymbol: getField(fields.chartSymbol),
    naverSymbol: getField(fields.naverSymbol),
    sectorEtf: getField(fields.sectorEtf),
    benchmarkTicker: getField(fields.benchmarkTicker),
    benchmarkMetric: getField(fields.benchmarkMetric),
    inverseOf: getField(fields.inverseOf),
    positionNote: getField(fields.positionNote),
    thesis: getField(fields.thesis),
    macroDrivers: {
      positive: fromLines(getField(fields.positive)),
      negative: fromLines(getField(fields.negative))
    },
    micro: {
      demand: getField(fields.demand),
      margin: getField(fields.margin),
      balanceSheet: getField(fields.balanceSheet),
      valuation: getField(fields.valuation)
    },
    microFactors: textToFactors(getField(fields.microFactors)),
    watchLevels: fromLines(getField(fields.watchLevels)),
    nextChecks: fromLines(getField(fields.nextChecks)),
    risks: fromLines(getField(fields.risks))
  };
  const inverseMultiplier = Number(getField(fields.inverseMultiplier));
  if (Number.isFinite(inverseMultiplier) && getField(fields.inverseMultiplier) !== "") {
    stock.inverseMultiplier = inverseMultiplier;
  } else {
    delete stock.inverseMultiplier;
  }
  if (stock.chartSymbol) stock.yahooSymbol = stock.chartSymbol;
  return removeEmpty(stock) || {};
}

function syncGlobalFromInputs() {
  state.config.title = getField("config-title") || DEFAULT_CONFIG.title;
  state.config.description = getField("config-description");
  state.config.disclaimer = getField("config-disclaimer") || DEFAULT_CONFIG.disclaimer;
}

function fillGlobalInputs() {
  setField("config-title", state.config.title);
  setField("config-description", state.config.description);
  setField("config-disclaimer", state.config.disclaimer);
}

function validateConfig(config) {
  const findings = [];
  if (!Array.isArray(config.stocks) || config.stocks.length === 0) findings.push("관심종목이 없습니다.");
  const seen = new Set();
  (config.stocks || []).forEach((stock, index) => {
    const label = stock.ticker || stock.name || "#" + (index + 1);
    if (!stock.ticker) findings.push(label + ": 티커가 없습니다.");
    if (!stock.name) findings.push(label + ": 이름이 없습니다.");
    if (stock.ticker && seen.has(stock.ticker)) findings.push(label + ": 티커가 중복됩니다.");
    if (stock.ticker) seen.add(stock.ticker);
    if (!stock.market) findings.push(label + ": 시장 값이 없습니다.");
  });
  return findings;
}

function renderList() {
  const stocks = state.config.stocks || [];
  $("stock-count").textContent = "종목 " + stocks.length + "개";
  if (!stocks.length) {
    $("settings-stock-list").innerHTML = '<p class="empty-line">등록된 종목이 없습니다.</p>';
    return;
  }
  $("settings-stock-list").innerHTML = stocks.map((stock, index) => {
    const active = index === state.selectedIndex ? " active" : "";
    return '<button class="settings-stock-item' + active + '" type="button" data-index="' + index + '">' +
      '<span>' + escapeHtml(stock.market || "시장") + '</span>' +
      '<strong>' + escapeHtml(stock.name || stock.ticker || "이름 없음") + '</strong>' +
      '<em>' + escapeHtml(stock.ticker || "티커 없음") + ' · ' + escapeHtml(stock.sectorLabel || stock.sector || "섹터 없음") + '</em>' +
      '</button>';
  }).join("");
  document.querySelectorAll(".settings-stock-item").forEach((button) => {
    button.addEventListener("click", () => {
      applyCurrentStock(false);
      state.selectedIndex = Number(button.dataset.index);
      renderAll();
    });
  });
}

function renderValidation() {
  const findings = validateConfig(cleanConfig(state.config));
  const panel = $("validation-panel");
  if (!findings.length) {
    panel.className = "validation-panel ok";
    panel.textContent = "검증 통과";
    return;
  }
  panel.className = "validation-panel warn";
  panel.innerHTML = '<strong>검증 필요</strong><ul>' + findings.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>';
}

function renderPreview() {
  $("json-preview").textContent = JSON.stringify(cleanConfig(state.config), null, 2);
}

function renderAll() {
  fillGlobalInputs();
  renderList();
  fillForm(getSelectedStock());
  renderValidation();
  renderPreview();
}

function applyCurrentStock(markDirty = true) {
  syncGlobalFromInputs();
  const stocks = state.config.stocks || [];
  if (stocks.length && state.selectedIndex >= 0 && state.selectedIndex < stocks.length) {
    stocks[state.selectedIndex] = stockFromForm(stocks[state.selectedIndex]);
  }
  state.config.stocks = stocks;
  if (markDirty) state.dirty = true;
  renderList();
  renderValidation();
  renderPreview();
}

function loadConfig(config, label) {
  state.config = normalizeConfig(config);
  state.selectedIndex = 0;
  state.dirty = false;
  setStatus(label);
  renderAll();
}

async function loadDefaultConfig() {
  const source = state.admin.available ? "./api/watchlist-config" : "./config/watchlist-stocks.json?v=" + Date.now();
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) throw new Error("config_load_failed");
  loadConfig(await response.json(), state.admin.available ? "프로젝트 설정" : "현재 설정");
}

function loadBrowserConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  loadConfig(JSON.parse(raw), "브라우저 저장본");
  return true;
}

async function openConfigFile() {
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Watchlist JSON", accept: { "application/json": [".json"] } }],
      multiple: false
    });
    const file = await handle.getFile();
    const text = await file.text();
    state.fileHandle = handle;
    loadConfig(JSON.parse(text), file.name);
    return;
  }
  $("file-input").click();
}

async function saveConfigFile() {
  applyCurrentStock(false);
  const text = JSON.stringify(cleanConfig(state.config), null, 2) + "\n";
  if (state.fileHandle?.createWritable) {
    const writable = await state.fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    state.dirty = false;
    setStatus("파일 저장 완료");
    return;
  }
  downloadJson();
}

function downloadJson() {
  applyCurrentStock(false);
  const text = JSON.stringify(cleanConfig(state.config), null, 2) + "\n";
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "watchlist-stocks.json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("JSON 내보내기 완료");
}

async function copyJson() {
  applyCurrentStock(false);
  await navigator.clipboard.writeText(JSON.stringify(cleanConfig(state.config), null, 2));
  setStatus("JSON 복사 완료");
}

function saveBrowserConfig() {
  applyCurrentStock(false);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanConfig(state.config)));
  state.dirty = false;
  setStatus("브라우저 저장 완료");
}

async function detectAdminApi() {
  try {
    const response = await fetch("./api/admin-status", { cache: "no-store" });
    if (!response.ok) throw new Error("admin_unavailable");
    const data = await response.json();
    state.admin.available = Boolean(data.admin);
    state.admin.currentJobId = data.currentJobId || null;
    setAdminStatus(state.admin.available ? "로컬 API 연결" : "로컬 API 없음");
  } catch {
    state.admin.available = false;
    setAdminStatus("로컬 API 없음");
  }
  renderAdminControls();
}

async function saveProjectConfig() {
  if (!state.admin.available) return;
  applyCurrentStock(false);
  const config = cleanConfig(state.config);
  const findings = validateConfig(config);
  if (findings.length) {
    setStatus("검증 필요");
    renderValidation();
    return;
  }
  const response = await fetch("./api/watchlist-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(data.findings?.join(" / ") || "프로젝트 저장 실패");
    return;
  }
  state.dirty = false;
  localStorage.removeItem(STORAGE_KEY);
  setStatus("프로젝트 저장 완료");
}

function renderJob(job) {
  const statusLabel = job.status === "running" ? "재생성 중" : job.status === "success" ? "재생성 완료" : "재생성 실패";
  setStatus(statusLabel);
  setJobLog((job.output || "").trim() || statusLabel);
}

async function pollJob(jobId) {
  state.admin.polling = true;
  renderAdminControls();
  try {
    const response = await fetch("./api/jobs/" + encodeURIComponent(jobId), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.job) throw new Error("job_missing");
    renderJob(data.job);
    if (data.job.status === "running") {
      setTimeout(() => pollJob(jobId), 1500);
      return;
    }
    await loadAnalysisStatus();
  } catch {
    setStatus("작업 상태 확인 실패");
  }
  state.admin.polling = false;
  renderAdminControls();
}

async function rebuildWatchlist() {
  if (!state.admin.available) return;
  const response = await fetch("./api/rebuild-watchlist", { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.job) {
    setStatus("분석 재생성 시작 실패");
    return;
  }
  state.admin.currentJobId = data.job.id;
  renderJob(data.job);
  pollJob(data.job.id);
}

function addStock() {
  applyCurrentStock(false);
  state.config.stocks.push(createEmptyStock());
  state.selectedIndex = state.config.stocks.length - 1;
  state.dirty = true;
  renderAll();
}

function duplicateStock() {
  applyCurrentStock(false);
  const stock = getSelectedStock();
  if (!stock) return;
  const copy = structuredClone(stock);
  copy.ticker = copy.ticker ? copy.ticker + ".COPY" : "COPY";
  copy.name = (copy.name || "종목") + " 복사본";
  state.config.stocks.splice(state.selectedIndex + 1, 0, copy);
  state.selectedIndex += 1;
  state.dirty = true;
  renderAll();
}

function deleteStock() {
  const stocks = state.config.stocks || [];
  if (!stocks.length) return;
  stocks.splice(state.selectedIndex, 1);
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, stocks.length - 1));
  state.dirty = true;
  renderAll();
}

async function loadAnalysisStatus() {
  try {
    const response = await fetch("./data/stock-watchlist.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("analysis_missing");
    const data = await response.json();
    const count = Array.isArray(data.stocks) ? data.stocks.length : 0;
    $("analysis-status").textContent = "분석 " + count + "개";
  } catch {
    $("analysis-status").textContent = "분석 데이터 없음";
  }
}

function bindEvents() {
  $("load-default").addEventListener("click", () => loadDefaultConfig().catch(() => setStatus("현재 설정 실패")));
  $("open-file").addEventListener("click", () => openConfigFile().catch(() => setStatus("파일 열기 실패")));
  $("save-browser").addEventListener("click", saveBrowserConfig);
  $("save-file").addEventListener("click", () => saveConfigFile().catch(() => setStatus("파일 저장 실패")));
  $("save-admin").addEventListener("click", () => saveProjectConfig().catch(() => setStatus("프로젝트 저장 실패")));
  $("rebuild-watchlist").addEventListener("click", () => rebuildWatchlist().catch(() => setStatus("분석 재생성 실패")));
  $("download-json").addEventListener("click", downloadJson);
  $("copy-json").addEventListener("click", () => copyJson().catch(() => setStatus("복사 실패")));
  $("add-stock").addEventListener("click", addStock);
  $("duplicate-stock").addEventListener("click", duplicateStock);
  $("delete-stock").addEventListener("click", deleteStock);
  $("reset-form").addEventListener("click", () => fillForm(getSelectedStock()));
  $("stock-form").addEventListener("submit", (event) => {
    event.preventDefault();
    applyCurrentStock(true);
    renderAll();
    setStatus("종목 반영 완료");
  });
  ["config-title", "config-description", "config-disclaimer"].forEach((id) => {
    $(id).addEventListener("input", () => {
      syncGlobalFromInputs();
      state.dirty = true;
      renderValidation();
      renderPreview();
    });
  });
  $("file-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    state.fileHandle = null;
    loadConfig(JSON.parse(text), file.name);
    event.target.value = "";
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function init() {
  bindEvents();
  renderAdminControls();
  await detectAdminApi();
  await loadAnalysisStatus();
  try {
    await loadDefaultConfig();
  } catch {
    if (!loadBrowserConfig()) {
      loadConfig(structuredClone(DEFAULT_CONFIG), "새 설정");
    }
  }
}

init();
