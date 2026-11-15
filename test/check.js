// データの検査（ブラウザ不要・外部ライブラリなし）。 node test/check.js で実行し、NG 0 なら合格。
// 計算結果そのものの回帰テストは、ブラウザで「AI用/検証用スクリプト.js」を実行して hash を比べる（手順書を参照）。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let ng = 0;
let ok = 0;
const check = (cond, msg) => {
  if (cond) ok++;
  else {
    ng++;
    console.log("NG " + msg);
  }
};

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["data/pay-table.js", "data/promotion-table.js", "data/rules.js", "data/sources.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { PAY_TABLE: P, PROMOTION_TABLE: T, RULES: R, SOURCES: S } = ctx.window;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); // 手元の日付

// ---- 俸給表：145号俸×19列。号俸がない所は null で、各列は上の号俸ほど高い（同額なし）。空欄は列の下の方だけ ----
check(Array.isArray(P) && P.length === 145, `PAY_TABLE の行数 ${P?.length}（145 のはず）`);
P.forEach((row, i) => check(row.length === 19, `PAY_TABLE ${i + 1}号俸の列数 ${row.length}`));
for (let c = 0; c < 19; c++) {
  let seenNull = false;
  let prev = 0;
  for (let g = 0; g < P.length; g++) {
    const v = P[g][c];
    if (v == null) {
      seenNull = true;
      continue;
    }
    check(!seenNull, `PAY_TABLE 列${c} ${g + 1}号俸：空欄のあとに額がある`);
    check(Number.isInteger(v) && v > 100000 && v < 2000000, `PAY_TABLE 列${c} ${g + 1}号俸の額 ${v}`);
    check(v > prev, `PAY_TABLE 列${c} ${g + 1}号俸 ${v} が1つ下の号俸 ${prev} 以下`);
    prev = v;
  }
}
// 同じ号俸なら、上の階級の方が高い（将と将補（1）欄は1〜4号俸が同額。将補（1）欄の5号俸以降は比べない）
for (let g = 0; g < P.length; g++)
  for (let c = 2; c < 18; c++) {
    const [hi, lo] = [P[g][c], P[g][c + 1]];
    if (hi != null && lo != null) check(hi >= lo, `PAY_TABLE ${g + 1}号俸：列${c} ${hi} < 列${c + 1} ${lo}`);
  }

// ---- 昇任の号俸対応表：145行×16列（昇任後の階級 = 列番号2〜17）。行き先の号俸が俸給表にあること ----
check(Array.isArray(T) && T.length === 145, `PROMOTION_TABLE の行数 ${T?.length}`);
T.forEach((row, i) => {
  check(row.length === 16, `PROMOTION_TABLE ${i + 1}行の列数 ${row.length}`);
  row.forEach((v, j) => {
    if (v == null) return;
    check(Number.isInteger(v) && v >= 1 && P[v - 1]?.[j + 2] != null, `PROMOTION_TABLE ${i + 1}行・列${j + 2} → ${v}号俸 が俸給表にない`);
  });
});

// ---- RULES：照合日・賞与の月数のつじつま ----
check(isDate(R.checkedOn) && R.checkedOn <= today, `RULES.checkedOn ${R.checkedOn}`);
const guide = read("AI用/AI向け改修ガイド.md");
check(guide.includes(`最終更新：${R.checkedOn}`), `改修ガイドの「最終更新」が RULES.checkedOn（${R.checkedOn}）と違う`);
const B = R.bonus;
// 期末手当の年間月数 ＝ 一般の1回あたりの割合 × 2回（一般職給与法第19条の4第2項）
check(Math.abs(B.kimatsuPer.normal * 2 - B.kimatsuMonths) < 1e-9, `bonus.kimatsuPer.normal×2（${B.kimatsuPer.normal * 2}）≠ kimatsuMonths（${B.kimatsuMonths}）`);
check(B.kimatsuMonths + B.kinbenMonths > 3 && B.kimatsuMonths + B.kinbenMonths < 6, `賞与の年間月数 ${B.kimatsuMonths + B.kinbenMonths}`);
// 定年は階級ごとにあり、上の階級ほど下がらない
const ranks = ["3曹", "2曹", "1曹", "曹長", "准尉", "3尉", "2尉", "1尉", "3佐", "2佐", "1佐", "将補", "将"];
ranks.forEach((r, i) => {
  const a = R.promotion.retireAge[r];
  check(Number.isInteger(a) && a >= 50 && a <= 65, `promotion.retireAge.${r} ${a}`);
  if (i) check(a >= R.promotion.retireAge[ranks[i - 1]], `定年が ${ranks[i - 1]} より ${r} の方が低い`);
});
// 任官時・候補生の号俸が俸給表にある
for (const [k, c] of Object.entries(R.entry.candidate)) {
  check(P[c.payGrade - 1]?.[c.payCol] != null, `entry.candidate.${k} の候補生の号俸が俸給表にない`);
  check(P[c.grade - 1]?.[c.col] != null, `entry.candidate.${k} の任官時の号俸が俸給表にない`);
}

// ---- 出典の一覧 ----
const lawKeys = new Set(S.laws.map((l) => l.key));
for (const l of S.laws) {
  check(/^https:\/\//.test(l.url), `SOURCES.laws ${l.key} の url`);
  if (l.egovId) check(isDate(l.egovRevision?.promulgated), `SOURCES.laws ${l.key} の egovRevision.promulgated`);
}
for (const it of S.items) {
  check(lawKeys.has(it.law), `SOURCES.items ${it.path} の law「${it.law}」が laws にない`);
  check(isDate(it.checked) && it.checked <= today, `SOURCES.items ${it.path} の checked ${it.checked}`);
}
for (const must of ["PAY_TABLE", "PROMOTION_TABLE"]) check(S.items.some((it) => it.path === must), `SOURCES.items に ${must} がない`);
// RULES の大きな区分は、どれかの出典に載っていること
for (const k of ["promotion", "bonus", "allowances", "retirement", "entry", "youngPension", "afterRetire", "kyosai", "tax"]) {
  if (R[k] !== undefined) check(S.items.some((it) => it.path.startsWith(`RULES.${k}`)), `RULES.${k} の出典が SOURCES.items にない`);
}

// ---- index.html：読み込むファイルがあり、?v= がそろっている。俸給表の公布の表記が画面と一致 ----
const html = read("index.html");
const refs = [...html.matchAll(/(?:src|href)="((?:css|js|data)\/[^"?]+)(?:\?v=([^"]+))?"/g)];
check(refs.length >= 10, `index.html の css/js/data の読み込み ${refs.length} 件`);
const versions = new Set(refs.map((m) => m[2]));
check(versions.size === 1 && !versions.has(undefined), `index.html の ?v= がそろっていない：${[...versions].join(", ")}`);
for (const m of refs) check(fs.existsSync(path.join(ROOT, m[1])), `index.html が読み込む ${m[1]} がない`);
const koufu = read("data/pay-table.js").match(/(\d{4}年\d{1,2}月公布)/)?.[1];
check(!!koufu && html.includes(koufu), `pay-table.js の「${koufu}」が index.html の説明文にない（説明文の直し忘れ）`);
// 外部のスクリプト・スタイルを読み込まない
check(!/<script[^>]+src="https?:/i.test(html), "index.html が外部のスクリプトを読み込んでいる");
check(!/https?:\/\/fonts\.|<link[^>]+rel="preconnect"/.test(html), "index.html が外部のフォントを読み込んでいる");
// CSP：このサイトのファイルだけを読み込む（default-src 'none'）
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] || "";
check(/default-src 'none'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && !/unsafe/.test(csp), `index.html の CSP「${csp}」`);
const inlineScript = [...html.matchAll(/<script([^>]*)>/gi)].some(([, attrs]) => !/ src=/.test(attrs) && !attrs.includes("application/ld+json"));
check(!inlineScript && !/ on[a-z]+="/i.test(html) && !/ style="/i.test(html), "index.html にインラインのスクリプト・イベント属性・style 属性がある（CSP で止まる）");
// 利用者の入力を保存しない（以前の版の保存を消す removeItem だけ許す）
for (const f of fs.readdirSync(path.join(ROOT, "js"))) {
  const src = read("js/" + f);
  check(!/localStorage\.setItem|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/.test(src), `js/${f} が入力を保存・送信している可能性`);
}

console.log(`\nOK ${ok} / NG ${ng}`);
process.exitCode = ng ? 1 : 0;
