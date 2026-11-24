// 2. 退職手当・賞与・退職所得の税の検算：law.js（法令の値を書き写したもの）から独立に計算し、画面と1円以内で一致するか
"use strict";
const LAW = require("../law");
const { Report, yen } = require("../lib/common");
const { openSim } = require("../lib/sim-page");
const { basicMonths } = require("../lib/calc-checks");

const T = LAW.tax;
// 所得税（速算表）
const incomeTax = (t) => {
  const [, r, d] = T.incomeTax.find((b) => t < b[0]);
  return Math.max(0, t * r - d);
};
// 退職所得控除（所得税法第30条）。raw は最低額（80万円）を当てる前の額
const rawDeduction = (n) => {
  const D = T.deduction;
  return n <= D.border ? D.perYear * n : D.base + D.perYearAfter * (n - D.border);
};
const deduction = (n) => Math.max(T.deduction.min, rawDeduction(n));
// 退職所得の税（所得税＋復興特別所得税＋住民税）。勤続5年以下は300万円を超える部分を2分の1にしない
const retireTax = (a, ded, years) => {
  let x = Math.max(0, a - ded);
  x = years <= T.shortService.years && x > T.shortService.half ? T.shortService.half / 2 + (x - T.shortService.half) : x / 2;
  const t = Math.floor(x / 1000) * 1000;
  return Math.floor(incomeTax(t) * (1 + T.surtax)) + Math.floor((t * T.residentRate) / 100) * 100;
};
// 控除額から逆に、受け取った退職手当等に対応する勤続年数（所得税法施行令第70条：前の退職手当等があるときの控除の調整）
const yearsFor = (received) => (received <= T.deduction.base ? Math.floor(received / T.deduction.perYear) : Math.floor((received - T.deduction.base) / T.deduction.perYearAfter) + T.deduction.border);

// 給与所得（所得税法別表第五。2026・2027年分は最低保障74万円（収入220万円未満）、それ以外69万円、2025年分以前65万円）
const salaryIncome = (x, y) => {
  const min = y < 2026 ? 650000 : y <= 2027 && x < 2200000 ? 740000 : 690000,
    f = (v) => (v <= 1625000 ? 550000 : v <= 1800000 ? v * 0.4 - 100000 : v <= 3600000 ? v * 0.3 + 80000 : v <= 6600000 ? v * 0.2 + 440000 : v <= 8500000 ? v * 0.1 + 1100000 : 1950000);
  if (x <= 0) return 0;
  if (f(x) <= min) return Math.max(0, x - min);
  const A = x < 6600000 ? Math.floor(x / 4000) * 4000 : x;
  return Math.floor(A - f(A));
};
// その年の所得税・住民税（給与と、ほかの所得 extra。配偶者・扶養親族なし）
const yearTax = (salary, extra, y) => {
  const g = salaryIncome(salary, y) + extra,
    basic = T.basicByYear.find(([until]) => y <= until)[1].find(([mx]) => g <= mx)[1],
    f1000 = (v) => Math.max(0, Math.floor(v / 1000) * 1000),
    it = Math.floor((incomeTax(f1000(g - basic)) * (1 + T.surtax)) / 100) * 100,
    R = T.resident,
    t = f1000(g - R.basic),
    adj = t <= R.adjBorder ? Math.min(R.diff, t) * R.adjRate : Math.max((R.diff - (t - R.adjBorder)) * R.adjRate, R.adjMin),
    rt = g <= R.exempt ? 0 : Math.max(0, Math.floor((t * T.residentRate - adj) / 100) * 100) + R.kintou;
  return it + rt;
};
// 一時所得（給付金の2回目以降）で増える税：50万円の特別控除の後の2分の1を、その年の給与の所得に加える
const ichijiTax = (amount, salary, y) => yearTax(salary, Math.floor(Math.max(0, amount - T.ichijiSpecial) / 2), y) - yearTax(salary, 0, y);

const rankAddOf = (col) => LAW.bonus.rankAdd.find(([mx]) => col <= mx)?.[1] ?? 0;
// 曹・准尉・尉官・佐官の列番号（俸給表の列）
const COL = { "3曹": 15, "2曹": 14, "1曹": 13, 曹長: 12, 准尉: 11, "3尉": 10, "2尉": 9, "1尉": 8, "3佐": 7, "2佐": 6 };

