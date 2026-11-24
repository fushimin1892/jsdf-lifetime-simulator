// data の数値を e-Gov の条文と照合するための一覧（tools/egov-check.js values が使う）。
// 1件ごとに「どの法令の、どの条・表・附則に、どんな文言があるはずか」を書く。
// 文言は data の値から作るので、data と法令のどちらかが変わると「NG」になる。
//   law：data/sources.js の laws の key
//   article：条の番号（e-Gov の Num。第十九条の四 → "19_4"）、"別表第五" などの別表、
//            "附則"（制定時の附則の項）、"附則(平成一五年六月四日法律第六二号)"（その改正法の附則）
//   expect：次のどれか（複数可。すべてあれば一致）
//     文字列           … その文言。前後に数字（漢数字・「・」）が続く所には一致しない（「百分の十」は「百分の十八」に一致しない）
//     RegExp           … 正規表現（下の P() で作る。区分と値を組で書く）
//     { spaced: RegExp } … 同上（以前の書き方）
//     { seq: [...] }   … 文字列・正規表現が、この順に出てくること（区分の並びの入れ替えに気づくため）
//     { row: 手当名, text | seq } … 別表第五の、その手当の行の中で探す
//   本文は表のセルや号の区切りを空白1つで残した形（spaced）で照合する。文字列の中の空白の有無は問わない。
// e-Gov にない値（防衛大臣の訓令で決まる割合、年金・共済・税の公表額など）は manual に書き、毎月の点検で人が確かめる。
"use strict";

// ---- 数を法令の書き方にする ----
const D = "〇一二三四五六七八九";
function kanjiInt(n) {
  if (n === 0) return "〇";
  const unit = ["", "十", "百", "千"];
  const four = (x) => {
    let s = "";
    String(x)
      .padStart(4, "0")
      .split("")
      .forEach((c, i) => {
        const d = Number(c);
        const u = unit[3 - i];
        if (!d) return;
        s += (d === 1 && u ? "" : D[d]) + u;
      });
    return s;
  };
  let s = "";
  const oku = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  if (oku) s += four(oku) + "億";
  if (man) s += four(man) + "万";
  if (rest) s += four(rest);
  return s;
}
// 小数：整数部は漢数字、小数部は1けたずつ（二・五七一、〇・九九五一九二）。places を渡すと、その桁数まで〇で埋める（〇・九九三五九〇）
function kanjiNum(x, places) {
  let [i, f] = String(+x.toFixed(6)).split(".");
  if (places) f = (f || "").padEnd(places, "0");
  return kanjiInt(Number(i)) + (f ? "・" + f.split("").map((c) => D[Number(c)]).join("") : "");
}
const yen = (n) => kanjiInt(n) + "円";
const pct = (rate) => "百分の" + kanjiNum(+(rate * 100).toFixed(6)); // 0.43 → 百分の四十三
const days = (n) => kanjiInt(n) + "日";
const nen = (n) => kanjiInt(n) + "年";
// 表の中の額は「五九、一〇〇円」のように1けたずつの漢数字と「、」で書かれている
function digitYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/[0-9,]/g, (c) => (c === "," ? "、" : D[Number(c)])) + "円";
}

// ---- 境界つきの正規表現 ----
// 数の一部とみなす文字。これが前後に続く所には一致させない（「千円」が「三千円」に、「百分の十」が「百分の十八」に一致しない）
const NUM = "〇一二三四五六七八九十百千万億・0-9０-９";
const isNum = (c) => new RegExp(`[${NUM}]`).test(c);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 文字列を「空白の有無を問わない」正規表現の部品にする（数字どうしの間は区切りを残すため空白必須）
const loose = (s) =>
  s
    .replace(/\s+/g, "")
    .split("")
    .map(esc)
    .join(" ?");
// P(部品, ...)：部品（文字列、または { re: "正規表現" }）を空白の有無を問わずにつなぐ。
// 文字列の部品は、数字で始まるなら直前に、数字で終わるなら直後に数字が続かないこと（部品が途中にあっても同じ）
function P(...parts) {
  let src = "";
  parts.forEach((p, i) => {
    if (i) src += " ?";
    if (typeof p !== "string") return (src += p.re);
    const t = p.replace(/\s+/g, "");
    src += (isNum(t[0]) ? `(?<![${NUM}])` : "") + loose(t) + (isNum(t.slice(-1)) ? `(?![${NUM}])` : "");
  });
  return new RegExp(src);
}
const CELL = { re: "(?<![^ ])" }; // 表のセル・号の始まり（直前が空白か本文の先頭）
const ANY = (n = 200) => ({ re: `[^]{0,${n}}?` }); // 間に何があってもよい（n 文字まで）

