// 1. 計算の大量パターン：入隊区分×所属×予想階級×入隊時の年齢×昇任期間×退職理由の格子、乱数の組み合わせ、単調性
"use strict";
const { Report, yen } = require("../lib/common");
const { openSim } = require("../lib/sim-page");
const { checkResult } = require("../lib/calc-checks");
const MONO_EXCEPTIONS = require("../mono-exceptions");

const ENLISTED = ["3曹", "2曹", "1曹", "曹長", "准尉"];
const OFFICER = ["3尉", "2尉", "1尉", "3佐", "2佐", "1佐", "将補", "将"];
const RANKS = [...ENLISTED, ...OFFICER];
const BRANCHES = ["ground", "maritime", "air"];

// 決まった種の乱数（毎回同じ組み合わせになる）
function rng(seed) {
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return { r, pick: (a) => a[Math.floor(r() * a.length)], int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)) };
}

// 格子：全部なら約17,000通り。--quick は所属を順番に1つ、入隊時の年齢を9通り、退職理由を交互にして約1,000通り
function gridCases(quick, retireAge) {
  const cases = [];
  const AGES = quick ? [16, 18, 22, 30, 36, 45, 53, 55, 59] : [16, 17, 18, 20, 22, 24, 26, 30, 33, 35, 36, 38, 40, 45, 50, 53, 54, 55, 56, 57, 59];
  for (const entryType of ["sotsu", "ninki", "kanko", "kankoM", "kankoD"])
    for (const branch of BRANCHES) {
      let k = 0; // --quick：所属の外側の組み合わせの通し番号（所属ごとに同じ並び）で、所属と退職理由を1つずつ選ぶ
      const plans = entryType === "ninki" ? ["1", "2", "3", "4", "sgt"] : [null];
      for (const ninkiPlan of plans) {
        const exit = ninkiPlan && ninkiPlan !== "sgt";
        const ranks = entryType.startsWith("kanko") ? OFFICER.filter((r) => !(entryType === "kankoD" && r === "3尉")) : exit ? ["1曹"] : RANKS;
        for (const targetRank of ranks)
          for (const startAge of AGES) {
            if (!exit && startAge >= retireAge[targetRank]) continue; // 定年以上の入隊は入力の範囲外（案内が出る）
            for (const steps of exit ? ["def"] : ["min", "max", "def"]) {
              k++;
              for (const retireReason of ["teinen", "self"]) {
                if (quick && (BRANCHES[k % 3] !== branch || ["teinen", "self"][Math.floor(k / 3) % 2] !== retireReason)) continue;
                cases.push({ set: "grid", entryType, branch, ninkiPlan, targetRank, startAge, steps, retireReason });
              }
            }
          }
      }
    }
  return cases;
}

// 乱数：入隊の年月・昇給・賞与・管理職・1佐の欄・将の号俸・2士の号俸・扶養・再就職・退職後の保険などもまぜる
function randomCases(n, retireAge, stepInfo) {
  const R = rng(20261116);
  const cases = [];
  for (let i = 0; i < n; i++) {
    const entryType = R.pick(["sotsu", "sotsu", "ninki", "kanko", "kankoM", "kankoD"]);
    const ninkiPlan = entryType === "ninki" ? R.pick(["1", "2", "3", "4", "sgt", "sgt"]) : null;
    let ranks = entryType.startsWith("kanko") ? OFFICER : RANKS;
    if (entryType === "kankoD") ranks = ranks.filter((r) => r !== "3尉");
    const targetRank = R.pick(ranks);
    const maxAge = ninkiPlan && ninkiPlan !== "sgt" ? 50 : retireAge[targetRank] - 1;
    const steps = {};
    for (const [id, inf] of Object.entries(stepInfo)) steps[id] = R.r() < 0.5 ? "def" : R.pick(inf.options);
    const afterHealth = R.pick(["none", "nini", "kokuho"]);
    cases.push({
      set: "random",
      entryType,
      branch: R.pick(BRANCHES),
      ninkiPlan,
      targetRank,
      startAge: R.int(16, maxAge),
      entryMonth: R.int(1, 12),
      entryYear: R.int(2000, 2060),
      raise: R.int(0, 20),
      bonus: (R.int(0, 1200) / 100).toFixed(2),
      manager: R.pick(["none", "1", "2", "3a", "3", "4"]),
      colClass: R.pick(["3", "4", "5"]),
      generalGrade: R.int(1, 8),
      initialGrade: R.int(1, 17),
      retireReason: R.pick(["teinen", "self"]),
      reemployIncome: R.pick([0, 200, 450, 650, 800, 1500, 5000]),
      spouse: R.pick(["no", "yes"]),
      dependents: R.int(0, 3),
      specificDependents: R.int(0, 2),
      eigaiStart: R.pick(["none", "none", "sergeant", "1", "3", "10"]),
      barracksYears: R.pick(["0", "0", "0", "1", "3"]),
      afterPension: R.pick(["employee", "kokumin", "exempt"]),
      afterHealth,
      afterHealthYen: afterHealth === "none" ? 0 : R.pick([0, 15.5, 40, 200]),
      afterHealthYears: R.int(0, 30),
      steps,
    });
  }
  return cases;
}

