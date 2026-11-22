// 背景の飾りの描画の中身（浮かぶ桜のガラスの立体・舞う花びら・きらめき）。外部のライブラリは使わない。
// ページの中（js/crystals.js）でも、別の作業場所の Web Worker（js/crystals-worker.js）でも同じものを使う。
// ページ（document・window）には触らない。描き先の canvas と、スクロール量などの値は呼ぶ側から受け取る
self.CrystalsCore = function createCrystals(opts) {
  "use strict";
  const canvas = opts.canvas2d,
    ctx = canvas.getContext("2d"),
    calm = !!opts.calm;
  let dprNow = opts.dpr || 1;
  // 花びらの絵を作る小さな描き先（Worker の中では OffscreenCanvas）
  const makeCanvas = (n) => {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(n, n);
    const cv = document.createElement("canvas");
    cv.width = cv.height = n;
    return cv;
  };
  // 呼ぶ側から受け取る値：スクロール量・本文の左端
  const view = { scrollY: 0, left: 0 };

  // ---------- 形：5枚の花びら（先に小さな切れ込み）の輪郭を、宝石のカットのような立体にする ----------
  function gemOutline(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push([Math.sin(t) * 0.8, Math.cos(t)]);
    }
    return pts;
  }
  // 輪郭から三角形の一覧を作る。縁の斜面（輪郭→内側の輪）と中心の山の2段。裏も同じ形
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
  // 桜の立体（細密）：輪郭を3段（縁・中ほど・頂の手前）に重ね、各花びらの中心に稜線を立てる（宝石のカットのように）。裏も同じ形
  function sakuraMesh(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2,
        f = ((t / (Math.PI * 2)) * 5 + 0.5) % 1,
        u = Math.abs(f - 0.5) * 2,
        petal = 0.42 + 0.58 * Math.pow(Math.cos((u * Math.PI) / 2), 0.55),
        notch = 0.16 * Math.max(0, 1 - u / 0.14),
        r = petal - notch;
      pts.push([Math.sin(t) * r, Math.cos(t) * r, u]);
    }
    // 段ごとの大きさと高さ（稜線：花びらの中心 u=0 で高く、付け根 u=1 で低い）
    const tiers = [
      [1, (u) => 0.05 + 0.05 * (1 - u)],
      [0.76, (u) => 0.15 + 0.06 * (1 - u)],
      [0.44, (u) => 0.24 + 0.04 * (1 - u)],
    ];
    const peak = 0.31,
      at = (i, tier, sgn) => {
        const [x, y, u] = pts[i % n],
          [k, z] = tiers[tier];
        return [x * k, y * k, sgn * z(u)];
      },
      tris = [];
    for (let i = 0; i < n; i++)
      for (const sgn of [1, -1]) {
        const flip = (t) => (sgn > 0 ? t : [t[0], t[2], t[1]]);
        for (let tier = 0; tier < 2; tier++) {
          const a = at(i, tier, sgn),
            b = at(i + 1, tier, sgn),
            p = at(i, tier + 1, sgn),
            q = at(i + 1, tier + 1, sgn);
          tris.push(flip([p, a, b]), flip([p, b, q]));
        }
        tris.push(flip([[0, 0, sgn * peak], at(i, 2, sgn), at(i + 1, 2, sgn)]));
        if (sgn > 0) {
          const a = at(i, 0, 1),
            b = at(i + 1, 0, 1),
            c = at(i, 0, -1),
            d = at(i + 1, 0, -1);
          tris.push([a, c, d], [a, d, b]);
        }
      }
    return tris;
  }
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  // 面の向き（形の中心から外へ）
  function faceNormal(t) {
    const [p0, p1, p2] = t,
      u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
      w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    const m = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }
  const MESH = {
    sakura: sakuraMesh(150),
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

  // ---------- 回転（x → y → z の順。R = Rz・Ry・Rx を行ごとに） ----------
  function rotMatrix(ax, ay, az) {
    const cx = Math.cos(ax),
      sx = Math.sin(ax),
      cy = Math.cos(ay),
      sy = Math.sin(ay),
      cz = Math.cos(az),
      sz = Math.sin(az);
    return [
      [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
      [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
      [-sy, cy * sx, cy * cx],
    ];
  }
  const apply = (R, v) => [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];

  // ---------- WebGL（使えないときは null） ----------
  const gl = (() => {
    const c = opts.canvasGl;
    if (!c) return null;
    let g = null;
    try {
      g = c.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    } catch {
      g = null;
    }
    if (!g) return null;
    const vs = `
      attribute vec3 aPos; attribute vec3 aNor;
      uniform mat3 uRot; uniform vec2 uCenter; uniform float uSize; uniform vec2 uRes;
      varying vec3 vN;
      void main() {
        vec3 p = uRot * aPos;
        vN = uRot * aNor;
        float k = 5.0 / (5.0 - p.z);
        vec2 s = uCenter + vec2(p.x, -p.y) * uSize * k;
        gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, -p.z * 0.3, 1.0);
      }`;
    // 映り込み：明るい紙の空・地平線の暗い帯・オリーブの地面・斜め上の四角い照明。縁は白く光り、薄い虹色がにじむ
    const fs = `
      precision mediump float;
      varying vec3 vN;
      uniform float uGlow;
      vec3 env(vec3 r) {
        // 正面を向いた面には明るい空が映るよう、地平線を少し下げる
        float y = r.y + 0.72;
        vec3 sky = mix(vec3(0.90, 0.89, 0.86), vec3(1.0, 1.0, 0.99), smoothstep(0.05, 0.85, y));
        vec3 ground = mix(vec3(0.33, 0.37, 0.22), vec3(0.80, 0.80, 0.73), smoothstep(-0.95, -0.12, y));
        vec3 c = y > 0.0 ? sky : ground;
        c = mix(c, vec3(0.13, 0.15, 0.10), exp(-pow(y * 14.0, 2.0)) * 0.8);
        float box = smoothstep(0.86, 0.97, dot(r, normalize(vec3(-0.55, 0.62, 0.56))));
        float box2 = smoothstep(0.93, 0.99, dot(r, normalize(vec3(0.7, 0.2, 0.68))));
        return c + vec3(1.0) * box * 0.85 + vec3(0.95, 0.9, 1.0) * box2 * 0.5;
      }
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 v = vec3(0.0, 0.0, 1.0);
        vec3 r = reflect(-v, n);
        vec3 c = env(r);
        float fr = pow(1.0 - max(dot(n, v), 0.0), 2.5);
        vec3 irid = 0.55 + 0.45 * cos(6.2831 * (fr * 1.3 + n.x * 0.25 + vec3(0.0, 0.33, 0.67)));
        c = mix(c, c * irid * 1.15, 0.04 + fr * 0.16);
        c *= mix(vec3(1.0), vec3(1.0, 0.9, 0.93), uGlow * 0.75);
        c = mix(c, vec3(1.0, 0.95, 0.84), fr * 0.45 * uGlow);
        float a = 0.9 + fr * 0.1;
        gl_FragColor = vec4(c * a, a);
      }`;
    const sh = (type, src) => {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
    };
    const v = sh(g.VERTEX_SHADER, vs),
      f = sh(g.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const prog = g.createProgram();
    g.attachShader(prog, v);
    g.attachShader(prog, f);
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) return null;
    g.useProgram(prog);
    const loc = (n) => g.getUniformLocation(prog, n);
    const U = { rot: loc("uRot"), center: loc("uCenter"), size: loc("uSize"), res: loc("uRes"), glow: loc("uGlow") };
    const aPos = g.getAttribLocation(prog, "aPos"),
      aNor = g.getAttribLocation(prog, "aNor");
    const buffers = {};
    for (const [k, tris] of Object.entries(MESH)) {
      const data = new Float32Array(tris.length * 18);
      let o = 0;
      for (const t of tris) {
        const n = faceNormal(t);
        for (const p of t) {
          data.set(p, o);
          data.set(n, o + 3);
          o += 6;
        }
      }
      const b = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, b);
      g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
      buffers[k] = { b, count: tris.length * 3 };
    }
    g.enable(g.DEPTH_TEST);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    return {
      resize(w, h, dpr) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        g.viewport(0, 0, c.width, c.height);
        g.uniform2f(U.res, w, h);
      },
      clear() {
        g.clearColor(0, 0, 0, 0);
        g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      },
      draw(kind, x, y, size, R) {
        const { b, count } = buffers[kind];
        g.clear(g.DEPTH_BUFFER_BIT); // 立体どうしは重ならない前提で、1つずつ奥行きを測り直す
        g.bindBuffer(g.ARRAY_BUFFER, b);
        g.enableVertexAttribArray(aPos);
        g.vertexAttribPointer(aPos, 3, g.FLOAT, false, 24, 0);
        g.enableVertexAttribArray(aNor);
        g.vertexAttribPointer(aNor, 3, g.FLOAT, false, 24, 12);
        // uniformMatrix3fv は列ごとに並べる
        g.uniformMatrix3fv(U.rot, false, [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);
        g.uniform2f(U.center, x, y);
        g.uniform1f(U.size, size);
        g.uniform1f(U.glow, kind === "sakura" ? 1 : 0.7);
        g.drawArrays(g.TRIANGLES, 0, count);
      },
    };
  })();

  // ---------- WebGL が使えないとき：canvas 2D で平らな面に描く ----------
  const L = norm([-0.45, 0.75, 0.55]);
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  function shade2d(n) {
    const r = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
    let c;
    if (r[1] > 0.06) c = mix([232, 231, 222], [252, 252, 248], Math.min(1, (r[1] - 0.06) * 1.6));
    else if (r[1] > -0.2) c = [58, 64, 44];
    else c = mix([122, 132, 92], [196, 198, 180], Math.min(1, (-r[1] - 0.2) * 1.6));
    const spec = Math.pow(Math.max(0, r[0] * L[0] + r[1] * L[1] + r[2] * L[2]), 40);
    return c.map((v) => Math.max(0, Math.min(255, Math.round(v + spec * 260))));
  }
  function draw2d(mesh, cx, cy, size, R) {
    const faces = [];
    for (const t of mesh) {
      const p = t.map((v) => apply(R, v)),
        n = apply(R, faceNormal(t));
      if (n[2] <= 0) continue;
      faces.push({ p, n, z: (p[0][2] + p[1][2] + p[2][2]) / 3 });
    }
    faces.sort((a, b) => a.z - b.z);
    for (const { p, n } of faces) {
      const [r, g, b] = shade2d(n);
      ctx.fillStyle = ctx.strokeStyle = `rgba(${r},${g},${b},0.94)`;
      ctx.beginPath();
      p.forEach((q, i) => {
        const k = 5 / (5 - q[2]),
          x = cx + q[0] * size * k,
          y = cy - q[1] * size * k;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // ---------- 舞う花びら：乱数は種を決めて毎回同じ並びにする ----------
  function seeded(n) {
    let x = n * 9301 + 49297;
    return () => (x = (x * 9301 + 49297) % 233280) / 233280;
  }
  function makePetals(count) {
    const r = seeded(7);
    return Array.from({ length: count }, () => {
      const depth = 0.45 + r() * 0.55; // 奥 0.45 〜 手前 1
      return {
        x: r(),
        y: r(),
        depth,
        size: (12 + r() * 14) * depth * (depth > 0.95 ? 1.6 : 1),
        fall: (14 + r() * 22) * depth, // 1秒に落ちる量（px）
        sway: 18 + r() * 46,
        swayF: 0.25 + r() * 0.45,
        phase: r() * Math.PI * 2,
        spin: (r() - 0.5) * 1.4,
        flipF: 0.5 + r() * 1.3,
        tint: r(),
        curl: (r() - 0.5) * 0.36,
      };
    });
  }
  // 花びら1枚（細密）：付け根の濃い紅から縁の白へ色が移り、細い筋が扇に広がり、縁はうっすら光る。
  // flip で裏返る様子（横に縮む・裏は少し濃い）、curl で左右の非対称（反り）を出す。手前の数枚は少しぼかす
  function paintPetal(c, size, flip, alpha, tint, curl, blur) {
    const w = size * 0.6,
      l = size * 1.3,
      sx = 1,
      back = flip < 0,
      light = 0.86 + 0.14 * flip; // 光の当たり方（表で明るく、裏で暗く）
    c.save();
    if (blur) c.filter = `blur(${blur}px)`;
    // 形：付け根（下）から先（上）へ。先にはっきりした切れ込み。curl で左右の膨らみを変える
    const wl = w * (1 + curl),
      wr = w * (1 - curl);
    const path = () => {
      c.beginPath();
      c.moveTo(0, l * 0.5);
      c.bezierCurveTo(wr * 0.55, l * 0.42, wr * 1.05, l * 0.05, wr * 0.92, -l * 0.22);
      c.bezierCurveTo(wr * 0.82, -l * 0.42, wr * 0.48, -l * 0.52, wr * 0.22, -l * 0.5);
      c.quadraticCurveTo(wr * 0.06, -l * 0.47, 0, -l * 0.36);
      c.quadraticCurveTo(-wl * 0.06, -l * 0.47, -wl * 0.22, -l * 0.5);
      c.bezierCurveTo(-wl * 0.48, -l * 0.52, -wl * 0.82, -l * 0.42, -wl * 0.92, -l * 0.22);
      c.bezierCurveTo(-wl * 1.05, l * 0.05, -wl * 0.55, l * 0.42, 0, l * 0.5);
      c.closePath();
    };
    const tone = (c) => c.map((v, i) => Math.round(Math.min(255, (v + ([236, 228, 206][i] - v) * tint * 0.28) * light)));
    const deep = tone(back ? [206, 128, 146] : [222, 138, 158]),
      mid = tone(back ? [234, 186, 196] : [244, 196, 206]),
      edge = tone(back ? [246, 226, 228] : [255, 244, 244]);
    // 色：付け根を中心に、紅 → 淡い桃 → 白
    const g = c.createRadialGradient(0, l * 0.5, 0, 0, l * 0.5, l * 1.02);
    g.addColorStop(0, `rgba(${deep},${alpha})`);
    g.addColorStop(0.32, `rgba(${mid},${alpha})`);
    g.addColorStop(1, `rgba(${edge},${alpha * 0.92})`);
    path();
    c.fillStyle = g;
    c.fill();
    // 光：片側から差す白いつや
    const gl2 = c.createLinearGradient(-w, 0, w, 0);
    gl2.addColorStop(0, `rgba(255,255,255,0)`);
    gl2.addColorStop(back ? 0.3 : 0.7, `rgba(255,255,255,${0.22 * alpha * light})`);
    gl2.addColorStop(1, `rgba(255,255,255,0)`);
    c.fillStyle = gl2;
    c.fill();
    // 筋：付け根から扇に5本
    c.lineWidth = 0.45 / sx;
    c.strokeStyle = `rgba(196,112,134,${alpha * 0.28})`;
    for (const k of [-0.62, -0.3, 0, 0.3, 0.62]) {
      c.beginPath();
      c.moveTo(0, l * 0.46);
      c.quadraticCurveTo(k * w * 0.35, l * 0.05, k * w * 0.78, -l * (0.3 - Math.abs(k) * 0.12));
      c.stroke();
    }
    // 縁：うっすら光る細い線（透ける薄さ）
    path();
    c.lineWidth = 0.7 / sx;
    c.strokeStyle = `rgba(255,255,255,${alpha * 0.55})`;
    c.stroke();
    c.restore();
  }

  // きらめき：4方向に伸びる細い光（大きな桜のまわりで、ゆっくり明滅する）
  function drawGlint(x, y, r, a) {
    if (a <= 0.02) return;
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    g.addColorStop(0, `rgba(255,250,236,${a})`);
    g.addColorStop(1, "rgba(255,250,236,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(214,196,140,${a * 0.9})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.restore();
  }

  // 花びらの絵（表・裏）を最初に作っておく。ぼかしもここで1回だけ
  function petalSprite(p, flip) {
    const k = Math.min(2, dprNow),
      span = Math.ceil(p.size * 1.9 + 8),
      cv = makeCanvas(Math.ceil(span * k));
    const c = cv.getContext("2d");
    c.scale(k, k);
    c.translate(span / 2, span / 2);
    paintPetal(c, p.size, flip, 0.72 + p.depth * 0.26, p.tint, p.curl, p.depth > 0.95 ? 0.9 : p.depth < 0.55 ? 0.5 : 0);
    return { cv, span };
  }

  // ---------- 大きさ ----------
  let W = 0,
    H = 0,
    items = [],
    petals = [];
  function resize(w, h, dprIn) {
    dprNow = dprIn || 1;
    // 高解像度の画面でも背景は 1.5 倍までで描く（細かく描きすぎると重くなる）
    const dpr = Math.min(1.5, dprNow);
    W = w;
    H = h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gl?.resize(W, H, dpr);
    // スマホ幅では数を減らし、小さくする（文字に重ならないように）
    const narrow = W < 700;
    items = LAYOUT.filter((_, i) => !narrow || i === 0 || i === 2).map((o) => ({
      ...o,
      x: narrow && o.kind === "sakura" ? 0.92 : o.x,
      y: narrow && o.kind === "sakura" ? 0.2 : o.y,
      size: narrow ? W * o.s * 1.4 : Math.min(W, H) * o.s + W * o.s * 0.3,
    }));
    petals = makePetals(narrow ? 12 : 30).map((p) => ({ ...p, front: petalSprite(p, 1), back: petalSprite(p, -1) }));
  }

  // ---------- 毎フレーム ----------
  let easedScroll = null,
    mx = 0,
    my = 0,
    tx = 0,
    ty = 0;
  function draw(time) {
    ctx.clearRect(0, 0, W, H);
    gl?.clear();
    if (easedScroll == null) easedScroll = view.scrollY;
    easedScroll += (view.scrollY - easedScroll) * (calm ? 1 : 0.18);
    const t = time / 1000,
      sc = easedScroll,
      spread = Math.min(1, sc / Math.max(1, H)); // 1画面ぶんスクロールするまでに散る
    mx += (tx - mx) * 0.05;
    my += (ty - my) * 0.05;
    const loop = H * 1.7,
      // 本文の列の左端。ここより外側の余白だけに、端の立体を置く
      left = view.left;
    // 花びら（立体の後ろ）：ゆっくり落ちながら左右にゆれ、回りながら裏返る。スクロールすると少し速く流れる
    const span = H + 60;
    for (const p of petals) {
      const yy = ((((p.y * span + t * p.fall + sc * 0.25 * p.depth) % span) + span) % span) - 30,
        xx = p.x * W + Math.sin(t * p.swayF + p.phase) * p.sway + mx * 24 * p.depth,
        rot = p.phase + t * p.spin + Math.sin(t * p.swayF + p.phase) * 0.6,
        flip = Math.cos(t * p.flipF + p.phase);
      const sp = flip < 0 ? p.back : p.front;
      ctx.save();
      ctx.translate(xx, yy);
      ctx.rotate(rot);
      ctx.scale(Math.max(0.1, Math.abs(flip)), 1);
      ctx.drawImage(sp.cv, -sp.span / 2, -sp.span / 2, sp.span, sp.span);
      ctx.restore();
    }
    for (const o of items) {
      // 最初の大きな桜はヒーローの「俸給を調べる」の後ろだけ（繰り返して本文に重ねない）
      if (o.hero && o.y * H - sc * o.par < -o.size * 2) continue;
      const bob = Math.sin(t * 0.7 + o.x * 9) * 10;
      let y = o.y * H - sc * o.par + bob;
      if (!o.hero) {
        y = ((((y + H * 0.35) % loop) + loop) % loop) - H * 0.35; // 上へ出たら下から戻る
        if (left < o.size * 2.3) continue; // 端の余白が狭いときは描かない（文字に重ねない）
      }
      const x = o.hero ? o.x * W + o.drift * spread * W * 0.03 + mx * 14 * o.par : o.x < 0.5 ? left / 2 : W - left / 2;
      // 桜は正面を向けたまま面の中で回し、ゆらゆらと傾ける。宝石は丸ごと回す
      const flower = o.kind === "sakura",
        ax = (flower ? 0.35 : 0.5) + Math.sin(t * 0.3 + o.tilt) * (flower ? 0.3 : 0.35) + my * 0.25 + sc * 0.0008 * o.drift,
        ay = flower ? Math.sin(t * 0.37 + o.x * 5) * 0.45 + mx * 0.3 + spread * 0.5 * o.drift : t * o.spin + sc * 0.002 * o.par + mx * 0.3,
        az = flower ? t * o.spin * 0.5 + sc * 0.0015 * o.drift : o.tilt * 0.4 + spread * 0.6 * o.drift;
      // 下に落ちる淡い影（2D）
      const g = ctx.createRadialGradient(x, y + o.size * 1.15, 0, x, y + o.size * 1.15, o.size * 1.1);
      g.addColorStop(0, "rgba(27,30,23,0.1)");
      g.addColorStop(1, "rgba(27,30,23,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y + o.size * 1.15, o.size * 1.1, o.size * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      const R = rotMatrix(ax, ay, az);
      // 大きな桜：花びらの先のあたりに、きらめきを5つ（順にゆっくり明滅）
      if (o.hero)
        for (let k = 0; k < 5; k++) {
          const ang = az + (k * Math.PI * 2) / 5 + 0.25,
            rr = o.size * (1.12 + 0.06 * Math.sin(t * 0.5 + k));
          drawGlint(x + Math.sin(ang) * rr, y - Math.cos(ang) * rr * Math.cos(ax), 7 + 3 * k % 4, Math.max(0, Math.sin(t * 0.9 + k * 1.3)) * 0.9);
        }
      if (gl) gl.draw(o.kind, x, y, o.size, R);
      else draw2d(MESH[o.kind], x, y, o.size, R);
    }
  }

  return {
    resize,
    draw,
    setView(v) {
      Object.assign(view, v);
    },
    setPointer(x, y) {
      tx = x;
      ty = y;
    },
  };
};
