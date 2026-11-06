// 回帰テスト：改修の前後でこのスクリプトをブラウザのコンソール（または AI のブラウザ操作ツール）で実行し、
// 最後に出る hash が改修前と同じなら、計算結果は1円も変わっていない。法令の数値を変えた改修では hash は変わるので、
// その場合は変わった case だけを見て、変わり方が改正の内容どおりかを確かめる（window.__snapText に全文が入る）。
// 2026-11-02 時点の hash: 1201817853（85通り。国民年金の免除のケースを足した後。その前は 1514484702（84通り）。入隊月・扶養手当の階級別・通勤の併用・異動保障・入隊区分・退職後の負担のケースを足し、若年給付金2回目以降の退職所得控除を直した後。その前は 2011296705（69通り）。標準報酬の等級表・税の暦年計算・住民税の翌年徴収・地域手当の異動保障を入れた後。その前の賞与の修正後は -1237756367。それ以前は 1395599498、さらに前は 964384010）
window.requestAnimationFrame = (cb) => { cb(performance.now() + 1e6); return 0; };
const g = (id) => document.getElementById(id);
const wait = (t = 400) => new Promise((r) => setTimeout(r, t));
const set = async (id, v) => { const el = g(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); await wait(60); };
if (!g("simulatorDialog").open) g("simLaunch").click();
await wait(600);
const out = { kinds: {}, placements: {}, rankOpts: "", fixed: "", cases: [] };
out.rankOpts = [...g("targetRank").options].map((o) => o.value + "=" + o.dataset.age + "/" + o.textContent).join(",");
out.fixed = ["stepPfc", "stepLcpl", "second", "eduRecruit", "eduSgt", "eduOcs", "bonus"].map((id) => id + "=" + g(id).value).join(",") +
  " | " + ["stepSgt", "stepOfc", "first", "stepSgt2", "stepSgt1", "stepSgm", "stepWo", "stepMaj", "stepLtc", "stepCol", "stepMg", "stepGen"].map((id) => id + ":" + [...g(id).options].map((o) => o.value + (o.selected ? "*" : "")).join("/")).join(" ");
