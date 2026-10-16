# 実装計画: 戦国武将性格診断(sengoku-personality)

正となる文書: `.agents/tasks/design.md`(第 3 版。以下「設計書」)、`.agents/tasks/design-review.md` / `.json`(最終設計レビュー。以下「レビュー」)。本計画は、レビューの残り指摘(MEDIUM 2 件・NIT 7 件)の解消方法を確定し、実装順序を決める。**設計書と食い違う箇所は、本書「1. 設計判断」に明記したものだけが設計書より優先する**。それ以外は設計書が正。step prompt の「絶対制約」は常に最優先。

以下 `ROOT` = `c:\Users\村上琉伊\Desktop\大学祭\性格診断ゲーム戦国武将バージョン\sengoku-personality`。**ワークスペースのルートは ROOT の親フォルダなので、相対パスで書くと親フォルダに落ちる。ファイル操作は常に絶対パス、コマンドは `cwd` に ROOT を渡す。**

## 0. 探索で確認した環境(実測)

- ROOT には空の `css/` `js/` `assets/images/` `tools/` と `.agents/tasks/`(設計書・レビュー)だけがある。**git リポジトリではない**(`git status` が fatal)。git init もコミットもしない。`package.json` は作らない(npm 依存ゼロ)。
- Node `v24.15.0`(グローバルの `fetch` / `WebSocket` が使える)。Chrome: `C:\Program Files\Google\Chrome\Application\chrome.exe`。Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
- `python` は WindowsApps のスタブだけで、実行すると exit 9009(未インストール)。http 経由の動作確認は Node 標準の `http` モジュールで行う(`tools/browser-check.js --http`)。README の `python -m http.server` 手順は記載のみとし、この環境では実行確認できない旨を動作確認記録に書く。
- Node から CDP でヘッドレス Chrome を操作できることを、日本語を含む `file://` パスで実測した。手順: `--headless=new --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars --remote-debugging-port=0 --user-data-dir=<一時フォルダ>` で起動し、`<user-data-dir>\DevToolsActivePort` の 1 行目からポートを読み、`http://127.0.0.1:<port>/json/list` の page の `webSocketDebuggerUrl` に `WebSocket` で接続する。`Runtime.consoleAPICalled` で console を捕捉でき、`Runtime.evaluate` でクリックできた。注意: `Emulation.setDeviceMetricsOverride` に `mobile:true` を渡すと、viewport meta がないページでは `innerWidth` が 980 になる。index.html は viewport meta を持つので 360 になるはずだが、測定前に `innerWidth===指定幅` を必ず確かめる。
- 設計書の表(B-5 の 15 問、B-7 の 20 人)を機械的に読み込む使い捨ての Node プロトタイプを作り(削除済み)、B-19 の実測値を完全に再現した: #2 最多 直江兼続 6.26%・最少 北条氏康 2.48%、#3 最多 北条氏康 8.57%・最少 直江兼続 0.75%、#4 全A〜全D = 直江兼続/加藤清正/前田利家/長宗我部元親、文字間最大差 2.9/6.4/6.4/7.3/8.2/8.9、#10 スポットチェック 8 件すべて合格、#15 p=0.7 最大 13.7%・p=0.85 最大 29.1%・全集団 20 人、最近接ペア 家康–氏康 8.66。**`simulate.js` の実装が下の乱数定義どおりなら、これらの値が小数 2 桁まで一致する**(実装の正しさの確認に使う)。

## 1. 設計判断(残り指摘の解消と追加の確定事項)

### 1.1 MEDIUM-1: 類似度表示の飽和 → `similarityExact`(小数 1 桁)を追加、式は不変

- 要件 §8 の式 `round(max(0,min(100,(1 - d/sqrt(6*100^2))*100)))` は変えない。`similarity`(整数)は従来どおり。
- `rankGenerals` の各行に `similarityExact` を追加する。**切り捨て**で小数 1 桁にし、`Math.round(similarityExact) === similarity` を常に保つ。

```js
var pctRaw = Math.max(0, Math.min(100, (1 - d / MAX_DISTANCE) * 100));
var pct = Math.round(pctRaw);                               // 要件 §8 の式そのまま(整数)
var exact = Math.floor(pctRaw * 10) / 10;                   // 小数 1 桁(切り捨て)
exact = Math.min(pct + 0.4, Math.max(pct - 0.5, exact));    // 浮動小数誤差の保険: 常に Math.round(exact) === pct
exact = Math.round(exact * 10) / 10;                        // 表現誤差を落とす
```

