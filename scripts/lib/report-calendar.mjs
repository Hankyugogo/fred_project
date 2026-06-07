const US_EQUITY_IDS = ["SP500", "NASDAQCOM", "DJIA"];
const KOREA_MARKET_IDS = ["KOSPI", "KOSDAQ"];
const RATE_IDS = ["DGS2", "DGS10"];
const FX_IDS = ["DEXKOUS", "DTWEXBGS", "DEXJPUS"];

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function observationMap(series, ids) {
  const byId = new Map((series || []).map((item) => [item.id, item]));
  return Object.fromEntries(
    ids
      .map((id) => [id, validDate(byId.get(id)?.observationDate)])
      .filter(([, date]) => Boolean(date))
  );
}

function minDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || null;
}

function maxDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

function compareDates(left, right) {
  if (!validDate(left) || !validDate(right)) return 0;
  return left.localeCompare(right);
}

function isWeekend(dateString) {
  if (!validDate(dateString)) return false;
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function buildReportCalendar(series, reportDate, generatedAt, reportTimeZone = "Asia/Seoul") {
  const usEquities = observationMap(series, US_EQUITY_IDS);
  const koreaMarkets = observationMap(series, KOREA_MARKET_IDS);
  const rates = observationMap(series, RATE_IDS);
  const fx = observationMap(series, FX_IDS);
  const volatility = observationMap(series, ["VIXCLS"]);
  const commodities = observationMap(series, ["DCOILWTICO", "DCOILBRENTEU"]);

  const usEquityDates = Object.values(usEquities);
  const usEquityReferenceDate = minDate(usEquityDates);
  const latestUsEquityDate = maxDate(usEquityDates);
  const koreaMarketReferenceDate = maxDate(Object.values(koreaMarkets));
  const rateReferenceDate = maxDate(Object.values(rates));
  const fxReferenceDate = maxDate(Object.values(fx));
  const volatilityReferenceDate = maxDate(Object.values(volatility));
  const commodityReferenceDate = maxDate(Object.values(commodities));

  const usEquityStatus = usEquityReferenceDate && compareDates(usEquityReferenceDate, reportDate) < 0
    ? "prior-session"
    : usEquityReferenceDate === reportDate
      ? "same-date"
      : "unknown";

  const note = usEquityStatus === "prior-session" && isWeekend(reportDate)
    ? `한국시간 ${reportDate} 발행본의 미국 주식 기준일은 ${usEquityReferenceDate}입니다. 주말·휴장 또는 공급자 갱신 지연 때는 개별 지표 관측일을 함께 확인해야 합니다.`
    : usEquityStatus === "prior-session"
      ? `한국시간 ${reportDate} 발행본의 미국 주식 기준일은 ${usEquityReferenceDate}입니다. 같은 달력일의 미국 정규장 종가는 한국시간 다음 새벽 이후에 확정됩니다.`
    : usEquityStatus === "same-date"
      ? `미국 주식 기준일과 리포트 일자가 모두 ${reportDate}입니다.`
      : "미국 주식 기준일을 확정할 수 없어 개별 지표의 관측일을 함께 확인해야 합니다.";

  return {
    reportDate,
    reportTimeZone,
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    usEquityReferenceDate,
    latestUsEquityDate,
    usEquityStatus,
    hasSplitUsEquityDates: Boolean(usEquityReferenceDate && latestUsEquityDate && usEquityReferenceDate !== latestUsEquityDate),
    koreaMarketReferenceDate,
    rateReferenceDate,
    volatilityReferenceDate,
    fxReferenceDate,
    commodityReferenceDate,
    observations: {
      usEquities,
      koreaMarkets,
      rates,
      volatility,
      fx,
      commodities
    },
    note
  };
}

export function formatReportCalendarLine(calendar) {
  if (!calendar) return "";
  const parts = [
    `리포트 일자 ${calendar.reportDate || "—"} KST`,
    `미국 주식 기준일 ${calendar.usEquityReferenceDate || "—"}`,
    `한국 시장 기준일 ${calendar.koreaMarketReferenceDate || "—"}`
  ];
  return parts.join(" · ");
}