const brief = (p) => {
  const { set, ...rest } = p;
  return rest;
};

async function sweep(h, rep, cases, { mustComputeOn, retireAge, log, label }) {
  const t0 = Date.now();
  const guides = {};
  for (let i = 0; i < cases.length; i += 50) {
    const batch = cases.slice(i, i + 50);
    const res = await h.runMany(batch);
    res.forEach((r, k) => {
      const p = batch[k];
      rep.cases++;
      const issues = checkResult(p, r, retireAge, { mustComputeCheck: mustComputeOn });
      if (r.err && !issues.length) {
        const key = r.err.replace(/\d+/g, "N");
        guides[key] = (guides[key] || 0) + 1;
      }
      if (!issues.length) rep.ok();
      for (const x of issues) rep.add(x.kind, `[${label}] ${x.message}`, brief(p));
    });
    rep.takeProblems(h.problems, `${label}（${i + 1}〜${i + batch.length}件目）`);
    if (i % 2000 === 0 && i) log(`  ${label} ${i}/${cases.length}件（${Math.round((Date.now() - t0) / 1000)}秒）`);
  }
  rep.notes.push(`${label}：${cases.length}件。入力の案内のエラー（異常としない）${Object.values(guides).reduce((a, b) => a + b, 0)}件`);
  rep.guides = { ...(rep.guides || {}), [label]: guides };
}

