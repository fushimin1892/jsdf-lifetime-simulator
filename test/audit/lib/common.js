// 自動点検の共通部分：Playwright の読み込み、一時サーバー、ページの開き方、異常の記録。
// test/regression.js と同じ書き方（PLAYWRIGHT_MODULE か require("playwright")、127.0.0.1 の空きポート、日付は 2026-11-16 に固定）。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

// サイトの場所。環境変数 AUDIT_ROOT で別の場所（わざと壊したコピーなど）を点検できる
const ROOT = path.resolve(process.env.AUDIT_ROOT || path.join(__dirname, "..", "..", ".."));
const FIXED_TIME = "2026-11-16T12:00:00+09:00";
// 読み込み・操作の待ち時間（遅い環境の初回読み込みで止まらないよう、Playwright の初期値 30秒より延ばす）
const WAIT = 120 * 1000;

class ToolError extends Error {}

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {}
  }
  throw new ToolError(
    "Playwright が見つからない。npm i --no-save playwright@1.61.0 && npx playwright install chromium を実行するか、PLAYWRIGHT_MODULE を指定する。",
  );
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// 1つの点検の実行環境：ブラウザ・サーバー・異常の一覧
async function createEnv() {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) throw new ToolError(`サイトが見つからない：${ROOT}`);
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    throw new ToolError("Chromium を起動できない（npx playwright install chromium が必要かもしれない）：" + e.message.split("\n")[0]);
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  return {
    ROOT,
    base,
    browser,
    async close() {
      await browser.close().catch(() => {});
      server.close();
    },
  };
}

// ページを開く。コンソールのエラー・ページの例外・CSP の違反・外部への通信を problems に集める
async function openPage(env, opts = {}) {
  const ctx = await env.browser.newContext({
    viewport: { width: opts.width || 1280, height: opts.height || 900 },
    colorScheme: opts.colorScheme || "light",
    reducedMotion: opts.reducedMotion || "reduce",
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  page.setDefaultTimeout(WAIT);
  page.setDefaultNavigationTimeout(WAIT);
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push("コンソールのエラー：" + m.text()));
  page.on("pageerror", (e) => problems.push("ページの例外：" + e.message));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(env.base) && !u.startsWith("data:") && !u.startsWith("blob:")) problems.push("外部への通信：" + u);
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP違反 ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(opts.url || env.base, { waitUntil: "load", timeout: WAIT });
  return { ctx, page, problems, close: () => ctx.close() };
}

// 異常の記録。suite（計算・手当…）ごとに件数と、例を最大 maxExamples 件ずつ残す
class Report {
  constructor(suite) {
    this.suite = suite;
    this.cases = 0;
    this.checks = 0;
    this.anomalies = [];
    this.notes = [];
  }
  ok(n = 1) {
    this.checks += n;
  }
  // kind：異常の種類（英字の短い名前）、message：日本語の説明、input：再現に要る入力
  add(kind, message, input) {
    this.checks++;
    this.anomalies.push({ kind, message, input: input === undefined ? null : input });
  }
  // 条件が偽なら異常
  expect(cond, kind, message, input) {
    if (cond) this.checks++;
    else this.add(kind, typeof message === "function" ? message() : message, input);
    return !!cond;
  }
  // ページで集めた問題（コンソールのエラー・CSP・外部通信）を異常として移す
  takeProblems(problems, where) {
    for (const p of problems.splice(0)) this.add(/^外部/.test(p) ? "externalRequest" : /CSP/.test(p) ? "csp" : "consoleError", `${where}：${p}`);
  }
}

// 画面の金額の文字（"1,234円"・"−5,000円"）を数にする
function yen(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, "").match(/[−-]?\d+/);
  return m ? Number(m[0].replace("−", "-")) : null;
}

module.exports = { ROOT, WAIT, FIXED_TIME, ToolError, loadPlaywright, createEnv, openPage, Report, yen };
