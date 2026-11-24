// 3. 手当：陸海空の全手当を追加できるか、額×日数と年ごとの手当の欄の増え方、教育期間、重なりのエラー、共有URLの往復、範囲外の入力
"use strict";
const { Report, openPage } = require("../lib/common");

// ページに入れる共通の関数（文字列のまま評価する）
const HELPERS = `
window.requestAnimationFrame = (cb) => { cb(performance.now() + 1e6); return 0; };
window.H = {
  g: (id) => document.getElementById(id),
  wait: (t) => new Promise((r) => setTimeout(r, t)),
  // 入力を変えて change・input を送る
  set(id, v) { const el = H.g(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("input", { bubbles: true })); },
  open() { if (!H.g("simulatorDialog").open) H.g("simLaunch").click(); },
  // 計算し直す（requestAnimationFrame がすぐ呼ばれるので同期で終わる）
  recalc() { H.g("simLaunch").click(); },
  add(kind) { H.g("allowanceKind").value = kind; if (H.g("allowanceKind").value !== kind) return null; H.g("addAllowance").click(); return [...document.querySelectorAll(".c-allowance-item")].at(-1); },
  setIn(item, sel, v, ev = "change") { const el = item.querySelector(sel); el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); return el.value; },
  calcIn(item, k, v) { const el = item.querySelector(".c-allowance-item__calc [data-k=" + k + "]"); el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); },
  // 年・月で打つ支給期間（地域手当・広域異動手当以外）
  period(it, y, m, ly, lm) { H.setIn(it, ".c-allowance-item__start-y", y, "input"); H.setIn(it, ".c-allowance-item__start-m", m); H.setIn(it, ".c-allowance-item__len-y", ly, "input"); H.setIn(it, ".c-allowance-item__len-m", lm); },
  hasPeriod: (it) => !it.querySelector(".c-allowance-item__period-wrap").hidden,
  clear() { for (const it of [...document.querySelectorAll(".c-allowance-item")]) it.remove(); },
  err: () => H.g("simError").textContent.trim(),
  rows: () => [...document.querySelectorAll("#simRows tr")].map((t) => [...t.cells].map((c) => c.textContent.trim())),
  allowCol: () => [...document.querySelectorAll("#simRows tr")].map((t) => Number(t.cells[4].textContent.replace(/[^0-9-]/g, ""))),
  totals: () => ["totalIncome", "retireAllowance", "youngPension", "lifetimeNet"].map((id) => H.g(id).textContent).join(";"),
  tryRead() { try { return { ok: window.allowanceSimulator.read() }; } catch (e) { return { err: e.message }; } },
  kinds: () => [...H.g("allowanceKind").options].map((o) => o.value),
};
H.open();
`;

async function openAllow(env, url) {
  const h = await openPage(env, { url });
  await h.page.waitForFunction(() => window.allowanceSimulator && window.RULES);
  await h.page.evaluate(HELPERS);
  await h.page.waitForTimeout(300);
  return h;
}

// 生活の手当（教育期間中も支給する。js/simulator.js の LIVING_ALLOWANCES と同じ考え方を、点検側で書き写したもの）
const LIVING = ["扶養手当", "住居手当", "通勤手当", "単身赴任手当", "寒冷地手当", "地域手当", "広域異動手当", "在宅勤務等手当"];

