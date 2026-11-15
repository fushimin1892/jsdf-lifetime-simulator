// ===================================================================
// 【出典の一覧】 window.SOURCES
// data フォルダの数値が、どの法令のどの条・表から来ているかと、最後に確かめた日を書く。
// 画面（index.html）では読み込まない。tools/egov-check.js（e-Gov との照合）と test/check.js（検査）が使う。
// 手順は「AI用/改正対応の手順書.md」を参照。
//
// laws：法令ごとの e-Gov の ID と、記録したときの e-Gov 上の最新の改正（公布日・施行日・改正法令名）。
//   月次の点検で `node tools/egov-check.js` を実行すると、e-Gov の今の最新と比べて「要確認」を出す。
//   改正の中身を読んで、数値に関係がなければ egovRevision だけ書き換える（関係があれば data を直してから）。
// items：data の場所ごとの根拠（法令の key・条や表・最後に原文と照合した日）。
// ===================================================================
window.SOURCES = {
  laws: [
    {
      key: "boeiKyuyo",
      title: "防衛省の職員の給与等に関する法律",
      num: "昭和二十七年法律第二百六十六号",
      egovId: "327AC0000000266",
      url: "https://laws.e-gov.go.jp/law/327AC0000000266",
      egovRevision: { promulgated: "2026-07-03", enforced: "2026-07-03", by: "防衛省設置法等の一部を改正する法律" },
    },
    {
      key: "boeiKyuyoRei",
      title: "防衛省の職員の給与等に関する法律施行令",
      num: "昭和二十七年政令第三百六十八号",
      egovId: "327CO0000000368",
      url: "https://laws.e-gov.go.jp/law/327CO0000000368",
      egovRevision: { promulgated: "2026-09-30", enforced: "2026-10-01", by: "防衛省設置法等の一部を改正する法律の一部の施行に伴う関係政令の整理に関する政令" },
    },
    {
      key: "ippanKyuyo",
      title: "一般職の職員の給与に関する法律",
      num: "昭和二十五年法律第九十五号",
      egovId: "325AC1000000095",
      url: "https://laws.e-gov.go.jp/law/325AC1000000095",
      egovRevision: { promulgated: "2025-12-24", enforced: "2025-12-24", by: "一般職の職員の給与に関する法律等の一部を改正する法律" },
    },
    {
      key: "jinjiin9_40",
      title: "人事院規則九―四〇（期末手当及び勤勉手当）",
      num: "昭和三十八年人事院規則九―四〇",
      egovId: "338RJNJ09040000",
      url: "https://laws.e-gov.go.jp/law/338RJNJ09040000",
      egovRevision: { promulgated: "2026-02-13", enforced: "2026-04-01", by: "人事院規則九―四〇（期末手当及び勤勉手当）の一部を改正する人事院規則" },
    },
    {
      key: "jinjiin9_49",
      title: "人事院規則九―四九（地域手当）と九―四九―五七（経過措置）",
      num: "平成十八年人事院規則九―四九",
      // e-Gov のタイトル検索では本則が一つに決まらないので、人事院の改正通知で確かめる
      egovId: null,
      url: "https://www.jinji.go.jp/",
    },
    {
      key: "taishoku",
      title: "国家公務員退職手当法",
      num: "昭和二十八年法律第百八十二号",
      egovId: "328AC1000000182",
      url: "https://laws.e-gov.go.jp/law/328AC1000000182",
      egovRevision: { promulgated: "2024-12-25", enforced: "2025-10-01", by: "国会職員の育児休業等に関する法律の一部を改正する法律" },
    },
    {
      key: "taishokuRei",
      title: "国家公務員退職手当法施行令",
      num: "昭和二十八年政令第二百十五号",
      egovId: "328CO0000000215",
      url: "https://laws.e-gov.go.jp/law/328CO0000000215",
      egovRevision: { promulgated: "2026-09-16", enforced: "2026-10-01", by: "日本学術会議法の施行に伴う関係政令の整備に関する政令" },
    },
    {
      key: "jieitai",
      title: "自衛隊法",
      num: "昭和二十九年法律第百六十五号",
      egovId: "329AC0000000165",
      url: "https://laws.e-gov.go.jp/law/329AC0000000165",
      egovRevision: { promulgated: "2026-07-03", enforced: "2026-07-03", by: "防衛省設置法等の一部を改正する法律" },
    },
    {
      key: "jieitaiRei",
      title: "自衛隊法施行令",
      num: "昭和二十九年政令第百七十九号",
      egovId: "329CO0000000179",
      url: "https://laws.e-gov.go.jp/law/329CO0000000179",
      egovRevision: { promulgated: "2026-09-30", enforced: "2026-10-01", by: "防衛省設置法等の一部を改正する法律の一部の施行に伴う関係政令の整理に関する政令" },
    },
    {
      key: "jieitaiKisoku",
      title: "自衛隊法施行規則",
      num: "昭和二十九年総理府令第四十号",
      egovId: "329M50000002040",
      url: "https://laws.e-gov.go.jp/law/329M50000002040",
      egovRevision: { promulgated: "2026-10-16", enforced: "2026-10-16", by: "自衛隊法施行規則の一部を改正する省令" },
    },
    {
      key: "kanreichi",
      title: "国家公務員の寒冷地手当に関する法律",
      num: "昭和二十四年法律第二百号",
      egovId: "324AC1000000200",
      url: "https://laws.e-gov.go.jp/law/324AC1000000200",
      egovRevision: { promulgated: "2024-12-25", enforced: "2024-12-25", by: "一般職の職員の給与に関する法律等の一部を改正する法律" },
    },
    {
      key: "kyosai",
      title: "国家公務員共済組合法",
      num: "昭和三十三年法律第百二十八号",
      egovId: "333AC0000000128",
      url: "https://laws.e-gov.go.jp/law/333AC0000000128",
      egovRevision: { promulgated: "2026-06-25", enforced: "2027-04-01", by: "社会福祉法等の一部を改正する法律" },
    },
    {
      key: "kokunen",
      title: "国民年金法",
      num: "昭和三十四年法律第百四十一号",
      egovId: "334AC0000000141",
      url: "https://laws.e-gov.go.jp/law/334AC0000000141",
      egovRevision: { promulgated: "2025-06-20", enforced: "2025-06-20", by: "社会経済の変化を踏まえた年金制度の機能強化のための国民年金法等の一部を改正する等の法律" },
    },
    {
      key: "kosei",
      title: "厚生年金保険法",
      num: "昭和二十九年法律第百十五号",
      egovId: "329AC0000000115",
      url: "https://laws.e-gov.go.jp/law/329AC0000000115",
      egovRevision: { promulgated: "2025-06-20", enforced: "2025-06-20", by: "社会経済の変化を踏まえた年金制度の機能強化のための国民年金法等の一部を改正する等の法律" },
    },
    {
      key: "shotoku",
      title: "所得税法",
      num: "昭和四十年法律第三十三号",
      egovId: "340AC0000000033",
      url: "https://laws.e-gov.go.jp/law/340AC0000000033",
      egovRevision: { promulgated: "2026-07-23", enforced: "2026-08-12", by: "金融商品取引法及び資金決済に関する法律の一部を改正する法律" },
    },
    {
      key: "sozei",
      title: "租税特別措置法",
      num: "昭和三十二年法律第二十六号",
      egovId: "332AC0000000026",
      url: "https://laws.e-gov.go.jp/law/332AC0000000026",
      egovRevision: { promulgated: "2026-07-23", enforced: "2026-08-12", by: "金融商品取引法及び資金決済に関する法律の一部を改正する法律" },
    },
    {
      key: "chihozei",
      title: "地方税法",
      num: "昭和二十五年法律第二百二十六号",
      egovId: "325AC0000000226",
      url: "https://laws.e-gov.go.jp/law/325AC0000000226",
      egovRevision: { promulgated: "2026-07-17", enforced: "2027-04-16", by: "科学技術・イノベーション創出の活性化に関する法律の一部を改正する法律" },
    },
  ],

  // e-Gov にない公表資料（法令ではないが値の確認に使う）
  pages: [
    { key: "modHouan", title: "防衛省「国会提出法案」（給与法改正案の提出日・法律番号・公布日）", url: "https://www.mod.go.jp/j/presiding/houan/index.html" },
    { key: "jinjiin", title: "人事院（給与勧告・人事院規則の改正通知）", url: "https://www.jinji.go.jp/" },
    { key: "nenkin", title: "日本年金機構（年金額・国民年金保険料）", url: "https://www.nenkin.go.jp/" },
    { key: "boeiKyosai", title: "防衛省共済組合（掛金等・負担金）", url: "https://www.boueikyosai.or.jp/" },
  ],

  // data の場所 → 根拠。checked は原文と照合した日（数値を直したら、その日の日付に）
  items: [
    { path: "PAY_TABLE", file: "data/pay-table.js", law: "boeiKyuyo", where: "別表第二（自衛官俸給表）", checked: "2026-11-16", how: "node tools/egov-check.js paytable で e-Gov（2026-10-01 施行版）と全1,388欄一致" },
    { path: "PROMOTION_TABLE", file: "data/promotion-table.js", law: "boeiKyuyoRei", where: "別表第一ロ（第六条の六関係）", checked: "2026-11-16", how: "node tools/egov-check.js promotion で e-Gov（2026-10-01 施行版）と全145行一致" },
    { path: "RULES.promotion.retireAge", law: "jieitaiRei", where: "別表第九", checked: "2026-10-30" },
    { path: "RULES.promotion.choices", law: "jieitaiKisoku", where: "別表第七ほか", checked: "2026-10-30" },
    { path: "RULES.promotion.restrict*", law: "boeiKyuyoRei", where: "第六条の十四・第六条の十四の二", checked: "2026-10-30" },
    { path: "RULES.bonus.kimatsuMonths / kinbenMonths / kimatsuPer", law: "ippanKyuyo", where: "第十九条の四・第十九条の七", checked: "2026-10-30" },
    { path: "RULES.bonus.kinbenStandard / kinbenPeriod", law: "jinjiin9_40", where: "第十三条・別表第二", checked: "2026-10-30" },
    { path: "RULES.bonus.rankAdd / managerAdd", law: "boeiKyuyoRei", where: "別表第八・第十二条の六", checked: "2026-10-30" },
    { path: "RULES.allowances.eigai", law: "boeiKyuyo", where: "第十八条", checked: "2026-10-30" },
    { path: "RULES.allowances.barracksBonus", law: "boeiKyuyo", where: "第二十六条の二（額は施行令）", checked: "2026-10-30" },
    { path: "RULES.allowances.managerPay", law: "boeiKyuyoRei", where: "別表第四", checked: "2026-10-30" },
    { path: "RULES.allowances.placement / seniorRate", law: "boeiKyuyoRei", where: "第十二条（割合の区分は各訓令）", checked: "2026-10-30" },
    { path: "RULES.allowances.manualGroups / branchOnly / defaultAmount", law: "boeiKyuyoRei", where: "別表第五", checked: "2026-10-30" },
    { path: "RULES.allowances.regionalAreas / regionalTransition", law: "jinjiin9_49", where: "別表第一・九―四九―五七 附則別表第一", checked: "2026-10-30" },
    { path: "RULES.allowances.wideRates", law: "ippanKyuyo", where: "第十一条の八（勧告の割合。法改正の成立待ち）", checked: "2026-10-30" },
    { path: "RULES.allowances.calcRates", law: "ippanKyuyo", where: "第十一条・第十一条の十・第十二条・第十二条の二（寒冷地は寒冷地手当法第二条）", checked: "2026-10-30" },
    { path: "RULES.retirement", law: "taishoku", where: "第三条〜第六条の五・附則（83.7％）", checked: "2026-10-30" },
    { path: "RULES.entry", law: "jieitai", where: "第三十六条（任期）・防衛省給与法第二十八条（任期満了金）", checked: "2026-10-30" },
    { path: "RULES.youngPension", law: "boeiKyuyo", where: "第二十七条の二〜・施行令第二十二条〜第二十四条", checked: "2026-10-30" },
    { path: "RULES.afterRetire", law: "kokunen", where: "第二十七条・第八十七条（年額・保険料は日本年金機構の公表額）", checked: "2026-10-30" },
    { path: "RULES.kyosai", law: "kyosai", where: "掛金率は防衛省共済組合の公表資料", checked: "2026-10-30" },
    { path: "RULES.tax", law: "shotoku", where: "所得税法・租税特別措置法・地方税法", checked: "2026-10-30" },
  ],

  // 出ているが、まだ法令になっていないもの（成立・公布したら data に入れる）
  pending: [
    {
      what: "令和8年人事院勧告（月例給の引上げ、賞与 年4.70か月、転居に関する手当の新設は2027年4月）",
      status: "防衛省の職員の給与等に関する法律の一部を改正する法律案を第222回国会（臨時）に令和8年10月9日提出。2026-11-16 時点で法律番号・公布日の記載なし（未公布）",
      url: "https://www.mod.go.jp/j/presiding/houan/index.html",
      checked: "2026-11-16",
    },
  ],
};
