// 1件の計算結果（画面の数字）のつじつまを調べる。返り値は [{kind, message}]
"use strict";
const LAW = require("../law");
const { yen } = require("./common");

// 退職手当の基本額の支給率（月数）を法令から独立に（国家公務員退職手当法 第3〜6条、附則第6〜8項、平成15年改正法附則第4項）
function basicMonths(n, teinen) {
  const L = LAW.retirement;
  const band = (bands, k) => bands.reduce((s, [a, b, r]) => s + Math.max(0, Math.min(k, b) - a + 1) * r, 0);
  if (teinen || n > L.selfLongYears) {
    const k = Math.min(n, L.teinenMaxYears);
    if (k >= 25) return band(L.art5, k) * L.adjustFactor;
    if (k >= 11) return band(L.art4, k) * L.adjustFactor;
    return band(L.art3, k) * L.adjustFactor;
  }
  const red = L.selfReduction.find(([upto]) => n <= upto)?.[1] ?? 1;
  return Math.min(band(L.art3, n) * red, L.capMonths) * L.adjustFactor;
}

// 内部エラーの文（JavaScript の例外がそのまま出たもの）。日本語の入力の案内は異常にしない
const INTERNAL_ERROR = /計算できませんでした|詳細：|Cannot read|is not a function|is not defined|undefined|NaN|TypeError|ReferenceError|RangeError|Infinity/;

const rowOf = (c) => ({ age: c[0], ranks: c[1], salary: yen(c[2]), bonus: yen(c[3]), allow: yen(c[4]), total: yen(c[5]), ded: yen(c[6]), net: yen(c[7]) });

