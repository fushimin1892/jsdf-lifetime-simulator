// effects.js：見た目の演出（ヘッダーを細くする・画面に入ったら表示・金額のカウントアップ・グラフの伸び）と、
// 文章をコピーしにくくする処理。計算には関わらない。
(() => {
  "use strict";
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 文章をコピーしにくくする：文字の選択・右クリックのメニュー・コピー・切り取り・画像のドラッグを止める。
  // 入力欄（数字・手当・共有用URLの欄など）の中だけは今までどおり選んだり貼り付けたりできる。
  // 共有用URLのコピーのボタンはクリップボードの仕組み（navigator.clipboard）を使うので、ここでは止まらない。
  // ※ソースの表示・画面の撮影などまでは止められない（ウェブの仕組み上、完全には防げない）
  const inField = (t) => !!(t && t.closest && t.closest("input, textarea, select, [contenteditable]"));
  for (const type of ["copy", "cut", "contextmenu", "dragstart", "selectstart"])
    document.addEventListener(type, (e) => {
      if (!inField(e.target)) e.preventDefault();
    });
  // 少しスクロールしたら、ナビの帯を細くする
  const onScroll = () => document.body.classList.toggle("is-scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // 画面に入ったらふわっと出す
  if ("IntersectionObserver" in window && !calm) {
    document.documentElement.classList.add("is-reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll("main.l-main > section.c-card:not(.c-lookup), .is-reveal").forEach((el) => {
      el.classList.add("is-reveal");
      io.observe(el);
    });
  }
  if (calm) return;
  // 金額が変わったら、前の金額から数字が増えて（減って）いく
  const ids = ["amount", "totalIncome", "retireAllowance", "youngPension", "grossAll", "totalDeductions", "lifetimeNet", "stickyTotal"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const live = el.closest("[aria-live]");
    let prev = null,
      frame = 0;
    const run = () => {
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.data)),
        m = node?.data.match(/[\d,]+/),
        target = m ? Number(m[0].replace(/,/g, "")) : null;
      const from = prev;
      prev = target;
      if (target == null || from == null || from === target) return;
      cancelAnimationFrame(frame);
      const text = node.data,
        start = performance.now();
      // 読み上げソフトには途中の数字を読ませず、最後の金額だけを伝える
      live?.setAttribute("aria-busy", "true");
      const step = (now) => {
        const p = Math.min(1, (now - start) / 600),
          v = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
        node.data = text.replace(/[\d,]+/, v.toLocaleString("ja-JP"));
        // 自分で書き換えた分の変化は無視する（新しい金額と取り違えないように）
        observer.takeRecords();
        if (p < 1) frame = requestAnimationFrame(step);
        else live?.removeAttribute("aria-busy");
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new MutationObserver(run);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    run();
  }
  // シミュレーターを開いたときだけ、グラフの棒を順に伸ばす（条件を変えるたびには動かさない）
  const chart = document.getElementById("simChart");
  if (chart) {
    new MutationObserver(() => {
      if (chart.classList.contains("is-grow")) chart.querySelectorAll("g").forEach((g, i) => (g.style.animationDelay = `${i * 12}ms`));
    }).observe(chart, { childList: true });
    document.getElementById("simLaunch")?.addEventListener("click", () => {
      chart.classList.add("is-grow");
      setTimeout(() => chart.classList.remove("is-grow"), 1600);
    });
  }
})();
