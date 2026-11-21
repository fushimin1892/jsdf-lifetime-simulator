// 機能全体の自動点検（ブラウザを自動で動かし、計算・手当・画面の大量のパターンを機械的に試す）。
//   node test/audit/run.js            … 全部（目安 20〜30分）
//   node test/audit/run.js --quick    … 件数を減らした短い版（目安 数分）
//   node test/audit/run.js --only=calc,verify,allowances,screen   … 一部だけ
//
// 結果：test/audit/result.json（git 管理外）と、標準出力の日本語の要約。
// 終了コード：0＝異常なし、1＝異常あり、2＝道具のエラー（Playwright が無い・ページが開けない等）
//
// Playwright が必要（サイトには使わない。テストのときだけ）：
//   npm i --no-save playwright@1.61.0 && npx playwright install chromium
// 別の場所に入れたときは、環境変数 PLAYWRIGHT_MODULE にそのフォルダ（…/node_modules/playwright）を指定する。
// 環境変数 AUDIT_ROOT を指定すると、そのフォルダのサイトを点検する（初期値はこのリポジトリ）。AUDIT_OUT で結果の JSON の置き場所を変えられる。
//
// 点検の中身：
//   calc        計算の大量パターン（格子・乱数）のつじつま、単調性（例外は mono-exceptions.js に理由つき）
//   verify      退職手当・賞与・退職所得の税を law.js の法令の値から独立に計算し、画面と1円以内で一致するか
//   allowances  陸海空の全手当の追加・額×日数と年ごとの手当の欄の増え方・重なりのエラー・共有URLの往復・範囲外の入力
//   screen      画面幅ごとの横のはみ出し、コンソールのエラー・CSP 違反・外部通信、印刷、フォーカスと固定の帯、文字のコントラスト
"use strict";
const fs = require("fs");
const path = require("path");
const { createEnv, ToolError, ROOT, Report } = require("./lib/common");

const SUITES = {
  calc: "./suites/calc",
  verify: "./suites/verify",
  allowances: "./suites/allowances",
  screen: "./suites/screen",
};
const OUT = path.resolve(process.env.AUDIT_OUT || path.join(__dirname, "result.json"));
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const names = only.length ? only : Object.keys(SUITES);
const MAX_EXAMPLES = 20; // 要約に出す例の数（種類ごと）

const log = (m) => console.log(m);
const sec = (ms) => Math.round(ms / 100) / 10;

(async () => {
  for (const n of names) if (!SUITES[n]) throw new ToolError(`--only の「${n}」はない（${Object.keys(SUITES).join(",")}）`);
  const started = new Date();
  log(`自動点検 ${quick ? "（--quick）" : "（全部）"}：${ROOT}`);
  const env = await createEnv();
  // 途中で止まったら気づけるように、全体を打ち切る（全部 90分、--quick 20分）
  const killer = setTimeout(
    () => {
      console.error("道具のエラー：時間内に終わらない（ページが応答しない）");
      process.exit(2);
    },
    (quick ? 20 : 90) * 60 * 1000,
  );
  killer.unref();
  const suites = [];
  try {
    for (const n of names) {
      const t0 = Date.now();
      log(`\n■ ${n}`);
      let rep;
      try {
        rep = await require(SUITES[n])(env, { quick, log });
      } catch (e) {
        // 点検の途中で止まった（画面の要素が見つからない・ページが応答しない等）。サイトが壊れたときにも起きるので、異常として数える
        if (e instanceof ToolError) throw e;
        rep = new Report(n);
        rep.add("suiteError", `点検の途中で止まった：${String((e && e.message) || e).split("\n")[0]}`);
        log("  点検の途中で止まった：" + ((e && e.stack) || e));
      }
      rep.name = n;
      rep.seconds = sec(Date.now() - t0);
      suites.push(rep);
      log(`  → ${rep.cases}件・確認 ${rep.checks}か所・異常 ${rep.anomalies.length}件（${rep.seconds}秒）`);
    }
  } finally {
    await env.close();
  }

  const total = suites.reduce((s, r) => s + r.anomalies.length, 0);
  const result = {
    ok: total === 0,
    quick,
    root: ROOT,
    startedAt: started.toISOString(),
    seconds: sec(Date.now() - started),
    anomalyCount: total,
    suites: suites.map((r) => {
      const byKind = {};
      for (const a of r.anomalies) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
      return {
        name: r.name,
        title: r.suite,
        seconds: r.seconds,
        cases: r.cases,
        checks: r.checks,
        anomalyCount: r.anomalies.length,
        byKind,
        notes: r.notes,
        guides: r.guides,
        excluded: r.excluded || [],
        anomalies: r.anomalies,
      };
    }),
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

  // 日本語の要約
  log("\n==== 要約 ====");
  for (const s of result.suites) {
    log(`\n【${s.title}】${s.cases}件・確認 ${s.checks}か所・異常 ${s.anomalyCount}件（${s.seconds}秒）`);
    for (const n of s.notes) log(`  ・${n}`);
    if (s.excluded.length) log(`  ・除外リストに当たった単調性の破れ ${s.excluded.length}件（異常にしない。理由は result.json の excluded）`);
    const kinds = Object.entries(s.byKind);
    for (const [k, n] of kinds) {
      log(`  ✗ ${k}：${n}件`);
      for (const a of s.anomalies.filter((a) => a.kind === k).slice(0, kinds.length > 3 ? 3 : MAX_EXAMPLES))
        log(`      - ${a.message}${a.input ? `  入力：${JSON.stringify(a.input).slice(0, 300)}` : ""}`);
    }
  }
  log(`\n${total ? `NG 異常 ${total}件` : "OK 異常なし"}（${result.seconds}秒）。詳細：${path.relative(process.cwd(), OUT) || OUT}`);
  process.exitCode = total ? 1 : 0;
})().catch((e) => {
  console.error("道具のエラー：" + (e instanceof ToolError ? e.message : (e && e.stack) || e));
  process.exitCode = 2;
});
