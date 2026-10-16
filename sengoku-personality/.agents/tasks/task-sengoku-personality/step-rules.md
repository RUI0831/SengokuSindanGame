# 全ステップ共通のルール(実装・修正・確認の担当が読む)

ROOT = `c:\Users\村上琉伊\Desktop\大学祭\性格診断ゲーム戦国武将バージョン\sengoku-personality`

## パスとコマンド
- ワークスペースのルートは ROOT の親フォルダ。相対パスで書いたファイルは親フォルダに落ちるので、ファイル操作は常に絶対パスで行う。コマンドは `cwd` に ROOT を渡す。
- Windows PowerShell。区切りは `;` を使い、`&&` は使わない。日本語を含むパスは必ず引用符で囲む。
- ファイルは書き込みツールで UTF-8 で作る(`Set-Content`・`Out-File`・`echo >` は使わない)。
- 長く動くプロセスはバックグラウンドで起動し、最後に必ず終了する。ブラウザは自分が起動した PID だけを終了する(`Stop-Process -Name chrome`・`msedge` は禁止)。
- git リポジトリではない。`git init`・コミット・push はしない。進捗は FEAT ファイルの `status`/`findings` に書く。
- `design.md`・`design-review.md`・`design-review.json` は上書きしない。

## 絶対制約(要約。詳しくは plan.md の冒頭と 1 章)
- HTML5/CSS3/バニラ JS だけを使う。外部 API・DB・バックエンド・CDN・外部フォントは使わない。完全オフラインで動くこと。
- file:// で動くように classic `<script>` だけを使う(ES Modules と fetch は使わない)。npm 依存はゼロ。データは JS ファイルに置き、UMD 風にエクスポートする。
- 質問・武将・診断ロジック・表示処理はファイルを分ける。状態は `answers` だけで持ち、スコアは毎回全計算する。
- アプリ本体に、乱数や日時で結果が変わる処理を入れない。分布の調整は配点と武将パラメータのデータだけで行う。結果の後操作は禁止。
- 重要な処理には日本語のコメントを書く。ライセンスを確認できない画像は使わない(武将の画像は crest.js の自作 SVG)。
- アプリのコードには、コメントも含めて `http(s)://` を書かない(SVG 名前空間だけは可)。`?.`・`??`・`import`/`export` も書かない。

## 検証コマンド(cwd=ROOT)
- `node --check js\<file>.js`(変更した JS ごとに実行する)
- `node tools\simulate.js` → exit 0、`RESULT: ALL PASS`
- `node tools\check-static.js` → exit 0
- `node tools\browser-check.js --browser chrome [--scenario <name>] [--screenshots "<ROOT>\.agents\tasks\screens\<dir>"] [--skip-long]` → exit 0
- `node tools\browser-check.js --browser edge …`、`node tools\browser-check.js --browser chrome --http --scenario smoke`
- スクリーンショットは `read_file` で画像として目視する。

## 禁止
- テストの閾値を緩める、テストを省く、結果を固定値にするなどして、検査を通すこと。FAIL は原因を直す。
- 要件・設計にない機能を足すこと(plan.md 1.4 に書いた追加は除く)。
