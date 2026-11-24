// e-Gov 法令API（v2）で、法令の最終改正日と俸給表（防衛省給与法 別表第二）を確かめる道具。
// 外部ライブラリは使わない（Node.js 18 以上の fetch だけ）。サイトには配信しない。
//
//   node tools/egov-check.js            … assets/data/sources.js の各法令について、e-Gov の最終改正（公布日）を
//                                         記録（egovRevision）と比べ、変わっていれば「要確認」と出す
//   node tools/egov-check.js paytable   … e-Gov の別表第二（自衛官俸給表）を全欄読み、assets/data/pay-table.js と照合する
//   node tools/egov-check.js promotion  … e-Gov の施行令 別表第一ロ（昇任後の号俸）を assets/data/promotion-table.js と照合する
//   node tools/egov-check.js values     … assets/data/rules.js の手当・賞与・定年・退職手当・若年給付金の数値を、条文の文言と照合する
//                                         （一覧は tools/value-checks.js。区分と値を組で、前後に数字が続かない形で照合する。
//                                          e-Gov にない値は最後に「人が確かめる一覧」として出す）
//   node tools/egov-check.js all        … 上の4つ（改正日・俸給表・昇任表・数値）を全部
//   node tools/egov-check.js paytable --xml <保存したXML>  … ネットにつながず、保存済みの本文で照合する（promotion も同じ）
//   node tools/egov-check.js values --cache <フォルダ>     … 取った本文をフォルダに保存し、次からはそれを使う
//
// 終了コード：0 一致・記録どおり／1 NG・要確認あり／2 道具のエラー（取得の失敗で止まった場合を含む）／3 取得できない法令があった。
// 2 と 3 は「照合を終えていない」ので、データを変えず、lastMonthlyCheck も更新しない（手順書を参照）。
//
// e-Gov の本文は施行済みの版。改正法が公布されても施行日（さかのぼり適用でも公布日の施行が多い）までは
// 古い表が返るので、公布直後は官報・防衛省の新旧対照表と照合する（手順書を参照）。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const API = "https://laws.e-gov.go.jp/api/2";

function loadData(file) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
  return ctx.window;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// 全角数字・カンマを半角の数に。数でなければ null
const toNum = (s) => {
  const z = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[,，円\s]/g, "");
  return /^\d+$/.test(z) ? Number(z) : null;
};

// 別表第二（自衛官俸給表）を [号俸−1][列] の形で読む。列の並びは assets/data/pay-table.js と同じ（将〜2士の19列）
function parsePayTable(xml) {
  const tables = [...xml.matchAll(/<AppdxTable[\s\S]*?<\/AppdxTable>/g)].map((m) => m[0]);
  const t = tables.find((s) => /<RelatedArticleNum>[^<]*自衛官俸給表/.test(s.slice(0, 1000)));
  if (!t) throw new Error("別表第二（自衛官俸給表）が見つからない");
  const rows = [...t.matchAll(/<TableRow>([\s\S]*?)<\/TableRow>/g)].map((m) =>
    [...m[1].matchAll(/<TableColumn[^>]*>([\s\S]*?)<\/TableColumn>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()),
  );
  // 表は号俸の行が何度かに分けて載る（列のまとまりごと）。号俸ごとに左から順に額をつなげる
  const byGrade = new Map();
  for (const r of rows) {
    const n = r.map(toNum);
    const gi = n.findIndex((v) => v != null && v <= 200);
    if (gi < 0 || !r.slice(gi + 1).some((s) => toNum(s) > 1000)) continue;
    const vals = r.slice(gi + 1).map((s) => (toNum(s) > 1000 ? toNum(s) : null));
    const g = n[gi];
    if (!byGrade.has(g)) byGrade.set(g, []);
    byGrade.get(g).push(vals);
  }
  return { byGrade, rowCount: rows.length };
}

async function checkPayTable(xmlPath) {
  let xml;
  if (xmlPath) xml = fs.readFileSync(xmlPath, "utf8");
  else {
    const j = await getJson(`${API}/law_data/327AC0000000266?law_full_text_format=xml&response_format=json`);
    xml = Buffer.from(j.law_full_text, "base64").toString("utf8");
    const ri = j.revision_info || {};
    console.log(`e-Gov の版：${ri.law_revision_id}（施行 ${ri.amendment_enforcement_date}、改正法 ${ri.amendment_law_title}）`);
  }
  const P = loadData("assets/data/pay-table.js").PAY_TABLE;
  const { byGrade } = parsePayTable(xml);
  let diff = 0;
  let cells = 0;
  for (let g = 1; g <= P.length; g++) {
    // 号俸ごとに、まとまりをつないだ19列（空欄は null）をつくる
    const got = (byGrade.get(g) || []).flat();
    const exp = P[g - 1];
    const a = exp.filter((v) => v != null);
    const b = got.filter((v) => v != null);
    cells += a.length;
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      diff++;
      if (diff <= 5) console.log(`  ${g}号俸 差あり\n    データ：${a.join(",")}\n    e-Gov ：${b.join(",")}`);
    }
  }
  const extra = [...byGrade.keys()].filter((g) => g > P.length);
  console.log(`照合した欄：${cells}、差のある号俸：${diff}、データにない号俸：${extra.length ? extra.join(",") : "なし"}`);
  return diff === 0 && extra.length === 0;
}

