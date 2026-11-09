      (() => {
        "use strict";
        const page = document.getElementById("notesPage"),
          body = document.getElementById("notesBody"),
          // この文字数を超える説明は説明ページへ移し、元の場所にはリンクだけを置く
          LIMIT = 30,
          selector = "#simulator .fixed-note, #simulator .sim-group-note, #simulator p.note",
          notes = new Map();
        let count = 0;
        // 説明の見出し：指定があればそれ、なければ項目のラベル、次に直前の見出し
        function titleOf(el) {
          if (el.dataset.noteTitle) return el.dataset.noteTitle;
          const label = el.closest("div")?.querySelector(":scope > label");
          if (label) {
            const item = el.closest(".allowance-item");
            const allowanceName = item?.querySelector(".allowance-title")?.textContent.trim();
            return allowanceName ? `${allowanceName}：${label.textContent.trim()}` : label.textContent.trim();
          }
          for (let p = el.previousElementSibling; p; p = p.previousElementSibling)
            if (/^H[2-4]$/.test(p.tagName)) return p.textContent.trim();
          return "説明";
        }
        function convert(el) {
          if (el.dataset.noteMoved || el.id === "deductionDetail" || el.id === "shareStatus") return;
          const text = el.textContent.replace(/\s+/g, "");
          if (text.length <= LIMIT) return;
          // 文章が同じ場合も項目ごとに別の説明欄を作る
          const id = `note-${++count}`;
          const section = document.createElement("section"),
            h = document.createElement("h3"),
            p = document.createElement("p");
          section.id = id;
          h.textContent = titleOf(el);
          p.innerHTML = el.innerHTML.trim();
          section.append(h, p);
          notes.set(id, section);
          const link = document.createElement("a");
          link.className = "note-link";
          link.href = `#${id}`;
          link.textContent = "詳しい説明";
          link.dataset.note = id;
          el.replaceChildren(link);
          el.dataset.noteMoved = "1";
        }
        const convertAll = (root) => root.querySelectorAll(selector).forEach(convert);
        convertAll(document);
        // 後から追加される手当の説明も同じように移す
        new MutationObserver(() => convertAll(document)).observe(document.getElementById("simulator"), {
          childList: true,
          subtree: true,
        });
        // リンクを押したら説明ページを開き、該当する説明まで移動する（URLの#は変えない。共有URLの#sim=と競合するため）
        document.addEventListener("click", (e) => {
          const link = e.target.closest?.(".note-link");
          if (!link) return;
          e.preventDefault();
          const target = notes.get(link.dataset.note);
          if (!target) return;
          // 説明ページには選んだ項目だけを表示し、別項目の説明と混ざらないようにする
          body.replaceChildren(target);
          if (!page.open) page.showModal();
          target.scrollIntoView({ block: "start" });
        });
        page.querySelector(".notes-back").addEventListener("click", () => page.close());
        page.addEventListener("close", () => body.replaceChildren());
        // 枠の外を押しても閉じる
        page.addEventListener("click", (e) => {
          if (e.target !== page) return;
          const r = page.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) page.close();
        });
      })();
