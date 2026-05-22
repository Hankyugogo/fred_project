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
  return replacements.reduce((text, pair) => text.split(pair[0]).join(pair[1]), String(value ?? ""));
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