// p：入力、r：画面の結果、retireAge：階級ごとの定年（サイトの RULES）。
// mustComputeCheck：案内のエラーが出てはいけない入力（若い入隊）で案内が出たら異常にする（格子だけ。乱数は営舎・営外の重なりなど案内が出る組み合わせを含む）
function checkResult(p, r, retireAge, { mustComputeCheck = false } = {}) {
  const issues = [];
  const add = (kind, message) => issues.push({ kind, message });
  if (r.exception) return [{ kind: "exception", message: "点検の操作中に例外：" + r.exception.split("\n")[0] }];
  if (r.err) {
    if (INTERNAL_ERROR.test(r.err)) add("internalError", "内部エラーの文が出た：" + r.err);
    else if (mustComputeCheck && mustCompute(p)) add("unexpectedGuide", "計算できるはずの入力で案内のエラー：" + r.err);
    if (!r.hidden) add("resultShownWithError", "エラーなのに結果欄が表示されたまま");
    return issues;
  }
  if (r.hidden) add("resultHidden", "エラーがないのに結果欄が表示されない");
  const bad = r.resultText.match(/.{0,30}(NaN|undefined|Infinity|null|\[object).{0,30}/);
  if (bad) add("badValue", "結果に NaN・undefined などが出た：" + bad[0]);

  const rows = r.rows.map(rowOf);
  for (const x of rows) {
    for (const k of ["salary", "bonus", "allow", "total", "ded", "net"])
      if (x[k] == null) add("badValue", `${x.age} の行の「${k}」が数字でない`);
    if (x.salary + x.bonus + x.allow !== x.total) add("rowSum", `${x.age}：俸給 ${x.salary}＋賞与 ${x.bonus}＋手当 ${x.allow} ≠ 合計 ${x.total}`);
    if (x.total - x.ded !== x.net) add("rowNet", `${x.age}：合計 ${x.total}−差し引き ${x.ded} ≠ 手取り ${x.net}`);
    for (const k of ["salary", "bonus", "allow", "total", "ded"]) if (x[k] < 0) add("negative", `${x.age} の ${k} が負：${x[k]}`);
    if (x.net < 0) add("negative", `${x.age} の手取りが負：${x.net}`);
  }
  const total = yen(r.totalText),
    allowance = yen(r.allowanceText),
    pension = r.pensionText === "対象外" ? 0 : yen(r.pensionText),
    grossAll = yen(r.grossAllText),
    totalDeductions = yen(r.deductionsText),
    lifetime = yen(r.lifetimeText);
  for (const [k, v] of Object.entries({ total, allowance, pension, grossAll, totalDeductions })) {
    if (v == null) add("badValue", `${k} が数字でない`);
    else if (v < 0) add("negative", `${k} が負：${v}`);
  }
  const sumT = rows.reduce((s, x) => s + x.total, 0);
  if (sumT !== total) add("totalMismatch", `年ごとの合計の和 ${sumT} ≠ 在職中の給与の総額 ${total}`);
  if (grossAll !== total + allowance + pension) add("grossAll", `額面合計 ${grossAll} ≠ 総額 ${total}＋退職手当 ${allowance}＋給付金 ${pension}`);

  // 退職の年齢（予想階級に届かないときは到達階級の定年。任期満了なら満了の年齢）
  const m = r.stickyRank.match(/・([\d.]+)歳で(定年|任期満了)/);
  const ninkiExit = p.entryType === "ninki" && p.ninkiPlan !== "sgt";
  if (!m) add("retireAge", `上部の帯に退職の年齢がない：${r.stickyRank}`);
  else {
    const effAge = Number(m[1]),
      start = Number(r.startAgeNow),
      years = effAge - start;
    if (rows.length !== Math.ceil(years - 1e-9)) add("rowCount", `年ごとの行 ${rows.length} 行 ≠ 在職 ${years} 年（${start}歳〜${effAge}歳）`);
    const shownYears = Number(r.serviceYears.replace(/年$/, ""));
    if (Math.abs(shownYears - Math.round(years * 10) / 10) > 1e-9) add("serviceYears", `勤続年数の表示 ${r.serviceYears} ≠ ${years}年`);
    const target = r.targetNow,
      reached = r.lastRank.split(" ")[0];
    if (!ninkiExit) {
      if (m[2] !== "定年") add("retireAge", `定年まで勤める条件なのに「${m[2]}」`);
      const tAge = retireAge[target];
      if (reached === target) {
        if (effAge !== tAge) add("retireAge", `${target} に届いたのに退職 ${effAge}歳（定年は ${tAge}歳）`);
        if (/届かない/.test(r.detail)) add("reachNote", `${target} に届いたのに「届かない」の注記：${r.detail}`);
      } else {
        if (!/届かない/.test(r.detail)) add("reachNote", `${target} に届かず ${reached} 止まりなのに注記がない`);
        if (effAge > tAge) add("retireAge", `退職 ${effAge}歳が予想階級 ${target} の定年 ${tAge}歳より後`);
        const rAge = retireAge[reached];
        if (rAge != null && effAge < rAge) add("retireAge", `退職 ${effAge}歳が到達階級 ${reached} の定年 ${rAge}歳より前`);
        if (!Object.values(retireAge).includes(effAge)) add("retireAge", `退職 ${effAge}歳がどの階級の定年でもない`);
      }
    } else if (m[2] !== "任期満了") add("retireAge", `任期満了の条件なのに「${m[2]}」`);
  }

  // 退職手当の内訳・生涯の手取り・差し引き
  const rr = Object.fromEntries(r.retireRows.map((c) => [c[0], c]));
  const val = (k) => (rr[k] ? yen(rr[k][1]) : 0);
  const netRetire = val("差し引きの受取額"),
    rtax = -val("退職所得の税（所得税・住民税）"),
    afterRes = -val("退職後に納める住民税（在職中の給与の分）"),
    kok = -val("退職後に納める国民年金保険料"),
    hl = -val("退職後の健康保険料");
  if (!rr["差し引きの受取額"] || !rr["退職所得の税（所得税・住民税）"]) add("retireRows", "退職手当の表に「差し引きの受取額」または「退職所得の税」の行がない");
  const sumNet = rows.reduce((s, x) => s + x.net, 0),
    sumDed = rows.reduce((s, x) => s + x.ded, 0);
  if (sumNet + netRetire - afterRes - kok - hl !== lifetime) add("lifetime", `各年の手取り ${sumNet}＋受取額 ${netRetire}−退職後の負担 ${afterRes + kok + hl} ≠ 生涯の手取り ${lifetime}`);
  if (sumDed + afterRes + kok + hl + rtax !== totalDeductions) add("deductions", `差し引きの内訳の和 ${sumDed + afterRes + kok + hl + rtax} ≠ 差し引きの合計 ${totalDeductions}`);
  if (allowance + pension - rtax !== netRetire) add("retireNet", `退職手当 ${allowance}＋給付金 ${pension}−退職所得の税 ${rtax} ≠ 受取額 ${netRetire}`);
  if (rtax < 0 || afterRes < 0 || kok < 0 || hl < 0) add("negative", "退職所得の税・退職後の負担が負");
  const payments = r.retireRows.filter((c) => /^若年定年退職者給付金 /.test(c[0])).map((c) => yen(c[1]));
  if (payments.some((v) => v == null || v < 0)) add("negative", "若年定年退職者給付金の回ごとの額が負か数字でない");
  if (payments.reduce((a, b) => a + b, 0) !== pension) add("pensionSum", `給付金の回ごとの和 ${payments.reduce((a, b) => a + b, 0)} ≠ 給付金 ${pension}`);
  const terms = r.retireRows.filter((c) => /^任期満了金/.test(c[0])).map((c) => yen(c[1]));
  const parts = terms.reduce((a, b) => a + b, 0) + val("退職手当（基本額）") + val("退職手当（調整額）");
  if (parts !== allowance) add("allowanceParts", `任期満了金・基本額・調整額の和 ${parts} ≠ 退職手当 ${allowance}`);

  // 退職手当の基本額を法令から独立に計算して比べる（1円以内）
  const bRow = rr["退職手当（基本額）"];
  if (bRow) {
    const n = Number(bRow[2].match(/勤続(\d+)年/)?.[1]),
      P = yen(bRow[2].split("俸給月額")[1]),
      teinen = /定年退職/.test(bRow[2]),
      basic = yen(bRow[1]);
    if (!Number.isFinite(n) || P == null) add("retireRows", `退職手当（基本額）の説明が読めない：${bRow[2]}`);
    else {
      const exp = Math.floor(P * basicMonths(n, teinen));
      if (Math.abs(exp - basic) > 1) add("basicLaw", `退職手当の基本額：勤続${n}年・${teinen ? "定年" : "自己都合"}・俸給月額${P}円で、画面 ${basic}円、法令からの検算 ${exp}円`);
    }
  } else if (!ninkiExit) add("retireRows", "退職手当（基本額）の行がない");
  return issues;
}

// 案内のエラーが出てはいけない入力（入隊時の年齢が若く、どの経路でも予想階級の前の階級の定年より前に入隊している）
function mustCompute(p) {
  if (p.entryType === "kankoD" && p.targetRank === "3尉") return false;
  // 高等工科学校の卒業生は陸上自衛官だけ（海・空を選ぶと案内のエラーにする）
  if (p.entryType === "koka" && p.branch && p.branch !== "ground") return false;
  if (p.entryType?.startsWith("kanko") && !["3尉", "2尉", "1尉", "3佐", "2佐", "1佐", "将補", "将"].includes(p.targetRank)) return false;
  return Number(p.startAge) <= 40;
}

module.exports = { checkResult, basicMonths, INTERNAL_ERROR, rowOf };
