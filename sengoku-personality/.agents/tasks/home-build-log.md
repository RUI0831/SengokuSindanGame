# 診断中のホームへ戻る 実装ログ (home-build-log.md)

## イテレーション 1(初回実装)

### 変更ファイル
- index.html: 質問画面の `.q-head-row` 右端と、診断演出画面の左上に「ホームへ戻る」ボタン(`data-action="home"`、家型 SVG アイコン)を追加
- css/style.css: `.btn-home`(墨地+金の細罫、最小 44px、reduced-motion は既存の全体ルールで無効化)、`.btn-home-corner`、`.screen-analyzing` に `position: relative`
- js/app.js: `onHome()`(確認 → 確定で既存の `reset()`)、`state.homeAsking`、`runOrDefer()` / `deferred`(ダイアログ表示中に満了した「次の問へ」「結果表示」を保留し「続ける」で再開、リセットで破棄)、`idleLimit()` に確認ダイアログ中の無操作時間、`getState()` に homeAsking
- js/results.js: 既存の `confirm()` を再利用。`cancelLabel`(ボタン文言)と `backdropGuardMs`(開いた直後の背景クリック無視。ダブルクリック対策。省略時 0 で既存の挙動のまま)を追加。確認ダイアログに Tab のフォーカストラップを追加
- tools/browser-check.js: シナリオ `home`(43 チェック)を追加
- README.md: 「診断中のホームへ戻る」節を追加、無操作リセットの説明に確認ダイアログ中の例外を追記
- 診断ロジック(diagnosis / generals / questions)・storage・結果画面のボタンは未変更。ルートの vercel.json / .vercelignore / .vercel は未接触、デプロイ未実行

### 設計の要点
- 確定は既存の `reset()` をそのまま呼ぶ(clearTimers・runId 更新・結果/図鑑/ランキング DOM の破棄・ダイアログ閉じ)。ランキング加算は `enterResult()` のみなので、中断では加算されない。
- 世代トークン: 既存の `runId` と `later()` のタイマー一覧。reset で全タイマー解除 + runId 更新。保留中の `deferred` も reset で破棄。確認の Promise は `myRun !== state.runId` なら無視。
- 連打: `homeAsking` で二重オープンを防止。確定は `finishConfirm` の done ガードと runId 照合で 1 回だけ。
- 診断演出中は通常は無操作タイマーなしだが、確認ダイアログ中だけ質問中と同じ時間で張る(放置されても戻る)。ダイアログ中の警告表示は既存の「ダイアログの中へ一時移動」をそのまま使用。

### 実行コマンドと結果
| コマンド | 結果 |
|---|---|
| `node tools\simulate.js` | RESULT: ALL PASS (warnings: 0)、終了コード 0 |
| `node tools\check-static.js` | check-static: OK (16 files)、終了コード 0 |
| `node tools\browser-check.js --browser chrome --scenario home --screenshots ...\screens\chrome` | ALL PASS (43 checks)、終了コード 0 |
| `node tools\browser-check.js --browser chrome --screenshots ...\screens\chrome`(全シナリオ。--skip-long なし) | RESULT: ALL PASS (308 checks)、終了コード 0 |
| `node tools\browser-check.js --browser edge --screenshots ...\screens\edge`(全シナリオ。--skip-long なし) | RESULT: ALL PASS (308 checks)、終了コード 0 |

既存テストは 265 件(layout の 360×540 で Q1〜Q15 が 1 画面に収まる確認や、reset-confirm の背景クリック等を含む)が全て通過。追加 43 件で合計 308 件。
途中で一度 reset-confirm の「背景クリック」が落ちた(開いた直後の背景クリック無視を全確認ダイアログに入れたため)。ホーム用だけ有効にするオプション `backdropGuardMs` に直して再実行し全 PASS。

