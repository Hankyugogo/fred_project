import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "watchlist-stocks.json");
const HOST = process.env.ADMIN_HOST || "127.0.0.1";
const PORT = Number(process.env.ADMIN_PORT || 8081);
const MAX_BODY_BYTES = 1_000_000;
const MAX_LOG_CHARS = 40_000;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

const jobs = new Map();
let currentJobId = null;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateConfig(config) {
  const findings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) findings.push("설정은 JSON 객체여야 합니다.");
  if (!Array.isArray(config?.stocks) || config.stocks.length === 0) findings.push("관심종목이 없습니다.");
  const seen = new Set();
  (config?.stocks || []).forEach((stock, index) => {
    const label = stock?.ticker || stock?.name || "#" + (index + 1);
    if (!stock?.ticker) findings.push(label + ": 티커가 없습니다.");
    if (!stock?.name) findings.push(label + ": 이름이 없습니다.");
    if (stock?.ticker && seen.has(stock.ticker)) findings.push(label + ": 티커가 중복됩니다.");
    if (stock?.ticker) seen.add(stock.ticker);
    if (!stock?.market) findings.push(label + ": 시장 값이 없습니다.");
  });
  return findings;
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    command: job.command,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    output: job.output
  };
}

function appendJobOutput(job, chunk) {
  job.output += chunk.toString();
  if (job.output.length > MAX_LOG_CHARS) {
    job.output = job.output.slice(-MAX_LOG_CHARS);
  }
}

function startRebuildJob() {
  if (currentJobId) {
    const current = jobs.get(currentJobId);
    if (current?.status === "running") return current;
  }

  const id = "job-" + Date.now();
  const job = {
    id,
    status: "running",
    command: "npm run build:stocks:full",
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    output: ""
  };
  jobs.set(id, job);
  currentJobId = id;

  const child = spawn("npm", ["run", "build:stocks:full"], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => appendJobOutput(job, chunk));
  child.stderr.on("data", (chunk) => appendJobOutput(job, chunk));
  child.on("error", (error) => {
    job.status = "failed";
    job.exitCode = -1;
    job.endedAt = new Date().toISOString();
    appendJobOutput(job, error.message + "\n");
    currentJobId = null;
  });
  child.on("close", (code) => {
    job.status = code === 0 ? "success" : "failed";
    job.exitCode = code;
    job.endedAt = new Date().toISOString();
    currentJobId = null;
  });

  return job;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/admin-status") {
    let configWritable = true;
    try {
      await access(CONFIG_PATH);
    } catch {
      configWritable = false;
    }
    sendJson(res, 200, {
      admin: true,
      root: ROOT,
      configPath: "config/watchlist-stocks.json",
      configWritable,
      currentJobId,
      jobs: Array.from(jobs.values()).slice(-5).map(serializeJob)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/watchlist-config") {
    const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    sendJson(res, 200, config);
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/watchlist-config") {
    const body = await readBody(req);
    let config;
    try {
      config = JSON.parse(body);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const findings = validateConfig(config);
    if (findings.length > 0) {
      sendJson(res, 422, { ok: false, error: "validation_failed", findings });
      return;
    }

    await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
    sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), path: "config/watchlist-stocks.json" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rebuild-watchlist") {
    const job = startRebuildJob();
    sendJson(res, job.status === "running" ? 202 : 200, { ok: true, job: serializeJob(job) });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "job_not_found" });
      return;
    }
    sendJson(res, 200, { ok: true, job: serializeJob(job) });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT, "." + requestPath);
  if (!filePath.startsWith(ROOT + path.sep)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }
  if (!fileStat.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "cache-control": "no-store"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || (HOST + ":" + PORT)));
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "internal_error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("[admin-server] http://" + HOST + ":" + PORT + "/settings.html");
});