// ---- 照合の一覧 ----
function build(R, W) {
  const A = R.allowances;
  const B = R.bonus;
  const RT = R.retirement;
  const YP = R.youngPension;
  const E = R.entry;
  const list = [];
  const add = (area, what, law, article, expect) => list.push({ area, what, law, article, expect: [].concat(expect) });
  const fail = (area, what) => list.push({ area, what, fail: true });

  // 手当
  add("手当", "営外手当の月額 allowances.eigai", "boeiKyuyo", "18", "月額" + yen(A.eigai));
  add("手当", "指定場所生活調整金 allowances.barracksBonus", "boeiKyuyoRei", "19_2", P("指定場所生活調整金の額は、", yen(A.barracksBonus), "とする"));
  // 配置手当（施行令第12条）：各手当の項（「法第十六条第三項の◯◯の月額」から次の項まで）の中に、その割合があること。
  // 選択肢の表示の「◯％」と値が同じこと、同じ手当で同じ割合が2つないことも確かめる
  const PARA = { crew: "乗組手当", para: "落下傘隊員手当", paraTrainee: "落下傘隊員手当", sof: "特殊作戦隊員手当", sbu: "特別警備隊員手当", atc: "航空管制官手当" };
  for (const [key, p] of Object.entries(A.placement)) {
    const seen = new Set();
    for (const [v, label] of p.options) {
      const rate = Number(String(v).split(":").pop());
      const shown = String(label).match(/([0-9.]+)％/)?.[1];
      if (shown != null && Number(shown) !== rate) fail("手当", `${p.name}の選択肢「${label}」の表示 ${shown}％ と値 ${v} が違う allowances.placement.${key}`);
      if (seen.has(rate)) fail("手当", `${p.name}の割合 ${rate}％ が2つある allowances.placement.${key}`);
      seen.add(rate);
      // 航空手当の選択肢は「90％・70％ × 乗員の区分の割合（訓令）」なので、法令にあるのは90と70だけ（下で照合）
      if (key === "aviation") continue;
      add("手当", `${p.name}の割合 ${v}％ allowances.placement.${key}`, "boeiKyuyoRei", "12", P(`法第十六条第三項の${PARA[key]}の月額`, { re: "(?:(?!法第十六条第三項の)[^])*?" }, pct(rate / 100)));
    }
  }
  add("手当", "航空手当のジェット機・その他の割合（90％・70％）", "boeiKyuyoRei", "12", P("ジェット機の乗員にあつては", pct(0.9), "を、その他の乗員にあつては", pct(0.7)));
  // 3佐以上の配置手当で最低号俸に掛ける割合（訓令）は、施行令第12条の「百分の九十四・二の範囲内」を超えないこと
  const seniorMax = Math.max(...Object.values(A.seniorRate));
  add("手当", `3佐以上の配置手当の割合の上限 94.2％（allowances.seniorRate の最大 ${seniorMax * 100}％）`, "boeiKyuyoRei", "12", P(pct(0.942), "の範囲内において防衛大臣が定める割合"));
  if (seniorMax > 0.942 + 1e-9) fail("手当", `allowances.seniorRate の最大 ${seniorMax} が施行令第12条の上限 0.942 を超える`);
  // 俸給の特別調整額（施行令 別表第四）：自衛官の欄の月額
  // 表は「陸将補（二） 海将補（二） 空将補（二） 五九、一〇〇円」の形（階級の次の額が、再任用以外の職員の額）
  const MP_RANK = { 2: "陸将補（二）", 3: "一等陸佐（一）", 4: "一等陸佐（二）", 5: "一等陸佐（三）", 6: "二等陸佐", 7: "三等陸佐" };
  for (const [kind, cols] of Object.entries(A.managerPay))
    for (const [col, v] of Object.entries(cols))
      add("手当", `俸給の特別調整額 ${kind}種 ${MP_RANK[col]} ${v}円 allowances.managerPay`, "boeiKyuyoRei", "別表第四", { spaced: new RegExp(`${MP_RANK[col]} [^ ]+ [^ ]+ ${digitYen(v)}`) });
  // 法令で額が決まる手当の区分（allowances.specialRates）。
  // 別表第五の手当は、その手当の行の中に、data の並びの順に額があること（「◯円を超えない範囲内」の区分はその文言と組で）。
  // 4番目の値 monthMax（1月の上限）は、その区分の額の後に「一月に支給する額は、◯円を超え」があること
  // 「◯円を超えない」の区分は、額のすぐ後（かっこ書きをはさんでもよい）に「を超えない」があること。一致の終わりは額の直後（次の区分をかっこ書きの中で探せるように）
  const amountRe = (v, type) => (type === "max" ? P(yen(v), { re: "(?=(?:（[^）]*）|）)?を超えない)" }) : P(yen(v)));
  // data の並びが別表第五の並びと違う手当：法令の並びにしたときの data の行番号（data の並びを法令に合わせたら消す）
  const LAW_ORDER = { 災害派遣等手当: [0, 1, 3, 2] };
  const SOURCE = {
    小笠原手当: ["boeiKyuyoRei", "附則", "小笠原手当を支給する"], // 施行令 附則第3項
    航海手当: ["boeiKyuyoRei", "12_3"],
    管理職員特別勤務手当: ["boeiKyuyoRei", "11_2"],
    在宅勤務等手当: ["ippanKyuyo", "12_3"],
  };
  for (const [name, rows] of Object.entries(A.specialRates)) {
    const src = SOURCE[name];
    for (const [v, text, type, monthMax] of rows) {
      const m = String(text).match(/1月 ([0-9,]+)円まで/);
      if (m && Number(m[1].replace(/,/g, "")) !== monthMax) fail("手当", `${name}「${text}」：表示の1月の上限 ${m[1]}円 と monthMax ${monthMax ?? "なし"} が違う allowances.specialRates`);
    }
    if (src) {
      for (const [v, text, type, monthMax] of rows) {
        let e;
        if (name === "管理職員特別勤務手当") {
          // 「種別が一種の官職を占める職員…… 一万二千円（定年前再任用…）」の組
          const k = String(text).match(/([一二三四五])種/)?.[1];
          // 週休日等の勤務は第2項（種別ごとの職員の区分）、深夜の勤務は第3項（「前項第一号に掲げる職員 六千円（」）
          e = /週休日/.test(text) ? P(`種別が${k}種の官職を占める職員`, { re: "[^円]*?" }, yen(v), "（") : P(`前項第${k}号に掲げる職員`, yen(v), "（");
        } else if (name === "小笠原手当") e = /南鳥島/.test(text) ? P("南鳥島に置かれる官署に所属する者にあつては、", yen(v), "）を超えない") : P("業務一日につき", yen(v), "（");
        else if (name === "在宅勤務等手当" && v === 0)
          // 10日以下は支給されない：第12条の3第1項の「一箇月当たり平均十日を超えて」の要件と照合する
          e = P("一箇月当たり平均十日を超えて命ぜられた職員には、在宅勤務等手当を支給する");
        else e = amountRe(v, type);
        add("手当", `${name}「${text}」 allowances.specialRates`, src[0], src[1], src[2] ? [src[2], e] : e);
        if (monthMax) fail("手当", `${name}「${text}」に monthMax があるが、照合先が別表第五ではない`);
      }
    } else {
      const seq = [];
      const ordered = LAW_ORDER[name] ? LAW_ORDER[name].map((i) => rows[i]) : rows;
      if (LAW_ORDER[name] && LAW_ORDER[name].length !== rows.length) fail("手当", `${name}：value-checks.js の LAW_ORDER の数が data の区分の数と違う`);
      for (const [v, , type, monthMax] of ordered) {
        seq.push(amountRe(v, type));
        if (monthMax) seq.push(P("一月に支給する額は、", yen(monthMax), "を超え"));
      }
      add("手当", `特殊勤務手当 ${name} の区分と額（${rows.map((r) => r[0] + (r[3] ? `／月${r[3]}` : "")).join("・")}円の順） allowances.specialRates`, "boeiKyuyoRei", "別表第五", { row: name, seq });
    }
  }
  // 階級で額が決まる手当（allowances.rankRates）：表の各行（階級の区分）に、その区分の列の額があること
  const NAVY = [["陸将", [0, 1, 2]], ["一等陸佐", [3, 4, 5]], ["二等陸佐", [6, 7]], ["一等陸尉", [8]], ["二等陸尉", [9, 10]], ["准陸尉", [11]], ["陸曹長", [12, 13]], ["二等陸曹", [14, 15]], ["陸士長", [16]], ["一等陸士", [17, 18]]];
  for (const [zone, o] of Object.entries(A.rankRates.航海手当 || {})) {
    const z = Number(zone.slice(-1));
    for (const [label, cols] of NAVY) {
      const vals = new Set(cols.map((c) => o.byCol[c]));
      if (vals.size !== 1) fail("手当", `航海手当 ${zone} ${label} の区分の列で額が違う`);
      // 行は「陸将 海将 陸将補 海将補 一、四一〇円 二、一二〇円 二、六五〇円 三、九八〇円」の形。z 番目の額を見る
      add("手当", `航海手当 第${z}区 ${label}など ${[...vals][0]}円 allowances.rankRates`, "boeiKyuyoRei", "別表第七", { spaced: new RegExp(`(^| )${label}( [^ 円]+){0,7}?( [^ ]+円){${z - 1}} ${digitYen([...vals][0])}`) });
    }
  }
  const HQ = [["一等陸佐以上", [0, 1, 2, 3, 4, 5]], ["二等陸佐、", [6]], ["三等陸佐、", [7]], ["一等陸尉、", [8]], ["二等陸尉以下准陸尉以上", [9, 10, 11]], ["陸曹長以下二等陸曹以上", [12, 13, 14]], ["三等陸曹以下", [15, 16, 17, 18]]];
  for (const o of Object.values(A.rankRates.本府省業務調整手当 || {}))
    for (const [label, cols] of HQ) {
      const vals = new Set(cols.map((c) => o.byCol[c]));
      if (vals.size !== 1) fail("手当", `本府省業務調整手当 ${label} の区分の列で額が違う`);
      add("手当", `本府省業務調整手当 ${label} ${[...vals][0]}円 allowances.rankRates`, "boeiKyuyoRei", "別表第四の二", { spaced: new RegExp(`${label}[^ ]* [^ ]+級(以上)? ${digitYen([...vals][0])}`) });
    }
  // 区分のない手当の初期値も、別表第五のその手当の行にあること
  for (const [name, v] of Object.entries(A.defaultAmount)) add("手当", `特殊勤務手当の初期値 ${name} ${v}円 allowances.defaultAmount`, "boeiKyuyoRei", "別表第五", { row: name, text: P(yen(v)) });
  // 「条件から計算」の手当（一般職給与法・人事院規則・寒冷地手当法）。区分と額を組で照合する
  const CR = A.calcRates;
  add("手当", `扶養手当 子 ${CR.fuyou.child}円・父母等 ${CR.fuyou.parent}円 calcRates.fuyou`, "ippanKyuyo", "11", P("扶養親族たる子」という。）については一人につき", yen(CR.fuyou.child), "、扶養親族たる父母等については一人につき", yen(CR.fuyou.parent)));
  add("手当", `扶養手当 16〜22歳の子の加算 ${CR.fuyou.teenAdd}円 calcRates.fuyou.teenAdd`, "ippanKyuyo", "11", P("満十五歳に達する日後の最初の四月一日から", ANY(120), "前項の規定にかかわらず、", yen(CR.fuyou.teenAdd), "に当該期間にある"));
  // 父母等の扶養手当（防衛省給与法施行令第8条の7・第8条の8 → 一般職給与法第11条第1項・第3項）：0円の列は9級以上相当、額のある列は8級相当
  for (const v of new Set(Object.values(CR.fuyouParentByCol).filter(Boolean)))
    add("手当", `父母等の扶養手当（8級相当の1佐（2）欄）${v}円 calcRates.fuyouParentByCol`, "ippanKyuyo", "11", P("職務の級が八級であるもの", { re: "[^円]*?" }, "にあつては、", yen(v), "）"));
  add("手当", "父母等の扶養手当を支給しない区分（9級以上相当）calcRates.fuyouParentByCol の 0", "ippanKyuyo", "11", P("職務の級が九級以上であるもの", ANY(120), "支給しない"));
  add("手当", `住居手当 ${CR.house.floor}円を超える家賃から calcRates.house.floor`, "ippanKyuyo", "11_10", P("月額", yen(CR.house.floor), "を超える家賃"));
  add("手当", `住居手当 ${CR.house.step}円以下は家賃−${CR.house.floor}円 calcRates.house`, "ippanKyuyo", "11_10", P("月額", yen(CR.house.step), "以下の家賃を支払つている職員 家賃の月額から", yen(CR.house.floor), "を控除した額"));
  add("手当", `住居手当 ${CR.house.step}円超は${CR.house.base}円＋（家賃−${CR.house.step}円）÷2（加算は${CR.house.maxAdd}円まで） calcRates.house`, "ippanKyuyo", "11_10", P("月額", yen(CR.house.step), "を超える家賃を支払つている職員 家賃の月額から", yen(CR.house.step), "を控除した額の二分の一（その控除した額の二分の一が", yen(CR.house.maxAdd), "を超えるときは、", yen(CR.house.maxAdd), "）を", yen(CR.house.base), "に加算した額"));
  add("手当", `通勤手当の上限 ${CR.commute.cap}円 calcRates.commute.cap`, "ippanKyuyo", "12", [P("の合計額が", yen(CR.commute.cap), "を超える職員の通勤手当の額"), P(yen(CR.commute.cap), "に当該支給単位期間の月数を乗じて")]);
  // 通勤手当（自動車等）人事院規則9-24 第8条の2：「片道五キロメートル以上十キロメートル未満 四千二百円」の組
  const km = (n) => `${kanjiInt(n)}キロメートル`;
  CR.commute.car.forEach(([upto, v], i) => {
    const lo = i ? CR.commute.car[i - 1][0] : 0;
    const label = upto === Infinity ? `片道${km(lo)}以上` : lo ? `片道${km(lo)}以上${km(upto)}未満` : `片道${km(upto)}未満`;
    add("手当", `通勤手当（自動車等）${label} ${v}円 calcRates.commute.car`, "jinjiin9_24", "8_2", P(label, yen(v)));
  });
  add("手当", `単身赴任手当の基本額 ${CR.tanshin.base}円 calcRates.tanshin.base`, "ippanKyuyo", "12_2", P("単身赴任手当の月額は、", yen(CR.tanshin.base), "（"));
  const tanshinMax = CR.tanshin.add[CR.tanshin.add.length - 1][1];
  add("手当", `単身赴任手当の加算の上限 ${tanshinMax}円 calcRates.tanshin.add`, "ippanKyuyo", "12_2", P(yen(tanshinMax), "を超えない範囲内で交通距離の区分に応じて"));
  // 単身赴任手当の加算 人事院規則9-89 第4条：「三百キロメートル以上五百キロメートル未満 一万六千円」の組。0円の区分は「定める距離は、百キロメートル」
  CR.tanshin.add.forEach(([upto, v], i) => {
    const lo = i ? CR.tanshin.add[i - 1][0] : 0;
    if (!v) {
      add("手当", `単身赴任手当の加算が始まる距離 ${upto}km calcRates.tanshin.add`, "jinjiin9_89", "4", P("人事院規則で定める距離は、", km(upto), "とする"));
      return;
    }
    const label = upto === Infinity ? `${km(lo)}以上` : `${km(lo)}以上${km(upto)}未満`;
    add("手当", `単身赴任手当の加算 ${label} ${v}円 calcRates.tanshin.add`, "jinjiin9_89", "4", P(label, yen(v)));
  });
  // 寒冷地手当の支給月数（寒冷地手当法第1条「毎年十一月から翌年三月までの各月」）
  add("手当", `寒冷地手当の支給月数 ${CR.kanreichi.months}か月（11月から）calcRates.kanreichi.months`, "kanreichi", "1", P("毎年十一月から翌年", kanjiInt(((10 + CR.kanreichi.months - 1) % 12) + 1) + "月までの各月"));
  const KG = { 1: "一級地", 2: "二級地", 3: "三級地", 4: "四級地" };
  for (const [g, vals] of Object.entries(CR.kanreichi.rates))
    add("手当", `寒冷地手当 ${KG[g]} ${vals.join("・")}円 calcRates.kanreichi`, "kanreichi", "2", { spaced: new RegExp(`${KG[g]} ${vals.map(digitYen).join(" ")}`) });
  // 営内者等の額（防衛省の職員に対する寒冷地手当支給規則第4条の表）
  for (const [g, vals] of Object.entries(CR.kanreichi.barracksRates || {}))
    add("手当", `寒冷地手当 営内者等 ${KG[g]} ${vals.join("・")}円 calcRates.kanreichi.barracksRates`, "kanreichiBoei", "4", { spaced: new RegExp(`${KG[g]} ${vals.map(digitYen).join(" ")}`) });
  // 駐屯地・基地の位置（自衛隊法施行令の別表）と級地（寒冷地手当法 別表）
  const BASE_TABLE = { 陸: "別表第七", 空: "別表第八" },
    SEA_TABLE = { 大湊地区総監部: "別表第二の二", 函館基地隊本部: "別表第三" },
    // 北海道の振興局の管内で級地が決まるもの（郡が振興局をまたぐため。北海道庁の振興局の一覧で確認）
    BY_BUREAU = { 上富良野駐屯地: "上川総合振興局管内", 別海駐屯地: "根室振興局管内" },
    // 郡のうち町村名まで書かれているもの（郡の全体ではない）。ほかの郡の町は郡の全体が載っている
    TOWN_LISTED = ["倶知安駐屯地", "遠軽駐屯地", "北富士駐屯地"];
  for (const [kind, name, pos, g] of CR.kanreichi.bases || []) {
    add("手当", `寒冷地手当 ${name}の位置 ${pos} calcRates.kanreichi.bases`, "jieitaiRei", kind === "海" ? SEA_TABLE[name] : BASE_TABLE[kind], { spaced: new RegExp(`(^| )${name} ${pos}( |$)`) });
    if (!g) continue;
    if (name === "高田駐屯地") {
      add("手当", "寒冷地手当 高田駐屯地は支給規則 別表の官署（4級地の額）calcRates.kanreichi.bases", "kanreichiBoei", "別表", "高田駐屯地に所在する陸上自衛隊の部隊");
      continue;
    }
    const m = pos.match(/^(?:北海道|..[県府都])?(?:(.+?郡))?(.+?[市町村区])$/),
      gun = m?.[1],
      town = m?.[2];
    // 級地の区切り（「一級地 …」から次の「◯級地」まで）の中に、市・町村名（郡のうち◯町、を含む）か郡名か振興局の管内があること
    const inGrade = (re) => ({ spaced: new RegExp(`${KG[g]}(?:(?!級地).)*?${re}`) });
    const target = BY_BUREAU[name]
      ? `(^| )${BY_BUREAU[name]}( |$)`
      : gun
        ? TOWN_LISTED.includes(name)
          ? `( |のうち|、|及び)${town}(、|及び| |$)`
          : `(^| )${gun}( |$)`
        : `(^| )${town}( |$)`;
    add("手当", `寒冷地手当 ${name}（${pos}）は${KG[g]} calcRates.kanreichi.bases`, "kanreichi", "別表", inGrade(target));
  }
  // 地域手当の級地ごとの割合（一般職給与法第11条の3第2項）。都道府県・市ごとの級地は regional で照合する
  const GR = { 1: 20, 2: 16, 3: 12, 4: 8, 5: 4 };
  for (const [g, r] of Object.entries(GR)) add("手当", `地域手当 ${g}級地 ${r}％`, "ippanKyuyo", "11_3", P(`${kanjiInt(Number(g))}級地`, pct(r / 100)));
  list.push({ area: "手当", what: "地域手当の都道府県・市ごとの割合 allowances.regionalAreas（人事院規則9-49 別表第一）", law: "jinjiin9_49", article: "別表第一", regional: { areas: A.regionalAreas, gradeRate: GR } });

  // 広域異動手当（一般職給与法第11条の8第1項）：表示の距離（「60km以上300km未満（5％）」）と割合を組で照合する
  for (const [rate, label] of A.wideRates) {
    const shown = String(label).match(/（([0-9.]+)％）/)?.[1];
    if (shown != null && Number(shown) !== rate) fail("手当", `広域異動手当「${label}」の表示 ${shown}％ と値 ${rate} が違う allowances.wideRates`);
    const m = String(label).match(/^(\d+)km(以上|未満)(?:(\d+)km未満)?/);
    if (!m) {
      fail("手当", `広域異動手当「${label}」の距離が読めない allowances.wideRates`);
      continue;
    }
    if (!rate) {
      // 対象外の区分：「いずれも六十キロメートル以上であるとき」
      add("手当", `広域異動手当の対象になる距離 ${m[1]}km allowances.wideRates`, "ippanKyuyo", "11_8", P("いずれも", km(Number(m[1])), "以上であるとき"));
      continue;
    }
    const lawLabel = m[3] ? `${km(Number(m[1]))}以上${km(Number(m[3]))}未満` : `${km(Number(m[1]))}以上`;
    add("手当", `広域異動手当 ${label} allowances.wideRates`, "ippanKyuyo", "11_8", P(lawLabel, pct(rate / 100)));
  }

  // 高等工科学校の卒業生：生徒の在職期間の2分の1を、6月以上在職した自衛官の勤続期間に通算（防衛省給与法第28条の2第4項）
  const K = R.entry.koka;
  if (K) {
    if (K.studentMonths !== 36) fail("階級", `entry.koka.studentMonths ${K.studentMonths} が生徒の課程の3年（36か月）と違う`);
    add("退職手当", "高等工科学校の生徒の期間の2分の1を勤続期間に通算 entry.koka（生徒の期間の半分を足す）", "boeiKyuyo", "28_2", P("学生又は生徒としての在職期間は、同法第七条の勤続期間から除算する", ANY(250), "在職期間が六月以上となつた場合", ANY(250), "学生又は生徒としての在職期間の二分の一に相当する期間は、自衛官としての在職期間に通算する"));
  }

  // 特地勤務手当の割合（施行令第10条第2項の表。「一級 百分の四 百分の四」の中欄が自衛官）
  for (const [g, r] of Object.entries(A.calcRates.tokuchi.rates))
    add("手当", `特地勤務手当 ${g}級 ${r}％ allowances.calcRates.tokuchi`, "boeiKyuyoRei", "10", P(CELL, `${kanjiInt(Number(g))}級`, pct(r / 100)));

  // 賞与
  // 期末手当（一般職給与法第19条の4第2項）：一般・特定管理職員・指定職の割合を組で
  // 期末手当（一般職給与法第19条の4第2項）。e-Gov の本文が令和8年度の形（6月・12月で違う割合）なら bonus.split と、
  // 令和9年度の形（1つの割合。令和9年4月1日施行の令和8年法律第79号第2条）なら bonus.kimatsuPer と照合する（どちらかの形で一致すればよい）
  const either = (...res) => new RegExp(res.map((r) => `(?:${r.source})`).join("|"));
  const S = B.split;
  const kimatsuSplit = P("期末手当基礎額に、六月に支給する場合には", pct(S.kimatsuPer.normal[0]), "、十二月に支給する場合には", pct(S.kimatsuPer.normal[1]), "（", ANY(400), "「特定管理職員」という。）にあつては、六月に支給する場合には", pct(S.kimatsuPer.tokutei[0]), "、十二月に支給する場合には", pct(S.kimatsuPer.tokutei[1]), "、指定職俸給表の適用を受ける職員にあつては、六月に支給する場合には", pct(S.kimatsuPer.shitei[0]), "、十二月に支給する場合には", pct(S.kimatsuPer.shitei[1]), "）");
  const kimatsuOne = P("期末手当基礎額に", pct(B.kimatsuPer.normal), "（", ANY(400), "「特定管理職員」という。）にあつては", pct(B.kimatsuPer.tokutei), "、指定職俸給表の適用を受ける職員にあつては", pct(B.kimatsuPer.shitei), "）");
  add("賞与", `期末手当の割合（令和8年度 6月・12月 ${S.kimatsuPer.normal.join("・")}、令和9年度から ${B.kimatsuPer.normal}。特定管理職員・指定職も）bonus.split / bonus.kimatsuPer`, "ippanKyuyo", "19_4", either(kimatsuSplit, kimatsuOne));
  // 在職期間割合：「五箇月以上六箇月未満 百分の八十」の組
  const kagetsu = (n) => `${kanjiInt(n)}箇月`;
  B.kimatsuPeriod.forEach(([m, r], i) => {
    const upper = i ? B.kimatsuPeriod[i - 1][0] : null;
    const label = upper == null ? kagetsu(m) : m === 0 ? `${kagetsu(upper)}未満` : `${kagetsu(m)}以上${kagetsu(upper)}未満`;
    add("賞与", `期末手当の在職期間割合 ${label} ${r} bonus.kimatsuPeriod`, "ippanKyuyo", "19_4", P(CELL, label, pct(r)));
  });
  // 年間月数は、令和8年度の6月＋12月と、令和9年度からの1回分×2が同じであること（どちらも法の割合から出す）
  const sum2 = (a) => Math.round((a[0] + a[1]) * 1e6) / 1e6;
  if (Math.abs(sum2(S.kimatsuPer.normal) - B.kimatsuMonths) > 1e-9 || Math.abs(B.kimatsuPer.normal * 2 - B.kimatsuMonths) > 1e-9)
    fail("賞与", `期末手当の年間月数 ${B.kimatsuMonths} が bonus.split（${sum2(S.kimatsuPer.normal)}）・kimatsuPer×2（${B.kimatsuPer.normal * 2}）と違う bonus.kimatsuMonths`);
  else add("賞与", `期末手当の年間月数 ${B.kimatsuMonths}（6月＋12月）bonus.kimatsuMonths`, "ippanKyuyo", "19_4", either(kimatsuSplit, kimatsuOne));
  // 勤勉手当の総額の上限（第19条の7第2項第1号イ）：令和8年度は6月・12月で違う割合、令和9年度からは1つの割合。年の合計が kinbenMonths
  const kinbenHalf = [Math.round((B.kinbenMonths / 2 - 0.0125) * 1e6) / 1e6, Math.round((B.kinbenMonths / 2 + 0.0125) * 1e6) / 1e6];
  add("賞与", `勤勉手当の総額の上限 年${B.kinbenMonths}か月 bonus.kinbenMonths`, "ippanKyuyo", "19_7", either(
    P("加算した額に、六月に支給する場合には", pct(kinbenHalf[0]), ANY(60), "、十二月に支給する場合には", pct(kinbenHalf[1])),
    P("加算した額に", pct(B.kinbenMonths / 2), "（特定管理職員にあつては"),
  ));
  // 勤勉手当の標準の成績率（人事院規則9-40第13条第1項第1号ハ・第3号ロ）
  // 勤勉手当の標準の成績率（人事院規則9-40第13条第1項第1号ハ・第3号ロ）。人事院規則9-40-66（令和8年11月18日公布）で
  // 令和8年度は6月・12月で違う割合に、令和9年度から1つの割合になる。e-Gov の本文が改正前（6月の割合だけ）・令和8年度の形・令和9年度の形のどれでも照合する
  const GOOD = "「良好」の段階である職員及び基準日以前における直近の人事評価の結果がない職員（ニの人事院の定める職員を除く。）";
  add("賞与", `勤勉手当の標準の成績率 一般 ${S.kinbenStandard.normal.join("・")}（令和9年度から ${B.kinbenStandard.normal}）・特定管理職員 ${S.kinbenStandard.tokutei.join("・")}（同 ${B.kinbenStandard.tokutei}）bonus.split / bonus.kinbenStandard`, "jinjiin9_40", "13", either(
    P(GOOD, "六月に支給する場合には", pct(S.kinbenStandard.normal[0]), "（特定管理職員にあつては、", pct(S.kinbenStandard.tokutei[0]), "）、十二月に支給する場合には", pct(S.kinbenStandard.normal[1]), "（特定管理職員にあつては、", pct(S.kinbenStandard.tokutei[1]), "）"),
    P(GOOD, pct(S.kinbenStandard.normal[0]), "（特定管理職員にあつては、", pct(S.kinbenStandard.tokutei[0]), "）"),
    P(GOOD, pct(B.kinbenStandard.normal), "（特定管理職員にあつては、", pct(B.kinbenStandard.tokutei), "）"),
  ));
  const MID = "中位の段階である職員及び基準日以前における直近の人事評価の結果がない職員（ハの人事院の定める職員を除く。）";
  add("賞与", `勤勉手当の標準の成績率（指定職）${S.kinbenStandard.shitei.join("・")}（令和9年度から ${B.kinbenStandard.shitei}）bonus.split / bonus.kinbenStandard.shitei`, "jinjiin9_40", "13", either(
    P(MID, "六月に支給する場合には", pct(S.kinbenStandard.shitei[0]), "、十二月に支給する場合には", pct(S.kinbenStandard.shitei[1])),
    P(MID, pct(S.kinbenStandard.shitei[0])),
    P(MID, pct(B.kinbenStandard.shitei)),
  ));

  // 勤勉手当の期間率（人事院規則9-40 別表第二）：半月刻み。i 番目は「i×15日以上 (i+1)×15日未満」
  const half = (n) => (n % 2 ? `${n > 1 ? kagetsu((n - 1) / 2) : ""}十五日` : kagetsu(n / 2));
  B.kinbenPeriod.forEach((r, i) => {
    const label = i ? `${half(i)}以上${half(i + 1)}未満` : `${half(1)}未満`;
    add("賞与", `勤勉手当の期間率 ${label} ${r} bonus.kinbenPeriod`, "jinjiin9_40", "別表第二", P(CELL, label, pct(r)));
  });
  // 階級による加算（施行令 別表第八 自衛官俸給表の行）：区分のはじめの階級の欄と割合を組で。区分の終わりは次の区分のはじめで分かる
  const RANK_START = { 0: "陸将、海将若しくは空将の欄", 2: "陸将補、海将補若しくは空将補の（二）欄", 5: "一等陸佐、一等海佐若しくは一等空佐の（三）欄", 7: "三等陸佐、三等海佐若しくは三等空佐", 9: "二等陸尉以下二等陸曹以上" };
  B.rankAdd.forEach(([upto, r], i) => {
    const from = i ? B.rankAdd[i - 1][0] + 1 : 0;
    const start = RANK_START[from];
    if (!start) {
      fail("賞与", `階級による加算 列${from}〜${upto} ${r}：別表第八にこの区分のはじめ（列${from}）がない bonus.rankAdd`);
      return;
    }
    add("賞与", `階級による加算 列${from}〜${upto} ${r} bonus.rankAdd`, "boeiKyuyoRei", "別表第八", P("自衛官俸給表", ANY(1500), start, { re: "[^百]*?" }, pct(r)));
  });
  const SHU = { 1: "一種", 2: "二種", "3a": "三種", 3: "三種" };
  for (const [k, r] of Object.entries(B.managerAdd)) add("賞与", `管理職加算 ${SHU[k]} ${r} bonus.managerAdd`, "boeiKyuyoRei", "12_6", P(`種別が${SHU[k]}の官職を占める自衛官`, pct(r)));
  add("賞与", `管理職加算（将・将補（1））${B.generalManagerAdd} bonus.generalManagerAdd`, "boeiKyuyoRei", "12_6", P("前項第三号に掲げる職員", pct(B.generalManagerAdd)));
  // 若年給付金の給与年額相当額（施行令第24条）：期末手当は一般職給与法第19条の4第2項の割合（年2回）、
  // 勤勉手当は6月 百分の百五・12月 百分の百七・五（合計2.125か月）。改正されたら下の2つの数も直す
  // 施行令第24条第4号は一般職給与法第19条の4第2項の割合を使うので、6月＋12月の合計（令和8年度・令和9年度からとも同じ）
  if (Math.abs(sum2(S.kimatsuPer.normal) - YP.kimatsuMonths) > 1e-9) fail("賞与", `youngPension.kimatsuMonths ${YP.kimatsuMonths} が期末手当の6月＋12月の割合 ${sum2(S.kimatsuPer.normal)} と違う`);
  else add("賞与", "若年給付金で使う期末手当の月数 youngPension.kimatsuMonths（第19条の4の6月＋12月）", "ippanKyuyo", "19_4", either(kimatsuSplit, kimatsuOne));
  const kinbenSplit = [1.05, 1.075];
  add("賞与", `若年給付金で使う勤勉手当の6月・12月の割合 ${kinbenSplit.join("・")}`, "boeiKyuyoRei", "24", P("六月一日に係るものにあつては", pct(kinbenSplit[0]), "（", ANY(100), "十二月一日に係るものにあつては", pct(kinbenSplit[1]), "（"));
  if (Math.abs(kinbenSplit[0] + kinbenSplit[1] - YP.kinbenMonths) > 1e-9) fail("賞与", `youngPension.kinbenMonths ${YP.kinbenMonths} が施行令第24条の合計 ${kinbenSplit[0] + kinbenSplit[1]} と違う`);

  // 階級・定年・入隊区分
  // 別表第九は「一等陸佐 一等海佐 一等空佐 五十八年」の形（備考の特例の定年は入れていない）
  const RA = { "3曹": "三等陸曹", "2曹": "二等陸曹", "1曹": "一等陸曹", 曹長: "陸曹長", 准尉: "准陸尉", "3尉": "三等陸尉", "2尉": "二等陸尉", "1尉": "一等陸尉", "3佐": "三等陸佐", "2佐": "二等陸佐", "1佐": "一等陸佐", 将補: "陸将補", 将: "陸将" };
  for (const [rank, a] of Object.entries(R.promotion.retireAge))
    add("階級", `定年 ${rank} ${a}歳 promotion.retireAge`, "jieitaiRei", "別表第九", { spaced: new RegExp(`(^| )${RA[rank]} [^ ]+ [^ ]+ ${kanjiInt(a)}年`) });
  // 昇任に要する在職期間（自衛隊法施行規則 別表第七）＝ 選択肢のいちばん短い期間。表は「陸曹長 海曹長 空曹長 二年」の形。
  // 士長→3曹（一般曹候補生の最短）・3曹→3尉（部内幹部の受験資格）・1士→士長（運用に合わせた6か月）は別表第七によらないので照合しない
  const span = (m) => (m % 12 ? `${kanjiInt(m)}月` : `${kanjiInt(m / 12)}年`);
  const C = R.promotion.choices;
  for (const [id, from] of [["stepSgt2", "三等陸曹"], ["stepSgt1", "二等陸曹"], ["stepSgm", "一等陸曹"], ["stepWo", "陸曹長"], ["first", "二等陸尉"], ["stepMaj", "一等陸尉"], ["stepLtc", "三等陸佐"], ["stepCol", "二等陸佐"], ["stepMg", "一等陸佐"], ["stepGen", "陸将補"]])
    add("階級", `昇任の最短期間 ${id} ${C[id][0]}か月 promotion.choices`, "jieitaiKisoku", "別表第七", { spaced: new RegExp(`(^| )${from} [^ ]+ [^ ]+ ${span(C[id][0])}( |$)`) });
  add("階級", `3尉→2尉 ${R.promotion.fixedYears.second}年 promotion.fixedYears.second`, "jieitaiKisoku", "別表第七", { spaced: new RegExp(`(^| )三等陸尉 [^ ]+ [^ ]+ ${kanjiInt(R.promotion.fixedYears.second)}年( |$)`) });
  add("階級", `2士→1士 ${R.promotion.fixedMonths.stepPfc}か月 promotion.fixedMonths.stepPfc`, "jieitaiKisoku", "別表第七", { spaced: new RegExp(`(^| )二等陸士 [^ ]+ [^ ]+ ${kanjiInt(R.promotion.fixedMonths.stepPfc)}月( |$)`) });
  // 任期満了金（防衛省給与法第28条第1項）：号ごとの区分と日数を組で
  for (const [months, d] of Object.entries(E.ninkiDays.first)) add("階級", `任期満了金 1任期目（任期${Number(months) / 12}年）${d}日 entry.ninkiDays.first`, "boeiKyuyo", "28", P(`任用期間が${nen(Number(months) / 12)}である者にあつては`, days(d)));
  E.ninkiDays.byTerm.forEach((d, i) => add("階級", `任期満了金 ${i + 2}任期目 ${d}日 entry.ninkiDays.byTerm`, "boeiKyuyo", "28", P(`${kanjiInt(i + 1)}回任用された者`, days(d))));
  add("階級", `任期満了金 ${E.ninkiDays.byTerm.length + 2}任期目以降 ${E.ninkiDays.later}日 entry.ninkiDays.later`, "boeiKyuyo", "28", P(`${kanjiInt(E.ninkiDays.byTerm.length + 1)}回以上任用された者`, days(E.ninkiDays.later)));
  add("階級", "昇給抑制の年齢 promotion.restrictAge", "ippanKyuyo", "8", P(kanjiInt(R.promotion.restrictAge) + "歳（人事院規則で定める職員にあつては"));

  // 退職手当（国家公務員退職手当法）
  // 第3条〜第5条：「十一年以上十五年以下の期間については、一年につき百分の百十」の組。最後の区分（99年まで）は「◯年以上の期間」
  const yearsLabel = (from, to) => (to >= 99 ? `${nen(from)}以上の期間については、一年につき` : `${nen(from)}以上${nen(to)}以下の期間については、一年につき`);
  for (const [art, rows] of [["3", RT.art3], ["4", RT.art4], ["5", RT.art5]])
    for (const [from, to, m] of rows) add("退職手当", `第${art}条 ${from}〜${to >= 99 ? "" : to}年 ${m} retirement.art${art}`, "taishoku", art, P(yearsLabel(from, to), pct(m)));
  RT.selfReduction.forEach(([upto, r], i) => {
    const from = i ? RT.selfReduction[i - 1][0] + 1 : 1;
    add("退職手当", `自己都合の減額 ${from}〜${upto}年 ${r} retirement.selfReduction`, "taishoku", "3", P(`勤続期間${nen(from)}以上${nen(upto)}以下の者`, pct(r)));
  });
  add("退職手当", `基本額の上限 ${RT.capMonths}か月 retirement.capMonths`, "taishoku", "6", P(`退職日俸給月額に${kanjiInt(RT.capMonths)}を乗じて得た額を超える`));
  add("退職手当", `調整率 ${RT.adjustFactor * 100}％（${RT.teinenMaxYears}年以下）retirement.adjustFactor`, "taishoku", "附則", P(`当分の間、${nen(RT.teinenMaxYears)}以下の期間勤続して退職した者`, ANY(200), `計算した額にそれぞれ${pct(RT.adjustFactor)}を乗じて得た額`));
  add("退職手当", `自己都合で調整率を掛ける上限 ${RT.selfAdjustMaxYears}年 retirement.selfAdjustMaxYears（附則第7項）`, "taishoku", "附則", P(`当分の間、${nen(RT.teinenMaxYears + 1)}以上${nen(RT.selfAdjustMaxYears)}以下の期間勤続して退職した者`));
  add("退職手当", `${RT.selfAdjustMaxYears}年を超える自己都合は定年として計算 retirement.selfAdjustMaxYears（平成15年改正法附則第4項）`, "taishoku", "附則(平成一五年六月四日法律第六二号)", P(`当分の間、${nen(RT.selfAdjustMaxYears)}を超える期間勤続して退職した者`, ANY(150), `勤続期間を${nen(RT.teinenMaxYears)}として`));
  add("退職手当", `定年退職の勤続年数の上限 ${RT.teinenMaxYears}年 retirement.teinenMaxYears（附則第8項）`, "taishoku", "附則", P(`当分の間、${nen(RT.teinenMaxYears)}を超える期間勤続して退職した者`, ANY(150), `勤続期間を${nen(RT.teinenMaxYears)}として附則第六項`));
  // 調整額（第6条の4）
  add("退職手当", `調整額を数える月数 ${RT.adjustTopMonths}か月 retirement.adjustTopMonths`, "taishoku", "6_4", P(`第一順位から第${kanjiInt(RT.adjustTopMonths)}順位までの調整月額`));
  add("退職手当", `調整額が半額（定年など ${RT.adjustHalfYears.teinen}年以下）retirement.adjustHalfYears.teinen`, "taishoku", "6_4", P(`自己都合等退職者以外のものでその勤続期間が一年以上${nen(RT.adjustHalfYears.teinen)}以下のもの 第一項の規定により計算した額の二分の一`));
  add("退職手当", `調整額が半額（自己都合 ${RT.adjustZeroSelfYears + 1}〜${RT.adjustHalfYears.self}年）retirement.adjustHalfYears.self`, "taishoku", "6_4", P(`自己都合等退職者でその勤続期間が${nen(RT.adjustZeroSelfYears + 1)}以上${nen(RT.adjustHalfYears.self)}以下のもの 第一項の規定により計算した額の二分の一`));
  add("退職手当", `調整額が0（自己都合 ${RT.adjustZeroSelfYears}年以下）retirement.adjustZeroSelfYears`, "taishoku", "6_4", P(`自己都合等退職者でその勤続期間が${nen(RT.adjustZeroSelfYears)}以下のもの 零`));
  // 調整月額：第6条の4第1項の各号の額にあること。どの階級がどの号かは施行令 別表第一（年代ごとの区分で複雑なので、上の階級ほど高いことだけ確かめる）
  for (const v of new Set([...Object.values(RT.adjustMonthly), RT.adjustGeneral.high, RT.adjustGeneral.low])) add("退職手当", `調整月額 ${v}円 retirement.adjustMonthly`, "taishoku", "6_4", P("号区分", yen(v)));
  const am = Object.entries(RT.adjustMonthly).sort((a, b) => a[0] - b[0]);
  am.forEach(([col, v], i) => {
    if (i && v > am[i - 1][1]) fail("退職手当", `調整月額 列${col} ${v}円 が上の階級（列${am[i - 1][0]}）の ${am[i - 1][1]}円 より高い retirement.adjustMonthly`);
  });

  // 若年定年退職者給付金（防衛省給与法第27条の2〜・附則第12項、施行令第22条・附則第15項）
  add("若年給付金", `支給の要件 在職${YP.minYears}年以上 youngPension.minYears`, "boeiKyuyo", "27_2", P(`としての在職期間が${nen(YP.minYears)}以上である者`));
  add("若年給付金", `1回目・2回目の倍率 ${YP.earlyMultiplier.join("・")} youngPension.earlyMultiplier`, "boeiKyuyo", "27_3", P("第一回目の給付金にあつては", kanjiNum(YP.earlyMultiplier[0]), "を、第二回目の給付金にあつては", kanjiNum(YP.earlyMultiplier[1]), "を"));
  add("若年給付金", `3回目・4回目の倍率 ${YP.lateMultiplier.join("・")} youngPension.lateMultiplier`, "boeiKyuyo", "附則", P("第三回目の給付金にあつては", kanjiNum(YP.lateMultiplier[0]), "を、第四回目の給付金にあつては", kanjiNum(YP.lateMultiplier[1]), "を"));
  // 経過措置（令和8年法律第53号 附則第3条）：令和8年4月〜令和9年3月に退職した人の倍率。「「二・五七一」とあるのは「二」と」の形
  if (YP.transition) {
    const T = YP.transition,
      sub = (from, to) => `「${kanjiNum(from)}」とあるのは「${kanjiNum(to)}」と`;
    add("若年給付金", `経過措置の倍率（令和8年4月〜令和9年3月の退職）youngPension.transition`, "boeiKyuyo", "附則(令和八年七月三日法律第五三号)",
      P(`令和八年四月一日から令和九年三月三十一日までの間に退職した新若年定年退職者`, ANY(200),
        sub(YP.earlyMultiplier[0], T.earlyMultiplier[0]), ANY(10), sub(YP.earlyMultiplier[1], T.earlyMultiplier[1]), ANY(80),
        sub(YP.lowerMultiplier, T.lowerMultiplier), ANY(10), sub(YP.upperMultiplier, T.upperMultiplier), ANY(120),
        sub(YP.lateMultiplier[0], T.lateMultiplier[0]), ANY(10), sub(YP.lateMultiplier[1], T.lateMultiplier[1])));
    if (T.from.join() !== "2026,4" || T.to.join() !== "2027,3") list.push({ area: "若年給付金", what: "youngPension.transition の期間が附則第3条（令和8年4月1日〜令和9年3月31日）と違う", fail: true });
  }
  // 率の表（施行令第22条）：「四年 〇・九九五一九二 〇・九八六五三八」の行。表にない短い年数は「三年以下 一・〇〇〇〇〇〇 一・〇〇〇〇〇〇」
  const r6 = (v) => kanjiNum(v, 6);
  const eYears = Object.keys(YP.earlyRate).map(Number).sort((a, b) => a - b);
  add("若年給付金", `率 ${eYears[0] - 1}年以下は1 youngPension.earlyRate`, "boeiKyuyoRei", "22", P(`${nen(eYears[0] - 1)}以下`, r6(1), r6(1)));
  for (const y of eYears) add("若年給付金", `率 ${y}年 ${YP.earlyRate[y].join("・")} youngPension.earlyRate`, "boeiKyuyoRei", "22", P(nen(y), r6(YP.earlyRate[y][0]), r6(YP.earlyRate[y][1])));
  // 60歳以後の分の率（施行令附則第15項の読替え表）：第22条の表の「(y+2)年」を「y年」に、違う率だけを読み替える
  //   例「五年 三年 〇・九八八四六二 〇・九九三五九〇 〇・九六八一〇七 一・〇〇〇〇〇〇」
  const early = (y) => YP.earlyRate[y] || [1, 1];
  const lYears = Object.keys(YP.lateRate).map(Number);
  for (let y = 2; y <= Math.max(...lYears); y++) {
    const late = YP.lateRate[y] || [1, 1];
    const parts = [nen(y + 2), nen(y)];
    [0, 1].forEach((k) => {
      if (early(y + 2)[k] !== late[k]) parts.push(r6(early(y + 2)[k]), r6(late[k]));
    });
    add("若年給付金", `60歳以後の分の率 ${y}年 ${late.join("・")} youngPension.lateRate`, "boeiKyuyoRei", "附則", P(...parts));
  }
  add("若年給付金", `所得による調整の倍率 下限 ${YP.lowerMultiplier}・上限 ${YP.upperMultiplier} youngPension.lowerMultiplier / upperMultiplier`, "boeiKyuyo", "27_4", P(`俸給月額に${kanjiNum(YP.lowerMultiplier)}を乗じて得た額を減じた額をいう。以下同じ。）を超え、支給調整上限額`, ANY(60), `俸給月額に${kanjiNum(YP.upperMultiplier)}を乗じて得た額を減じた額`));
  return list;
}

