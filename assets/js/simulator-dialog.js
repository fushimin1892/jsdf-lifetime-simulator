      // ヘッダーと最初の画面の「生涯年収を試算」ボタンは、右下のボタンと同じくシミュレーターを開く
      document.querySelectorAll("[data-open-sim]").forEach((b) =>
        b.addEventListener("click", () => document.getElementById("simLaunch").click()),
      );
      (() => {
        "use strict";
        const dialog = document.getElementById("simulatorDialog"),
          launch = document.getElementById("simLaunch");
        launch.addEventListener("click", () => {
          if (!dialog.open) dialog.showModal();
        });
        dialog.querySelector(".sim-close").addEventListener("click", () => dialog.close());
        dialog.addEventListener("click", (e) => {
          if (e.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              dialog.close();
          }
        });
      })();
