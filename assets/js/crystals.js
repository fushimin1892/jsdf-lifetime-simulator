// 背景の飾り（浮かぶ桜のガラスの立体と、舞う花びら）を動かす。描画の中身は assets/js/crystals-core.js。
// ・ブラウザが対応していれば、別の作業場所（Web Worker：assets/js/crystals-worker.js）で描く。
//   ページのスクロールやボタンの反応と取り合わないので、画面の書き換えの速さいっぱいで滑らかに動く
// ・対応していないブラウザでは、このページの中で描く（スクロール中は止め、1秒30回まで）
// ・動きを減らす設定のときは止まった1枚だけを描く。シミュレーターを開いている間と、タブが裏にあるときは描かない
// ・利用者の入力は読まない・送らない（送るのはスクロール量・本文の左端・ポインタの位置・止めるかどうかだけ）
/* global CrystalsCore */
(() => {
  "use strict";
  const canvas = document.querySelector(".bg-scene .crystals");
  if (!canvas || !canvas.getContext) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches,
    // 読み込んだときのブラウザの関数を持っておく（回帰テストが同期の代わりに置き換えるため）
    raf = window.requestAnimationFrame.bind(window),
    layout = document.querySelector("main.layout");
  // 立体を描く WebGL 用の描き先（花びら・影の描き先の上に重ねる）
  const glCanvas = document.createElement("canvas");
  glCanvas.className = "crystals crystals-gl";
  canvas.after(glCanvas);

  const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight, dpr: window.devicePixelRatio || 1 });
  const view = () => ({ scrollY: window.scrollY || 0, left: Math.max(0, layout?.getBoundingClientRect().left || 0) });
  const paused = () => document.hidden || !!document.querySelector("dialog[open]");
  let send = null; // Worker へ送る（Worker を使わないときは null）
  let core = null; // ページの中で描くとき

  // ---------- 別の作業場所で描く ----------
  if (canvas.transferControlToOffscreen && glCanvas.transferControlToOffscreen && typeof Worker !== "undefined") {
    try {
      const url = (document.currentScript?.src || "assets/js/crystals.js").replace("crystals.js", "crystals-worker.js"),
        worker = new Worker(url),
        c2 = canvas.transferControlToOffscreen(),
        cg = glCanvas.transferControlToOffscreen();
      send = (m, t) => worker.postMessage(m, t || []);
      send({ type: "init", canvas2d: c2, canvasGl: cg, calm, view: view(), ...size() }, [c2, cg]);
    } catch {
      send = null;
    }
  }
  // ---------- ページの中で描く（Worker に対応していないとき） ----------
  if (!send) {
    if (typeof CrystalsCore !== "function") return;
    core = CrystalsCore({ canvas2d: canvas, canvasGl: glCanvas, calm, dpr: window.devicePixelRatio || 1 });
    core.setView(view());
    const s = size();
    core.resize(s.w, s.h, s.dpr);
    if (calm) core.draw(0);
  }

  // ---------- ページの出来事を伝える ----------
  addEventListener(
    "resize",
    () => {
      const s = size();
      if (send) send({ type: "resize", view: view(), ...s });
      else {
        core.setView(view());
        core.resize(s.w, s.h, s.dpr);
        if (calm) core.draw(0);
      }
    },
    { passive: true },
  );
  let scrollingUntil = 0;
  addEventListener(
    "scroll",
    () => {
      scrollingUntil = performance.now() + 200;
      if (send) send({ type: "view", view: view() });
      else {
        core.setView(view());
        if (calm) core.draw(0);
      }
    },
    { passive: true, capture: true },
  );
  if (calm) return;
  addEventListener(
    "pointermove",
    (e) => {
      const x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
        y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      if (send) send({ type: "pointer", x, y });
      else core.setPointer(x, y);
    },
    { passive: true },
  );
  // シミュレーターを開いている間・タブが裏にあるときは描かない
  if (send) {
    let was = null;
    const sync = () => {
      const p = paused();
      if (p !== was) send({ type: "pause", paused: (was = p) });
    };
    document.addEventListener("visibilitychange", sync);
    for (const d of document.querySelectorAll("dialog")) new MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ["open"] });
    sync();
    return;
  }
  // ページの中で描くとき：1秒30回まで。スクロールしている間は描かず、ページのスクロールを優先する
  let last = -1e9;
  const loopFrame = (time) => {
    if (time - last >= 32 && time > scrollingUntil && !paused()) {
      last = time;
      core.draw(time);
    }
    raf(loopFrame);
  };
  raf(loopFrame);
})();
