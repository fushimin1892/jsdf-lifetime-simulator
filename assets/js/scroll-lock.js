(() => {
  const dialog = document.getElementById("simulatorDialog");
  if (!dialog) return;
  const body = document.body;
  let locked = false;
  let savedY = 0;
  let pendingY = null;
  let previous = null;
  const readY = () => window.scrollY || document.documentElement.scrollTop || body.scrollTop || 0;
  const launcher = document.getElementById("simLaunch");
  launcher?.addEventListener(
    "click",
    () => {
      if (!dialog.open && !locked) pendingY = readY();
    },
    true,
  );
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
  dialog.addEventListener("close", unlock);
  new MutationObserver(() => (dialog.open ? lock() : unlock())).observe(dialog, {
    attributes: true,
    attributeFilter: ["open"],
  });
  if (dialog.open) lock();
})();