module.exports = async function allowances(env, { quick, log }) {
  const rep = new Report("手当");
  const h = await openAllow(env);
  const { page } = h;
  try {
    // ---- (1) 陸海空の全手当・全区分：追加でき、額×日数が「入隊から2年後（20〜21歳の行）」だけに12か月分増える ----
    // 条件：初期値（一般曹候補生・18歳・2026年4月入隊・1曹）。20〜21歳の行は士長（列16）のまま昇任しない年
    const all = await page.evaluate(
      async ({ LIVING, quick }) => {
        const out = { items: [], kindsBy: {} };
        const R = window.RULES.allowances;
        const table = window.PAY_TABLE;
        for (const b of ["ground", "maritime", "air"]) {
          H.set("branch", b);
          out.kindsBy[b] = H.kinds();
        }
        for (const branch of ["ground", "maritime", "air"]) {
          H.set("branch", branch);
          H.clear();
          H.recalc();
          const base = H.allowCol(),
            baseRows = H.rows();
          // 20〜21歳の行の俸給：4〜12月が p1、1〜3月が年末の号俸 p2（1月に昇給）
          const r2 = baseRows[2],
            g2 = Number(r2[1].match(/士長 (\d+)号俸$/)?.[1]),
            p2 = table[g2 - 1]?.[16],
            p1 = (Number(r2[2].replace(/[^0-9]/g, "")) - 3 * p2) / 9,
            firstPay16 = table.find((row) => row[16] != null)[16];
          // --quick：海上・航空は、その所属だけの手当（陸上で見ていないもの）に絞る
          const kinds = out.kindsBy[branch].filter((k) => !quick || branch === "ground" || !out.kindsBy.ground.includes(k));
          for (const kind of kinds) {
            H.clear();
            let it = H.add(kind);
            if (!it) {
              out.items.push({ branch, kind, fail: "追加できない" });
              continue;
            }
            const rateEl = it.querySelector(".c-allowance-item__rate");
            const opts = rateEl ? [...rateEl.options].map((o) => o.value) : [null];
            for (const v of opts) {
              H.clear();
              it = H.add(kind);
              if (kind === "管理職員特別勤務手当") H.set("manager", "4"); // 管理職の手当（士長の間は特別調整額0なので他の額は変わらない）
              else H.set("manager", "none");
              if (v != null) H.setIn(it, ".c-allowance-item__rate", v);
              const method = it.querySelector(".c-allowance-item__method").value;
              if (method === "daily") H.setIn(it, ".c-allowance-item__days", "10", "input");
              if (kind === "地域手当") {
                H.setIn(it, ".c-allowance-item__region", "custom");
                H.setIn(it, ".c-allowance-item__region-custom", "10", "input");
              }
              if (kind === "広域異動手当") H.setIn(it, ".c-allowance-item__distance", it.querySelector(".c-allowance-item__distance").options[it.querySelector(".c-allowance-item__distance").options.length - 1].value);
              if (kind === "その他（自由入力）") H.setIn(it, ".c-allowance-item__amount", "12345", "input");
              if (H.hasPeriod(it)) H.period(it, "2028", "4", "1", "0");
              else {
                H.setIn(it, ".c-allowance-item__start", "2", "input");
                H.setIn(it, ".c-allowance-item__end", "3");
              }
              H.recalc();
              const rd = H.tryRead();
              const a = (rd.ok || []).filter((x) => !x.placement && x.name !== "指定場所生活調整金")[0];
              const col = H.allowCol();
              const rec = { branch, kind, v, method, err: H.err(), readErr: rd.err || "", delta: col.map((x, i) => x - (base[i] ?? 0)), a: a || null };
              // 期待する月額（独立に計算）
              let monthly = null;
              if (a) {
                const amt = a.rankTable ? (R.rankRates[kind]?.[v]?.byCol?.[16] ?? null) : a.amount;
                if (a.method === "monthly") monthly = [Math.floor(amt), Math.floor(amt)];
                else if (a.method === "annual") monthly = [Math.floor(amt / 12), Math.floor(amt / 12)];
                else if (a.method === "daily") {
                  const idx = /^[0-9]+$/.test(v ?? "") ? Number(v) : null;
                  const cap = idx != null ? R.specialRates[kind]?.[idx]?.[3] : undefined;
                  const d = Math.floor(amt * a.days);
                  monthly = [cap ? Math.min(d, cap) : d, cap ? Math.min(d, cap) : d];
                  rec.cap = cap ?? null;
                } else if (a.method === "percent") monthly = [Math.floor((p1 * amt) / 100), Math.floor((p2 * amt) / 100)];
                else if (a.method === "percentFirst") monthly = [Math.floor((firstPay16 * amt) / 100), Math.floor((firstPay16 * amt) / 100)];
              }
              rec.expected = monthly ? 9 * monthly[0] + 3 * monthly[1] : null;
              out.items.push(rec);
            }
          }
          H.set("manager", "none");
          // 所属の配置手当（乗組手当など）：選択肢ごとに、全期間（教育期間を除く）の手当が増える
          H.clear();
          for (const sel of document.querySelectorAll(`#branchAllowances [data-branch=${branch}] select`)) {
            for (const o of [...sel.options].slice(1)) {
              sel.value = o.value;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              H.recalc();
              const col = H.allowCol();
              out.items.push({ branch, kind: "配置手当 " + sel.id, v: o.value, placement: true, err: H.err(), delta: col.map((x, i) => x - (base[i] ?? 0)) });
            }
            sel.value = "none";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        H.set("branch", "ground");
        H.clear();
        H.recalc();
        return out;
      },
      { LIVING, quick },
    );
    const kindCount = new Set(all.items.map((x) => x.kind)).size;
    rep.notes.push(`手当の種類 陸${all.kindsBy.ground.length}・海${all.kindsBy.maritime.length}・空${all.kindsBy.air.length}、区分を含めて ${all.items.length} 通り（種類 ${kindCount}）`);
    rep.expect(all.kindsBy.ground.length >= 30 && all.kindsBy.maritime.length >= 30 && all.kindsBy.air.length >= 30, "allowanceList", `手当の選択肢が少ない：陸${all.kindsBy.ground.length}・海${all.kindsBy.maritime.length}・空${all.kindsBy.air.length}`);
    for (const x of all.items) {
      rep.cases++;
      const where = `${x.branch}・${x.kind}${x.v != null ? `［区分 ${x.v}］` : ""}`;
      if (x.fail) {
        rep.add("allowanceAdd", `${where}：${x.fail}`);
        continue;
      }
      if (x.err || x.readErr) {
        rep.add("allowanceError", `${where}：追加しただけでエラー「${x.err || x.readErr}」`);
        continue;
      }
      if (x.placement) {
        // 教育期間（入隊後5か月）以外は毎年増える。最後の行（定年の年）まで正の額
        rep.expect(x.delta.length > 0 && x.delta.every((d) => d > 0), "placement", `${where}：手当の欄が増えない年がある（${x.delta.slice(0, 6).join(",")}…）`);
        continue;
      }
      // 地域手当は、支給期間のあとも異動保障（一般職給与法第11条の7）で数年続くので、前の行だけを見る
      const others = x.delta.filter((d, i) => (x.kind === "地域手当" ? i < 2 : i !== 2) && d !== 0);
      rep.expect(others.length === 0, "allowanceRows", `${where}：支給期間（20〜21歳の行）以外の行の手当が変わった（${x.delta.join(",")}）`);
      if (x.expected == null) rep.add("allowanceMethod", `${where}：計算方法「${x.a?.method}」の期待値を出せない`);
      else rep.expect(Math.abs(x.delta[2] - x.expected) <= 1, "allowanceAmount", `${where}：手当の欄の増え ${x.delta[2]}円、額×日数×12か月（独立に計算）${x.expected}円（計算方法 ${x.a.method}、額 ${x.a.amount}${x.a.days ? `・日数 ${x.a.days}` : ""}${x.cap ? `・月の上限 ${x.cap}` : ""}）`);
    }
    // 月の上限（monthMax）が効く区分が少なくとも1つあり、点検されたか
    rep.expect(all.items.some((x) => x.cap && x.a && Math.floor(x.a.amount * x.a.days) > x.cap), "allowanceCoverage", "月の上限（1月に◯円を超えない）が効く区分を点検できなかった");

    // ---- (2) 教育期間：入隊と同時に1年。生活の手当は12か月、勤務の手当は教育隊の5か月を除く ----
    const edu = await page.evaluate(async (LIVING) => {
      const out = [];
      const eduMonths = Number(H.g("eduRecruit").value);
      H.clear();
      H.recalc();
      const base = H.allowCol();
      for (const [kind, amount] of [["住居手当", null], ["在宅勤務等手当", null], ["夜間看護等手当", null], ["その他（自由入力）", "10000"], ["航空作業手当", null]]) {
        H.clear();
        const it = H.add(kind);
        if (!it) continue;
        if (kind === "住居手当") H.calcIn(it, "rent", "50000");
        if (amount) H.setIn(it, ".c-allowance-item__amount", amount, "input");
        if (it.querySelector(".c-allowance-item__method").value === "daily") H.setIn(it, ".c-allowance-item__days", "5", "input");
        H.period(it, "2026", "4", "1", "0");
        H.recalc();
        const a = (H.tryRead().ok || []).filter((x) => !x.placement && x.name !== "指定場所生活調整金")[0];
        const per = a ? (a.method === "daily" ? Math.min(Math.floor(a.amount * a.days), a.monthMax ?? Infinity) : a.method === "annual" ? Math.floor(a.amount / 12) : Math.floor(a.amount)) : null;
        const months = LIVING.includes(kind) ? 12 : 12 - eduMonths;
        out.push({ kind, err: H.err(), row0: H.allowCol()[0] - base[0], expected: per == null ? null : per * months, months, method: a?.method });
      }
      H.clear();
      H.recalc();
      return out;
    }, LIVING);
    for (const x of edu) {
      rep.cases++;
      if (x.err) rep.add("allowanceError", `教育期間：${x.kind}でエラー「${x.err}」`);
      else rep.expect(x.row0 === x.expected, "education", `教育期間：${x.kind}を入隊と同時に1年支給 → 18〜19歳の行の増え ${x.row0}円、期待 ${x.expected}円（${x.months}か月分）`);
    }

    // ---- (3) 重なりのエラー：出るべきときに出て、出ないときに出ない ----
    const ov = await page.evaluate(async () => {
      const out = [];
      const mk = (kind, y, m, ly, lm, rate) => {
        const it = H.add(kind);
        if (rate != null) H.setIn(it, ".c-allowance-item__rate", rate);
        if (it.querySelector(".c-allowance-item__method").value === "daily") H.setIn(it, ".c-allowance-item__days", "1", "input");
        if (H.hasPeriod(it)) H.period(it, y, m, ly, lm);
        return it;
      };
      const log = (k, expect, mention) => {
        H.recalc();
        out.push({ k, expect, mention, err: H.err(), read: H.tryRead().err || "" });
      };
      const sec = (name, f, expect, mention) => {
        H.clear();
        f();
        log(name, expect, mention);
      };
      sec("同じ手当・同じ区分で重なる", () => { mk("在宅勤務等手当", "2030", "4", "2", "0"); mk("在宅勤務等手当", "2031", "3", "1", "0"); }, true, "1件目と2件目");
      sec("端が接する（重ならない）", () => { mk("在宅勤務等手当", "2030", "4", "2", "0"); mk("在宅勤務等手当", "2032", "4", "1", "0"); }, false);
      sec("1か月だけ重なる", () => { mk("在宅勤務等手当", "2030", "4", "2", "0"); mk("在宅勤務等手当", "2032", "3", "1", "0"); }, true, "2032年3月〜2032年3月");
      sec("区分が違う（重なってよい）", () => { mk("異常圧力内作業等手当", "2030", "4", "2", "0", "1"); mk("異常圧力内作業等手当", "2030", "4", "2", "0", "2"); }, false);
      sec("区分あり と 区分なし", () => { mk("異常圧力内作業等手当", "2030", "4", "2", "0", "1"); const it = mk("異常圧力内作業等手当", "2030", "4", "2", "0", ""); H.setIn(it, ".c-allowance-item__amount", "210", "input"); }, true);
      sec("区分なし同士", () => { const a = mk("防衛出動手当", "2030", "4", "2", "0"); H.setIn(a, ".c-allowance-item__amount", "1000", "input"); const b = mk("防衛出動手当", "2031", "4", "2", "0"); H.setIn(b, ".c-allowance-item__amount", "1000", "input"); }, true);
      sec("地域手当・広域異動手当は重なりを見ない", () => { for (let i = 0; i < 2; i++) { const it = H.add("地域手当"); H.setIn(it, ".c-allowance-item__prefecture", "東京都"); } for (let i = 0; i < 2; i++) { const it = H.add("広域異動手当"); H.setIn(it, ".c-allowance-item__distance", it.querySelector(".c-allowance-item__distance").options[1].value); } }, false);
      sec("3件のうち1件目と3件目", () => { mk("在宅勤務等手当", "2030", "4", "1", "0"); mk("在宅勤務等手当", "2040", "4", "1", "0"); mk("在宅勤務等手当", "2030", "10", "1", "0"); }, true, "1件目と3件目");
      sec("間に別の手当", () => { mk("住居手当", "2030", "4", "1", "0"); mk("在宅勤務等手当", "2030", "4", "1", "0"); mk("住居手当", "2030", "4", "1", "0"); }, true, "住居手当");
      // 削除するとエラーが消える
      H.clear();
      mk("在宅勤務等手当", "2030", "4", "1", "0");
      const second = mk("在宅勤務等手当", "2030", "4", "1", "0");
      log("削除の前", true);
      second.querySelector(".c-allowance-item__remove").click();
      log("重なる行を削除したあと", false);
      sec("その他の手当で名前が違う", () => { const a = mk("その他（自由入力）", "2030", "4", "1", "0"); H.setIn(a, ".c-allowance-item__name", "A手当", "input"); const b = mk("その他（自由入力）", "2030", "4", "1", "0"); H.setIn(b, ".c-allowance-item__name", "B手当", "input"); }, false);
      sec("その他の手当で同じ名前（後ろに空白）", () => { const a = mk("その他（自由入力）", "2030", "4", "1", "0"); H.setIn(a, ".c-allowance-item__name", "A手当", "input"); const b = mk("その他（自由入力）", "2030", "4", "1", "0"); H.setIn(b, ".c-allowance-item__name", "A手当 ", "input"); }, true);
      sec("別の種類の手当", () => { mk("住居手当", "2030", "4", "1", "0"); mk("在宅勤務等手当", "2030", "4", "1", "0"); }, false);
      H.clear();
      H.recalc();
      return out;
    });
    for (const x of ov) {
      rep.cases++;
      const has = /重なっています/.test(x.err);
      if (x.expect) rep.expect(has && (!x.mention || x.err.includes(x.mention)), "overlap", `重なり「${x.k}」：エラーが出るはず${x.mention ? `（「${x.mention}」を含む）` : ""}なのに「${x.err || "エラーなし"}」`);
      else rep.expect(!x.err, "overlap", `重なり「${x.k}」：エラーが出ないはずなのに「${x.err}」`);
    }

    // ---- (4) 共有URLの往復：入力と結果が同じに戻る ----
    const built = await page.evaluate(async () => {
      H.set("branch", "maritime");
      for (const s of document.querySelectorAll("#branchAllowances [data-branch=maritime] select")) {
        s.selectedIndex = 1;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
      H.set("targetRank", "1佐");
      H.set("startAge", "20");
      H.set("entryMonth", "7");
      H.set("raise", "6");
      H.set("bonus", "4.5");
      H.set("spouse", "yes");
      H.set("dependents", "2");
      H.set("reemployIncome", "400");
      H.set("afterPension", "kokumin");
      let it;
      it = H.add("扶養手当"); H.calcIn(it, "p1", "16"); it.querySelector(".c-allowance-item__calc-add").click(); H.calcIn(it, "p2", "4"); it.querySelector(".c-allowance-item__calc-add").click(); H.calcIn(it, "p3", "26"); H.period(it, "2030", "7", "20", "5");
      it = H.add("住居手当"); H.calcIn(it, "rent", "55000"); H.period(it, "2027", "1", "3", "0");
      it = H.add("通勤手当"); H.calcIn(it, "pass", "4321"); H.period(it, "2027", "1", "3", "0");
      it = H.add("単身赴任手当"); H.calcIn(it, "km", it.querySelector(".c-allowance-item__calc [data-k=km]").options[3].value); H.period(it, "2040", "4", "2", "6");
      it = H.add("寒冷地手当"); H.calcIn(it, "grade", "3"); H.calcIn(it, "household", "1"); H.calcIn(it, "barracks", "yes"); H.period(it, "2035", "11", "1", "0");
      it = H.add("地域手当"); H.setIn(it, ".c-allowance-item__prefecture", "東京都"); H.setIn(it, ".c-allowance-item__region", it.querySelector(".c-allowance-item__region").options[1].value); H.setIn(it, ".c-allowance-item__start", "1", "input"); H.setIn(it, ".c-allowance-item__end", "12");
      it = H.add("地域手当"); H.setIn(it, ".c-allowance-item__region", "custom"); H.setIn(it, ".c-allowance-item__region-custom", "7.5", "input"); H.setIn(it, ".c-allowance-item__start", "12", "input"); H.setIn(it, ".c-allowance-item__end", "15");
      it = H.add("広域異動手当"); H.setIn(it, ".c-allowance-item__distance", it.querySelector(".c-allowance-item__distance").options[1].value); H.setIn(it, ".c-allowance-item__start", "12", "input"); H.setIn(it, ".c-allowance-item__end", "15");
      it = H.add("航海手当"); H.setIn(it, ".c-allowance-item__rate", "rank:z3"); H.setIn(it, ".c-allowance-item__days", "7.5", "input"); H.period(it, "2028", "2", "5", "3");
      it = H.add("航海手当"); H.setIn(it, ".c-allowance-item__rate", "0"); H.setIn(it, ".c-allowance-item__days", "2", "input"); H.period(it, "2028", "2", "5", "3");
      it = H.add("本府省業務調整手当"); H.period(it, "2045", "4", "3", "0");
      it = H.add("異常圧力内作業等手当"); H.setIn(it, ".c-allowance-item__rate", "1"); H.setIn(it, ".c-allowance-item__days", "12", "input"); H.period(it, "2029", "6", "0", "11");
      it = H.add("その他（自由入力）"); H.setIn(it, ".c-allowance-item__name", "わたしの手当", "input"); H.setIn(it, ".c-allowance-item__method", "annual"); H.setIn(it, ".c-allowance-item__amount", "120000.5", "input"); H.period(it, "2050", "12", "1", "1");
      it = H.add("その他（自由入力）"); H.setIn(it, ".c-allowance-item__method", "percent"); H.setIn(it, ".c-allowance-item__amount", "2.5", "input"); H.period(it, "2031", "3", "0", "1");
      it = H.add("在宅勤務等手当"); H.setIn(it, ".c-allowance-item__name", "在宅の手当", "input");
      H.recalc();
      await H.wait(300);
      const form = [...document.querySelectorAll("#simulator .c-simulator__grid input, #simulator .c-simulator__grid select")].filter((e) => e.id && !e.closest(".c-allowance-item")).map((e) => e.id + "=" + e.value).join("&");
      const before = { dump: JSON.stringify(window.allowanceSimulator.dump()), rows: JSON.stringify(H.rows()), totals: H.totals(), err: H.err(), n: document.querySelectorAll(".c-allowance-item").length, form };
      H.g("shareLink").click();
      await H.wait(300);
      before.url = H.g("shareUrl").value;
      return before;
    });
    rep.cases++;
    rep.expect(!built.err, "shareSetup", `共有URLの往復：元の条件でエラー「${built.err}」`);
    rep.expect(/#sim=/.test(built.url), "shareUrl", `共有URLが作られない：「${built.url.slice(0, 80)}」`);
    if (/#sim=/.test(built.url)) {
      const p2 = await openAllow(env, built.url);
      const after = await p2.page.evaluate(async () => {
        H.recalc();
        await H.wait(300);
        const form = [...document.querySelectorAll("#simulator .c-simulator__grid input, #simulator .c-simulator__grid select")].filter((e) => e.id && !e.closest(".c-allowance-item")).map((e) => e.id + "=" + e.value).join("&");
        return { dump: JSON.stringify(window.allowanceSimulator.dump()), rows: JSON.stringify(H.rows()), totals: H.totals(), err: H.err(), n: document.querySelectorAll(".c-allowance-item").length, form };
      });
      for (const k of ["n", "dump", "form", "totals", "rows", "err"]) {
        let detail = "";
        if (built[k] !== after[k] && k === "form") {
          const a = new URLSearchParams(built.form),
            b = new URLSearchParams(after.form);
          detail = [...a.keys()].filter((key) => a.get(key) !== b.get(key)).map((key) => `${key} ${a.get(key)}→${b.get(key)}`).join("、");
        }
        rep.expect(built[k] === after[k], "shareRoundTrip", `共有URLの往復で「${k}」が戻らない${detail ? `（${detail}）` : `（${String(built[k]).slice(0, 80)} → ${String(after[k]).slice(0, 80)}）`}`);
      }
      rep.takeProblems(p2.problems, "共有URLで開いたページ");
      await p2.close();
    }
    // 壊れた・古い形の共有URLでも、ページが止まらない（例外・コンソールのエラーがない）
    const broken = [
      { f: { branch: "ground" }, a: [["謎の手当", "monthly", "5000", "0", "2", "3"]] },
      { f: { branch: "ground" }, a: [null] },
      { f: { branch: "ground" }, a: "abc" },
      { f: { startAge: "abc", branch: "nowhere" }, a: [] },
      { f: { branch: "ground" }, a: [["扶養手当", "monthly", "0", "0", "2", "3", "", "0", "0", "", "{bad json"]] },
      { f: { branch: "ground" }, a: [["地域手当", "percent", "0", "0", "0", "38", "", "0", "0", "__proto__", ""]] },
      { f: { branch: "ground" }, a: [["<img src=x onerror=alert(1)>", "monthly", "3000", "0", "2", "3"]] },
    ];
    for (const st of quick ? broken.slice(0, 3) : broken) {
      rep.cases++;
      const p3 = await openAllow(env, env.base + "#sim=" + encodeURIComponent(JSON.stringify(st)));
      const st2 = await p3.page.evaluate(() => ({ open: H.g("simulatorDialog").open, err: H.err(), xss: !!document.querySelector(".c-allowance-item img") }));
      rep.expect(st2.open, "shareBroken", `壊れた共有URL ${JSON.stringify(st).slice(0, 80)}：シミュレーターが開かない`);
      rep.expect(!st2.xss, "shareBroken", `共有URLの手当名の HTML がそのまま要素になった`);
      rep.expect(!/計算できませんでした|詳細：|Cannot read|undefined|NaN/.test(st2.err), "shareBroken", `壊れた共有URL ${JSON.stringify(st).slice(0, 80)}：内部エラーの文「${st2.err}」`);
      rep.takeProblems(p3.problems, `壊れた共有URL ${JSON.stringify(st).slice(0, 60)}`);
      await p3.close();
    }

    // ---- (5) 範囲外の入力はエラーになり、範囲内はならない（初期値のページで） ----
    const h5 = await openAllow(env);
    const rng = await h5.page.evaluate(async () => {
      const out = [];
      H.clear();
      H.set("branch", "ground");
      const tryAllow = (label, expectErr, f) => {
        H.clear();
        const it = H.add("その他（自由入力）");
        H.period(it, "2028", "4", "1", "0");
        f(it);
        H.recalc();
        out.push({ label, expectErr, err: H.err(), hidden: H.g("simResult").hidden });
      };
      for (const [m, amt, ok] of [["monthly", "0", true], ["monthly", "100", true], ["monthly", "1234.56", true], ["monthly", "10000000", true], ["monthly", "", false], ["monthly", "-1", false], ["monthly", "10000001", false], ["annual", "-5", false], ["percent", "100", true], ["percent", "100.5", false], ["percent", "-1", false]])
        tryAllow(`手当の金額 ${m} ${JSON.stringify(amt)}`, !ok, (it) => { H.setIn(it, ".c-allowance-item__method", m); H.setIn(it, ".c-allowance-item__amount", amt, "input"); });
      for (const [d, ok] of [["0", true], ["31", true], ["0.5", true], ["", false], ["-1", false], ["32", false], ["1000", false]])
        tryAllow(`手当の日数 ${JSON.stringify(d)}`, !ok, (it) => { H.setIn(it, ".c-allowance-item__method", "daily"); H.setIn(it, ".c-allowance-item__amount", "100", "input"); H.setIn(it, ".c-allowance-item__days", d, "input"); });
      for (const [y, m, ly, lm, ok] of [["2026", "4", "1", "0", true], ["2027", "3", "0", "2", true], ["2026", "4", "80", "0", true], ["2026", "3", "1", "0", false], ["", "4", "1", "0", false], ["202", "4", "1", "0", false], ["20260", "4", "1", "0", false], ["2026.5", "4", "1", "0", false], ["1950", "4", "1", "0", false], ["2026", "4", "0", "0", false], ["2026", "4", "81", "0", false], ["2028", "4", "1.5", "0", false], ["2028", "4", "-1", "6", false], ["2028", "4", "", "6", false]])
        tryAllow(`手当の支給期間 ${[y, m, ly, lm].join("/")}`, !ok, (it) => H.period(it, y, m, ly, lm));
      for (const [k, v, ok] of [["rent", "-5", false], ["rent", "1000001", false], ["rent", "1.5", false], ["rent", "61000", true]]) {
        H.clear();
        const it = H.add("住居手当");
        H.calcIn(it, k, v);
        H.recalc();
        out.push({ label: `住居手当の家賃 ${v}`, expectErr: !ok, err: H.err(), hidden: H.g("simResult").hidden });
      }
      H.clear();
      // 基本の入力欄
      const fields = [["startAge", "70"], ["startAge", "15"], ["startAge", "18.5"], ["raise", "21"], ["raise", "-1"], ["bonus", "12.5"], ["bonus", "-0.1"], ["entryYear", "1999"], ["entryYear", "2061"], ["initialGrade", "18"], ["initialGrade", "0"], ["dependents", "11"], ["specificDependents", "-1"], ["reemployIncome", "5001"], ["reemployIncome", "-1"], ["startAge", ""]];
      for (const [id, v] of fields) {
        const before = H.g(id).value;
        H.set(id, v);
        H.recalc();
        out.push({ label: `${id}＝${JSON.stringify(v)}`, expectErr: true, err: H.err(), hidden: H.g("simResult").hidden });
        H.set(id, before);
      }
      H.recalc();
      out.push({ label: "元に戻した基本の入力", expectErr: false, err: H.err(), hidden: H.g("simResult").hidden });
      return out;
    });
    rep.takeProblems(h5.problems, "範囲外の入力のページ");
    await h5.close();
    for (const x of rng) {
      rep.cases++;
      if (x.expectErr) rep.expect(!!x.err && x.hidden, "range", `範囲外の入力「${x.label}」：エラーにならない（結果欄 ${x.hidden ? "非表示" : "表示"}）`);
      else rep.expect(!x.err && !x.hidden, "range", `範囲内の入力「${x.label}」：エラー「${x.err}」`);
      if (x.err) rep.expect(!/計算できませんでした|詳細：|Cannot read|undefined|NaN/.test(x.err), "internalError", `「${x.label}」で内部エラーの文：${x.err}`);
    }
    rep.takeProblems(h.problems, "手当のページ");
  } finally {
    await h.close();
  }
  return rep;
};
