// セキュリティの検査（AI の判断なしで合否が決まるもの）。 node test/security.js
//   終了コード：0＝問題なし、1＝問題あり、2＝道具のエラー（Playwright が無いなど）
// 1. 静的な検査：危ない書き方（eval など）、外部への通信、外部の読み込み、秘密情報らしき文字列、
//    target="_blank" の rel、HTML を組み立てる場所（innerHTML など）の一覧の変化
// 2. 動的な検査：共有URLと手当名に HTML・スクリプトを入れて開き、ページに差し込まれないこと
//    （要素が増えない・スクリプトが動かない・CSP の違反が出ない）
// HTML を組み立てる場所が増えたり変わったりしたら「要レビュー」で NG にする。中身を確かめて安全なら
// node test/security.js --accept で test/security-sinks.json を書き換える（理由をコミットに書く）。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SINKS = path.join(__dirname, "security-sinks.json");
const accept = process.argv.includes("--accept");
let ng = 0;
const fail = (m) => {
  ng++;
  console.log("NG " + m);
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const siteFiles = ["index.html", ...["js", "data", "css"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).map((f) => `${d}/${f}`))];

// ---- 1. 静的な検査 ----
for (const f of siteFiles.filter((f) => f.endsWith(".js"))) {
  const s = read(f);
  for (const [re, what] of [
    [/\beval\s*\(/, "eval"],
    [/new\s+Function\s*\(/, "new Function"],
    [/set(?:Timeout|Interval)\s*\(\s*["'`]/, "文字列を渡す setTimeout/setInterval"],
    [/document\.write/, "document.write"],
    [/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/, "外部への通信"],
    [/localStorage\.setItem|sessionStorage\.setItem|indexedDB\.open|document\.cookie\s*=/, "利用者の入力の保存"],
    [/https?:\/\/(?!laws\.e-gov|www\.)/, "外部のURL"],
  ])
    if (re.test(s) && !(what === "外部のURL" && /^data\//.test(f))) fail(`${f}：${what} がある`);
}
const html = read("index.html");
for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
  if (!/rel="[^"]*noopener[^"]*"/.test(m[0])) fail(`index.html：target="_blank" のリンクに rel="noopener" がない：${m[0].slice(0, 80)}`);
if (/<(script|link|img|iframe)[^>]+(src|href)="https?:/i.test(html.replace(/<meta[^>]+>/g, "").replace(/<a\b[^>]*>/g, "")))
  fail("index.html：外部のファイルを読み込んでいる");
// 秘密情報らしき文字列（リポジトリのすべての管理下のファイル）
const { execFileSync } = require("child_process");
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of tracked) {
  if (/\.(png|jpg|ico|pdf)$/i.test(f)) continue;
  let s;
  try {
    s = fs.readFileSync(path.join(ROOT, f), "utf8");
  } catch {
    continue;
  }
  for (const [re, what] of [
    [/AKIA[0-9A-Z]{16}/, "AWS のキー"],
    [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub のトークン"],
    [/sk-[A-Za-z0-9_-]{30,}/, "API キー"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "秘密鍵"],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack のトークン"],
  ])
    if (re.test(s)) fail(`${f}：${what}らしき文字列がある`);
}
// HTML を組み立てる場所（innerHTML・insertAdjacentHTML・outerHTML）の一覧。前回確かめた一覧と違えば要レビュー
const sinks = [];
for (const f of siteFiles.filter((f) => f.startsWith("js/"))) {
  const lines = read(f).split("\n");
  lines.forEach((line, i) => {
    if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/.test(line)) {
      // 前後の数行（組み立てる中身）まで含めて指紋にする。行番号は変わりやすいので使わない
      const body = lines.slice(i, i + 8).join("\n").replace(/\s+/g, " ");
      sinks.push({ file: f, line: line.trim().slice(0, 100), hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16) });
    }
  });
}
if (accept) {
  fs.writeFileSync(SINKS, JSON.stringify({ reviewedOn: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }), sinks }, null, 2) + "\n");
  console.log(`test/security-sinks.json を書き換えた（${sinks.length} か所）。中身を確かめた理由をコミットに書く。`);
} else {
  const known = fs.existsSync(SINKS) ? JSON.parse(fs.readFileSync(SINKS, "utf8")).sinks : [];
  const key = (s) => `${s.file}|${s.hash}`;
  const knownKeys = new Set(known.map(key));
  for (const s of sinks)
    if (!knownKeys.has(key(s))) fail(`要レビュー：HTML を組み立てる場所が新しく増えたか変わった（${s.file}：${s.line}）。利用者の入力や共有URLの値をそのまま入れていないか確かめ、安全なら --accept`);
}

// ---- 2. 動的な検査（共有URL・手当名に HTML を入れる）----
function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean)) {
    try {
      return require(t);
    } catch {}
  }
  return null;
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" };
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

(async () => {
  const pw = loadPlaywright();
  if (!pw) {
    console.log("Playwright が見つからないので、動的な検査はできなかった（npm i --no-save playwright@1.61.0 && npx playwright install chromium）");
    console.log(ng ? `\nNG ${ng}` : "\n静的な検査は OK");
    process.exitCode = 2;
    return;
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.clock.setFixedTime(new Date("2026-11-16T12:00:00+09:00"));
    const problems = [];
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("dialog", (d) => {
      problems.push("dialog が開いた（スクリプトが動いた）: " + d.message());
      d.dismiss();
    });
    page.on("request", (r) => !r.url().startsWith(base) && !r.url().startsWith("data:") && problems.push("外部への通信: " + r.url()));
    await page.addInitScript(() => {
      window.__pwned = 0;
      document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP違反 ${e.violatedDirective}`));
    });
    page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
    // まず画面で共有URLの形を作る（手当を2件足して、名前に HTML を入れる）
    await page.goto(base, { waitUntil: "load" });
    const payloads = [
      `<img src=x onerror="window.__pwned=1;alert(1)">`,
      `"><svg onload=alert(1)><b data-pwn=1>x</b>`,
      `</td></tr><script>window.__pwned=2</script><tr><td>`,
      `{{constructor.constructor('alert(1)')()}}`,
    ];
    const url = await page.evaluate(async (payloads) => {
      const g = (id) => document.getElementById(id);
      const w = (t) => new Promise((r) => setTimeout(r, t));
      if (!g("simulatorDialog").open) g("simLaunch").click();
      await w(500);
      for (const p of payloads) {
        g("allowanceKind").value = "その他（自由入力）";
        g("addAllowance").click();
        await w(150);
        const it = [...document.querySelectorAll(".allowance-item")].at(-1);
        const name = it.querySelector(".a-name");
        name.value = p;
        name.dispatchEvent(new Event("input", { bubbles: true }));
        const amt = it.querySelector(".a-amount");
        amt.value = "1000";
        amt.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await w(600);
      const s = { f: {}, a: [] };
      // 共有URLを作る関数は simulator.js の中にあるので、ボタンの動きと同じ形を組み立てる
      const btn = g("shareLink");
      let shared = null;
      const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      try {
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => (shared = t) }, configurable: true });
      } catch {}
      btn.click();
      await w(300);
      if (orig) Object.defineProperty(navigator, "clipboard", { value: { writeText: orig }, configurable: true });
      return shared || g("shareUrl")?.value || location.href;
    }, payloads);
    // 作った共有URLを新しいページで開く（URLから入る値が HTML として差し込まれないか）
    const p2 = await browser.newPage();
    await p2.clock.setFixedTime(new Date("2026-11-16T12:00:00+09:00"));
    p2.on("dialog", (d) => {
      problems.push("共有URLで dialog が開いた: " + d.message());
      d.dismiss();
    });
    p2.on("pageerror", (e) => problems.push("共有URLで pageerror: " + e.message));
    await p2.addInitScript(() => (window.__pwned = 0));
    if (!/#sim=/.test(url)) problems.push("共有URLを作れなかった（検査の作りを見直す）");
    await p2.goto(url, { waitUntil: "load" });
    await p2.waitForTimeout(1200);
    for (const pg of [page, p2]) {
      const r = await pg.evaluate(() => {
        const injected = document.querySelectorAll('img[src="x"], [data-pwn], svg[onload], script:not([src]):not([type="application/ld+json"])').length;
        // 印刷用の紙面も作って確かめる
        const before = window.__pwned;
        const printBtn = document.getElementById("printSim");
        const origPrint = window.print;
        window.print = () => {};
        printBtn?.click();
        window.print = origPrint;
        const injected2 = document.querySelectorAll('img[src="x"], [data-pwn], svg[onload], script:not([src]):not([type="application/ld+json"])').length;
        const built = !!document.querySelector(".print-area");
        return { injected, injected2, pwned: window.__pwned || before, built, err: document.getElementById("simError")?.textContent || "", items: document.querySelectorAll(".allowance-item").length };
      });
      if (r.injected || r.injected2) problems.push(`入力した HTML が要素として差し込まれた（画面 ${r.injected}・印刷 ${r.injected2}）`);
      if (r.pwned) problems.push("入力したスクリプトが動いた");
      if (!r.built) problems.push(`印刷の紙面を作れなかった（検査が働いていない。エラー表示：${r.err || "なし"}、手当 ${r.items} 件）`);
      if (r.items < payloads.length) problems.push(`手当が ${r.items} 件しか戻らなかった（共有URLの往復を確かめる）`);
    }
    for (const p of problems) fail(p);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(ng ? `\nNG ${ng}` : "\nOK（静的な検査・HTML の差し込み・スクリプトの実行・外部通信・CSP）");
  process.exitCode = ng ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
