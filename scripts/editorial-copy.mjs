import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const STYLE_PATH = "config/editorial-style.json";

export async function loadPreferredReplacements(root = DEFAULT_ROOT) {
  const style = JSON.parse(await readFile(path.join(root, STYLE_PATH), "utf8"));
  return (style.preferredTerms || [])
    .filter((item) => item && item.avoid && item.use)
    .map((item) => [item.avoid, item.use]);
}

export function applyPreferredTermsToText(value, replacements) {
  const preferred = replacements.reduce((text, pair) => text.split(pair[0]).join(pair[1]), String(value ?? ""));
  return normalizeEditorialText(preferred);
}

function moveNumber(value) {
  const parsed = Number(String(value ?? "").replace(/^\+/, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function equityMoveLabel(values) {
  const moves = values.map(moveNumber);
  const allUp = moves.every((value) => value > 0);
  const allDown = moves.every((value) => value < 0);
  const avgAbs = moves.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(moves.length, 1);

  if (allUp) {
    if (avgAbs >= 1) return "큰 폭 동반 상승";
    if (avgAbs < 0.3) return "소폭 동반 상승";
    return "동반 상승";
  }

  if (allDown) {
    if (avgAbs >= 1) return "큰 폭 동반 하락";
    if (avgAbs < 0.3) return "소폭 동반 하락";
    return "동반 하락";
  }

  return "혼조";
}

function equityMoveSentence(values) {
  const label = equityMoveLabel(values);
  if (label === "큰 폭 동반 상승") return "3대 지수가 모두 큰 폭으로 상승했다";
  if (label === "소폭 동반 상승") return "3대 지수가 모두 소폭 상승했다";
  if (label === "동반 상승") return "3대 지수가 모두 상승했다";
  if (label === "큰 폭 동반 하락") return "3대 지수가 모두 큰 폭으로 하락했다";
  if (label === "소폭 동반 하락") return "3대 지수가 모두 소폭 하락했다";
  if (label === "동반 하락") return "3대 지수가 모두 하락했다";
  return "지수별 방향이 엇갈렸다";
}

function normalizeEquityMovePhrases(value) {
  return String(value ?? "")
    .replace(
      /미 3대 지수 동반 흐름: S&P500 ([+-]?\d+(?:\.\d+)?)%, 나스닥 ([+-]?\d+(?:\.\d+)?)%, 다우 ([+-]?\d+(?:\.\d+)?)%/g,
      (match, sp, nasdaq, dow) => `미 3대 지수 ${equityMoveLabel([sp, nasdaq, dow])}: S&P500 ${sp}%, 나스닥 ${nasdaq}%, 다우 ${dow}%`
    )
    .replace(
      /미 3대 지수 등락: S&P500 ([+-]?\d+(?:\.\d+)?)%, 나스닥 ([+-]?\d+(?:\.\d+)?)%, 다우 ([+-]?\d+(?:\.\d+)?)%/g,
      (match, sp, nasdaq, dow) => `미 3대 지수 ${equityMoveLabel([sp, nasdaq, dow])}: S&P500 ${sp}%, 나스닥 ${nasdaq}%, 다우 ${dow}%`
    )
    .replace(
      /(S(?:&amp;|&)P500)지수가 ([+-]?\d+(?:\.\d+)?)%, 나스닥 종합지수가 ([+-]?\d+(?:\.\d+)?)%, 다우존스30 산업평균지수가 ([+-]?\d+(?:\.\d+)?)% 변동하며 3대 지수 동반 흐름이 나타났다/g,
      (match, spLabel, sp, nasdaq, dow) => `${spLabel}지수 ${sp}%, 나스닥 종합지수 ${nasdaq}%, 다우존스30 산업평균지수 ${dow}%로 ${equityMoveSentence([sp, nasdaq, dow])}`
    )
    .replace(
      /(S(?:&amp;|&)P500)지수가 ([+-]?\d+(?:\.\d+)?)%, 나스닥 종합지수가 ([+-]?\d+(?:\.\d+)?)%, 다우존스30 산업평균지수가 ([+-]?\d+(?:\.\d+)?)% 변동하며 주요 지수 등락이 나타났다/g,
      (match, spLabel, sp, nasdaq, dow) => `${spLabel}지수 ${sp}%, 나스닥 종합지수 ${nasdaq}%, 다우존스30 산업평균지수 ${dow}%로 ${equityMoveSentence([sp, nasdaq, dow])}`
    )
    .replace(
      /(S(?:&amp;|&)P500) ([+-]?\d+(?:\.\d+)?)%, 나스닥 ([+-]?\d+(?:\.\d+)?)%, 다우 ([+-]?\d+(?:\.\d+)?)%로 3대 지수 동반 흐름이 나타났다/g,
      (match, spLabel, sp, nasdaq, dow) => `${spLabel} ${sp}%, 나스닥 ${nasdaq}%, 다우 ${dow}%로 ${equityMoveSentence([sp, nasdaq, dow])}`
    )
    .replace(
      /(S(?:&amp;|&)P500) ([+-]?\d+(?:\.\d+)?)%, 나스닥 ([+-]?\d+(?:\.\d+)?)%, 다우 ([+-]?\d+(?:\.\d+)?)%로 주요 지수 등락이 나타났다/g,
      (match, spLabel, sp, nasdaq, dow) => `${spLabel} ${sp}%, 나스닥 ${nasdaq}%, 다우 ${dow}%로 ${equityMoveSentence([sp, nasdaq, dow])}`
    )
    .replace(/혼합 장세, 3대 지수 동반 흐름/g, "혼합 장세, 지수 혼조")
    .replace(/3대 지수 동반 흐름/g, "주요 지수 등락")
    .replace(/동반 흐름/g, "등락");
}

export function normalizeEditorialText(value) {
  const normalized = String(value ?? "")
    .replace(/VIX는 ([0-9.]+)로 20선 아래에 있어 변동성지수\(VIX\)가 20선 아래에 있어 급격한 위험 회피는 제한적이다/g, "VIX는 $1로 20선을 밑돌며 단기 위험 회피 압력은 제한됐다")
    .replace(/VIX는 ([0-9.]+)로 20선 위에 있어 변동성지수\(VIX\)가 20선을 넘어 단기 헤지 수요와 위험 회피를 경계해야 한다/g, "VIX는 $1로 20선을 웃돌아 단기 위험 회피 경계가 남았다")
    .replace(/보조 지표치/g, "보조 지표")
    .replace(/공포 심리은/g, "공포 심리는")
    .replace(/통제된 긴장/g, "제한적 경계")
    .replace(/위험선호가/g, "위험자산 선호가")
    .replace(/방어적 해석이 필요합니다/g, "방어적 해석이 필요하다")
    .replace(/확인이 필요합니다/g, "확인이 필요하다")
    .replace(/해야 합니다/g, "해야 한다")
    .replace(/확인합니다/g, "확인한다")
    .replace(/비교합니다/g, "비교한다")
    .replace(/표기합니다/g, "표기한다")
    .replace(/작성했습니다/g, "작성했다")
    .replace(/판단했습니다/g, "판단했다")
    .replace(/보였습니다/g, "보였다")
    .replace(/나타났습니다/g, "나타났다")
    .replace(/잡혔습니다/g, "잡혔다")
    .replace(/마감했습니다/g, "마감했다")
    .replace(/제한했습니다/g, "제한했다")
    .replace(/보강했습니다/g, "보강했다")
    .replace(/아닙니다/g, "아니다")
    .replace(/입니다/g, "이다")
    .replace(/습니다/g, "다")
    .replace(/다소 /g, "")
    .replace(/보는 편이 좋다/g, "확인해야 한다")
    .replace(/쓰는 편이 안전하다/g, "해석 범위를 제한해야 한다")
    .replace(/두는 편이 낫다/g, "보조 지표로 둔다")
    .replace(/접근하는 편이 안전하다/g, "해석 범위를 제한해야 한다")
    .replace(/쪽이 좋다/g, "쪽으로 본다")
    .replace(/재확인하는 편이 좋다/g, "재확인해야 한다");
  return normalizeEquityMovePhrases(normalized);
}

export function applyPreferredTermsDeep(value, replacements) {
  if (typeof value === "string") {
    return applyPreferredTermsToText(value, replacements);
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyPreferredTermsDeep(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, applyPreferredTermsDeep(child, replacements)])
    );
  }

  return value;
}
