import { glob, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyPreferredTermsToText, loadPreferredReplacements } from "./editorial-copy.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_PATTERNS = [
  "data/briefings.json",
  "data/market-snapshot.json",
  "posts/*.md",
  "report.html",
  "reports/*.html"
];

async function expand(pattern) {
  const files = [];
  for await (const file of glob(pattern, { cwd: ROOT })) {
    files.push(path.join(ROOT, file));
  }
  return files;
}

async function main() {
  const replacements = await loadPreferredReplacements(ROOT);
  const files = (await Promise.all(PUBLIC_PATTERNS.map(expand))).flat();
  let changed = 0;

  for (const file of files) {
    const original = await readFile(file, "utf8");
    const next = applyPreferredTermsToText(original, replacements);
    if (next !== original) {
      await writeFile(file, next, "utf8");
      changed += 1;
      console.log("[apply-editorial-copy] updated " + path.relative(ROOT, file));
    }
  }

  console.log("[apply-editorial-copy] " + changed + "/" + files.length + " files updated.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
