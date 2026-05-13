import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const STYLE_PATH = path.join(ROOT, "config", "editorial-style.json");
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
  const style = JSON.parse(await readFile(STYLE_PATH, "utf8"));
  const bannedTerms = (style.preferredTerms || []).map((item) => item.avoid).filter(Boolean);
  const files = (await Promise.all(PUBLIC_PATTERNS.map(expand))).flat();
  const findings = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    bannedTerms.forEach((term) => {
      if (text.includes(term)) {
        findings.push(`${path.relative(ROOT, file)}: ${term}`);
      }
    });
  }

  if (findings.length > 0) {
    console.error("Editorial copy check failed:");
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }

  console.log("Editorial copy check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
