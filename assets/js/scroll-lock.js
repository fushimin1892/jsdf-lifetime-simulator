// scroll-lock.js：シミュレーターを開いている間、後ろのページがスクロールしないように固定し、
// 閉じたら元の位置に戻す（iPhone などで dialog の外が動くのを防ぐ）。
(() => {
  const dialog = document.getElementById("simulatorDialog");
  if (!dialog) return;
  const body = document.body;
  let locked = false;
  let savedY = 0;
  let pendingY = null;
  let previous = null;
  // 今のスクロール位置（ブラウザによって読める場所が違うので順に試す）
  const readY = () => window.scrollY || document.documentElement.scrollTop || body.scrollTop || 0;
  const launcher = document.getElementById("simLaunch");
  // 開くボタンを押したときの位置を覚える（開いた後だと位置が変わっていることがある）
  launcher?.addEventListener(
    "click",
    () => {
      if (!dialog.open && !locked) pendingY = readY();
    },
    true,
  );
  // 固定：body を position: fixed にして、覚えた位置の分だけ上にずらす（見た目は動かない）
  const lock = () => {
    if (locked || !dialog.open) return;
    locked = true;
    savedY = pendingY ?? readY();
    pendingY = null;
    previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${savedY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
  };
  // 解除：body の指定を元に戻し、描き直しを2回待ってから元の位置へスクロールする
  const unlock = () => {
    if (!locked) return;
    locked = false;
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.left = previous.left;
    body.style.right = previous.right;
    body.style.width = previous.width;
    const restoreY = savedY;
    previous = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!dialog.open) window.scrollTo({ top: restoreY, left: 0, behavior: "instant" });
      }),
    );
  };
  // dialog の open 属性の変化を見て、固定・解除する
  dialog.addEventListener("close", unlock);
  new MutationObserver(() => (dialog.open ? lock() : unlock())).observe(dialog, {
    attributes: true,
    attributeFilter: ["open"],
  });
  if (dialog.open) lock();
})();