for (const b of ["ground", "maritime", "air"]) {
  await set("branch", b);
  out.kinds[b] = [...g("allowanceKind").options].map((o) => o.value).join(",");
  out.placements[b] = [...document.querySelectorAll(`#branchAllowances [data-branch=${b}] select`)].map((s) => s.id + ":" + [...s.options].map((o) => o.value + "=" + o.textContent).join("|")).join(" / ");
}
const read = () => ["totalIncome", "retireAllowance", "youngPension", "totalDeductions", "grossAll", "lifetimeNet", "lastRank", "simError"].map((id) => g(id).textContent).join(" ; ") + " ; " + g("reemploySummary").textContent + " ; rows=" + [...document.querySelectorAll("#simRows tr")].map((t) => t.cells[7]?.textContent).join("/") + " ; retire=" + [...document.querySelectorAll("#retireRows tr")].map((t) => t.cells[1]?.textContent).join("/");
const addAllowance = async (kind, fn) => { g("allowanceKind").value = kind; g("addAllowance").click(); await wait(100); const item = [...document.querySelectorAll(".allowance-item")].at(-1); await fn(item); await wait(100); };
const setIn = (item, sel, v, ev = "change") => { const el = item.querySelector(sel); el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); };
for (const b of ["ground", "maritime", "air"]) {
  await set("branch", b);
  for (const s of document.querySelectorAll(`#branchAllowances [data-branch=${b}] select`)) { s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); }
  for (const target of ["3曹", "1曹", "曹長", "1尉", "2佐", "1佐", "将補", "将"]) {
    await set("targetRank", target);
    for (const mgr of ["2佐", "1佐", "将補"].includes(target) ? ["none", "1", "3a", "2", "4"] : ["none"]) { await set("manager", mgr); await wait(); out.cases.push(`${b}/${target}/${mgr}: ` + read()); }
  }
  for (const s of document.querySelectorAll(`#branchAllowances [data-branch=${b}] select`)) { s.selectedIndex = 0; s.dispatchEvent(new Event("change", { bubbles: true })); }
}
await set("branch", "ground"); await set("targetRank", "1曹"); await set("manager", "none");
await addAllowance("扶養手当", (it) => setIn(it, ".a-amount", "13000", "input"));
await addAllowance("地域手当", (it) => { setIn(it, ".a-prefecture", "東京都"); });
await addAllowance("広域異動手当", (it) => { setIn(it, ".a-distance", "16"); setIn(it, ".a-start", "2", "input"); });
await addAllowance("野外訓練・演習従事手当", (it) => setIn(it, ".a-days", "3", "input"));
await set("spouse", "yes"); await set("dependents", "2"); await set("specificDependents", "1"); await set("reemployIncome", "450"); await wait(500);
out.cases.push("manual: " + read());
await set("reemployIncome", "650"); await wait(); out.cases.push("reemp650: " + read());
await set("reemployIncome", "800"); await wait(); out.cases.push("reemp800: " + read());
await set("retireReason", "self"); await wait(); out.cases.push("self: " + read());
await set("retireReason", "teinen"); await set("entryYear", "2024"); await wait(); out.cases.push("2024: " + read());
await set("entryYear", "2030"); await wait(); out.cases.push("2030: " + read());
await set("startAge", "38"); await wait(); out.cases.push("age38: " + read());
await set("startAge", "50"); await wait(); out.cases.push("age50: " + read());
await set("startAge", "18"); await set("entryMonth", "11"); await set("raise", "8"); await wait(); out.cases.push("nov-raise8: " + read());
// ---- 2026-11-02 追加：入隊月・手当の「条件から計算」・異動保障・入隊区分・退職後の負担 ----
const calcIn = (item, k, v) => setIn(item, `.a-calc [data-k=${k}]`, v, "input");
await set("raise", "4"); await set("entryMonth", "1"); await wait(); out.cases.push("jan: " + read());
await set("entryMonth", "7"); await wait(); out.cases.push("jul: " + read());
await set("entryMonth", "4");
// 扶養手当（父母等1人）を1佐（1）欄まで：上位の階級で父母等の額が変わる
await set("targetRank", "1佐"); await set("colClass", "3");
await addAllowance("扶養手当", (it) => { calcIn(it, "child", "1"); calcIn(it, "parent", "1"); });
await wait(); out.cases.push("fuyou-parent-1sa1: " + read());
// 通勤手当：電車と車（2km未満）・電車と車（10km）
await addAllowance("通勤手当", (it) => { calcIn(it, "pass", "1500"); setIn(it, ".a-calc [data-k=car]", "short"); });
await wait(); out.cases.push("commute-short: " + read());
await addAllowance("通勤手当", (it) => { calcIn(it, "pass", "8000"); setIn(it, ".a-calc [data-k=car]", "10"); });
await wait(); out.cases.push("commute-both: " + read());
// 前に追加した地域手当（東京都）を12年後でやめる：その後3年間の異動保障
{ const it = [...document.querySelectorAll(".allowance-item")].find((x) => x.querySelector(".a-name").value === "地域手当");
  setIn(it, ".a-end", "12"); }
await wait(); out.cases.push("regional-guarantee: " + read());
// 入隊区分
await set("targetRank", "2佐");
for (const t of ["kanko", "kankoM", "kankoD"]) { await set("entryType", t); await wait(); out.cases.push(`entry-${t}: ` + read()); }
await set("entryType", "ninki");
for (const p of ["1", "2", "4", "sgt"]) { await set("ninkiPlan", p); await wait(); out.cases.push(`ninki-${p}: ` + read()); }
await set("branch", "air"); await set("ninkiPlan", "2"); await wait(); out.cases.push("ninki-air-2: " + read());
await set("branch", "ground"); await set("entryType", "sotsu"); await set("targetRank", "1曹");
// 退職後の国民年金・健康保険（任意継続 年20万円×2年）
await set("afterPension", "kokumin"); await set("afterHealth", "nini"); await set("afterHealthYen", "20"); await wait();
out.cases.push("after-burden: " + read());
// 退職後〜60歳の国民年金を免除（保険料0、老齢基礎年金は免除月を2分の1で数える）
await set("afterPension", "exempt"); await wait(); out.cases.push("after-exempt: " + read());
const s = JSON.stringify(out); let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
window.__snapText = s;
({ hash: h, len: s.length, n: out.cases.length });
