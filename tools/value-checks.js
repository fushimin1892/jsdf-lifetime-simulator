// data の数値を e-Gov の条文と照合するための一覧（tools/egov-check.js values が使う）。
// 1件ごとに「どの法令の、どの条（または法令全体）に、どんな文言があるはずか」を書く。
// 文言は data の値から作るので、data と法令のどちらかが変わると「NG」になる。
//   law：data/sources.js の laws の key
//   article：条の番号（e-Gov の Num。第十九条の四 → "19_4"）。"*" は本則・附則・別表を含む法令全体
//   expect：data の値から作った文言（法令の書き方：漢数字、「百分の…」、小数点は「・」）
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
// 小数：整数部は漢数字、小数部は1けたずつ（二・五七一、〇・九九五一九二）
function kanjiNum(x) {
  const [i, f] = String(+x.toFixed(6)).split(".");
  return kanjiInt(Number(i)) + (f ? "・" + f.split("").map((c) => D[Number(c)]).join("") : "");
}
const yen = (n) => kanjiInt(n) + "円";
const pct = (rate) => "百分の" + kanjiNum(+(rate * 100).toFixed(6)); // 0.43 → 百分の四十三
const days = (n) => kanjiInt(n) + "日";

// ---- 照合の一覧 ----
function build(R, W) {
  const A = R.allowances;
  const B = R.bonus;
  const RT = R.retirement;
  const YP = R.youngPension;
  const E = R.entry;
  const list = [];
  const add = (area, what, law, article, expect) => list.push({ area, what, law, article, expect: [].concat(expect) });

  // 手当
  add("手当", "営外手当の月額 allowances.eigai", "boeiKyuyo", "18", "月額" + yen(A.eigai));
  add("手当", "指定場所生活調整金 allowances.barracksBonus", "boeiKyuyoRei", "19_2", yen(A.barracksBonus));
  for (const [key, p] of Object.entries(A.placement)) {
    for (const [v] of p.options) {
      const rate = Number(String(v).split(":").pop());
      // 航空手当の選択肢は「90％・70％ × 乗員の区分の割合（訓令）」なので、法令にあるのは90と70だけ
      if (key === "aviation") continue;
      add("手当", `${p.name}の割合 ${v}％ allowances.placement.${key}`, "boeiKyuyoRei", "12", pct(rate / 100));
    }
  }
  add("手当", "航空手当のジェット機・その他の割合（90％・70％）", "boeiKyuyoRei", "12", [pct(0.9), pct(0.7)]);
  // 俸給の特別調整額（施行令 別表第四）：自衛官の欄の月額
  // 表は「陸将補（二） 海将補（二） 空将補（二） 五九、一〇〇円」の形（階級の次の額が、再任用以外の職員の額）
  const MP_RANK = { 2: "陸将補（二）", 3: "一等陸佐（一）", 4: "一等陸佐（二）", 5: "一等陸佐（三）", 6: "二等陸佐", 7: "三等陸佐" };
  for (const [kind, cols] of Object.entries(A.managerPay))
    for (const [col, v] of Object.entries(cols))
      add("手当", `俸給の特別調整額 ${kind}種 ${MP_RANK[col]} ${v}円 allowances.managerPay`, "boeiKyuyoRei", "別表第四", { spaced: new RegExp(`${MP_RANK[col]} [^ ]+ [^ ]+ ${digitYen(v)}`) });
  // 「条件から計算」の手当（一般職給与法・人事院規則・寒冷地手当法）
  const CR = A.calcRates;
  add("手当", "扶養手当 子・16〜22歳の加算・父母等 calcRates.fuyou", "ippanKyuyo", "11", [yen(CR.fuyou.child), yen(CR.fuyou.teenAdd), yen(CR.fuyou.parent)]);
  for (const v of new Set(Object.values(CR.fuyouParentByCol).filter(Boolean))) add("手当", `父母等の扶養手当（1佐（2）欄）${v}円 calcRates.fuyouParentByCol`, "boeiKyuyoRei", "*", yen(v));
  add("手当", "住居手当の家賃の区分と額 calcRates.house", "ippanKyuyo", "11_10", [yen(CR.house.floor), yen(CR.house.step), yen(CR.house.base), yen(CR.house.maxAdd)]);
  add("手当", "通勤手当の上限 calcRates.commute.cap", "ippanKyuyo", "12", yen(CR.commute.cap));
  for (const [km, v] of CR.commute.car) add("手当", `通勤手当（自動車等）${km}km未満 ${v}円 calcRates.commute.car`, "jinjiin9_24", "*", yen(v));
  add("手当", "単身赴任手当の基本額 calcRates.tanshin.base", "ippanKyuyo", "12_2", yen(CR.tanshin.base));
  for (const [km, v] of CR.tanshin.add) if (v) add("手当", `単身赴任手当の加算 ${km}km未満 ${v}円 calcRates.tanshin.add`, "jinjiin9_89", "*", yen(v));
  const KG = { 1: "一級地", 2: "二級地", 3: "三級地", 4: "四級地" };
  for (const [g, vals] of Object.entries(CR.kanreichi.rates))
    add("手当", `寒冷地手当 ${KG[g]} ${vals.join("・")}円 calcRates.kanreichi`, "kanreichi", "2", { spaced: new RegExp(`${KG[g]} ${vals.map(digitYen).join(" ")}`) });
  // 地域手当の級地ごとの割合（一般職給与法第11条の3第2項）。都道府県・市ごとの級地は regional で照合する
  const GR = { 1: 20, 2: 16, 3: 12, 4: 8, 5: 4 };
  add("手当", "地域手当の級地ごとの割合（1級地20％〜5級地4％）", "ippanKyuyo", "11_3", Object.entries(GR).map(([g, r]) => `${kanjiInt(Number(g))}級地${pct(r / 100)}`));
  list.push({ area: "手当", what: "地域手当の都道府県・市ごとの割合 allowances.regionalAreas（人事院規則9-49 別表第一）", law: "jinjiin9_49", article: "別表第一", regional: { areas: A.regionalAreas, gradeRate: GR } });

  // 広域異動手当（一般職給与法第11条の8第1項）
  for (const [rate] of A.wideRates) if (rate) add("手当", `広域異動手当 ${rate}％ allowances.wideRates`, "ippanKyuyo", "11_8", pct(rate / 100));

  // 賞与
  add("賞与", "期末手当（一般）bonus.kimatsuPer.normal", "ippanKyuyo", "19_4", pct(B.kimatsuPer.normal));
  add("賞与", "期末手当（特定管理職員）bonus.kimatsuPer.tokutei", "ippanKyuyo", "19_4", pct(B.kimatsuPer.tokutei));
  add("賞与", "期末手当（指定職）bonus.kimatsuPer.shitei", "ippanKyuyo", "19_4", pct(B.kimatsuPer.shitei));
  for (const [m, r] of B.kimatsuPeriod) add("賞与", `期末手当の在職期間割合 ${m}か月 ${r} bonus.kimatsuPeriod`, "ippanKyuyo", "19_4", pct(r));
  add("賞与", "勤勉手当の総額の上限（年間月数の半分）bonus.kinbenMonths", "ippanKyuyo", "19_7", pct(B.kinbenMonths / 2));
  add("賞与", "勤勉手当の標準の成績率（一般）bonus.kinbenStandard.normal", "jinjiin9_40", "13", pct(B.kinbenStandard.normal));
  add("賞与", "勤勉手当の標準の成績率（特定管理職員）bonus.kinbenStandard.tokutei", "jinjiin9_40", "13", pct(B.kinbenStandard.tokutei));
  add("賞与", "勤勉手当の標準の成績率（指定職）bonus.kinbenStandard.shitei", "jinjiin9_40", "13", pct(B.kinbenStandard.shitei));
  for (const r of B.kinbenPeriod) add("賞与", `勤勉手当の期間率 ${r} bonus.kinbenPeriod`, "jinjiin9_40", "*", pct(r));
  for (const [, r] of B.rankAdd) add("賞与", `階級による加算 ${r} bonus.rankAdd`, "boeiKyuyoRei", "別表第八", pct(r));
  for (const r of Object.values(B.managerAdd)) add("賞与", `管理職加算 ${r} bonus.managerAdd`, "boeiKyuyoRei", "12_6", pct(r));
  add("賞与", `管理職加算（将・将補（1））${B.generalManagerAdd} bonus.generalManagerAdd`, "boeiKyuyoRei", "12_6", pct(B.generalManagerAdd));
  // 若年給付金の給与年額相当額（施行令第24条）：期末手当は一般職給与法第19条の4第2項の割合（年2回）、
  // 勤勉手当は6月 百分の百五・12月 百分の百七・五（合計2.125か月）。改正されたら下の2つの数も直す
  add("賞与", "若年給付金で使う期末手当の月数 youngPension.kimatsuMonths（÷2 が第19条の4の割合）", "ippanKyuyo", "19_4", pct(YP.kimatsuMonths / 2));
  const kinbenSplit = [1.05, 1.075];
  add("賞与", `若年給付金で使う勤勉手当の6月・12月の割合 ${kinbenSplit.join("・")}`, "boeiKyuyoRei", "24", kinbenSplit.map(pct));
  if (Math.abs(kinbenSplit[0] + kinbenSplit[1] - YP.kinbenMonths) > 1e-9) list.push({ area: "賞与", what: `youngPension.kinbenMonths ${YP.kinbenMonths} が施行令第24条の合計 ${kinbenSplit[0] + kinbenSplit[1]} と違う`, fail: true });

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
  add("階級", "任期満了金の日数 entry.ninkiDays", "boeiKyuyo", "28", [
    ...Object.values(E.ninkiDays.first).map(days),
    ...E.ninkiDays.byTerm.map(days),
    days(E.ninkiDays.later),
  ]);
  add("階級", "昇給抑制の年齢 promotion.restrictAge", "ippanKyuyo", "8", kanjiInt(R.promotion.restrictAge) + "歳");

  // 退職手当
  const rate = (m) => pct(m);
  for (const [, , m] of RT.art3) add("退職手当", `第3条の支給率 ${m} retirement.art3`, "taishoku", "3", rate(m));
  for (const [, , m] of RT.art4) add("退職手当", `第4条の支給率 ${m} retirement.art4`, "taishoku", "4", rate(m));
  for (const [, , m] of RT.art5) add("退職手当", `第5条の支給率 ${m} retirement.art5`, "taishoku", "5", rate(m));
  for (const [, r] of RT.selfReduction) add("退職手当", `自己都合の減額 ${r} retirement.selfReduction`, "taishoku", "3", pct(r));
  add("退職手当", "調整率 83.7％ retirement.adjustFactor", "taishoku", "*", pct(RT.adjustFactor));
  for (const v of new Set([...Object.values(RT.adjustMonthly), RT.adjustGeneral.high, RT.adjustGeneral.low])) add("退職手当", `調整月額 ${v}円 retirement.adjustMonthly`, "taishoku", "6_4", yen(v));

  // 若年定年退職者給付金
  add("若年給付金", "1回目・2回目の倍率 youngPension.earlyMultiplier", "boeiKyuyo", "27_3", YP.earlyMultiplier.map(kanjiNum));
  add("若年給付金", "3回目・4回目の倍率 youngPension.lateMultiplier", "boeiKyuyo", "*", YP.lateMultiplier.map(kanjiNum));
  for (const t of [YP.earlyRate, YP.lateRate]) for (const pair of Object.values(t)) for (const v of pair) if (v !== 1) add("若年給付金", `率 ${v} youngPension.earlyRate/lateRate`, "boeiKyuyoRei", "*", kanjiNum(v));
  add("若年給付金", "所得による調整の倍率 youngPension.lowerMultiplier", "boeiKyuyo", "*", kanjiNum(YP.lowerMultiplier));
  return list;
}
// 表の中の額は「五九、一〇〇円」のように1けたずつの漢数字と「、」で書かれている
function digitYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/[0-9,]/g, (c) => (c === "," ? "、" : D[Number(c)])) + "円";
}

