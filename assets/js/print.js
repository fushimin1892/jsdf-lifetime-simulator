// 印刷・PDF：シミュレーターを開いているときだけ、入力条件と結果を1つの紙面（.c-print）に写して印刷する。
// Ctrl+P で印刷したときも同じ紙面になる。計算には触れない
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    dialog = $("simulatorDialog"),
    esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // 画面に出ている入力欄を「項目名：値」で集める（選択欄は選んだ文字、数値は単位つき）
  function conditions() {
    const rows = [];
    for (const box of document.querySelectorAll("#simulator .c-simulator__grid > div, #branchAllowances > div")) {
      // 隠れている欄（所属で出ない配置手当など）は載せない
      if (box.hidden || box.closest("[hidden]") || !box.offsetParent) continue;
      const label = box.querySelector("label"),
        field = box.querySelector("select, input");
      if (!label || !field) continue;
      const value =
        field.tagName === "SELECT" ? (field.selectedOptions[0]?.textContent ?? "") : `${field.value}${box.querySelector(".c-unit-input span")?.textContent ?? ""}`;
      rows.push([label.textContent.trim(), value.trim()]);
    }
    const barracks = $("barracksYears"),
      eigai = $("eigaiStart");
    for (const el of [barracks, eigai])
      if (el && !rows.some(([k]) => k === el.labels?.[0]?.textContent.trim()))
        rows.push([el.labels?.[0]?.textContent.trim() || el.id, el.selectedOptions[0]?.textContent.trim() ?? ""]);
    return rows;
  }
  function allowances() {
    return [...document.querySelectorAll("#allowanceList .c-allowance-item")].map((item) => {
      const v = (sel) => item.querySelector(sel)?.value ?? "",
        method = v(".c-allowance-item__method"),
        amount = Number(v(".c-allowance-item__amount")).toLocaleString("ja-JP"),
        how =
          method === "percent"
            ? `${amount}％`
            : method === "daily"
              ? `日額 ${amount}円 × ${v(".c-allowance-item__days")}日`
              : method === "annual"
                ? `年額 ${amount}円`
                : `月額 ${amount}円`;
      return `${v(".c-allowance-item__name")}：${how}（入隊から${v(".c-allowance-item__start")}〜${v(".c-allowance-item__end")}年後）`;
    });
  }
  function build() {
    remove();
    const result = $("simResult");
    if (!dialog.open || !result || result.hidden) return false;
    const area = document.createElement("div");
    area.className = "c-print";
    const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }),
      extra = allowances();
    area.innerHTML =
      `<header class="c-print__head"><div><p class="c-print__brand">自衛官 給料表ナビ</p><h1>生涯年収シミュレーション</h1></div><p class="c-print__date">作成日 ${esc(today)}</p></header>` +
      `<h2>入力した条件</h2><dl class="c-print__cond">${conditions()
        // 長い値の行は2列ぶん・1行ぶんの幅を使い、項目名が縦に潰れないようにする
        .map(([k, v]) => {
          const len = k.length + v.length,
            wide = len > 34 ? " c-print__row--full" : len > 20 ? " c-print__row--wide" : "";
          return `<div class="c-print__row${wide}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
        })
        .join("")}</dl>` +
      (extra.length ? `<ul class="c-print__allowances">${extra.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
      "<h2>試算結果</h2>";
    const copy = result.cloneNode(true);
    copy.removeAttribute("hidden");
    // 印刷では折りたたんだ表も開き、比べていないときは比較の欄を出さない
    copy.querySelectorAll("details").forEach((d) => (d.open = true));
    const cmp = copy.querySelector(".c-compare");
    if (cmp && cmp.querySelector(".c-table-scroll[hidden]")) cmp.remove();
    // 画面と同じ id が2つにならないように消す。グラフの中の id（色のグラデーション）は名前を変えて参照も付け替える
    copy.querySelectorAll("[id]").forEach((el) => {
      if (el.closest("svg")) el.id = `pa-${el.id}`;
      else el.removeAttribute("id");
    });
    copy.removeAttribute("id");
    copy.querySelectorAll("svg *").forEach((el) => {
      for (const attr of ["fill", "stroke", "clip-path", "mask"]) {
        const val = el.getAttribute(attr);
        if (val?.includes("url(#")) el.setAttribute(attr, val.replace(/url\(#/g, "url(#pa-"));
      }
    });
    area.append(copy);
    area.insertAdjacentHTML(
      "beforeend",
      '<p class="c-print__foot">入力した条件に基づく試算で、実際の支給額とは異なることがあります。個人向けの情報提供サイトです。防衛省・自衛隊の公式サイトではありません。正式な金額・適用条件は法令等をご確認ください。</p>',
    );
    document.body.append(area);
    document.documentElement.classList.add("is-printing");
    return true;
  }
  function remove() {
    document.querySelectorAll(".c-print").forEach((el) => el.remove());
    document.documentElement.classList.remove("is-printing");
  }
  $("printSim")?.addEventListener("click", () => {
    if (build()) window.print();
  });
  window.addEventListener("beforeprint", () => {
    if (!document.querySelector(".c-print")) build();
  });
  window.addEventListener("afterprint", remove);
})();