// 単調性：1つの入力だけを動かし、在職中の給与の総額などの向きを見る
async function mono(h, rep, quick, retireAge) {
  const BASES = [
    { entryType: "sotsu", targetRank: "1曹", startAge: 18 },
    { entryType: "sotsu", targetRank: "曹長", startAge: 22 },
    { entryType: "sotsu", targetRank: "2佐", startAge: 18 },
    { entryType: "sotsu", targetRank: "将", startAge: 18, steps: "min" },
    { entryType: "kanko", targetRank: "1佐", startAge: 22 },
    { entryType: "kanko", targetRank: "将補", startAge: 22 },
    { entryType: "kankoD", targetRank: "3佐", startAge: 26 },
    { entryType: "ninki", ninkiPlan: "sgt", targetRank: "1曹", startAge: 18 },
    { entryType: "sotsu", targetRank: "3曹", startAge: 35 },
    { entryType: "sotsu", targetRank: "1曹", startAge: 18, retireReason: "self" },
  ].filter((_, i) => !quick || [0, 2, 4, 7].includes(i));
  const stepInfo = h.stepInfo;
  const found = [];
  // values の順に入力を変え、keys の各値が expect（+1：減らない、−1：増えない）の向きか
  const series = async (label, base, values, keys, expect, mk) => {
    const list = values.map((v) => mk(base, v));
    const res = await h.runMany(list);
    const out = [];
    res.forEach((r, i) => {
      rep.cases++;
      const issues = checkResult(list[i], r, retireAge);
      for (const x of issues) rep.add(x.kind, `[単調性 ${label}] ${x.message}`, list[i]);
      if (!issues.length) rep.ok();
      if (r.err || r.exception) return;
      out.push({ v: values[i], total: yen(r.totalText), allowance: yen(r.allowanceText), lifetime: yen(r.lifetimeText), last: r.lastRank });
    });
    for (let i = 1; i < out.length; i++)
      for (const k of keys) {
        const d = out[i][k] - out[i - 1][k];
        if ((expect === 1 && d < 0) || (expect === -1 && d > 0)) found.push({ label, base, key: k, from: out[i - 1], to: out[i], d });
        else rep.ok();
      }
  };
  const set1 = (key) => (base, v) => ({ ...base, [key]: v });
  for (const b of BASES) {
    await series("毎年の昇給", b, [...Array(21).keys()], ["total", "allowance", "lifetime"], 1, set1("raise"));
    await series("賞与の月数", b, ["0", "1", "2", "3", "4", "4.65", "5", "6", "8", "10", "12"], ["total", "lifetime"], 1, set1("bonus"));
    if (!b.entryType.startsWith("kanko")) await series("2士の号俸", b, [...Array(17).keys()].map((i) => i + 1), ["total", "allowance", "lifetime"], 1, set1("initialGrade"));
    for (const [id, inf] of Object.entries(stepInfo)) {
      const opts = quick ? inf.options.filter((_, i, a) => i === 0 || i === a.length - 1 || i === Math.floor(a.length / 2) || a[i] === inf.def) : inf.options;
      await series(`昇任までの期間 ${id}`, b, opts, ["total"], -1, (base, v) => ({ ...base, steps: { [id]: v } }));
    }
  }
  // 予想階級を上げる（同じ入隊年齢・同じ期間）
  for (const st of quick ? ["def"] : ["min", "def", "max"])
    for (const age of quick ? [18] : [18, 22, 30]) {
      await series(`予想階級（曹）${st}・${age}歳`, { entryType: "sotsu", startAge: age, steps: st }, ENLISTED, ["total"], 1, set1("targetRank"));
      await series(`予想階級（部内幹部）${st}・${age}歳`, { entryType: "sotsu", startAge: age, steps: st }, OFFICER, ["total"], 1, set1("targetRank"));
      await series(`予想階級（幹部候補生）${st}・${age + 4}歳`, { entryType: "kanko", startAge: age + 4, steps: st }, OFFICER, ["total"], 1, set1("targetRank"));
    }
  for (const t of ["1佐", "将補"]) await series(`1佐の欄（${t}）`, { entryType: "sotsu", targetRank: t, startAge: 18, steps: "min" }, ["5", "4", "3"], ["total"], 1, set1("colClass"));
  await series("将の号俸", { entryType: "sotsu", targetRank: "将", startAge: 18, steps: "min" }, [1, 2, 3, 4, 5, 6, 7, 8], ["total", "allowance"], 1, set1("generalGrade"));
  for (const t of quick ? ["2佐"] : ["1曹", "2佐", "将"])
    await series(`入隊時の年齢（${t}）`, { entryType: "sotsu", targetRank: t, steps: "def" }, [...Array(40).keys()].map((i) => 16 + i).filter((a) => a < retireAge[t]), ["total"], -1, set1("startAge"));

  for (const f of found) {
    const ex = MONO_EXCEPTIONS.find((e) => e.match(f));
    const msg = `[単調性 ${f.label}] ${f.key}が ${f.from.v}→${f.to.v} で${f.d > 0 ? "増えた" : "減った"}（${f.from[f.key]}→${f.to[f.key]}、${f.d > 0 ? "+" : ""}${f.d}円。到達 ${f.from.last}→${f.to.last}）`;
    if (ex) {
      rep.excluded = rep.excluded || [];
      rep.excluded.push({ message: msg, reason: ex.reason, base: f.base });
    } else rep.add("monotonic", msg, f.base);
  }
  rep.takeProblems(h.problems, "単調性");
}

module.exports = async function calc(env, { quick, log }) {
  const rep = new Report("計算の大量パターン");
  const h = await openSim(env);
  try {
    const retireAge = await h.page.evaluate(() => window.RULES.promotion.retireAge);
    const grid = gridCases(quick, retireAge);
    log(`  格子 ${grid.length}件`);
    await sweep(h, rep, grid, { mustComputeOn: true, retireAge, log, label: "格子" });
    const rnd = randomCases(quick ? 300 : 2000, retireAge, h.stepInfo);
    log(`  乱数 ${rnd.length}件`);
    await sweep(h, rep, rnd, { mustComputeOn: false, retireAge, log, label: "乱数" });
    log("  単調性");
    const before = rep.cases;
    await mono(h, rep, quick, retireAge);
    rep.notes.push(`単調性：${rep.cases - before}件。除外リストに当たったもの ${(rep.excluded || []).length}件`);
  } finally {
    await h.close();
  }
  return rep;
};
