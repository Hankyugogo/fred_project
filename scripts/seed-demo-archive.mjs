import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function runPublish(reportDate) {
  await execFileAsync("npm", ["run", "publish:demo"], {
    cwd: ROOT,
    env: {
      ...process.env,
      REPORT_DATE_OVERRIDE: reportDate
    }
  });
}

async function main() {
  const anchor = process.env.SEED_END_DATE || "2026-04-27";
  const dates = [4, 3, 2, 1, 0].map((offset) => addDays(anchor, -offset));

  for (const reportDate of dates) {
    await runPublish(reportDate);
    console.log(`Seeded demo briefing for ${reportDate}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
