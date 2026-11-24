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
for (const f of ["assets/data/pay-table.js", "assets/data/promotion-table.js", "assets/data/rules.js", "assets/data/sources.js"]) {
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
const refs = [...html.matchAll(/(?:src|href)="(assets\/(?:css|js|data)\/[^"?]+)(?:\?v=([^"]+))?"/g)];
check(refs.length >= 10, `index.html の assets の css/js/data の読み込み ${refs.length} 件`);
const versions = new Set(refs.map((m) => m[2]));
check(versions.size === 1 && !versions.has(undefined), `index.html の ?v= がそろっていない：${[...versions].join(", ")}`);
for (const m of refs) check(fs.existsSync(path.join(ROOT, m[1])), `index.html が読み込む ${m[1]} がない`);
const koufu = read("assets/data/pay-table.js").match(/(\d{4}年\d{1,2}月公布)/)?.[1];
check(!!koufu && html.includes(koufu), `pay-table.js の「${koufu}」が index.html の説明文にない（説明文の直し忘れ）`);
// 外部のスクリプト・スタイルを読み込まない
check(!/<script[^>]+src="https?:/i.test(html), "index.html が外部のスクリプトを読み込んでいる");
check(!/https?:\/\/fonts\.|<link[^>]+rel="preconnect"/.test(html), "index.html が外部のフォントを読み込んでいる");
// CSP：このサイトのファイルだけを読み込む（default-src 'none'）
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] || "";
check(/default-src 'none'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && !/unsafe/.test(csp), `index.html の CSP「${csp}」`);
// フォントはこのサイトの assets/fonts/ だけ（font-src は 'self' だけ許す）。画面で使う文字がすべて絞ったフォントに入っているか
check(!/font-src/.test(csp) || /font-src 'self'(;|$)/.test(csp), `index.html の CSP の font-src「${csp}」`);
{
  const have = new Set([...read("assets/fonts/charset.txt").trim()]);
  const files = ["index.html", ...["assets/js", "assets/data", "assets/css"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /.(js|css)$/.test(f)).map((f) => d + "/" + f))];
  const missing = new Set();
  for (const f of files) for (const ch of read(f)) if (ch.codePointAt(0) > 0x7e && !/[�-�]/.test(ch) && !have.has(ch)) missing.add(ch);
  check(missing.size === 0, `フォントに入っていない文字 ${[...missing].join("")}（node tools/font-subset.js でフォントを作り直す）`);
}
const inlineScript = [...html.matchAll(/<script([^>]*)>/gi)].some(([, attrs]) => !/ src=/.test(attrs) && !attrs.includes("application/ld+json"));
check(!inlineScript && !/ on[a-z]+="/i.test(html) && !/ style="/i.test(html), "index.html にインラインのスクリプト・イベント属性・style 属性がある（CSP で止まる）");
// 利用者の入力を保存しない（以前の版の保存を消す removeItem だけ許す）
for (const f of fs.readdirSync(path.join(ROOT, "assets/js"))) {
  const src = read("assets/js/" + f);
  check(!/localStorage\.setItem|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/.test(src), `assets/js/${f} が入力を保存・送信している可能性`);
}

// ---- 月次点検の日付・地域手当の経過措置の年度 ----
check(isDate(S.lastMonthlyCheck) && S.lastMonthlyCheck <= today, `SOURCES.lastMonthlyCheck「${S.lastMonthlyCheck}」が日付の形でないか、今日（${today}）より後`);
for (const p of S.pending || []) check(p.what && /^https:\/\//.test(p.url) && isDate(p.checked) && p.checked <= today, `SOURCES.pending「${p.what?.slice(0, 30)}」の url・checked`);
// 年度（4月〜翌3月）。今日の年度が経過措置の期間内なのに、その年度の表が byFy にないと、前の年度の表で計算してしまう
const fyToday = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
const RT2 = R.allowances.regionalTransition;
if (RT2 && fyToday <= RT2.untilFy)
  check(!!RT2.byFy[fyToday], `地域手当の経過措置：今日は${fyToday}年度（≦ untilFy ${RT2.untilFy}）なのに regionalTransition.byFy に ${fyToday} の表がない（人事院の改正通知で表を足す。assets/data/sources.js の pending を参照）`);

// ---- 回帰テストの期待値（test/expected.json）と改修ガイドの hash・初期条件の目安が同じ ----
const EXP = JSON.parse(read("test/expected.json"));
check(guide.includes(`hash ${EXP.hash}、${EXP.cases}通り`), `改修ガイドの「hash ◯、◯通り」が test/expected.json（hash ${EXP.hash}、${EXP.cases}通り）と違う`);
for (const [k, v] of Object.entries(EXP.initial || {})) check(guide.includes(`${k} **${v}**`), `改修ガイドの初期条件の目安「${k} ${v}」が test/expected.json と違う`);

// ---- 画面の説明文の数値 ＝ RULES ----
// 説明文（index.html・js）に書いた数値が assets/data/rules.js と食い違っていないか。行番号ではなく前後の文言で探す。
// 文言が見つからないもの（説明文を書き換えた）は「注意」として出す（NG にはしない）。見つかって値が違えば NG
const descText = [
  ["index.html", html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")],
  ["index.html（入力欄）", (html.match(/<input[^>]*>/g) || []).join(" ").replace(/\s+/g, " ")],
].concat(fs.readdirSync(path.join(ROOT, "assets/js")).map((f) => ["assets/js/" + f, read("assets/js/" + f)]));
const n = (s) => Number(String(s).replace(/,/g, ""));
const same = (a, b) => Math.abs(a - b) < 1e-6;
const X = R.allowances;
const CR = X.calcRates;
const total = B.kimatsuMonths + B.kinbenMonths;
const r100 = (x) => +(x * 100).toFixed(4);
const mpVals = Object.values(X.managerPay).flatMap((o) => Object.values(o));
const kp = Object.fromEntries(B.kimatsuPeriod);
const K = R.kyosai;
// [説明, 正規表現（g は付けない）, 期待値の配列（かっこの順）]
const DESC = [
  ["賞与の年間月数の例（入力欄の説明）", /金額ではなく月数を入力（例：([\d.]+)）/, [total]],
  ["賞与の年間月数の初期値（入力欄 value）", /id="bonus"[^>]*?value="([\d.]+)"/, [total]],
  ["賞与の年間月数（入力の誤りの案内）", /例：([\d.]+)（0〜12か月）/, [total]],
  ["賞与の年間月数（法律の合計）", /法律の合計（([\d.]+)か月）/, [total]],
  ["賞与の年間月数（法律の「年◯か月」）", /法律の「年([\d.]+)か月」/, [total]],
  ["賞与の年間月数（入力を◯から変える）", /年間月数の入力を([\d.]+)から変える/, [total]],
  ["賞与の年間月数（初期値の目安）", /賞与([\d.]+)か月分の初期値/, [total]],
  ["標準の成績の年間月数（一般）", /一般の自衛官は実際には年([\d.]+)か月分/, [2 * (B.kimatsuPer.normal + B.kinbenStandard.normal)]],
  ["標準の成績の年間月数（一般・計算方法）", /標準の成績の人は一般の自衛官で年([\d.]+)か月/, [2 * (B.kimatsuPer.normal + B.kinbenStandard.normal)]],
  ["標準の成績の年間月数（将・将補（1））", /将・将補（1）欄は年([\d.]+)か月分/, [2 * (B.kimatsuPer.shitei + B.kinbenStandard.shitei)]],
  ["1回あたりの割合（一般）", /一般の自衛官が期末手当([\d.]+)か月・勤勉手当([\d.]+)か月/, [B.kimatsuPer.normal, B.kinbenStandard.normal]],
  ["1回あたりの割合（特定管理職員）", /（特定管理職員）が([\d.]+)か月・([\d.]+)か月/, [B.kimatsuPer.tokutei, B.kinbenStandard.tokutei]],
  ["1回あたりの割合（指定職）", /指定職と同じ扱い）が([\d.]+)か月・([\d.]+)か月/, [B.kimatsuPer.shitei, B.kinbenStandard.shitei]],
  ["階級による加算", /2曹〜2尉(\d+)％、3佐・1尉(\d+)％、2佐・1佐（3）(\d+)％、1佐（1）（2）・将補（2）(\d+)％、将・将補（1）(\d+)％/, [4, 3, 2, 1, 0].map((i) => r100(B.rankAdd[i][1]))],
  ["期末手当の在職期間割合", /3か月未満(\d+)％、3か月以上(\d+)％、5か月以上(\d+)％/, [r100(kp[0]), r100(kp[3]), r100(kp[5])]],
  ["勤勉手当の期間率の範囲", /半月刻みで(\d+)〜(\d+)％/, [r100(B.kinbenPeriod[0]), r100(B.kinbenPeriod[B.kinbenPeriod.length - 1])]],
  ["管理職加算", /一種(\d+)％・二種(\d+)％・三種（加算あり）(\d+)％/, [r100(B.managerAdd[1]), r100(B.managerAdd[2]), r100(B.managerAdd["3a"])]],
  ["管理職加算（将）", /種別にかかわらず(\d+)％/, [r100(B.generalManagerAdd)]],
  ["俸給の特別調整額の範囲", /特別調整額（月額([\d,]+)〜([\d,]+)円）/, [Math.min(...mpVals), Math.max(...mpVals)]],
  ["営外手当の月額", /月額([\d,]+)円を支給し、賞与の計算の基礎/, [X.eigai]],
  ["3佐以上の配置手当の割合", /3佐([\d.]+)％、2佐([\d.]+)％、1佐（3）([\d.]+)％、1佐（2）([\d.]+)％、1佐（1）([\d.]+)％、将補（2）・将([\d.]+)％/, [7, 6, 5, 4, 3, 2].map((c) => r100(X.seniorRate[c]))],
  // 扶養手当：子の額と15歳以後の加算（60歳以上の父母等の分は「更新中」で計算に入れず、説明文にも額を書いていない）
  ["扶養手当（子・加算）", /子1人([\d,]+)円（15歳になった後の4月1日から22歳の年度末までの子は([\d,]+)円を加算）/, [CR.fuyou.child, CR.fuyou.teenAdd]],
  ["住居手当（支給されない家賃）", /家賃が([\d,]+)円以下のため支給されません/, [CR.house.floor]],
  ["住居手当（上限）", /（上限([\d,]+)円）/, [CR.house.base + CR.house.maxAdd]],
  ["住居手当（家賃の下限）", /家賃が月([\d,]+)円を超える場合/, [CR.house.floor]],
  ["単身赴任手当の基本額", /基本 ([\d,]+)円＋距離の加算/, [CR.tanshin.base]],
  ["通勤手当の上限", /上限(\d+)万円/, [CR.commute.cap / 10000]],
  ["通勤手当（自動車等）の最初と最後の区分", /5km未満は([\d,]+)円〜100km以上は([\d,]+)円/, [CR.commute.car[0][1], CR.commute.car[CR.commute.car.length - 1][1]]],
  ["通勤手当（自動車等）の最も短い区分", /最も短い区分の([\d,]+)円/, [CR.commute.car[0][1]]],
  // 広域異動手当の「8％・16％」は rules.js の wideRates の表示にあり、表示と値の一致は tools/egov-check.js values が確かめる
  ["国民年金保険料", /令和8年度は月([\d,]+)円、令和9年度以後は([\d,]+)円/, R.afterRetire.kokuminPremium.map(([, v]) => v)],
  ["退職手当の調整率", /附則第6項の([\d.]+)％/, [r100(R.retirement.adjustFactor)]],
  ["昇給抑制の年齢", /(\d+)歳以降（全階級）/, [R.promotion.restrictAge]],
  ["10〜12月入隊の最初の昇給", /標準の(\d+)号俸を月割り/, [R.promotion.lateEntryRaise]],
  ["住民税の均等割", /均等割([\d,]+)円/, [R.tax.resident.kintou]],
  ["共済掛金の率", /短期([\d.]+)‰・福祉([\d.]+)‰・40〜64歳の介護([\d.]+)‰・子ども・子育て支援金([\d.]+)‰、厚生年金([\d.]+)‰・退職等年金([\d.]+)‰。将は短期([\d.]+)‰・福祉([\d.]+)‰/, [K.short, K.welfare, K.care, K.child, K.pension, K.retire, K.general.short, K.general.welfare].map((v) => +(v * 1000).toFixed(4))],
  ["標準報酬（厚生年金）の下限", /厚生年金・退職等年金は([\d,]+)円〜上限/, [K.pensionStdMin]],
];
let descFound = 0;
for (const [what, re, exp] of DESC) {
  const hits = descText.flatMap(([f, t]) => [...t.matchAll(new RegExp(re.source, "g"))].map((m) => [f, m]));
  if (!hits.length) {
    console.log(`注意 説明文の照合「${what}」：文言 ${re.source.slice(0, 40)}… が見つからない（説明文を書き換えたなら test/check.js の DESC も直す）`);
    continue;
  }
  descFound++;
  for (const [f, m] of hits) {
    const got = m.slice(1).map(n);
    check(got.length === exp.length && got.every((g, i) => same(g, exp[i])), `説明文の数値が RULES と違う：${what}（${f}）「${m[0].slice(0, 80)}」→ ${got.join("・")}、RULES では ${exp.join("・")}`);
  }
}
console.log(`説明文の照合：${DESC.length} 項目のうち ${descFound} 項目の文言が見つかった`);

console.log(`\nOK ${ok} / NG ${ng}`);
process.exitCode = ng ? 1 : 0;