### シナリオ ①〜⑩ の合否(Chrome・Edge とも PASS)
| # | 内容 | 結果 | 主な実測 |
|---|---|---|---|
| ① | 質問 Q1・Q8・Q15 ほか全 15 問と診断演出に「ホームへ戻る」がある | PASS | 15/15 で画面内・44px 以上・文言切れなし。演出画面 133x44 |
| ② | 確認ダイアログ。「続ける」・Esc で閉じて位置・回答・選択が保たれる | PASS | 文言一致、初期フォーカス=続ける、Tab 巡回、Esc 後 Q8 のまま回答 7 件、Q7 の選択済み回答が保持、フォーカスはボタンへ戻る |
| ③ | 「ホームへ戻る」確定で完全リセット、再開始で Q1・未選択・プログレス最初と同じ | PASS | runId +1、URL・localStorage・sessionStorage に痕跡なし、再開始後 `Q1 / 15`・valuenow 1・6.67%(最初と同一) |
| ④ | 中断してもランキング集計が増えない | PASS | 累計 0、localStorage の stats キーも未作成(null) |
| ⑤ | 演出中に中断 → 3.8 秒待っても結果に進まない・加算なし | PASS | phase=START、結果表示 0 回、累計 0。ダイアログ表示中は満了(2.9 秒)後も結果に進まず、Esc で再開し結果 1 回・+1 |
| ⑥ | 演出中に中断 → 即再診断 → 完走で結果 1 回・+1 | PASS | 前の演出の満了が 2 回目の演出の最中に来る配置で実行(重なりを確認)。結果 1 回・演出 2 回、結果は 2 回目の演出から 2528ms 後、累計 +1、結果は 2 回目の回答のもの |
| ⑦ | 連打・ダブルクリック | PASS | DOM 5 連打でダイアログ 1 つ、実マウスのダブルクリックでも開いたまま、確定 3 連打で runId +1 のみ、累計 増えず |
| ⑧ | ダイアログ中の無操作自動復帰 | PASS | 警告がダイアログの手前に出て押せる、「続ける」で警告のみ消えダイアログ維持、放置でスタートへ(ダイアログ・回答・警告が片付く)。演出中の放置は満了で結果に進まず無操作で戻り、ランキング不変 |
| ⑨ | 390x844 で押せて他のボタンと重ならない | PASS | Q1〜Q15 で 44px 以上・最前面・選択肢/前後ボタンから 16px 以上(他要素との最小距離 8px)、横スクロールなし。ダイアログのボタン 44px 以上で画面内。演出画面も重ならず押せる |
| ⑩ | コンソールエラー 0 件 | PASS | シナリオ前半・全体とも 0 件。reduced-motion でトランジション 0s |

結果画面に「ホームへ戻る」が出ないこと、既存の結果ボタン(`[data-action]` 3 個以上)も確認済み。

### 確認したスクリーンショット(read_file で画像を開いて目視)
保存先: `.agents\tasks\screens\{chrome,edge}\`
- home-q1-1280.png: 1280x800。Q1 の右上に「ホームへ戻る」が小さく控えめに出ている。Q 番号・場面タグ・プログレスバーと整列し、選択肢と「前の質問へ」(左下)から十分離れている。崩れなし(Chrome・Edge とも同一)
- home-dlg-1280.png: 確認ダイアログが中央に表示。文言どおり、「続ける」(金枠でフォーカス)と深紅の「ホームへ戻る」。背景は暗幕。崩れなし
- home-q1-390.png: 390x844。ボタンは右上に収まり、Q1 / 15 と場面タグも同じ行に入る。はみ出し・重なりなし
- home-dlg-390.png: Q15 上のダイアログ。文言は 2 行に折り返し、2 つのボタンが縦に並んで画面内。崩れなし(Chrome・Edge)
- home-an-390.png: 診断演出。左上の隅に「ホームへ戻る」。家紋・文言と重ならない(撮影は画面切替アニメーション中で全体がやや暗い)
- 既存スクリーンショット(start-*, question-*, dialog-* 等)は、コミット済みの内容へ戻して差分を出さないようにした

### 備考
- ブラウザ検査の一時フォルダは各回の終了時に自動削除。TEMP の出力ファイル(bc-chrome.txt / bc-edge.txt)は削除する。
