      (() => {
        "use strict";
        const ranks = [
          "将",
          "将補（1）",
          "将補（2）",
          "1佐（1）",
          "1佐（2）",
          "1佐（3）",
          "2佐",
          "3佐",
          "1尉",
          "2尉",
          "3尉",
          "准尉",
          "曹長",
          "1曹",
          "2曹",
          "3曹",
          "士長",
          "1士",
          "2士",
        ];
        const rank = document.querySelector("#rank"),
          grade = document.querySelector("#grade"),
          amount = document.querySelector("#amount"),
          detail = document.querySelector("#detail");
        const data = window.PAY_TABLE || [],
          scroller = document.querySelector(".scroll"),
          yen = new Intl.NumberFormat("ja-JP");
        let highlighted = null;
        // 選んだ階級に金額がある号俸だけを選択肢にする
        function updateGrades() {
          const r = +rank.value,
            previous = +grade.value || 0,
            valid = data.map((row, g) => (row[r] != null ? g : -1)).filter((g) => g >= 0);
          grade.innerHTML = valid.map((g) => `<option value="${g}">${g + 1}号俸</option>`).join("");
          grade.value = Math.min(previous, valid[valid.length - 1]);
        }
        // 同じ階級で毎年4号俸ずつ昇給した場合の1〜3年後。その階級の最高号俸で止める。
        // 将は昇給なし（施行令第6条の20）。将補・1佐（1）（2）欄は昇給抑制の対象で、標準の成績では昇給せず、
        // 極めて良好でも年2号俸なので、その場合を示す
        const outlook = document.querySelector("#outlook"),
          outlookNote = document.querySelector(".outlook-head small");
        let ahead = [];
        function showOutlook(r, g, v) {
          ahead.forEach((td) => td.classList.remove("ahead"));
          ahead = [];
          if (v == null) {
            outlook.innerHTML = "";
            return;
          }
          const limited = r >= 1 && r <= 4,
            perYear = limited ? 2 : 4;
          outlookNote.textContent = limited ? "勤務成績が極めて良好（年2号俸）の場合" : "毎年4号俸ずつ上がる場合";
          if (r === 0) {
            outlookNote.textContent = "";
            outlook.innerHTML = '<li><span class="outlook-max">将の俸給は官職ごとに号俸が決まり、昇給はありません。</span></li>';
            return;
          }
          let top = g;
          while (data[top + 1]?.[r] != null) top++;
          if (g === top) {
            outlook.innerHTML = '<li><span class="outlook-max">この階級の最高号俸です。同じ階級のままでは、これ以上昇給しません。</span></li>';
            return;
          }
          const items = [];
          for (let k = 1; k <= 3; k++) {
            const n = Math.min(g + perYear * k, top);
            items.push(
              `<li><span>${k}年後</span><b>${n + 1}号俸${n === top ? "（最高）" : ""}</b><strong>${yen.format(data[n][r])}</strong><em>+${yen.format(data[n][r] - v)}円</em></li>`,
            );
            const td = document.querySelector(`#tbody tr:nth-child(${n + 1}) td:nth-child(${r + 2})`);
            if (td) {
              td.classList.add("ahead");
              ahead.push(td);
            }
            if (n === top) break;
          }
          if (limited)
            items.push('<li><span class="outlook-max">将補・1佐（1）（2）欄は昇給が抑制され、標準の成績では昇給しません。</span></li>');
          outlook.innerHTML = items.join("");
        }
        function refresh() {
          const r = +rank.value,
            g = +grade.value,
            v = data[g]?.[r];
          amount.innerHTML =
            v != null
              ? `${yen.format(v)} <span>円 / 月</span>`
              : '<span class="empty">該当する金額はありません</span>';
          detail.textContent = `${ranks[r]} ・ ${g + 1}号俸`;
          showOutlook(r, g, v);
          highlighted?.classList.remove("highlight");
          highlighted = document.querySelector(`#tbody tr:nth-child(${g + 1}) td:nth-child(${r + 2})`);
          if (!highlighted) return;
          highlighted.classList.add("highlight");
          // ページ全体は動かさず、俸給表の枠の中だけを該当セルまでスクロールする
          const box = scroller.getBoundingClientRect(),
            cell = highlighted.getBoundingClientRect(),
            head = scroller.querySelector("thead").offsetHeight,
            side = scroller.querySelector("tbody th").offsetWidth;
          let top = scroller.scrollTop,
            left = scroller.scrollLeft;
          if (cell.top < box.top + head || cell.bottom > box.bottom)
            top += cell.top - box.top - head - (box.height - head - cell.height) / 2;
          if (cell.left < box.left + side || cell.right > box.right)
            left += cell.left - box.left - side - (box.width - side - cell.width) / 2;
          scroller.scrollTo({ top, left });
        }
        if (data.length) {
          rank.innerHTML = ranks.map((v, i) => `<option value="${i}">${v}</option>`).join("");
          rank.value = 15;
          updateGrades();
          document.querySelector("#thead").innerHTML =
            '<tr><th scope="col">号俸</th>' +
            ranks.map((x) => `<th scope="col">${x}</th>`).join("") +
            "</tr>";
          document.querySelector("#tbody").innerHTML = data
            .map(
              (row, g) =>
                `<tr><th scope="row">${g + 1}</th>${row.map((v) => `<td>${v == null ? "—" : yen.format(v)}</td>`).join("")}</tr>`,
            )
            .join("");
          rank.addEventListener("change", () => {
            updateGrades();
            refresh();
          });
          grade.addEventListener("change", refresh);
          refresh();
        } else {
          amount.textContent = "データを読み込めませんでした";
          detail.textContent = "ページを再読み込みしてください。";
        }
      })();