module.exports = async function verify(env, { quick, log }) {
  const rep = new Report("退職手当・賞与・退職所得の税の検算");
  const h = await openSim(env);
  try {
    // ---- 退職手当の基本額と退職所得の税 ----
    const taxCases = [
      { entryType: "sotsu", targetRank: "1曹", startAge: 18 },
      { entryType: "sotsu", targetRank: "1曹", startAge: 18, reemployIncome: 450 },
      { entryType: "sotsu", targetRank: "2佐", startAge: 18 },
      { entryType: "sotsu", targetRank: "将", startAge: 18, steps: "min" },
      { entryType: "sotsu", targetRank: "3曹", startAge: 35 },
      { entryType: "sotsu", targetRank: "3曹", startAge: 51 },
      { entryType: "sotsu", targetRank: "3曹", startAge: 53 },
      { entryType: "sotsu", targetRank: "1曹", startAge: 30, retireReason: "self" },
      { entryType: "sotsu", targetRank: "1曹", startAge: 16, retireReason: "self" },
      { entryType: "sotsu", targetRank: "将", startAge: 16, retireReason: "self", steps: "min" },
      { entryType: "kanko", targetRank: "1佐", startAge: 22 },
      { entryType: "kankoD", targetRank: "将補", startAge: 26, steps: "min" },
      { entryType: "ninki", ninkiPlan: "sgt", targetRank: "曹長", startAge: 18 },
      ...(quick ? [] : [30, 40, 45, 48, 50].flatMap((a) => [{ entryType: "sotsu", targetRank: "曹長", startAge: a }, { entryType: "sotsu", targetRank: "曹長", startAge: a, retireReason: "self" }])),
    ];
    for (const p of taxCases) {
      const r = await h.run(p);
      rep.cases++;
      if (r.err) {
        rep.add("verifyError", `検算の条件で計算できない：${r.err}`, p);
        continue;
      }
      const rows = Object.fromEntries(r.retireRows.map((c) => [c[0], c]));
      const b = rows["退職手当（基本額）"];
      const n = Number(b?.[2].match(/勤続(\d+)年/)?.[1]);
      if (!b || !Number.isFinite(n)) {
        rep.add("verifyError", "退職手当（基本額）の行が読めない", p);
        continue;
      }
      const P = yen(b[2].split("俸給月額")[1]),
        teinen = /定年退職/.test(b[2]);
      const expBasic = Math.floor(P * basicMonths(n, teinen));
      rep.expect(Math.abs(expBasic - yen(b[1])) <= 1, "basicLaw", `退職手当の基本額：勤続${n}年・${teinen ? "定年" : "自己都合"}・俸給月額${P}円で、画面 ${yen(b[1])}円、検算 ${expBasic}円`, p);
      // 退職所得の税：退職手当と給付金1回目を合わせて課税。2回目以降は、前に受けた額に対応する年数を控除から除く。
      // 任期制から3曹に昇任した場合、任期満了金はその任期の年数の控除で別に課税し、退職手当（表示額）から除いて計算する
      let termTax = 0,
        termSum = 0;
      for (const c of r.retireRows.filter((c) => c[0].startsWith("任期満了金"))) {
        const yrs = Number(c[0].match(/（(\d+)年/)?.[1]);
        termSum += yen(c[1]);
        termTax += retireTax(yen(c[1]), deduction(yrs), yrs);
      }
      const allowance = yen(r.allowanceText) - termSum;
      // 給付金の各回：（支給年月）と、税の区分（説明欄の「税は退職所得／一時所得」）
      const payRows = r.retireRows
        .filter((c) => c[0].startsWith("若年定年退職者給付金 "))
        .map((c) => ({ amount: yen(c[1]), year: Number(c[0].match(/（(\d{4})年/)?.[1]), retire: /税は退職所得/.test(c[2]) }));
      const pays = payRows.map((x) => x.amount);
      // 退職手当と、給付金の1回目（退職所得）。この検算の条件は4月入隊なので退職は3月、1回目は同じ年の4月 → 合わせて1つの控除
      const first = payRows.filter((x) => x.retire).reduce((s, x) => s + x.amount, 0);
      let exp = termTax + retireTax(allowance + first, deduction(n), n);
      // 2回目以降（一時所得）：同じ年の分をまとめて、50万円の特別控除の後の2分の1を再就職の給与の所得に加える
      const salary = (p.reemployIncome || 0) * 10000,
        byYear = new Map();
      for (const x of payRows.filter((x) => !x.retire)) byYear.set(x.year, (byYear.get(x.year) || 0) + x.amount);
      for (const [y, a] of byYear) exp += ichijiTax(a, salary, y);
      const shown = -yen(rows["退職手当・給付金の税（所得税・住民税）"]?.[1]);
      rep.expect(Math.abs(shown - exp) <= 1, "retireTax", `退職所得の税：勤続${n}年・退職手当${allowance}円・給付金${JSON.stringify(pays)}で、画面 ${shown}円、検算 ${exp}円`, p);
    }

    // ---- 任期満了金と、その税（任期ごとに、その任期の年数の控除で課税） ----
    for (const p of [
      { entryType: "ninki", ninkiPlan: "1", targetRank: "1曹", startAge: 18 },
      { entryType: "ninki", ninkiPlan: "2", targetRank: "1曹", startAge: 18, branch: "maritime" },
      { entryType: "ninki", ninkiPlan: "4", targetRank: "1曹", startAge: 20, branch: "air" },
    ]) {
      const r = await h.run(p);
      rep.cases++;
      if (r.err) {
        rep.add("verifyError", `検算の条件で計算できない：${r.err}`, p);
        continue;
      }
      let tax = 0;
      for (const c of r.retireRows.filter((c) => c[0].startsWith("任期満了金"))) {
        const yrs = Number(c[0].match(/（(\d+)年/)?.[1]),
          days = Number(c[0].match(/(\d+)日分/)?.[1]),
          pay = yen(c[2].split("俸給月額")[1]),
          amt = yen(c[1]);
        const exp = Math.floor((pay / 30) * days);
        rep.expect(Math.abs(exp - amt) <= 1, "ninkiTerm", `${c[0]}：画面 ${amt}円、俸給月額${pay}円÷30×${days}日＝${exp}円`, p);
        tax += retireTax(amt, deduction(yrs), yrs);
      }
      const shown = -yen(Object.fromEntries(r.retireRows.map((c) => [c[0], c]))["退職所得の税（所得税・住民税）"]?.[1] ?? Object.fromEntries(r.retireRows.map((c) => [c[0], c]))["退職手当・給付金の税（所得税・住民税）"]?.[1]);
      rep.expect(Math.abs(shown - tax) <= 1, "retireTax", `任期満了金の税：画面 ${shown}円、検算 ${tax}円`, p);
    }

    // ---- 賞与：4月入隊で年の途中に昇任のない年は、6月・12月の俸給＝その年の4〜12月の俸給（1月に昇給）。
    //      期末＝(俸給＋俸給×階級加算)×期末の割合、勤勉＝同×標準の成績率（地域手当などの手当なし）。
    //      入隊（2026年4月）から1年目の行は令和8年度（6月・12月で違う割合）、2年目からは令和9年度以後の割合 ----
    const table = await h.page.evaluate(() => window.PAY_TABLE);
    let bonusRows = 0;
    for (const p of [
      { entryType: "sotsu", targetRank: "1曹", startAge: 18 },
      { entryType: "sotsu", targetRank: "2佐", startAge: 18 },
      { entryType: "sotsu", targetRank: "准尉", startAge: 18 },
      { entryType: "sotsu", targetRank: "3曹", startAge: 30, raise: 6 },
      { entryType: "kanko", targetRank: "2佐", startAge: 22, raise: 2 },
    ]) {
      const r = await h.run(p);
      rep.cases++;
      if (r.err) {
        rep.add("verifyError", `検算の条件で計算できない：${r.err}`, p);
        continue;
      }
      for (const row of r.rows) {
        const m = row[1].match(/^(\S+) (\d+)号俸$/); // 年の途中で昇任しない行だけ
        if (!m || !COL[m[1]]) continue;
        const col = COL[m[1]],
          gEnd = Number(m[2]),
          salary = yen(row[2]);
        const p2 = table[gEnd - 1]?.[col];
        const p1 = (salary - 3 * p2) / 9; // 4〜12月の俸給月額（1〜3月は年末の号俸 p2）
        if (!Number.isInteger(p1) || !table.some((t) => t[col] === p1)) continue; // 教育期間・定年の年など、形が違う行は見ない
        const base = p1 + Math.floor(p1 * rankAddOf(col));
        const yearIndex = Number(row[0].match(/^(\d+)/)[1]) - (p.startAge ?? 18), // 入隊から何年目の行か（0＝令和8年度）
          F = LAW.bonus.upToFy2026,
          exp =
            yearIndex === 0
              ? Math.floor(base * F.kimatsu[0]) + Math.floor(base * F.kinben[0]) + Math.floor(base * F.kimatsu[1]) + Math.floor(base * F.kinben[1])
              : 2 * (Math.floor(base * LAW.bonus.kimatsuPer) + Math.floor(base * LAW.bonus.kinbenStandard));
        bonusRows++;
        rep.expect(Math.abs(yen(row[3]) - exp) <= 1, "bonus", `賞与 ${row[0]}（${row[1]}、6月・12月の俸給${p1}円）：画面 ${yen(row[3])}円、検算 ${exp}円`, p);
      }
    }
    // 検算できた行が少なすぎるときは、画面の形が変わって検算が素通りになっている
    rep.expect(bonusRows >= 40, "verifyCoverage", `賞与を検算できた行が ${bonusRows} 行しかない（40行以上のはず。表の形が変わったなら点検を直す）`);
    rep.notes.push(`賞与を検算した行 ${bonusRows} 行、退職手当・税の検算 ${taxCases.length + 3} 条件`);
    rep.takeProblems(h.problems, "検算");
  } finally {
    await h.close();
  }
  return rep;
};
