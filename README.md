# 自衛官 給料表ナビ

階級と号俸から俸給月額を確認し、昇任・賞与・手当を含む生涯年収を試算するブラウザ向けアプリです。

公開先: https://fushimin1892.github.io/jsdf-lifetime-simulator/

## 開発時の確認

リポジトリのルートで `python -m http.server 8000` を実行し、ブラウザで `http://localhost:8000/` を開きます。終了は Ctrl+C です。

検査はリポジトリのルートで `node test/check.js`（データと、画面の説明文の数値が `assets/data/rules.js` と同じか。NG 0 で合格）、`node tools/egov-check.js all`（e-Gov の条文との照合。区分と値を組で照合する。終了コード 3 は e-Gov を取得できず照合を終えていない）、`node test/regression.js`（計算結果の回帰。Playwright が必要）、`node test/audit/run.js`（機能全体の点検：計算約2万件・手当・画面・検算。約3〜5分。`--quick` で短い版）、`node test/security.js`（セキュリティ：危ない書き方・外部通信・秘密情報・HTML の差し込みの検査。Playwright が必要）。法令の改正を反映する手順は [改正対応の手順書](AI用/改正対応の手順書.md) にまとめています。

計算結果を変更前後で比べる手順は [AI向け改修ガイド](AI用/AI向け改修ガイド.md) と [検証用スクリプト](AI用/検証用スクリプト.js) を参照してください。検証用スクリプトはブラウザのコンソールで実行します。

## ファイル構成

- `index.html` — 画面の構造
- `assets/css/` — 画面と印刷用のスタイル
- `assets/data/` — 俸給表、昇任表、計算に使う規則、出典の一覧（`sources.js`。画面では読み込まない）
- `assets/js/` — 試算、俸給の検索、画面操作、印刷
- `icons/` — アイコン画像
- `test/` — データの検査（`check.js`）と計算結果の回帰テスト（`regression.js`・`expected.json`）
- `tools/` — e-Gov との照合（`egov-check.js`・`value-checks.js`）
- `AI用/` — 修正ガイド、改正対応の手順書、検証用スクリプト

ビルドは不要です。ローカルで確認する場合は、このディレクトリを静的サーバーで配信して開きます。
