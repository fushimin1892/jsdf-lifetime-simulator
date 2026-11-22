// 背景に浮かぶ桜の形のクロームの立体（飾り）。外部のライブラリを使わず、canvas 2D に三角形を並べて描く。
// ・ゆっくり回りながら上下にただよい、スクロールすると速さの違う動きで散っていく（参考：mesh3d.gallery の Daiki Fujita のサイト）
// ・動きを減らす設定のときは、止まった1枚だけを描く。シミュレーターを開いている間と、タブが裏にあるときは描かない
// ・利用者の入力は読まない・送らない
(() => {
  "use strict";
  const canvas = document.querySelector(".bg-scene .crystals");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches,
    // 読み込んだときのブラウザの関数を持っておく（あとで置き換えられても、描く間隔が変わらないように）
    raf = window.requestAnimationFrame.bind(window);

  // ---------- 形：5枚の花びら（先に小さな切れ込み）の輪郭を、表と裏に尖らせた宝石のような立体にする ----------
  function sakuraOutline(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2,
        f = ((t / (Math.PI * 2)) * 5 + 0.5) % 1, // 花びらの中での位置（0.5 が先端）
        u = Math.abs(f - 0.5) * 2, // 先端 0 → 付け根 1
        petal = 0.42 + 0.58 * Math.pow(Math.cos((u * Math.PI) / 2), 0.55),
        notch = 0.16 * Math.max(0, 1 - u / 0.14);
      const r = petal - notch;
      pts.push([Math.sin(t) * r, Math.cos(t) * r]);
    }
    return pts;
  }
  function gemOutline(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push([Math.sin(t) * 0.8, Math.cos(t)]);
    }
    return pts;
  }
  // 輪郭から三角形の一覧を作る。宝石のカットのように、縁の斜面（輪郭→内側の輪）と中心の山の2段にする。裏も同じ形
  function buildMesh(outline, peak, rim, inner) {
    const tris = [],
      n = outline.length,
      top = [0, 0, peak],
      bottom = [0, 0, -peak],
      ringZ = rim + (peak - rim) * 0.62;
    const at = (i, k, z) => [outline[i % n][0] * k, outline[i % n][1] * k, z];
    for (let i = 0; i < n; i++) {
      const a = at(i, 1, rim),
        b = at(i + 1, 1, rim),
        p = at(i, inner, ringZ),
        q = at(i + 1, inner, ringZ),
        c = at(i, 1, -rim),
        d = at(i + 1, 1, -rim),
        pb = at(i, inner, -ringZ),
        qb = at(i + 1, inner, -ringZ);
      tris.push([top, p, q], [p, a, b], [p, b, q]);
      tris.push([bottom, qb, pb], [pb, d, c], [pb, qb, d]);
      if (rim > 0) tris.push([a, c, d], [a, d, b]);
    }
    return tris;
  }
  const MESH = {
    sakura: buildMesh(sakuraOutline(60), 0.3, 0.07, 0.5),
    gem: buildMesh(gemOutline(8), 0.62, 0, 0.55),
  };

  // ---------- 置き場所：画面の幅・高さに対する割合。par はスクロールに対する動きの速さ ----------
  // 文字の多い真ん中は空け、左右の端に寄せる（大きいものは「俸給を調べる」のすりガラスの後ろ）
  const LAYOUT = [
    { kind: "sakura", hero: true, x: 0.84, y: 0.36, s: 0.15, par: 0.35, spin: 0.22, tilt: 0.5, drift: -1 },
    { kind: "sakura", x: 0.04, y: 0.86, s: 0.07, par: 0.6, spin: -0.3, tilt: -0.7, drift: 1 },
    { kind: "gem", x: 0.955, y: 0.72, s: 0.035, par: 0.9, spin: 0.6, tilt: 1.1, drift: -1 },
    { kind: "sakura", x: 0.95, y: 1.4, s: 0.08, par: 0.5, spin: 0.26, tilt: 0.9, drift: 1 },
    { kind: "gem", x: 0.045, y: 0.26, s: 0.03, par: 1.1, spin: -0.5, tilt: -0.4, drift: 1 },
  ];

  let W = 0,
    H = 0,
    dpr = 1,
    items = [],
    petals = [];
  // ---------- 舞う花びら：乱数は種を決めて毎回同じ並びにする ----------
  function seeded(n) {
    let x = n * 9301 + 49297;
    return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  }
  function makePetals(count) {
    const r = seeded(7);
    return Array.from({ length: count }, () => {
      const depth = 0.45 + r() * 0.55; // 奥 0.45 〜 手前 1
      return {
        x: r(),
        y: r(),
        depth,
        size: (13 + r() * 13) * depth,
        fall: (14 + r() * 22) * depth, // 1秒に落ちる量（px）
        sway: 18 + r() * 46,
        swayF: 0.25 + r() * 0.45,
        phase: r() * Math.PI * 2,
        spin: (r() - 0.5) * 1.4,
        flipF: 0.5 + r() * 1.3,
        tint: r(),
      };
    });
  }
  // 花びら1枚：付け根から先へふくらみ、先に小さな切れ込み。flip で裏返る様子（横に縮む）を出す
  function drawPetal(x, y, size, rot, flip, alpha, tint) {
    const w = size * 0.62,
      l = size * 1.25,
      sx = Math.max(0.08, Math.abs(flip)),
      back = flip < 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx, 1);
    const g = ctx.createLinearGradient(0, l * 0.5, 0, -l * 0.5);
    const base = back ? [214, 160, 166] : [232, 176, 182],
      tip = back ? [240, 214, 214] : [252, 234, 234],
      mixc = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * tint * 0.35));
    g.addColorStop(0, `rgba(${mixc(base, [214, 206, 180]).join(",")},${alpha})`);
    g.addColorStop(1, `rgba(${mixc(tip, [244, 240, 226]).join(",")},${alpha})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, l * 0.5);
    ctx.bezierCurveTo(w, l * 0.25, w * 0.95, -l * 0.32, w * 0.28, -l * 0.5);
    ctx.lineTo(0, -l * 0.38);
    ctx.lineTo(-w * 0.28, -l * 0.5);
    ctx.bezierCurveTo(-w * 0.95, -l * 0.32, -w, l * 0.25, 0, l * 0.5);
    ctx.closePath();
    ctx.fill();
    // 真ん中の細い筋
    ctx.strokeStyle = `rgba(184,140,140,${alpha * 0.35})`;
    ctx.lineWidth = 0.6 / sx;
    ctx.beginPath();
    ctx.moveTo(0, l * 0.45);
    ctx.lineTo(0, -l * 0.3);
    ctx.stroke();
    ctx.restore();
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // スマホ幅では数を減らし、小さくする（文字に重ならないように）
    const narrow = W < 700;
    items = LAYOUT.filter((_, i) => !narrow || i === 0 || i === 2).map((o) => ({
      ...o,
      x: narrow && o.kind === "sakura" ? 0.92 : o.x,
      y: narrow && o.kind === "sakura" ? 0.2 : o.y,
      size: narrow ? W * o.s * 1.4 : Math.min(W, H) * o.s + W * o.s * 0.3,
    }));
    petals = makePetals(narrow ? 10 : 24);
    if (calm) draw(0);
  }

  // ---------- 色：クロームの映り込み（空・地平線・地面）と、オリーブの淡い色かぶり ----------
  const L = norm([-0.45, 0.75, 0.55]);
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function shade(n) {
    // 視線は (0,0,1)。映り込む向き r = 2(n·v)n − v
    const r = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
    let c;
    if (r[1] > 0.06) {
      const k = Math.min(1, (r[1] - 0.06) * 1.6);
      c = mix([232, 231, 222], [252, 252, 248], k); // 空
    } else if (r[1] > -0.2) {
      c = [58, 64, 44]; // 地平線の暗い帯（クロームらしさ）
    } else {
      const k = Math.min(1, (-r[1] - 0.2) * 1.6);
      c = mix([122, 132, 92], [196, 198, 180], k); // 地面（オリーブ）
    }
    // 横向きの面に、わずかな青と紫のにじみ
    c = [c[0] + r[0] * 10, c[1] - Math.abs(r[0]) * 4, c[2] + r[0] * 22];
    const spec = Math.pow(Math.max(0, r[0] * L[0] + r[1] * L[1] + r[2] * L[2]), 40);
    return c.map((v) => Math.max(0, Math.min(255, Math.round(v + spec * 260))));
  }
  function mix(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  // ---------- 1つの立体を描く ----------
  function rotate(p, ax, ay, az) {
    let [x, y, z] = p;
    let c = Math.cos(ax),
      s = Math.sin(ax);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ay);
    s = Math.sin(ay);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(az);
    s = Math.sin(az);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }
  function drawItem(mesh, cx, cy, size, ax, ay, az) {
    // 下に落ちる淡い影
    const g = ctx.createRadialGradient(cx, cy + size * 1.15, 0, cx, cy + size * 1.15, size * 1.1);
    g.addColorStop(0, "rgba(27,30,23,0.1)");
    g.addColorStop(1, "rgba(27,30,23,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 1.15, size * 1.1, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    const faces = [];
    for (const t of mesh) {
      const p = t.map((v) => rotate(v, ax, ay, az));
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]],
        w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      let n = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
      const m = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
      // 外向きにそろえる（形の中心から外へ）
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
      if (n[2] <= 0) continue; // 裏を向いた面は描かない
      faces.push({ p, n, z: m[2] });
    }
    faces.sort((a, b) => a.z - b.z);
    const f = 5;
    for (const { p, n } of faces) {
      const [r, gg, b] = shade(n);
      ctx.fillStyle = `rgba(${r},${gg},${b},0.94)`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const k = f / (f - p[i][2]),
          x = cx + p[i][0] * size * k,
          y = cy - p[i][1] * size * k;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // ---------- 毎フレーム ----------
  let mx = 0,
    my = 0,
    tx = 0,
    ty = 0;
  function draw(time) {
    ctx.clearRect(0, 0, W, H);
    const t = time / 1000,
      sc = window.scrollY || 0,
      spread = Math.min(1, sc / Math.max(1, H)); // 1画面ぶんスクロールするまでに散る
    mx += (tx - mx) * 0.05;
    my += (ty - my) * 0.05;
    const loop = H * 1.7,
      // 本文の列の左端（ここより外側の余白だけに、端の立体を置く）
      left = Math.max(0, document.querySelector("main.layout")?.getBoundingClientRect().left || 0) + 24,
      gutter = left - 24; // 本文の外の余白の幅
    for (const o of items) {
      // 最初の大きな桜はヒーローの「俸給を調べる」の後ろだけ（繰り返して本文に重ねない）
      if (o.hero) {
        const yh = o.y * H - sc * o.par;
        if (yh < -o.size * 2) continue;
      }
      const bob = Math.sin(t * 0.7 + o.x * 9) * 10;
      let y = o.y * H - sc * o.par + bob;
      if (!o.hero) {
        y = ((((y + H * 0.35) % loop) + loop) % loop) - H * 0.35; // 上へ出たら下から戻る
        // 端の余白が立体より狭いときは描かない（文字に重ねない）
        if (gutter < o.size * 2.3) continue;
      }
      const x = (o.hero ? o.x * W : o.x < 0.5 ? (left - 24) / 2 + 12 : W - (left - 24) / 2 - 12) + (o.hero ? o.drift * spread * W * 0.03 + mx * 14 * o.par : 0);
      // 桜は正面を向けたまま面の中で回し、ゆらゆらと傾ける（横から見ると花の形がわからないため）。宝石は丸ごと回す
      const flower = o.kind === "sakura",
        ax = (flower ? 0.35 : 0.5) + Math.sin(t * 0.3 + o.tilt) * (flower ? 0.3 : 0.35) + my * 0.25 + sc * 0.0008 * o.drift,
        ay = flower ? Math.sin(t * 0.37 + o.x * 5) * 0.45 + mx * 0.3 + spread * 0.5 * o.drift : t * o.spin + sc * 0.002 * o.par + mx * 0.3,
        az = flower ? t * o.spin * 0.5 + sc * 0.0015 * o.drift : o.tilt * 0.4 + spread * 0.6 * o.drift;
      drawItem(MESH[o.kind], x, y, o.size, ax, ay, az);
    }
    // 花びら：ゆっくり落ちながら左右にゆれ、回りながら裏返る。スクロールすると少し速く流れる
    const span = H + 60;
    for (const p of petals) {
      const yy = ((((p.y * span + t * p.fall + sc * 0.25 * p.depth) % span) + span) % span) - 30,
        xx = p.x * W + Math.sin(t * p.swayF + p.phase) * p.sway + mx * 24 * p.depth,
        rot = p.phase + t * p.spin + Math.sin(t * p.swayF + p.phase) * 0.6,
        flip = Math.cos(t * p.flipF + p.phase);
      drawPetal(xx, yy, p.size, rot, flip, 0.7 + p.depth * 0.28, p.tint);
    }
  }

  resize();
  addEventListener("resize", resize, { passive: true });
  if (calm) {
    addEventListener("scroll", () => draw(0), { passive: true });
    return;
  }
  addEventListener(
    "pointermove",
    (e) => {
      tx = (e.clientX / Math.max(1, W)) * 2 - 1;
      ty = (e.clientY / Math.max(1, H)) * 2 - 1;
    },
    { passive: true },
  );
  const loopFrame = (time) => {
    // シミュレーターなどの画面を開いている間と、タブが裏にあるときは描かない
    if (!document.hidden && !document.querySelector("dialog[open]")) draw(time);
    raf(loopFrame);
  };
  raf(loopFrame);
})();
