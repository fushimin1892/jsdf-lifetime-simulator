// simulator.js：生涯年収シミュレーターの本体。
// 入力欄の読み取り → 月ごとの俸給・賞与・手当の計算（model）→ 退職手当・若年定年退職者給付金（retirement）
// → 税・共済掛金・手取り → 結果の表・グラフ・比較・共有URL・CSV（run）。法令の数値は window.RULES から読む。
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    fmt = (n) => Math.round(n).toLocaleString("ja-JP") + "円";
  // 俸給表の列番号 → 表示する階級名
  const rankNames = {
    0: "将",
    2: "将補",
    3: "1佐",
    4: "1佐",
    5: "1佐",
    6: "2佐",
    7: "3佐",
    8: "1尉",
    9: "2尉",
    10: "3尉",
    11: "准尉",
    12: "曹長",
    13: "1曹",
    14: "2曹",
    15: "3曹",
    16: "士長",
    17: "1士",
    18: "2士",
  };
  // ---- 法令の数値は window.RULES（法令の数値のブロック）から読む。ここには計算のしかただけを書く ----
  const R = window.RULES,
    B = R.bonus,
    AL = R.allowances,
    RT = R.retirement,
    YP = R.youngPension,
    KY = R.kyosai,
    TX = R.tax;
  // 「上限以下なら値」の表を引く：rows は [上限, 値…] の並び（上限の小さい順）
  const pick = (rows, v) => rows.find((r) => v <= r[0]);
  // 期末手当の在職期間割合：基準日以前6か月の在職期間（満月数）
  const kimatsuRate = (months) => B.kimatsuPeriod.find(([m]) => months >= m)[1];
  // 勤勉手当の期間率：半月（15日）刻み
  const kinbenRate = (months, days) => (months >= 6 ? 1 : B.kinbenPeriod[months * 2 + (days >= 15 ? 1 : 0)]);
  // 賞与の1回あたりの割合 [期末手当, 勤勉手当の標準の成績率]。令和8年度までは6月期と12月期で違い（RULES.bonus.split）、
  // 令和9年度からは同じ（RULES.bonus.kimatsuPer / kinbenStandard）。fy はその月の年度、month は 6 か 12
  const bonusPer = (cls, fy, month) => {
    const sp = B.split && fy <= B.split.untilFy ? B.split : null,
      i = month === 6 ? 0 : 1;
    return sp ? [sp.kimatsuPer[cls][i], sp.kinbenStandard[cls][i]] : [B.kimatsuPer[cls], B.kinbenStandard[cls]];
  };
  // 賞与の区分（指定職・特定管理職員・一般）
  const bonusClass = (rank, special, manager) => (rank <= B.shiteiCols ? "shitei" : special && B.tokuteiManagers.includes(manager) ? "tokutei" : "normal");
  // 賞与の階級による加算割合（俸給表の列番号ごと。表にない列は0）
  const bonusRate = (col) => B.rankAdd.find(([max]) => col <= max)?.[1] ?? 0;
  const SENIOR_RATE = AL.seniorRate,
    EIGAI = AL.eigai,
    MANAGER_PAY = AL.managerPay,
    MANAGER_BONUS = B.managerAdd,
    FUYOU_PARENT = AL.calcRates.fuyouParentByCol;
  // 生活の手当：勤務の内容によらないので教育期間中も支給する（配置手当・特殊勤務手当など勤務の手当は教育期間中は付けない）。
  // 手当の行に kind（手当の種類）があれば kind、なければ名前で判定する
  const LIVING_ALLOWANCES = ["扶養手当", "住居手当", "通勤手当", "単身赴任手当", "転居手当", "寒冷地手当", "地域手当", "広域異動手当", "在宅勤務等手当"],
    REGIONAL_NAMES = ["地域手当", "広域異動手当"],
    isLiving = (a) => LIVING_ALLOWANCES.includes(a.kind ?? a.name);
  // ---- 退職手当 ----
  const ART3 = RT.art3,
    ART4 = RT.art4,
    ART5 = RT.art5;
  const bandMonths = (bands, n) => bands.reduce((s, [from, to, r]) => s + Math.max(0, Math.min(n, to) - from + 1) * r, 0);
  // 退職手当の調整月額（将は号俸で区分が分かれる。表にない列は0）
  const adjustMonthly = (col, grade) =>
    col === 0 ? (grade >= RT.adjustGeneral.highGrade ? RT.adjustGeneral.high : RT.adjustGeneral.low) : (RT.adjustMonthly[col] ?? 0);
  // ---- 若年定年退職者給付金 ----
  const EARLY_RATE = YP.earlyRate,
    LATE_RATE = YP.lateRate;
  const civilRetireAge = (fy) => YP.civilRetireAge.find(([until]) => fy <= until)[1];
  // ---- 共済掛金 ----
  const KYOSAI = KY;
  // 厚生年金の標準報酬月額の上限。ym＝年×12＋(月−1)
  const pensionCap = (ym) => KY.pensionCaps.reduce((cap, [y, m, v]) => (ym >= y * 12 + m - 1 ? v : cap), KY.pensionCaps[0][2]);
  // ---- 所得税・住民税 ----
  // 給与所得控除（所得税法第28条第3項の式。最低保障額は租税特別措置法第29条の4）
  const salaryFormula = (x) => {
    const [, r, add] = TX.salaryDeduction.find(([max]) => x <= max);
    return x * r + add;
  };
  const salaryMinimum = (x, y) => {
    const m = TX.salaryMin;
    return y < m.specialYears[0] ? m.before2026 : y <= m.specialYears[1] && x < m.specialIncomeBelow ? m.special : m.base;
  };
  function salaryDeduction(x, y) {
    return Math.max(salaryFormula(x), salaryMinimum(x, y));
  }
  // 給与所得の金額（所得税法第28条第4項・別表第五）。収入が660万円未満のときは別表第五による：
  // 収入を4,000円単位に切り捨てた額に式を当てはめる（国税庁 No.1410 の「収入金額÷4（千円未満切捨て）×4」と同じ）。
  // 最低保障額のほうが大きいときは、収入から最低保障額を引いた額
  function salaryIncome(x, y) {
    if (x <= 0) return 0;
    const min = salaryMinimum(x, y);
    if (salaryFormula(x) <= min) return Math.max(0, x - min);
    const base = x < TX.salaryTable.below ? Math.floor(x / TX.salaryTable.unit) * TX.salaryTable.unit : x;
    return Math.max(0, Math.floor(base - salaryFormula(base)));
  }
  // 所得金額調整控除（租税特別措置法第41条の3の11第1項）：給与収入が850万円を超え、本人・同一生計配偶者・扶養親族が特別障害者か、
  // 23歳未満の扶養親族がいる場合に、（収入（1,000万円が上限）−850万円）×10％を給与所得から引く。
  // 入力で分かる条件は「23歳未満の扶養親族」（特定扶養親族、扶養手当を受けている子）だけ。特別障害者は入力がないので含めない
  function incomeAdjustment(x, eligible) {
    const A = TX.incomeAdjust;
    return eligible && x > A.threshold ? Math.ceil((Math.min(x, A.cap) - A.threshold) * A.rate) : 0;
  }
  // 所得税の基礎控除。g：合計所得金額
  function basicDeduction(g, y) {
    const high = TX.basicHigh.find(([max]) => g <= max);
    if (high[1] != null) return high[1];
    return pick(TX.basicByYear.find(([until]) => y <= until)[1], g)[1];
  }
  // 所得税の速算表
  const progressive = (t) => {
    const [, r, d] = TX.incomeTax.find((b) => t < b[0]);
    return Math.max(0, t * r - d);
  };
  // 復興特別所得税（2027年以後は防衛特別所得税と合わせて同じ率）を加え、100円未満を切り捨て
  const withSurtax = (tax) => Math.floor((tax * (1 + TX.surtax)) / 100) * 100;
  // 給与の所得税（年末調整で精算した年額）と住民税（その年の所得に対する年額）。f：配偶者・扶養親族
  // under23：その年に23歳未満の扶養親族がいる（所得金額調整控除の条件）。other：給与以外の所得（一時所得の課税対象額など）
  function salaryTaxes(income, social, y, f, under23 = false, other = 0) {
    const g = Math.max(0, salaryIncome(income, y) - incomeAdjustment(income, under23)) + other,
      sp = f.spouse ? pick(TX.spouse, g) : null,
      floor1000 = (v) => Math.max(0, Math.floor(v / 1000) * 1000),
      dep = TX.dependent,
      res = TX.resident;
    const it = withSurtax(
      progressive(floor1000(g - social - basicDeduction(g, y) - (sp?.[1] ?? 0) - f.general * dep.general[0] - f.specific * dep.specific[0])),
    );
    // 住民税：所得割から調整控除を引き、均等割を加える
    const rb = pick(res.basic, g)[1],
      t = floor1000(g - social - rb - (sp?.[2] ?? 0) - f.general * dep.general[1] - f.specific * dep.specific[1]),
      diff = res.diff.basic + (f.spouse && g <= TX.spouse.at(-1)[0] ? res.diff.spouse : 0) + f.general * res.diff.general + f.specific * res.diff.specific,
      adj = g > res.adjMaxIncome ? 0 : t <= res.adjBorder ? Math.min(diff, t) * res.adjRate : Math.max((diff - (t - res.adjBorder)) * res.adjRate, res.adjMin),
      rt = g <= res.exemptIncome ? 0 : Math.max(0, Math.floor((t * res.rate - adj) / 100) * 100) + res.kintou;
    return { it, rt };
  }
  // 退職所得の税。deduction：退職所得控除額
  function retirementTaxes(amount, years, deduction) {
    let x = Math.max(0, amount - deduction);
    const ss = TX.shortService;
    // 勤続5年以下は、控除後300万円を超える部分を2分の1にしない（短期退職手当等）
    x = years <= ss.years && x > ss.half ? ss.half / 2 + (x - ss.half) : x / 2;
    const t = Math.floor(x / 1000) * 1000;
    return { it: Math.floor(progressive(t) * (1 + TX.surtax)), rt: Math.floor((t * TX.resident.rate) / 100) * 100 };
  }
  const rd = TX.retirementDeduction,
    retirementDeduction = (n) => (n <= rd.border ? Math.max(rd.min, rd.perYear * n) : rd.base + rd.perYearAfter * (n - rd.border));
  // 昇任の順番（俸給表の列番号）：2士→1士→士長→3曹→…→1佐（3）→1佐（2）→1佐（1）→将補（2）
  const LADDER = [18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  // 予想階級までの昇任の順番（3曹の次から）。col：俸給表の列、step：昇任までの年数の入力欄
  const enlistedPath = [
    { name: "2曹", col: 14, step: "stepSgt2" },
    { name: "1曹", col: 13, step: "stepSgt1" },
    { name: "曹長", col: 12, step: "stepSgm" },
    { name: "准尉", col: 11, step: "stepWo" },
  ];
  const officerPath = [
    { name: "3尉", col: 10, step: "stepOfc" },
    { name: "2尉", col: 9, step: "second" },
    { name: "1尉", col: 8, step: "first" },
    { name: "3佐", col: 7, step: "stepMaj" },
    { name: "2佐", col: 6, step: "stepLtc" },
    { name: "1佐", col: null, step: "stepCol" },
    { name: "将補", col: 2, step: "stepMg" },
    { name: "将", col: 0, step: "stepGen" },
  ];
  function model(table, c) {
    let level = c.initialGrade - 1,
      rank = c.initialRank ?? 18,
      total = 0,
      events = [],
      monthly = [];
    function available(r) {
      return table.map((row, i) => (row[r] != null ? i : -1)).filter((i) => i >= 0);
    }
    const label = () => `${rankNames[rank]} ${level + 1}号俸`;
    // 対応表がない昇任（将補→将など）は、直前の俸給を下回らない最も低い号俸にする
    function approximate(to) {
      const previous = table[level]?.[rank],
        options = available(to),
        found = options.find((i) => table[i][to] >= previous);
      level = found === undefined ? options[options.length - 1] : found;
      rank = to;
    }
    // 昇任後の号俸は施行令 別表第一ロの対応表で決める。
    // 2階級以上の昇任は、1階級ずつ順に昇任したものとして対応表を当てはめる（施行令第6条の6第2項）
    function promote(to, m) {
      const from = label(),
        steps = to === 0 ? [0] : LADDER.slice(LADDER.indexOf(rank) + 1, LADDER.indexOf(to) + 1);
      for (const s of steps) {
        // 将の号俸は官職で決まる（施行令第6条の20第2項）
        if (s === 0) {
          rank = 0;
          level = (c.generalGrade || 1) - 1;
          continue;
        }
        const g = c.promotionTable?.[level]?.[s - 2];
        if (g != null) {
          level = g - 1;
          rank = s;
        } else approximate(s);
      }
      events.push({ month: m, from, to: label() });
    }
    // 地域手当の異動保障（一般職給与法第11条の7第1項）：地域手当のある勤務地に6か月を超えて在勤し、
    // 割合の低い勤務地（地域手当なしを含む）へ異動したら、異動から1年目は異動前の割合、2年目は80％、3年目は60％を保障する
    // （新しい勤務地の割合の方が高い月はその割合）。「支給終了」が定年より前の地域手当を異動とみなす
    const serviceMonths = (c.retireAge - c.startAge) * 12,
      ymOfMonth = (m) => (c.entryYear || 2026) * 12 + c.entryMonth - 1 + m,
      fyOfYm = (ym) => Math.floor(ym / 12) - (ym % 12 < 3 ? 1 : 0),
      guarantees = c.allowances
        .filter((a) => (a.kind ?? a.name) === "地域手当" && a.endMonth < serviceMonths && a.endMonth - a.startMonth > 6)
        .map((a) => ({
          from: a.endMonth,
          rate: a.area ? R.regionalRate(a.area.pref, a.area.name, fyOfYm(ymOfMonth(a.endMonth - 1))) : a.amount,
        }))
        .filter((g) => g.rate > 0);
    const guaranteesAt = (m) =>
      guarantees
        .filter((g) => m >= g.from && m < g.from + 36)
        .map((g) => ({
          name: "地域手当",
          method: "percent",
          guarantee: true,
          bonusBase: true,
          amount: g.rate * [1, 0.8, 0.6][Math.floor((m - g.from) / 12)],
          startMonth: g.from,
          endMonth: g.from + 36,
        }));
    for (let m = 0; m < (c.retireAge - c.startAge) * 12; m++) {
      // 暦の月（1〜12）。入隊月から数える
      const month = ((c.entryMonth - 1 + m) % 12) + 1,
        // 満年齢（誕生月を入隊月とみなす）。55歳以降は全階級で昇給が抑制される
        // （給与法第5条第2項で準用する一般職給与法第8条第8項第1号）
        age55 = c.startAge + Math.floor(m / 12) >= R.promotion.restrictAge;
      // 昇給は毎年1月1日（将は官職で号俸が決まるので昇給しない）
      if (m > 0 && month === 1 && rank !== 0) {
        // 入隊後最初の昇給は、入隊から12月末までの月数で月割り（施行令第6条の14第2項）。
        // 10〜12月に入隊した場合の基準は昇給号俸数表のC欄（4号俸）（給実甲第326号 第37条関係第18項）
        let n = m < 12 ? Math.floor(((c.entryMonth >= 10 ? R.promotion.lateEntryRaise : c.raise) * m) / 12) : c.raise;
        // 昇給抑制：55歳以降の職員と、1佐（1）（2）欄以上の自衛官は、
        // 勤務成績が「極めて良好」で2号俸、「特に良好」で1号俸、それ以外は昇給しない（施行令第6条の14の2）
        if (age55 || rank <= R.promotion.restrictCol) n = R.promotion.restricted.find(([min]) => c.raise >= min)?.[1] ?? 0;
        const options = available(rank);
        level = Math.min(level + n, options[options.length - 1]);
        while (table[level][rank] == null && level > 0) level--;
      }
      // 幹部候補生の任官のように階級と号俸が決まっている昇任は、そのまま当てはめる
      for (const p of c.promotions)
        if (m === p.month) {
          if (p.grade) {
            const from = c.payOverride && m === c.payOverride.until ? "幹部候補生（教育中）" : label();
            rank = p.col;
            level = p.grade - 1;
            events.push({ month: m, from, to: label() });
          } else promote(p.col, m);
        }
      // 幹部候補生の間は防衛省令の額（2曹の号俸と同額）
      const candidate = c.payOverride && m < c.payOverride.until,
        pay = candidate ? table[c.payOverride.grade - 1][c.payOverride.col] : table[level]?.[rank];
      if (!Number.isFinite(pay)) throw Error("該当する俸給がありません。条件を変更してください。");
      // 配置手当の計算に使う「階級の最低号俸」（将は将補（2）欄の最低号俸）。
      // 3佐以上は防衛大臣が定める割合を掛ける
      const firstCol = rank === 0 ? 2 : rank,
        firstPay = Math.floor(table[available(firstCol)[0]][firstCol] * (SENIOR_RATE[firstCol] ?? 1)),
        // 教育期間（教育隊・3曹昇任前の教育・幹部候補生学校）は、勤務の内容に応じた手当（配置手当・特殊勤務手当など）と
        // 営外手当・俸給の特別調整額を付けない。生活の手当（LIVING_ALLOWANCES）は教育期間中も支給し、賞与の基礎にも入れる
        inEducation = (c.education || []).some(([s, e]) => m >= s && m < e),
        eigai = !inEducation && c.eigaiStart != null && m >= c.eigaiStart && rank >= 12 ? EIGAI : 0,
        // 俸給の特別調整額（管理職）と賞与の管理職加算の割合
        special = inEducation ? 0 : (MANAGER_PAY[c.manager]?.[rank] ?? 0),
        // その月の年度（4月〜翌3月）。地域手当は年度ごとの割合（経過措置）を使う
        ymNow = (c.entryYear || 2026) * 12 + c.entryMonth - 1 + m,
        fyNow = Math.floor(ymNow / 12) - (ymNow % 12 < 3 ? 1 : 0),
        // 教育期間は生活の手当と、年1回まとめて支給する分（指定場所生活調整金）だけを対象にする
        list = c.allowances
          .concat(guaranteesAt(m))
          .filter((a) => !inEducation || a.method === "year_end" || isLiving(a))
          .map((a) =>
            a.area
              ? { ...a, amount: R.regionalRate(a.area.pref, a.area.name, fyNow) }
              : // 階級で額が決まる手当（本府省業務調整手当・航海手当）は、その月の階級の額
                a.rankTable
                ? { ...a, amount: a.rankTable[rank] ?? 0 }
                : // 上位の階級では父母等の扶養手当が減る（施行令第8条の7・第8条の8）
                  (a.parents && FUYOU_PARENT[rank] != null) || a.children?.length
                  ? {
                      ...a,
                      amount:
                        a.amount -
                        (a.parents && FUYOU_PARENT[rank] != null ? a.parents * (AL.calcRates.fuyou.parent - FUYOU_PARENT[rank]) : 0) +
                        // 生年月日で入れた子：支給の月（from〜end）は1人13,000円、teenFrom からは5,000円を加算（一般職給与法第11条第2項・第4項、人事院規則9-80第5条）
                        (a.children || []).reduce(
                          (sum, k) =>
                            ymNow >= k.from && ymNow <= k.end ? sum + AL.calcRates.fuyou.child + (ymNow >= k.teenFrom ? AL.calcRates.fuyou.teenAdd : 0) : sum,
                          0,
                        ),
                    }
                  : // 単身赴任手当の距離の加算は2027年3月まで（令和8年法律第79号第2条。2027年4月1日施行）
                    a.tanshinAdd && fyNow > AL.calcRates.tanshin.addUntilFy
                    ? { ...a, amount: Math.max(0, a.amount - a.tanshinAdd) }
                    : // 転居手当は2027年4月から（同法第2条で新設）
                      (a.kind ?? a.name) === "転居手当" && fyNow < AL.calcRates.tenkyo.fromFy
                      ? { ...a, amount: 0 }
                      : a,
          ),
        managerRate = rank <= 1 ? B.generalManagerAdd : special ? (MANAGER_BONUS[c.manager] ?? 0) : 0,
        // 月例の地域手当・広域異動手当の計算の基礎に俸給へ加える額：俸給の特別調整額＋営外手当（扶養手当は手当側で加える）。
        // 自衛官は営外手当も基礎に入る（防衛省給与法第14条による一般職給与法第11条の3・第11条の8の読み替え）
        regionalExtra = special + eigai,
        AS = window.allowanceSimulator,
        isRegional = (a) => REGIONAL_NAMES.includes(a.kind ?? a.name),
        isFuyou = (a) => (a.kind ?? a.name) === "扶養手当",
        // 賞与の基礎の地域手当・広域異動手当は「俸給・扶養手当・営外手当に対する分」だけで、俸給の特別調整額に対する分は含めない
        // （一般職給与法第19条の4第4項・第19条の7第2項。営外手当は防衛省給与法第18条の2で俸給に加える）。
        // 期末手当の基礎：俸給＋扶養手当＋営外手当＋それらに対する地域手当・広域異動手当
        kimatsuAllow = AS.bonusBase(list, pay, m, false, eigai),
        // 勤勉手当の基礎：扶養手当と、扶養手当に対する地域手当・広域異動手当を除く（一般職給与法第19条の7第2項）
        kinbenAllow = AS.bonusBase(
          list.filter((a) => !isFuyou(a)),
          pay,
          m,
          true,
          eigai,
        ),
        // 階級による加算（一般職給与法第19条の4第5項・防衛省給与法第18条の2）：
        // （俸給＋営外手当＋それらに対する地域手当・広域異動手当）× 加算割合。管理職加算は俸給月額 × 割合
        rankAddBase = pay + eigai + AS.bonusBase(list.filter(isRegional), pay, m, false, eigai),
        added = pay + Math.floor(rankAddBase * bonusRate(rank)) + Math.floor(pay * managerRate) + eigai,
        kimatsuBase = added + kimatsuAllow,
        kinbenBase = added + kinbenAllow;
      let bonus = 0,
        kinben = 0;
      // 入隊は月の初日とみなすので、基準日（6月1日・12月1日）までの在職期間は入隊からの月数になる
      if (month === 6 || month === 12) {
        // 入力した年間月数が法律の合計（4.70か月）と違うときは、同じ比率で増減する
        const scale = c.bonus / B.annualMonths,
          cls = bonusClass(rank, special, c.manager),
          [kimatsuPer, kinbenPer] = bonusPer(cls, fyNow, month);
        kinben = Math.floor(kinbenBase * kinbenPer * scale * kinbenRate(m, 0));
        bonus = Math.floor(kimatsuBase * kimatsuPer * scale * kimatsuRate(m)) + kinben;
      }
      const sum = (filter) => window.allowanceSimulator.monthly(list.filter(filter), pay, m, firstPay, regionalExtra),
        allowances = Math.floor(sum(() => true) + eigai + special),
        // 年1回まとめて支給する分（指定場所生活調整金）は、共済掛金では期末手当等と同じに扱う
        lump = sum((a) => a.method === "year_end"),
        ym = (c.entryYear || 2026) * 12 + c.entryMonth - 1 + m;
      monthly.push({
        pay,
        basePay: pay,
        col: rank,
        rank: candidate ? "幹部候補生（教育中）" : rankNames[rank],
        grade: candidate ? null : level + 1,
        promotions: events.filter((e) => e.month === m),
        bonus,
        allowances,
        lump,
        // 非課税の通勤手当、若年定年退職者給付金の計算に使う扶養手当・営外手当
        // 通勤手当は、所得税の非課税限度額（定期代と、車の片道距離ごとの限度額。合わせて月15万円）までが非課税
        nontax: Math.floor(
          list
            .filter((a) => (a.kind ?? a.name) === "通勤手当")
            .reduce((s, a) => s + Math.min(window.allowanceSimulator.monthly([a], pay, m, firstPay, regionalExtra), a.nontaxAmount ?? Infinity), 0),
        ),
        fuyou: sum((a) => (a.kind ?? a.name) === "扶養手当"),
        eigai,
        // 所得金額調整控除の条件に使う：扶養手当を受けている子（22歳になった後の最初の3月まで）がいる月
        childUnder23: list.some((a) => (a.children || []).some((k) => ymNow >= k.from && ymNow <= k.end)),
        // 令和10年4月以後に退職した人の加算調整上限額に使う手当（給与法第27条の4第1項）：俸給の特別調整額・対象の手当・勤勉手当
        kasan: Math.floor(special + sum((a) => YP.newSystem.kasanNames.includes(a.kind ?? a.name)) + kinben),
        year: Math.floor(ym / 12),
        ym,
        age: c.startAge + Math.floor(m / 12),
      });
    }
    // 標準報酬（国家公務員共済組合法第40条）。basis：標準報酬の基礎になっている報酬月額
    //   資格取得時決定：入隊時の報酬で決め、その年の8月まで（6〜12月の入隊は翌年8月まで）
    //   定時決定：毎年4〜6月の報酬の平均で、9月から翌年8月まで（6月1日以後に入隊した年と、7〜9月に随時改定した年は行わない）
    //   随時改定：報酬が変わった月から3か月の平均が2等級以上ずれたら、4か月目から改定
    const N = monthly.length,
      remOf = (x) => x.pay + x.allowances - x.lump,
      gradeOf = (v) => {
        let g = 0;
        while (g + 1 < KY.stdTable.length && v >= KY.stdTable[g + 1][0]) g++;
        return g;
      },
      pensionGrade = (v, ym) => {
        const amount = Math.min(Math.max(KY.stdTable[gradeOf(v)][1], KY.pensionStdMin), pensionCap(ym));
        return KY.stdTable.findIndex(([, a]) => a === amount);
      },
      basis = [],
      pending = {},
      skipTeiji = {},
      entry = monthly[0];
    let cur = remOf(entry);
    for (let i = 0; i < N; i++) {
      const x = monthly[i],
        cm = x.ym % 12;
      if (pending[i] != null) cur = pending[i];
      else if (cm === 8 && !skipTeiji[x.year] && !(entry.year === x.year && entry.ym % 12 >= 5)) {
        const src = [i - 5, i - 4, i - 3].filter((k) => k >= 0).map((k) => monthly[k]);
        if (src.length) cur = src.reduce((s, y) => s + remOf(y), 0) / src.length;
      }
      basis[i] = cur;
      if (i >= 1 && i + 3 < N && remOf(x) !== remOf(monthly[i - 1])) {
        const avg = (remOf(x) + remOf(monthly[i + 1]) + remOf(monthly[i + 2])) / 3,
          ymAt = monthly[i + 3].ym,
          far = Math.abs(gradeOf(avg) - gradeOf(cur)) >= KY.revisionGrades || Math.abs(pensionGrade(avg, ymAt) - pensionGrade(cur, ymAt)) >= KY.revisionGrades;
        // 報酬が上がったときは等級も上がる場合だけ、下がったときは下がる場合だけ改定する
        if (far && Math.sign(avg - cur) === Math.sign(remOf(x) - remOf(monthly[i - 1]))) {
          pending[i + 3] = avg;
          if ([6, 7, 8].includes(ymAt % 12)) skipTeiji[monthly[i + 3].year] = true;
        }
      }
    }
    // 共済掛金（月々の報酬と期末・勤勉手当等）
    const shortUsed = {};
    for (const [i, x] of monthly.entries()) {
      const general = x.col === 0,
        shortRate =
          (general ? KY.general.short : KY.short) +
          (general ? KY.general.welfare : KY.welfare) +
          (x.age >= KY.careAge[0] && x.age < KY.careAge[1] ? KY.care : 0) +
          (x.ym >= KY.childFrom[0] * 12 + KY.childFrom[1] - 1 ? KY.child : 0),
        longRate = KY.pension + KY.retire,
        stdShort = KY.stdTable[gradeOf(basis[i])][1],
        stdPension = Math.min(Math.max(stdShort, KY.pensionStdMin), pensionCap(x.ym)),
        b = Math.floor((x.bonus + x.lump) / 1000) * 1000,
        // 短期の標準期末手当等は年度（4月〜翌3月）の上限まで、厚生年金は1回の上限まで
        fy = x.year - (x.ym % 12 < 3 ? 1 : 0),
        bShort = Math.min(b, Math.max(0, KY.bonusShortYearCap - (shortUsed[fy] || 0)));
      shortUsed[fy] = (shortUsed[fy] || 0) + bShort;
      x.social =
        Math.floor(stdShort * shortRate) +
        Math.floor(stdPension * longRate) +
        Math.floor(bShort * shortRate) +
        Math.floor(Math.min(b, KY.bonusPensionCap) * longRate);
      // 老齢厚生年金（報酬比例部分）の見込みに使う、厚生年金の標準報酬月額と標準賞与額
      x.pensionStd = stdPension + Math.min(b, KY.bonusPensionCap);
    }
    // 所得税・住民税は暦年（1〜12月）の給与で計算する（入隊前の収入は0とみなす）。
    //   所得税：源泉徴収と年末調整でその年のうちに納める。月ごとの額は、その月の給与の額に比例して割り振る（年ごとの表示用）
    //   住民税：その年の所得に対して翌年6月〜翌々年5月に給与から差し引く（地方税法第321条の3〜第321条の5）。
    //     年税額の12分の1（100円未満は6月分にまとめる）。1〜4月に退職すると5月までの残りを退職時に一括で、
    //     それ以外は退職後に自分で納める（afterResident）
    const family = c.family || { spouse: false, general: 0, specific: 0 },
      byYear = new Map();
    for (const x of monthly) {
      x.taxable = x.pay + x.allowances + x.bonus - x.nontax;
      x.incomeTax = 0;
      x.residentTax = 0;
      if (!byYear.has(x.year)) byYear.set(x.year, []);
      byYear.get(x.year).push(x);
    }
    const lastYm = monthly.at(-1).ym,
      lumpUntil = lastYm % 12 <= 3 ? Math.floor(lastYm / 12) * 12 + 4 : -1;
    let afterResident = 0;
    for (const [y, list] of byYear) {
      const income = list.reduce((s, x) => s + x.taxable, 0),
        { it, rt } = salaryTaxes(
          income,
          list.reduce((s, x) => s + x.social, 0),
          y,
          family,
          family.specific > 0 || list.some((x) => x.childUnder23),
        );
      let left = it;
      list.forEach((x, k) => {
        const v = k === list.length - 1 ? left : income > 0 ? Math.floor((it * x.taxable) / income) : 0;
        x.incomeTax = v;
        left -= v;
      });
      const each = Math.floor(rt / 12 / 100) * 100;
      for (let k = 0; k < 12; k++) {
        const ym = (y + 1) * 12 + 5 + k,
          v = k === 0 ? rt - each * 11 : each;
        if (ym <= lastYm) monthly[ym - entry.ym].residentTax += v;
        else if (ym <= lumpUntil) monthly[N - 1].residentTax += v;
        else afterResident += v;
      }
    }
    const years = [];
    for (let i = 0; i < monthly.length; i += 12) {
      const slice = monthly.slice(i, i + 12),
        salary = slice.reduce((x, y) => x + y.pay, 0),
        bonus = slice.reduce((sum, month) => sum + month.bonus, 0),
        allowances = slice.reduce((sum, month) => sum + month.allowances, 0),
        extra = bonus + allowances,
        yearTotal = salary + extra,
        social = slice.reduce((sum, month) => sum + month.social, 0),
        it = slice.reduce((sum, month) => sum + month.incomeTax, 0),
        rt = slice.reduce((sum, month) => sum + month.residentTax, 0);
      total += yearTotal;
      // 昇任のない年は年度末の階級・号俸、昇任した年は「昇任前 → 昇任時」の階級・号俸を出す
      const steps = [];
      for (const p of slice.flatMap((x) => x.promotions)) {
        if (steps.at(-1) !== p.from) steps.push(p.from);
        steps.push(p.to);
      }
      const last = slice.at(-1);
      years.push({
        age: c.startAge + i / 12,
        ranks: steps.length ? steps.join(" → ") : `${last.rank}${last.grade ? ` ${last.grade}号俸` : ""}`,
        salary,
        bonus,
        allowances,
        extra,
        total: yearTotal,
        social,
        incomeTax: it,
        residentTax: rt,
        deductions: social + it + rt,
        net: yearTotal - social - it - rt,
      });
    }
    return { total, years, monthly, events, afterResident, retire: retirement(table, c, monthly) };
  }
  // ---- 若年定年退職者給付金（給与法第27条の2〜第27条の6、附則第12項〜第15項、施行令第22条〜第24条、省令第1条） ----
  // 所得金額（第27条の4第4項。令和10年4月以後の版は第6項）：事業所得と給与所得の合計を給与所得とみなしたときの「給与等の収入金額」。
  // 事業所得がなければ給与収入そのもの。あれば、給与所得がその合計以上になる最小の収入（給与所得は収入について減らないので、範囲を半分ずつ狭めて見つける）
  function ypIncome(pair, year) {
    const salary = Math.max(0, pair?.salary || 0),
      biz = Math.max(0, pair?.biz || 0);
    if (!biz) return salary;
    const target = salaryIncome(salary, year) + biz;
    let lo = 0,
      hi = salary + biz + 4000000;
    while (salaryIncome(hi, year) < target) hi *= 2;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (salaryIncome(mid, year) >= target) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  // 1回目の支給月（省令第1条第1号）：基準の月が1〜3月・10〜12月なら次の4月、4〜9月なら次の10月。ym＝年×12＋(月−1)
  const firstPayYm = (fromYm) => {
    const y = Math.floor(fromYm / 12),
      m = (fromYm % 12) + 1;
    return m <= 3 ? y * 12 + 3 : m <= 9 ? y * 12 + 9 : (y + 1) * 12 + 3;
  };
  const ymText = (ym) => `${Math.floor(ym / 12)}年${(ym % 12) + 1}月`;
  function youngPension(table, c, monthly, age, civil) {
    const last = monthly.at(-1),
      P = last.basePay,
      Pc = Math.min(P, Math.max(...table.map((row) => row[YP.capCol] ?? 0))), // 俸給月額は3佐の最高号俸の額が上限
      ry = Math.floor(last.ym / 12), // 退職した年
      startYm = monthly[0].ym,
      // その年齢になる年月（誕生月は入隊月とみなす。試算の前提）
      ymAtAge = (a) => startYm + Math.round((a - c.startAge) * 12),
      ym60 = ymAtAge(YP.splitAge),
      civYm = ymAtAge(civil),
      early = Math.max(0, YP.splitAge - age),
      late = civil - Math.max(YP.splitAge, age),
      over60 = age >= YP.splitAge,
      inPeriod = (p) => last.ym >= p.from[0] * 12 + p.from[1] - 1 && (!p.to || last.ym <= p.to[0] * 12 + p.to[1] - 1),
      NS = YP.newSystem,
      isNew = inPeriod(NS),
      period = YP.periods.find(inPeriod),
      YM = { ...YP, ...(period || {}) },
      inc = c.ypIncome || {},
      pairOf = (k) => (inc[k] && (inc[k].salary != null || inc[k].biz != null) ? inc[k] : inc.after) || { salary: 0, biz: 0 },
      assumptions = [];
    // 給与年額相当額（施行令第24条）：退職の翌年まで在職したと仮定した俸給・扶養手当・営外手当・期末手当・勤勉手当
    // （55歳以上で良好な成績なら昇給しないので、退職時の俸給月額の12か月分。扶養手当は退職時の額が続くとする）
    const br = bonusRate(last.col),
      base = P + last.fuyou + last.eigai,
      kimatsu = Math.floor(base + (P + last.eigai) * br) * YP.kimatsuMonths,
      kinbenBase = Math.floor((P + last.eigai) * (1 + br)),
      G = base * 12 + kimatsu + kinbenBase * YP.kinbenMonths,
      // 60歳以後の分（定年が60歳未満）：勤勉手当の率を省令の表（退職の翌々年）にして100分の70（施行令附則第15項・省令附則第5項）
      lateKinben = (() => {
        const row = YP.lateKinbenByYear.find(([y]) => y === ry + 2) || YP.lateKinbenByYear.at(-1);
        if (!YP.lateKinbenByYear.some(([y]) => y === ry + 2) && late > 0 && !over60)
          assumptions.push(`60歳以後の分の勤勉手当の率は、省令の表に${ry + 2}年がないため、表の最後の年（${row[0]}年）の率を使っています`);
        return row[1][0] + row[1][1];
      })(),
      Gl = Math.floor((base * 12 + kimatsu + kinbenBase * lateKinben) * YP.lateSalaryRate),
      // 定年が60歳以上（附則第13項）：第24条の額に将55％・将補（1）欄60％・その他70％（施行令附則第16項）
      Go = Math.floor(G * (YP.over60SalaryRate[last.col] ?? YP.over60SalaryRate.other));
    // 所得を判定する年と、その所得金額
    const y61 = Math.floor(ym60 / 12) + 1,
      civPayYear = Math.floor(civYm / 12) + (civYm - last.ym <= 12 ? 1 : 0),
      age60PayYear = Math.floor(ym60 / 12) + (ym60 - last.ym <= 12 ? 1 : 0),
      I = {
        after: ypIncome(pairOf("after"), ry + 1),
        y59: ypIncome(pairOf("y59"), age60PayYear - 1),
        y61: ypIncome(pairOf("y61"), y61),
        civ: ypIncome(pairOf("civ"), civPayYear - 1),
      };
    const payments = [],
      pay = (label, amount, ym, taxKind, incomeKey, extra = {}) =>
        payments.push({ label: `${label}（${ymText(ym)}${extra.monthUnknown ? "ごろ・月は省令で未定" : ""}）`, amount: Math.max(0, Math.floor(amount)), ym, taxKind, income: pairOf(incomeKey), ...extra });
    // 算定基礎期間の年数ごとの率（施行令第22条。改正前の制度と令和10年3月までの退職だけ）
    const yearRate = (rates, years) => {
      const keys = Object.keys(rates).map(Number);
      return years < Math.min(...keys) ? [1, 1] : rates[Math.min(years, Math.max(...keys))];
    };
    // 2回払いの調整（令和10年3月までに退職）：2回目＝満額×（上限−所得）÷（上限−下限）、上限を超えたら1回目の一部を返納、
    // 給与年額相当額（full）以上なら1回目を全額返納（第27条の4第1項〜第3項）
    const adjust2 = (first, second, x, L, U, full) => {
      if (x <= L) return [first, second];
      const s = x >= U ? 0 : Math.floor((second * (U - x)) / (U - L)),
        back = x <= U ? 0 : x >= full ? first : Math.floor((first * (x - U)) / (full - U));
      return [first - back, s];
    };
    // 3回払いの調整（令和10年4月以後に退職。第27条の4）：支給調整額＝0.75×（合計−合計×（加算調整上限額−所得）÷（加算調整上限額−下限））
    //   ＝0.75×合計×（所得−下限）÷（加算調整上限額−下限）。2回目から引き、支給調整上限額以上で2回目は0。
    //   支給調整上限額を超え給与年額調整額未満なら（支給調整額−2回目の満額）を1回目から返納、給与年額調整額以上なら1回目を全額返納。
    //   3回目は3回目の判定年の所得で、0.25×合計×（所得−下限）÷（加算調整上限額−下限）を引き、給与年額調整額以上なら0
    const adjust3 = ([e1, e2, e3], x2, x3, L, A, Y, U) => {
      const T = e1 + e2 + e3,
        cut = (share, x) => (x > L ? Math.floor((share * T * (x - L)) / (A - L)) : 0);
      let s1 = e1,
        s2 = e2,
        s3 = e3;
      if (x2 > L) {
        const d = cut(NS.secondShare, x2);
        s2 = x2 >= U ? 0 : Math.max(0, e2 - d);
        if (x2 >= Y) s1 = 0;
        else if (x2 > U) s1 = Math.max(0, e1 - Math.max(0, d - e2));
      }
      s3 = x3 >= Y ? 0 : Math.max(0, e3 - cut(NS.thirdShare, x3));
      return [s1, s2, s3];
    };
    // 加算調整上限額に使う、退職前5年間の各年（退職日から12か月ずつ）の対象手当の合計額のうち最も高い額
    // （政令の定め方は未公布のため、12か月ずつに区切る方法は試算の仮定）
    const kasanMax = isNew
      ? Math.max(0, ...[0, 1, 2, 3, 4].map((k) => monthly.slice(Math.max(0, monthly.length - 12 * (k + 1)), monthly.length - 12 * k).reduce((s, x) => s + (x.kasan || 0), 0)))
      : 0;
    const lump = c.ypLump === "lump";
    let chart = null,
      detail;
    if (!isNew) {
      // ---- 令和10年3月までに退職（2回払い。60歳以後の分も2回払い） ----
      const name = period ? (period.to[0] === 2026 && period.to[1] === 3 ? "改正前の制度（令和8年3月までの退職）" : `経過措置（${period.from[0]}年${period.from[1]}月〜${period.to[0]}年${period.to[1]}月の退職）`) : "本則";
      detail = { name, L: null, U: null };
      if (early > 0) {
        const [r1, r2] = yearRate(EARLY_RATE, early),
          f = Math.floor(Pc * early * YM.earlyMultiplier[0] * r1),
          s = Math.floor(Pc * early * YM.earlyMultiplier[1] * r2),
          L = G - Pc * YM.lowerMultiplier,
          U = G - Pc * YM.upperMultiplier,
          [a1, a2] = adjust2(f, s, I.after, L, U, G);
        chart = { L, U, G, first: f, second: s, got: (x) => adjust2(f, s, x, L, U, G).reduce((p, q) => p + q, 0) };
        Object.assign(detail, { L, U, G, full: f + s, incomeAfter: I.after });
        if (lump) pay("1回目・2回目を一時に", a1 + a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { lump: true });
        else {
          pay("1回目", a1, firstPayYm(last.ym), "retire", "after", { full: f });
          pay("2回目", a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { full: s });
        }
        // 追給（第27条の7。前期分は附則第14項で「年齢六十年」に読み替え）：退職の翌年の所得が下限を超え、退職の翌年から
        // 60歳になる年の前年までの年数が2年以上で、その間の所得金額の平均が退職の翌年の所得より低く、給与年額相当額未満なら、
        // 平均を退職の翌年の所得とみなして計算し直した額との差を追給する（一時に受けた場合も同じ。第3項）
        if (c.ypAvg != null) {
          const span = age60PayYear - 1 - ry,
            avg = c.ypAvg;
          if (span >= 2 && I.after > L && avg < I.after && avg < G) {
            const extra = adjust2(f, s, avg, L, U, G).reduce((p, q) => p + q, 0) - (a1 + a2);
            if (extra > 0) {
              pay("追給（平均の所得で計算し直した差額）", extra, age60PayYear * 12 + YP.secondMonth - 1, "ichiji", "y59", { tsuikyu: true });
              assumptions.push("追給の支給時期は申し出の後で省令でも定めがないため、60歳になる年の8月として表示しています。税は一時所得として計算しています（扱いは未確認）");
            }
          }
          Object.assign(detail, { avgIncome: avg, avgYears: span });
        }
      }
      if (late > 0) {
        const [r1, r2] = yearRate(LATE_RATE, late),
          f = Math.floor(Pc * late * YM.lateMultiplier[0] * r1),
          s = Math.floor(Pc * late * YM.lateMultiplier[1] * r2);
        if (over60) {
          // 定年が60歳以上（附則第13項）：退職の翌年の所得で調整。給与年額相当額は55〜70％
          const L = Go - Pc * YM.lateLower,
            U = Go - Pc * YM.lateUpper,
            [a1, a2] = adjust2(f, s, I.after, L, U, Go);
          chart = { L, U, G: Go, first: f, second: s, got: (x) => adjust2(f, s, x, L, U, Go).reduce((p, q) => p + q, 0) };
          Object.assign(detail, { L, U, G: Go, full: f + s, incomeAfter: I.after });
          if (lump) pay("1回目・2回目を一時に", a1 + a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { lump: true });
          else {
            pay("1回目", a1, firstPayYm(last.ym), "retire", "after", { full: f });
            pay("2回目", a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { full: s });
          }
        } else {
          // 60歳以後の分（附則第12項・第15項）：61歳の年の所得で調整。給与年額相当額は勤勉手当の率を変えて100分の70
          const L = Gl - Pc * YM.lateLower,
            U = Gl - Pc * YM.lateUpper,
            [a1, a2] = adjust2(f, s, I.y61, L, U, Gl);
          Object.assign(detail, { lateL: L, lateU: U, lateG: Gl, income61: I.y61 });
          assumptions.push("60歳以後の分の支給月は、1回目の支給月と同じ決まり（60歳になった月の後の4月か10月）として表示しています");
          if (lump) pay("3回目・4回目を一時に・60歳以後の分", a1 + a2, (Math.floor(ym60 / 12) + 2) * 12 + YP.secondMonth - 1, "ichiji", "y61", { lump: true });
          else {
            pay("3回目・60歳以後の分", a1, firstPayYm(ym60), "ichiji", "y61", { full: f });
            pay("4回目・60歳以後の分", a2, (Math.floor(ym60 / 12) + 2) * 12 + YP.secondMonth - 1, "ichiji", "y61", { full: s });
          }
        }
      }
    } else {
      // ---- 令和10年4月以後に退職（新制度。3回払い。60歳以後の分も3回払い） ----
      const assume = c.ypAssume === "base" ? "base" : "upper";
      assumptions.push(
        `給与年額調整額（「加算調整上限額までの範囲内で政令で定める額」）の政令は未公布のため、${assume === "base" ? "給与年額相当額と同じ（加算なし）" : "加算調整上限額と同じ（法律の上限）"}と仮定しています`,
        "加算調整上限額の手当は、退職日から12か月ずつ区切った5年間のうち合計が最も高い1年分としています（政令の定め方は未公布）",
        "3回目の支給月は省令で未定のため、8月として表示しています",
      );
      detail = { name: "令和10年4月以後の退職（3回払いの新制度）", kasanMax, assume };
      const Y = (g, a) => (assume === "base" ? g : a);
      if (early > 0) {
        const E = NS.early.map((k) => Math.floor(Pc * early * k)),
          L = G - Pc * NS.lowerMultiplier,
          A = G + kasanMax,
          Yv = Y(G, A),
          U = Yv - Pc * NS.upperMultiplier,
          [a1, a2, a3] = adjust3(E, I.after, I.y59, L, A, Yv, U);
        chart = { L, U, G: Yv, first: E[0], second: E[1], got: (x) => adjust3(E, x, -Infinity, L, A, Yv, U).slice(0, 2).reduce((p, q) => p + q, 0) };
        Object.assign(detail, { L, U, G, A, Y: Yv, full: E[0] + E[1] + E[2], incomeAfter: I.after, income59: I.y59 });
        if (lump) pay("1回目・2回目を一時に", a1 + a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { lump: true });
        else {
          pay("1回目", a1, firstPayYm(last.ym), "retire", "after", { full: E[0] });
          pay("2回目", a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { full: E[1] });
        }
        pay("3回目", a3, age60PayYear * 12 + YP.secondMonth - 1, "ichiji", "y59", { full: E[2], monthUnknown: true });
      }
      if (late > 0) {
        const E = NS.late.map((k) => Math.floor(Pc * late * k));
        if (over60) {
          // 定年が60歳以上（附則第13項）：退職の翌年の所得で2回目、自衛官以外の職員の定年の前年の所得で3回目を調整
          const rate = YP.over60SalaryRate[last.col] ?? YP.over60SalaryRate.other,
            L = Go - Pc * NS.lateLower,
            A = Go + Math.floor(kasanMax * rate),
            Yv = Y(Go, A),
            U = Yv - Pc * NS.lateUpper,
            [a1, a2, a3] = adjust3(E, I.after, I.civ, L, A, Yv, U);
          assumptions.push("定年が60歳以上の人の給与年額相当額の割合（55〜70％）と加算の扱いは、令和10年4月以後の政令が未公布のため、今の施行令附則第16項の割合を使っています");
          chart = { L, U, G: Yv, first: E[0], second: E[1], got: (x) => adjust3(E, x, -Infinity, L, A, Yv, U).slice(0, 2).reduce((p, q) => p + q, 0) };
          Object.assign(detail, { L, U, G: Go, A, Y: Yv, full: E[0] + E[1] + E[2], incomeAfter: I.after, incomeCiv: I.civ });
          if (lump) pay("1回目・2回目を一時に", a1 + a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { lump: true });
          else {
            pay("1回目", a1, firstPayYm(last.ym), "retire", "after", { full: E[0] });
            pay("2回目", a2, (ry + 2) * 12 + YP.secondMonth - 1, "ichiji", "after", { full: E[1] });
          }
          pay("3回目", a3, civPayYear * 12 + YP.secondMonth - 1, "ichiji", "civ", { full: E[2], monthUnknown: true });
        } else {
          // 60歳以後の分（附則第12項・第15項）：61歳の年の所得で5回目、自衛官以外の職員の定年の前年の所得で6回目を調整
          const L = Gl - Pc * NS.lateLower,
            A = Gl + Math.floor(kasanMax * YP.lateSalaryRate),
            Yv = Y(Gl, A),
            U = Yv - Pc * NS.lateUpper,
            [a1, a2, a3] = adjust3(E, I.y61, I.civ, L, A, Yv, U);
          assumptions.push("60歳以後の分の給与年額相当額（100分の70）と加算の扱いは、令和10年4月以後の政令が未公布のため、今の施行令附則第15項と同じとしています");
          Object.assign(detail, { lateL: L, lateU: U, lateG: Gl, lateA: A, income61: I.y61, incomeCiv: I.civ });
          pay("4回目・60歳以後の分", a1, firstPayYm(ym60), "ichiji", "y61", { full: E[0] });
          pay("5回目・60歳以後の分", a2, (Math.floor(ym60 / 12) + 2) * 12 + YP.secondMonth - 1, "ichiji", "y61", { full: E[1] });
          pay("6回目・60歳以後の分", a3, civPayYear * 12 + YP.secondMonth - 1, "ichiji", "civ", { full: E[2], monthUnknown: true });
        }
      }
    }
    return { payments, chart, detail: { ...detail, assumptions, early, late, Pc } };
  }
  // 退職手当と若年定年退職者給付金、それぞれの退職所得の税
  function retirement(table, c, monthly) {
    // 任期制自衛官の任期満了の退職手当（防衛省給与法第28条第1項・第5項）：任期ごとに、満了時の俸給日額（月額÷30）×日数。
    // 退職所得として任期ごとに課税する（勤続年数はその任期の年数）
    // 在職期間を超える任期は数えない（任期の途中で定年になる場合。run() では入力の案内を出す）
    const terms = (c.ninki?.terms || [])
      .filter((t) => t.end <= monthly.length)
      .map((t, i) => {
        const pay = monthly[t.end - 1].basePay,
          amount = Math.floor((pay * t.days) / 30),
          years = t.months / 12,
          tx = retirementTaxes(amount, years, retirementDeduction(years));
        return { label: `任期満了金 ${i + 1}任期目（${years}年・${t.days}日分）`, amount, tax: tx.it + tx.rt, pay, days: t.days };
      });
    const termTotal = terms.reduce((s, t) => s + t.amount, 0),
      termTax = terms.reduce((s, t) => s + t.tax, 0);
    if (c.ninki?.exit)
      return {
        years: Math.floor(monthly.length / 12),
        basic: 0,
        adjust: 0,
        allowance: termTotal,
        terms,
        payments: [],
        pension: 0,
        civil: null,
        tax: termTax,
        net: termTotal - termTax,
        reemploy: null,
        ninkiExit: true,
      };
    // 任期満了金を受けた任期は、その後の退職手当の勤続期間から除く（国家公務員退職手当法第7条第5項）
    const paidMonths = terms.length ? c.ninki.terms[terms.length - 1].end : 0,
      // 高等工科学校の卒業生は、生徒の期間の2分の1を勤続期間に通算する（自衛官として6か月以上在職した場合。防衛省給与法第28条の2第4項）
      months = monthly.length - paidMonths + (c.studentCreditMonths && monthly.length >= 6 ? c.studentCreditMonths : 0),
      last = monthly.at(-1),
      P = last.basePay,
      n = Math.floor(months / 12) || (months >= 6 ? 1 : 0),
      // 若年定年退職者給付金の「自衛官として20年以上」は任期制の期間も含めて数える
      nAll = Math.floor(monthly.length / 12),
      // 自己都合で勤続42年を超える場合は、定年退職（法第5条）・勤続35年として附則第6項の例により計算する
      // （平成15年改正法（国家公務員退職手当法の一部を改正する法律）附則第4項）。調整額も定年退職と同じに扱う
      // 退職所得控除の勤続年数は、1年未満の端数を1年に切り上げる（所得税法施行令第69条第2項。国税庁 No.1420）。
      // 退職手当の勤続期間（端数切捨て）とは別に数える。任期満了金を受けた任期は除く
      nt = Math.max(1, Math.ceil((monthly.length - paidMonths) / 12)),
      selfLong = c.retireReason === "self" && n > RT.selfAdjustMaxYears,
      teinen = c.retireReason !== "self" || selfLong;
    // 基本額（法第3条〜第5条、附則第6項〜第8項）。35年を超える定年退職は35年として計算し、83.7％を掛ける
    let rate;
    if (!teinen) rate = bandMonths(ART3, n) * (pick(RT.selfReduction, n)?.[1] ?? 1);
    else rate = bandMonths(n >= RT.art5From ? ART5 : n >= RT.art4From ? ART4 : ART3, n >= RT.art5From ? Math.min(n, RT.teinenMaxYears) : n);
    const basic = Math.floor(Math.min(P * rate * (teinen || n <= RT.selfAdjustMaxYears ? RT.adjustFactor : 1), P * RT.capMonths));
    // 調整額（法第6条の4）：調整月額の多い順に60か月分。勤続4年以下（自己都合は24年以下）は半額、自己都合で9年以下は0
    const top = monthly
      .slice(paidMonths)
      .map((x) => adjustMonthly(x.col, x.grade))
      .sort((a, b) => b - a)
      .slice(0, RT.adjustTopMonths)
      .reduce((a, b) => a + b, 0);
    const adjust =
      n === 0 || (!teinen && n <= RT.adjustZeroSelfYears)
        ? 0
        : (teinen ? n <= RT.adjustHalfYears.teinen : n <= RT.adjustHalfYears.self)
          ? Math.floor(top / 2)
          : top;
    const allowance = basic + adjust;
    // 若年定年退職者給付金：自衛官として20年以上勤務し、自衛官以外の職員の定年より若い定年で退職した場合
    const retireYm = last.ym + 1,
      civil = civilRetireAge(Math.floor(retireYm / 12) - (retireYm % 12 < 3 ? 1 : 0)),
      age = c.retireAge,
      payments = [];
    let reemploy = null;
    // 算定基礎期間の年数ごとの率：表の最小の年数より短ければ1、最大より長ければ最大の年数の率
    const yearRate = (rates, years) => {
      const keys = Object.keys(rates).map(Number);
      return years < Math.min(...keys) ? [1, 1] : rates[Math.min(years, Math.max(...keys))];
    };
    // 若年定年退職者給付金は実際の定年退職だけ（自己都合で42年超を定年退職として計算する場合は対象外）
    // 自衛官としての在職期間は、令和8年4月以後の退職なら以前の自衛官の期間も通算する（給与法第27条の2第2項。改正前は引き続き20年）。
    // 退職の日またはその翌日に常勤の国家・地方公務員になったときは支給しない（同条第1項ただし書）
    const lawFrom = YP.periods[1].from,
      tsusan = last.ym >= lawFrom[0] * 12 + lawFrom[1] - 1 ? Math.round((c.prevServiceYears || 0) * 12) : 0,
      ypYears = Math.floor((monthly.length + tsusan) / 12),
      ypReason = c.retireReason === "self" ? "self" : ypYears < YP.minYears ? "years" : age >= civil ? "age" : c.publicReemploy ? "public" : null;
    const yp = ypReason ? null : youngPension(table, c, monthly, age, civil);
    if (yp) {
      payments.push(...yp.payments);
      reemploy = yp.chart;
    }
    // 税：
    //   ・退職手当と、給付金の1回目（退職を理由として退職直後に支払う分）は退職所得。1回目が退職手当と同じ年に支払われるときは、
    //     合わせて1つの退職所得控除を使う。別の年（12月退職→翌年4月など）なら、前年以前4年内に受けた退職手当等と勤続期間が
    //     重なる分の控除を引く（所得税法第30条第6項、施行令第70条第1項第2号イ・第2項。控除は80万円が下限）
    //   ・2回目以降（と一時に受ける分）は一時所得（退職から2年ほど後に、所得に応じて額が決まって支払われるため。
    //     東京国税局「所得税消費税誤りやすい事例集」による。国税庁の一次資料の明文は未確認）。50万円の特別控除の後の2分の1を、
    //     その年の他の所得（入力した再就職の給与・事業所得）に加えたときに増える所得税・住民税を計算する
    const rawDeduction = (y) => (y <= rd.border ? rd.perYear * y : rd.base + rd.perYearAfter * (y - rd.border)),
      retireYear = Math.floor(last.ym / 12),
      firsts = payments.filter((p) => p.taxKind === "retire"),
      sameYear = firsts.filter((p) => Math.floor(p.ym / 12) === retireYear),
      laterYear = firsts.filter((p) => Math.floor(p.ym / 12) !== retireYear),
      firstAmount = allowance + sameYear.reduce((s, p) => s + p.amount, 0);
    let received = firstAmount;
    const taxes = [retirementTaxes(firstAmount, nt, retirementDeduction(nt))].concat(
      laterYear.map((p) => {
        const prevYears = received < rawDeduction(nt) ? Math.floor(received <= rd.base ? received / rd.perYear : (received - rd.base) / rd.perYearAfter + rd.border) : nt,
          deduction = Math.max(rd.min, rawDeduction(nt) - rawDeduction(Math.min(nt, prevYears)));
        received += p.amount;
        return retirementTaxes(p.amount, nt, deduction);
      }),
    );
    // 一時所得：同じ年の分はまとめて1回の特別控除
    const ichijiByYear = new Map();
    for (const p of payments.filter((p) => p.taxKind === "ichiji" && p.amount > 0)) {
      const y = Math.floor(p.ym / 12),
        e = ichijiByYear.get(y) || { amount: 0, income: p.income };
      e.amount += p.amount;
      ichijiByYear.set(y, e);
    }
    const family = c.family || { spouse: false, general: 0, specific: 0 };
    for (const [y, e] of ichijiByYear) {
      const half = Math.floor(Math.max(0, e.amount - TX.ichijiSpecial) / 2),
        before = salaryTaxes(e.income.salary, 0, y, family, false, e.income.biz),
        after = salaryTaxes(e.income.salary, 0, y, family, false, e.income.biz + half),
        it = after.it - before.it,
        rt = after.rt - before.rt;
      taxes.push({ it, rt });
      for (const p of payments.filter((p) => p.taxKind === "ichiji" && Math.floor(p.ym / 12) === y)) p.taxYear = y;
    }
    const tax = taxes.reduce((s, t) => s + t.it + t.rt, 0),
      pension = payments.reduce((s, p) => s + p.amount, 0);
    // 任期制から3曹へ昇任した場合は、昇任前に受けた任期満了金も合わせて出す
    return {
      years: n,
      basic,
      adjust,
      selfLong,
      allowance: allowance + termTotal,
      terms,
      payments,
      pension,
      civil,
      tax: tax + termTax,
      net: allowance + termTotal + pension - tax - termTax,
      reemploy,
      yp: yp?.detail || null,
      ypReason,
      ypYears,
    };
  }
  window.salarySimulatorModel = model;
  // テスト用（test/law-cases.js が条文から作った期待値と比べる）。画面の動作には使わない
  window.salarySimulatorTax = { salaryIncome, salaryTaxes, ypIncome, incomeAdjustment, firstPayYm };
  // ---- 俸給を調べる：毎月の手取りの目安 ----
  // 俸給だけを受ける場合（手当なし・配偶者と扶養親族なし・40歳未満で介護の掛金なし）の、ある月の手取り。
  // 共済掛金はシミュレーターと同じ率（標準報酬は俸給の額で決める）。所得税・住民税は、同じ俸給が1年続き、
  // 賞与（期末手当・勤勉手当の標準の割合と階級による加算）も受けるとして年額を出し、所得税は俸給と賞与の額の割合で、
  // 住民税は12分の1で、1か月分にする
  function lookupNet(col, pay) {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })),
      y = now.getFullYear(),
      ym = y * 12 + now.getMonth(),
      general = col === 0,
      shortRate =
        (general ? KY.general.short : KY.short) + (general ? KY.general.welfare : KY.welfare) + (ym >= KY.childFrom[0] * 12 + KY.childFrom[1] - 1 ? KY.child : 0),
      longRate = KY.pension + KY.retire;
    let g = 0;
    while (g + 1 < KY.stdTable.length && pay >= KY.stdTable[g + 1][0]) g++;
    const stdShort = KY.stdTable[g][1],
      stdPension = Math.min(Math.max(stdShort, KY.pensionStdMin), pensionCap(ym)),
      monthSocial = Math.floor(stdShort * shortRate) + Math.floor(stdPension * longRate),
      // 賞与：1回分＝（俸給＋階級による加算）×（期末手当＋勤勉手当の標準の割合）。年2回
      B = R.bonus,
      kind = col <= B.shiteiCols ? "shitei" : "normal",
      add = (B.rankAdd.find(([max]) => col <= max) || [0, 0])[1],
      once = Math.floor(pay * (1 + add) * (B.kimatsuPer[kind] + B.kinbenStandard[kind])),
      b = Math.floor(once / 1000) * 1000,
      // 短期は年度の上限まで、厚生年金は1回の上限まで（シミュレーターと同じ）
      bonusSocial = Math.floor(Math.min(b * 2, KY.bonusShortYearCap) * shortRate) + 2 * Math.floor(Math.min(b, KY.bonusPensionCap) * longRate),
      income = pay * 12 + once * 2,
      { it, rt } = salaryTaxes(income, monthSocial * 12 + bonusSocial, y, { spouse: false, general: 0, specific: 0 }),
      incomeTax = Math.round((it * pay) / income),
      residentTax = Math.round(rt / 12);
    return { social: monthSocial, incomeTax, residentTax, net: pay - monthSocial - incomeTax - residentTax };
  }
  {
    const rankSel = $("rank"),
      gradeSel = $("grade"),
      out = $("amountNet");
    const showNet = () => {
      const col = Number(rankSel.value),
        pay = window.PAY_TABLE?.[Number(gradeSel.value)]?.[col];
      if (pay == null) {
        out.hidden = true;
        return;
      }
      const n = lookupNet(col, pay);
      out.hidden = false;
      out.querySelector("b").textContent = fmt(n.net);
      out.querySelector("small").textContent =
        `共済掛金 ${fmt(n.social)}・所得税 ${fmt(n.incomeTax)}・住民税 ${fmt(n.residentTax)} を引いた額。手当なし・配偶者と扶養親族なし・40歳未満として計算した目安です`;
    };
    rankSel.addEventListener("change", showNet);
    gradeSel.addEventListener("change", showNet);
    showNet();
  }
  // 俸給表はこのページに埋め込んだ PAY_TABLE を使う
  const table = window.PAY_TABLE;
  if (!table) $("simError").textContent = "俸給データの読み込みに失敗しました。";
  // ---- 昇任までの期間の選択肢 ----
  // 最小値は自衛隊法施行規則 別表第七の在職期間（勤務成績が極めて良好な場合の8割短縮は使わない）。
  // 昇任は年1回（3曹は年2回、部内幹部候補生の試験は年1回）なので、その間隔で選ぶ。単位はか月（士）または年
  const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  // 2士→1士・1士→士長は6か月ずつで固定（入力欄は読み取り専用。入隊から約1年で士長）
  // 選択肢・固定値・定年年齢は RULES.promotion から作る（HTMLの初期値はここで上書きする）
  const choices = Object.fromEntries(Object.entries(R.promotion.choices).map(([id, [from, to, step, def]]) => [id, { months: range(from, to, step), def }]));
  for (const [id, v] of Object.entries({ ...R.promotion.fixedMonths, ...R.promotion.fixedYears, ...R.promotion.education })) if ($(id)) $(id).value = String(v);
  // 賞与の初期値（年間の月数）＝期末手当＋勤勉手当
  $("bonus").value = String(B.annualMonths);
  for (const o of $("targetRank").options) {
    const age = R.promotion.retireAge[o.value];
    if (age == null) continue;
    o.dataset.age = String(age);
    o.textContent = `${o.value}（${age}歳）`;
  }
  const monthLabel = (n) => `${Math.floor(n / 12)}年${n % 12 ? `${n % 12}か月` : ""}`;
  for (const [id, cfg] of Object.entries(choices)) {
    const input = $(id),
      select = document.createElement("select");
    select.id = id;
    for (const n of cfg.months) {
      const o = document.createElement("option");
      // 値は年数（計算側の単位に合わせる）
      o.value = String(n / 12);
      o.textContent = monthLabel(n);
      if (n === cfg.def) o.selected = true;
      select.append(o);
    }
    // 入力欄（単位付きの枠ごと）を選択欄に置き換える
    input.closest(".c-unit-input").replaceWith(select);
  }
  // 予想階級までにたどる昇任（3曹より後）。3尉以上なら部内幹部の経路になる
  // 3尉への昇任のしかた（ofcRoute）：3曹から（部内幹部候補生）、曹長から、准尉から。曹長・准尉からは曹の階級を順に経る
  // 幹部候補生（一般幹部候補生）は曹を経ないので route は "sgt"（3尉から先だけ）で呼ぶ
  function pathTo(target, route = $("ofcRoute")?.value || "sgt") {
    const e = enlistedPath.findIndex((p) => p.name === target),
      o = officerPath.findIndex((p) => p.name === target);
    if (e >= 0) return enlistedPath.slice(0, e + 1);
    if (o < 0) return [];
    const officers = officerPath.slice(0, o + 1);
    if (route === "sgm") return [...enlistedPath.slice(0, 3), { ...officers[0], step: "stepOfcSgm", key: "3尉sgm" }, ...officers.slice(1)];
    if (route === "wo") return [...enlistedPath.slice(0, 4), { ...officers[0], step: "stepOfcWo", key: "3尉wo" }, ...officers.slice(1)];
    return officers;
  }
  // 定年の特例（自衛隊法施行令 別表第九 備考）：統合幕僚長・陸海空幕僚長・統合作戦司令官（将）は62歳、
  // 医療職・軍楽・情報の業務・警務官のうち1佐以下は60歳。対象でない階級は階級の定年のまま
  function specialRetireAge(rank, age) {
    const sp = $("retireSpecial")?.value,
      S = R.promotion.retireSpecial;
    if (sp === "chief" && rank === "将") return S.chief;
    if (sp === "expert" && !["将", "将補"].includes(rank)) return Math.max(age, S.expert);
    return age;
  }
  function updateRetirement() {
    const type = $("entryType").value,
      kanko = type.startsWith("kanko"),
      ninkiExit = type === "ninki" && $("ninkiPlan").value !== "sgt";
    // 幹部候補生は3尉以上（院卒は2尉以上）しか選べないようにする
    for (const o of $("targetRank").options) o.disabled = kanko && (!o.dataset.officer || (type === "kankoD" && o.value === "3尉"));
    if ($("targetRank").selectedOptions[0].disabled) $("targetRank").value = type === "kankoD" ? "2尉" : "3尉";
    // 幹部候補生は3尉（院卒は2尉）に任官するので、そこまでの昇任の欄は出さない
    const skip = kanko ? (type === "kankoD" ? ["3尉", "2尉"] : ["3尉"]) : [];
    const path = ninkiExit ? [] : pathTo($("targetRank").value, kanko ? "sgt" : undefined),
      names = path.map((p) => p.key || p.name).filter((n) => !skip.includes(n));
    // 3尉以上（部内幹部）を目指すときだけ、3尉への昇任のしかたを選べる
    if (!kanko && path.some((p) => p.name === "3尉")) names.push("3尉route");
    for (const el of document.querySelectorAll("[data-step]")) el.hidden = !names.includes(el.dataset.step);
    // 高等工科学校の卒業生は陸士長で任官するので、2士・1士・3曹昇任前の欄も出さない
    for (const el of document.querySelectorAll("[data-enlisted]")) el.hidden = kanko || type === "koka";
    // 任期制で満了退職する場合は3曹へ昇任しないので、3曹昇任の欄と3曹昇任前の教育の欄も出さない
    if (ninkiExit) for (const id of ["stepSgt", "eduSgt"]) $(id).closest("[data-enlisted]").hidden = true;
    $("ninkiPlanWrap").hidden = type !== "ninki";
    // 自己都合退職のときだけ、退職する年齢の欄を出す（任期満了で退職する場合は出さない）
    $("selfRetireAgeWrap").hidden = $("retireReason").value !== "self" || ninkiExit;
    // 国民健康保険を料率から計算するときだけ、料率の欄を出し、年額の欄を隠す
    const kokuhoCalc = $("afterHealth").value === "kokuhoCalc";
    for (const el of document.querySelectorAll("[data-kokuho]")) el.hidden = !kokuhoCalc;
    $("afterHealthYen").closest(".c-unit-input").parentElement.hidden = kokuhoCalc || $("afterHealth").value === "none";
    // 保険料を払う年数は、自分で保険料を払うとき（任意継続・国民健康保険）だけ出す
    $("afterHealthYears").closest(".c-unit-input").parentElement.hidden = $("afterHealth").value === "none";
    $("targetRankWrap").hidden = ninkiExit;
    // 退職の年齢：定年（予想階級）か、任期満了（任期の合計）
    if (ninkiExit) {
      const E = window.RULES.entry,
        k = Number($("ninkiPlan").value),
        months = E.ninkiFirstMonths[$("branch").value] + E.ninkiNextMonths * (k - 1);
      $("retireAge").value = String(Number($("startAge").value) + months / 12);
      $("retireAgeLabel").textContent = "退職の年齢（任期満了）";
    } else {
      $("retireAge").value = String(specialRetireAge($("targetRank").value, Number($("targetRank").selectedOptions[0].dataset.age)));
      $("retireAgeLabel").textContent = "定年年齢（予想階級に連動）";
    }
  }
  // 入隊区分を変えたら、入隊時の年齢をその区分の目安にする
  $("entryType").addEventListener("change", () => {
    // 入隊区分を変えたら、ひな形で固定した2尉→1尉の欄を外す（ひな形から入隊区分を入れるときは、このあとでまた固定する）
    $("first").disabled = false;
    $("firstLock").hidden = true;
    $("startAge").value = String(window.RULES.entry.defaultAge[$("entryType").value] ?? 18);
    updateRetirement();
  });
  for (const id of ["targetRank", "ninkiPlan", "branch", "startAge", "ofcRoute", "retireReason", "retireSpecial", "afterHealth"]) $(id).addEventListener("change", updateRetirement);
  $("startAge").addEventListener("input", updateRetirement);
  updateRetirement();
  $("simJump").addEventListener("click", (e) => {
    e.preventDefault();
    showResult();
  });
  function showResult() {
    $("simResult").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // 年収の推移を積み上げ棒グラフ（SVG）で描く
  // グラフの目盛り：最大値を4等分したきりのよい刻み
  function niceStep(maxValue) {
    const raw = Math.max(1, maxValue) / 4,
      mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 3, 4, 5, 10].find((s) => s * mag >= raw) * mag;
  }
  const man = (v) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
  // グラフの上に重ねる吹き出し。カーソル・指の位置に合わせて動かす
  function chartTip(box, html, x, y) {
    let tip = box.querySelector(".c-chart__tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "c-chart__tip";
      box.append(tip);
    }
    if (html == null) return tip.classList.remove("is-show");
    tip.innerHTML = html;
    const bw = box.clientWidth,
      tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(x - tw / 2, 4), bw - tw - 4)}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 12)}px`;
    tip.classList.add("is-show");
  }
  function drawChart(years) {
    // 表示幅に合わせて描く（スマホで文字が小さくなりすぎないように）
    const box = $("simChart"),
      W = Math.max(300, box.clientWidth - 16 || 640),
      H = W < 480 ? 220 : 270,
      left = 46,
      right = 8,
      top = 22,
      bottom = 26,
      plotW = W - left - right,
      plotH = H - top - bottom,
      step = niceStep(Math.max(...years.map((y) => y.total))),
      max = step * 4,
      bw = plotW / years.length,
      y = (v) => top + plotH - (v / max) * plotH,
      cx = (i) => left + (i + 0.5) * bw,
      barW = Math.max(1.5, bw * 0.68),
      r = Math.min(4, barW / 2);
    // 色：俸給は深緑、賞与・手当は金のグラデーション。手取りは白い縁取りの線
    let svg =
      `<defs><linearGradient id="gSal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#637437"/><stop offset="1" stop-color="#343c1c"/></linearGradient>` +
      `<linearGradient id="gExt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfd8b9"/><stop offset="1" stop-color="#aaa175"/></linearGradient>` +
      `<linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#829748" stop-opacity=".22"/><stop offset="1" stop-color="#829748" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 0; i <= 4; i++) {
      const v = step * i;
      svg += `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="${i ? "#e9ebe6" : "#d6d9cf"}" ${i ? 'stroke-dasharray="3 4"' : ""}/>`;
      svg += `<text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#84877a">${man(v)}</text>`;
    }
    const every = W < 480 ? 10 : 5;
    years.forEach((d, i) => {
      const x = cx(i) - barW / 2,
        yT = y(d.total),
        yS = y(d.salary);
      // 上の角だけ丸めた積み上げ棒
      svg +=
        `<g class="c-chart__bar" data-i="${i}"><clipPath id="cb${i}"><rect x="${x}" y="${yT}" width="${barW}" height="${y(0) - yT + r}" rx="${r}"/></clipPath>` +
        `<g clip-path="url(#cb${i})"><rect x="${x}" y="${yS}" width="${barW}" height="${y(0) - yS}" fill="url(#gSal)"/>` +
        `<rect x="${x}" y="${yT}" width="${barW}" height="${yS - yT}" fill="url(#gExt)"/></g></g>`;
      // 年齢の目盛り（最初の年は、次の目盛りと重ならないときだけ出す）
      if (d.age % every === 0 || (i === 0 && every - (d.age % every) >= every / 2))
        svg += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#84877a">${d.age}歳</text>`;
    });
    // 手取りの線と、その下のうっすらした面
    const pts = years.map((d, i) => `${cx(i).toFixed(1)},${y(d.net).toFixed(1)}`);
    svg +=
      `<path d="M${pts[0]} L${pts.join(" L")} L${cx(years.length - 1)},${y(0)} L${cx(0)},${y(0)} Z" fill="url(#gNet)" pointer-events="none"/>` +
      `<polyline points="${pts.join(" ")}" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>` +
      `<polyline points="${pts.join(" ")}" fill="none" stroke="#72853f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
    // いちばん年収が高い年に目印
    const peakI = years.reduce((a, d, i) => (d.total > years[a].total ? i : a), 0),
      peak = years[peakI];
    svg +=
      `<g pointer-events="none"><circle cx="${cx(peakI)}" cy="${y(peak.total) - 7}" r="3" fill="#aaa175"/>` +
      `<text x="${Math.min(Math.max(cx(peakI), left + 34), W - right - 34)}" y="${y(peak.total) - 13}" text-anchor="middle" font-size="11" font-weight="700" fill="#777048">最高 ${man(peak.total)}円</text></g>` +
      `<line class="c-chart__hover-line" x1="0" x2="0" y1="${top}" y2="${y(0)}" stroke="#424d24" stroke-opacity=".25" stroke-dasharray="3 3" visibility="hidden"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="年収の推移。${years[0].age}歳の${man(years[0].total)}円から、最高は${peak.age}歳の${man(peak.total)}円">${svg}</svg>`;
    // カーソル・指を乗せた年の内訳を吹き出しで出す
    const el = box.querySelector("svg"),
      line = el.querySelector(".c-chart__hover-line"),
      bars = el.querySelectorAll(".c-chart__bar");
    const show = (e) => {
      const rect = el.getBoundingClientRect(),
        px = ((e.clientX - rect.left) / rect.width) * W,
        i = Math.min(years.length - 1, Math.max(0, Math.floor((px - left) / bw)));
      if (px < left) return hide();
      const d = years[i];
      bars.forEach((b, j) => b.classList.toggle("is-dim", j !== i));
      line.setAttribute("x1", cx(i));
      line.setAttribute("x2", cx(i));
      line.setAttribute("visibility", "visible");
      chartTip(
        box,
        `<b>${d.age}〜${d.age + 1}歳</b><span>${d.ranks}</span>` +
          `<span><i class="c-legend__swatch--extra"></i>推定年収 <em>${fmt(d.total)}</em></span>` +
          `<span><i class="c-legend__swatch--salary"></i>俸給 ${fmt(d.salary)}／賞与・手当 ${fmt(d.extra)}</span>` +
          `<span><i class="c-legend__swatch--net"></i>手取り <em>${fmt(d.net)}</em></span>`,
        (cx(i) / W) * rect.width + (el.getBoundingClientRect().left - box.getBoundingClientRect().left),
        (y(d.total) / H) * rect.height + (rect.top - box.getBoundingClientRect().top),
      );
    };
    const hide = () => {
      bars.forEach((b) => b.classList.remove("is-dim"));
      line.setAttribute("visibility", "hidden");
      chartTip(box, null);
    };
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", hide);
  }
  // 再就職の年収と、若年定年退職者給付金（60歳までの分）の受け取り額のグラフ
  function drawReemployChart(r, income) {
    const box = $("reemployChart"),
      a = r.reemploy;
    $("reemploySection").hidden = !a;
    if (!a) return;
    const { L, U, G, first, second } = a,
      full = first + second,
      // 年収 x のときに受け取る1回目と2回目の合計（2回目の減額と、1回目の返納を差し引いた額。計算本体と同じ式）
      got = a.got;
    $("reemploySummary").innerHTML =
      `再就職の年収が <b>${man(Math.max(0, L))}円以下</b>なら満額（${fmt(full)}）。` +
      `それを超えると減り、<b>${man(U)}円で2回目が0</b>、<b>${man(G)}円以上で1回目も全額返納</b>になります。` +
      `いまの入力（年収${man(income)}円）では <b>${fmt(Math.round(got(income)))}</b> です。`;
    const W = Math.max(300, box.clientWidth - 16 || 640),
      H = W < 480 ? 220 : 250,
      left = 50,
      right = 12,
      top = 18,
      bottom = 30,
      plotW = W - left - right,
      plotH = H - top - bottom,
      xMax = niceStep(G * 1.08) * 4,
      yStep = niceStep(full),
      yMax = yStep * 4,
      X = (v) => left + (v / xMax) * plotW,
      Y = (v) => top + plotH - (v / yMax) * plotH,
      // 区切り（下限・上限・全額返納）と、その間を細かく刻んだ点で線を描く（令和10年4月以後の式は折れ点が増えるため）
      xs = [...new Set([0, Math.max(0, L), U, G, xMax, ...Array.from({ length: 121 }, (_, i) => (xMax * i) / 120)])].filter((v) => v >= 0 && v <= xMax).sort((p, q) => p - q);
    let svg = `<defs><linearGradient id="gRe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aaa175" stop-opacity=".55"/><stop offset="1" stop-color="#aaa175" stop-opacity=".05"/></linearGradient></defs>`;
    for (let i = 0; i <= 4; i++) {
      svg += `<line x1="${left}" x2="${W - right}" y1="${Y(yStep * i)}" y2="${Y(yStep * i)}" stroke="${i ? "#e9ebe6" : "#d6d9cf"}" ${i ? 'stroke-dasharray="3 4"' : ""}/>`;
      svg += `<text x="${left - 6}" y="${Y(yStep * i) + 4}" text-anchor="end" font-size="11" fill="#84877a">${man(yStep * i)}</text>`;
      const xv = (xMax / 4) * i;
      svg += `<text x="${X(xv)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="11" fill="#84877a">${man(xv)}円</text>`;
    }
    // 満額の範囲（年収が下限額以下）を薄い緑で塗る
    if (L > 0) svg += `<rect x="${X(0)}" y="${top}" width="${X(L) - X(0)}" height="${plotH}" fill="#72853f" fill-opacity=".07"/>`;
    const pts = xs.map((v) => `${X(v).toFixed(1)},${Y(got(v)).toFixed(1)}`);
    svg +=
      `<path d="M${X(0)},${Y(0)} L${pts.join(" L")} L${X(xMax)},${Y(0)} Z" fill="url(#gRe)"/>` +
      `<polyline points="${pts.join(" ")}" fill="none" stroke="#8d8452" stroke-width="2.5" stroke-linejoin="round"/>`;
    // 区切りの縦線と説明
    const mark = (v, label, color, row) =>
      v > 0 && v < xMax
        ? `<line x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${Y(0)}" stroke="${color}" stroke-dasharray="4 3"/>` +
          // 右半分の線は、文字を線の左側に置く（狭い画面でグラフの外へはみ出さないように）
          (X(v) > (X(0) + X(xMax)) / 2
            ? `<text x="${X(v) - 4}" y="${top + 12 + row * 14}" text-anchor="end" font-size="11" fill="${color}" font-weight="700">${label}</text>`
            : `<text x="${X(v) + 4}" y="${top + 12 + row * 14}" font-size="11" fill="${color}" font-weight="700">${label}</text>`)
        : "";
    svg += mark(L, `満額の上限 ${man(L)}`, "#566530", 0) + mark(U, `2回目0 ${man(U)}`, "#777048", 1) + mark(G, `全額返納 ${man(G)}`, "#a0453a", 2);
    // 入力した年収の位置
    const ix = Math.min(income, xMax);
    svg +=
      `<circle cx="${X(ix)}" cy="${Y(got(income))}" r="6" fill="#fff" stroke="#424d24" stroke-width="3"/>` +
      `<line class="c-chart__hover-line" x1="0" x2="0" y1="${top}" y2="${Y(0)}" stroke="#424d24" stroke-opacity=".3" visibility="hidden"/>` +
      `<circle class="c-chart__hover-dot" r="4" fill="#424d24" visibility="hidden"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="退職の翌年の年収と若年定年退職者給付金の受け取り額。年収${man(L)}円以下なら満額の${man(full)}円">${svg}</svg>`;
    const el = box.querySelector("svg"),
      line = el.querySelector(".c-chart__hover-line"),
      dot = el.querySelector(".c-chart__hover-dot");
    const show = (e) => {
      const rect = el.getBoundingClientRect(),
        px = ((e.clientX - rect.left) / rect.width) * W;
      if (px < left || px > W - right) return hide();
      const v = Math.round((((px - left) / plotW) * xMax) / 10000) * 10000,
        g = got(v);
      line.setAttribute("x1", X(v));
      line.setAttribute("x2", X(v));
      dot.setAttribute("cx", X(v));
      dot.setAttribute("cy", Y(g));
      line.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "visible");
      chartTip(
        box,
        `<b>年収 ${man(v)}円のとき</b><span>受け取り <em>${fmt(g)}</em></span><span>${g >= full ? "満額" : `満額より ${fmt(full - g)} 少ない`}</span>`,
        (X(v) / W) * rect.width + (rect.left - box.getBoundingClientRect().left),
        (Y(g) / H) * rect.height + (rect.top - box.getBoundingClientRect().top),
      );
    };
    const hide = () => {
      line.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      chartTip(box, null);
    };
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", hide);
  }
  // ---- 入力の共有 ----
  // 以前の版がこの端末に保存した入力は使わないので消す
  try {
    localStorage.removeItem("jieikan-salary-sim");
  } catch (e) {}
  const savedFields = () =>
    document.querySelectorAll(
      "#simulator .c-simulator__grid input:not([readonly]), #simulator .c-simulator__grid select, #branch, #branchAllowances select, #barracksYears, #eigaiStart",
    );
  function state() {
    const f = {};
    for (const el of savedFields()) f[el.id] = el.value;
    return { f, a: window.allowanceSimulator.dump() };
  }
  function apply(s) {
    const set = (id) => {
      const el = $(id);
      if (!el || s.f[id] == null) return;
      const before = el.value;
      el.value = s.f[id];
      // 選択肢にない値（古いURLなど）は元に戻す
      if (el.value !== String(s.f[id])) el.value = before;
    };
    // 以前の版で保存した乗組手当の選択を、新しい選択欄に引き継ぐ
    if (s.f.crewUse === "yes" && s.f["ba-maritime-crew"] == null) s.f["ba-maritime-crew"] = { destroyer: "43", submarine: "55.5" }[s.f.crewType];
    // 以前の版は「3曹への昇任」を月数（33・48・60）で保存していたので、年に直す
    if (Number(s.f.sergeant) > 20) s.f.sergeant = String(Number(s.f.sergeant) / 12);
    // 以前の版は「入隊から3曹昇任まで」だったので、「士長から3曹昇任まで」に直す
    if (s.f.sergeant != null && s.f.stepSgt == null) s.f.stepSgt = String(Number(s.f.sergeant) - (Number(s.f.stepPfc ?? 6) + Number(s.f.stepLcpl ?? 6)) / 12);
    set("branch");
    window.allowanceSimulator.updateBranch();
    for (const el of savedFields()) if (el.id !== "branch") set(el.id);
    updateRetirement();
    window.allowanceSimulator.restore(s.a);
  }
  function load() {
    let s = null,
      shared = false;
    try {
      const m = location.hash.match(/^#sim=(.+)$/);
      if (m) {
        s = JSON.parse(decodeURIComponent(m[1]));
        shared = true;
      }
    } catch (e) {}
    if (s?.f) apply(s);
    return shared;
  }
  $("shareLink").addEventListener("click", async () => {
    const url = location.href.split("#")[0] + "#sim=" + encodeURIComponent(JSON.stringify(state()));
    try {
      await navigator.clipboard.writeText(url);
      $("shareUrl").hidden = true;
      $("shareStatus").textContent = "共有用のURLをコピーしました。開くと同じ条件で試算できます。";
    } catch (e) {
      // コピーできない環境では、URLを表示して手動でコピーしてもらう
      $("shareUrl").value = url;
      $("shareUrl").hidden = false;
      $("shareUrl").select();
      $("shareStatus").textContent = "下のURLをコピーして共有してください。";
    }
  });
  // 入力を変えたら少し待ってから自動で計算し直す（閉じている間は計算しない。開いたときに計算する）
  let timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if ($("simulatorDialog").open) run();
    }, 250);
  }
  $("simulator").addEventListener("input", schedule);
  $("simulator").addEventListener("change", schedule);
  new MutationObserver(schedule).observe($("allowanceList"), { childList: true });
  // ---- 2つの条件を比べる：保存したA と、今の結果B ----
  let savedSummary = null,
    latestSummary = null;
  function renderCompare() {
    const on = !!savedSummary && !!latestSummary;
    // 結果が出るまでは保存できない
    $("compareSave").disabled = !latestSummary;
    $("compareWrap").hidden = !on;
    $("compareClear").hidden = !savedSummary;
    $("compareSave").textContent = savedSummary ? "今の結果でAを上書き" : "今の結果をAとして保存";
    $("compareHelp").textContent = on
      ? "Aは保存した時点の結果です。条件を変えるとB（今）だけが変わります。"
      : "今の結果をAとして保存してから条件を変えると、Aと今の結果（B）を並べて比べられます。例：「任期制で2任期」と「一般曹候補生で定年まで」";
    if (!on) return;
    const A = savedSummary,
      B = latestSummary,
      diff = (k) => {
        const d = B[k] - A[k];
        return d === 0 ? "±0円" : (d > 0 ? "+" : "−") + fmt(Math.abs(d));
      },
      money = [
        ["在職中の給与の総額", "total"],
        ["退職手当（任期満了金を含む）", "allowance"],
        ["若年定年退職者給付金", "pension"],
        ["税・共済掛金・退職後の負担", "deductions"],
        ["生涯の手取り", "lifetime"],
        ["65歳からの年金の見込み（年額）", "nenkin"],
      ];
    $("compareRows").innerHTML =
      `<tr><th scope="row">条件</th><td>${A.label}</td><td>${B.label}</td><td></td></tr>` +
      `<tr><th scope="row">勤務期間・最終の階級</th><td>${A.years}・${A.rank}</td><td>${B.years}・${B.rank}</td><td></td></tr>` +
      money
        .map(
          ([name, k]) =>
            `<tr${k === "lifetime" ? ' class="c-compare__key"' : ""}><th scope="row">${name}</th><td>${fmt(A[k])}</td><td>${fmt(B[k])}</td><td>${diff(k)}</td></tr>`,
        )
        .join("");
  }
  $("compareSave").addEventListener("click", () => {
    if (!latestSummary) return;
    savedSummary = { ...latestSummary };
    renderCompare();
  });
  $("compareClear").addEventListener("click", () => {
    savedSummary = null;
    renderCompare();
  });
  renderCompare();
  // 比較で使う条件の名前（入隊区分・予想階級または任期・入隊年齢）
  function compareLabel(c) {
    const type = $("entryType").selectedOptions[0].textContent.replace(/（.*?）/g, ""),
      goal = c.ninki?.exit ? `${$("ninkiPlan").selectedOptions[0].textContent}` : `${$("targetRank").value}で定年`;
    return `${type}・${goal}・${c.startAge}歳で入隊`;
  }
  // 国民健康保険料（市区町村の料率から計算）：保険料＝（前年の総所得金額等−43万円）×所得割＋均等割×人数＋平等割（上限あり）。
  // 退職した翌年度は退職した年の在職中の給与の所得、それ以後は再就職の給与所得・事業所得と、給付金の一時所得（2分の1）を前年の所得とする。
  // 退職手当と給付金の1回目は退職所得（分離課税）なので含めない。軽減・減免は含めない（試算の前提）
  function kokuhoPremiums(x, c, years) {
    const v = (id) => Number($(id).value) || 0,
      rate = v("kokuhoRate") / 100,
      perCapita = v("kokuhoPerCapita") * Math.max(1, v("kokuhoMembers")),
      household = v("kokuhoHousehold"),
      cap = v("kokuhoCap") || Infinity,
      retireYear = Math.floor(x.monthly.at(-1).ym / 12),
      lastYearSalary = x.monthly.filter((m) => m.year === retireYear).reduce((s, m) => s + m.taxable, 0),
      after = c.ypIncome?.after || { salary: 0, biz: 0 },
      ichiji = new Map();
    for (const p of x.retire.payments.filter((p) => p.taxKind === "ichiji")) {
      const y = Math.floor(p.ym / 12);
      ichiji.set(y, (ichiji.get(y) || 0) + p.amount);
    }
    const list = [];
    for (let k = 0; k < years; k++) {
      const prevYear = retireYear + k,
        income =
          k === 0
            ? salaryIncome(lastYearSalary, prevYear)
            : salaryIncome(after.salary, prevYear) + after.biz + Math.floor(Math.max(0, (ichiji.get(prevYear) || 0) - TX.ichijiSpecial) / 2),
        base = Math.max(0, income - TX.resident.basic[0][1]),
        premium = Math.min(cap, Math.floor(base * rate) + perCapita + household);
      list.push({ year: prevYear + 1, income, premium });
    }
    return { years: list, total: list.reduce((s, y) => s + y.premium, 0) };
  }
  function run() {
    if (!table) return false;
    const value = (id) => Number($(id).value),
      // 昇任の時期（月単位に丸める）。2士→1士・1士→士長は月、それ以外は年で入力
      pfcMonths = Math.round(value("stepPfc")),
      lcplMonths = pfcMonths + Math.round(value("stepLcpl")),
      sergeantMonths = lcplMonths + Math.round(value("stepSgt") * 12),
      c = {
        startAge: value("startAge"),
        entryMonth: value("entryMonth"),
        generalGrade: value("generalGrade"),
        retireAge: value("retireAge"),
        initialGrade: value("initialGrade"),
        raise: value("raise"),
        promotions: [
          { month: pfcMonths, col: 17 },
          { month: lcplMonths, col: 16 },
          { month: sergeantMonths, col: 15 },
        ],
        bonus: value("bonus"),
        entryYear: value("entryYear"),
        manager: $("manager").value,
        retireReason: $("retireReason").value,
        family: {
          spouse: $("spouse").value === "yes",
          general: value("dependents"),
          specific: value("specificDependents"),
        },
        // 若年定年退職者給付金の所得による調整と、給付金の税に使う再就職の所得（円）。空欄の年は退職の翌年と同じ
        ypIncome: (() => {
          const yen = (id) => ($(id).value.trim() === "" ? null : Number($(id).value) * 10000),
            pair = (s, b) => ({ salary: yen(s), biz: yen(b) });
          const after = { salary: yen("reemployIncome") || 0, biz: yen("reemployBiz") || 0 },
            later = (s, b) => {
              const p = pair(s, b);
              return p.salary == null && p.biz == null ? null : { salary: p.salary ?? after.salary, biz: p.biz ?? after.biz };
            };
          return { after, y61: later("incomeY61", "incomeY61Biz"), y59: later("incomeY59", "incomeY59Biz"), civ: later("incomeCiv", "incomeCivBiz") };
        })(),
        ypLump: $("ypLump").value,
        // 追給（給与法第27条の7）の確認に使う、退職の翌年から59歳までの所得金額の平均（円。空欄なら null）
        ypAvg: $("incomeAvg").value.trim() === "" ? null : Number($("incomeAvg").value) * 10000,
        prevServiceYears: value("prevServiceYears"),
        publicReemploy: $("publicReemploy").value === "yes",
        ypAssume: $("ypAssume").value,
        promotionTable: window.PROMOTION_TABLE,
        // 営舎の外に住み始める月（住まない場合は null）
        eigaiStart: $("eigaiStart").value === "none" ? null : $("eigaiStart").value === "sergeant" ? sergeantMonths : value("eigaiStart") * 12,
      };
    // 3曹昇任の時点から、各昇任までの年数を積み上げて昇任月を決める
    let month = sergeantMonths;
    for (const p of pathTo($("targetRank").value)) {
      month += Math.round(value(p.step) * 12);
      c.promotions.push({ month, col: p.col ?? value("colClass") });
    }
    // 教育期間（基本給だけで手当を支給しない期間）：入隊後の教育隊5か月、3曹昇任直前の海曹予定者課程など3か月、
    // 3尉昇任直前の幹部候補生学校8か月（いずれも固定。入力欄は読み取り専用）
    const officerMonth = c.promotions.find((p) => p.col === 10)?.month;
    c.education = [
      [0, value("eduRecruit")],
      [sergeantMonths - value("eduSgt"), sergeantMonths],
      ...(officerMonth != null ? [[officerMonth - value("eduOcs"), officerMonth]] : []),
    ];
    // 入隊区分ごとの違い
    const E = window.RULES.entry,
      entryType = $("entryType").value,
      branchNow = $("branch").value;
    let entryMessage = "";
    if (entryType.startsWith("kanko")) {
      // 一般幹部候補生：曹長として採用し、幹部候補生学校の間は防衛省令の額、卒業時に3尉（院卒は2尉）に任官する
      const k = E.candidate[entryType],
        cand = E.candidateMonths[branchNow],
        target = $("targetRank").selectedOptions[0];
      if (!target.dataset.officer) entryMessage = "幹部候補生で入隊する場合は、予想する将来の階級に3尉以上を選んでください。";
      else if (k.col === 9 && target.value === "3尉") entryMessage = "院卒者試験の幹部候補生は2尉に任官するため、予想する将来の階級に2尉以上を選んでください。";
      c.initialRank = 12;
      c.initialGrade = 1;
      c.payOverride = { until: cand, col: k.payCol, grade: k.payGrade };
      c.promotions = [{ month: cand, col: k.col, grade: k.grade }];
      c.education = [[0, cand]];
      const skip = k.col === 9 ? ["3尉", "2尉"] : ["3尉"];
      let m2 = cand;
      for (const p of pathTo(target.value, "sgt").filter((p) => !skip.includes(p.name))) {
        m2 += Math.round(value(p.step) * 12);
        c.promotions.push({ month: m2, col: p.col ?? value("colClass") });
      }
    } else if (entryType === "koka") {
      // 高等工科学校の卒業生：卒業の日（4月1日）に陸士長で任官し、1年後に3曹へ昇任（RULES.entry.koka）
      const K = E.koka;
      if (branchNow !== K.branch) entryMessage = "高等工科学校の卒業生は陸上自衛官です。所属を陸上自衛隊にしてください。";
      c.initialRank = K.rank;
      c.initialGrade = K.grade;
      c.promotions = [{ month: K.sergeantMonths, col: 15 }];
      let m3 = K.sergeantMonths;
      for (const p of pathTo($("targetRank").value)) {
        m3 += Math.round(value(p.step) * 12);
        c.promotions.push({ month: m3, col: p.col ?? value("colClass") });
      }
      const ofc = c.promotions.find((p) => p.col === 10)?.month;
      c.education = [[0, K.eduMonths], ...(ofc != null ? [[ofc - value("eduOcs"), ofc]] : [])];
      if ($("eigaiStart").value === "sergeant") c.eigaiStart = K.sergeantMonths;
      // 退職手当の勤続期間に通算する生徒の期間（2分の1。自衛官として6か月以上在職した場合。防衛省給与法第28条の2第4項）
      c.studentCreditMonths = K.studentMonths / 2;
    } else if (entryType === "ninki") {
      // 任期制自衛官：任期ごとに任期満了の退職手当（防衛省給与法第28条）
      const first = E.ninkiFirstMonths[branchNow],
        plan = $("ninkiPlan").value,
        terms = [];
      let end = 0;
      for (let k = 0; k < 40; k++) {
        const len = k === 0 ? first : E.ninkiNextMonths;
        if (plan === "sgt" ? end + len > sergeantMonths : k >= Number(plan)) break;
        end += len;
        terms.push({
          end,
          months: len,
          days: k === 0 ? E.ninkiDays.first[len] : (E.ninkiDays.byTerm[k - 1] ?? E.ninkiDays.later),
        });
      }
      if (plan === "sgt") {
        // 3曹へ昇任する場合の在職期間は定年まで。任期は在職期間の中だけにし、
        // 定年までに3曹へ昇任できない（任期の途中で定年になる）入力は案内を出す
        const serviceMonths = Math.round((c.retireAge - c.startAge) * 12);
        if (sergeantMonths >= serviceMonths)
          entryMessage = `入隊時の年齢が高く、定年（${c.retireAge}歳）までに3曹へ昇任できません。入隊時の年齢か任期の扱いを変えてください。`;
        while (terms.length && terms.at(-1).end > serviceMonths) terms.pop();
      }
      c.ninki = { terms, exit: plan !== "sgt" };
      if (plan !== "sgt") {
        // 満了で退職する：退職の年齢は任期の合計で決まり、3曹には昇任しない
        c.retireAge = c.startAge + end / 12;
        // 満了時の年齢が、曹の定年（3曹の55歳）を超える入力は計算しない（サイトの前提。士には定年の定めがないため、
        // 曹の最も早い定年を目安の上限にする）
        const limit = window.RULES.promotion.retireAge["3曹"];
        if (c.retireAge > limit)
          entryMessage = `任期満了のとき${Math.floor(c.retireAge)}歳になります。この試算では、任期満了の年齢が${limit}歳（3曹の定年）以下になる範囲で計算します。入隊時の年齢か任期の数を変えてください。`;
        c.promotions = c.promotions.filter((p) => p.month < end && p.col >= 16);
        c.education = [[0, value("eduRecruit")]];
      }
    }
    $("simError").textContent = "";
    // 空欄でよい欄（data-optional：空欄なら退職の翌年と同じ）は、空欄のときは確かめない
    const inputs = [...document.querySelectorAll(".c-simulator__grid input")].filter((el) => !el.closest("[hidden]") && !(el.dataset.optional && el.value.trim() === ""));
    const messages = {
      startAge: "入隊時の年齢は16〜60歳の整数で入力してください。",
      initialGrade: "入隊時の2士の号俸は1〜17号俸の整数で入力してください。",
      raise: "毎年の昇給は0〜20号俸の整数で入力してください。",
      bonus: "賞与は金額ではなく年間の月数を入力してください。例：4.7（0〜12か月）",
      entryYear: "入隊した年は2000〜2060年の整数で入力してください。",
      dependents: "扶養親族の人数は0〜10人の整数で入力してください。",
      specificDependents: "特定扶養親族の人数は0〜10人の整数で入力してください。",
      reemployIncome: "退職の翌年の給与収入は0〜5,000万円で入力してください。",
      reemployBiz: "退職の翌年の事業所得は0〜5,000万円で入力してください（赤字の場合は0）。",
      incomeY61: "61歳の年の給与収入は0〜5,000万円で入力するか、空欄にしてください。",
      incomeY61Biz: "61歳の年の事業所得は0〜5,000万円で入力するか、空欄にしてください。",
      incomeY59: "60歳になる年の前年の給与収入は0〜5,000万円で入力するか、空欄にしてください。",
      incomeY59Biz: "60歳になる年の前年の事業所得は0〜5,000万円で入力するか、空欄にしてください。",
      incomeCiv: "自衛官以外の職員の定年になる年の前年の給与収入は0〜5,000万円で入力するか、空欄にしてください。",
      incomeCivBiz: "自衛官以外の職員の定年になる年の前年の事業所得は0〜5,000万円で入力するか、空欄にしてください。",
      selfRetireAge: "自己都合で退職する年齢は、入隊時の年齢より大きく、定年の年齢以下の整数で入力してください。",
    };
    const invalid = inputs.find((el) => el.value.trim() === "" || !el.checkValidity());
    // 間違った欄が閉じたまとまり（details）の中にあれば、開いて見えるようにする
    if (invalid) for (let d = invalid.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
    // 昇任までの期間などは、入力欄の最小値（法令の最短）〜最大値と単位を使って案内する
    const unit = (el) => el.parentElement.querySelector("span")?.textContent || "";
    let message = invalid
      ? messages[invalid.id] ||
        (invalid.min
          ? `「${invalid.labels[0].textContent}」は${invalid.min}〜${invalid.max}${unit(invalid)}の範囲で入力してください（最小値は法令の最短期間です）。`
          : "入力内容を確認してください。")
      : "";
    if (!message && (!Number.isInteger(c.startAge) || !Number.isInteger(c.initialGrade) || !Number.isInteger(c.raise)))
      message = "入隊時の年齢、号俸、毎年の昇給は整数で入力してください。";
    // 指定場所生活調整金は営舎内で1年間を通して生活した年だけが対象なので、営外に住む時期と重ねない
    if (!message && c.eigaiStart != null && c.eigaiStart < value("barracksYears") * 12)
      message = "「営舎内・艦内で生活する年数」と「営舎の外に住み始める時期」が重なっています。どちらかを変更してください。";
    if (!message && entryMessage) message = entryMessage;
    // 配置手当の期間：終了は開始より後に
    if (!message && $("placementFrom").value.trim() && $("placementTo").value.trim() && value("placementTo") <= value("placementFrom"))
      message = "配置手当の支給終了は、支給開始より後の年数にしてください。";
    // 自己都合退職：入力した年齢で退職する（定年より後にはできない）
    if (!message && c.retireReason === "self" && !c.ninki?.exit) {
      const a = value("selfRetireAge");
      if (!Number.isInteger(a) || a <= c.startAge || a > c.retireAge)
        message = `自己都合で退職する年齢は、入隊時の年齢（${c.startAge}歳）より大きく、定年（${c.retireAge}歳）以下の整数で入力してください。`;
      else c.retireAge = a;
    }
    if (!message && c.retireAge <= c.startAge) message = "入隊時の年齢は定年年齢より小さくしてください。";
    if (!message && table[c.initialGrade - 1]?.[18] == null) {
      const max = table.reduce((n, row, i) => (row[18] != null ? i + 1 : n), 0);
      message = `入隊時の2士の号俸は、給料表にある1〜${max}号俸で入力してください。`;
    }
    try {
      if (message) throw Error(message);
      c.allowances = window.allowanceSimulator.read();
      let x = model(table, c);
      const target = $("targetRank").value,
        targetAge = c.retireAge;
      let ageRank = target;
      // 予想階級に届かないときは、到達した階級の定年（RULES.promotion.retireAge）で退職する。
      // 到達した階級の定年の方が早ければ、その年齢で計算し直す（早く辞めると到達階級がさらに下がることがあるので、定年が変わらなくなるまで繰り返す）
      if (!c.ninki?.exit)
        for (let k = 0; k < 5; k++) {
          // 士（士長・1士・2士）には定年の定めがないので、曹の最も早い定年（3曹の55歳）を目安の上限にする（サイトの前提。
          // 任期制の満了の年齢の上限と同じ）。これがないと、3曹に届かない高い年齢の入隊が予想階級の定年まで勤める計算になる
          const rankNow = x.monthly.at(-1).rank,
            baseAge = R.promotion.retireAge[rankNow],
            age = baseAge != null ? specialRetireAge(rankNow, baseAge) : ["士長", "1士", "2士"].includes(rankNow) ? R.promotion.retireAge["3曹"] : null;
          if (age == null || age >= c.retireAge) break;
          if (age <= c.startAge)
            throw Error(
              `入隊時の年齢が高く、予想階級の${target}に届きません。途中の${rankNow}の定年（${age}歳）を入隊時の年齢が超えるため計算できません。入隊時の年齢か予想階級を変えてください。`,
            );
          c.retireAge = age;
          ageRank = rankNow;
          // 任期制から3曹へ昇任する場合も、早まった定年までに3曹へ昇任できるか確かめ、任期を在職期間の中にする
          if (c.ninki) {
            const serviceMonths = Math.round((age - c.startAge) * 12);
            if (sergeantMonths >= serviceMonths)
              throw Error(`入隊時の年齢が高く、定年（${age}歳）までに3曹へ昇任できません。入隊時の年齢か任期の扱いを変えてください。`);
            c.ninki.terms = c.ninki.terms.filter((t) => t.end <= serviceMonths);
          }
          x = model(table, c);
        }
      const reached = x.monthly.at(-1).rank,
        lastRank = `${reached}${x.monthly.at(-1).grade ? ` ${x.monthly.at(-1).grade}号俸` : ""}`;
      $("totalIncome").textContent = fmt(x.total);
      $("totalDetail").textContent =
        "生涯年収と3つの内訳は、税金などを引く前の額（額面）です" +
        (reached === target
          ? ""
          : c.retireAge < targetAge
            ? ageRank === reached || R.promotion.retireAge[reached] === c.retireAge
              ? `。予想階級の${target}に届かないため、到達した${reached}の定年（${c.retireAge}歳）で退職として計算しています`
              : `。予想階級の${target}に届かないため、${ageRank}の定年（${c.retireAge}歳）で退職として計算しています（その年齢までに${ageRank}へは昇任しないため、${reached}までで計算）`
            : `。定年までに${target}へ届かないため、${reached}までで計算しています`);
      $("serviceYears").textContent = Math.round((c.retireAge - c.startAge) * 10) / 10 + "年";
      $("lastRank").textContent = lastRank;
      $("lastYear").textContent = fmt(x.years.at(-1).total);
      $("stickyTotal").textContent = fmt(x.total);
      $("stickyRank").textContent = `${lastRank}・${c.retireAge}歳で${c.ninki?.exit ? "任期満了" : c.retireReason === "self" ? "自己都合退職" : "定年"}`;
      stickyError(false);
      $("simJump").hidden = false;
      // グラフは表示幅に合わせて描くので、先に結果欄を表示する
      $("simResult").hidden = false;
      drawChart(x.years);
      drawReemployChart(x.retire, x.retire.yp?.incomeAfter ?? 0);
      $("simRows").innerHTML = x.years
        .map(
          (y) =>
            `<tr><td>${y.age}〜${y.age + 1}歳</td><td>${y.ranks}</td><td>${fmt(y.salary)}</td><td>${fmt(y.bonus)}</td><td>${fmt(y.allowances)}</td><td>${fmt(y.total)}</td><td>${fmt(y.deductions)}</td><td>${fmt(y.net)}</td></tr>`,
        )
        .join("");
      // 退職手当・若年定年退職者給付金と、生涯の手取り
      const r = x.retire,
        sum = (k) => x.years.reduce((s, y) => s + y[k], 0),
        AR = window.RULES.afterRetire,
        retireYm = x.monthly.at(-1).ym + 1,
        // 退職後の国民年金保険料：「国民年金保険料を自分で納める」を選んだら、退職の翌月から60歳になるまで（国民年金法第7条・第87条）
        afterPension = $("afterPension").value,
        kokuminMonths = afterPension === "employee" ? 0 : Math.max(0, Math.round((AR.kokuminUntilAge - c.retireAge) * 12)),
        // 免除を受けた月は保険料を払わない（そのぶん老齢基礎年金が減る）
        exemptMonths = afterPension === "exempt" ? kokuminMonths : 0,
        kokumin = Array.from({ length: afterPension === "kokumin" ? kokuminMonths : 0 }, (_, k) => {
          const ym = retireYm + k,
            fy = Math.floor(ym / 12) - (ym % 12 < 3 ? 1 : 0);
          return AR.kokuminPremium.find(([until]) => fy <= until)[1];
        }).reduce((a, b) => a + b, 0),
        // 退職後の健康保険料（入力した年額 × 年数。任意継続は最長2年）
        healthType = $("afterHealth").value,
        healthYears = Math.min(Number($("afterHealthYears").value), healthType === "nini" ? 2 : Infinity),
        kokuho = healthType === "kokuhoCalc" ? kokuhoPremiums(x, c, healthYears) : null,
        health =
          healthType === "none"
            ? 0
            : kokuho
              ? kokuho.total
              : Math.round(Number($("afterHealthYen").value) * 10000) * healthYears,
        afterBurden = x.afterResident + kokumin + health,
        // 退職後に納める住民税・国民年金保険料・健康保険料も、生涯の手取りから差し引く
        deductions = sum("deductions") + afterBurden,
        lifetime = sum("net") + r.net - afterBurden,
        // 65歳からの公的年金の見込み（年額）：老齢基礎年金（満額）＋老齢厚生年金の報酬比例部分
        hirei = Math.floor(x.monthly.reduce((a, m) => a + (m.pensionStd || 0), 0) * AR.hireiRate),
        // 老齢基礎年金：免除した月は2分の1として数える（ほかの月は納付済みの前提）
        basicPension = Math.round((AR.basicFull * (480 - exemptMonths * (1 - AR.exemptRatio))) / 480);
      $("retireAllowance").textContent = fmt(r.allowance);
      $("youngPension").textContent = r.payments.length ? fmt(r.pension) : "対象外";
      $("grossAll").textContent = fmt(x.total + r.allowance + r.pension);
      $("totalDeductions").textContent = fmt(deductions + r.tax);
      $("lifetimeNet").textContent = fmt(lifetime);
      // 上の帯も生涯年収にそろえる
      $("stickyTotal").textContent = fmt(x.total + r.allowance + r.pension);
      const row = (k, v, note = "") => `<tr><th scope="row">${k}</th><td>${v}</td><td>${note}</td></tr>`;
      // 任期満了金（任期制自衛官）の行
      const termRows = (r.terms || [])
        .map((t) => row(t.label, fmt(t.amount), `満了時の俸給月額 ${fmt(t.pay)} ÷ 30 × ${t.days}日（防衛省給与法第28条）`))
        .join("");
      $("retireRows").innerHTML = r.ninkiExit
        ? termRows +
          row("若年定年退職者給付金", "対象外", "任期満了で退職するため（定年退職ではない）") +
          row("退職手当・給付金の税（所得税・住民税）", "−" + fmt(r.tax), "任期満了金は退職所得。任期ごとに、その任期の年数の退職所得控除を使って課税") +
          row("差し引きの受取額", fmt(r.net)) +
          row(
            "退職後に納める住民税（在職中の給与の分）",
            "−" + fmt(x.afterResident),
            "住民税は翌年6月から1年かけて差し引かれるため、退職した年などの分を退職後に納めます",
          ) +
          (kokumin
            ? row(
                "退職後に納める国民年金保険料",
                "−" + fmt(kokumin),
                `退職の翌月から60歳まで${kokuminMonths}か月分（令和8年度は月17,920円、令和9年度以後は18,290円）`,
              )
            : "") +
          (exemptMonths
            ? row(
                "国民年金保険料の免除（退職による特例）",
                "0円",
                `退職の翌月から60歳まで${exemptMonths}か月分の保険料を免除。老齢基礎年金は年${fmt(AR.basicFull - basicPension)}減ります（10年以内に追納すれば満額に戻せます）`,
              )
            : "") +
          (health
            ? row("退職後の健康保険料", "−" + fmt(health), kokuho ? `国民健康保険（入力した料率から、前年の所得で計算）：${kokuho.years.map((y) => `${y.year}年度 ${fmt(y.premium)}（前年の所得 ${fmt(y.income)}）`).join("、")}` : `${healthType === "nini" ? "共済組合の任意継続" : "国民健康保険"}（入力した年額 × 年数）`)
            : "") +
          row(
            "65歳からの公的年金の見込み（年額・参考）",
            fmt(basicPension + hirei),
            `老齢基礎年金 ${fmt(basicPension)}（令和8年度の満額をもとに、${exemptMonths ? `退職後に免除した${exemptMonths}か月を2分の1として` : "20〜60歳の40年間すべて納めた場合として"}計算）＋老齢厚生年金の報酬比例部分 ${fmt(hirei)}（在職中の標準報酬×5.481/1000）。退職等年金給付・加給年金・賃金の再評価は含まず、生涯の手取りにも含めません`,
          )
        : termRows +
          row(
            "退職手当（基本額）",
            fmt(r.basic),
            `勤続${r.years}年${r.terms?.length ? "（任期満了金を受けた任期を除く）" : ""}・${c.retireReason === "self" ? (r.selfLong ? "自己都合（勤続42年超のため定年退職・勤続35年として計算）" : "自己都合") : "定年"}退職。退職日の俸給月額 ${fmt(x.monthly.at(-1).basePay)}`,
          ) +
          row("退職手当（調整額）", fmt(r.adjust), "在職中の階級ごとの調整月額のうち多い順に60か月分") +
          (r.payments.length
            ? r.payments
                .map((p) =>
                  row(
                    `若年定年退職者給付金 ${p.label}`,
                    fmt(p.amount),
                    `${p.lump ? "一時に受け取る額（所得による調整の後）" : p.full != null && p.full !== p.amount ? `満額 ${fmt(p.full)} を所得による調整で減額` : "満額"}。税は${p.taxKind === "retire" ? "退職所得" : "一時所得"}`,
                  ),
                )
                .join("") +
              (r.yp
                ? row(
                    "若年定年退職者給付金の計算の前提",
                    "—",
                    `${r.yp.name}。俸給月額 ${fmt(r.yp.Pc)}、60歳までの年数 ${r.yp.early}年・60歳以後の年数 ${r.yp.late}年` +
                      (r.yp.L != null ? `。退職の翌年の所得金額 ${fmt(r.yp.incomeAfter)}（調整が始まる額 ${fmt(Math.max(0, r.yp.L))}・2回目が0になる額 ${fmt(r.yp.U)}）` : "") +
                      (r.yp.A != null ? `。加算調整上限額 ${fmt(r.yp.A)}（給与年額相当額 ${fmt(r.yp.G)}＋退職前5年間の対象手当の最も高い年 ${fmt(r.yp.A - r.yp.G)}）` : "") +
                      (r.yp.lateL != null ? `。60歳以後の分は61歳の年の所得金額 ${fmt(r.yp.income61)} で調整（調整が始まる額 ${fmt(Math.max(0, r.yp.lateL))}）` : "") +
                      (r.yp.assumptions.length ? `。仮定：${r.yp.assumptions.join("。")}` : ""),
                  )
                : "")
            : row(
                "若年定年退職者給付金",
                "対象外",
                r.ypReason === "self"
                  ? "定年退職ではないため"
                  : r.ypReason === "years"
                    ? `自衛官としての在職期間が20年未満のため（${r.ypYears}年。以前の自衛官の期間の通算は令和8年4月以後の退職だけ）`
                    : r.ypReason === "public"
                      ? "退職の翌日までに常勤の公務員になるため（給与法第27条の2第1項ただし書）"
                      : `定年（${c.retireAge}歳）が自衛官以外の職員の定年（${r.civil}歳）より若くないため`,
              )) +
          row(
            "退職手当・給付金の税（所得税・住民税）",
            "−" + fmt(r.tax),
            r.payments.some((p) => p.taxKind === "ichiji")
              ? "退職手当と給付金の1回目は退職所得（退職所得控除後の2分の1に課税）。給付金の2回目以降は一時所得（50万円の特別控除後の2分の1を、その年の再就職の所得に加えて増える税。社会保険料控除などは入れていません）"
              : "退職所得控除後の2分の1に課税",
          ) +
          row("差し引きの受取額", fmt(r.net)) +
          row(
            "退職後に納める住民税（在職中の給与の分）",
            "−" + fmt(x.afterResident),
            "住民税は翌年6月から1年かけて差し引かれるため、退職した年などの分を退職後に納めます",
          ) +
          (kokumin
            ? row(
                "退職後に納める国民年金保険料",
                "−" + fmt(kokumin),
                `退職の翌月から60歳まで${kokuminMonths}か月分（令和8年度は月17,920円、令和9年度以後は18,290円）`,
              )
            : "") +
          (exemptMonths
            ? row(
                "国民年金保険料の免除（退職による特例）",
                "0円",
                `退職の翌月から60歳まで${exemptMonths}か月分の保険料を免除。老齢基礎年金は年${fmt(AR.basicFull - basicPension)}減ります（10年以内に追納すれば満額に戻せます）`,
              )
            : "") +
          (health
            ? row("退職後の健康保険料", "−" + fmt(health), kokuho ? `国民健康保険（入力した料率から、前年の所得で計算）：${kokuho.years.map((y) => `${y.year}年度 ${fmt(y.premium)}（前年の所得 ${fmt(y.income)}）`).join("、")}` : `${healthType === "nini" ? "共済組合の任意継続" : "国民健康保険"}（入力した年額 × 年数）`)
            : "") +
          row(
            "65歳からの公的年金の見込み（年額・参考）",
            fmt(basicPension + hirei),
            `老齢基礎年金 ${fmt(basicPension)}（令和8年度の満額をもとに、${exemptMonths ? `退職後に免除した${exemptMonths}か月を2分の1として` : "20〜60歳の40年間すべて納めた場合として"}計算）＋老齢厚生年金の報酬比例部分 ${fmt(hirei)}（在職中の標準報酬×5.481/1000）。退職等年金給付・加給年金・賃金の再評価は含まず、生涯の手取りにも含めません`,
          );
      $("deductionDetail").textContent =
        `在職中：共済掛金 ${fmt(sum("social"))}、所得税 ${fmt(sum("incomeTax"))}、住民税 ${fmt(sum("residentTax"))}。退職後に納める住民税 ${fmt(x.afterResident)}${kokumin ? `、退職後の国民年金保険料 ${fmt(kokumin)}` : ""}${health ? `、退職後の健康保険料 ${fmt(health)}` : ""}。退職所得の税 ${fmt(r.tax)}`;
      // 比較用の要約（Aとして保存できる）
      latestSummary = {
        label: compareLabel(c),
        years: $("serviceYears").textContent,
        rank: lastRank,
        total: x.total,
        allowance: r.allowance,
        pension: r.pension,
        deductions: deductions + r.tax,
        lifetime,
        nenkin: basicPension + hirei,
      };
      renderCompare();
      return true;
    } catch (e) {
      // 入力の案内（Error で投げた文）はそのまま出し、JavaScript の内部エラー（TypeError など）は分かる文で包む
      $("simError").textContent =
        e && e.constructor === Error ? e.message : `計算できませんでした。入力を確かめてください（詳細：${e && e.message ? e.message : e}）`;
      $("simResult").hidden = true;
      $("stickyTotal").textContent = "—";
      $("stickyRank").textContent = "入力内容を確認してください";
      stickyError(true);
      $("simJump").hidden = true;
      return false;
    }
  }
  // エラーのとき、上部の帯の「入力内容を確認してください」を押すと、エラーの文の位置へ移ってフォーカスする
  // （CSP でインラインのイベント属性は使えないので、ここで動きを付ける）
  function stickyError(on) {
    const el = $("stickyRank");
    if (on) {
      el.dataset.error = "";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.title = "エラーの内容へ移動";
      el.style.cursor = "pointer";
      el.style.textDecoration = "underline";
    } else {
      delete el.dataset.error;
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
      el.removeAttribute("title");
      el.style.cursor = "";
      el.style.textDecoration = "";
    }
  }
  function goToError() {
    const err = $("simError");
    if (!err.hasAttribute("tabindex")) err.tabIndex = -1;
    err.scrollIntoView({ behavior: "smooth", block: "center" });
    err.focus({ preventScroll: true });
  }
  $("stickyRank").addEventListener("click", () => {
    if ("error" in $("stickyRank").dataset) goToError();
  });
  $("stickyRank").addEventListener("keydown", (e) => {
    if (!("error" in $("stickyRank").dataset) || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    goToError();
  });
  // 共有URLで開いたときは、その条件でシミュレーターを開く
  function openShared() {
    if (load() && !$("simulatorDialog").open) $("simulatorDialog").showModal();
    if ($("simulatorDialog").open) run();
  }
  // 入隊した年の初期値は今年（日本時間）。入力欄の範囲（2000〜2060年）に収める
  {
    const y = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 4)),
      el = $("entryYear");
    el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), y)));
  }
  // 閉じたら入力を初期値に戻す（共有URLの条件も外す）
  const initial = state();
  $("simulatorDialog").addEventListener("close", () => {
    clearTimeout(timer);
    if (location.hash.startsWith("#sim=")) history.replaceState(null, "", location.href.split("#")[0]);
    apply(JSON.parse(JSON.stringify(initial)));
    $("shareUrl").hidden = true;
    $("shareStatus").textContent = "シミュレーターを閉じると、入力した条件は初期値に戻ります。";
  });
  openShared();
  window.addEventListener("hashchange", openShared);
  // 開いたときや画面幅が変わったときは、グラフを幅に合わせて描き直す
  $("simLaunch").addEventListener("click", () => requestAnimationFrame(() => run()));
  window.addEventListener("resize", schedule);

  // ---- よくある経歴のひな形：入隊区分・予想階級・入隊時の年齢・昇任までの期間だけを変える（手当などほかの入力はそのまま） ----
  const PRESET_STEPS = [
      "stepSgt",
      "stepOfc",
      "stepOfcSgm",
      "stepOfcWo",
      "first",
      "stepSgt2",
      "stepSgt1",
      "stepSgm",
      "stepWo",
      "stepMaj",
      "stepLtc",
      "stepCol",
      "stepMg",
      "stepGen",
    ],
    stepDefaults = Object.fromEntries(PRESET_STEPS.map((id) => [id, $(id).value])),
    PRESETS = {
      sotsu: { entryType: "sotsu", targetRank: "曹長", startAge: 18, steps: "def" },
      koka: { entryType: "koka", targetRank: "曹長", startAge: 18, steps: "def", branch: "ground" },
      bunai: { entryType: "sotsu", targetRank: "1尉", startAge: 18, steps: "def" },
      // 防大・大卒の幹部：2尉→1尉は一斉昇任のため3年（法令の在職期間3年と同じ）
      kanko: { entryType: "kanko", targetRank: "2佐", startAge: 22, steps: "def", set: { first: "3" }, lock: ["first"] },
    };
  for (const button of document.querySelectorAll(".c-preset__button"))
    button.addEventListener("click", () => {
      const p = PRESETS[button.dataset.preset];
      if (!p) return;
      if (p.branch && $("branch").value !== p.branch) {
        $("branch").value = p.branch;
        $("branch").dispatchEvent(new Event("change", { bubbles: true }));
      }
      $("entryType").value = p.entryType;
      $("entryType").dispatchEvent(new Event("change", { bubbles: true }));
      $("targetRank").value = p.targetRank;
      $("startAge").value = String(p.startAge);
      $("ofcRoute").value = "sgt";
      // 選択欄の最初の選択肢が法令の最短期間、初期値は画面を開いたときの値
      for (const id of PRESET_STEPS) {
        const el = $(id);
        el.value = p.set?.[id] ?? (p.steps === "min" && el.tagName === "SELECT" ? el.options[0].value : stepDefaults[id]);
        // ひな形が固定する欄（防大・大卒の幹部の2尉→1尉）だけ変えられなくする。ほかのひな形では外す
        el.disabled = !!p.lock?.includes(id);
      }
      $("firstLock").hidden = !p.lock?.includes("first");
      $("targetRank").dispatchEvent(new Event("change", { bubbles: true }));
      $("shareStatus").textContent = `ひな形「${button.textContent}」を入れました。`;
    });

  // ---- 年ごとの表を CSV で保存する（この端末の中だけで作り、どこにも送らない） ----
  $("csvSim")?.addEventListener("click", () => {
    const table = $("simRows").closest("table"),
      rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.cells].map((cell) => cell.textContent.trim()));
    if (rows.length < 2 || $("simResult").hidden) {
      $("shareStatus").textContent = "計算結果がありません。入力を確かめてください。";
      return;
    }
    // 表計算ソフトが式として読まないよう、= + @ で始まる値は ' を付ける。, " 改行を含む値は "" で囲む
    const cell = (v) => {
      const s = /^[=+@]/.test(v) ? "'" + v : v;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      link = document.createElement("a");
    link.href = url;
    link.download = "自衛官_生涯給与_年ごとの表.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("shareStatus").textContent = "年ごとの表をCSVで保存しました（金額は円。表計算ソフトで開けます）。";
  });
})();
