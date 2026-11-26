// 法令の条文から独立に作った期待値で、サイトの計算を確かめる（サイトの計算のコードは使わない）。
//   node test/law-cases.js
// 期待値の根拠（2026-11-24 に e-Gov・国税庁で確認）：
//   ・所得税法第28条・別表第五、国税庁 No.1410（給与所得控除後の金額。660万円未満は「収入÷4（千円未満切捨て）」を使う）
//   ・租税特別措置法第29条の4（最低保障額）、第41条の3の11（所得金額調整控除）
//   ・防衛省の職員の給与等に関する法律 第27条の3・第27条の4・附則第12項〜第15項（令和8年法律第53号の改正後、2028-04-01 施行版も）
//   ・防衛省設置法等の一部を改正する法律（令和8年法律第53号）附則第2条〜第5条（退職時期ごとの倍率）
//   ・同法施行令 第22条（算定基礎期間の年数に応じた率）・第24条（給与年額相当額）、若年定年退職者給付金に関する省令 第1条（支給月）
// Playwright が必要（test/regression.js と同じ）。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean)) {
    try {
      return require(t);
    } catch {}
  }
  console.error("Playwright が見つからない（test/regression.js の説明を参照）");
  process.exit(2);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2" };
function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// ---------------- 独立した期待値（条文から直接） ----------------
// 給与所得の金額（別表第五。2026・2027年分：最低保障74万円（収入220万円未満）、それ以外69万円。2025年分は65万円）
function expSalaryIncome(x, y) {
  const min = y < 2026 ? 650000 : y <= 2027 && x < 2200000 ? 740000 : 690000;
  const formula = (v) => (v <= 1625000 ? 550000 : v <= 1800000 ? v * 0.4 - 100000 : v <= 3600000 ? v * 0.3 + 80000 : v <= 6600000 ? v * 0.2 + 440000 : v <= 8500000 ? v * 0.1 + 1100000 : 1950000);
  if (formula(x) <= min) return Math.max(0, x - min);
  if (x < 6600000) {
    const A = Math.floor(x / 4 / 1000) * 1000; // 収入÷4（千円未満切捨て）
    // 小数の誤差を避けるため、10倍した整数で計算する
    if (A * 4 <= 1800000) return (A * 24) / 10 + 100000;
    if (A * 4 <= 3600000) return (A * 28) / 10 - 80000;
    return (A * 32) / 10 - 440000;
  }
  return Math.floor(x - formula(x));
}

let ok = 0,
  ng = 0;
const check = (cond, msg) => {
  if (cond) ok++;
  else {
    ng++;
    console.log("NG " + msg);
  }
};

