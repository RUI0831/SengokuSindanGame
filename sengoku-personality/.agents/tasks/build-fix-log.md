# build-fix-log

## 第 1 回(build-review.json なし: FEAT 間の統合の確認)

日付: 2026-10-09(PC の日付)。Chrome 154.0.8037.98、Edge 154.0.4258.62、Node v24.15.0。

### 修正前の検証

すべての検証コマンドが成功した(Chrome・Edge とも 144 checks ALL PASS、http smoke 29 checks、simulate ALL PASS、check-static OK)。FAIL はなかった。

### 継ぎ目の確認で見つけた不具合と修正

1. **ダイアログを開いたままだと無操作の警告が見えず、押せない**(app.js の `#idle-toast` と results.js の `<dialog>.showModal()` の継ぎ目。AC-20、設計書 B-4 の「RESULT/RANKING(開いているダイアログを含む)」)。
   `showModal()` のダイアログはトップレイヤーに出るので、body にある `#idle-toast`(z-index 50)は背景の暗幕の下に隠れる。調べた結果: 詳細ダイアログを開いた状態で警告を出すと、「続ける」の中心座標の `elementFromPoint` はダイアログ内の `.mini-row` で、警告は画面に写らなかった。既存の idle シナリオは「ダイアログ表示中も満了で戻る」だけを見ていて、警告が見えることは確かめていなかった。
   修正(`js/app.js`): `showIdleToast()` は、開いている `dialog[open]` があれば警告をそのダイアログの中へ移してから表示する。`hideIdleToast()` は非表示にして body へ戻す。入力(pointerdown/keydown など)のたびに `armIdleTimer()` → `hideIdleToast()` が先に動くので、ダイアログが閉じて中身が `replaceChildren()` される前に戻る。満了時は `reset()` の `closeAllDialogs()` で外れた要素を、続く `hideIdleToast()` が body へ戻す。文言・時間・タイマーの動きは変えていない(設計どおり警告が見えるようになっただけ)。
2. **ダイアログを開いたまま想定外の例外が起きると、`#fatal` がダイアログの下に隠れて「最初に戻る」を押せない**(同じトップレイヤーの問題)。
   修正(`js/app.js`): `showFatal()` の最初で `SG.Results.closeAllDialogs()`(例外は握りつぶして表示を優先)と `hideIdleToast()` を呼ぶ。

テストの追加(`tools/browser-check.js`。閾値は変えていない):
- idle: ダイアログ表示中の警告で、「続ける」の中心の `elementFromPoint` が「続ける」ボタンで、表示領域内にある/クリックするとダイアログは開いたまま警告が消え、警告が body に戻る/ダイアログ表示中の満了のあとも警告は body に戻り非表示(+3 checks。修正前のコードでは 1 つ目が FAIL になることを上の調査で確認)。
- dialog: ダイアログ表示中に `setTimeout` で例外を投げると、ダイアログが閉じて `#fatal-restart` を押せ、押すと START に戻る(+3 checks。意図的な例外のログだけを許可リストに入れた)。

### そのほかに確かめたこと(問題なし)

- README と実装: `CONFIG` の 4 項目と既定値、質問データの書式(`q('q1', …)`、配点 −2〜+3、30/26 文字)、`EXPECTED_GENERAL_COUNT`、武将の値の範囲 19〜73・信長の革新性 67、画像は全員 `image: null`、ランキングの開き方とリセット手順、localStorage の非共有。すべて一致。
- 要件 §18 の 14 項目と plan.md 4 章の AC: すべて simulate・check-static・browser-check のどれかで検査されている(README 13 章の対応表どおり)。
- index.html の script の順序・`SG.Results` / `SG.App` / `SG.ShareCard` の契約(FEAT-002・003 で足した任意の `filename`・`opener`・`user` 引数を含む)。

### 修正後の検証(RESULT 行)

| コマンド | RESULT |
|---|---|
| `node --check`(js 11 本・tools 3 本) | 14 本すべて成功 |
| `node tools\simulate.js` | `RESULT: ALL PASS (warnings: 0)`(exit 0) |
| `node tools\check-static.js` | `check-static: OK (13 files)`(exit 0) |
| `node tools\browser-check.js --browser chrome --screenshots "<ROOT>\.agents\tasks\screens\chrome"` | `RESULT: ALL PASS (150 checks)`(exit 0) |
| `node tools\browser-check.js --browser edge --screenshots "<ROOT>\.agents\tasks\screens\edge"` | `RESULT: ALL PASS (150 checks)`(exit 0) |
| `node tools\browser-check.js --browser chrome --http --scenario smoke` | `RESULT: ALL PASS (29 checks)`(exit 0) |

README の動作確認記録(13 章)の検査数・実測値・「確認中に見つけて直したこと」を更新した。調査用の `tools\__probe.js` と一時フォルダは削除済み。

## 第 2 回(build-review.json の指摘 5 件: MEDIUM 2・NIT 3)

