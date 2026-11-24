// 背景の飾りを、ページとは別の作業場所（Web Worker）で描く。
// ページのスクロールやボタンの反応と取り合わないので、画面の書き換えの速さいっぱいで滑らかに動かせる。
// 描き先はページから受け取った OffscreenCanvas。スクロール量などはページから postMessage で受け取る。利用者の入力は受け取らない
/* global CrystalsCore */
"use strict";
importScripts("crystals-core.js" + self.location.search);

let core = null,
  calm = false,
  paused = false,
  running = false;
// 画面の書き換えに合わせて描く（Worker で requestAnimationFrame が使えない環境は 1/60 秒ごと）
const nextFrame = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
function loop(time) {
  if (!paused) core.draw(time);
  nextFrame(loop);
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === "init") {
    calm = !!m.calm;
    core = CrystalsCore({ canvas2d: m.canvas2d, canvasGl: m.canvasGl, calm, dpr: m.dpr });
    core.setView(m.view);
    core.resize(m.w, m.h, m.dpr);
    if (calm) core.draw(0);
    else if (!running) {
      running = true;
      nextFrame(loop);
    }
    return;
  }
  if (!core) return;
  if (m.type === "resize") {
    core.setView(m.view);
    core.resize(m.w, m.h, m.dpr);
    if (calm) core.draw(0);
  } else if (m.type === "view") {
    core.setView(m.view);
    if (calm) core.draw(0);
  } else if (m.type === "pointer") core.setPointer(m.x, m.y);
  else if (m.type === "pause") paused = !!m.paused;
};
