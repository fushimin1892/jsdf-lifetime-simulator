// フォントを「このサイトで使う文字だけ」に絞って fonts/ に置く。
// 使い方：node tools/font-subset.js <NotoSansJP[wght].ttf> <JetBrainsMono[wght].ttf>
//   元のフォントは Google Fonts の公式 GitHub（github.com/google/fonts の ofl/notosansjp・ofl/jetbrainsmono）から取る（OFL）。
//   絞るのに Python の fonttools と brotli が要る（python -m pip install fonttools brotli）。
// 文言を足して新しい漢字などが増えたら、もう一度これを実行する（test/check.js が fonts/charset.txt にない文字を知らせる）。
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const [noto, mono] = process.argv.slice(2);
if (!noto || !mono) {
  console.error("使い方：node tools/font-subset.js <NotoSansJP[wght].ttf> <JetBrainsMono[wght].ttf>");
  process.exit(1);
}

// 画面に出る文字が入っているファイル（コメントの文字も入るが、増えるのはわずか）
function siteFiles() {
  const list = ["index.html"];
  for (const dir of ["js", "data", "css"]) for (const f of fs.readdirSync(path.join(root, dir))) if (/\.(js|css)$/.test(f)) list.push(path.join(dir, f));
  return list;
}
function siteChars() {
  const set = new Set();
  for (let c = 0x20; c <= 0x7e; c++) set.add(String.fromCodePoint(c)); // 英数字と記号はすべて
  for (const ch of "　、。・「」『』（）［］【】〜ー－―…‥％＋−×÷＝≒≦≧→←↑↓↔○●◎△▲▼◆◇□■※✓✗①②③④⑤⑥⑦⑧⑨⑩") set.add(ch);
  for (const f of siteFiles()) for (const ch of fs.readFileSync(path.join(root, f), "utf8")) if (ch.codePointAt(0) > 0x7e) set.add(ch);
  return [...set].filter((ch) => !/[\u0000-\u001f\ud800-\udfff]/.test(ch)).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

const out = path.join(root, "fonts");
fs.mkdirSync(out, { recursive: true });
const chars = siteChars();
fs.writeFileSync(path.join(out, "charset.txt"), chars.join("") + "\n");
const textFile = path.join(out, ".chars.tmp");
fs.writeFileSync(textFile, chars.join(""));
const subset = (src, dest, extra = []) =>
  execFileSync("python", ["-m", "fontTools.subset", src, `--text-file=${textFile}`, "--flavor=woff2", `--output-file=${dest}`, "--layout-features=*", "--no-hinting", ...extra], { stdio: "inherit" });
try {
  subset(noto, path.join(out, "noto-sans-jp.woff2"));
  // 等幅は英数字と記号だけ（ラベルは英字）
  fs.writeFileSync(textFile, chars.filter((ch) => ch.codePointAt(0) < 0x2000).join(""));
  subset(mono, path.join(out, "jetbrains-mono.woff2"));
} finally {
  fs.unlinkSync(textFile);
}
for (const f of ["noto-sans-jp.woff2", "jetbrains-mono.woff2"]) console.log(`${f}：${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`);
console.log(`文字数：${chars.length}`);