1. **[MEDIUM] ランキングのタブにキーボードで届かない**(js/results.js): ロービング tabindex はそのままにして、`renderRankingScreen` の `rootEl` に keydown 委譲を足した。タブ上で ArrowRight/ArrowLeft(循環)・Home・End を受けると `view.scope` を変えて `draw()` し、新しいタブにフォーカスを移す(`preventDefault` 付き)。マウスの動きは変えていない。
   テスト(tools/browser-check.js): `page.key` に ArrowLeft/ArrowRight/Home/End を追加。keyboard シナリオで、結果画面から Enter でランキングへ → Tab で選択中のタブに届く → →→→←・Home・End でフォーカスと選択が `today→date→total→today→total→today→total` と移る、選んだタブの見出しが表示される、Enter の「戻る」で結果へ(+2 checks)。
2. **[MEDIUM] PC 幅で本文 16px**(css/style.css): `@media (min-width:1024px)` に `body, .reason, .result-desc, .dlg-body { font-size: 18px; }` を足した。スマホ側(16px)と質問画面の 480px 以下の規則は変えていない。
   テスト: layout シナリオに NFR-4 の検査を追加(body・`.reason p`・`.result-desc`・詳細ダイアログの `li` の computed font-size が 1280 幅で 18px 以上、390 幅で 16px 以上。実測 1280: すべて 18、390: すべて 16。+1 check)。1280 幅の結果画面・詳細ダイアログのスクリーンショットを目視し、崩れ・はみ出しがないことを確認した。
3. **[NIT] 理由文 P3 の「〜がほどよいで、」**(js/reason.js): `GENERAL_WORDS.mid` を「ほどよい」→「中くらい」にし、P3 の後半を「{軸B}も{語B}のタイプです。」にした(例:「豊臣秀吉も診断上は社交性が高めで、行動力も高めのタイプです。」)。P1 の `PHRASES` は変えていない。
   テスト(tools/simulate.js #11): (d) の期待文字列を「のタイプです。」に合わせ、(d2)「形容詞+で、」「の なしのタイプです」が P3 にないことの検査を足した(4,000 件+60,000 件で違反 0)。
4. **[NIT] 「独眼竜」**(js/generals.js): 伊達政宗の events を「隻眼であったことから、のちに「独眼竜」と呼ばれるようになった」に変えた。
5. **[NIT] README の画像生成時間**(README.md 13 章 card 行): 「Chrome 0.3〜1.8 秒 / Edge 1.7〜1.9 秒(複数回の実測の範囲。目安は 2 秒以内)」にした。今回の実測は Chrome 1169ms、Edge 1689ms で範囲内。

README 13 章も更新した: browser-check の検査数 150→153、layout 9→10・keyboard 6→8 の内容、#11 の確認内容、「確認中に見つけて直したこと」に (6)〜(8)。

### 修正後の検証(RESULT 行)

| コマンド | RESULT |
|---|---|
| `node --check`(js 11 本・tools 3 本) | 14 本すべて成功 |
| `node tools\simulate.js` | `RESULT: ALL PASS (warnings: 0)`(exit 0) |
| `node tools\check-static.js` | `check-static: OK (13 files)`(exit 0) |
| `node tools\browser-check.js --browser chrome --screenshots "<ROOT>\.agents\tasks\screens\chrome"` | `RESULT: ALL PASS (153 checks)`(exit 0) |
| `node tools\browser-check.js --browser edge --screenshots "<ROOT>\.agents\tasks\screens\edge"` | `RESULT: ALL PASS (153 checks)`(exit 0) |
| `node tools\browser-check.js --browser chrome --http --scenario smoke` | `RESULT: ALL PASS (29 checks)`(exit 0) |


## 来場者向けランキング FEAT-002(browser-check と README)
- tools/browser-check.js に player-ranking シナリオ(28 項目)を追加。screens に来場者向けの撮影を追加。
- 検証: simulate=ALL PASS、check-static=OK (14 files)、browser-check chrome/edge=ALL PASS (184 checks)、chrome --http smoke=ALL PASS (29 checks)。
- README の 4 章・ファイル構成表・13 章を更新。


## 戦国武将図鑑の追加(zukan)
- 追加: js/zukan.js、#screen-zukan、スタート/結果画面のボタン。js/results.js は portraitHtml/attachImageFallback を export し、openGeneralDialog に options.nav(前/次)を追加(既存呼び出しは不変)。
- 検証(すべて実行済み): node tools\simulate.js → ALL PASS(#19 追加)、node tools\check-static.js → OK (15 files)、browser-check Chrome 235 checks ALL PASS / Edge 235 checks ALL PASS(zukan シナリオ 51 件)、--http smoke 29 checks ALL PASS。
- スクリーンショット: .agents\tasks\screens\{chrome,edge}\ の zukan-*, start-zukan-*, result-zukan-button-* を 1280x800/390x844 で目視。
- 補足: 生年不詳の明智光秀は「生まれた順」の末尾。モーダル内の Tab はブラウザ側(body)を一周時に経由するため、検査は「背景のカードへ出ない」ことを確認。
- 未確認: 実機スマホ、Firefox/Safari、スクリーンリーダー読み上げ。git リポジトリではないためコミットなし。