- 切り捨てを選んだ理由: レビュー案の四捨五入(`Math.round(pctRaw*10)/10`)だと、pctRaw=89.46 のとき大見出しは「89%」、TOP3 は「89.5%」になる。来場者には 89.5 が 90 に読めるので、表示どうしが矛盾して見える。切り捨てなら大見出しの整数は常に小数 1 桁値の四捨五入になり、矛盾しない。どちらの方式も距離の単調減少関数なので、順位とは矛盾しない。
- 並べ替えは設計どおり。キーは丸める前の二乗距離 `Math.round(d²×1e6)` の昇順で、同値なら武将配列 index の昇順にする(全順序なので安定)。最後のループで、`similarity` と `similarityExact` の**両方**を直前の順位の値でクランプする(非増加を保証)。クランプ後も `Math.round(similarityExact) === similarity` が成り立つことは確認済み(両方とも pctRaw の単調関数で、キーが同値のときは両方が同時にクランプされるため)。
- 表示の規則: 結果画面の大見出し「類似度 92%」、カウントアップ、結果カード PNG、その `aria-label` は `similarity`(整数)。TOP3 カードと 20 人一覧は `similarityExact.toFixed(1) + '%'`(例: `90.4%`)。`aria-label` は「類似度90.4パーセント」。
- 表示スケール(非線形変換など)は採用しない。要件の式と違う数値を「類似度」として見せることになるため。差は小数 1 桁で見せる。
- 実測(一様乱数 100,000 通り、seed 20240601、#2 と同じ標本): 1 位と 2 位の整数%が同じ 39.4%、1〜3 位が同じ 13.6%、1 位と 2 位の小数 1 桁が同じ 4.9%、1 位−2 位の差(小数 1 桁)の中央値 0.6・p90 1.9。→ `simulate.js` の検査 #17「上位の差(表示のみ)」でこれらを出力し、小数 1 桁が同じ割合が 5% を超えたら WARN にする(合否には含めない)。
- 設計書 B-21 の「上位に並ぶ武将の差は数ポイント」は事実と違う。README の「既知の制限」に、訂正した文「上位 3 人の差は中央値 1 ポイント程度。整数%では約 39% の結果で 1 位と 2 位が同じ表示になるため、TOP3 と一覧は小数 1 桁で表示する」を書く(設計書は上書きしない)。

### 1.2 MEDIUM-2: 集団全体の傾き → 検査 #16「集団バイアス耐性」(AC-32)+ 徳川家康のパラメータ調整

**検査 #16 の定義**(レビュー指摘 2 の fix どおり)。

- 集団(w = [統率, 行動, 知略, 社交, 慎重, 革新])。index 順に 0: 協調寄り `[0,0,0,1,1,-1]`、1: 大胆寄り `[1,1,0,0,-1,1]`、2: 社交 `[0,0,0,1,0,0]`、3: 慎重 `[0,0,0,0,1,0]`、4: 知略 `[0,0,1,0,0,0]`。
- β ∈ {0.10, 0.15}。乱数は `mulberry32(20240701 + 集団index×10 + Math.round(β×100))`。各 20,000 通り。
- 1 回答の生成: `q = 0..14` の順に、4 択それぞれの重み `exp(β × Σ_k w_k × scores_k)` を計算し、`r = rnd() × Σ重み` とする。`j = 0..3` の順に `r -= 重み_j` し、`r < 0` になった j を選ぶ(最後まで負にならなければ 3)。乱数は 1 問につき 1 回だけ消費する。
- 合格(β=0.10): 5 集団すべてで、1 位の最多が 25% 以下、かつ 1 位の割合が 0.1% 以上(20,000 通り中 20 回以上)の武将が 18 人以上。
- 警告のみ(β=0.15): 最多が 35% を超えたら `WARN`。全 10 集団の最多の武将と割合、最少の武将と割合、0.1% 以上で出現した人数を表で出力する。

**プロトタイプでの実測**(上の定義どおり)。

| 集団 | β | 設計書のデータ | 調整後のデータ(家康 [59,37,56,45,73,34]) |
|---|---|---|---|
| 協調寄り | 0.10 | 最多 徳川家康 22.86%、20 人 | 最多 北条氏康 19.28%、20 人 |
| 大胆寄り | 0.10 | 最多 長宗我部元親 18.78%、**18 人(基準ちょうど。家康 0.085%・氏康 0.095%)** | 最多 長宗我部元親 18.78%、19 人 |
| 社交 / 慎重 / 知略 | 0.10 | 最多 10.32% / 10.41% / 9.99%、各 20 人 | 10.37% / 10.88% / 9.92%、各 20 人 |
| 協調寄り | 0.15 | 33.86%(WARN 閾値 35% まで 1.1 ポイント) | 32.36% |
| 大胆寄り | 0.15 | 26.29% | 26.29% |

**判断: 徳川家康のパラメータを `[59,37,56,47,72,34]` → `[59,37,56,45,73,34]`(社交 −2、慎重 +1)に調整する。** 理由は 2 つ。(1) 設計書のデータは「大胆寄り β=0.10 で 18 人」と合格基準ちょうどで、乱数の使い方がわずかに違うだけで不合格になる(レビューは別の実装で 19 人と報告しており、実装差で値が揺れることが確認できている)。(2) 調整後は、協調寄りの最多が 22.9% から 19.3% に下がって余裕が 5.7 ポイントになり、大胆寄りも 19 人になる。β=0.15 も 32.4% に下がる。家康の特徴イメージ「忍耐・慎重・長期戦略」の最大軸は慎重のまま(73)。調整はデータだけで、乱数や結果の後操作は一切使わない(要件 §17)。

**調整後のデータで B-19 の既存の全指標を測った結果**(プロトタイプ)。

| 検査 | 基準 | 設計書のデータ | 調整後 |
|---|---|---|---|
| #2 一様乱数 | 最多 ≤ 9%、最少 ≥ 1.5% | 6.26% / 2.48% | 直江兼続 6.58% / 徳川家康 3.00% |
| #3 傾向付き | 最多 ≤ 12%、最少 ≥ 0.5%(WARN: >11% または <0.6%) | 8.57% / 0.75% | 北条氏康 9.76% / 直江兼続 0.78%(WARN なし) |
| #4 単調パターン・文字別プロファイル | 相異・信長以外、各軸の最大差 ≤ 15 | 直江/加藤/前田/元親、最大 8.9 | 同じ(ユーザー側だけの指標なので不変) |
| #10 スポットチェック 8 件 | 1 位が期待集合に入る | 全合格 | 全合格(慎重重視 → 毛利元就) |
| #15 位置バイアス | p=0.7 ≤ 25%、p=0.85 ≤ 40%、18 人以上 | 13.7% / 29.1%、全 20 人 | 14.7% / 30.9%、全 20 人 |
| AC-27 最近接ペア | ≥ 8 | 家康–氏康 8.66 | 家康–氏康 9.06 |
| `AXIS_STATS` | 実測 ±1 | 一致 | 不変(ユーザー側だけの統計) |
| #17 表示 | 情報のみ | 39.4% / 4.9% | 39.2% / 4.9% |

#9(質問の感度)と #11(理由文)はプロトタイプで測っていない。項目 9 で `simulate.js` が測る。

**手順(項目 8・9)**: まず設計書の値そのままで `generals.js` と `simulate.js` を実装し、上の「設計書のデータ」列の値が再現されることを確かめる(simulate の実装の正しさの確認)。そのあと家康の値だけを変更し、全検査を再実行する。**調整後に 1 件でも FAIL が出たら、設計書の値に戻す**(設計書の値は #16 を含む全検査に合格する)。どちらを採用したかと実測値を、`FEAT-001.json` の findings と README の「分布の検証結果」に記録する。

**既知の制限(README に書く)**: 集団全体が協調・慎重寄りに傾くと、家康・氏康に集まりやすい(β=0.15 で最多 約 32%)。#16 が FAIL したときの調整手順は「その集団で最少の武将のパラメータを、各軸 ±1〜5 の範囲で集団の重心(その集団の 1 位になった回答の平均値)に近づける。特徴イメージの最大軸は保つ。変更のたびに全検査を再実行する」。

### 1.3 NIT 3〜9 の対応

| # | 対応 | 内容 |
|---|---|---|
| 3 | 反映 | B-9 の手順 3 をレビューの擬似コードで確定する(項目 5)。同符号の候補(tier1)、異符号でも diff ≤ 15 の候補(tier2)、それでも足りなければ diff 昇順で補完、の順に選ぶ。補完した軸(必ず diff > 15)を含むときは、P1 の「ととても近い」を「と近い」にし、P3 の結びを「{軸A}と{軸B}は、今回の診断では比較的近い軸でした。」に切り替える。戻り値に `allNear`(boolean)を追加する。補完率は #11 が出力する(目安 約 7%) |
| 4 | 反映 | TOP3 と 20 人一覧のクリックは、`#result-root` に付けたクリックハンドラ 1 つで受ける(イベント委譲。`event.target.closest('[data-general-id]')`)。カードは `<li data-general-id>` で、フォーカスを受けるのは内側の「くわしく見る」ボタンだけ。一覧の行も同じ規則。`openGeneralDialog` の冒頭に `if (dlg.open) return;`。`showModal` が例外を投げたら `open` 属性を付ける |
| 5 | 反映(数値は変更) | `toBlob` を `Promise.race([toBlob, timeout(TOBLOB_TIMEOUT_MS)])` で包み、時間切れなら `blob:null` で続ける。**`SVG_LOAD_TIMEOUT_MS = 3000`、`TOBLOB_TIMEOUT_MS = 1500`**。レビュー案は 4000 と 3000 だが、SVG の時間切れ → primitive 描画 → toBlob の時間切れが重なると 7 秒になり、追記する「失敗時のフォールバックを含めて 5 秒以内」(NFR-3)と矛盾する。3000+1500=4.5 秒なら収まる。data URI の SVG は数 ms で読めるので 3 秒で十分 |
| 6 | 反映 | `ShareCard.generate()` の戻り値に `previewSrc` を追加する。`dataUrl.length > 1,500,000` かつ `blob` が非 null のときは `URL.createObjectURL(blob)`(ShareCard が内部で管理し、`dispose()` で revoke)、それ以外は `dataUrl`。プレビューの `<img>` と「保存」リンクは `previewSrc` を使う。生成のたびに console に出す 1 行に、`bytes=<blob.size または null> dataUrlLength=<n>` を追加する。手動確認 9 と browser-check でその値を記録する |
| 7 | 反映 | B-10 に次の CSS を足す: `.general-name{font-size:clamp(32px,9vw,64px);overflow-wrap:anywhere}`、`.radar svg{width:100%;max-width:360px;height:auto}`、`dialog.dlg{width:min(92vw,640px);max-height:90dvh;overflow:auto}`、`dialog .dlg-close{position:sticky;top:0}`、`dialog#dlg-card img{max-width:100%;max-height:60dvh;object-fit:contain}`、`button,a,summary{touch-action:manipulation}`。browser-check が 360×640 で、結果画面と武将詳細ダイアログ、`#dlg-card` の閉じるボタンが表示領域内にあることを検査する |
| 8 | **対応しない**(理由を記録) | 武将 20 人 × 6 軸 = 120 個の `reason.flavor` は、文面が武将の水準(high/mid/low)と合っているかを機械的に検査できない。AC-28(P1 と P3 が同じ 2 軸を述べる)を構造で保証している現行のテンプレートを崩す危険のほうが大きい。要件 §11 の「武将ごとに自然な文章」は、武将固有の史実の 1 文(P2 の `reason.history`。20 人で重複なし、断定を避ける文末)と、武将名・武将側の水準語を差し込むことで満たす、と解釈する。この解釈を README の「似ている理由の文章について」に書く |
| 9 | 反映 | `setAnswer(i, idx)` は `app.js` の private 関数(`state.answers[i] = idx; state.diagnosis = null;`)。`SG.Util.uid(prefix)` はモジュール内のカウンタで `prefix + '-' + (++n)` を返す(乱数なし)。Q1 の「前の質問へ」は `disabled` + `aria-disabled="true"` で表示を残す。`store.reset()` は退避キー `sengoku-personality:v1:stats:corrupt` も削除する |

### 1.4 その他の確定事項(設計書の穴を埋める判断)

- **武将の数は定数にする**: `diagnosis.js` に `EXPECTED_GENERAL_COUNT = 20` を置き、`validateData()` は「ちょうど 20 件」ではなく「`EXPECTED_GENERAL_COUNT` 件」を検査する。README に「武将の追加方法」を書くことが求められているため(定数を変えれば追加できる)。`simulate.js` の「20 人全員」は `SG.Generals.length` 人全員と書く。
- **真田幸村の表示名**: 要件 §7 の表記どおり `name: '真田幸村（信繁）'`(全角括弧)。代替カードの縦書きは `crest.display: '幸村'`。長い名前は CSS の `clamp`/`overflow-wrap` とカードの `measureText` 縮小で収める。
- **`assets/images/CREDITS.md` を作る**: 設計書は「画像を置くときだけ作る」としているが、step prompt の絶対制約が「CREDITS.md を置く」と定めているので、そちらを優先する。内容は「現在、外部の画像素材は使用していない。全 20 人の画像は `js/crest.js` が生成する自作の SVG」という宣言と、画像を追加するときの記録様式(表: ファイル名/武将 id/作品名・作者/出典/ライセンス/確認日)。外部 URL は書かない。
- **`tools/browser-check.js` を追加する**(開発・展示前の確認用。アプリ本体ではない): 設計書の「手動確認」の大半を、ヘッドレス Chrome/Edge を CDP で操作して自動化する。コーディングエージェントが UI を実際に検証できる唯一の方法であり、展示担当者の事前確認にも使える。Node 標準モジュールと Node 24 のグローバル `fetch`/`WebSocket` だけを使う。通信先は自分で起動したブラウザの `127.0.0.1` だけ。一時プロファイルを使うので、ユーザーの Chrome のデータには触れない。**自分が起動したプロセスだけを終了する(`Stop-Process -Name chrome` のような名前指定の終了は禁止。ユーザーのブラウザが閉じてしまう)**。`check-static.js` の走査対象(`index.html`・`js/*.js`・`css/style.css`)には入らない。
- **テスト用の CONFIG 上書き**: `app.js` の `init()` は、`window.SG_CONFIG_OVERRIDE` が定義されていれば、`CONFIG` に存在するキーのうち有限の数値だけを上書きし、そのあと通常の検証と clamp を行う。browser-check が無操作タイマーを短くするために使う(`Page.addScriptToEvaluateOnNewDocument`)。通常運用では未定義。診断結果には影響しない。コメントで「テスト用」と明記する。
- **`SG.Results.showResult` に第 4 引数 `options` を追加する**: `{ countUpMs: number, reducedMotion: boolean }`。カウントアップの時間は `app.js` の `CONFIG.COUNTUP_MS` が持っており、`results.js` から `SG.App` を参照すると依存の向き(app → results)が逆になるため。追加だけなので、既存の契約は壊れない。`SG.Results.clear()` は、保留中の `requestAnimationFrame` も取り消す。
- **`SG.Reason` の公開メンバ**: `build`、`PHRASES`(B-9 の句の表)、`GENERAL_WORDS`(`{high:'高め',mid:'ほどよい',low:'控えめ'}`)。`build()` の戻り値に `allNear` を追加する(1.3 の NIT 3)。
- **画像生成の順序**(`app.js` の `onSaveCard`): `if (state.cardBusy) return;` → `SG.Results.closeCardPreview()`(新しい blob URL を作る**前に**前回分を破棄する。後から破棄すると、`onClosed` → `dispose()` が新しいプレビューの URL まで revoke してしまう)→ `cardBusy=true`、`setSaveBusy(root,true)` → `myRun = state.runId` → `await generate(diagnosis)` → `runId` が変わっていたら `SG.ShareCard.dispose()` して終了 → `state.cardResult = result` → `download(result, 'sengoku-' + id + '.png')` → `openCardPreview(result, { onClosed })` → finally で `cardBusy=false`、`setSaveBusy(root,false)`(ボタンがなければ何もしない)。
- **「次の質問へ」ボタン**: 「前の質問へ」と同じ行に置く。現在の問が回答済みのときだけ表示する(`hidden` 属性。行の高さは「前の質問へ」で決まるので、出し入れしてもレイアウトは動かない)。Q15 では表示名を「診断結果を見る」にする。
- **`SG.App.getState()`** は読み取り専用のコピーを返す: `{ phase, answers(配列のコピー), current, counted, rankingReturnTo, cardBusy, locked, runId, topId(結果がなければ null), hasCardResult }`。browser-check はこれを使う。
- **複数回のダウンロード**: 展示では「最初に戻る」でページを再読み込みしないため、同じページから何度もダウンロードする。Chrome が「複数ファイルのダウンロード」の許可を求めた場合は、そのサイト(`file://`)に許可するよう README に書く。
- **文字コード**: すべてのファイルは UTF-8(BOM なし)。`index.html` に `<meta charset="utf-8">`。ファイルは書き込みツールで作り、PowerShell の `Set-Content`/`Out-File` で書かない(既定の文字コードが UTF-8 でない場合がある)。

## 2. 受け入れ基準の追補(設計書 A-5 への追加・変更)

- **AC-8(変更)**: 表示される TOP3 と 20 人一覧の並びは `Diagnosis.diagnose()` の順位と完全に一致する。各行の `similarity` と `similarityExact` はどちらも非増加。各行で `Math.round(similarityExact) === similarity`。TOP3 と一覧の表示は `similarityExact.toFixed(1)%`。結果画面の大見出しは `similarity` の整数(`simulate.js` #6 と browser-check が検査する)。
- **AC-32(新設)**: `node tools/simulate.js` の検査 #16(1.2 の定義)で、β=0.10 の 5 集団すべてが「最多 25% 以下」かつ「0.1% 以上で出現する武将が 18 人以上」を満たす。β=0.15 で最多が 35% を超えたら WARN を出す(合否には含めない)。
- **AC-33(新設)**: `simulate.js` の検査 #17 が、1 位と 2 位(および 1〜3 位)の整数%が同じになる割合、`similarityExact` が同じになる割合、差の中央値と p90 を出力する。`similarityExact` が同じになる割合が 5% を超えたら WARN(合否には含めない)。
- **AC-34(新設。NIT 7)**: 360×640 で結果画面を開き、武将詳細ダイアログと `#dlg-card` を開いたとき、閉じるボタンが表示領域内にある(browser-check が検査する)。
- NFR-3 の追記: 結果カードの生成は、失敗時のフォールバックを含めて 5 秒以内。

## 3. 実装項目(依存順。FEAT-001 = 1〜9、FEAT-002 = 10〜16、FEAT-003 = 17〜19)

共通ルール(全項目):
- ファイルは設計書 B-3 の UMD 風 IIFE ラッパーで書く。ES2019 までの構文を使い、`?.`・`??`・`import`/`export` は使わない。
- コメントを含めて `http://`・`https://` を書かない(許可されるのは SVG 名前空間 `http://www.w3.org/2000/svg` だけ)。
- 重要な処理には日本語のコメントを付ける。フォント名は単一引用符で囲む。データ由来の文字列を HTML/SVG に入れるときは必ず `SG.Util.esc()` を通す。
- コマンドは `cwd` = ROOT で実行する。区切りは `;` を使い、`&&` は使わない。

### FEAT-001: データ・純粋ロジック・分布検証(Node で完結)

- [ ] 1. `js/util.js` を作る(`SG.Util`)。
      `esc(str)` は `String()` で文字列化し、`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&quot;`、`'`→`&#39;` の順に置換する。`null`/`undefined` は空文字列を返す。
      `localDateKey(date)` は `YYYY-MM-DD`(ローカル日付、ゼロ埋め)。`clamp(n,min,max)`。`uid(prefix)` はモジュール内のカウンタで `prefix + '-' + (++n)` を返す(NIT 9)。`fonts.serif` / `fonts.sans` は B-1 の文字列そのまま。
      Files: `js/util.js`
      Verify: `node --check js\util.js` が成功し、`node -e "var U=require('./js/util.js'); console.log(U.esc(null)==='', U.uid('c'), U.uid('c'), U.localDateKey(new Date(2025,0,5)))"` が `true c-1 c-2 2025-01-05` を出力する。

- [ ] 2. `js/questions.js` を作る(`SG.Questions = { count: 15, items }`、深く `Object.freeze`)。
      設計書 B-5 の Q1〜Q15 を、**第 3 版の並び**(表の行の順)で転記する。各問の形は `{ id:'q1', scene, text, options:[{ label:'A', text, scores:[6 個] } ×4] }`。文言は 1 文字も変えない。
      Files: `js/questions.js`
      Verify: `node --check js\questions.js` が成功する。require して `items.length===15`、全問 4 択、`Object.isFrozen(items[0].options[0].scores)===true` を確かめる。配点の正しさは項目 8 の #1(範囲表の一致)と #4(文字別プロファイルの再現)で確認する。

- [ ] 3. `js/generals.js` を作る(`SG.Generals`、20 件、深く `Object.freeze`)。
      順序と 6 値は B-7 の「診断用パラメータ」表のとおりにする。**この時点では家康も設計書の値 `59,37,56,47,72,34` のまま**(調整は項目 9)。`crest` は B-7 の家紋風シンボル表、`image: null`、`imageCredit: null`。真田は `name: '真田幸村（信繁）'`(1.4)。
      文章は B-7「武将ごとの内容」表の要点だけを素材にする。
      - `lifespan` は `'1534年〜1582年'` の形式。表で説が分かれるものは併記する(秀吉 `1537年〜1598年(1536年説あり)`、光秀 `生年不詳(諸説あり)〜1582年`、幸村 `1567年〜1615年(1570年説あり)`、利家 `1538年〜1599年(1539年説あり)`)。
      - `achievements` は 2〜3 件、`events` は 1〜2 件。確立した事実だけを書く。表で「伝えられる」「とされる」「諸説」とある項目(信玄堤、三本の矢、愛の前立て、本能寺の変の動機など)は断定しない。
      - `imageOfType` は「診断では」で始まる 2〜3 文。診断用の解釈であることがわかる書き方にし、史実と混ぜない。
      - `reason.history` は武将ごとに違う史実の 1 文。文末は「知られています。」「とされます。」「と伝えられます。」のどれか。軸ラベル(統率力・行動力・知略・社交性・慎重さ・革新性)は含めない。
      Files: `js/generals.js`
      Verify: `node --check js\generals.js` が成功する。require して `length===20`、`[6].name==='真田幸村（信繁）'`、`[2].caution===72` を確かめる(内容は項目 4 の `validateData()` で検査する)。

- [ ] 4. `js/diagnosis.js` を作る(`SG.Diagnosis`)。
      B-8 のとおりに実装する: `AXES`、`AXIS_STATS`、`isComplete`、`computeRaw`(長さ 15・整数 0〜3 でなければ `RangeError('INVALID_ANSWERS')`)、`getRanges`(questions.js から算出)、`normalize`(B-6、丸めない)、`scoreUser`、`similarity`(指定の式そのまま)、`rankGenerals(user, generals?)`、`diagnose`。
      追加すること: `EXPECTED_GENERAL_COUNT = 20`(1.4)。`rankGenerals` は 1.1 のコードで `similarityExact` を付け、最後のループで `similarity` と `similarityExact` の両方をクランプする。`roundAll` は private。
      `validateData()` は B-8 の一覧をすべて検査し、違反箇所をメッセージに入れて throw する(件数だけは `EXPECTED_GENERAL_COUNT` と比べる)。`SG.Crest` は**呼び出し時に**参照し、未ロードなら `Error('CREST_NOT_LOADED')` を投げる。DOM・`Date`・乱数には触れない。
      Files: `js/diagnosis.js`
      Verify: `node --check js\diagnosis.js` が成功する。util/questions/generals を読んでから `diagnose(new Array(15).fill(0))` を呼び、1 位が直江兼続・similarity 89 になり、`getRanges()` が B-5 の範囲表(統率 −3〜31、行動 −9〜38、知略 −8〜39、社交 −11〜44、慎重 −24〜37、革新 −14〜42)と一致することを確かめる。

- [ ] 5. `js/reason.js` を作る(`SG.Reason = { build, PHRASES, GENERAL_WORDS }`)。
      B-9 の手順 1・2・4・5 と段落 P1〜P4 を実装する。手順 3 は次の確定版にする(NIT 3)。
      ```js
      // 各軸 a: zu, zg, diff, lu=level(zu), lg=level(zg), sameSign=(zu*zg>0), idx=軸順
      // opposite = (lu==='high'&&lg==='low') || (lu==='low'&&lg==='high')、strength=(|zu|+|zg|)/2
      var eligible = axes.filter(function (a) { return !a.opposite; });
      var near = eligible.filter(function (a) { return a.diff <= 15; });
      function byStrength(a, b) { return (b.strength - a.strength) || (a.diff - b.diff) || (a.idx - b.idx); }
      var picked = near.filter(sameSign).sort(byStrength)
        .concat(near.filter(notSameSign).sort(byStrength)).slice(0, 2);
      // 足りなければ eligible の残りを diff 昇順(同値は idx)で補う → 補った軸は levels.user を 'mid' にする
      // それでも足りなければ opposite の軸を diff 昇順で補う → usedOppositeFill=true、levels.user は 'mid'
      // allNear = picked の 2 軸がどちらも diff<=15(= 補完なし)
      ```
      P1 は `「あなたは{句A}と{句B}が特徴です。診断のモデルでは、この2点が{名前}と{allNear ? 'とても近い' : '近い'}結果になりました。」`(句は `PHRASES[軸][levels.user]`)。
      P3 は `allNear` のとき `「{名前}も診断上は{軸A}が{語A}で、{軸B}も{語B}タイプです。この2つの軸の数値が近いことが、今回の診断での共通点です。」`、そうでないときは結びを `「{軸A}と{軸B}は、今回の診断では比較的近い軸でした。」` に替える。
      P2 は `reason.history`。P4 は B-9 のとおり(`diffAxis` の diff が 25 以上のときだけ)。
      戻り値は `{ paragraphs, sharedAxes, levels:{user,general}, diffAxis, usedOppositeFill, allNear }`。純粋関数で、DOM には触れない。
      Files: `js/reason.js`
      Verify: `node --check js\reason.js` が成功する。全A の回答で `build(d.user, d.top.general)` を呼び、3 段落以上が返り、P1 と P3 が同じ 2 軸を述べていることを目で確かめる(機械的な検査は #11)。

- [ ] 6. `js/storage.js` を作る(`SG.Storage = { create, getDefault }`)。
      B-12 と B-3 の API 表のとおりに実装する。キーは `sengoku-personality:v1:stats`。`increment` / `getCounts(scope)` / `getTotalPlayers(scope)` / `listDates` / `reset` / `todayKey` / `isPersistent` を持つ。`scope` の規則、メモリへの縮退、読込時の検証と修復、`...:stats:corrupt` への退避も B-12 のとおり。
      追加すること: `reset()` は退避キーも削除する(NIT 9)。
      ロード時には `create()` を呼ばない。`create()` の引数を省略したとき、Node(`typeof window === 'undefined'`)では localStorage に一切触れない。例外は外に出さない。
      Files: `js/storage.js`
      Verify: `node --check js\storage.js` が成功する。`create(null, function(){return new Date(2025,10,1)})` で 2 回 `increment('oda-nobunaga')` したあと、`getCounts('total')` が `[{id:'oda-nobunaga',count:2}]`、`listDates()` が `['2025-11-01']` になる(網羅的な検査は #12)。

- [ ] 7. `js/crest.js` を作る(`SG.Crest = { svg, dataUri, kinds, patterns }`)。
      B-14 のとおりに実装する。kind は 17 種、pattern は 6 種。未知の kind は `rings` で代用する。`title` オプション、XML として整形式であること、`paint-order` などの属性による書式指定、`<defs>` の ID 接頭辞(`SG.Util.uid`)も B-14 のとおり。`<style>`・`<image>`・`<foreignObject>`・`<script>`・`<br`・コメント・CDATA は使わない。
      Files: `js/crest.js`
      Verify: `node --check js\crest.js` が成功する。全 20 人で `svg(g)` が `<svg` で始まり `</svg>` で終わること、`validateData()` が成功すること(crest まで読み込んだ状態)を確かめる。

- [ ] 8. `tools/simulate.js` を作り、設計書のデータで全検査を通す。
      読み込み順は `util → questions → generals → diagnosis → reason → storage → crest`(`require` は絶対パスにせず `path.join(__dirname,'..','js',…)`)。乱数はこのスクリプト内の mulberry32 だけ。
      ```js
      function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
      ```
      実装する検査(番号は設計書 B-19 と同じ。#14 は check-static.js の担当なので simulate には含めない):
      - #1 `validateData()` と `AXIS_STATS`(実測 ±1)。追加: Q1〜Q5 の質問文・選択肢を、要件 §5 の文字列(simulate.js にリテラルで書く)と完全一致で比べる(AC-3)。`getRanges()` が B-5 の範囲表と一致すること。
      - #2〜#13、#15 は B-19 の表の定義どおり。乱数の消費順も表の定義どおり(#2 は seed 20240601、#3 は 20240602、#15 は `20240615 + X×10 + round(p×100)`)。設計書に seed がない検査は次の値にする: #5 は 20240605、#8 は 20240608、#9 は問 q ごとに `20240609 + q×1000`(#3 と同じ生成で 4,000 通りを作り、`answers[q]` を `(a + 1 + floor(rnd()×3)) % 4` に変える)、#11 の 20 人 × 200 回は 20240611、#11 (g) の一様は 20240612・傾向付きは 20240613(各 30,000 通り)。
      - #6 に追加: `similarityExact` の非増加、各行で `Math.round(similarityExact) === similarity`、小数 1 桁以内(AC-8)。
      - #11 に追加: (i) `allNear===false` のとき、P1 に「と近い結果」、P3 に「比較的近い軸でした」が含まれ、「数値が近いことが」は含まれない。(ii) 人工データ 1 件で、異符号・diff ≤ 15 の軸(tier2)が補完より先に選ばれる。(iii) `reason.history` に軸ラベルが含まれない。(iv) 1 位の組での補完率を出力する(情報のみ。目安 約 7%)。
      - #12 に追加: 退避キーが `reset()` で消える(NIT 9)。
      - #16 集団バイアス耐性(1.2 の定義。AC-32)。#17 上位の差(1.1。#2 の標本で集計する。AC-33)。
      出力形式: 検査ごとに `[PASS]` / `[FAIL]` / `[WARN]` と数値を 1 行で出す。#2・#3・#15・#16 は武将名と割合の表も出す。最後に `RESULT: ALL PASS (warnings: n)` または `RESULT: FAIL (n)` を出す。FAIL があれば `process.exitCode = 1`。
      Files: `tools/simulate.js`
      Verify: `node tools\simulate.js` が exit 0 で `RESULT: ALL PASS` を出し、次の値(設計書のデータ。小数 2 桁で一致するはず)を再現する: #2 直江兼続 6.26% / 北条氏康 2.48%、#3 北条氏康 8.57% / 直江兼続 0.75%(WARN なし)、#4 直江/加藤/前田/元親・最大差 8.9、#15 最大 13.7% / 29.1%、#16 協調寄り β0.10 家康 22.86%・大胆寄り β0.10 18 人、#17 39.4% / 4.9%。一致しない場合は、乱数の消費順序が定義と違うので直す(閾値に収まっていても直す)。

- [ ] 9. 徳川家康のパラメータを調整し、全指標を再計測する(1.2)。
      `js/generals.js` の家康を `leadership:59, action:37, strategy:56, social:45, caution:73, innovation:34` に変える(変更は社交 47→45、慎重 72→73 の 2 か所だけ)。`node tools\simulate.js` を再実行する。期待値: #2 直江兼続 6.58% / 徳川家康 3.00%、#3 北条氏康 9.76% / 直江兼続 0.78%、#15 最大 14.7% / 30.9%・全集団 20 人、#16 β0.10 協調寄り 北条氏康 19.28%・大胆寄り 19 人、β0.15 協調寄り 32.36%(WARN なし)、最近接ペア 家康–氏康 9.06、#10 全合格。
      **1 件でも FAIL が出たら、家康を設計書の値に戻して再実行し、ALL PASS を確かめる**(設計書の値は全検査に合格する)。採用した値・調整前後の主な指標・#9 と #11 の実測値を `FEAT-001.json` の `findings` に書く(README は項目 19 でこれを転記する)。
      Files: `js/generals.js`
      Verify: `node tools\simulate.js` が exit 0 で `RESULT: ALL PASS` を出す。

### FEAT-002: 画面・表示・状態遷移(ブラウザ)

- [ ] 10. `js/chart.js` を作る(`SG.Chart = { renderBars, renderRadar, renderMiniBars }`)。
      B-11「横棒グラフ・レーダー」と B-10「アクセシビリティ」のとおりに実装する。バーの幅は丸める前の値、表示する数値は `Math.round`。各行に軸名と説明と数値を**テキストでも**出す。
      レーダーは自作の SVG(viewBox `0 0 360 360`、中心 180,180、半径 120、同心六角形 5 本、軸線 6 本、頂点ラベル)。ユーザーは金の実線と塗り、武将は深紅系の破線。凡例(あなた/{武将名})、目盛りの注記、`<title>`/`<desc>` を付ける。
      `renderMiniBars` は詳細ダイアログ用の 6 本の小さなバーで、「診断用の仮想モデル値」の注記を付ける。アニメーションは CSS のクラスで付け、JS は値を描くだけにする。
      Files: `js/chart.js`
      Verify: `node --check js\chart.js` が成功する(画面での確認は項目 16 と 17)。

- [ ] 11. `js/results.js` を作る(`SG.Results`)。
      B-3「`SG.Results` の確定契約」のとおり、`showResult` / `setSaveBusy` / `openGeneralDialog` / `renderRankingScreen` / `confirm` / `openCardPreview` / `closeCardPreview` / `closeAllDialogs` / `clear` を実装する。`showResult` には第 4 引数 `options` を足す(1.4)。
      - 結果画面: B-11「結果画面の構成」の 1〜8 を上から順に置く。大見出しの類似度は整数で、カウントアップする(reducedMotion のときは即時に表示)。TOP3 と 20 人一覧は `similarityExact.toFixed(1)%`(1.1)。理由の段落と固定の注記、免責の小さな文字も入れる。
      - クリックは `root` に付けたハンドラ 1 つで受ける(NIT 4)。カードは `<li data-general-id>` で、「くわしく見る」ボタンだけがフォーカスを受ける。
      - 武将の画像は `image` があれば `<img>`(`error` イベントで代替カードに替える)、なければ `SG.Crest.svg(g, { idPrefix: SG.Util.uid('c'), title })` を `role="img"` のラッパーに入れる。
      - 武将詳細ダイアログ: B-11 の項目をすべて出す(AC-26)。`if (dlg.open) return;`、`showModal` が例外なら `open` 属性を付ける。Esc・閉じるボタン・背景クリックで閉じ、閉じたら呼び出し元にフォーカスを戻す。
      - ランキング画面: B-12「ランキング画面」のとおり。本日/日付別/累計のタブ、日付の `<select>`、`1位 〇〇型　N人` の形式、注記、`isPersistent()===false` のときの注意文、`<details>` の「運営用メニュー」の中にリセットボタンを置く。
      - 確認ダイアログ: B-4「確認ダイアログの挙動」のとおり。開いたら JS で「キャンセル」にフォーカスし、Esc・背景クリックは `false` にする。
      - 画像のプレビュー: `#dlg-card` を使う。`<img>` と「保存」リンクは `result.previewSrc`(NIT 6)。閉じるときの手順(`removeAttribute('src')` → `replaceChildren()` → `onClosed` を 1 回だけ → `close()`)は冪等にする。
      - `clear(root)` は保留中の rAF を取り消し、`replaceChildren()` で中身を空にする。
      Files: `js/results.js`
      Verify: `node --check js\results.js` が成功する。

- [ ] 12. `js/share-card.js` を作る(`SG.ShareCard = { generate, download, dispose }`)。
      B-13 の制御フロー(`full` → 失敗したら `primitive`。失敗コードは 5 種)、カードのレイアウト(1080×1920)、taint の検知(`getImageData`)を実装する。
      変更点(NIT 5・6): 定数は `SVG_LOAD_TIMEOUT_MS = 3000`、`TOBLOB_TIMEOUT_MS = 1500`。`toBlob` は `Promise.race` で包み、時間切れなら `blob:null`。戻り値は `{ blob, dataUrl, previewSrc, usedFallback, reason }`(`previewSrc` は 1.3 の NIT 6 の規則)。
      console に出す 1 行は次の形式にする: `ShareCard: usedFallback=false bytes=<n|null> dataUrlLength=<n>`(フォールバックのときは `console.warn` で `usedFallback=true reason=<コード> …`)。
      大見出しの類似度は整数の `similarity`。6 パラメータは丸めた値。武将名が長いときは `measureText` で縮小する(「真田幸村（信繁）」「長宗我部元親」)。blob URL は内部の配列で管理し、`download` は 30 秒後に revoke する。`dispose()` はすべて revoke し、保留中のタイマーも解除する。
      Files: `js/share-card.js`
      Verify: `node --check js\share-card.js` が成功する(画像生成の確認は項目 16・17)。

- [ ] 13. `js/app.js` を作る(`SG.App = { init, getState }`)。
      B-4 の `state`、ステートマシン表、診断演出、連打と二重遷移の対策、`reset()`、無操作タイマー、`CONFIG` をすべて実装する。B-13 の `onSaveCard` は 1.4 の順序にする。
      - `setAnswer(i, idx)` は private 関数にする(NIT 9)。
      - Q1 の「前の質問へ」は `disabled` + `aria-disabled="true"`。「次の質問へ」/「診断結果を見る」の出し方は 1.4 のとおり。
      - 加算は `enterResult()` の 1 か所だけにし、`state.counted` で守る。
      - `pageshow` で `event.persisted` なら `reset()`。
      - `window.onerror` と `unhandledrejection` で `#fatal` を表示する(「最初に戻る」ボタン付き)。
      - `init()` の中で、まず `SG_CONFIG_OVERRIDE` を反映する(1.4)。次に `validateData()` を呼び、失敗したら `#fatal` に「データに誤りがあります」を出す。最後に `SG.Storage.getDefault()` を呼ぶ。
      - `#toast`・`#idle-toast`・`#fatal` は app.js だけが扱う。
      - `getState()` は 1.4 の形のコピーを返す。
      - 画面を切り替えるたびに見出しへフォーカスを移し、`armIdleTimer()` を呼ぶ。
      - ファイルの末尾で `document.addEventListener('DOMContentLoaded', SG.App.init)` する(DOM がないとき、つまり Node では何もしない)。
      Files: `js/app.js`
      Verify: `node --check js\app.js` が成功する。

- [ ] 14. `index.html` と `css/style.css` を作る。
      **index.html** は B-11「index.html の構造」のとおりにする: 5 つの screen、3 つの dialog、`#idle-toast`・`#toast`・`#fatal`、スキップリンク、`<meta charset="utf-8">`、viewport meta、`<link rel="stylesheet" href="css/style.css">`。script タグは B-3 の順に 11 本並べる(`defer` も `type="module"` も付けない)。
      スタート画面の文言は要件 §4 のとおり: タイトル「戦国武将性格診断」、サブタイトル、説明文、ボタン「いざ、診断開始！」。加えて、免責の小さな文字と、右下の「運営用(集計)」を置く。城・幟旗・家紋の装飾はインライン SVG で描く(B-10「装飾」)。
      質問画面は、進行表示(`Q1 / 15` とプログレスバー `role="progressbar"`)、質問文、4 つの選択肢ボタン(`role="group"`)、ナビの行(前へ・次へ)で構成する。診断演出の画面は、家紋・波紋と、`role="status" aria-live="polite"` の文言で構成する。
      **style.css** は B-10 のとおりにする: 最初に `[hidden]{display:none !important}`、続けて土台の 3 規則(`border-box`・`margin:0`・`.screen{position:relative;overflow-x:clip}` と `@supports not (overflow: clip)` の代替)を置き、トークンを定義する。ブレークポイントは 1024/768。
      - 質問画面の高さの予算(`max-width:480px` のとき、上下 padding 12px、質問文 18px、選択肢 `min-height:56px`・16px、gap `clamp(6px,1.5vh,12px)`、ナビ 44px。質問画面には大きな装飾を出さない)。PC のボタンは 64px。
      - アニメーション(画面遷移、金枠の拡大と光の帯、武将名を 1 文字ずつ表示、棒グラフ、レーダー、演出画面の回転・波紋・金粉)。`prefers-reduced-motion: reduce` のときはすべて止める。
      - NIT 7 の 6 規則(1.3)。フォーカスの表示は 3px の金のアウトライン。`--crimson` は文字色に使わない。
      Files: `index.html`, `css/style.css`
      Verify: Chrome のヘッドレスでスクリーンショットを撮り、`read_file` で目視する。撮影先は `ROOT\.agents\tasks\screens\`(ないときは作る)。コマンド: `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=390,844 --screenshot="<ROOT>\.agents\tasks\screens\start-390.png" "file:///<ROOT を / 区切りにしたパス>/index.html"`。`1280,800` でも撮る。スタート画面が崩れずに表示されることを確かめる(console の確認は項目 16)。

- [ ] 15. `tools/check-static.js` を作る(B-19 #14・AC-24)。
      走査対象は `index.html`・`js/*.js`・`css/style.css`。共通・HTML・JS・CSS の禁止パターンと、整合性の検査(`<script src>` の参照先が存在し、順序が B-3 と一致すること、`<link rel="stylesheet">` の参照先が存在すること)は、B-19 #14 の表のとおり。
      JS の `?.`・`??` の検査では、コメントと文字列リテラル(テンプレート文字列を含む)を取り除いてから、正規表現 `\?\?|\?\.[A-Za-z_$\[(]` をかける。違反は `ファイル:行番号: パターン` の形式で出力し、exit 1 にする。違反がなければ `check-static: OK (n files)`。
      Files: `tools/check-static.js`
      Verify: `node tools\check-static.js` が exit 0 になる。一時ファイルに `fetch(` を 1 行書いた `js\__tmp.js` を置くと exit 1 になり、行番号が出ることを確かめる(確かめたら `__tmp.js` を消す)。

- [ ] 16. `tools/browser-check.js` の土台と `smoke` シナリオを作り、UI を一通り動かす(1.4)。
      **土台**: 0 章の CDP の手順でブラウザを起動する。オプションは `--browser chrome|edge`(パスは 0 章。`--exe` で上書き可)、`--scenario <名前|all>`(既定 all)、`--http`(Node の `http` で ROOT を `127.0.0.1:0` に配信する。読み取り専用で、ROOT の外のパスは 404)、`--screenshots <dir>`、`--skip-long`。
      - 捕捉するもの: `Runtime.consoleAPICalled`、`Runtime.exceptionThrown`、`Log.entryAdded`。error/warning/例外が出たら FAIL にする(シナリオごとに想定済みのものだけを許可リストで除く)。
      - 便利関数: `eval(expr)`、`click(selector)`(`Input.dispatchMouseEvent` で要素の中心をクリック)、`waitFor(expr, timeout)`、`setViewport(w,h)`(`mobile:true`。設定後に `innerWidth/innerHeight` が一致することを確かめる)、`screenshot(name)`。
      - シナリオごとに新しいタブ(`Target.createTarget`)と、毎回別の一時プロファイルを使う。`finally` で、自分が起動したブラウザ・サーバー・一時フォルダだけを片付ける。
      - 結果は `[PASS]`/`[FAIL] <シナリオ> <AC>: 内容` の形で出す。最後に `RESULT: ALL PASS` を出し、FAIL があれば exit 1。
      **smoke シナリオ**:
      1. `file://` で開き、エラーがないこととスタート画面の文言を確かめる(AC-1)。
      2. 開始すると `1 / 15` と progressbar の値が出る(AC-2)。
      3. 15 問に答えて、約 2.7 秒後に RESULT になる。
      4. 大見出しの整数が `SG.Diagnosis.diagnose(getState().answers).top.similarity` と一致し、TOP3 の id が一致する(AC-7・AC-8)。
      5. ランキングを開いて戻る。
      6. 「最初に戻る」で START に戻り、answers がすべて null になる(AC-19)。
      Files: `tools/browser-check.js`
      Verify: `node tools\browser-check.js --browser chrome --scenario smoke` が exit 0 になる。続けて `node tools\check-static.js` と `node tools\simulate.js` も exit 0 になる。

### FEAT-003: 全シナリオの自動確認・不具合修正・README・記録

- [ ] 17. `tools/browser-check.js` に残りのシナリオを足し、Chrome・Edge・http で実行して、見つかった不具合を直す。
      シナリオと対応する AC(どれも DOM と `SG.App.getState()` で判定する):
      - `questions`: Q1〜Q15 の表示文言がデータと一致する(AC-3)。2 回の高速クリックで 1 問だけ進む(AC-4)。前へ戻ると `aria-pressed` が出る。回答を変えたときの結果が「最初からその回答」と一致する(AC-5)。Q1 の「前の質問へ」が無効になっている。
      - `analyzing`: 3 つの文言が 0 / 約 0.83 / 約 1.67 秒に順に出て、2.5 秒で RESULT になる。演出中のクリックが無視され、加算は 1 回だけ(AC-6)。
      - `result`: AC-7 の全要素(名前・整数の類似度・タイプ・金枠の中の SVG・棒 6 本・レーダーの 2 系列と凡例・3 段落以上・TOP3・20 行)と、AC-8 の小数 1 桁の表示と並び順。
      - `dialog`: カード本体のクリックとボタンのクリックで、それぞれ 1 回だけ開く(NIT 4)。Esc で閉じてフォーカスが戻る(AC-26)。
      - `ranking`: 本日と累計が +1 になる。往復・リサイズ・リロードで増えない(AC-15)。タブ 3 つと日付の `<select>`(過去の日付は `addScriptToEvaluateOnNewDocument` で localStorage に入れる)、0 件のときの表示(AC-16)。
      - `reset-confirm`: 運営用メニューの中にだけあり、初期フォーカスがキャンセル。Esc・背景クリックで集計が消えない。「リセットする」で消える(AC-17・AC-29)。
      - `card`: `Browser.setDownloadBehavior` で一時フォルダに保存し、`sengoku-<id>.png` の IHDR が 1080×1920 であること。console に `ShareCard: usedFallback=false` が出ること。プレビューが 31 秒後も `naturalWidth===1080` のままであること(`--skip-long` のときは省く)。PNG を `--screenshots` のフォルダにコピーする(AC-14)。
      - `no-storage`: localStorage が例外を投げる状態でも、診断・結果・画像保存が動き、「この環境では集計を保存できません」が出る(AC-18)。
      - `idle`: `SG_CONFIG_OVERRIDE` で質問 3000ms・警告 1000ms にすると、警告が出て START に戻る。START と演出中は戻らない。0 にすると無効(AC-20)。
      - `image-fallback`: `SG.Generals` に存在しない画像のパスを差し込み、onerror で代替カードになる(AC-21。ファイルが見つからないログは許可リストに入れる)。
      - `layout`: 320・360・390・768・1280・1920 の幅で、スタート・質問・結果・ランキング画面に横スクロールがない。360×540 で Q1〜Q15 がすべて `scrollHeight <= innerHeight`(AC-22)。360×640 でダイアログの閉じるボタンが表示領域内にある(AC-34)。
      - `reduced-motion`: `Emulation.setEmulatedMedia` で reduce にすると、アニメーションが `none` になり、結果の数値がすぐに最終値になる(AC-23)。
      - `keyboard`: Tab と Enter で開始できる。Esc でダイアログが閉じる。
      - `--screenshots` を付けたときは、390×844 と 1280×800 でスタート・質問・演出・結果(ページ全体)・詳細ダイアログ・ランキングを撮る。
      Files: `tools/browser-check.js`、不具合を直すときは `js/*.js`・`css/style.css`・`index.html`
      Verify: `node tools\browser-check.js --browser chrome --screenshots "<ROOT>\.agents\tasks\screens\chrome"`、`node tools\browser-check.js --browser edge --screenshots "<ROOT>\.agents\tasks\screens\edge"`、`node tools\browser-check.js --browser chrome --http --scenario smoke` の 3 つが、すべて exit 0 になる。スクリーンショットを `read_file` で目視し、文字の欠け・はみ出し・装飾の重なりがないことを確かめる。直したあとは `simulate.js` と `check-static.js` も exit 0 になる。

- [ ] 18. `README.md`(日本語)と `assets/images/CREDITS.md` を書く。
      README の節(設計書 B-20 のすべてと step prompt の指定を含める):
      1. 概要と免責(エンタメ診断であること・仮想モデルであること・類似度の意味)。
      2. 起動方法。標準は Chrome で `index.html` を `file://` で開く。代替は `python -m http.server 8000`。開き方を変えると集計が分かれる。
      3. オフライン展示の方法。USB へのコピー、F11、キオスク起動の例(`"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "file:///D:/sengoku-personality/index.html"`。起動前に Chrome をすべて閉じること、毎日同じコマンドで起動すること)。
      4. 展示の運用。無操作リセットの設定(`CONFIG`)、ランキングの見方とリセットの手順(確認あり)。
      5. 展示のセキュリティと後片付け。Downloads フォルダとダウンロード履歴、「複数ファイルのダウンロード」の許可(1.4)、LAN 公開時の注意(B-20)。
      6. localStorage は端末・ブラウザ・オリジンごとに別で、他の端末と共有されない(`file://` と `http://` も別)。スマホで診断した結果は、展示 PC のランキングに入らない。
      7. 質問の変更方法、武将の追加方法(`EXPECTED_GENERAL_COUNT`、1.4)、パラメータの変更方法。
      8. 分布の検証(`node tools/simulate.js`。#15 が落ちたら Q6〜Q15 の並び、#16 が落ちたら 1.2 の手順で直す)と、検証結果の表(項目 9 の実測値)。`check-static.js` と `browser-check.js` の使い方(Node 22 以上と Chrome/Edge が必要。一時プロファイルを使う)。
      9. 診断用の仮想モデルについて(武将の値が 19〜73 になっている理由)。
      10. 似ている理由の文章について(NIT 8 の解釈)。
      11. 既知の制限(1.1 の訂正文、1.2 の集団の傾き、B-21 の残り)。
      12. 画像素材の方針と差し替え方法、史実情報について、対応ブラウザ。
      13. 動作確認記録(項目 19 で埋める)。
      README には `http(s)://` で始まる URL を書いてよい(check-static の走査対象外)。ただし外部の URL は書かない。CREDITS.md は 1.4 のとおり。
      Files: `README.md`, `assets/images/CREDITS.md`
      Verify: README を読み直し、step prompt の README の必須項目(起動方法・質問の変更・武将の追加・パラメータの変更・ランキングのリセット・オフライン展示(USB・F11・キオスク)・画像の差し替えと出典の記録・localStorage を共有しないこと・免責・simulate の実行方法)がすべて見出しとして存在することを確かめる。`node tools\check-static.js` が exit 0 のままであること。

- [ ] 19. 最終確認を行い、記録して片付ける。
      `node tools\simulate.js`、`node tools\check-static.js`、項目 17 の browser-check の 3 コマンドを、もう一度すべて実行する。
      README の「動作確認記録」に、次を書く: 日付、Chrome と Edge のバージョン(`(Get-Item <exe>).VersionInfo.ProductVersion`)、開き方(`file://`/http)、各シナリオの結果、`usedFallback` の値、PNG のバイト数と `dataUrlLength`、スクリーンショットの所見、この環境で確認できなかった項目(Firefox・Safari・iOS の実機・python の http.server・bfcache)。
      設計書 B-19 の手動確認 1〜14 が、どのシナリオに対応するかの表も載せる。一時ファイルを消し(`js\__tmp.js`、ブラウザの一時プロファイル、ダウンロード先の一時フォルダ)、ROOT に余計なファイルがないことを `Get-ChildItem -Recurse` で確かめる(`.agents` は残す)。
      Files: `README.md`
      Verify: 3 つのコマンドがすべて exit 0 で、README の記録が実際の出力と一致する。

## 4. AC と項目・検証の対応

| AC | 実装する項目 | 検証 |
|---|---|---|
| AC-1 file:// でエラーなし | 13, 14 | browser-check の smoke(Chrome・Edge)、`--http` の smoke |
| AC-2, AC-4, AC-5 質問画面 | 13, 14 | browser-check の smoke・questions |
| AC-3 15 問・文言 | 2 | simulate #1、browser-check の questions |
| AC-6 演出 | 13, 14 | browser-check の analyzing |
| AC-7, AC-8 結果画面・順位・小数 1 桁 | 4, 10, 11 | simulate #6、browser-check の result |
| AC-9, AC-10 決定論・範囲 | 4 | simulate #5・#6 |
| AC-11, AC-12, AC-13, AC-30, AC-31 分布 | 2, 3, 9 | simulate #2・#3・#4・#10・#15 |
| AC-32 集団バイアス(新設) | 9 | simulate #16 |
| AC-33 上位の差(新設) | 4 | simulate #17 |
| AC-14 画像保存 | 12, 13 | browser-check の card(Chrome・Edge で `usedFallback=false`) |
| AC-15, AC-16, AC-17, AC-29 ランキング・リセット | 6, 11, 13 | simulate #12、browser-check の ranking・reset-confirm |
| AC-18 localStorage が使えない | 6, 13 | simulate #12、browser-check の no-storage |
| AC-19 最初に戻る | 13 | browser-check の smoke |
| AC-20 無操作リセット | 13 | browser-check の idle |
| AC-21 画像の代替 | 7, 11 | simulate #13、browser-check の image-fallback |
| AC-22, AC-34 レイアウト | 14 | browser-check の layout、スクリーンショットの目視 |
| AC-23 reduced-motion | 14, 11 | browser-check の reduced-motion |
| AC-24 静的検査 | 全部 | `node tools\check-static.js` |
| AC-25 免責・README | 14, 18 | browser-check の result(免責の文字)、README の目視 |
| AC-26 詳細ダイアログ | 11 | browser-check の dialog |
| AC-27 武将データ | 3, 4, 9 | simulate #1 |
| AC-28 理由文の整合 | 5 | simulate #11 |

## 5. 自動化できない確認(README の動作確認記録に「未確認」として残す)

- Firefox・Safari・iOS Safari の実機での動作(この PC にはない)。
- `python -m http.server` での起動(python が入っていない。同じコードを Node の http サーバーで確かめる)。
- bfcache の復元(`pageshow` の `persisted`)。ヘッドレスでは再現が不安定なので、コードの確認だけにする。
- 実機のスマホでのタッチ操作と表示(エミュレーションの 360×540・360×640 で代わりに確かめる)。
- キオスクモードでのダウンロードバブルの表示。
