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

  for (const e of errors) check(false, "ページのエラー: " + e);
  await browser.close();
  server.close();
  console.log(`\n${ng ? "NG" : "OK"} ${ok} / NG ${ng}`);
  process.exit(ng ? 1 : 0);
})();
