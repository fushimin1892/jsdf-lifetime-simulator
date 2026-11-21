// シミュレーターのページに入れる関数。入力を一度に入れて計算させ、画面の結果を読み取る。
"use strict";
const { openPage } = require("./common");

// 昇任までの期間の入力欄（3曹以上。2士→1士・1士→士長・3尉→2尉は読み取り専用で固定）
const STEP_IDS = ["stepSgt", "stepOfc", "first", "stepSgt2", "stepSgt1", "stepSgm", "stepWo", "stepMaj", "stepLtc", "stepCol", "stepMg", "stepGen"];

// ページ側で実行する（文字列にして渡すので、外の変数は使わない）
function pageSetup(STEP_IDS) {
  // 結果の描画を待たずに済むよう、requestAnimationFrame をすぐ呼ぶものに置き換える（サイトの計算は変えない）
  window.requestAnimationFrame = (cb) => {
    cb(performance.now() + 1e6);
    return 0;
  };
  const g = (id) => document.getElementById(id);
  if (!g("simulatorDialog").open) g("simLaunch").click();
  // 昇任までの期間は、サイトが選択欄（値は年数）に置き換える。選択肢の最初＝最短（法令）、最後＝最長
  const defVal = {};
  for (const id of STEP_IDS) defVal[id] = g(id).value;
  const opts = (el) => (el.tagName === "SELECT" ? [...el.options].map((o) => o.value) : [el.min, el.max]);
  window.__stepInfo = Object.fromEntries(STEP_IDS.map((id) => [id, { options: opts(g(id)), def: defVal[id] }]));
  // p：{entryType, branch, ninkiPlan, targetRank, startAge, entryMonth, entryYear, raise, bonus, manager, retireReason,
  //     colClass, generalGrade, initialGrade, reemployIncome, spouse, dependents, specificDependents, eigaiStart, barracksYears,
  //     afterPension, afterHealth, afterHealthYen, afterHealthYears, steps: 'min'|'max'|'def'|{id: 'min'|'max'|'def'|数}}
  window.__runCase = (p) => {
    const setv = (id, v, ev) => {
      if (v == null) return;
      const el = g(id);
      el.value = String(v);
      if (ev) el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setv("entryType", p.entryType || "sotsu", true);
    setv("branch", p.branch || "ground", true);
    setv("ninkiPlan", p.ninkiPlan, true);
    setv("targetRank", p.targetRank, true);
    setv("startAge", p.startAge, true);
    for (const id of ["entryMonth", "entryYear", "raise", "bonus", "manager", "retireReason", "colClass", "generalGrade", "initialGrade", "reemployIncome", "spouse", "dependents", "specificDependents", "eigaiStart", "barracksYears", "afterPension", "afterHealth", "afterHealthYen", "afterHealthYears"])
      setv(id, p[id]);
    for (const id of STEP_IDS) {
      const el = g(id);
      const mode = typeof p.steps === "object" && p.steps ? (p.steps[id] ?? "def") : p.steps || "def";
      const o = opts(el);
      el.value = mode === "min" ? o[0] : mode === "max" ? o.at(-1) : mode === "def" ? defVal[id] : String(mode);
    }
    g("simError").textContent = "";
    g("simLaunch").click(); // requestAnimationFrame がすぐ呼ばれるので、計算は同期で終わる
    return window.__readResult();
  };
  window.__readResult = () => {
    const t = (id) => g(id).textContent.trim();
    const cells = (sel) => [...document.querySelectorAll(sel)].map((tr) => [...tr.cells].map((c) => c.textContent.trim()));
    return {
      err: t("simError"),
      hidden: g("simResult").hidden,
      totalText: t("totalIncome"),
      allowanceText: t("retireAllowance"),
      pensionText: t("youngPension"),
      grossAllText: t("grossAll"),
      deductionsText: t("totalDeductions"),
      lifetimeText: t("lifetimeNet"),
      lastRank: t("lastRank"),
      serviceYears: t("serviceYears"),
      stickyRank: t("stickyRank"),
      retireAgeField: g("retireAge").value,
      startAgeNow: g("startAge").value,
      targetNow: g("targetRank").value,
      detail: t("totalDetail"),
      rows: cells("#simRows tr"),
      retireRows: cells("#retireRows tr"),
      resultText: g("simResult").textContent,
    };
  };
}

// シミュレーターを開いたページを用意する
async function openSim(env, opts = {}) {
  const h = await openPage(env, opts);
  await h.page.evaluate(pageSetup, STEP_IDS);
  await h.page.waitForTimeout(300);
  h.stepInfo = await h.page.evaluate(() => window.__stepInfo);
  // 指定しない項目は初期値（毎回すべて入れ直すので、前の条件が残らない）
  h.run = (p) => h.page.evaluate((p) => window.__runCase(p), { ...DEFAULTS, ...p });
  h.runMany = (list) =>
    h.page.evaluate(
      (list) =>
        list.map((p) => {
          try {
            return window.__runCase(p);
          } catch (e) {
            return { exception: String((e && e.stack) || e) };
          }
        }),
      list.map((p) => ({ ...DEFAULTS, ...p })),
    );
  return h;
}

// 入力の初期値（画面の初期値と同じ。入隊した年はテストの日付 2026年）
const DEFAULTS = {
  entryMonth: 4,
  entryYear: 2026,
  raise: 4,
  bonus: "4.65",
  manager: "none",
  colClass: "5",
  generalGrade: 1,
  initialGrade: 1,
  reemployIncome: 0,
  spouse: "no",
  dependents: 0,
  specificDependents: 0,
  ninkiPlan: "2",
  retireReason: "teinen",
  eigaiStart: "none",
  barracksYears: "0",
  afterPension: "employee",
  afterHealth: "none",
  afterHealthYen: 0,
  afterHealthYears: 2,
  steps: "def",
};

module.exports = { openSim, STEP_IDS, DEFAULTS };
