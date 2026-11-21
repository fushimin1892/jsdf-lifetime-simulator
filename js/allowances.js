      (() => {
        "use strict";
        const $ = (id) => document.getElementById(id);
        // 入隊した年月（年×12＋月−1）と、その表示
        const entryYm = () => (Number($("entryYear")?.value) || 2026) * 12 + (Number($("entryMonth")?.value) || 4) - 1,
          ymText = (ym) => `${Math.floor(ym / 12)}年${(ym % 12) + 1}月`,
          monthsText = (n) => (n >= 12 ? `${Math.floor(n / 12)}年` : "") + (n % 12 || n < 12 ? `${n % 12}か月` : "");
        // 手当の一覧・割合・額は window.RULES.allowances（法令の数値のブロック）にまとめてある。
        // 配置手当、指定場所生活調整金、営外手当は自動計算するので、手入力の一覧には入れない（二重計算を防ぐ）
        const A = window.RULES.allowances,
          groups = A.manualGroups,
          branchOnly = A.branchOnly,
          regionalAreas = A.regionalAreas,
          methodOverride = A.methodOverride,
          defaultAmount = A.defaultAmount,
          bonusBaseNames = A.bonusBaseNames;
        // 手当の種類（kind）：行を作ったときに選んだ手当（manualGroups の名前。「その他（自由入力）」は "その他"）。
        // 賞与の基礎・階級の額・地域手当などの判定は kind で行い、手当名（.a-name）は表示にだけ使う
        const OTHER = "その他",
          kindNames = groups.flatMap((g) => g.names).filter((n) => n !== "その他（自由入力）"),
          // 古いURL（kind を保存していない）では、手当名から kind を推定する
          inferKind = (name) => {
            const n = String(name ?? "").trim();
            return kindNames.includes(n) ? n : OTHER;
          },
          toKind = (pick) => (kindNames.includes(pick) ? pick : OTHER),
          kindOf = (a) => a.kind ?? a.name,
          branchNames = { ground: "陸上自衛隊", maritime: "海上自衛隊", air: "航空自衛隊" },
          // 0 以上の整数にする（「条件から計算」の入力の守り）
          count = (x) => Math.max(0, Math.floor(Number(x) || 0));
        let rowSeq = 0;
        const defaultMethod = (name) =>
          methodOverride[name] || groups.find((g) => g.names.includes(name))?.method || "monthly";
        // 「条件から計算」の入力欄と計算（額は RULES.allowances.calcRates）。compute は月額（円）と説明文を返す
        const R = A.calcRates,
          yen = (v) => `${Math.floor(v).toLocaleString("ja-JP")}円`,
          band = (list, km) => list.find(([limit]) => km < limit)[1],
          bandOptions = (list, from) => {
            let lower = from;
            return list.map(([limit]) => {
              const text = limit === Infinity ? `${lower}km以上` : `${lower}km以上${limit}km未満`,
                value = lower;
              lower = limit;
              return [value, text];
            });
          };
        const calcKinds = {
          扶養手当: {
            fields: [
              { k: "child", label: "中学生までの子", max: 10, unit: "人" },
              { k: "teen", label: "高校生〜22歳の年度末までの子", max: 10, unit: "人" },
              { k: "parent", label: "60歳以上の父母・祖父母など", max: 10, unit: "人" },
            ],
            compute: (v) => {
              const c = count(v.child),
                t = count(v.teen),
                p = count(v.parent),
                amount = R.fuyou.child * (c + t) + R.fuyou.teenAdd * t + R.fuyou.parent * p;
              return { amount, text: `月額 ${yen(amount)}（子 ${c + t}人・父母等 ${p}人）` };
            },
            note: "令和8年4月からの額：子1人13,000円（15歳になった後の4月1日から22歳の年度末までの子は5,000円を加算）、父母等1人6,500円。配偶者の扶養手当は令和8年3月で廃止されました。将補（2）欄・1佐（1）欄の間は父母等の分は支給されず、1佐（2）欄の間は1人3,500円になります（施行令第8条の7・第8条の8。階級に合わせて自動で計算します）。子の年齢で額が変わるときは、期間を分けて追加してください。",
          },
          住居手当: {
            fields: [{ k: "rent", label: "家賃（月額）", max: 1000000, unit: "円" }],
            compute: (v) => {
              const rent = count(v.rent),
                h = R.house,
                raw = rent <= h.floor ? 0 : rent <= h.step ? rent - h.floor : h.base + Math.min(h.maxAdd, (rent - h.step) / 2),
                amount = Math.floor(raw / 100) * 100;
              return { amount, text: rent <= h.floor ? "家賃が16,000円以下のため支給されません" : `月額 ${yen(amount)}（上限28,000円）` };
            },
            note: "自分で借りた住宅の家賃が月16,000円を超える場合に支給されます。営内に住んでいる人や、宿舎（有料宿舎）を貸与されている人は対象外です。",
          },
          通勤手当: {
            fields: [
              { k: "pass", label: "電車・バスの定期代（1か月あたり）", max: 1000000, unit: "円" },
              {
                k: "car",
                label: "車・バイクなどの片道距離",
                options: [["none", "使わない"], ["short", "2km未満（駅までなど）"], ...bandOptions(R.commute.car, 2)],
              },
            ],
            // 電車と車を両方使う場合（人事院規則9-24第8条の4）：車の距離が2km以上なら定期代と車の額の両方、
            // 2km未満なら定期代と車の額（最も短い区分の2,000円）の高い方だけ。車だけで2km未満は支給されない
            compute: (v) => {
              const pass = count(v.pass),
                shortCar = R.commute.car[0][1],
                both = v.car !== "none" && v.car !== "short",
                car = both ? band(R.commute.car, Number(v.car)) : v.car === "short" && pass > 0 && shortCar > pass ? shortCar : 0,
                usePass = v.car === "short" ? (pass >= shortCar ? pass : 0) : pass,
                amount = Math.min(R.commute.cap, usePass + car);
              return {
                amount,
                text:
                  v.car === "short"
                    ? pass > 0
                      ? `月額 ${yen(amount)}（車が2km未満のため、定期代と車の額${yen(shortCar)}の高い方）`
                      : "車だけで片道2km未満は支給されません"
                    : `月額 ${yen(amount)}（定期代 ${yen(pass)}＋自動車等 ${yen(car)}${pass + car > R.commute.cap ? "、上限15万円" : ""}）`,
              };
            },
            note: "片道2km未満は原則として支給されません。車などは片道距離の区分ごとの額（2km以上5km未満は2,000円〜100km以上は66,400円）です。電車と車を両方使う場合、車の距離が2km以上なら両方の額を、2km未満なら高い方の額を支給します（人事院規則9-24第8条の4）。合計の上限は月15万円です。非課税として税金の計算から除きます。",
          },
          単身赴任手当: {
            fields: [
              { k: "km", label: "自分の住居から配偶者の住居までの距離", options: bandOptions(R.tanshin.add, 0).map(([v, t]) => [v, v === 0 ? "100km未満" : t]) },
            ],
            compute: (v) => {
              const add = band(R.tanshin.add, Number(v.km)),
                amount = R.tanshin.base + add;
              return { amount, text: `月額 ${yen(amount)}（基本 30,000円＋距離の加算 ${yen(add)}）` };
            },
            note: "異動で住居を移り、やむを得ない事情で配偶者と別居して単身で生活する場合に支給されます（元の住居から通勤するのが困難な場合。通勤距離60km以上が目安）。",
          },
          寒冷地手当: {
            fields: [
              { k: "grade", label: "勤務地の級地", options: [["1", "1級地"], ["2", "2級地"], ["3", "3級地"], ["4", "4級地（指定官署を含む）"]] },
              { k: "household", label: "世帯の区分", options: [["0", "世帯主で扶養親族あり"], ["1", "世帯主で扶養親族なし"], ["2", "世帯主ではない"]] },
              { k: "barracks", label: "営内居住・世帯主でない乗組員", options: [["no", "あてはまらない"], ["yes", "あてはまる（半額）"]] },
            ],
            compute: (v) => {
              const k = R.kanreichi,
                full = k.rates[v.grade]?.[Number(v.household)] ?? 0,
                month = v.barracks === "yes" ? Math.floor(full / 2) : full,
                amount = Math.floor((month * k.months) / 12);
              return { amount, text: `11〜3月に月 ${yen(month)}（年 ${yen(month * k.months)}）→ 12か月にならして月額 ${yen(amount)}` };
            },
            note: "北海道・東北などの指定地域で、11月から3月までの5か月に支給されます。この試算では年額を12か月にならして毎月加えます。営内居住の自衛官と世帯主でない乗組員は、表の額の半分を上限に防衛大臣が定める額のため、半額として計算します。",
          },
        };
        function updateOptions() {
          const select = $("allowanceKind"),
            previous = select.value;
          select.replaceChildren();
          for (const g of groups) {
            // 選んだ所属が対象にならない手当は出さない（すべて出さない分類は分類ごと省く）
            const names = g.names.filter((name) => branchOnly[name]?.includes($("branch").value) ?? true);
            if (!names.length) continue;
            const og = document.createElement("optgroup");
            og.label = g.label;
            for (const name of names) {
              const o = document.createElement("option");
              o.value = name;
              o.textContent = name;
              og.append(o);
            }
            select.append(og);
          }
          if ([...select.options].some((x) => x.value === previous)) select.value = previous;
        }
        // saved：保存・共有から復元するときの値（fields の順。[手当名, 計算方法, 金額, 日数, 開始, 終了, …, kind]）
        // pick：一覧で選んだ手当（「その他（自由入力）」は kind "その他" にする）
        function create(pick = $("allowanceKind").value, saved) {
          const kind = toKind(pick),
            uid = `al${++rowSeq}`,
            container = document.createElement("div");
          container.className = "allowance-item";
          container.dataset.kind = kind;
          container.innerHTML =
            '<div class="allowance-item-head"><strong class="allowance-title"></strong><button type="button" class="allowance-remove">削除</button></div><small class="fixed-note a-branch-note" hidden></small><input class="a-kind" type="hidden"><div class="allowance-fields"><div><label>手当名</label><input class="a-name" type="text" maxlength="80"></div><div class="a-calc-wrap" hidden><div class="a-calc-top"><label>月額の出し方</label><select class="a-calc-mode"><option value="auto">条件から計算</option><option value="manual">金額を直接入力</option></select></div><div class="a-calc"></div><p class="a-calc-out"></p><small class="fixed-note a-calc-note"></small><input class="a-calc-state" type="hidden"></div><div class="a-prefecture-wrap" hidden><label>都道府県（地域手当）</label><select class="a-prefecture"><option value="">都道府県を選択</option></select></div><div class="a-region-wrap" hidden><label>勤務地の区分</label><select class="a-region"></select><div class="a-region-custom-wrap" hidden><label>官署指定の支給割合</label><div class="unit"><input class="a-region-custom" type="number" min="0" max="100" step="any" value="0"><span>％</span></div></div><small class="fixed-note">割合は年度ごとに自動で切り替わります。令和10年3月までは経過措置（人事院規則9-49-57 附則別表第一）の市町村ごとの割合で、表に載っていない地域はこの期間0％です。令和8年度の表は令和8年2月13日の改正後のもので、令和9年度の表はまだ公布されていないため令和8年度と同じとしています。令和10年4月からは人事院規則9-49 別表第一（本則）の割合です。勤務先の官署に別の割合が指定されている場合は「一覧にない勤務地・官署指定割合」を選んで入力してください（その割合は全期間で同じとして計算します）。</small></div><div class="a-distance-wrap" hidden><label>異動前後の官署間距離（広域異動手当）</label><select class="a-distance"></select><small class="fixed-note">現行の法律（一般職給与法第11条の8）の割合です：60km以上300km未満は5％、300km以上は10％。令和8年人事院勧告の8％・16％は、給与法の改正が公布されてから反映します。地域手当と両方支給されるのは「地域手当率＜広域異動手当率」の場合だけで、広域分は差額です。60〜300kmでは地域手当が0％・4％なら広域分も支給（差額5％・1％）、8％以上なら広域分は0％。300km以上では地域手当が0％・4％・8％なら広域分も支給（差額10％・6％・2％）、12％以上なら広域分は0％です。合計率は高い方の率までで、単純加算しません。ここでは地域手当欄の選択率と比較します（異動保障率は未反映）。異動1回ごとに追加し、異動の時期を「支給開始」（1年単位）、「支給終了」を3年ごとの選択肢から選んでください（法律上、1回の異動で支給されるのは3年間です）。支給期間が重なる再異動分は合算せず、高い割合を適用します。</small></div><div class="a-method-fixed-wrap" hidden><label>計算方法（手当ごとに固定）</label><div class="a-method-fixed"></div></div><div class="a-method-wrap"><label>計算方法</label><select class="a-method"><option value="monthly">月額（円）</option><option value="annual">年額（円）</option><option value="daily">日額 × 支給日数・回数</option><option value="percent">俸給月額に対する割合（％）</option></select></div><div class="a-amount-wrap"><label>金額・割合</label><input class="a-amount" type="number" min="0" max="10000000" step="any" value="0"></div><div class="a-days-wrap" hidden><label>月平均の勤務日数</label><input class="a-days" type="number" min="0" max="31" step="any" value="0"></div><div class="a-start-wrap"><label>支給開始（入隊から何年後）</label><input class="a-start" type="number" min="0" max="80" step="0.25" value="0"></div><div class="a-end-wrap"><label>支給終了（入隊から何年後）</label><input class="a-end" type="number" min="0.25" max="200" step="0.25"></div><div class="a-period-wrap" hidden><div class="a-period-box"><label>支給開始（年・月）</label><div class="a-period-row"><div class="unit"><input class="a-start-y" type="number" min="1950" max="2150" step="1" inputmode="numeric"><span>年</span></div><select class="a-start-m" aria-label="支給開始の月"></select></div></div><div class="a-period-box"><label>支給期間</label><div class="a-period-row"><div class="unit"><input class="a-len-y" type="number" min="0" max="80" step="1" inputmode="numeric"><span>年</span></div><select class="a-len-m" aria-label="支給期間の月数"></select></div></div><p class="a-period-note a-period-out"></p></div></div>';
          container.querySelector(".a-kind").value = kind;
          const name = container.querySelector(".a-name"),
            title = () => name.value.trim() || "手当";
          name.value = kind === OTHER ? "その他の手当" : kind;
          container.querySelector(".allowance-title").textContent = name.value;
          // 入力欄のラベル：行ごとに一意の id を振って label と結び、aria-label に手当名を入れる（「住居手当：金額・割合」）。
          // 入れ替わる欄（.a-end）や文言が変わるラベルがあるので、syncKind・手当名の入力のたびに付け直す
          const relabel = () => {
            const t = title();
            for (const label of container.querySelectorAll("label")) {
              let control = label.htmlFor ? container.querySelector(`#${CSS.escape(label.htmlFor)}`) : null;
              if (!control)
                control = [...label.parentElement.querySelectorAll("input:not([type=hidden]), select")].find(
                  (el) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
                );
              if (!control) continue;
              if (!control.id)
                control.id = `${uid}-${control.dataset.k ? "calc-" + control.dataset.k : control.className.split(" ")[0] || "f"}`;
              label.htmlFor = control.id;
              control.dataset.base = label.textContent;
            }
            for (const el of container.querySelectorAll("input:not([type=hidden]), select")) {
              if (el.dataset.base == null) el.dataset.base = el.getAttribute("aria-label") || "";
              el.setAttribute("aria-label", el.dataset.base ? `${t}：${el.dataset.base}` : t);
            }
            container.querySelector(".allowance-remove").setAttribute("aria-label", `${t}を削除`);
          };
          name.addEventListener("input", () => {
            container.querySelector(".allowance-title").textContent = title();
            relabel();
          });
          // 支給終了の初期値は定年まで（広域異動手当は最長3年）
          const serviceYears = Number($("retireAge").value) - Number($("startAge").value);
          container.querySelector(".a-end").value =
            kind === "広域異動手当" ? Math.min(A.wideYears, Math.max(0.25, serviceYears)) : Math.max(1, serviceYears);
          // ---- 支給開始（年・月）と支給期間（年・か月）の欄 ----
          // 計算に使うのは今までどおり .a-start・.a-end（入隊から何年後）。この欄はそれを年月で打てるようにしたもの。
          // 入隊年・月を変えても、入隊からの時期は変えずに年月の表示だけを直す（syncPeriodFrom）
          const periodWrap = container.querySelector(".a-period-wrap"),
            startY = container.querySelector(".a-start-y"),
            startM = container.querySelector(".a-start-m"),
            lenY = container.querySelector(".a-len-y"),
            lenM = container.querySelector(".a-len-m"),
            periodOut = container.querySelector(".a-period-out");
          for (let mo = 1; mo <= 12; mo++) startM.append(new Option(`${mo}月`, String(mo)));
          for (let mo = 0; mo <= 11; mo++) lenM.append(new Option(`${mo}か月`, String(mo)));
          const showPeriod = () => {
            const s = Math.round(Number(container.querySelector(".a-start").value) * 12),
              e = Math.round(Number(container.querySelector(".a-end").value) * 12);
            // 年が空・入隊より前の開始のときは説明文を出さない（エラーは read() が出す）
            if (!/^[0-9]{4}$/.test(startY.value.trim()) || s < 0) {
              periodOut.textContent = "";
              return;
            }
            periodOut.textContent =
              e > s ? `${ymText(entryYm() + s)}から${ymText(entryYm() + e - 1)}まで（${monthsText(e - s)}。${s ? `入隊から${monthsText(s)}後に開始` : "入隊と同時に開始"}）` : "支給期間を1か月以上にしてください。";
          };
          // 年月の欄 → 入隊から何年後（.a-start・.a-end）
          const syncPeriodTo = () => {
            const s = Number(startY.value) * 12 + Number(startM.value) - 1 - entryYm(),
              len = Math.max(0, Math.floor(Number(lenY.value) || 0)) * 12 + Number(lenM.value);
            container.querySelector(".a-start").value = String(s / 12);
            container.querySelector(".a-end").value = String((s + len) / 12);
            showPeriod();
          };
          // 入隊から何年後 → 年月の欄
          const syncPeriodFrom = () => {
            const s = Math.round(Number(container.querySelector(".a-start").value) * 12),
              e = Math.round(Number(container.querySelector(".a-end").value) * 12),
              ym = entryYm() + s;
            startY.value = String(Math.floor(ym / 12));
            startM.value = String((ym % 12) + 1);
            lenY.value = String(Math.max(0, Math.floor((e - s) / 12)));
            lenM.value = String(Math.max(0, (e - s) % 12));
            showPeriod();
          };
          container.syncPeriodFrom = syncPeriodFrom;
          for (const el of [startY, lenY]) el.addEventListener("input", syncPeriodTo);
          for (const el of [startM, lenM]) el.addEventListener("change", syncPeriodTo);
          const method = container.querySelector(".a-method");
          method.value = defaultMethod(kind);
          if (defaultAmount[kind]) container.querySelector(".a-amount").value = defaultAmount[kind];
          // 法令で額が決まっている手当：区分を選ぶと額を入れる（RULES.allowances.specialRates）。
          // 階級で額が決まる区分（RULES.allowances.rankRates。値は "rank:…"）は、計算のときに毎月その階級の額を使う
          const rates = A.specialRates[kind] || [],
            rankOpts = Object.entries(A.rankRates[kind] || {});
          if (rates.length || rankOpts.length) {
            const wrap = document.createElement("div"),
              label = document.createElement("label"),
              pick = document.createElement("select"),
              note = document.createElement("small"),
              amountBox = container.querySelector(".a-amount-wrap"),
              amount = container.querySelector(".a-amount");
            wrap.className = "a-rate-wrap";
            label.textContent = "区分（法令の額）";
            pick.className = "a-rate";
            pick.append(new Option("選んでください（額を直接入力するときはそのまま）", ""));
            for (const [value, o] of rankOpts) pick.append(new Option(o.label, value));
            rates.forEach(([, text, type], i) => pick.append(new Option(type === "max" ? `${text}［上限額］` : text, String(i))));
            note.className = "fixed-note";
            note.textContent = "［上限額］の区分は、法令に上限だけがあり、実際の額は防衛大臣が定めます（上限より低いことがあります）。";
            note.hidden = !rates.some((r) => r[2] === "max");
            pick.id = `a-rate-${container.querySelectorAll("*").length}-${Date.now()}`;
            label.htmlFor = pick.id;
            wrap.append(label, pick, note);
            amountBox.parentNode.insertBefore(wrap, amountBox);
            // 階級で決まる区分のときは、金額の欄を隠す（額は model() で毎月その階級の額にする）
            const sync = () => {
              const byRank = pick.value.startsWith("rank:");
              amountBox.hidden = byRank;
              if (byRank) amount.value = "0";
            };
            pick.addEventListener("change", () => {
              if (pick.value !== "" && !pick.value.startsWith("rank:")) amount.value = rates[Number(pick.value)][0];
              // 「1月◯円（回数は1）」のように月単位の区分は、回数が0なら1にする
              const days = container.querySelector(".a-days");
              if (/回数は1/.test(rates[Number(pick.value)]?.[1] || "") && Number(days.value) === 0) days.value = "1";
              sync();
              amount.dispatchEvent(new Event("input", { bubbles: true }));
            });
            container.syncRate = sync;
            // 区分が1つだけで、上限額でないときは最初から選んでおく
            const only = rankOpts.length + rates.length === 1;
            if (only && (rankOpts.length || rates[0][2] !== "max")) {
              pick.value = rankOpts.length ? rankOpts[0][0] : "0";
              if (!rankOpts.length) amount.value = rates[0][0];
              sync();
            }
          }
          const prefectureWrap = container.querySelector(".a-prefecture-wrap"),
            regionWrap = container.querySelector(".a-region-wrap"),
            distanceWrap = container.querySelector(".a-distance-wrap"),
            methodWrap = container.querySelector(".a-method-wrap"),
            methodFixedWrap = container.querySelector(".a-method-fixed-wrap"),
            methodFixed = container.querySelector(".a-method-fixed"),
            amountWrap = container.querySelector(".a-amount-wrap"),
            regionCustomWrap = container.querySelector(".a-region-custom-wrap"),
            region = container.querySelector(".a-region"),
            prefecture = container.querySelector(".a-prefecture"),
            regionCustom = container.querySelector(".a-region-custom"),
            distance = container.querySelector(".a-distance"),
            amountInput = container.querySelector(".a-amount");
          // 広域異動手当の距離の区分（割合は RULES.allowances.wideRates）
          for (const [rate, text] of A.wideRates) distance.append(new Option(text, String(rate)));
          for (const prefectureName of Object.keys(regionalAreas)) {
            const option = document.createElement("option");
            option.value = prefectureName;
            option.textContent = prefectureName;
            prefecture.append(option);
          }
          // 地域の選択肢：値は市町村名（"" は「その他の地域」）。割合は年度で変わるので、今年度と経過措置後（令和10年度から）を並べて出す
          const RR = window.RULES,
            // 今日の日付（日本時間）の年度。選択肢の「令和N年度◯％」と金額欄の割合に使う
            todayFy = (() => {
              const jst = new Date(Date.now() + 9 * 3600 * 1000),
                y = jst.getUTCFullYear(),
                mo = jst.getUTCMonth() + 1;
              return mo < 4 ? y - 1 : y;
            })(),
            afterFy = RR.allowances.regionalTransition.untilFy + 1,
            reiwa = (fy) => `令和${fy - 2018}年度`,
            rateLabel = (pref, area) =>
              `（${reiwa(todayFy)}${RR.regionalRate(pref, area, todayFy)}％・${reiwa(afterFy)}から${RR.regionalRate(pref, area, afterFy)}％）`;
          const rebuildRegionOptions = (selected = null) => {
            region.replaceChildren();
            const pref = prefecture.value,
              data = regionalAreas[pref];
            if (!data) region.append(new Option("都道府県未選択・不明（0％）", ""));
            else {
              region.append(new Option(`${data.baseLabel || "その他の地域"}${rateLabel(pref, "")}`, ""));
              for (const area of RR.regionalAreaList(pref)) region.append(new Option(`${area}${rateLabel(pref, area)}`, area));
            }
            region.append(new Option("一覧にない勤務地・官署指定割合", "custom"));
            const values = [...region.options].map((o) => o.value);
            if (selected != null && values.includes(String(selected))) region.value = String(selected);
            // 以前の版は割合（％）を保存していたので、経過措置後の割合が同じ最初の地域に読み替える
            else if (data && /^\d+(\.\d+)?$/.test(String(selected ?? "")))
              region.value =
                ["", ...RR.regionalAreaList(pref)].find((a) => RR.regionalRate(pref, a, afterFy) === Number(selected)) ?? "";
            else region.value = "";
          };
          rebuildRegionOptions();
          // 扶養・住居・通勤・単身赴任・寒冷地手当は、条件を選ぶと月額を出す（「金額を直接入力」に切り替えることもできる）
          const calc = calcKinds[kind],
            calcWrap = container.querySelector(".a-calc-wrap"),
            calcMode = container.querySelector(".a-calc-mode"),
            calcBox = container.querySelector(".a-calc"),
            calcOut = container.querySelector(".a-calc-out"),
            calcState = container.querySelector(".a-calc-state"),
            // 手当名を書き換えても、行の種類（kind）が「条件から計算」の手当なら計算を続ける
            calcOn = () => !!calc && calcMode.value === "auto";
          const calcValues = () =>
            Object.fromEntries([...calcBox.querySelectorAll("[data-k]")].map((el) => [el.dataset.k, el.value]));
          const runCalc = () => {
            if (!calc) return;
            const auto = calcMode.value === "auto";
            calcBox.hidden = !auto;
            calcOut.hidden = !auto;
            calcState.value = JSON.stringify({ mode: calcMode.value, v: calcValues() });
            amountInput.readOnly = calcOn();
            if (!calcOn()) return;
            const r = calc.compute(calcValues());
            amountInput.value = String(r.amount);
            calcOut.textContent = r.text;
          };
          if (calc) {
            calcBox.innerHTML = calc.fields
              .map((f) => {
                const input =
                  f.options != null
                    ? `<select data-k="${f.k}">${f.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`
                    : `<div class="unit"><input data-k="${f.k}" type="number" min="0" max="${f.max}" step="1" inputmode="numeric" value="0"><span>${f.unit}</span></div>`;
                return `<div><label>${f.label}</label>${input}</div>`;
              })
              .join("");
            container.querySelector(".a-calc-note").textContent = calc.note;
            calcWrap.addEventListener("input", runCalc);
            calcWrap.addEventListener("change", runCalc);
          }
          const daysWrap = container.querySelector(".a-days-wrap"),
            amountLabel = amountWrap.querySelector("label"),
            daysLabel = daysWrap.querySelector("label");
          const syncKind = () => {
            const regional = kind === "地域手当",
              wide = kind === "広域異動手当",
              fixedMethod = kind !== OTHER;
            prefectureWrap.hidden = !regional;
            regionWrap.hidden = !regional;
            distanceWrap.hidden = !wide;
            regionCustomWrap.hidden = !regional || region.value !== "custom";
            methodWrap.hidden = fixedMethod;
            methodFixedWrap.hidden = !fixedMethod;
            // 階級で額が決まる区分を選んでいるときも、金額の欄は出さない（container.syncRate）
            amountWrap.hidden = regional || wide || (container.querySelector(".a-rate")?.value || "").startsWith("rank:");
            if (fixedMethod) method.value = defaultMethod(kind);
            methodFixed.textContent =
              method.value === "daily"
                ? "日額・1回当たり × 支給日数・回数"
                : method.value === "percent"
                  ? "俸給月額に対する割合"
                  : "月額";
            if (regional)
              amountInput.value =
                region.value === "custom" ? regionCustom.value : String(RR.regionalRate(prefecture.value, region.value, todayFy));
            if (wide) amountInput.value = distance.value;
            if (calc) calcWrap.hidden = false;
            amountInput.readOnly = regional || wide || calcOn();
            // 広域異動手当：支給開始は1年単位、支給終了は3年ごと（3〜36年）の選択にする。
            // 地域手当も支給終了を同じ選択肢にし、定年までの年数（初期値）や保存済みの値は選択肢に足してそのまま使う
            const startInput = container.querySelector(".a-start"),
              endField = container.querySelector(".a-end"),
              endSelect = wide || regional;
            startInput.step = wide ? "1" : regional ? "0.25" : "any";
            // 地域手当・広域異動手当は今までの欄（異動の時期を年単位、終了を3年ごと）。それ以外は年・月で打つ欄
            const plainPeriod = !(wide || regional);
            periodWrap.hidden = !plainPeriod;
            container.querySelector(".a-start-wrap").hidden = plainPeriod;
            container.querySelector(".a-end-wrap").hidden = plainPeriod;
            if (endSelect && endField.tagName === "INPUT") {
              const select = document.createElement("select"),
                current = Number(endField.value);
              select.className = "a-end";
              const step = A.wideYears,
                max = A.wideEndMax,
                years = [];
              for (let y = step; y <= max; y += step) years.push(y);
              const serviceYears = Number($("retireAge").value) - Number($("startAge").value);
              if (regional) {
                if (!years.includes(serviceYears) && serviceYears > 0) years.push(serviceYears);
                if (current > 0 && !years.includes(current)) years.push(current);
                years.sort((a, b) => a - b);
              }
              for (const y of years)
                select.append(new Option(`${y}年後${regional && y === serviceYears ? "（定年まで）" : ""}`, String(y)));
              // 広域異動手当は今の値に最も近い（それ以上の）選択肢、地域手当は今の値のまま
              select.value = regional
                ? String(current > 0 ? current : serviceYears)
                : String(Math.min(max, Math.max(step, Math.ceil(current / step) * step)));
              select.addEventListener("change", syncKind);
              endField.replaceWith(select);
            } else if (!endSelect && endField.tagName === "SELECT") {
              const input = document.createElement("input");
              Object.assign(input, { className: "a-end", type: "number", min: "0", max: "200", step: "any", value: endField.value });
              endField.replaceWith(input);
            }
            if (plainPeriod) {
              container.querySelector(".a-end").min = "0";
              container.querySelector(".a-end").step = "any";
              syncPeriodFrom();
            }
            daysWrap.hidden = method.value !== "daily";
            amountLabel.textContent =
              method.value === "daily"
                ? "日額・1回当たり（円）"
                : method.value === "annual"
                  ? "年額（円）"
                  : method.value === "percent"
                    ? "割合（％）"
                    : "月額（円）";
            daysLabel.textContent = "支給日数・回数";
            relabel();
          };
          // 選んでいる所属が対象にならない手当（branchOnly）は、行に小さく知らせる（計算では read() がエラーにする）
          const branchNote = container.querySelector(".a-branch-note");
          container.syncBranch = () => {
            const only = branchOnly[kind],
              out = only && !only.includes($("branch").value);
            branchNote.hidden = !out;
            branchNote.textContent = out ? `この所属では対象外です（${only.map((b) => branchNames[b]).join("・")}の手当）。` : "";
          };
          container.syncBranch();
          prefecture.addEventListener("change", () => {
            rebuildRegionOptions();
            syncKind();
          });
          region.addEventListener("change", syncKind);
          regionCustom.addEventListener("input", syncKind);
          distance.addEventListener("change", syncKind);
          container.querySelector(".a-start").addEventListener("input", syncKind);
          method.addEventListener("change", syncKind);
          // 削除したら、次の行の削除ボタン（無ければ「＋ 手当を追加」）にフォーカスを移す
          container.querySelector(".allowance-remove").addEventListener("click", () => {
            let next = container.nextElementSibling;
            while (next && !next.classList.contains("allowance-item")) next = next.nextElementSibling;
            container.remove();
            (next?.querySelector(".allowance-remove") || $("addAllowance"))?.focus();
          });
          if (saved) {
            if (saved[9] != null && Object.hasOwn(regionalAreas, saved[9])) {
              prefecture.value = saved[9];
              rebuildRegionOptions(saved[6]);
            } else if (saved[6] === "custom") {
              // 都道府県なしの「官署指定割合」：割合は下の fields で .a-region-custom（8番目）に戻る
              region.value = "custom";
            }
            // 地域（6番目）は上の rebuildRegionOptions で選び直したので、ここでは上書きしない
            fields.forEach((sel, i) => {
              const el = container.querySelector(sel);
              if (saved[i] != null && i !== 6 && sel !== ".a-kind" && el) el.value = saved[i];
            });
            container.syncRate?.();
            container.syncPeriodFrom?.();
            // 旧データは都道府県を保存していないため、保存済み率を「官署指定」に移して引き継ぐ。
            if (saved[9] == null && kind === "地域手当") {
              const oldCustom = saved[6] === "custom" ? saved[8] : null,
                oldRate = String(oldCustom ?? saved[6] ?? saved[2] ?? "0");
              region.value = "custom";
              regionCustom.value = oldRate;
            }
            if (kind === "広域異動手当") {
              // 以前の版の共有URLにある割合は、今の距離区分の割合へ移す（RULES.allowances.wideRateMigration）。
              const oldRate = String(saved[7] ?? saved[2] ?? "0"),
                migrated = A.wideRateMigration[oldRate];
              if (migrated != null) distance.value = String(migrated);
            }
            container.querySelector(".allowance-title").textContent = title();
          }
          if (calc) {
            // 保存した条件を戻す。条件を保存していない以前のデータは、入力済みの金額をそのまま使う
            let s = null;
            try {
              s = JSON.parse(calcState.value || "null");
            } catch {}
            if (saved && !s) calcMode.value = "manual";
            if (s) {
              calcMode.value = s.mode === "manual" ? "manual" : "auto";
              for (const el of calcBox.querySelectorAll("[data-k]"))
                // 選択肢にない値（壊れた・古いURL）は戻さない
                if (s.v?.[el.dataset.k] != null && (el.tagName !== "SELECT" || [...el.options].some((o) => o.value === String(s.v[el.dataset.k]))))
                  el.value = s.v[el.dataset.k];
            }
            runCalc();
          }
          syncKind();
          $("allowanceList").append(container);
          if (!saved) name.focus();
        }
        // 11番目の .a-rate（法令の額の区分）は、区分のある手当だけにある
        // 13番目の .a-kind は手当の種類（行を作ったときに選んだ手当）。古いURLに無いときは手当名から推定する
        const fields = [".a-name", ".a-method", ".a-amount", ".a-days", ".a-start", ".a-end", ".a-region", ".a-distance", ".a-region-custom", ".a-prefecture", ".a-calc-state", ".a-rate", ".a-kind"];
        // 追加した手当の入力値をそのまま取り出す（保存・共有用）
        function dump() {
          return [...document.querySelectorAll(".allowance-item")].map((row) =>
            fields.map((sel) => row.querySelector(sel)?.value ?? null),
          );
        }
        function restore(list) {
          $("allowanceList").replaceChildren();
          for (const saved of Array.isArray(list) ? list : [])
            if (Array.isArray(saved))
              create(saved[12] != null && (kindNames.includes(saved[12]) || saved[12] === OTHER) ? saved[12] : inferKind(saved[0]), saved);
        }
        // 扶養手当の行で「条件から計算」を使っているときの父母等の人数（金額を直接入力しているときは0）
        function calcParents(row) {
          try {
            const s = JSON.parse(row.querySelector(".a-calc-state")?.value || "null");
            return s?.mode === "auto" ? count(s.v?.parent) : 0;
          } catch {
            return 0;
          }
        }
        // 0〜max の数か（readOnly の欄は checkValidity が効かないので、数値で確かめる）
        function inRange(input) {
          const v = input.value.trim(),
            n = Number(v);
          if (!v || !Number.isFinite(n)) return false;
          if (input.min !== "" && n < Number(input.min)) return false;
          if (input.max !== "" && n > Number(input.max)) return false;
          return input.readOnly || input.checkValidity();
        }
        function read() {
          const rows = [...document.querySelectorAll(".allowance-item")];
          // 前回のエラーの印を外す
          for (const row of rows) {
            row.classList.remove("a-error");
            for (const el of row.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
          }
          // エラーのある行に印（class "a-error"・aria-invalid）を付けて知らせる
          const fail = (list, message) => {
            for (const row of list) {
              row.classList.add("a-error");
              for (const el of row.querySelectorAll(
                ".a-period-wrap:not([hidden]) input, .a-start-wrap:not([hidden]) .a-start, .a-end-wrap:not([hidden]) .a-end",
              ))
                el.setAttribute("aria-invalid", "true");
            }
            return Error(message);
          };
          const branch = $("branch").value;
          const manual = rows.map((row, index) => {
            const val = (sel) => row.querySelector(sel).value.trim(),
              num = (sel) => Number(val(sel));
            // 判定は行の種類（kind）で行う。手当名は表示とエラーの文にだけ使う
            const kind = row.dataset.kind || inferKind(val(".a-name")),
              regional = kind === "地域手当",
              wide = kind === "広域異動手当";
            let name = val(".a-name"),
              method = val(".a-method"),
              amount = regional
                ? val(".a-region") === "custom"
                  ? num(".a-region-custom")
                  : num(".a-amount")
                : wide
                  ? num(".a-distance")
                  : num(".a-amount"),
              days = num(".a-days"),
              start = num(".a-start"),
              end = num(".a-end");
            if (!name) throw fail([row], `${index + 1}件目の手当名を入力してください。`);
            // 所属に無い手当（航海手当・南極手当など）が、所属を変えたあとに残っていたら知らせる
            const only = branchOnly[kind];
            if (only && !only.includes(branch))
              throw fail(
                [row],
                `「${name}」は${only.map((b) => branchNames[b]).join("・")}の手当です。所属を変えたときは、この手当を削除してください。`,
              );
            // 「条件から計算」の欄：0〜上限の整数か（金額の欄は readOnly なので checkValidity では確かめられない）
            const calcWrap = row.querySelector(".a-calc-wrap");
            if (calcWrap && !calcWrap.hidden && row.querySelector(".a-calc-mode").value === "auto")
              for (const input of row.querySelectorAll(".a-calc input[data-k]")) {
                const v = input.value.trim(),
                  max = Number(input.max);
                if (!/^[0-9]+$/.test(v) || Number(v) > max)
                  throw fail(
                    [row],
                    `「${name}」の${input.dataset.base || "入力"}は0〜${max.toLocaleString("ja-JP")}の整数で入力してください。`,
                  );
              }
            // 年・月で打つ欄（地域手当・広域異動手当以外）：入隊より前・期間0か月を、わかる言葉で知らせる
            if (!row.querySelector(".a-period-wrap").hidden) {
              const sm = Math.round(start * 12),
                em = Math.round(end * 12);
              if (!val(".a-start-y") || !/^[0-9]{4}$/.test(val(".a-start-y")))
                throw fail([row], `「${name}」の支給開始の年を西暦4けたで入力してください。`);
              if (sm < 0) throw fail([row], `「${name}」の支給開始（${ymText(entryYm() + sm)}）が入隊（${ymText(entryYm())}）より前です。`);
              if (em <= sm) throw fail([row], `「${name}」の支給期間を1か月以上にしてください。`);
              if (!/^[0-9]+$/.test(val(".a-len-y"))) throw fail([row], `「${name}」の支給期間の年は0以上の整数で入力してください。`);
              if (Number(val(".a-len-y")) > 80) throw fail([row], `「${name}」の支給期間は80年以内で入力してください。`);
            }
            // 支給開始が退職より後だと、計算に何も入らない。黙って0円にせず、行に小さく知らせる（計算は止めない。
            // 任期制などに切り替えたときに、前に足した手当が退職後になることがあるため）
            const serviceMonths = Math.round((Number($("retireAge").value) - Number($("startAge").value)) * 12);
            let afterNote = row.querySelector(".a-after-note");
            if (serviceMonths > 0 && Math.round(start * 12) >= serviceMonths) {
              if (!afterNote) {
                afterNote = document.createElement("small");
                afterNote.className = "a-after-note";
                afterNote.setAttribute("role", "status");
                row.querySelector(".allowance-fields").append(afterNote);
              }
              afterNote.textContent = `支給開始（${ymText(entryYm() + Math.round(start * 12))}）が退職（${ymText(entryYm() + serviceMonths - 1)}末）より後のため、この手当は計算に入りません。`;
            } else afterNote?.remove();
            // 管理職員特別勤務手当は、俸給の特別調整額を受ける管理職の手当（一般職給与法第19条の3）
            if (kind === "管理職員特別勤務手当" && $("manager").value === "none")
              throw fail([row], `「${name}」は、俸給の特別調整額を受ける管理職の手当です。「管理職」の欄で特別調整額の種別を選んでください。`);
            for (const sel of [
              ".a-amount",
              ".a-start",
              ".a-end",
              ...(regional && val(".a-region") === "custom" ? [".a-region-custom"] : []),
              ...(method === "daily" ? [".a-days"] : []),
            ]) {
              const input = row.querySelector(sel);
              if (!inRange(input)) {
                const what = { ".a-amount": "金額・割合", ".a-start": "支給開始", ".a-end": "支給終了", ".a-region-custom": "官署指定の割合", ".a-days": "支給日数・回数" }[sel];
                const v = Number(input.value);
                const why = !input.value.trim()
                  ? "が空欄です"
                  : input.min !== "" && v < Number(input.min)
                    ? `は${input.min}以上にしてください`
                    : input.max !== "" && v > Number(input.max)
                      ? `は${Number(input.max).toLocaleString("ja-JP")}以下にしてください`
                      : input.validity?.stepMismatch
                        ? `は${input.step === "1" ? "1年" : input.step === "0.25" ? "0.25年（3か月）" : input.step}単位にしてください`
                        : "を確かめてください";
                throw fail([row], `「${name}」の${what}${why}。`);
              }
            }
            if (start >= end) throw fail([row], `「${name}」の支給終了は開始より後にしてください。`);
            if (method === "percent" && amount > 100) throw fail([row], `「${name}」の割合は0〜100％で入力してください。`);
            const rateValue = row.querySelector(".a-rate")?.value ?? "",
              // 階級で額が決まる区分（本府省業務調整手当・航海手当）を選んだときは、列番号ごとの額の表を渡す
              rankTable = A.rankRates[kind]?.[rateValue]?.byCol,
              // 「1月に支給する額は◯円を超えない」区分（specialRates の4番目の値）
              monthMax = /^[0-9]+$/.test(rateValue) ? A.specialRates[kind]?.[Number(rateValue)]?.[3] : undefined;
            // 地域手当で地域を選んだ場合は、割合を年度ごとに決める（model() で月ごとに RULES.regionalRate を引く）
            const area =
              regional && val(".a-region") !== "custom"
                ? { pref: val(".a-prefecture"), name: row.querySelector(".a-region").value }
                : null;
            return {
              name,
              kind,
              method,
              amount,
              days,
              startMonth: Math.round(start * 12),
              endMonth: Math.round(end * 12),
              bonusBase: bonusBaseNames.includes(kind),
              // 扶養手当を「条件から計算」したときの父母等の人数（上位の階級で額が変わるので model() で月ごとに直す）
              ...(kind === "扶養手当" ? { parents: calcParents(row) } : {}),
              ...(area ? { area } : {}),
              ...(rankTable ? { rankTable } : {}),
              ...(method === "daily" && monthMax ? { monthMax } : {}),
            };
          });
          // 同じ種類の手当の支給期間の重なり。区分（.a-rate）が空・無い行は、同じ種類のすべての行と確かめる
          // （区分どうしが違う行の組だけを除く）。地域手当・広域異動手当は月ごとに1つを選ぶので除く
          manual.forEach((a, i) => {
            if (a.kind === "地域手当" || a.kind === "広域異動手当") return;
            const ra = rows[i].querySelector(".a-rate")?.value ?? "";
            for (let j = 0; j < i; j++) {
              const b = manual[j],
                rb = rows[j].querySelector(".a-rate")?.value ?? "";
              if (b.kind !== a.kind || (ra !== "" && rb !== "" && ra !== rb)) continue;
              // 「その他（自由入力）」は名前が違えば別の手当なので、同じ名前どうしだけを比べる
              if (a.kind === "その他" && a.name.trim() !== b.name.trim()) continue;
              if (a.startMonth < b.endMonth && b.startMonth < a.endMonth) {
                const from = Math.max(a.startMonth, b.startMonth),
                  to = Math.min(a.endMonth, b.endMonth) - 1;
                throw fail(
                  [rows[j], rows[i]],
                  `「${a.name}」の${j + 1}件目と${i + 1}件目の支給期間が重なっています（${ymText(entryYm() + from)}〜${ymText(entryYm() + to)}）。途中で止まる・また始まる手当は、期間が重ならないように分けて追加してください。`,
                );
              }
            }
          });
          const auto = [];
          for (const key of branchAllowances[$("branch").value]) {
            const a = placement[key],
              v = $(`ba-${$("branch").value}-${key}`).value;
            // 値が「first:割合」なら、その選択肢だけ階級の最低号俸に掛ける（乗組手当の「その他の乗組員」）
            const [base, rate] = v.includes(":") ? v.split(":") : [a.base, v];
            if (v !== "none")
              auto.push({
                name: a.name,
                method: base === "pay" ? "percent" : "percentFirst",
                amount: Number(rate),
                startMonth: 0,
                endMonth: 960,
                // 配置手当（教育期間中はほかの手当と同じく支給しない。model() で判定）
                placement: true,
              });
          }
          const years = Number($("barracksYears").value);
          if (years > 0)
            auto.push({
              name: "指定場所生活調整金",
              method: "year_end",
              amount: A.barracksBonus,
              startMonth: 0,
              endMonth: years * 12,
            });
          return auto.concat(manual);
        }
        // 地域手当・広域異動手当は、俸給＋俸給の特別調整額＋扶養手当（自衛官は営外手当も）に割合を掛ける
        // （一般職給与法第11条の3・第11条の8、防衛省給与法第14条の読み替え）。special には特別調整額＋営外手当が入る
        const regionalNames = ["地域手当", "広域異動手当"];
        // 1つの手当のその月の額。firstPay：その階級の最低号俸の額（配置手当の計算に使う）。
        // extra：地域手当などの計算の基礎に加える額（俸給の特別調整額＋扶養手当）
        function amountOf(a, pay, month, firstPay, extra = 0) {
          if (month < a.startMonth || month >= a.endMonth) return 0;
          switch (a.method) {
            case "monthly":
              return Math.floor(a.amount);
            case "annual":
              return Math.floor(a.amount / 12);
            case "daily": {
              // 「1月に支給する額は◯円を超えない」区分は、その額までにする（施行令 別表第五）
              const v = Math.floor(a.amount * a.days);
              return a.monthMax ? Math.min(v, a.monthMax) : v;
            }
            case "percent":
              return Math.floor(((pay + (regionalNames.includes(kindOf(a)) ? extra : 0)) * a.amount) / 100);
            case "percentFirst":
              return Math.floor((firstPay * a.amount) / 100);
            case "year_end":
              return month % 12 === 11 ? a.amount : 0;
            default:
              throw Error("手当の計算方法を確認してください。");
          }
        }
        // 地域手当などの計算の基礎に加える額：俸給の特別調整額（special）＋その月の扶養手当
        const extraBase = (list, pay, month, special) =>
          special +
          (list || [])
            .filter((a) => kindOf(a) === "扶養手当")
            .reduce((sum, a) => sum + amountOf(a, pay, month), 0);
        function combinedTotal(list, pay, month, firstPay, extra, include = () => true) {
          const rows = (list || []).filter(include),
            regional = rows.filter((a) => kindOf(a) === "地域手当"),
            wide = rows.filter((a) => kindOf(a) === "広域異動手当"),
            other = rows.filter((a) => !regional.includes(a) && !wide.includes(a));
          // 地域手当は各月に有効な勤務地を1つだけ採用（複数登録時は直近の開始分）。
          // 異動保障（guarantee）の割合の方が高い月は、保障の割合で支給する
          const activeRegional = regional
            .filter((a) => !a.guarantee && month >= a.startMonth && month < a.endMonth)
            .sort((a, b) => b.startMonth - a.startMonth);
          const regionalAmount = Math.max(
              activeRegional.length ? amountOf(activeRegional[0], pay, month, firstPay, extra) : 0,
              ...regional.filter((a) => a.guarantee).map((a) => amountOf(a, pay, month, firstPay, extra)),
            ),
            // 再異動が支給期間中に発生した場合、旧・新の割合を足さず規則に沿って高い方を適用する。
            activeWide = wide.filter((a) => month >= a.startMonth && month < a.endMonth),
            wideAmount = activeWide.reduce(
              (max, a) => Math.max(max, amountOf(a, pay, month, firstPay, extra)),
              0,
            );
          // 広域異動手当は地域手当の支給割合を差し引いた額を加える。
          const adjustedWide = Math.max(0, wideAmount - regionalAmount);
          return other.reduce((sum, a) => sum + amountOf(a, pay, month, firstPay, extra), 0) + regionalAmount + adjustedWide;
        }
        function monthly(list, pay, month, firstPay, special = 0) {
          const extra = extraBase(list, pay, month, special);
          return combinedTotal(list, pay, month, firstPay, extra);
        }
        // 賞与の計算の基礎に含める手当のその月の額。
        // 期末手当は扶養手当・地域手当・広域異動手当、勤勉手当は扶養手当を除く（kinben = true）
        function bonusBase(list, pay, month, kinben = false, special = 0) {
          const extra = extraBase(list, pay, month, special);
          return combinedTotal(
            list,
            pay,
            month,
            0,
            extra,
            (a) => a.bonusBase && !(kinben && kindOf(a) === "扶養手当"),
          );
        }
        window.allowanceSimulator = {
          read,
          monthly,
          bonusBase,
          dump,
          restore,
          updateBranch: () => updateBranch(),
        };
        // ---- 所属ごとの配置手当（施行令第12条）。割合は RULES.allowances.placement ----
        const placement = A.placement,
          branchAllowances = A.branchAllowances;
        // 3つの所属の選択欄をすべて作り、選んだ所属の分だけ表示する（所属を切り替えても選択を覚えておく）
        for (const [branch, keys] of Object.entries(branchAllowances))
          for (const key of keys) {
            const a = placement[key],
              id = `ba-${branch}-${key}`,
              wrap = document.createElement("div"),
              label = document.createElement("label"),
              select = document.createElement("select");
            wrap.dataset.branch = branch;
            label.htmlFor = id;
            label.textContent = a.name;
            select.id = id;
            for (const [value, text] of [["none", "適用しない・不明"], ...a.options]) {
              const o = document.createElement("option");
              o.value = value;
              o.textContent = text;
              select.append(o);
            }
            wrap.append(label, select);
            $("branchAllowances").append(wrap);
          }
        function updateBranch() {
          for (const el of $("branchAllowances").children)
            el.hidden = el.dataset.branch !== $("branch").value;
          updateOptions();
          for (const it of document.querySelectorAll(".allowance-item")) it.syncBranch?.();
        }
        $("branch").addEventListener("change", updateBranch);
        $("addAllowance").addEventListener("click", () => create());
        // 入隊年・月を変えたら、入隊からの時期はそのままで、支給開始・終了の年月の表示を直す
        for (const id of ["entryYear", "entryMonth"])
          for (const type of ["input", "change"])
            $(id)?.addEventListener(type, () => {
              for (const it of document.querySelectorAll(".allowance-item")) it.syncPeriodFrom?.();
            });
        updateBranch();
      })();