// 施行令 別表第一ロ（昇任後の号俸）を assets/data/promotion-table.js と照合する
async function checkPromotion(xmlPath) {
  let xml;
  if (xmlPath) xml = fs.readFileSync(xmlPath, "utf8");
  else {
    const j = await getJson(`${API}/law_data/327CO0000000368?law_full_text_format=xml&response_format=json`);
    xml = Buffer.from(j.law_full_text, "base64").toString("utf8");
    const ri = j.revision_info || {};
    console.log(`e-Gov の版：${ri.law_revision_id}（施行 ${ri.amendment_enforcement_date}）`);
  }
  const appdx = [...xml.matchAll(/<AppdxTable[\s\S]*?<\/AppdxTable>/g)].map((m) => m[0]).find((s) => /別表第一\s*（第六条の六関係）/.test(s.slice(0, 800).replace(/<[^>]+>/g, " ")));
  if (!appdx) throw new Error("施行令 別表第一 が見つからない");
  const struct = [...appdx.matchAll(/<TableStruct>[\s\S]*?<\/TableStruct>/g)].map((m) => m[0]).find((s) => s.includes("昇任をした日の前日"));
  if (!struct) throw new Error("別表第一ロ（昇任）が見つからない");
  const rows = [...struct.matchAll(/<TableRow>([\s\S]*?)<\/TableRow>/g)]
    .map((m) => [...m[1].matchAll(/<TableColumn[^>]*>([\s\S]*?)<\/TableColumn>/g)].map((c) => toNum(c[1].replace(/<[^>]+>/g, "").trim())))
    .filter((r) => r.length === 17 && r[0] != null);
  const T = loadData("assets/data/promotion-table.js").PROMOTION_TABLE;
  let diff = 0;
  for (const r of rows) {
    const exp = T[r[0] - 1] || [];
    const got = r.slice(1);
    if (exp.length !== got.length || exp.some((v, i) => (v ?? null) !== got[i])) {
      diff++;
      if (diff <= 5) console.log(`  ${r[0]}号俸 差あり\n    データ：${exp.join(",")}\n    e-Gov ：${got.join(",")}`);
    }
  }
  console.log(`照合した行：${rows.length}（データ ${T.length} 行）、差のある行：${diff}`);
  return diff === 0 && rows.length === T.length;
}