(async () => {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-11-16T12:00:00+09:00"));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "load" });

  // ---- 1. 給与所得（別表第五）：4,000円刻みの境界の前後、660万円、最低保障の境目 ----
  const salaryCases = [];
  for (const y of [2025, 2026, 2027, 2028])
    for (const x of [0, 550000, 1000000, 1624999, 1625000, 1625001, 1899999, 1900000, 2033333, 2199999, 2200000, 2200001, 3599999, 3600000, 3601250, 3603999, 3604000, 6595999, 6596000, 6599999, 6600000, 8500000, 8500001, 10000000])
      salaryCases.push([x, y]);
  for (let x = 1600000; x <= 6700000; x += 997) salaryCases.push([x, 2026]); // 刻みと合わない間隔で広く
  const got = await page.evaluate((cases) => cases.map(([x, y]) => window.salarySimulatorTax.salaryIncome(x, y)), salaryCases);
  salaryCases.forEach(([x, y], i) => check(got[i] === expSalaryIncome(x, y), `給与所得 ${y}年分 収入${x}円：サイト ${got[i]} / 期待 ${expSalaryIncome(x, y)}`));
  console.log(`給与所得（別表第五）：${salaryCases.length} 件`);

  // ---- 2. 依頼の例：2026年分 収入3,601,250円・社会保険料0・基礎控除104万円 → 給与所得244万円・課税所得140万円・所得税71,400円 ----
  const ex = await page.evaluate(() => ({
    g: window.salarySimulatorTax.salaryIncome(3601250, 2026),
    t: window.salarySimulatorTax.salaryTaxes(3601250, 0, 2026, { spouse: false, general: 0, specific: 0 }),
  }));
  check(ex.g === 2440000, `例の給与所得 ${ex.g}（期待 2,440,000）`);
  // 課税所得 2,440,000 − 1,040,000 = 1,400,000 → 5％で70,000円、復興特別所得税（2.1％）を加え100円未満切捨て → 71,400円
  check(ex.t.it === 71400, `例の所得税 ${ex.t.it}（期待 71,400）`);

  // ---- 3. 所得金額調整控除：収入900万円・23歳未満の扶養親族あり → （900万−850万）×10％＝5万円 ----
  const adj = await page.evaluate(() => [window.salarySimulatorTax.incomeAdjustment(9000000, true), window.salarySimulatorTax.incomeAdjustment(9000000, false), window.salarySimulatorTax.incomeAdjustment(12000000, true), window.salarySimulatorTax.incomeAdjustment(8500000, true)]);
  check(adj[0] === 50000 && adj[1] === 0 && adj[2] === 150000 && adj[3] === 0, `所得金額調整控除 ${adj.join(",")}（期待 50000,0,150000,0）`);

  // ---- 4. 給付金の所得金額（給与法第27条の4第4項）：給与300万円＋事業所得100万円（2027年）→ 給与所得 2,020,000＋1,000,000＝3,020,000 を
  //         給与所得とする給与収入。別表第五で 3,020,000 以上になる最小の収入は A×3.2−440,000 ≧ 3,020,000 → A ≧ 1,081,250 → A＝1,082,000 → 4,328,000円
  const yi = await page.evaluate(() => [
    window.salarySimulatorTax.ypIncome({ salary: 3000000, biz: 1000000 }, 2027),
    window.salarySimulatorTax.ypIncome({ salary: 3000000, biz: 0 }, 2027),
    window.salarySimulatorTax.ypIncome({ salary: 0, biz: 1000000 }, 2027),
  ]);
  check(yi[0] === 4328000, `給付金の所得金額（給与300万＋事業100万）${yi[0]}（期待 4,328,000）`);
  check(yi[1] === 3000000, `給付金の所得金額（給与だけ）${yi[1]}（期待 3,000,000）`);
  // 事業所得100万円だけ（2027年）：給与所得が100万円以上になる最小の収入。最低保障74万円（220万円未満）→ 1,740,000円
  check(yi[2] === 1740000, `給付金の所得金額（事業100万だけ）${yi[2]}（期待 1,740,000）`);

  // ---- 5. 若年定年退職者給付金：退職した時期ごとの倍率・回数・支給月・所得による調整 ----
  // 1曹で56歳定年。退職した月を、入隊した年・月・年齢で決める（入隊月の前月が退職月）
  const run = (p) =>
    page.evaluate(async (p) => {
      window.requestAnimationFrame = (cb) => {
        cb(performance.now() + 1e6);
        return 0;
      };
      const g = (id) => document.getElementById(id);
      if (!g("simulatorDialog").open) g("simLaunch").click();
      const set = (id, v) => {
        g(id).value = String(v);
        g(id).dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("entryType", "sotsu");
      set("targetRank", "1曹");
      set("startAge", p.startAge);
      set("entryYear", p.entryYear);
      set("entryMonth", p.entryMonth);
      set("retireReason", "teinen");
      set("reemployIncome", p.income ?? 0);
      set("reemployBiz", 0);
      for (const id of ["incomeY61", "incomeY61Biz", "incomeY59", "incomeY59Biz", "incomeCiv", "incomeCivBiz"]) g(id).value = p[id] ?? "";
      set("ypLump", p.lump ? "lump" : "split");
      set("ypAssume", p.assume || "upper");
      g("simLaunch").click();
      const rows = [...document.querySelectorAll("#retireRows tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim()));
      const yen = (s) => Number(s.replace(/[^0-9]/g, ""));
      const pays = rows.filter((r) => r[0].startsWith("若年定年退職者給付金") && /回目/.test(r[0])).map((r) => ({ label: r[0], amount: yen(r[1]) }));
      const lastRank = g("lastRank").textContent;
      const col = { "1曹": 13, "2曹": 14, 曹長: 12, "3曹": 15 }[lastRank.split(" ")[0]];
      const grade = Number(lastRank.match(/(\d+)号俸/)?.[1]);
      return { pays, P: window.PAY_TABLE[grade - 1][col], col, err: g("simError").textContent, sticky: g("stickyRank").textContent };
    }, p);
  // 自衛官以外の職員の定年（国家公務員法附則）：退職の翌月の年度で決める
  const civilAge = (fy) => (fy <= 2022 ? 60 : fy <= 2024 ? 61 : fy <= 2026 ? 62 : fy <= 2028 ? 63 : fy <= 2030 ? 64 : 65);
  // 施行令第22条の率（附則第15項・第16項の後期は年数をずらした表）
  const rateEarly = (n) => (n <= 3 ? [1, 1] : { 4: [0.995192, 0.986538], 5: [0.988462, 0.968107], 6: [0.983974, 0.947521], 7: [0.980769, 0.925979] }[Math.min(n, 7)]);
  const rateLate = (n) => (n <= 2 ? [1, 1] : { 3: [0.99359, 1], 4: [0.985577, 0.983974], 5: [0.980769, 0.962032] }[Math.min(n, 5)]);
  const firstMonth = (y, m) => (m <= 3 ? `${y}年4月` : m <= 9 ? `${y}年10月` : `${y + 1}年4月`);
  const scenarios = [
    { name: "令和8年3月退職（改正前）", startAge: 30, entryYear: 2000, entryMonth: 4, retire: [2026, 3], early: [1.714, 4.286], late: [1.38, 2.07], lower: 6, upper: 1.714 },
    { name: "令和8年4月退職（附則第3条）", startAge: 30, entryYear: 2000, entryMonth: 5, retire: [2026, 4], early: [2, 5], late: [1.532, 2.298], lower: 7, upper: 2 },
    { name: "令和9年4月退職（附則第4条）", startAge: 30, entryYear: 2001, entryMonth: 5, retire: [2027, 4], early: [2.286, 5.714], late: [1.684, 2.526], lower: 8, upper: 2.286 },
    { name: "令和10年3月退職（附則第4条）", startAge: 30, entryYear: 2002, entryMonth: 4, retire: [2028, 3], early: [2.286, 5.714], late: [1.684, 2.526], lower: 8, upper: 2.286 },
    { name: "令和10年4月退職（新制度）", startAge: 30, entryYear: 2002, entryMonth: 5, retire: [2028, 4], newSys: true },
    { name: "令和12年10月退職（新制度）", startAge: 30, entryYear: 2004, entryMonth: 11, retire: [2030, 10], newSys: true },
  ];
  let ypCount = 0;
  for (const s of scenarios) {
    const r = await run(s);
    if (r.err) {
      check(false, `${s.name}：エラー ${r.err}`);
      continue;
    }
    const [ry, rm] = s.retire,
      // 退職の翌月の年度（4月〜翌3月）
      nextY = rm === 12 ? ry + 1 : ry,
      nextM = rm === 12 ? 1 : rm + 1,
      civil = civilAge(nextM < 4 ? nextY - 1 : nextY),
      early = 60 - 56,
      late = civil - 60,
      Pc = r.P; // 1曹は3佐の最高号俸より低いので上限はかからない
    if (!s.newSys) {
      const [a, b] = rateEarly(early),
        [c, d] = rateLate(late),
        exp = [Math.floor(Pc * early * s.early[0] * a), Math.floor(Pc * early * s.early[1] * b), Math.floor(Pc * late * s.late[0] * c), Math.floor(Pc * late * s.late[1] * d)];
      check(r.pays.length === 4, `${s.name}：支給回数 ${r.pays.length}（期待 4）`);
      exp.forEach((e, i) => check(r.pays[i]?.amount === e, `${s.name}：${i + 1}回目 ${r.pays[i]?.amount}（期待 ${e}。俸給月額 ${Pc}、前期${early}年・後期${late}年）`));
      check(r.pays[0]?.label.includes(firstMonth(ry, rm)), `${s.name}：1回目の支給月 ${r.pays[0]?.label}（期待 ${firstMonth(ry, rm)}）`);
      check(r.pays[1]?.label.includes(`${ry + 2}年8月`), `${s.name}：2回目の支給月 ${r.pays[1]?.label}（期待 ${ry + 2}年8月）`);
      // 所得による調整：給与年額相当額 G＝俸給×12＋（俸給＋俸給×5％）×2.55＋（俸給×1.05）×2.125（1曹は階級による加算5％。扶養手当・営外手当なし）
      const G = Pc * 12 + Math.floor(Pc + Pc * 0.05) * 2.55 + Math.floor(Pc * 1.05) * 2.125,
        L = G - Pc * s.lower,
        U = G - Pc * s.upper,
        I = Math.round((L + U) / 2 / 10000) * 10000;
      const r2 = await run({ ...s, income: I / 10000 });
      const exp2 = Math.floor((exp[1] * (U - I)) / (U - L));
      check(r2.pays[1]?.amount === exp2, `${s.name}：年収${I}円のときの2回目 ${r2.pays[1]?.amount}（期待 ${exp2}。下限 ${L}・上限 ${U}）`);
      check(r2.pays[0]?.amount === exp[0], `${s.name}：年収${I}円のときの1回目は満額 ${r2.pays[0]?.amount}（期待 ${exp[0]}）`);
      // 上限と給与年額相当額の間：2回目は0、1回目の一部を返納
      const I3 = Math.round((U + G) / 2 / 10000) * 10000,
        r3 = await run({ ...s, income: I3 / 10000 }),
        exp3 = exp[0] - Math.floor((exp[0] * (I3 - U)) / (G - U));
      check(r3.pays[1]?.amount === 0 && r3.pays[0]?.amount === exp3, `${s.name}：年収${I3}円のとき 1回目 ${r3.pays[0]?.amount}・2回目 ${r3.pays[1]?.amount}（期待 ${exp3}・0）`);
      ypCount += 4;
    } else {
      // 新制度：前期 2.25・4.5・2.25、後期 1.15・2.3・1.15。政令の率は掛けない（2028-04-01 施行版の第27条の3第2項・附則第12項）
      const exp = [2.25, 4.5, 2.25].map((k) => Math.floor(Pc * early * k)).concat([1.15, 2.3, 1.15].map((k) => Math.floor(Pc * late * k)));
      check(r.pays.length === 6, `${s.name}：支給回数 ${r.pays.length}（期待 6）`);
      exp.forEach((e, i) => check(r.pays[i]?.amount === e, `${s.name}：${i + 1}回目 ${r.pays[i]?.amount}（期待 ${e}）`));
      check(r.pays[0]?.label.includes(firstMonth(ry, rm)), `${s.name}：1回目の支給月 ${r.pays[0]?.label}（期待 ${firstMonth(ry, rm)}）`);
      // 所得による調整（第27条の4）：加算調整上限額 A＝G＋退職前5年間の各年の対象の手当の合計のうち最も高い額。
      // この試算は手当を選んでいないので、対象は勤勉手当だけ（第27条の4第1項に勤勉手当が含まれる）。55歳以後は昇給しないので
      // 退職前の1年（6月・12月）が最も高い：1回＝（俸給＋俸給×5％）×1.035（令和9年度以後の標準の成績率。人事院規則9-40）
      // 給与年額調整額 Y＝A（仮定「上限」）、下限 L＝G−9P、支給調整上限額 U＝Y−3P。2回目＝満額−0.75×合計×（I−L）÷（A−L）
      const G = Pc * 12 + Math.floor(Pc + Pc * 0.05) * 2.55 + Math.floor(Pc * 1.05) * 2.125,
        kinbenYear = 2 * Math.floor((Pc + Math.floor(Pc * 0.05)) * 1.035),
        L = G - 9 * Pc,
        A = G + kinbenYear,
        U = A - 3 * Pc,
        T = exp[0] + exp[1] + exp[2],
        I = Math.round((L + (L + U) / 2) / 2 / 10000) * 10000,
        r2 = await run({ ...s, income: I / 10000 }),
        d = Math.floor((0.75 * T * (I - L)) / (A - L)),
        exp2 = I >= U ? 0 : Math.max(0, exp[1] - d);
      check(r2.pays[1]?.amount === exp2, `${s.name}：年収${I}円のときの2回目 ${r2.pays[1]?.amount}（期待 ${exp2}。下限 ${L}・支給調整上限額 ${U}）`);
      // 60歳になる年の前年の所得で3回目：0.25×合計×（I−L）÷（A−L）を引く
      const r3 = await run({ ...s, incomeY59: I / 10000 }),
        exp3 = Math.max(0, exp[2] - Math.floor((0.25 * T * (I - L)) / (A - L)));
      check(r3.pays[2]?.amount === exp3 && r3.pays[1]?.amount === exp[1], `${s.name}：60歳の前年の年収${I}円のとき 2回目 ${r3.pays[1]?.amount}・3回目 ${r3.pays[2]?.amount}（期待 ${exp[1]}・${exp3}）`);
      ypCount += 6;
    }
    check(/56歳で定年/.test(r.sticky), `${s.name}：上部の表示 ${r.sticky}`);
  }
  console.log(`給付金：${scenarios.length} 通りの退職時期、各回の額 ${ypCount} 件と所得調整`);

  // ---- 5b. 再就職の年収を0円〜2,000万円まで1万円刻み（2,001通り）で、令和9年度の退職と令和10年度以後の退職の1回目・2回目を確かめる ----
  //          画面の計算（ボタンを押したときと同じ計算）を年収ごとに実行し、独立した式と比べる
  if (!process.argv.includes("--quick")) {
    for (const s of [scenarios[2], scenarios[4]]) {
      const base = await run({ ...s, income: 0 }),
        Pc = base.P,
        early = 4,
        G = Pc * 12 + Math.floor(Pc + Pc * 0.05) * 2.55 + Math.floor(Pc * 1.05) * 2.125,
        full = base.pays.map((p) => p.amount);
      const incomes = Array.from({ length: 2001 }, (_, i) => i * 10000);
      const res = await page.evaluate(async (incomes) => {
        const g = (id) => document.getElementById(id),
          out = [];
        for (const v of incomes) {
          g("reemployIncome").value = String(v / 10000);
          g("simLaunch").click();
          const rows = [...document.querySelectorAll("#retireRows tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim()));
          const pays = rows.filter((r) => r[0].startsWith("若年定年退職者給付金") && /回目/.test(r[0])).map((r) => Number(r[1].replace(/[^0-9]/g, "")));
          out.push(pays.slice(0, 2));
        }
        return out;
      }, incomes);
      let bad = 0;
      incomes.forEach((I, i) => {
        let e1, e2;
        if (!s.newSys) {
          const L = G - Pc * s.lower,
            U = G - Pc * s.upper;
          e1 = I <= U ? full[0] : I >= G ? 0 : full[0] - Math.floor((full[0] * (I - U)) / (G - U));
          e2 = I <= L ? full[1] : I >= U ? 0 : Math.floor((full[1] * (U - I)) / (U - L));
        } else {
          const kinbenYear = 2 * Math.floor((Pc + Math.floor(Pc * 0.05)) * 1.035),
            L = G - 9 * Pc,
            A = G + kinbenYear,
            Y = A,
            U = Y - 3 * Pc,
            T = full[0] + full[1] + full[2],
            d = I > L ? Math.floor((0.75 * T * (I - L)) / (A - L)) : 0;
          e2 = I <= L ? full[1] : I >= U ? 0 : Math.max(0, full[1] - d);
          e1 = I >= Y ? 0 : I > U ? Math.max(0, full[0] - Math.max(0, d - full[1])) : full[0];
        }
        if (res[i][0] !== e1 || res[i][1] !== e2) {
          bad++;
          if (bad <= 5) check(false, `${s.name}：年収${I}円 1回目 ${res[i][0]}・2回目 ${res[i][1]}（期待 ${e1}・${e2}）`);
        } else ok++;
      });
      if (bad > 5) check(false, `${s.name}：ほか ${bad - 5} 件の不一致`);
      console.log(`${s.name}：再就職の年収 0〜2,000万円を1万円刻み ${incomes.length} 通り`);
    }
  }

  // ---- 6. 自己都合退職：年齢を指定でき、上部の表示が「自己都合退職」になり、給付金は対象外 ----
  const self = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    g("retireReason").value = "self";
    g("retireReason").dispatchEvent(new Event("change", { bubbles: true }));
    g("selfRetireAge").value = "45";
    g("simLaunch").click();
    return { sticky: g("stickyRank").textContent, yp: g("youngPension").textContent, err: g("simError").textContent, hidden: g("selfRetireAgeWrap").hidden };
  });
  check(!self.err && !self.hidden && /45歳で自己都合退職/.test(self.sticky) && self.yp === "対象外", `自己都合退職：${JSON.stringify(self)}`);

  // ---- 7. 航海手当は所属で絞らない（防衛省給与法第17条：自衛隊が使う艦船に乗り組む自衛官）。
  //         指定場所生活調整金は一般曹候補生・任期制だけ（同法第26条の2）。幹部候補生では年数を選んでも加えない ----
  const misc = await page.evaluate(() => {
    const g = (id) => document.getElementById(id),
      set = (id, v) => {
        g(id).value = String(v);
        g(id).dispatchEvent(new Event("change", { bubbles: true }));
      };
    set("retireReason", "teinen");
    const kinds = {};
    for (const b of ["ground", "maritime", "air"]) {
      set("branch", b);
      kinds[b] = [...g("allowanceKind").options].some((o) => o.value === "航海手当");
    }
    set("branch", "ground");
    const total = (entry, years) => {
      set("entryType", entry);
      set("targetRank", entry === "sotsu" ? "1曹" : "3佐");
      set("barracksYears", years);
      g("simLaunch").click();
      return g("totalIncome").textContent;
    };
    return { kinds, sotsu: [total("sotsu", 0), total("sotsu", 3)], kanko: [total("kanko", 0), total("kanko", 3)] };
  });
  check(misc.kinds.ground && misc.kinds.maritime && misc.kinds.air, `航海手当を陸・海・空で選べる ${JSON.stringify(misc.kinds)}`);
  const yenOf = (s) => Number(s.replace(/[^0-9]/g, ""));
  check(yenOf(misc.sotsu[1]) - yenOf(misc.sotsu[0]) === 600000, `一般曹候補生の指定場所生活調整金 3年：差 ${yenOf(misc.sotsu[1]) - yenOf(misc.sotsu[0])}（期待 600,000）`);
  check(misc.kanko[0] === misc.kanko[1], `幹部候補生では指定場所生活調整金を加えない ${misc.kanko.join(" / ")}`);

  // ---- 8. 定年の特例・配置手当の期間・追給・通算・公務員・国民健康保険料 ----
  const extra = await page.evaluate(async () => {
    const g = (id) => document.getElementById(id),
      set = (id, v) => {
        g(id).value = String(v);
        g(id).dispatchEvent(new Event("change", { bubbles: true }));
      },
      go = () => {
        g("simLaunch").click();
        return {
          sticky: g("stickyRank").textContent,
          total: Number(g("totalIncome").textContent.replace(/[^0-9]/g, "")),
          yp: g("youngPension").textContent,
          err: g("simError").textContent,
          rows: [...document.querySelectorAll("#retireRows tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim())),
        };
      };
    const out = {};
    set("entryType", "sotsu");
    set("branch", "ground");
    set("entryYear", 2026);
    set("entryMonth", 4);
    set("startAge", 18);
    set("barracksYears", 0);
    // 定年の特例：将で幕僚長など → 62歳、1曹で医療職など → 60歳
    set("targetRank", "将");
    set("retireSpecial", "chief");
    out.chief = go().sticky;
    set("targetRank", "1曹");
    set("retireSpecial", "expert");
    out.expert = go().sticky;
    set("retireSpecial", "none");
    // 配置手当の期間：海上で乗組手当を選び、全期間／入隊5〜10年後
    set("branch", "maritime");
    const sel = g("ba-maritime-crew");
    const none = go().total;
    sel.value = "43";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const full = go().total;
    set("placementFrom", 5);
    set("placementTo", 10);
    const part = go().total;
    set("placementTo", 4);
    out.placementErr = go().err;
    g("placementFrom").value = "";
    g("placementTo").value = "";
    sel.value = "none";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    set("branch", "ground");
    out.placement = { none, full, part };
    // 通算：40歳入隊は1曹に届かず2曹の55歳定年（15年）で対象外。以前の自衛官の期間6年を足すと21年で対象
    set("startAge", 40);
    out.short = go().yp;
    set("prevServiceYears", 6);
    out.tsusan = go().yp;
    // 公務員になる → 対象外
    set("publicReemploy", "yes");
    const pub = go();
    out.publicYp = pub.yp;
    out.publicNote = pub.rows.find((r) => r[0] === "若年定年退職者給付金")?.[2] || "";
    set("publicReemploy", "no");
    set("prevServiceYears", 0);
    set("startAge", 18);
    // 国民健康保険料：所得割10％・均等割5万円・平等割3万円・1人・上限113万円、2年分、再就職の給与300万円
    set("reemployIncome", 300);
    set("afterHealth", "kokuhoCalc");
    set("kokuhoRate", 10);
    set("kokuhoPerCapita", 50000);
    set("kokuhoHousehold", 30000);
    set("kokuhoMembers", 1);
    set("kokuhoCap", 1130000);
    set("afterHealthYears", 2);
    const k = go();
    out.kokuho = k.rows.find((r) => r[0] === "退職後の健康保険料") || null;
    out.kokuhoHidden = g("afterHealthYen").closest(".c-unit-input").parentElement.hidden;
    set("afterHealth", "none");
    set("reemployIncome", 0);
    return out;
  });
  check(/62歳で定年/.test(extra.chief), `定年の特例（幕僚長など）：${extra.chief}`);
  check(/60歳で定年/.test(extra.expert), `定年の特例（医療職など・1曹）：${extra.expert}`);
  check(extra.placement.full > extra.placement.part && extra.placement.part > extra.placement.none, `配置手当の期間：なし ${extra.placement.none} < 5〜10年 ${extra.placement.part} < 全期間 ${extra.placement.full}`);
  check(/支給終了/.test(extra.placementErr), `配置手当の期間の入力の誤り：${extra.placementErr}`);
  check(extra.short === "対象外" && extra.tsusan !== "対象外", `通算：16年 ${extra.short}、以前の6年を通算 ${extra.tsusan}`);
  check(extra.publicYp === "対象外" && /公務員/.test(extra.publicNote), `公務員になる：${extra.publicYp}（${extra.publicNote}）`);
  // 国民健康保険料の2年目：前年（退職の翌年）の所得＝給与所得（別表第五）、保険料＝（所得−43万円）×10％＋5万円＋3万円
  {
    const m = extra.kokuho?.[2].match(/(\d{4})年度 ([\d,]+)円（前年の所得 ([\d,]+)円）.*?(\d{4})年度 ([\d,]+)円（前年の所得 ([\d,]+)円）/);
    const y2 = m ? Number(m[4]) : 0,
      inc2 = expSalaryIncome(3000000, y2 - 1),
      exp2 = Math.floor((inc2 - 430000) * 0.1) + 80000;
    check(m && Number(m[6].replace(/,/g, "")) === inc2 && Number(m[5].replace(/,/g, "")) === exp2, `国民健康保険料の2年目：${extra.kokuho?.[2]}（期待 所得 ${inc2}・保険料 ${exp2}）`);
    check(extra.kokuhoHidden, "料率から計算するときは年額の欄を隠す");
  }
  // 追給（第27条の7）：令和9年4月退職、退職の翌年の年収が下限と上限の間、平均が下限以下 → 2回目の満額との差を追給
  {
    const s = scenarios[2];
    const b0 = await run({ ...s, income: 0 }),
      Pc = b0.P,
      G = Pc * 12 + Math.floor(Pc + Pc * 0.05) * 2.55 + Math.floor(Pc * 1.05) * 2.125,
      L = G - Pc * s.lower,
      U = G - Pc * s.upper,
      I = Math.round((L + U) / 2 / 10000) * 10000,
      full2 = b0.pays[1].amount,
      got2 = Math.floor((full2 * (U - I)) / (U - L));
    const t = await page.evaluate(
      async ([s, I, avg]) => {
        const g = (id) => document.getElementById(id),
          set = (id, v) => {
            g(id).value = String(v);
            g(id).dispatchEvent(new Event("change", { bubbles: true }));
          };
        set("targetRank", "1曹");
        set("startAge", s.startAge);
        set("entryYear", s.entryYear);
        set("entryMonth", s.entryMonth);
        set("reemployIncome", I / 10000);
        set("incomeAvg", avg / 10000);
        g("simLaunch").click();
        const rows = [...document.querySelectorAll("#retireRows tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim()));
        g("incomeAvg").value = "";
        set("reemployIncome", 0);
        return rows.find((r) => r[0].includes("追給"))?.[1] || null;
      },
      [s, I, Math.max(0, Math.floor((L - 100000) / 10000) * 10000)],
    );
    check(t && Number(t.replace(/[^0-9]/g, "")) === full2 - got2, `追給：${t}（期待 ${full2 - got2}＝2回目の満額 ${full2}−年収${I}円のときの2回目 ${got2}）`);
  }

  // ---- 9. 育児休業・介護休暇（2026-11-26 に e-Gov・防衛省「両立支援ハンドブック」2026年版・厚生労働省で確認）----
  //   ・育児休業法第5条第2項（給与を支給しない）・第8条（基準日以前6か月に勤務があれば期末・勤勉手当）・第10条（退職手当は3分の1／2分の1を除く）
  //   ・人事院規則9-40第5条第2項第2号（期末：育休の2分の1を除く）・第11条第2項第2号・第10号（勤勉：育休の全期間、介護休暇は30日超で全期間）
  //   ・国家公務員共済組合法第68条の2（育児休業手当金 67％・180日後50％、子が1歳まで）・第68条の4と附則第11条の2（介護休業手当金 67％・66日まで）
  //   ・同法第40条（標準報酬の日額は月額の22分の1、5円未満切捨て・5円以上は10円に切上げ）・第100条の2（育児休業中の掛金の免除）
  //   ・上限：育児休業給付金 332,454円（67％）・248,100円（50％）、介護休業給付金 366,222円（令和8年8月1日から。厚生労働省）
  //   期間割合は規則9-40の表（期末：6か月100％・5か月以上80％・3か月以上60％・3か月未満30％、勤勉：別表第二）
  const leave = await page.evaluate(() => {
    const g = (id) => document.getElementById(id),
      set = (id, v) => {
        g(id).value = String(v);
        g(id).dispatchEvent(new Event("change", { bubbles: true }));
      },
      run = () => {
        g("simLaunch").click();
        const x = window.salarySimulatorTax.lastModel;
        return {
          err: g("simError").textContent,
          years: x.retire.years,
          m: x.monthly.map((k) => ({ pay: k.pay, basePay: k.basePay, social: k.social, bonus: k.bonus, kinben: k.kinben, benefit: k.benefit || 0, support: k.support || 0, std: k.stdShort, allowances: k.allowances, rank: k.rank })),
          events: x.monthly.flatMap((k, i) => k.promotions.map((p) => ({ month: i, to: p.to }))),
          adjust: x.retire.adjust,
          detail: g("deductionDetail").textContent,
        };
      };
    set("entryType", "sotsu");
    set("branch", "ground");
    set("targetRank", "1曹");
    set("startAge", 18);
    set("entryYear", 2026);
    set("entryMonth", 4);
    set("barracksYears", 0);
    set("retireReason", "teinen");
    set("reemployIncome", 0);
    const out = {};
    g("ikujiAge").value = "";
    g("kaigoAge").value = "";
    out.base = run();
    set("ikujiMonths", 12);
    set("ikujiAge", 31);
    out.ikuji = run();
    // 手当金の延長（2歳まで）と、育児休業支援手当金を受けない場合
    set("ikujiAge", 30);
    set("ikujiMonths", 24);
    set("ikujiExtend", 24);
    set("ikujiSupport", "no");
    out.extend = run();
    set("ikujiExtend", 12);
    set("ikujiSupport", "yes");
    set("ikujiMonths", 12);
    g("ikujiAge").value = "";
    set("kaigoMonths", 6);
    set("kaigoAge", 45);
    out.kaigo = run();
    // 自己都合で40歳に退職（勤続22年）。30歳から12か月の育児休業で、勤続期間から4か月を除いて21年になる
    set("kaigoAge", "");
    set("retireReason", "self");
    set("selfRetireAge", 40);
    out.selfBase = run().years;
    set("ikujiAge", 30);
    const si = run();
    out.selfIkuji = si.years;
    out.selfIkujiAdjust = si.adjust;
    g("ikujiAge").value = "";
    out.selfBaseAdjust = run().adjust;
    // 調整額の上位60か月に育休が入る場合：35歳から36か月休み、40歳で自己都合退職
    set("ikujiMonths", 36);
    set("ikujiAge", 35);
    {
      const r = run(),
        x = window.salarySimulatorTax.lastModel;
      out.longAdjust = {
        adjust: r.adjust,
        err: r.err,
        rows: x.monthly.map((k) => ({ amount: k.col === 0 ? null : (window.RULES.retirement.adjustMonthly[k.col] ?? 0), ikuji: k.leave?.kind === "ikuji", idx: k.leave?.idx })),
        years: r.years,
      };
    }
    set("ikujiMonths", 12);
    set("ikujiAge", 30);
    // 入力の誤り：月数の上限と重なり
    set("ikujiMonths", 37);
    g("simLaunch").click();
    out.errMax = g("simError").textContent;
    set("ikujiMonths", 12);
    set("kaigoMonths", 3);
    set("kaigoAge", 30);
    g("simLaunch").click();
    out.errOverlap = g("simError").textContent;
    g("ikujiAge").value = "";
    g("kaigoAge").value = "";
    set("retireReason", "teinen");
    // 医師・歯科医師である自衛官の昇給抑制は57歳から（防衛省給与法施行令第6条の16第1項）。1曹で60歳定年（特例）、標準の4号俸の昇給
    set("targetRank", "1曹");
    set("startAge", 38);
    const grades = (sp) => {
      set("retireSpecial", sp);
      g("simLaunch").click();
      const x = window.salarySimulatorTax.lastModel;
      return { err: g("simError").textContent, retire: x.monthly.length / 12 + 38, g: x.monthly.map((k) => k.grade) };
    };
    out.doctor = grades("doctor");
    out.expertG = grades("expert");
    set("retireSpecial", "none");
    set("startAge", 18);
    return out;
  });
  {
    const B = leave.base.m,
      I = leave.ikuji.m,
      K = leave.kaigo.m,
      from = (31 - 18) * 12,
      from30 = (30 - 18) * 12,
      kfrom = (45 - 18) * 12,
      day = (std) => {
        const v = std / 22,
          r = Math.floor(v / 10) * 10;
        return v - r >= 5 ? r + 10 : r;
      },
      kimatsuP = (mo) => (mo >= 6 ? 1 : mo >= 5 ? 0.8 : mo >= 3 ? 0.6 : 0.3),
      kinbenP = (half) => (half >= 12 ? 1 : [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95][half]),
      near = (a, b) => Math.abs(a - b) <= 1;
    check(!leave.base.err && !leave.ikuji.err && !leave.kaigo.err, `育休・介護休暇の計算でエラーが出ない ${leave.ikuji.err}${leave.kaigo.err}`);
    // 育児休業の12か月：給与0・掛金0、手当金は6か月67％・6か月50％（上限あり）。
    // 最初の月は育児休業支援手当金（標準報酬の日額の13％×20日。日額の上限 2,932円）を足す（第68条の3）
    for (let k = 0; k < 12; k++) {
      const x = I[from + k],
        rate = k < 6 ? 0.67 : 0.5,
        cap = k < 6 ? 332454 : 248100,
        support = k === 0 ? Math.min(Math.floor(day(x.std) * 0.13), 2932) * 20 : 0,
        expect = Math.min(Math.floor(day(x.std) * rate) * 22, cap) + support;
      check(x.support === support, `育休${k + 1}か月目の育児休業支援手当金 ${x.support}（期待 ${support}）`);
      check(x.pay === 0 && x.allowances === 0 && x.social === 0, `育休${k + 1}か月目：俸給 ${x.pay}・手当 ${x.allowances}・掛金 ${x.social}（期待 すべて0）`);
      check(x.benefit === expect, `育休${k + 1}か月目の育児休業手当金 ${x.benefit}（期待 ${expect}：標準報酬 ${x.std} の日額×${rate}×22日）`);
    }
    check(I[from + 12].pay > 0 && I[from + 12].benefit === 0, `育休が終わった月は俸給が出て、手当金はない ${I[from + 12].pay}`);
    // 昇任の遅れ：育休（30歳から24か月）の中にある昇任は、復帰後の最初の機会（年1回）まで遅れる（防衛省「両立支援ハンドブック」Q7）。
    // 昇任後の号俸は昇任時の号俸で決まるので、階級だけを比べる
    {
      const rk = (e) => e.to.split(" ")[0],
        be = leave.base.events.filter((e) => e.month >= from30),
        ie = leave.extend.events.filter((e) => e.month >= from30),
        hit = be.find((e) => e.month < from30 + 24);
      if (hit) {
        const d = Math.ceil((from30 + 24 - hit.month) / 12) * 12;
        check(ie[0] && ie[0].month === hit.month + d && rk(ie[0]) === rk(hit), `育休中の昇任（${hit.to}、入隊${hit.month}か月）は ${ie[0]?.month}か月に遅れる（期待 ${hit.month + d}）`);
        const end = leave.base.m.length;
        check(
          be.filter((e) => e.month + d < end).every((e, i) => ie[i] && ie[i].month === e.month + d && rk(ie[i]) === rk(e)),
          `後の昇任も同じだけ遅れる：${be.map((e) => e.month).join(",")} → ${ie.map((e) => e.month).join(",")}`,
        );
        check(/遅らせて計算しています/.test(leave.extend.detail) && !/遅らせて/.test(leave.ikuji.detail), `昇任を遅らせた案内が出る：${leave.extend.detail.slice(0, 120)}`);
      } else check(false, "育休の期間に昇任が入る条件になっていない（テストの条件を見直す）");
    }
    // 手当金の延長（2歳まで）：24か月とも手当金があり、7か月目以後は50％。支援手当金なし
    {
      const E = leave.extend.m;
      check(!leave.extend.err, `延長の計算でエラーが出ない ${leave.extend.err}`);
      for (const k of [0, 12, 17, 18, 23]) {
        const x = E[from30 + k],
          rate = k < 6 ? 0.67 : 0.5,
          expect = Math.min(Math.floor(day(x.std) * rate) * 22, k < 6 ? 332454 : 248100);
        check(x.benefit === expect && x.support === 0, `延長：育休${k + 1}か月目の手当金 ${x.benefit}（期待 ${expect}）・支援手当金 ${x.support}（期待 0）`);
      }
      check(E[from30 + 24].benefit === 0, `育休が終われば手当金はない ${E[from + 24].benefit}`);
    }
    // 賞与：31歳の6月（基準日以前6か月のうち育休2か月）→ 期末 5か月80％・勤勉 4か月70％。12月は6か月とも育休で支給なし。
    //   翌年6月（育休4か月）→ 期末 4か月60％・勤勉 2か月30％
    const jun = from + 2,
      dec = from + 8,
      jun2 = from + 14,
      part = (x) => ({ kimatsu: x.bonus - x.kinben, kinben: x.kinben });
    for (const [m, km, kn, label] of [
      [jun, 5, 8, "31歳の6月"],
      [jun2, 4, 4, "32歳の6月"],
    ]) {
      const b = part(B[m]),
        i = part(I[m]);
      check(near(i.kimatsu, Math.floor(b.kimatsu * kimatsuP(km))), `${label}の期末手当 ${i.kimatsu}（期待 ${b.kimatsu}×${kimatsuP(km)}）`);
      check(near(i.kinben, Math.floor(b.kinben * kinbenP(kn))), `${label}の勤勉手当 ${i.kinben}（期待 ${b.kinben}×${kinbenP(kn)}）`);
    }
    check(I[dec].bonus === 0, `31歳の12月は基準日以前6か月がすべて育休なので賞与なし ${I[dec].bonus}`);
    // 退職手当の勤続期間：自己都合40歳（22年）→ 育休12か月で4か月を除いて21年
    check(leave.selfBase === 22 && leave.selfIkuji === 21, `退職手当の勤続年数 ${leave.selfBase} → ${leave.selfIkuji}（期待 22 → 21）`);
    // 調整額：育休の月は休職月等として一部を除くが、上位60か月に入らない月なので、調整額は変わらない（施行令第6条第3項第2号）
    {
      // 条文どおりに数え直す：区分（調整月額）ごとに、子が1歳の月まで（休み始めから13か月）は3分の1、その後は2分の1（切り上げ）を最初の月から除き、
      // 残りの上位60か月を合計。自己都合で勤続10〜24年は2分の1（退職手当法第6条の4第1項・第4項第3号、施行令第6条第3項）
      const L = leave.longAdjust,
        out = new Set();
      for (const u of [true, false]) {
        const groups = {};
        L.rows.forEach((r, i) => {
          if (r.ikuji && r.idx < 13 === u) (groups[r.amount] ||= []).push(i);
        });
        for (const list of Object.values(groups)) list.slice(0, Math.ceil(list.length / (u ? 3 : 2))).forEach((i) => out.add(i));
      }
      const top = L.rows
          .filter((r, i) => !out.has(i))
          .map((r) => r.amount)
          .sort((a, b) => b - a)
          .slice(0, 60)
          .reduce((a, b) => a + b, 0),
        expect = L.years >= 10 && L.years <= 24 ? Math.floor(top / 2) : top;
      check(!L.err && L.adjust === expect && out.size === 5 + 12, `35歳から36か月の育休・40歳自己都合の調整額 ${L.adjust}（期待 ${expect}、除く月 ${out.size}（期待 17））`);
    }
    check(leave.selfIkujiAdjust === leave.selfBaseAdjust, `退職手当の調整額 ${leave.selfIkujiAdjust}（期待 ${leave.selfBaseAdjust}。除く月は上位60か月の外）`);
    // 介護休暇の6か月：俸給0、掛金はかかる、手当金は66日（3か月分）まで67％
    for (let k = 0; k < 6; k++) {
      const x = K[kfrom + k],
        expect = k < 3 ? Math.min(Math.floor(day(x.std) * 0.67) * 22, 366222) : 0;
      check(x.pay === 0 && x.social > 0, `介護休暇${k + 1}か月目：俸給 ${x.pay}・掛金 ${x.social}（期待 俸給0・掛金あり）`);
      check(x.benefit === expect, `介護休暇${k + 1}か月目の介護休業手当金 ${x.benefit}（期待 ${expect}）`);
    }
    // 介護休暇の勤勉手当：45歳の6月は介護2か月（44日＞30日）→ 勤務期間4か月 70％、期末手当は減らない
    const kj = kfrom + 2,
      bk = part(B[kj]),
      ik = part(K[kj]);
    check(ik.kimatsu === bk.kimatsu && near(ik.kinben, Math.floor(bk.kinben * kinbenP(8))), `45歳の6月：期末 ${ik.kimatsu}（期待 ${bk.kimatsu}）・勤勉 ${ik.kinben}（期待 ${bk.kinben}×0.7）`);
    {
      // 入隊4月・38歳（1曹の最高号俸に届かないように）。55歳・56歳の1月は、医師は昇給し（標準4号俸）、それ以外の医療職は昇給しない（標準は0）。
      // 57歳の1月は医師も抑制で0（1曹の最高号俸に届いていないことも確かめる）
      const D = leave.doctor,
        X = leave.expertG,
        at = (a) => (a - 1 - 38) * 12 + 9;
      check(!D.err && !X.err && D.retire === 60 && X.retire === 60, `医師・医療職とも60歳定年 ${D.retire}・${X.retire} ${D.err}${X.err}`);
      for (const a of [56, 57]) check(D.g[at(a)] - D.g[at(a) - 1] === 4 && X.g[at(a)] - X.g[at(a) - 1] === 0, `${a - 1}歳の1月の昇給：医師 ${D.g[at(a)] - D.g[at(a) - 1]}号俸（期待 4）・医療職 ${X.g[at(a)] - X.g[at(a) - 1]}号俸（期待 0）`);
      check(D.g[at(58)] - D.g[at(58) - 1] === 0 && D.g[at(58)] < 160, `57歳の1月は医師も抑制 ${D.g[at(58)] - D.g[at(58) - 1]}号俸（期待 0、号俸 ${D.g[at(58)]}）`);
    }
    check(/1〜36か月/.test(leave.errMax), `育休の月数の上限の案内：${leave.errMax}`);
    check(/重なっています/.test(leave.errOverlap), `育休と介護休暇の重なりの案内：${leave.errOverlap}`);
  }

  // ---- 10. 再就職の年収のグラフ（令和10年4月以後の退職は3回目も含む。第27条の4第4項・附則第12項）----
  //   60歳になる年の前年の年収が空欄なら同じ年収が続くとして、グラフの額が結果の1〜3回目の合計と一致すること
  {
    const chart = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id),
        set = (id, v) => {
          g(id).value = String(v);
          g(id).dispatchEvent(new Event("change", { bubbles: true }));
        },
        out = [];
      set("entryType", "sotsu");
      set("branch", "ground");
      set("targetRank", "1曹");
      set("startAge", 18);
      set("entryYear", 2026);
      set("entryMonth", 4);
      set("retireReason", "teinen");
      for (const inc of [0, 300, 500, 700, 900, 1200]) {
        set("reemployIncome", inc);
        g("simLaunch").click();
        const sum = [...document.querySelectorAll("#retireRows tr")]
          .filter((tr) => /給付金 [123]回目（/.test(tr.cells[0].textContent))
          .reduce((t, tr) => t + Number(tr.cells[1].textContent.replace(/[^0-9]/g, "")), 0);
        out.push({ inc, sum, text: g("reemploySummary").textContent });
      }
      set("reemployIncome", 0);
      g("simLaunch").click();
      return out;
    });
    for (const { inc, sum, text } of chart) {
      const m = text.match(/では ([0-9,]+)円 です/),
        shown = m ? Number(m[1].replace(/,/g, "")) : NaN;
      check(shown === sum, `年収${inc}万円：グラフの額 ${shown}（期待 結果の1〜3回目の合計 ${sum}）`);
    }
    check(/満額（15,771,600円）/.test(chart[0].text), `満額は438,100円×4年×9か月＝15,771,600円：${chart[0].text.slice(0, 60)}`);
  }

  for (const e of errors) check(false, "ページのエラー: " + e);
  await browser.close();
  server.close();
  console.log(`\n${ng ? "NG" : "OK"} ${ok} / NG ${ng}`);
  process.exit(ng ? 1 : 0);
})();
