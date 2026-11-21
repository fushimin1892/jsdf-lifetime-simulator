// 4. 画面：画面幅ごとの横のはみ出し、コンソールのエラー・CSP 違反・外部通信、印刷、キーボードのフォーカスと固定の帯、文字のコントラスト
"use strict";
const { Report, openPage } = require("../lib/common");

const WIDTHS = [320, 375, 414, 768, 1280, 1920];

// ---- ページ側で使う関数（文字列にして渡すので、外の変数は使わない） ----
// 画面の横からはみ出した要素（横スクロールできる枠の中・飾り・SVG の中は除く）
function overflowFn(root) {
  const W = document.documentElement.clientWidth;
  const out = [];
  const r0 = root ? document.querySelector(root) : document.body;
  for (const el of r0.querySelectorAll("*")) {
    if (el.closest(".bg-scene,.footer-word,svg,.visually-hidden,[aria-hidden=true]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let p = el.parentElement,
      inScroll = false;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) {
        inScroll = true;
        break;
      }
      p = p.parentElement;
    }
    if (inScroll) continue;
    if (r.right > W + 1 || r.left < -1)
      out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : ""}（${Math.round(r.left)}〜${Math.round(r.right)}px、幅 ${W}px）「${(el.textContent || "").trim().slice(0, 20)}」`);
  }
  return out;
}
// 文字が自分の枠からあふれて、ダイアログ・画面の右端を越えている要素（折り返さない見出しなど）
function textSpillFn(root) {
  const r0 = document.querySelector(root);
  const lim = Math.min(document.documentElement.clientWidth, r0.getBoundingClientRect().left + r0.clientWidth);
  const hits = [];
  for (const el of r0.querySelectorAll("*")) {
    if (el.closest(".visually-hidden,svg,[aria-hidden=true],select")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.overflowX !== "visible" || !el.getClientRects().length) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && el.getBoundingClientRect().left + el.scrollWidth > lim + 1) hits.push(el);
  }
  // いちばん内側（ほかの該当要素を含まないもの）だけを挙げる
  return hits
    .filter((el) => !hits.some((o) => o !== el && el.contains(o)))
    .map((el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""}「${el.textContent.trim().slice(0, 20)}」（文字の幅 ${el.scrollWidth}px、枠 ${el.clientWidth}px）`);
}
// SVG の文字（グラフの目盛り・ラベル）が SVG の外にはみ出していないか
function svgTextFn(root) {
  const out = [];
  for (const svg of document.querySelectorAll(`${root} svg`)) {
    if (!svg.getClientRects().length) continue;
    const box = svg.getBoundingClientRect();
    for (const t of svg.querySelectorAll("text")) {
      const r = t.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`${svg.closest("[id]")?.id || "svg"} の文字「${t.textContent.trim().slice(0, 15)}」（${Math.round(r.left)}〜${Math.round(r.right)}px、枠 ${Math.round(box.left)}〜${Math.round(box.right)}px）`);
    }
  }
  return out;
}
// 文字のコントラスト（WCAG：小さな文字 4.5:1、大きな文字（24px 以上か 18.66px 以上の太字）3:1）
function contrastFn(root) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  // 背景：要素から上へたどった背景色を重ねる（いちばん下はページの背景色）
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const bgOf = (el) => {
    const layers = [];
    let image = false;
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage !== "none") image = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = pageBg.a >= 1 ? pageBg : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return { bg: base, image };
  };
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.querySelector(root), NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest("svg,[aria-hidden=true],option,script,style,.print-area,[hidden],.visually-hidden")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || !el.getClientRects().length) continue;
    let op = 1;
    for (let p = el; p; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    if (op < 0.05) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const { bg, image } = bgOf(el);
    // 背景が画像・グラデーションの文字は、背景の色を1つに決められないので数えない（件数だけ返す）
    if (image) {
      out.push({ skipped: true });
      continue;
    }
    const f = blend({ ...fg, a: fg.a * op }, bg);
    const L1 = lum(f),
      L2 = lum(bg);
    const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize),
      bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    out.push({ ok: cr >= need, text: n.data.trim().slice(0, 25), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""), cr: +cr.toFixed(2), need, size, color: cs.color, bg: `rgb(${bg.r | 0}, ${bg.g | 0}, ${bg.b | 0})` });
  }
  return out;
}
// いまフォーカスのある要素が、固定の帯（シミュレーターの上部の帯・ページの見出しの帯）に隠れていないか、見える印があるか
function focusInfo() {
  const el = document.activeElement;
  if (!el || el === document.body || el.tagName === "DIALOG") return null;
  const r = el.getBoundingClientRect();
  const dlg = document.getElementById("simulatorDialog");
  const inDialog = dlg.open && el.closest("#simulatorDialog");
  let under = false,
    off = false;
  if (inDialog) {
    const st = dlg.querySelector(".sim-sticky");
    if (st && !el.closest(".sim-sticky") && r.top < st.getBoundingClientRect().bottom - 1) under = true;
    const d = dlg.getBoundingClientRect();
    off = r.bottom > Math.min(d.bottom, innerHeight) + 1 || r.top < Math.max(d.top, 0) - 1;
  } else {
    const head = document.querySelector(".site-head");
    if (head && getComputedStyle(head).position.match(/sticky|fixed/) && !el.closest(".site-head") && r.top < head.getBoundingClientRect().bottom - 1) under = true;
    off = r.bottom > innerHeight + 1 || r.top < -1;
  }
  const box = el.closest(".unit") || el;
  const o = getComputedStyle(box),
    oe = getComputedStyle(el);
  const ring = (cs) => (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
  return { t: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""}「${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 15)}」`, under, off, visible: ring(o) || ring(oe), h: Math.round(r.height) };
}

// シミュレーターを開き、手当を足して、結果・比較・再就職のグラフまで表示した状態にする
async function openFilled(page, kinds = "some") {
  await page.click(".hero-actions .btn-primary");
  await page.waitForFunction(() => document.getElementById("simulatorDialog").open && !document.getElementById("simResult").hidden);
  await page.evaluate((kinds) => {
    const g = (id) => document.getElementById(id);
    const set = (id, v) => {
      g(id).value = v;
      g(id).dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("reemployIncome", "450"); // 再就職のグラフを出す
    const det = document.querySelector(".manual-allowances");
    if (det) det.open = true;
    // 管理職員特別勤務手当は「管理職」を選ばないとエラーになる（正しい案内）ので、ここでは足さない
    const list = [...g("allowanceKind").options].map((o) => o.value).filter((k) => k !== "管理職員特別勤務手当");
    for (const k of kinds === "all" ? list : list.slice(0, 4)) {
      g("allowanceKind").value = k;
      g("addAllowance").click();
    }
    for (const d of document.querySelectorAll("#simulatorDialog details")) d.open = true;
    g("compareSave").click();
    set("targetRank", "2佐");
  }, kinds);
  await page.waitForTimeout(700);
}

module.exports = async function screen(env, { quick, log }) {
  const rep = new Report("画面");
  const widths = quick ? [320, 375, 1280] : WIDTHS;

  // ---- (1) 画面幅ごとの横のはみ出し（トップ・シミュレーター）。手当をすべて足した状態も見る ----
  for (const w of widths)
    for (const scheme of quick ? ["light"] : ["light", "dark"]) {
      const h = await openPage(env, { width: w, height: w < 768 ? 740 : 900, colorScheme: scheme });
      const where = `幅 ${w}px（${scheme === "dark" ? "暗い配色" : "明るい配色"}）`;
      rep.cases++;
      try {
        const doc = await h.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        rep.expect(doc <= 0, "overflow", `${where}：トップページが横に ${doc}px はみ出す`);
        const top = await h.page.evaluate(overflowFn, null);
        rep.expect(!top.length, "overflow", () => `${where}：トップページで画面の外にはみ出す要素 ${top.length}件（${top.slice(0, 3).join("、")}）`);
        await openFilled(h.page, w <= 414 ? "all" : "some");
        const dlg = await h.page.evaluate(() => {
          const d = document.getElementById("simulatorDialog");
          const r = d.getBoundingClientRect();
          return { sw: d.scrollWidth - d.clientWidth, left: r.left, right: innerWidth - r.right };
        });
        const spill = dlg.sw > 0 ? await h.page.evaluate(textSpillFn, "#simulatorDialog") : [];
        rep.expect(dlg.sw <= 0, "overflow", `${where}：シミュレーターのダイアログが横に ${dlg.sw}px はみ出す（横にスクロールできてしまう）${spill.length ? `。あふれている文字：${spill.slice(0, 3).join("、")}` : ""}`);
        rep.expect(dlg.left >= -1 && dlg.right >= -1, "overflow", `${where}：ダイアログが画面の外に出る（左 ${dlg.left}px・右 ${dlg.right}px）`);
        const sim = await h.page.evaluate(overflowFn, "#simulatorDialog");
        rep.expect(!sim.length, "overflow", () => `${where}：シミュレーターで画面の外にはみ出す要素 ${sim.length}件（${sim.slice(0, 3).join("、")}）`);
        const svg = await h.page.evaluate(svgTextFn, "#simulatorDialog");
        rep.expect(!svg.length, "overflow", () => `${where}：グラフの文字が枠の外に出る ${svg.length}件（${svg.slice(0, 3).join("、")}）`);
        const err = await h.page.evaluate(() => document.getElementById("simError").textContent.trim());
        rep.expect(!err, "screenError", `${where}：手当を足した状態でエラー「${err}」`);
      } finally {
        rep.takeProblems(h.problems, where);
        await h.close();
      }
    }

  // ---- (2) 印刷：表が紙の幅に収まる（A4 の幅 718px と、パソコンの幅 1280px で印刷の見た目にする） ----
  for (const w of [718, 1280]) {
    const h = await openPage(env, { width: w, height: 1000 });
    rep.cases++;
    try {
      await openFilled(h.page);
      await h.page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      await h.page.emulateMedia({ media: "print" });
      const r = await h.page.evaluate(() => {
        const a = document.querySelector(".print-area");
        if (!a) return null;
        const ar = a.getBoundingClientRect();
        const tables = [...a.querySelectorAll("table")].map((t) => ({ id: t.querySelector("tbody")?.id || t.className || "table", w: Math.round(t.getBoundingClientRect().width), sw: t.scrollWidth, right: t.getBoundingClientRect().right }));
        const over = [...a.querySelectorAll("*")].filter((e) => !e.closest("svg") && e.getBoundingClientRect().width && e.getBoundingClientRect().right > ar.right + 1).map((e) => `${e.tagName.toLowerCase()}.${e.className}「${e.textContent.trim().slice(0, 15)}」`);
        return { W: ar.width, right: ar.right, docW: document.documentElement.scrollWidth, vw: innerWidth, tables, over: over.slice(0, 5), overN: over.length, rows: a.querySelectorAll("tbody tr").length };
      });
      if (!r) rep.add("print", `印刷（幅 ${w}px）：印刷用の欄（.print-area）がない`);
      else {
        rep.expect(r.rows > 0 && r.tables.length > 0, "print", `印刷（幅 ${w}px）：印刷用の欄に表がない`);
        for (const t of r.tables) rep.expect(t.sw <= Math.ceil(t.w) + 1 && t.right <= r.right + 1, "print", `印刷（幅 ${w}px）：表 ${t.id} が紙の幅に収まらない（表の幅 ${t.sw}px、欄の幅 ${Math.round(r.W)}px）`);
        rep.expect(!r.overN, "print", `印刷（幅 ${w}px）：印刷用の欄の外にはみ出す要素 ${r.overN}件（${r.over.join("、")}）`);
        rep.expect(r.docW <= r.vw, "print", `印刷（幅 ${w}px）：ページが横に ${r.docW - r.vw}px はみ出す`);
      }
      await h.page.emulateMedia({ media: "screen" });
      await h.page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    } finally {
      rep.takeProblems(h.problems, `印刷（幅 ${w}px）`);
      await h.close();
    }
  }

  // ---- (3) キーボード：Tab で移ったフォーカスが固定の帯に隠れず、見える印がある ----
  for (const w of quick ? [375] : [375, 1280]) {
    const h = await openPage(env, { width: w, height: w < 768 ? 740 : 900 });
    rep.cases++;
    try {
      const bad = [];
      let n = 0;
      // トップページ
      for (let i = 0; i < 20; i++) {
        await h.page.keyboard.press("Tab");
        const f = await h.page.evaluate(focusInfo);
        if (!f) continue;
        n++;
        if (f.under || f.off || !f.visible) bad.push({ ...f, where: "トップ" });
      }
      // シミュレーター（手当を1つ足して、手当の欄も通る）
      await h.page.focus(".hero-actions .btn-primary");
      await h.page.keyboard.press("Enter");
      await h.page.waitForFunction(() => document.getElementById("simulatorDialog").open);
      await h.page.evaluate(() => {
        const det = document.querySelector(".manual-allowances");
        if (det) det.open = true;
        document.getElementById("allowanceKind").value = "住居手当";
        document.getElementById("addAllowance").click();
        document.activeElement.blur?.();
      });
      await h.page.waitForTimeout(300);
      for (let i = 0; i < (quick ? 80 : 160); i++) {
        await h.page.keyboard.press("Tab");
        const f = await h.page.evaluate(focusInfo);
        if (!f) continue;
        n++;
        if (f.under || f.off || !f.visible) bad.push({ ...f, where: "シミュレーター" });
      }
      // 逆向き（Shift+Tab）で結果欄から上へ
      await h.page.evaluate(() => document.getElementById("simResult").scrollIntoView());
      for (let i = 0; i < 40; i++) {
        await h.page.keyboard.press("Shift+Tab");
        const f = await h.page.evaluate(focusInfo);
        if (!f) continue;
        n++;
        if (f.under || f.off || !f.visible) bad.push({ ...f, where: "シミュレーター（逆向き）" });
      }
      rep.expect(n >= 50, "focus", `幅 ${w}px：Tab で移れた要素が ${n} 個しかない`);
      const uniq = [...new Map(bad.map((b) => [b.where + b.t + b.under + b.off + b.visible, b])).values()];
      for (const b of uniq) rep.add("focus", `幅 ${w}px・${b.where}：${b.t} ${b.under ? "が固定の帯に隠れる" : b.off ? "が画面の外にある" : "にフォーカスの印が見えない"}`);
      rep.notes.push(`フォーカス（幅 ${w}px）：${n} 回の移動を確認`);
    } finally {
      rep.takeProblems(h.problems, `フォーカス（幅 ${w}px）`);
      await h.close();
    }
  }

  // ---- (4) 文字のコントラスト（明るい配色・暗い配色。トップ全体と、手当・比較を出したシミュレーター） ----
  for (const scheme of ["light", "dark"]) {
    const h = await openPage(env, { width: 1280, height: 900, colorScheme: scheme });
    rep.cases++;
    try {
      await h.page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await h.page.waitForTimeout(400);
      const top = await h.page.evaluate(contrastFn, "body");
      await openFilled(h.page);
      const sim = await h.page.evaluate(contrastFn, "#simulatorDialog");
      const where = scheme === "dark" ? "暗い配色" : "明るい配色";
      for (const [name, list] of [["トップ", top], ["シミュレーター", sim]]) {
        const checked = list.filter((x) => !x.skipped);
        const bad = checked.filter((x) => !x.ok);
        const uniq = [...new Map(bad.map((b) => [b.sel + b.color + b.bg, b])).values()];
        for (const b of uniq) rep.add("contrast", `${where}・${name}：「${b.text}」（${b.sel}、${b.size}px）のコントラスト ${b.cr}:1（必要 ${b.need}:1、文字 ${b.color}・背景 ${b.bg}）`);
        rep.ok(checked.length - bad.length);
        rep.notes.push(`コントラスト（${where}・${name}）：${checked.length} か所を確認、背景が画像・グラデーションで数えなかったもの ${list.length - checked.length} か所`);
      }
    } finally {
      rep.takeProblems(h.problems, `コントラスト（${scheme}）`);
      await h.close();
    }
  }
  return rep;
};
module.exports.pageFns = { overflowFn, textSpillFn, svgTextFn, contrastFn, focusInfo };
