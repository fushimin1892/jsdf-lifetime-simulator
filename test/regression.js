// 計算結果の回帰テスト（ブラウザを自動で動かす）。
//   node test/regression.js            … 期待値（test/expected.json）と比べる。違えば NG
//   node test/regression.js --update   … 法令の数値を変えたあと、変わり方が改正どおりと確かめてから期待値を書き換える
//
// Playwright が必要（サイトには使わない。テストのときだけ）：
//   npm i --no-save playwright@1.61.0 && npx playwright install chromium
// 別の場所に入れたときは、環境変数 PLAYWRIGHT_MODULE にそのフォルダ（…/node_modules/playwright）を指定する。
//
// やること：
//   1. このフォルダを 127.0.0.1 の一時サーバーで配信して開く
//   2. 初期条件の結果（在職中の給与の総額・退職手当・若年給付金・生涯の手取り）を読む
//   3. 「AI用/検証用スクリプト.js」（91通りの条件）を実行して hash を出す
//   4. コンソールのエラー・CSP の違反・外部への通信がないこと、スマホ幅（375px）で横にはみ出さないことを確かめる
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const EXPECTED = path.join(__dirname, "expected.json");
const update = process.argv.includes("--update");

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {}
  }
  console.error("Playwright が見つからない。npm i --no-save playwright@1.61.0 && npx playwright install chromium を実行するか、PLAYWRIGHT_MODULE を指定する。");
  process.exit(2);
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
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  // 途中で止まったら気づけるように、全体を15分で打ち切る
  const killer = setTimeout(() => {
    console.error("NG 15分たっても終わらない（ページが応答しない）");
    process.exit(3);
  }, 15 * 60 * 1000);
  killer.unref();
  const problems = [];
  let ng = 0;
  const fail = (m) => {
    ng++;
    console.log("NG " + m);
  };
  try {
    // 読み込み・操作の待ち時間（Playwright の初期値 30秒では、遅い環境の初回読み込みで止まることがあるため延ばす）
    const WAIT = 120 * 1000;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(WAIT);
    page.setDefaultNavigationTimeout(WAIT);
    page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("request", (r) => !r.url().startsWith(base) && !r.url().startsWith("data:") && problems.push("外部への通信: " + r.url()));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP違反 ${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.goto(base, { waitUntil: "load", timeout: WAIT });

    // 初期条件の結果
    const initial = await page.evaluate(async () => {
      window.requestAnimationFrame = (cb) => {
        cb(performance.now() + 1e6);
        return 0;
      };
      if (!document.getElementById("simulatorDialog").open) document.getElementById("simLaunch").click();
      await new Promise((r) => setTimeout(r, 800));
      const t = (id) => document.getElementById(id).textContent.trim();
      return { 在職中の給与の総額: t("totalIncome"), 退職手当: t("retireAllowance"), 若年定年退職者給付金: t("youngPension"), 生涯の手取り: t("lifetimeNet") };
    });

    console.log("初期条件：" + JSON.stringify(initial));
    // 91通りの回帰（数分かかる）
    console.log("検証用スクリプトを実行中…");
    const src = fs.readFileSync(path.join(ROOT, "AI用/検証用スクリプト.js"), "utf8").replace(/\(\{ hash: h, len: s\.length, n: out\.cases\.length \}\);\s*$/, "return { hash: h, len: s.length, n: out.cases.length };");
    const snap = await page.evaluate(`(async () => {\n${src}\n})()`);

    // 全文（85通りの結果）を残すと、変わった項目を前の全文と比べられる：SNAP_OUT=ファイル名
    if (process.env.SNAP_OUT) fs.writeFileSync(process.env.SNAP_OUT, await page.evaluate(() => window.__snapText));

    // スマホ幅
    const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
    mobile.setDefaultTimeout(WAIT);
    mobile.setDefaultNavigationTimeout(WAIT);
    await mobile.goto(base, { waitUntil: "load", timeout: WAIT });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) fail(`スマホ幅（375px）で横に ${overflow}px はみ出す`);

    for (const p of problems) fail(p);
    const result = { hash: snap.hash, cases: snap.n, len: snap.len, initial };
    console.log(JSON.stringify(result, null, 2));
    if (update) {
      fs.writeFileSync(EXPECTED, JSON.stringify({ ...result, updatedOn: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) }, null, 2) + "\n");
      console.log("test/expected.json を書き換えた。改修ガイドの「初期条件の目安」と hash も同じ値にする。");
    } else {
      const exp = JSON.parse(fs.readFileSync(EXPECTED, "utf8"));
      if (exp.hash !== result.hash || exp.cases !== result.cases) fail(`hash ${result.hash}（${result.cases}通り）が期待値 ${exp.hash}（${exp.cases}通り）と違う。数値を変えた改修なら、変わり方を確かめてから --update`);
      for (const [k, v] of Object.entries(exp.initial || {})) if (initial[k] !== v) fail(`初期条件の${k} ${initial[k]}（期待値 ${v}）`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(ng ? `\nNG ${ng}` : "\nOK（計算結果・エラーなし・CSP・外部通信なし・スマホ幅）");
  process.exitCode = ng ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