// 法令で確かめられない値（毎月、公表資料で人が確かめる）
const manual = [
  ["手当", "3佐以上の配置手当の割合 allowances.seniorRate（上限94.2％だけは照合）、航空手当の乗員の区分の割合、配置手当の区分（だれがどの率か）", "防衛大臣の訓令・防衛省職員給与施行細則"],
  ["手当", "特殊勤務手当の［上限額］の区分の実際の額 allowances.specialRates（種類 max）", "防衛大臣の定め（訓令）。法令にあるのは上限だけ"],
  ["手当", "地域手当の経過措置 allowances.regionalTransition（令和10年3月まで）と空港の区域", "人事院規則9-49-57 附則別表第一（人事院の改正通知。e-Gov の9-49本則には載らない）・9-49第4条"],
  ["手当", "寒冷地手当の支給地域・級地（駐屯地・基地の一覧にない官署）、北海道の振興局の管内（上富良野町＝上川総合振興局、別海町＝根室振興局）", "寒冷地手当法 別表（一覧にない官署は利用者が級地を選ぶ）。振興局の管内は北海道庁の振興局の一覧"],
  ["退職手当", "調整月額のどの階級がどの号区分か retirement.adjustMonthly（照合は額と並びだけ）", "国家公務員退職手当法施行令 別表第一"],
  ["階級", "士長→3曹の最短（一般曹候補生）・3曹→3尉の最短（部内幹部の受験資格）・1士→士長の6か月（運用） promotion.choices / fixedMonths", "採用・試験の案内（別表第七によらない前提）"],
  ["階級", "定年の特例（統合幕僚長等62歳、医師・音楽・情報・警務官の1佐以下60歳。自衛隊法施行令 別表第九 備考）", "試算では入れていない。備考が変わっていないかだけ確かめる"],
  ["階級", "一般幹部候補生の候補生の号俸と任官時の号俸 entry.candidate", "その年度の一般幹部候補生採用要項"],
  ["階級", "高等工科学校の卒業生の任官時の号俸（陸士長1号俸）・3曹昇任までの1年・任官直後の教育3か月 entry.koka", "号俸は公表資料になし（防衛大臣の定め）。自衛隊の広報に問い合わせて陸士長1号俸と確認済み（2026-11-24）。1年と教育は陸上自衛隊高等工科学校の公式Q&A（https://www.mod.go.jp/gsdf/yt_sch/q-a/ 。自動取得は403なのでブラウザで確かめる）"],
  ["若年給付金", "自衛官以外の職員の定年 youngPension.civilRetireAge", "国家公務員法 附則（定年の段階的引上げ）"],
  ["賞与", "令和9年度からの期末手当の割合 bonus.kimatsuPer、勤勉手当の標準の成績率 bonus.kinbenStandard（令和9年度から）・bonus.split の12月の割合", "官報 令和8年11月18日 号外第251号（令和8年法律第79号第2条・人事院規則9-40-66）で確認。e-Gov は施行・改正後に載る（令和9年4月以後に values で照合し直す）"],
  ["手当", "単身赴任手当の距離の加算の廃止 calcRates.tanshin.addUntilFy と転居手当の上限 calcRates.tenkyo", "官報 令和8年11月18日 号外第251号（令和8年法律第79号第2条。令和9年4月1日施行）で確認。転居手当の距離区分ごとの額は人事院規則（未公布）"],
  ["年金・共済", "afterRetire（老齢基礎年金・国民年金保険料）、kyosai（掛金率・標準報酬・上限）", "日本年金機構・防衛省共済組合の公表資料"],
  ["税", "tax（給与所得控除・基礎控除・税率・住民税・退職所得）", "所得税法・租税特別措置法・地方税法、国税庁の公表資料"],
];

module.exports = { build, manual, kanjiInt, kanjiNum, pct, yen, P, NUM };