// 法令の本文（XML）を取る。--cache <フォルダ> があれば <egovId>.xml をそこから読み、なければ取ってそこへ保存する
const xmlCache = new Map();
async function lawXml(egovId, cacheDir) {
  if (xmlCache.has(egovId)) return xmlCache.get(egovId);
  const file = cacheDir && path.join(cacheDir, egovId + ".xml");
  let xml;
  if (file && fs.existsSync(file)) xml = fs.readFileSync(file, "utf8");
  else {
    const j = await getJson(`${API}/law_data/${egovId}?law_full_text_format=xml&response_format=json`);
    xml = Buffer.from(j.law_full_text, "base64").toString("utf8");
    if (file) fs.writeFileSync(file, xml);
  }
  xmlCache.set(egovId, xml);
  return xml;
}
// spaced：表のセルの区切りを空白1つで残す（表の行を正規表現で確かめるとき）
const plain = (s, spaced) =>
  spaced
    ? s.replace(/<Rt>[\s\S]*?<\/Rt>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : s.replace(/<Rt>[\s\S]*?<\/Rt>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "");
// 条（Num）・別表（「別表第四」など）・附則の本文を、タグを外した文字列で返す。
//   "附則"                       … 制定時の附則（改正法の附則は含まない）
//   "附則(平成一五年六月四日法律第六二号)" … その改正法の附則（e-Gov の AmendLawNum の文字列）
//   "*"                          … 法令全体（照合を甘くするので value-checks.js では使わない）
function scope(xml, article, spaced) {
  if (article === "*") return plain(xml, spaced);
  const sup = article.match(/^附則(?:\((.+)\))?$/);
  if (sup) {
    const parts = [...xml.matchAll(/<SupplProvision( [^>]*)?>[\s\S]*?<\/SupplProvision>/g)].filter((m) => (sup[1] ? (m[1] || "").includes(`AmendLawNum="${sup[1]}"`) : !/AmendLawNum/.test(m[1] || "")));
    return parts.length ? parts.map((m) => plain(m[0], spaced)).join(" ") : null;
  }
  if (article.startsWith("別表")) {
    const t = [...xml.matchAll(/<AppdxTable[\s\S]*?<\/AppdxTable>/g)].map((m) => m[0]).find((s) => plain(s.slice(0, 400)).startsWith(article + "（") || plain(s.slice(0, 400)).startsWith(article));
    return t ? plain(t, spaced) : null;
  }
  // 本則の条（附則に同じ番号の条があっても、最初に出てくる本則のものを使う）
  const a = xml.indexOf(`<Article Num="${article}">`);
  return a < 0 ? null : plain(xml.slice(a, xml.indexOf("</Article>", a)), spaced);
}

// 人事院規則9-49 別表第一（「茨城県 一 次の各号に掲げる地域以外の地域 五級地 二 つくば市 二級地 …」）を読み、
// data の regionalAreas（都道府県の割合 rate と市の割合 cities）と両方向に比べる。空港の区域（第4条）は比べない
function compareRegional(spaced, { areas, gradeRate }) {
  const KN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
  const prefs = Object.keys(areas);
  const body = spaced.replace(/^.*?支給地域 級地 /, "");
  const tokens = body.split(" ");
  const law = {};
  let pref = null;
  let names = [];
  for (const tk of tokens) {
    if (prefs.includes(tk)) {
      pref = tk;
      law[pref] = {};
      names = [];
      continue;
    }
    if (!pref) continue;
    const m = tk.match(/^([一二三四五六七])級地$/);
    if (m) {
      const rate = gradeRate[KN[m[1]]];
      if (!names.length) law[pref]._rest = rate;
      for (const n of names) law[pref][n] = rate;
      names = [];
      continue;
    }
    if (/^[一二三四五六七八九十]+$/.test(tk)) continue; // 号の番号
    if (/地域以外の地域$/.test(tk)) {
      names.push("_rest");
      continue;
    }
    names.push(tk);
  }
  const errs = [];
  for (const p of prefs) {
    const d = areas[p];
    const l = law[p] || {};
    const lawRest = l._rest ?? 0;
    if (d.rate !== lawRest) errs.push(`${p}（下記以外の地域）：data ${d.rate}％ ／ 規則 ${lawRest}％`);
    const dc = Object.fromEntries((d.cities || []).filter(([n]) => !/空港/.test(n)));
    for (const [n, r] of Object.entries(dc)) if (l[n] !== r) errs.push(`${p} ${n}：data ${r}％ ／ 規則 ${l[n] ?? "載っていない"}`);
    for (const [n, r] of Object.entries(l)) if (n !== "_rest" && !(n in dc)) errs.push(`${p} ${n}：規則 ${r}％ ／ data に載っていない`);
  }
  for (const p of Object.keys(law)) if (!prefs.includes(p)) errs.push(`${p}：規則にあるが data にない`);
  return errs;
}

async function checkValues(cacheDir) {
  const W = loadData("assets/data/rules.js");
  const S = loadData("assets/data/sources.js").SOURCES;
  const { build, manual, P } = require("./value-checks.js");
  const laws = Object.fromEntries(S.laws.map((l) => [l.key, l]));
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  let ng = 0;
  let ok = 0;
  let words = 0; // 照合した文言・組の数（1件に複数あることがある）
  const byArea = {};
  for (const c of build(W.RULES, W)) {
    words += c.fail ? 0 : c.regional ? 1 : c.expect.reduce((n, e) => n + (e.seq ? e.seq.length : 1), 0);
    if (c.fail) {
      ng++;
      console.log(`NG [${c.area}] ${c.what}`);
      continue;
    }
    const law = laws[c.law];
    let text = null;
    let spaced = null;
    try {
      const xml = await lawXml(law.egovId, cacheDir);
      text = scope(xml, c.article);
      spaced = scope(xml, c.article, true);
    } catch (e) {
      if (!fetchFailed.has(law.title)) console.log(`★取得失敗 ${law.title}：${e.message}`);
      fetchFailed.add(law.title);
    }
    const where = `${law.title} ${c.article === "*" ? "（全体）" : /^(別表|附則)/.test(c.article) ? c.article : "第" + c.article.replace(/_/g, "条の").replace(/^(\d+)$/, "$1") + (c.article.includes("_") ? "" : "条")}`;
    if (c.regional) {
      const errs = text == null ? ["別表第一が見つからない"] : compareRegional(spaced, c.regional);
      byArea[c.area] = byArea[c.area] || { ok: 0, ng: 0 };
      if (errs.length) {
        ng++;
        byArea[c.area].ng++;
        console.log(`NG [${c.area}] ${c.what}：\n  ${errs.join("\n  ")}`);
      } else {
        ok++;
        byArea[c.area].ok++;
      }
      continue;
    }
    // 照合は表のセル・号の区切りを空白で残した本文（spaced）で行う。
    // row：別表の中で、その手当名から次の手当名までの範囲
    const rowText = (name) => {
      const i = spaced.indexOf(name);
      if (i < 0) return "";
      const others = Object.keys(W.RULES.allowances.specialRates).concat(["駐留軍関係業務手当", "備考"]).filter((n) => n !== "小笠原手当").filter((n) => n !== name);
      const ends = others.map((n) => spaced.indexOf(n, i + name.length)).filter((j) => j > i);
      return spaced.slice(i, ends.length ? Math.min(...ends) : undefined);
    };
    // 文字列は前後に数字が続かない所だけ（P で境界つきの正規表現にする）。seq は書いた順に出てくること
    const toRe = (e) => (typeof e === "string" ? P(e) : e instanceof RegExp ? e : e.spaced);
    const findFrom = (hay, e, from) => {
      const re = new RegExp(toRe(e).source, "g");
      re.lastIndex = from;
      const m = re.exec(hay);
      return m ? m.index + m[0].length : -1;
    };
    const label = (e) => (typeof e === "string" ? e : String(toRe(e)).replace(/\(\?<!\[[^\]]*\]\)|\(\?!\[[^\]]*\]\)| \?/g, ""));
    // 見つからなかったもの（なければ空）を返す
    const miss = (e) => {
      const hay = e.row ? rowText(e.row) : spaced;
      const items = e.seq || [e.row ? e.text : e];
      let pos = 0;
      for (const it of items) {
        const p = findFrom(hay, it, pos);
        if (p < 0) return (e.row ? `${e.row}の行に` : "") + label(it) + (e.seq && pos ? "（この並びで）" : "");
        pos = p;
      }
      return "";
    };
    const missing = text == null ? ["（条・表が見つからない）"] : c.expect.map(miss).filter(Boolean);
    byArea[c.area] = byArea[c.area] || { ok: 0, ng: 0 };
    if (missing.length) {
      ng++;
      byArea[c.area].ng++;
      console.log(`NG [${c.area}] ${c.what}：${where} に「${missing.join("」「")}」がない`);
    } else {
      ok++;
      byArea[c.area].ok++;
    }
  }
  console.log("\n区分ごとの結果：" + Object.entries(byArea).map(([k, v]) => `${k} ${v.ok}件一致${v.ng ? `・${v.ng}件NG` : ""}`).join("、"));
  console.log(`合計：一致 ${ok} 件 / NG ${ng} 件（照合した文言・区分と値の組 ${words} 個）`);
  console.log("\ne-Gov で確かめられない値（毎月、公表資料で確かめる）：");
  for (const [area, what, src] of manual) console.log(`- [${area}] ${what} … ${src}`);
  return ng === 0;
}