// 法令で確かめられない値（毎月、公表資料で人が確かめる）
const manual = [
  ["手当", "3佐以上の配置手当の割合 allowances.seniorRate、航空手当の乗員の区分の割合、配置手当の区分（だれがどの率か）", "防衛大臣の訓令・防衛省職員給与施行細則"],
  ["手当", "特殊勤務手当の日額の初期値 allowances.defaultAmount", "施行令 別表第五（日額の範囲）と訓令"],
  ["手当", "地域手当の経過措置 allowances.regionalTransition（令和10年3月まで）と空港の区域", "人事院規則9-49-57 附則別表第一（人事院の改正通知。e-Gov の9-49本則には載らない）・9-49第4条"],
  ["手当", "寒冷地手当の支給地域・級地（どこが何級地か）", "寒冷地手当法 別表（画面では利用者が級地を選ぶ）"],
  ["階級", "士長→3曹の最短（一般曹候補生）・3曹→3尉の最短（部内幹部の受験資格）・1士→士長の6か月（運用） promotion.choices / fixedMonths", "採用・試験の案内（別表第七によらない前提）"],
  ["階級", "定年の特例（統合幕僚長等62歳、医師・音楽・情報・警務官の1佐以下60歳。自衛隊法施行令 別表第九 備考）", "試算では入れていない。備考が変わっていないかだけ確かめる"],
  ["階級", "一般幹部候補生の候補生の号俸と任官時の号俸 entry.candidate", "その年度の一般幹部候補生採用要項"],
  ["年金・共済", "afterRetire（老齢基礎年金・国民年金保険料）、kyosai（掛金率・標準報酬・上限）", "日本年金機構・防衛省共済組合の公表資料"],
  ["税", "tax（給与所得控除・基礎控除・税率・住民税・退職所得）", "所得税法・租税特別措置法・地方税法、国税庁の公表資料"],
];

module.exports = { build, manual, kanjiInt, kanjiNum, pct, yen };
