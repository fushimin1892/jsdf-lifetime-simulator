      (() => {
        "use strict";
        const $ = (id) => document.getElementById(id);
        // 手当の一覧・割合・額は window.RULES.allowances（法令の数値のブロック）にまとめてある。
        // 配置手当、指定場所生活調整金、営外手当は自動計算するので、手入力の一覧には入れない（二重計算を防ぐ）
        const A = window.RULES.allowances,
          groups = A.manualGroups,
          branchOnly = A.branchOnly,
          regionalAreas = A.regionalAreas,
          methodOverride = A.methodOverride,
          defaultAmount = A.defaultAmount,
          bonusBaseNames = A.bonusBaseNames;
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
              const c = Number(v.child) || 0,
                t = Number(v.teen) || 0,
                p = Number(v.parent) || 0,
                amount = R.fuyou.child * (c + t) + R.fuyou.teenAdd * t + R.fuyou.parent * p;
              return { amount, text: `月額 ${yen(amount)}（子 ${c + t}人・父母等 ${p}人）` };
            },
            note: "令和8年4月からの額：子1人13,000円（15歳になった後の4月1日から22歳の年度末までの子は5,000円を加算）、父母等1人6,500円。配偶者の扶養手当は令和8年3月で廃止されました。将補（2）欄・1佐（1）欄の間は父母等の分は支給されず、1佐（2）欄の間は1人3,500円になります（施行令第8条の7・第8条の8。階級に合わせて自動で計算します）。子の年齢で額が変わるときは、期間を分けて追加してください。",
          },
          住居手当: {
            fields: [{ k: "rent", label: "家賃（月額）", max: 1000000, unit: "円" }],
            compute: (v) => {
              const rent = Number(v.rent) || 0,
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
              const pass = Math.floor(Number(v.pass) || 0),
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
                full = k.rates[v.grade][Number(v.household)],
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
        // saved：保存・共有から復元するときの値 [手当名, 計算方法, 金額, 日数, 開始, 終了]
        function create(kind = $("allowanceKind").value, saved) {
          const container = document.createElement("div");
          container.className = "allowance-item";
          container.innerHTML =
            '<div class="allowance-item-head"><strong class="allowance-title"></strong><button type="button" class="allowance-remove">削除</button></div><div class="allowance-fields"><div><label>手当名</label><input class="a-name" type="text" maxlength="80"></div><div class="a-calc-wrap" hidden><div class="a-calc-top"><label>月額の出し方</label><select class="a-calc-mode"><option value="auto">条件から計算</option><option value="manual">金額を直接入力</option></select></div><div class="a-calc"></div><p class="a-calc-out"></p><small class="fixed-note a-calc-note"></small><input class="a-calc-state" type="hidden"></div><div class="a-prefecture-wrap" hidden><label>都道府県（地域手当）</label><select class="a-prefecture"><option value="">都道府県を選択</option></select></div><div class="a-region-wrap" hidden><label>勤務地の区分</label><select class="a-region"></select><div class="a-region-custom-wrap" hidden><label>官署指定の支給割合</label><div class="unit"><input class="a-region-custom" type="number" min="0" max="100" step="any" value="0"><span>％</span></div></div><small class="fixed-note">割合は年度ごとに自動で切り替わります。令和10年3月までは経過措置（人事院規則9-49-57 附則別表第一）の市町村ごとの割合で、表に載っていない地域はこの期間0％です。令和8年度の表は令和8年2月13日の改正後のもので、令和9年度の表はまだ公布されていないため令和8年度と同じとしています。令和10年4月からは人事院規則9-49 別表第一（本則）の割合です。勤務先の官署に別の割合が指定されている場合は「一覧にない勤務地・官署指定割合」を選んで入力してください（その割合は全期間で同じとして計算します）。</small></div><div class="a-distance-wrap" hidden><label>異動前後の官署間距離（広域異動手当）</label><select class="a-distance"></select><small class="fixed-note">令和8年人事院勧告の改定割合（給与法の改正が成立すれば令和8年4月にさかのぼって実施。現行の法律は5％・10％）：60km以上300km未満は8％、300km以上は16％です。地域手当と両方支給されるのは「地域手当率＜広域異動手当率」の場合だけで、広域分は差額です。60〜300kmでは地域手当が0％・4％なら広域分も支給（差額8％・4％）、8％以上なら広域分は0％。300km以上では地域手当が0％・4％・8％・12％なら広域分も支給（差額16％・12％・8％・4％）、16％以上なら広域分は0％です。合計率は高い方の率までで、単純加算しません。ここでは地域手当欄の選択率と比較します（異動保障率は未反映）。異動1回ごとに追加し、異動の時期を「支給開始」（1年単位）、「支給終了」を3年ごとの選択肢から選んでください（法律上、1回の異動で支給されるのは3年間です）。支給期間が重なる再異動分は合算せず、高い割合を適用します。</small></div><div class="a-method-fixed-wrap" hidden><label>計算方法（手当ごとに固定）</label><div class="a-method-fixed"></div></div><div class="a-method-wrap"><label>計算方法</label><select class="a-method"><option value="monthly">月額（円）</option><option value="annual">年額（円）</option><option value="daily">日額 × 支給日数・回数</option><option value="percent">俸給月額に対する割合（％）</option></select></div><div class="a-amount-wrap"><label>金額・割合</label><input class="a-amount" type="number" min="0" max="10000000" step="any" value="0"></div><div class="a-days-wrap" hidden><label>月平均の勤務日数</label><input class="a-days" type="number" min="0" max="31" step="any" value="0"></div><div><label>支給開始（入隊から何年後）</label><input class="a-start" type="number" min="0" max="80" step="0.25" value="0"></div><div><label>支給終了（入隊から何年後）</label><input class="a-end" type="number" min="0.25" max="80" step="0.25"></div></div>';
          const name = container.querySelector(".a-name");
          name.value = kind === "その他（自由入力）" ? "その他の手当" : kind;
          container.querySelector(".allowance-title").textContent = name.value;
          name.addEventListener(
            "input",
            () => (container.querySelector(".allowance-title").textContent = name.value || "手当"),
          );
          // 支給終了の初期値は定年まで（広域異動手当は最長3年）
          const serviceYears = Number($("retireAge").value) - Number($("startAge").value);
          container.querySelector(".a-end").value =
            kind === "広域異動手当" ? Math.min(A.wideYears, Math.max(0.25, serviceYears)) : Math.max(1, serviceYears);
          const method = container.querySelector(".a-method");
          method.value = defaultMethod(kind);
          if (defaultAmount[kind]) container.querySelector(".a-amount").value = defaultAmount[kind];
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
            todayFy = (() => {
              const [y, mo] = RR.checkedOn.split("-").map(Number);
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
            calcOn = () => !!calc && calcMode.value === "auto" && name.value === kind;
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
                    : `<div class="unit"><input data-k="${f.k}" type="number" min="0" max="${f.max}" step="1" value="0"><span>${f.unit}</span></div>`;
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
            const regional = name.value === "地域手当",
              wide = name.value === "広域異動手当",
              fixedMethod = groups.some((g) => g.names.includes(name.value)) && name.value !== "その他（自由入力）";
            prefectureWrap.hidden = !regional;
            regionWrap.hidden = !regional;
            distanceWrap.hidden = !wide;
            regionCustomWrap.hidden = !regional || region.value !== "custom";
            methodWrap.hidden = fixedMethod;
            methodFixedWrap.hidden = !fixedMethod;
            amountWrap.hidden = regional || wide;
            if (fixedMethod) method.value = defaultMethod(name.value);
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
            if (calc) calcWrap.hidden = name.value !== kind;
            amountInput.readOnly = regional || wide || calcOn();
            // 広域異動手当：支給開始は1年単位、支給終了は3年ごと（3〜36年）の選択にする。
            // 地域手当も支給終了を同じ選択肢にし、定年までの年数（初期値）や保存済みの値は選択肢に足してそのまま使う
            const startInput = container.querySelector(".a-start"),
              endField = container.querySelector(".a-end"),
              endSelect = wide || regional;
            startInput.step = wide ? "1" : "0.25";
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
              Object.assign(input, { className: "a-end", type: "number", min: "0.25", max: "80", step: "0.25", value: endField.value });
              endField.replaceWith(input);
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
          };
          prefecture.addEventListener("change", () => {
            rebuildRegionOptions();
            syncKind();
          });
          region.addEventListener("change", syncKind);
          regionCustom.addEventListener("input", syncKind);
          distance.addEventListener("change", syncKind);
          container.querySelector(".a-start").addEventListener("input", syncKind);
          name.addEventListener("input", syncKind);
          method.addEventListener("change", syncKind);
          container
            .querySelector(".allowance-remove")
            .addEventListener("click", () => container.remove());
          if (saved) {
            if (saved[9] != null && Object.hasOwn(regionalAreas, saved[9])) {
              prefecture.value = saved[9];
              rebuildRegionOptions(saved[6]);
            }
            // 地域（6番目）は上の rebuildRegionOptions で選び直したので、ここでは上書きしない
            fields.forEach((sel, i) => {
              if (saved[i] != null && i !== 6) container.querySelector(sel).value = saved[i];
            });
            // 旧データは都道府県を保存していないため、保存済み率を「官署指定」に移して引き継ぐ。
            if (saved[9] == null && name.value === "地域手当") {
              const oldCustom = saved[6] === "custom" ? saved[8] : null,
                oldRate = String(oldCustom ?? saved[6] ?? saved[2] ?? "0");
              region.value = "custom";
              regionCustom.value = oldRate;
            }
            if (name.value === "広域異動手当") {
              // 保存済みデータの旧割合（5％・10％）は、新しい距離区分の割合へ移行する。
              const oldRate = String(saved[7] ?? saved[2] ?? "0"),
                migrated = A.wideRateMigration[oldRate];
              if (migrated != null) distance.value = String(migrated);
            }
            container.querySelector(".allowance-title").textContent = name.value || "手当";
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
                if (s.v?.[el.dataset.k] != null) el.value = s.v[el.dataset.k];
            }
            runCalc();
          }
          syncKind();
          $("allowanceList").append(container);
          if (!saved) name.focus();
        }
        const fields = [".a-name", ".a-method", ".a-amount", ".a-days", ".a-start", ".a-end", ".a-region", ".a-distance", ".a-region-custom", ".a-prefecture", ".a-calc-state"];
        // 追加した手当の入力値をそのまま取り出す（保存・共有用）
        function dump() {
          return [...document.querySelectorAll(".allowance-item")].map((row) =>
            fields.map((sel) => row.querySelector(sel).value),
          );
        }
        function restore(list) {
          $("allowanceList").replaceChildren();
          for (const saved of list || []) create(saved[0], saved);
        }
        // 扶養手当の行で「条件から計算」を使っているときの父母等の人数（金額を直接入力しているときは0）
        function calcParents(row) {
          try {
            const s = JSON.parse(row.querySelector(".a-calc-state")?.value || "null");
            return s?.mode === "auto" ? Number(s.v?.parent) || 0 : 0;
          } catch {
            return 0;
          }
        }
        function read() {
          const rows = [...document.querySelectorAll(".allowance-item")];
          const manual = rows.map((row, index) => {
            const val = (sel) => row.querySelector(sel).value.trim(),
              num = (sel) => Number(val(sel));
            let name = val(".a-name"),
              method = val(".a-method"),
              amount = name === "地域手当" ? (val(".a-region") === "custom" ? num(".a-region-custom") : num(".a-amount")) : name === "広域異動手当" ? num(".a-distance") : num(".a-amount"),
              days = num(".a-days"),
              start = num(".a-start"),
              end = num(".a-end");
            if (!name) throw Error(`${index + 1}件目の手当名を入力してください。`);
            for (const sel of [
              ".a-amount",
              ".a-start",
              ".a-end",
              ...(name === "地域手当" && val(".a-region") === "custom" ? [".a-region-custom"] : []),
              ...(method === "daily" ? [".a-days"] : []),
            ]) {
              const input = row.querySelector(sel);
              if (!input.value.trim() || !input.checkValidity())
                throw Error(`「${name}」の金額・日数・支給期間を確認してください。`);
            }
            if (start >= end) throw Error(`「${name}」の支給終了は開始より後にしてください。`);
            if (method === "percent" && amount > 100)
              throw Error(`「${name}」の割合は0〜100％で入力してください。`);
            // 地域手当で地域を選んだ場合は、割合を年度ごとに決める（model() で月ごとに RULES.regionalRate を引く）
            const area =
              name === "地域手当" && val(".a-region") !== "custom"
                ? { pref: val(".a-prefecture"), name: row.querySelector(".a-region").value }
                : null;
            return {
              name,
              method,
              amount,
              days,
              startMonth: Math.round(start * 12),
              endMonth: Math.round(end * 12),
              bonusBase: bonusBaseNames.includes(name),
              // 扶養手当を「条件から計算」したときの父母等の人数（上位の階級で額が変わるので model() で月ごとに直す）
              ...(name === "扶養手当" ? { parents: calcParents(row) } : {}),
              ...(area ? { area } : {}),
            };
          });
          const auto = [];
          for (const key of branchAllowances[$("branch").value]) {
            const a = placement[key],
              v = $(`ba-${$("branch").value}-${key}`).value;
            if (v !== "none")
              auto.push({
                name: a.name,
                method: a.base === "pay" ? "percent" : "percentFirst",
                amount: Number(v),
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
            case "daily":
              return Math.floor(a.amount * a.days);
            case "percent":
              return Math.floor(((pay + (regionalNames.includes(a.name) ? extra : 0)) * a.amount) / 100);
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
            .filter((a) => a.name === "扶養手当")
            .reduce((sum, a) => sum + amountOf(a, pay, month), 0);
        function combinedTotal(list, pay, month, firstPay, extra, include = () => true) {
          const rows = (list || []).filter(include),
            regional = rows.filter((a) => a.name === "地域手当"),
            wide = rows.filter((a) => a.name === "広域異動手当"),
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
            (a) => a.bonusBase && !(kinben && a.name === "扶養手当"),
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
        }
        $("branch").addEventListener("change", updateBranch);
        $("addAllowance").addEventListener("click", () => create());
        updateBranch();
      })();
