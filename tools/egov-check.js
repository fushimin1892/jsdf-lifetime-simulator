// e-Gov 法令API（v2）で、法令の最終改正日と俸給表（防衛省給与法 別表第二）を確かめる道具。
// 外部ライブラリは使わない（Node.js 18 以上の fetch だけ）。サイトには配信しない。
//
//   node tools/egov-check.js            … data/sources.js の各法令について、e-Gov の最終改正（公布日）を
//                                         記録（egovRevision）と比べ、変わっていれば「要確認」と出す
//   node tools/egov-check.js paytable   … e-Gov の別表第二（自衛官俸給表）を全欄読み、data/pay-table.js と照合する
//   node tools/egov-check.js promotion  … e-Gov の施行令 別表第一ロ（昇任後の号俸）を data/promotion-table.js と照合する
//   node tools/egov-check.js paytable --xml <保存したXML>  … ネットにつながず、保存済みの本文で照合する（promotion も同じ）
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

// 別表第二（自衛官俸給表）を [号俸−1][列] の形で読む。列の並びは data/pay-table.js と同じ（将〜2士の19列）
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
  const P = loadData("data/pay-table.js").PAY_TABLE;
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

// 施行令 別表第一ロ（昇任後の号俸）を data/promotion-table.js と照合する
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
  const T = loadData("data/promotion-table.js").PROMOTION_TABLE;
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

async function checkRevisions() {
  const S = loadData("data/sources.js").SOURCES;
  let changed = 0;
  for (const law of S.laws) {
    if (!law.egovId) {
      console.log(`- ${law.title}：e-Gov にないので手で確認（${law.url}）`);
      continue;
    }
    try {
      const j = await getJson(`${API}/law_revisions/${law.egovId}?response_format=json`);
      const revs = (j.revisions || []).filter((r) => r.amendment_promulgate_date);
      revs.sort((x, y) => (x.amendment_promulgate_date < y.amendment_promulgate_date ? 1 : -1));
      const latest = revs[0] || {};
      const same = latest.amendment_promulgate_date === law.egovRevision?.promulgated;
      if (!same) changed++;
      console.log(
        `${same ? "  変化なし" : "★要確認"} ${law.title}：e-Gov の最新の改正 ${latest.amendment_promulgate_date}公布・${latest.amendment_enforcement_date}施行「${latest.amendment_law_title}」` +
          (same ? "" : `（記録は ${law.egovRevision?.promulgated ?? "なし"}）`),
      );
    } catch (e) {
      changed++;
      console.log(`★取得失敗 ${law.title}：${e.message}`);
    }
  }
  console.log(changed ? `\n要確認 ${changed} 件。改正の中身を読み、数値に関係があれば data を直す。関係がなければ data/sources.js の egovRevision だけ更新する。` : "\nすべて記録どおり。");
  return changed === 0;
}

(async () => {
  const [cmd, opt, file] = process.argv.slice(2);
  const xmlPath = opt === "--xml" ? file : null;
  const ok =
    cmd === "paytable" ? await checkPayTable(xmlPath) : cmd === "promotion" ? await checkPromotion(xmlPath) : await checkRevisions();
  process.exitCode = ok ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