// 取れなかった法令（ネットワーク・e-Gov の障害など）。改正の「要確認」とは分け、最後に終了コード 3 で知らせる
const fetchFailed = new Set();

async function checkRevisions() {
  const S = loadData("assets/data/sources.js").SOURCES;
  let changed = 0;
  let failed = 0;
  for (const law of S.laws) {
    if (!law.egovId) {
      console.log(`- ${law.title}：e-Gov にないので手で確認（${law.url}）`);
      continue;
    }
    try {
      const j = await getJson(`${API}/law_revisions/${law.egovId}?response_format=json`);
      const revs = (j.revisions || []).filter((r) => r.amendment_promulgate_date);
      revs.sort((x, y) => (x.amendment_promulgate_date < y.amendment_promulgate_date ? 1 : -1));
      const latest = revs[0];
      if (!latest) throw new Error("改正の一覧が空");
      const same = latest.amendment_promulgate_date === law.egovRevision?.promulgated;
      if (!same) changed++;
      console.log(
        `${same ? "  変化なし" : "★要確認"} ${law.title}：e-Gov の最新の改正 ${latest.amendment_promulgate_date}公布・${latest.amendment_enforcement_date}施行「${latest.amendment_law_title}」` +
          (same ? "" : `（記録は ${law.egovRevision?.promulgated ?? "なし"}）`),
      );
    } catch (e) {
      failed++;
      fetchFailed.add(law.title);
      console.log(`★取得失敗 ${law.title}：${e.message}`);
    }
  }
  console.log("");
  if (changed) console.log(`★要確認 ${changed} 件。改正の中身を読み、数値に関係があれば data を直す。関係がなければ assets/data/sources.js の egovRevision だけ更新する。`);
  if (failed) console.log(`★取得失敗 ${failed} 件。改正があったかどうか分からない（要確認とは別）。時間をおいてやり直す。取れるまで data も lastMonthlyCheck も変えない。`);
  if (!changed && !failed) console.log("すべて記録どおり。");
  return changed === 0 && failed === 0;
}

(async () => {
  const [cmd, opt, file] = process.argv.slice(2);
  const xmlPath = opt === "--xml" ? file : null;
  const cacheDir = opt === "--cache" ? file : null;
  const ok =
    cmd === "paytable"
      ? await checkPayTable(xmlPath)
      : cmd === "promotion"
        ? await checkPromotion(xmlPath)
        : cmd === "values"
          ? await checkValues(cacheDir)
          : cmd === "all"
            ? [await checkRevisions(), await checkPayTable(null), await checkPromotion(null), await checkValues(cacheDir)].every(Boolean)
            : await checkRevisions();
  // 終了コード：0 すべて一致・記録どおり、1 NG または要確認あり、2 道具のエラー、3 取得できない法令があった（照合を終えていない）
  if (fetchFailed.size) console.log(`\n★取得失敗の法令 ${fetchFailed.size} 件（${[...fetchFailed].join("、")}）：照合を終えられていない（終了コード 3）`);
  process.exitCode = fetchFailed.size ? 3 : ok ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
