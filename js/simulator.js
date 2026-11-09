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
        const kinbenRate = (months, days) =>
          months >= 6 ? 1 : B.kinbenPeriod[months * 2 + (days >= 15 ? 1 : 0)];
        // 賞与の区分（指定職・特定管理職員・一般）。1回あたりの割合は RULES.bonus.kimatsuPer / kinbenStandard
        const bonusClass = (rank, special, manager) =>
          rank <= B.shiteiCols ? "shitei" : special && B.tokuteiManagers.includes(manager) ? "tokutei" : "normal";
        // 賞与の階級による加算割合（俸給表の列番号ごと。表にない列は0）
        const bonusRate = (col) => B.rankAdd.find(([max]) => col <= max)?.[1] ?? 0;
        const SENIOR_RATE = AL.seniorRate,
          EIGAI = AL.eigai,
          MANAGER_PAY = AL.managerPay,
          MANAGER_BONUS = B.managerAdd,
          FUYOU_PARENT = AL.calcRates.fuyouParentByCol;
        // ---- 退職手当 ----
        const ART3 = RT.art3,
          ART4 = RT.art4,
          ART5 = RT.art5;
        const bandMonths = (bands, n) =>
          bands.reduce((s, [from, to, r]) => s + Math.max(0, Math.min(n, to) - from + 1) * r, 0);
        // 退職手当の調整月額（将は号俸で区分が分かれる。表にない列は0）
        const adjustMonthly = (col, grade) =>
          col === 0
            ? grade >= RT.adjustGeneral.highGrade
              ? RT.adjustGeneral.high
              : RT.adjustGeneral.low
            : (RT.adjustMonthly[col] ?? 0);
        // ---- 若年定年退職者給付金 ----
        const EARLY_RATE = YP.earlyRate,
          LATE_RATE = YP.lateRate;
        const civilRetireAge = (fy) => YP.civilRetireAge.find(([until]) => fy <= until)[1];
        // ---- 共済掛金 ----
        const KYOSAI = KY;
        // 厚生年金の標準報酬月額の上限。ym＝年×12＋(月−1)
        const pensionCap = (ym) =>
          KY.pensionCaps.reduce((cap, [y, m, v]) => (ym >= y * 12 + m - 1 ? v : cap), KY.pensionCaps[0][2]);
        // ---- 所得税・住民税 ----
        // 給与所得控除
        function salaryDeduction(x, y) {
          const [, r, add] = TX.salaryDeduction.find(([max]) => x <= max),
            d = x * r + add,
            m = TX.salaryMin;
          return Math.max(
            d,
            y < m.specialYears[0] ? m.before2026 : y <= m.specialYears[1] && x < m.specialIncomeBelow ? m.special : m.base,
          );
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
        function salaryTaxes(income, social, y, f) {
          const g = Math.max(0, Math.floor(income - salaryDeduction(income, y))),
            sp = f.spouse ? pick(TX.spouse, g) : null,
            floor1000 = (v) => Math.max(0, Math.floor(v / 1000) * 1000),
            dep = TX.dependent,
            res = TX.resident;
          const it = withSurtax(
            progressive(
              floor1000(g - social - basicDeduction(g, y) - (sp?.[1] ?? 0) - f.general * dep.general[0] - f.specific * dep.specific[0]),
            ),
          );
          // 住民税：所得割から調整控除を引き、均等割を加える
          const rb = pick(res.basic, g)[1],
            t = floor1000(g - social - rb - (sp?.[2] ?? 0) - f.general * dep.general[1] - f.specific * dep.specific[1]),
            diff =
              res.diff.basic +
              (f.spouse && g <= TX.spouse.at(-1)[0] ? res.diff.spouse : 0) +
              f.general * res.diff.general +
              f.specific * res.diff.specific,
            adj =
              g > res.adjMaxIncome
                ? 0
                : t <= res.adjBorder
                  ? Math.min(diff, t) * res.adjRate
                  : Math.max((diff - (t - res.adjBorder)) * res.adjRate, res.adjMin),
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
          retirementDeduction = (n) =>
            n <= rd.border ? Math.max(rd.min, rd.perYear * n) : rd.base + rd.perYearAfter * (n - rd.border);
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
              .filter((a) => a.name === "地域手当" && a.endMonth < serviceMonths && a.endMonth - a.startMonth > 6)
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
              let n =
                m < 12 ? Math.floor(((c.entryMonth >= 10 ? R.promotion.lateEntryRaise : c.raise) * m) / 12) : c.raise;
              // 昇給抑制：55歳以降の職員と、1佐（1）（2）欄以上の自衛官は、
              // 勤務成績が「極めて良好」で2号俸、「特に良好」で1号俸、それ以外は昇給しない（施行令第6条の14の2）
              if (age55 || rank <= R.promotion.restrictCol)
                n = R.promotion.restricted.find(([min]) => c.raise >= min)?.[1] ?? 0;
              const options = available(rank);
              level = Math.min(level + n, options[options.length - 1]);
              while (table[level][rank] == null && level > 0) level--;
            }
            // 幹部候補生の任官のように階級と号俸が決まっている昇任は、そのまま当てはめる
            for (const p of c.promotions)
              if (m === p.month) {
                if (p.grade) {
                  const from = c.payOverride && m === c.payOverride.until ? "幹部候補生" : label();
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
              // 教育期間（教育隊・3曹昇任前の教育・幹部候補生学校）は基本給（俸給）だけで、毎月の手当は付けない。
              // 賞与は支給するが、計算の基礎は俸給と階級による加算だけにする
              inEducation = (c.education || []).some(([s, e]) => m >= s && m < e),
              eigai = !inEducation && c.eigaiStart != null && m >= c.eigaiStart && rank >= 12 ? EIGAI : 0,
              // 俸給の特別調整額（管理職）と賞与の管理職加算の割合
              special = inEducation ? 0 : (MANAGER_PAY[c.manager]?.[rank] ?? 0),
              // その月の年度（4月〜翌3月）。地域手当は年度ごとの割合（経過措置）を使う
              ymNow = (c.entryYear || 2026) * 12 + c.entryMonth - 1 + m,
              fyNow = Math.floor(ymNow / 12) - (ymNow % 12 < 3 ? 1 : 0),
              // 年1回まとめて支給する分（指定場所生活調整金）は教育期間でも対象にする
              list = (inEducation ? c.allowances.filter((a) => a.method === "year_end") : c.allowances.concat(guaranteesAt(m))).map((a) =>
                a.area
                  ? { ...a, amount: R.regionalRate(a.area.pref, a.area.name, fyNow) }
                  : // 上位の階級では父母等の扶養手当が減る（施行令第8条の7・第8条の8）
                    a.parents && FUYOU_PARENT[rank] != null
                    ? { ...a, amount: a.amount - a.parents * (AL.calcRates.fuyou.parent - FUYOU_PARENT[rank]) }
                    : a,
              ),
              managerRate = rank <= 1 ? B.generalManagerAdd : special ? (MANAGER_BONUS[c.manager] ?? 0) : 0,
              // 地域手当・広域異動手当の計算の基礎に俸給へ加える額：俸給の特別調整額＋営外手当（扶養手当は手当側で加える）。
              // 自衛官は営外手当も基礎に入る（防衛省給与法第14条による一般職給与法第11条の3・第11条の8の読み替え）
              regionalExtra = special + eigai,
              // 賞与の計算の基礎：俸給＋階級による加算＋管理職加算＋扶養・地域・広域異動手当＋営外手当（勤勉手当は扶養手当を除く）
              added = pay + Math.floor(pay * bonusRate(rank)) + Math.floor(pay * managerRate) + eigai,
              kimatsuBase = added + window.allowanceSimulator.bonusBase(list, pay, m, false, regionalExtra),
              kinbenBase = added + window.allowanceSimulator.bonusBase(list, pay, m, true, regionalExtra);
            let bonus = 0;
            // 入隊は月の初日とみなすので、基準日（6月1日・12月1日）までの在職期間は入隊からの月数になる
            if (month === 6 || month === 12) {
              // 入力した年間月数が法律の合計（4.65か月）と違うときは、同じ比率で増減する
              const scale = c.bonus / B.annualMonths,
                cls = bonusClass(rank, special, c.manager);
              bonus =
                Math.floor(kimatsuBase * B.kimatsuPer[cls] * scale * kimatsuRate(m)) +
                Math.floor(kinbenBase * B.kinbenStandard[cls] * scale * kinbenRate(m, 0));
            }
            const sum = (filter) =>
                window.allowanceSimulator.monthly(list.filter(filter), pay, m, firstPay, regionalExtra),
              allowances = Math.floor(sum(() => true) + eigai + special),
              // 年1回まとめて支給する分（指定場所生活調整金）は、共済掛金では期末手当等と同じに扱う
              lump = sum((a) => a.method === "year_end"),
              ym = (c.entryYear || 2026) * 12 + c.entryMonth - 1 + m;
            monthly.push({
              pay,
              basePay: pay,
              col: rank,
              rank: candidate ? "幹部候補生" : rankNames[rank],
              grade: candidate ? null : level + 1,
              promotions: events.filter((e) => e.month === m),
              bonus,
              allowances,
              lump,
              // 非課税の通勤手当、若年定年退職者給付金の計算に使う扶養手当・営外手当
              nontax: Math.floor(sum((a) => a.name === "通勤手当")),
              fuyou: sum((a) => a.name === "扶養手当"),
              eigai,
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
                far =
                  Math.abs(gradeOf(avg) - gradeOf(cur)) >= KY.revisionGrades ||
                  Math.abs(pensionGrade(avg, ymAt) - pensionGrade(cur, ymAt)) >= KY.revisionGrades;
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
              { it, rt } = salaryTaxes(income, list.reduce((s, x) => s + x.social, 0), y, family);
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
        // 退職手当と若年定年退職者給付金、それぞれの退職所得の税
        function retirement(table, c, monthly) {
          // 任期制自衛官の任期満了の退職手当（防衛省給与法第28条第1項・第5項）：任期ごとに、満了時の俸給日額（月額÷30）×日数。
          // 退職所得として任期ごとに課税する（勤続年数はその任期の年数）
          const terms = (c.ninki?.terms || []).map((t, i) => {
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
          const paidMonths = c.ninki?.terms?.length ? c.ninki.terms.at(-1).end : 0,
            months = monthly.length - paidMonths,
            last = monthly.at(-1),
            P = last.basePay,
            n = Math.floor(months / 12) || (months >= 6 ? 1 : 0),
            // 若年定年退職者給付金の「自衛官として20年以上」は任期制の期間も含めて数える
            nAll = Math.floor(monthly.length / 12),
            teinen = c.retireReason !== "self";
          // 基本額（法第3条〜第5条、附則第6項〜第8項）。35年を超える定年退職は35年として計算し、83.7％を掛ける
          let rate;
          if (!teinen) rate = bandMonths(ART3, n) * (pick(RT.selfReduction, n)?.[1] ?? 1);
          else
            rate = bandMonths(
              n >= RT.art5From ? ART5 : n >= RT.art4From ? ART4 : ART3,
              n >= RT.art5From ? Math.min(n, RT.teinenMaxYears) : n,
            );
          const basic = Math.floor(
            Math.min(P * rate * (teinen || n <= RT.selfAdjustMaxYears ? RT.adjustFactor : 1), P * RT.capMonths),
          );
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
          if (teinen && nAll >= YP.minYears && age < civil) {
            // 俸給月額は3佐の最高号俸の額が上限
            const maxMajor = Math.max(...table.map((row) => row[YP.capCol] ?? 0)),
              Pc = Math.min(P, maxMajor),
              early = Math.max(0, YP.splitAge - age),
              late = civil - Math.max(YP.splitAge, age);
            if (early > 0) {
              const [r1, r2] = yearRate(EARLY_RATE, early);
              let first = Math.floor(Pc * early * YP.earlyMultiplier[0] * r1),
                second = Math.floor(Pc * early * YP.earlyMultiplier[1] * r2);
              // 所得による調整（法第27条の4）：退職の翌年の所得（給与収入の額）で2回目を減らし、上限以上なら1回目の一部を返納
              const I = c.reemployIncome || 0,
                br = bonusRate(last.col),
                base = P + last.fuyou + last.eigai,
                G =
                  base * 12 +
                  Math.floor(base + (P + last.eigai) * br) * YP.kimatsuMonths +
                  Math.floor((P + last.eigai) * (1 + br)) * YP.kinbenMonths,
                L = G - Pc * YP.lowerMultiplier,
                U = G - Pc * YP.upperMultiplier;
              // 再就職の年収ごとの受け取り額のグラフ用（調整前の満額と、調整の境目）
              reemploy = { L, U, G, first, second };
              if (I > L) {
                second = I >= U ? 0 : Math.floor((second * (U - I)) / (U - L));
                if (I > U) first -= I >= G ? first : Math.floor((first * (I - U)) / (G - U));
              }
              payments.push(
                { label: "1回目（退職の翌月ごろ）", amount: first, first: true },
                { label: "2回目（退職の翌々年）", amount: second },
              );
            }
            if (late > 0) {
              const [r1, r2] = yearRate(LATE_RATE, late);
              payments.push(
                { label: `${early > 0 ? "3回目（60歳以後" : "1回目（退職後"}）`, amount: Math.floor(Pc * late * YP.lateMultiplier[0] * r1), first: early === 0 },
                { label: `${early > 0 ? "4回目" : "2回目"}（その翌々年）`, amount: Math.floor(Pc * late * YP.lateMultiplier[1] * r2) },
              );
            }
          }
          // 退職所得の税：退職手当と同じ年に受ける1回目は合わせて退職所得控除を使う。
          // 2回目以降は、前年以前4年内に受けた退職手当等（退職手当と、それまでの給付金）と勤続期間が重なるので、
          // 重なる年数分の控除を引く（所得税法第30条第6項、施行令第70条第1項第2号イ・第2項）。前の退職手当等が
          // その控除額に満たないときは、前の勤続期間を「前の額÷40万円（800万円超は20年＋超えた額÷70万円）」年に縮める。控除は80万円が下限
          const rawDeduction = (y) => (y <= rd.border ? rd.perYear * y : rd.base + rd.perYearAfter * (y - rd.border)),
            firstAmount = allowance + payments.filter((p) => p.first).reduce((s, p) => s + p.amount, 0);
          let received = firstAmount;
          const taxes = [retirementTaxes(firstAmount, n, retirementDeduction(n))].concat(
              payments
                .filter((p) => !p.first)
                .map((p) => {
                  const prevYears =
                      received < rawDeduction(n)
                        ? Math.floor(received <= rd.base ? received / rd.perYear : (received - rd.base) / rd.perYearAfter + rd.border)
                        : n,
                    deduction = Math.max(rd.min, rawDeduction(n) - rawDeduction(Math.min(n, prevYears)));
                  received += p.amount;
                  return retirementTaxes(p.amount, n, deduction);
                }),
            ),
            tax = taxes.reduce((s, t) => s + t.it + t.rt, 0),
            pension = payments.reduce((s, p) => s + p.amount, 0);
          // 任期制から3曹へ昇任した場合は、昇任前に受けた任期満了金も合わせて出す
          return {
            years: n,
            basic,
            adjust,
            allowance: allowance + termTotal,
            terms,
            payments,
            pension,
            civil,
            tax: tax + termTax,
            net: allowance + termTotal + pension - tax - termTax,
            reemploy,
          };
        }
        window.salarySimulatorModel = model;
        // 俸給表はこのページに埋め込んだ PAY_TABLE を使う
        const table = window.PAY_TABLE;
        if (!table) $("simError").textContent = "俸給データの読み込みに失敗しました。";
        // ---- 昇任までの期間の選択肢 ----
        // 最小値は自衛隊法施行規則 別表第七の在職期間（勤務成績が極めて良好な場合の8割短縮は使わない）。
        // 昇任は年1回（3曹は年2回、部内幹部候補生の試験は年1回）なので、その間隔で選ぶ。単位はか月（士）または年
        const range = (from, to, step) =>
          Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
        // 2士→1士・1士→士長は6か月ずつで固定（入力欄は読み取り専用。入隊から約1年で士長）
        // 選択肢・固定値・定年年齢は RULES.promotion から作る（HTMLの初期値はここで上書きする）
        const choices = Object.fromEntries(
          Object.entries(R.promotion.choices).map(([id, [from, to, step, def]]) => [id, { months: range(from, to, step), def }]),
        );
        for (const [id, v] of Object.entries({ ...R.promotion.fixedMonths, ...R.promotion.fixedYears, ...R.promotion.education }))
          if ($(id)) $(id).value = String(v);
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
          input.closest(".unit").replaceWith(select);
        }
        // 予想階級までにたどる昇任（3曹より後）。3尉以上なら部内幹部の経路になる
        function pathTo(target) {
          const e = enlistedPath.findIndex((p) => p.name === target),
            o = officerPath.findIndex((p) => p.name === target);
          return e >= 0 ? enlistedPath.slice(0, e + 1) : o >= 0 ? officerPath.slice(0, o + 1) : [];
        }
        function updateRetirement() {
          const type = $("entryType").value,
            kanko = type.startsWith("kanko"),
            ninkiExit = type === "ninki" && $("ninkiPlan").value !== "sgt";
          // 幹部候補生は3尉以上（院卒は2尉以上）しか選べないようにする
          for (const o of $("targetRank").options)
            o.disabled = kanko && (!o.dataset.officer || (type === "kankoD" && o.value === "3尉"));
          if ($("targetRank").selectedOptions[0].disabled) $("targetRank").value = type === "kankoD" ? "2尉" : "3尉";
          // 幹部候補生は3尉（院卒は2尉）に任官するので、そこまでの昇任の欄は出さない
          const skip = kanko ? (type === "kankoD" ? ["3尉", "2尉"] : ["3尉"]) : [];
          const names = ninkiExit ? [] : pathTo($("targetRank").value).map((p) => p.name).filter((n) => !skip.includes(n));
          for (const el of document.querySelectorAll("[data-step]"))
            el.hidden = !names.includes(el.dataset.step);
          for (const el of document.querySelectorAll("[data-enlisted]")) el.hidden = kanko;
          // 任期制で満了退職する場合は3曹へ昇任しないので、3曹昇任の欄と3曹昇任前の教育の欄も出さない
          if (ninkiExit)
            for (const id of ["stepSgt", "eduSgt"]) $(id).closest("[data-enlisted]").hidden = true;
          $("ninkiPlanWrap").hidden = type !== "ninki";
          $("targetRankWrap").hidden = ninkiExit;
          // 退職の年齢：定年（予想階級）か、任期満了（任期の合計）
          if (ninkiExit) {
            const E = window.RULES.entry,
              k = Number($("ninkiPlan").value),
              months = E.ninkiFirstMonths[$("branch").value] + E.ninkiNextMonths * (k - 1);
            $("retireAge").value = String(Number($("startAge").value) + months / 12);
            $("retireAgeLabel").textContent = "退職の年齢（任期満了）";
          } else {
            $("retireAge").value = $("targetRank").selectedOptions[0].dataset.age;
            $("retireAgeLabel").textContent = "定年年齢（予想階級に連動）";
          }
        }
        // 入隊区分を変えたら、入隊時の年齢をその区分の目安にする
        $("entryType").addEventListener("change", () => {
          $("startAge").value = String(window.RULES.entry.defaultAge[$("entryType").value] ?? 18);
          updateRetirement();
        });
        for (const id of ["targetRank", "ninkiPlan", "branch", "startAge"]) $(id).addEventListener("change", updateRetirement);
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
          let tip = box.querySelector(".chart-tip");
          if (!tip) {
            tip = document.createElement("div");
            tip.className = "chart-tip";
            box.append(tip);
          }
          if (html == null) return tip.classList.remove("show");
          tip.innerHTML = html;
          const bw = box.clientWidth,
            tw = tip.offsetWidth;
          tip.style.left = `${Math.min(Math.max(x - tw / 2, 4), bw - tw - 4)}px`;
          tip.style.top = `${Math.max(4, y - tip.offsetHeight - 12)}px`;
          tip.classList.add("show");
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
            `<defs><linearGradient id="gSal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7a62"/><stop offset="1" stop-color="#15402f"/></linearGradient>` +
            `<linearGradient id="gExt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d59a"/><stop offset="1" stop-color="#c39a54"/></linearGradient>` +
            `<linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f9f86" stop-opacity=".22"/><stop offset="1" stop-color="#3f9f86" stop-opacity="0"/></linearGradient></defs>`;
          for (let i = 0; i <= 4; i++) {
            const v = step * i;
            svg += `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="${i ? "#e6ece7" : "#cfdad2"}" ${i ? 'stroke-dasharray="3 4"' : ""}/>`;
            svg += `<text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7a8a80">${man(v)}</text>`;
          }
          const every = W < 480 ? 10 : 5;
          years.forEach((d, i) => {
            const x = cx(i) - barW / 2,
              yT = y(d.total),
              yS = y(d.salary);
            // 上の角だけ丸めた積み上げ棒
            svg +=
              `<g class="bar" data-i="${i}"><clipPath id="cb${i}"><rect x="${x}" y="${yT}" width="${barW}" height="${y(0) - yT + r}" rx="${r}"/></clipPath>` +
              `<g clip-path="url(#cb${i})"><rect x="${x}" y="${yS}" width="${barW}" height="${y(0) - yS}" fill="url(#gSal)"/>` +
              `<rect x="${x}" y="${yT}" width="${barW}" height="${yS - yT}" fill="url(#gExt)"/></g></g>`;
            // 年齢の目盛り（最初の年は、次の目盛りと重ならないときだけ出す）
            if (d.age % every === 0 || (i === 0 && every - (d.age % every) >= every / 2))
              svg += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#7a8a80">${d.age}歳</text>`;
          });
          // 手取りの線と、その下のうっすらした面
          const pts = years.map((d, i) => `${cx(i).toFixed(1)},${y(d.net).toFixed(1)}`);
          svg +=
            `<path d="M${pts[0]} L${pts.join(" L")} L${cx(years.length - 1)},${y(0)} L${cx(0)},${y(0)} Z" fill="url(#gNet)" pointer-events="none"/>` +
            `<polyline points="${pts.join(" ")}" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>` +
            `<polyline points="${pts.join(" ")}" fill="none" stroke="#2d8c72" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
          // いちばん年収が高い年に目印
          const peakI = years.reduce((a, d, i) => (d.total > years[a].total ? i : a), 0),
            peak = years[peakI];
          svg +=
            `<g pointer-events="none"><circle cx="${cx(peakI)}" cy="${y(peak.total) - 7}" r="3" fill="#c39a54"/>` +
            `<text x="${Math.min(Math.max(cx(peakI), left + 34), W - right - 34)}" y="${y(peak.total) - 13}" text-anchor="middle" font-size="11" font-weight="700" fill="#8a6a2f">最高 ${man(peak.total)}円</text></g>` +
            `<line class="hover-line" x1="0" x2="0" y1="${top}" y2="${y(0)}" stroke="#1c5143" stroke-opacity=".25" stroke-dasharray="3 3" visibility="hidden"/>`;
          box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="年収の推移。${years[0].age}歳の${man(years[0].total)}円から、最高は${peak.age}歳の${man(peak.total)}円">${svg}</svg>`;
          // カーソル・指を乗せた年の内訳を吹き出しで出す
          const el = box.querySelector("svg"),
            line = el.querySelector(".hover-line"),
            bars = el.querySelectorAll(".bar");
          const show = (e) => {
            const rect = el.getBoundingClientRect(),
              px = ((e.clientX - rect.left) / rect.width) * W,
              i = Math.min(years.length - 1, Math.max(0, Math.floor((px - left) / bw)));
            if (px < left) return hide();
            const d = years[i];
            bars.forEach((b, j) => b.classList.toggle("dim", j !== i));
            line.setAttribute("x1", cx(i));
            line.setAttribute("x2", cx(i));
            line.setAttribute("visibility", "visible");
            chartTip(
              box,
              `<b>${d.age}〜${d.age + 1}歳</b><span>${d.ranks}</span>` +
                `<span><i class="sw-extra"></i>推定年収 <em>${fmt(d.total)}</em></span>` +
                `<span><i class="sw-salary"></i>俸給 ${fmt(d.salary)}／賞与・手当 ${fmt(d.extra)}</span>` +
                `<span><i class="sw-net"></i>手取り <em>${fmt(d.net)}</em></span>`,
              ((cx(i) / W) * rect.width) + (el.getBoundingClientRect().left - box.getBoundingClientRect().left),
              (y(d.total) / H) * rect.height + (rect.top - box.getBoundingClientRect().top),
            );
          };
          const hide = () => {
            bars.forEach((b) => b.classList.remove("dim"));
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
            // 年収 x のときに受け取る額（2回目の減額と、1回目の返納を差し引いた額）
            got = (x) =>
              x <= L ? full : x < U ? first + Math.floor((second * (U - x)) / (U - L)) : x < G ? first - Math.floor((first * (x - U)) / (G - U)) : 0;
          $("reemploySummary").innerHTML =
            `退職の翌年の年収が <b>${man(Math.max(0, L))}円以下</b>なら満額（${fmt(full)}）。` +
            `${man(U)}円で2回目が0、${man(G)}円以上で1回目も全額返納になります。`;
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
            xs = [0, Math.max(0, L), U, G, xMax].filter((v, i, s) => v >= 0 && (i === 0 || v > s[i - 1]));
          let svg =
            `<defs><linearGradient id="gRe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c39a54" stop-opacity=".55"/><stop offset="1" stop-color="#c39a54" stop-opacity=".05"/></linearGradient></defs>`;
          for (let i = 0; i <= 4; i++) {
            svg += `<line x1="${left}" x2="${W - right}" y1="${Y(yStep * i)}" y2="${Y(yStep * i)}" stroke="${i ? "#e6ece7" : "#cfdad2"}" ${i ? 'stroke-dasharray="3 4"' : ""}/>`;
            svg += `<text x="${left - 6}" y="${Y(yStep * i) + 4}" text-anchor="end" font-size="11" fill="#7a8a80">${man(yStep * i)}</text>`;
            const xv = (xMax / 4) * i;
            svg += `<text x="${X(xv)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="11" fill="#7a8a80">${man(xv)}円</text>`;
          }
          // 満額の範囲（年収が下限額以下）を薄い緑で塗る
          if (L > 0) svg += `<rect x="${X(0)}" y="${top}" width="${X(L) - X(0)}" height="${plotH}" fill="#2d8c72" fill-opacity=".07"/>`;
          const pts = xs.map((v) => `${X(v).toFixed(1)},${Y(got(v)).toFixed(1)}`);
          svg +=
            `<path d="M${X(0)},${Y(0)} L${pts.join(" L")} L${X(xMax)},${Y(0)} Z" fill="url(#gRe)"/>` +
            `<polyline points="${pts.join(" ")}" fill="none" stroke="#a87b33" stroke-width="2.5" stroke-linejoin="round"/>`;
          // 区切りの縦線と説明
          const mark = (v, label, color, row) =>
            v > 0 && v < xMax
              ? `<line x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${Y(0)}" stroke="${color}" stroke-dasharray="4 3"/>` +
                `<text x="${X(v) + 4}" y="${top + 12 + row * 14}" font-size="11" fill="${color}" font-weight="700">${label}</text>`
              : "";
          svg += mark(L, `満額の上限 ${man(L)}`, "#1f6b55", 0) + mark(U, `2回目0 ${man(U)}`, "#8a6a2f", 1) + mark(G, `全額返納 ${man(G)}`, "#a0453a", 2);
          // 入力した年収の位置
          const ix = Math.min(income, xMax);
          svg +=
            `<circle cx="${X(ix)}" cy="${Y(got(income))}" r="6" fill="#fff" stroke="#1c5143" stroke-width="3"/>` +
            `<line class="hover-line" x1="0" x2="0" y1="${top}" y2="${Y(0)}" stroke="#1c5143" stroke-opacity=".3" visibility="hidden"/>` +
            `<circle class="hover-dot" r="4" fill="#1c5143" visibility="hidden"/>`;
          box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="退職の翌年の年収と若年定年退職者給付金の受け取り額。年収${man(L)}円以下なら満額の${man(full)}円">${svg}</svg>`;
          const el = box.querySelector("svg"),
            line = el.querySelector(".hover-line"),
            dot = el.querySelector(".hover-dot");
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
            "#simulator .sim-grid input:not([readonly]), #simulator .sim-grid select, #branch, #branchAllowances select, #barracksYears, #eigaiStart",
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
          if (s.f.crewUse === "yes" && s.f["ba-maritime-crew"] == null)
            s.f["ba-maritime-crew"] = { destroyer: "43", submarine: "55.5" }[s.f.crewType];
          // 以前の版は「3曹への昇任」を月数（33・48・60）で保存していたので、年に直す
          if (Number(s.f.sergeant) > 20) s.f.sergeant = String(Number(s.f.sergeant) / 12);
          // 以前の版は「入隊から3曹昇任まで」だったので、「士長から3曹昇任まで」に直す
          if (s.f.sergeant != null && s.f.stepSgt == null)
            s.f.stepSgt = String(
              Number(s.f.sergeant) - (Number(s.f.stepPfc ?? 6) + Number(s.f.stepLcpl ?? 6)) / 12,
            );
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
          const url =
            location.href.split("#")[0] + "#sim=" + encodeURIComponent(JSON.stringify(state()));
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
                  `<tr${k === "lifetime" ? ' class="sim-compare-key"' : ""}><th scope="row">${name}</th><td>${fmt(A[k])}</td><td>${fmt(B[k])}</td><td>${diff(k)}</td></tr>`,
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
              reemployIncome: value("reemployIncome") * 10000,
              promotionTable: window.PROMOTION_TABLE,
              // 営舎の外に住み始める月（住まない場合は null）
              eigaiStart:
                $("eigaiStart").value === "none"
                  ? null
                  : $("eigaiStart").value === "sergeant"
                    ? sergeantMonths
                    : value("eigaiStart") * 12,
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
            else if (k.col === 9 && target.value === "3尉")
              entryMessage = "院卒者試験の幹部候補生は2尉に任官するため、予想する将来の階級に2尉以上を選んでください。";
            c.initialRank = 12;
            c.initialGrade = 1;
            c.payOverride = { until: cand, col: k.payCol, grade: k.payGrade };
            c.promotions = [{ month: cand, col: k.col, grade: k.grade }];
            c.education = [[0, cand]];
            const skip = k.col === 9 ? ["3尉", "2尉"] : ["3尉"];
            let m2 = cand;
            for (const p of pathTo(target.value).filter((p) => !skip.includes(p.name))) {
              m2 += Math.round(value(p.step) * 12);
              c.promotions.push({ month: m2, col: p.col ?? value("colClass") });
            }
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
            c.ninki = { terms, exit: plan !== "sgt" };
            if (plan !== "sgt") {
              // 満了で退職する：退職の年齢は任期の合計で決まり、3曹には昇任しない
              c.retireAge = c.startAge + end / 12;
              c.promotions = c.promotions.filter((p) => p.month < end && p.col >= 16);
              c.education = [[0, value("eduRecruit")]];
            }
          }
          $("simError").textContent = "";
          const inputs = [...document.querySelectorAll(".sim-grid input")].filter(
            (el) => !el.closest("[hidden]"),
          );
          const messages = {
            startAge: "入隊時の年齢は16〜60歳の整数で入力してください。",
            initialGrade: "入隊時の2士の号俸は1〜17号俸の整数で入力してください。",
            raise: "毎年の昇給は0〜20号俸の整数で入力してください。",
            bonus: "賞与は金額ではなく年間の月数を入力してください。例：4.65（0〜12か月）",
            entryYear: "入隊した年は2000〜2060年の整数で入力してください。",
            dependents: "扶養親族の人数は0〜10人の整数で入力してください。",
            specificDependents: "特定扶養親族の人数は0〜10人の整数で入力してください。",
            reemployIncome: "退職の翌年の年収見込みは0〜5,000万円で入力してください。",
          };
          const invalid = inputs.find((el) => el.value.trim() === "" || !el.checkValidity());
          // 昇任までの期間などは、入力欄の最小値（法令の最短）〜最大値と単位を使って案内する
          const unit = (el) => el.parentElement.querySelector("span")?.textContent || "";
          let message = invalid
            ? messages[invalid.id] ||
              (invalid.min
                ? `「${invalid.labels[0].textContent}」は${invalid.min}〜${invalid.max}${unit(invalid)}の範囲で入力してください（最小値は法令の最短期間です）。`
                : "入力内容を確認してください。")
            : "";
          if (
            !message &&
            (!Number.isInteger(c.startAge) ||
              !Number.isInteger(c.initialGrade) ||
              !Number.isInteger(c.raise))
          )
            message = "入隊時の年齢、号俸、毎年の昇給は整数で入力してください。";
          // 指定場所生活調整金は営舎内で1年間を通して生活した年だけが対象なので、営外に住む時期と重ねない
          if (!message && c.eigaiStart != null && c.eigaiStart < value("barracksYears") * 12)
            message =
              "「営舎内・艦内で生活する年数」と「営舎の外に住み始める時期」が重なっています。どちらかを変更してください。";
          if (!message && entryMessage) message = entryMessage;
          if (!message && c.retireAge <= c.startAge)
            message = "入隊時の年齢は定年年齢より小さくしてください。";
          if (!message && table[c.initialGrade - 1]?.[18] == null) {
            const max = table.reduce((n, row, i) => (row[18] != null ? i + 1 : n), 0);
            message = `入隊時の2士の号俸は、給料表にある1〜${max}号俸で入力してください。`;
          }
          try {
            if (message) throw Error(message);
            c.allowances = window.allowanceSimulator.read();
            const x = model(table, c);
            const target = $("targetRank").value,
              reached = x.monthly.at(-1).rank,
              lastRank = `${reached}${x.monthly.at(-1).grade ? ` ${x.monthly.at(-1).grade}号俸` : ""}`;
            $("totalIncome").textContent = fmt(x.total);
            $("totalDetail").textContent =
              "いずれも額面の試算。在職中の給与の総額に、退職手当と若年定年退職者給付金は含みません" +
              (reached === target ? "" : `。定年までに${target}へ届かないため、${reached}までで計算しています`);
            $("serviceYears").textContent = Math.round((c.retireAge - c.startAge) * 10) / 10 + "年";
            $("lastRank").textContent = lastRank;
            $("lastYear").textContent = fmt(x.years.at(-1).total);
            $("stickyTotal").textContent = fmt(x.total);
            $("stickyRank").textContent = `${lastRank}・${c.retireAge}歳で${c.ninki?.exit ? "任期満了" : "定年"}`;
            $("simJump").hidden = false;
            // グラフは表示幅に合わせて描くので、先に結果欄を表示する
            $("simResult").hidden = false;
            drawChart(x.years);
            drawReemployChart(x.retire, c.reemployIncome);
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
              kokuminMonths =
                afterPension === "employee" ? 0 : Math.max(0, Math.round((AR.kokuminUntilAge - c.retireAge) * 12)),
              // 免除を受けた月は保険料を払わない（そのぶん老齢基礎年金が減る）
              exemptMonths = afterPension === "exempt" ? kokuminMonths : 0,
              kokumin = Array.from({ length: afterPension === "kokumin" ? kokuminMonths : 0 }, (_, k) => {
                const ym = retireYm + k,
                  fy = Math.floor(ym / 12) - (ym % 12 < 3 ? 1 : 0);
                return AR.kokuminPremium.find(([until]) => fy <= until)[1];
              }).reduce((a, b) => a + b, 0),
              // 退職後の健康保険料（入力した年額 × 年数。任意継続は最長2年）
              healthType = $("afterHealth").value,
              health =
                healthType === "none"
                  ? 0
                  : Math.round(Number($("afterHealthYen").value) * 10000) *
                    Math.min(Number($("afterHealthYears").value), healthType === "nini" ? 2 : Infinity),
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
            const row = (k, v, note = "") =>
              `<tr><th scope="row">${k}</th><td>${v}</td><td>${note}</td></tr>`;
            // 任期満了金（任期制自衛官）の行
            const termRows = (r.terms || [])
              .map((t) => row(t.label, fmt(t.amount), `満了時の俸給月額 ${fmt(t.pay)} ÷ 30 × ${t.days}日（防衛省給与法第28条）`))
              .join("");
            $("retireRows").innerHTML = r.ninkiExit
              ? termRows +
                row("若年定年退職者給付金", "対象外", "任期満了で退職するため（定年退職ではない）") +
                row("退職所得の税（所得税・住民税）", "−" + fmt(r.tax), "任期ごとに、その任期の年数の退職所得控除を使って課税") +
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
                  ? row("退職後の健康保険料", "−" + fmt(health), `${healthType === "nini" ? "共済組合の任意継続" : "国民健康保険"}（入力した年額 × 年数）`)
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
                `勤続${r.years}年${r.terms?.length ? "（任期満了金を受けた任期を除く）" : ""}・${c.retireReason === "self" ? "自己都合" : "定年"}退職。退職日の俸給月額 ${fmt(x.monthly.at(-1).basePay)}`,
              ) +
              row("退職手当（調整額）", fmt(r.adjust), "在職中の階級ごとの調整月額のうち多い順に60か月分") +
              (r.payments.length
                ? r.payments.map((p) => row(`若年定年退職者給付金 ${p.label}`, fmt(p.amount))).join("")
                : row(
                    "若年定年退職者給付金",
                    "対象外",
                    c.retireReason === "self"
                      ? "定年退職ではないため"
                      : x.monthly.length < 240
                        ? "自衛官としての勤務が20年未満のため"
                        : `定年（${c.retireAge}歳）が自衛官以外の職員の定年（${r.civil}歳）より若くないため`,
                  )) +
              row("退職所得の税（所得税・住民税）", "−" + fmt(r.tax), "退職所得控除後の2分の1に課税") +
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
                  ? row("退職後の健康保険料", "−" + fmt(health), `${healthType === "nini" ? "共済組合の任意継続" : "国民健康保険"}（入力した年額 × 年数）`)
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
            $("simError").textContent = e.message;
            $("simResult").hidden = true;
            $("stickyTotal").textContent = "—";
            $("stickyRank").textContent = "入力内容を確認してください";
            $("simJump").hidden = true;
            return false;
          }
        }
        // 共有URLで開いたときは、その条件でシミュレーターを開く
        function openShared() {
          if (load() && !$("simulatorDialog").open) $("simulatorDialog").showModal();
          if ($("simulatorDialog").open) run();
        }
        // 閉じたら入力を初期値に戻す（共有URLの条件も外す）
        const initial = state();
        $("simulatorDialog").addEventListener("close", () => {
          clearTimeout(timer);
          if (location.hash.startsWith("#sim="))
            history.replaceState(null, "", location.href.split("#")[0]);
          apply(JSON.parse(JSON.stringify(initial)));
          $("shareUrl").hidden = true;
          $("shareStatus").textContent = "シミュレーターを閉じると、入力した条件は初期値に戻ります。";
        });
        openShared();
        window.addEventListener("hashchange", openShared);
        // 開いたときや画面幅が変わったときは、グラフを幅に合わせて描き直す
        $("simLaunch").addEventListener("click", () => requestAnimationFrame(() => run()));
        window.addEventListener("resize", schedule);
      })();
