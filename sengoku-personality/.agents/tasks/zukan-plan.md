# 実装計画: 「戦国武将図鑑」(診断しなくても武将の情報を見られる機能)

ROOT = `c:\Users\村上琉伊\Desktop\大学祭\性格診断ゲーム戦国武将バージョン\sengoku-personality`(git リポジトリではない。コミット・push はしない。進捗は zukan-review.json と作業記録に書く)
共通ルール: `.agents\tasks\task-sengoku-personality\step-rules.md`(絶対パス、PowerShell は `;` 区切りで `&&` 不可、UTF-8 は書き込みツールで、`?.` `??` `import` `http(s)://` をアプリのコードに書かない、classic script のみ、ブラウザは自分で起動した PID だけ終了)。
既存の `design.md` `plan.md` `build-fix-log.md` `ranking-plan.md` は上書きしない(build-fix-log.md は末尾に追記のみ)。

## 0. 調べて分かった現状(読んだコードに基づく)

- 画面遷移は `js/app.js` の `SCREENS`+`showScreen(phase)`。`idleLimit()` は QUESTION だけ 90 秒、RESULT/RANKING/PLAYER_RANKING は `IDLE_RESET_MS_RESULT`(150 秒)、START/ANALYZING は無効。`reset()` が全 DOM・ダイアログ・タイマーを片付けて START へ戻す。
- 直近の追加物 `player-ranking.js`(`SG.PlayerRanking`)が雛形: `render(rootEl, store, handlers, options)` / `dispose(rootEl)`、`bind`/`unbindAll` でイベントを後始末、Esc で戻る、WAI-ARIA の tabs。app.js 側は `openPlayerRanking(returnTo)`(`returnTo` は START か RESULT だけ、`playerRankingOpener` にフォーカス戻し先を保持、結果画面へは `showScreen('RESULT')` だけで戻り `enterResult()` を呼ばないので再加算しない)、`onPlayerRankingBack()`。スタート画面ボタンは `#btn-player-ranking`(`.btn.btn-ranking`)、結果画面は `data-action="ranking"`。
- 武将詳細の UI は `js/results.js` の `openGeneralDialog(general, opener, userValues)`(`#dlg-general`)。生没年・活躍した地域・description・主な功績・有名な出来事・診断用の性格イメージ・`SG.Chart.renderMiniBars(container, general, user)`(`user` は任意。省略すると「あなた」の値を出さず、注記「診断用の仮想モデル値です(歴史学的な根拠のある数値ではありません)」が常に付く)を描く。ダイアログの click/close ハンドラは `bindGeneralDialog` で 1 回だけ登録され、閉じると `replaceChildren()`、`generalOpener` へフォーカスを戻す。`closeAllDialogs()` が reset から呼ばれる。
- 代替カードは `SG.Crest.svg(general, {idPrefix, title})`(300x400 SVG。画像が無い武将の見た目)。`results.js` の内部関数 `portraitHtml(g)` / `crestHtml(g)` / `attachImageFallback(container)` は `g.image` があれば `<img>`、失敗時に代替カードへ差し替える。**これらは results.js 内に閉じていて export されていない**。
- 武将データは `js/generals.js`(`SG.Generals`、20 人)が唯一の情報源。各要素に `id, name, title, description, 6 パラメータ, image, lifespan, region, achievements[], events[], imageOfType, reason, crest`。`lifespan` は「1534年〜1582年」「1537年〜1598年(1536年説あり)」のような文字列。読みがな(ふりがな)の項目は無い。
- 集計は `SG.Storage`(localStorage キー `sengoku-personality:v1:stats`)。加算は `enterResult()` の 1 か所だけ。図鑑は Storage を一切受け取らない設計にすれば、構造的に集計へ触れられない。
- `tools/check-static.js`: `SCRIPT_ORDER`(index.html の script の並び)、`PLAYER_FORBIDDEN`(`js/player-ranking.js` と `#screen-player-ranking` ブロックにリセット系の語を禁止)。現在 `check-static: OK (14 files)`。`tools/simulate.js`: 節番号つきの `check(n, cond, msg)`、player-ranking.js を `require` して localStorage へ触れないことも検査(18 節)。`tools/browser-check.js`: `SCENARIOS` に登録(現在 `player-ranking` の後に `screens`)、`scenarioPlayerRanking`(1342 行付近)が雛形、`scenarioScreens`(1252 行付近)がスクショ、`noHScroll(page,S,label)`、`focusIs(page,sel)`、`check(S, ac, cond, msg)`。README 13 章の記録は現在 Chrome/Edge とも 184 checks。

## 1. 設計判断

- D1 図鑑は新しい別画面 `#screen-zukan`(phase `ZUKAN`)にする。ダイアログにしない。無操作タイマー・reset()・戻る動線に既存のステートマシンのまま乗せられ、20 枚のグリッドと詳細ダイアログを二層に分けられるため(player-ranking と同じ方針)。
- D2 描画は新ファイル `js/zukan.js`(`SG.Zukan`、`render` / `dispose` / 純粋関数)。**武将データは `SG.Generals` を読むだけ**で、新しいデータ・説明文・コピーは作らない。`SCRIPT_ORDER` では player-ranking.js の後、share-card.js の前。
- D3 詳細は新規実装せず `SG.Results.openGeneralDialog` を再利用する。そのため results.js に最小の変更を入れる: (a) `portraitHtml` と `attachImageFallback` を `SG.Results` から export(図鑑のカードが同じ代替カード生成・画像失敗時の回復を使う)。(b) `openGeneralDialog(general, opener, userValues, options)` に第 4 引数 `options` を追加(後方互換。省略時は今までどおり)。`options = { nav: { index, total, onPrev(), onNext() } }` を渡すと、ダイアログ先頭付近に「前の武将」「次の武将」ボタンと「n / 20」を出す。ダイアログ本体の組み立てを内部関数 `fillGeneralDialog(dlg, general, userValues, nav)` に分け、前/次の押下ではダイアログを閉じずに中身だけ差し替える。
- D4 前/次の挙動: 押すとアプリ側(zukan.js が渡すコールバック)が次の武将を返し、`fillGeneralDialog` で再描画、ダイアログの `scrollTop = 0`、フォーカスは押したボタンと同じ方向のボタン(端で無効になる場合は閉じるボタン)へ。切り替え後の武将名を `aria-live="polite"` の visually-hidden 領域で通知。端(先頭/末尾)でのループはせず、ボタンを `disabled`+`aria-disabled`(player-ranking/質問画面の `btn-prev` と同じ流儀)。閉じたときのフォーカス戻し先は「今表示している武将のカード」(コールバックから `opener` を更新)。前/次の順序は画面に表示中の並び(並べ替え後の順)に従う。
- D5 並べ替え: ボタン 2 つの切替「標準の順」/「生まれた順」(`aria-pressed` のトグルボタン群、`role="group"` `aria-label="並べ替え"`)。地域での絞り込みは `region` が自由文(例「尾張(愛知県)・美濃・近江・京都」)で、きれいな地域区分を作るには generals.js に項目追加が必要になり二重管理の入口になるため採用しない。生年は既存の `lifespan` の先頭 4 桁から純粋関数 `parseBirthYear(lifespan)` で取り出す(取れなければ 9999 で末尾)。同年は元の配列順(安定ソート)。検索入力は作らない(要件)。
- D6 戻り先: START または RESULT からだけ開ける(`openZukan(returnTo)`)。戻ると元の画面へ `showScreen` だけで戻る(RESULT の DOM は保持、`enterResult()` は呼ばない=再加算しない)。フォーカスは開いたボタンへ戻す。Esc でも戻る(ダイアログが開いている間はダイアログ側の Esc が先)。
- D7 「診断を始める」: 図鑑から押したら `reset()` してから `startDiagnosis()`(START・RESULT どちらから開いても、前回の結果・図鑑の DOM が残らず、answers/counted が初期化される)。結果画面は「最初に戻る」も確認なしでリセットされる既存仕様と揃える。
- D8 無操作: `idleLimit()` に ZUKAN を追加(RESULT と同じ `IDLE_RESET_MS_RESULT`)。詳細ダイアログ表示中の警告は既存の `showIdleToast`(ダイアログ内へ一時移動)が処理する。満了で `reset()` が `SG.Zukan.dispose` と `closeAllDialogs()` を呼ぶ。
- D9 localStorage・集計の境界: zukan.js と図鑑の HTML ブロックは Storage・localStorage・sessionStorage・increment・reset 系の語を持たない(check-static で検査)。app.js が図鑑に渡すのは `{ onBack, onStart }` だけで store を渡さない。図鑑の閲覧では `state.answers` / `counted` / `diagnosis` を一切変更しない。
- D10 導線: スタート画面に `#btn-zukan`(`.btn.btn-zukan`「戦国武将図鑑」)を `#btn-start` の下、`#btn-player-ranking` の上または下に配置(金枠の大きなボタン)。結果画面の `.result-actions` にも `data-action="zukan"`「戦国武将図鑑を見る」を追加(`btn btn-sub`、みんなの結果ランキングの次)。
- D11 新しく画面に出す文言は既存データの再表示と案内文だけ。見出し「戦国武将図鑑」、導入「診断をしなくても、20人の戦国武将の紹介を見られます。」、注記「史実の説明は一般的な通説に基づく要約です。性格パラメータは診断用の仮想モデルで、史実の数値ではありません。」(後者は既存ダイアログの注記と同趣旨)。不確かな逸話は追加しない。
- D12 見た目: カードは `<button type="button" class="zukan-card">`(`aria-label="{name}をくわしく見る"`)。中に代替カード(`aria-hidden`)、名前、`title`(タイプ)。グリッドは 390px 幅で 2 列、768px 以上で 3 列、1024px 以上で 4〜5 列(1280x800 で見やすい列数を実測で決める)。カードのタップ領域は 48px 以上。`:focus-visible` は player-ranking と同じ 4px の `--gold-light` アウトライン。ホバー等のトランジションは `@media (prefers-reduced-motion: reduce)` で無効にする(style.css 730 行付近の既存ブロックに追記)。

## 2. 実装項目(依存順。各項目の終わりでビルド可能・既存検査が通る状態にする)

- [ ] 1. results.js の再利用準備(D3)。
      `portraitHtml` と `attachImageFallback` を `SG.Results` に export。`openGeneralDialog` を `fillGeneralDialog` に分割し、第 4 引数 `options.nav` に対応(前/次ボタン、`data-nav="prev|next"`、`bindGeneralDialog` の click 委譲で処理、live 領域、閉じたときに nav 状態を捨てる。**options を渡さない既存の呼び出し(結果画面の TOP3・20 人一覧)の DOM・挙動は変えない**)。重要な処理に日本語コメント。
      Files: `js/results.js`
      Verify: `node --check js\results.js`、`node tools\simulate.js`(ALL PASS)、`node tools\browser-check.js --browser chrome --scenario dialog`(既存の詳細ダイアログ検査が全 PASS=後方互換)。

- [ ] 2. 図鑑の描画モジュールを作る(項目 1 に依存)。
      `js/zukan.js` を新規作成(UMD 風、`SG.Zukan = { parseBirthYear, sortGenerals, render, dispose }`、`module.exports`。ロード時は DOM・localStorage に触れない)。
      - `parseBirthYear(lifespan)`: 先頭の 4 桁の西暦を数値で返す。取れなければ 9999。
      - `sortGenerals(list, mode)`: `mode` は 'default' | 'born'。元配列を変更しない新しい配列を返す。born は生年昇順、同年は元の順(安定)。
      - `render(rootEl, handlers, options)`: `handlers = { onBack, onStart }`。見出し(`tabindex="-1"` の h2、`id` は `SG.Util.uid`)、導入文、並べ替えトグル 2 つ、カードグリッド(`<ul class="zukan-grid">` の `<li>` に `<button class="zukan-card" data-general-id>`)、注記、操作ボタン(「診断を始める」`.btn.btn-primary` と「戻る」`.btn.btn-sub`)。カードクリック(イベント委譲)で `SG.Results.openGeneralDialog(g, cardButton, undefined, { nav })` を呼ぶ。`nav.onPrev/onNext` は現在の並び順の隣のカードを返して `opener` を更新。並べ替えはグリッドだけ再描画し、フォーカスは押したトグルに残す。キーボード: Tab/Enter/Space で全操作、Esc で戻る。`SG.Results.attachImageFallback(grid)` を再描画のたびに呼ぶ。データ由来の文字列はすべて `SG.Util.esc`。
      - `dispose(rootEl)`: `bind`/`unbindAll` でイベントを外し `replaceChildren()`、並べ替え状態を初期に戻す。
      Files: `js/zukan.js`
      Verify: `node --check js\zukan.js`。項目 5 の simulate で純粋関数を検査。

- [ ] 3. HTML・CSS・app.js の配線(項目 2 に依存)。
      - `index.html`: `#screen-zukan`(`<section id="screen-zukan" class="screen screen-zukan" aria-label="戦国武将図鑑" hidden><div id="zukan-root"></div></section>`)を `#screen-player-ranking` の後に追加。スタート画面に `#btn-zukan` を追加(`.start-note` の前)。`<script src="js/zukan.js">` を player-ranking.js の後に追加。
      - `js/app.js`: `SCREENS.ZUKAN`、`els.zukanRoot` / `els.zukanBtn`、`zukanOpener`、`openZukan(returnTo)`(`state.phase !== returnTo` や START/RESULT 以外では開かない。`state.zukanReturnTo` を `initialState()` に追加)、`onZukanBack()`(D6)、`onZukanStart()`(D7: `SG.Zukan.dispose` → `reset()` → `startDiagnosis()`)、スタートの `#btn-zukan` と結果画面の `onShowZukan`(`SG.Results.showResult` の handlers に追加)を配線、`idleLimit()` に ZUKAN、`reset()` に `SG.Zukan.dispose(els.zukanRoot)` と `zukanOpener = null`、`getState()` に `zukanReturnTo` を追加。**`store` / `increment` / `enterResult` 周りは触らない。** ファイル冒頭コメントの状態遷移説明に ZUKAN を追記。
      - `js/results.js`: `showResult` の `.result-actions` に `data-action="zukan"` ボタンを追加し、click 委譲で `handlers.onShowZukan` を呼ぶ。
      - `css/style.css`: `.btn-zukan`(`.btn-ranking` と同系統で区別できる配色の大きなボタン、min-height 52px)、`.screen-zukan` 一式(`.zukan` `.zukan-title` `.zukan-lead` `.zukan-sort` `.zukan-sort-btn[aria-pressed="true"]` `.zukan-grid` `.zukan-card` `.zukan-card-name` `.zukan-card-type` `.zukan-note` `.zukan-actions`)、ダイアログの前/次(`.dlg-nav` `.dlg-nav-btn` `.dlg-nav-count`)。既存の変数(`--gold` `--gold-light` `--crimson` `--ink` `--font-serif`)を使う。390px で横スクロールが出ないよう `min-width: 0` と `overflow-wrap: anywhere` を入れる。reduced-motion ブロックへ追記。
      - `tools/check-static.js`: `SCRIPT_ORDER` に `js/zukan.js` を追加。`ZUKAN_FORBIDDEN = /reset|removeItem|localStorage|sessionStorage|SG\.Storage|increment|リセット|削除|運営/gi` を `js/zukan.js`(コメント含む)と index.html の `#screen-zukan` ブロックに適用(`checkPlayerSide` と同じ流儀で関数を共用/複製)。
      Files: `index.html`, `js/app.js`, `js/results.js`, `css/style.css`, `tools/check-static.js`
      Verify: `node --check js\app.js`、`node --check js\results.js`、`node tools\check-static.js` → `check-static: OK (15 files)`。ブラウザで `index.html` を開きスタート画面のボタンから図鑑が開く(項目 6 の前の目視)。

- [ ] 4. 既存の browser-check が新しいボタンで壊れていないか確認・修正(項目 3 に依存。検査を緩めない)。
      スタート画面のボタン数/配置、結果画面の `.result-actions`、layout の重なり検査、keyboard の Tab 順などが対象。壊れた検査は期待値を新しい構成に合わせて直す(閾値・件数は減らさない)。
      Files: `tools/browser-check.js`
      Verify: `node tools\browser-check.js --browser chrome` → ALL PASS(184 以上)。

- [ ] 5. simulate に図鑑の検査を足す(項目 2 に依存)。
      `tools/simulate.js` に新しい節(既存の節番号の後に追加。既存の罠の順序は壊さない): `require(js/zukan.js)` で例外なし・localStorage への参照 0 回(18 節と同じ `lsTrap` の流儀)。`parseBirthYear` が 20 人全員の `lifespan` から 1500〜1600 年代の妥当な年を返す(9999 が 1 人もいない)。`sortGenerals(list,'default')` が id 並びを保ち、`'born'` が生年の昇順・同年は元の順・長さ 20・id の重複なし・元配列(`SG.Generals`)を変更しない。未知の mode は default 扱い。
      Files: `tools/simulate.js`
      Verify: `node tools\simulate.js` → `RESULT: ALL PASS`(exit 0)。

- [ ] 6. 新シナリオ `zukan` を browser-check に追加(項目 3・4 に依存)。`scenarioZukan(page, opts, url)` を作り `SCENARIOS` に `zukan: scenarioZukan` を `player-ranking` の後に登録(`--scenario all` に含まれる)。内容:
      a. スタートに `#btn-zukan`「戦国武将図鑑」があり、押すと phase `ZUKAN`。カードがちょうど 20 枚、各カードに名前とタイプ、代替カード SVG がある。開く前後で `localStorage` 全体(キーと値の JSON)・`SG.App.getState()` の `answers`(全 null)・`counted`(false)・`runId` が不変。往復を 3 回しても不変(ランキング合計が増えない。`localStorage` に種データを入れても変わらない)。
      b. 並べ替え: 「生まれた順」を押すと先頭が最も早い生年の武将になり、`aria-pressed` が切り替わり、20 枚のまま・フォーカスが押したボタンに残る。「標準の順」で元に戻る。
      c. カードをクリックで `#dlg-general` が開き、名前・生没年・活躍した地域・主な功績・有名な出来事・診断用の性格イメージ・6 本の `.mini-row`・仮想モデルの注記があり、「あなた」(`.mini-user`)が出ない。フォーカスは閉じるボタンか詳細内。「次の武将」「前の武将」で別の武将に切り替わり(名前が変わる・「n / 20」)、先頭で「前」が無効、末尾で「次」が無効。Esc で閉じるとフォーカスが開いたカード(並べ替え後も、最後に見ていた武将のカード)に戻る。
      d. 「診断を始める」で phase `QUESTION`・answers 全 null・Q1 が表示され、図鑑 DOM が空。「戻る」でスタートに戻り、フォーカスが `#btn-zukan`。Esc でも戻る。
      e. 結果画面から: 診断を完了(既存ヘルパーで回答)→ `[data-action="zukan"]` → 図鑑 → 戻ると RESULT に戻り、結果 DOM・`counted`・ランキング合計が不変(再加算なし)。結果画面の TOP3 詳細ダイアログ(`options` なし)には前/次が出ず、「あなた」の値が今までどおり出る。図鑑から「診断を始める」→ 結果 DOM が空になり新しい診断が始まる。
      f. 管理操作が無い: `#screen-zukan` と `#dlg-general` の DOM に `[data-action=reset]`・リセット/削除/消す/運営/clear/delete・`details`・`accesskey` が無い。Ctrl+Shift+R など隠しショートカット候補のキーを送っても `#dlg-confirm` が開かない。入力欄(`input` `textarea` `select`)が無い。
      g. 無操作: `SG_CONFIG_OVERRIDE`(IDLE_RESET_MS_RESULT を短く)で、図鑑表示中・詳細ダイアログ表示中のそれぞれで警告 → 自動で START に戻り、図鑑 DOM が空・ダイアログが閉じている。警告の「続ける」を押すと継続し、図鑑に留まる。
      h. localStorage 不可(`no-storage` と同じ方法)でも図鑑が開き 20 枚表示・詳細表示ができ、診断も始められる。
      i. `checkNoProblems` 相当で console のエラー・警告・例外が 0。外部通信なし(既存のネットワーク検査の流儀に合わせる)。
      j. `prefers-reduced-motion: reduce` で `#screen-zukan` 内の要素の `transition-duration` / `animation-duration` が 0 に近い(`scenarioPlayerRanking` の j 相当の書き方)。
      k. 1280x800 と 390x844 で `noHScroll`、カード列数(390 で 2 列、1280 で 4 列以上)、ボタン/カードの高さ 48px 以上、カードが画面外にはみ出さない。
      l. キーボードのみ: Tab でカードに到達し Enter で詳細を開き、Tab が詳細内に閉じ込められ(モーダル)、Esc で閉じ、Esc でもう一度で図鑑から戻れる。
      Files: `tools/browser-check.js`
      Verify: `node tools\browser-check.js --browser chrome --scenario zukan` と `--browser edge --scenario zukan` → ALL PASS。

- [ ] 7. スクリーンショットを撮って目視する(項目 6 に依存)。`scenarioScreens` に追加し、`.agents\tasks\screens\chrome\` と `edge\` に `start-zukan-{1280,390}`(ボタンが城・幟旗・運営用リンクと重ならないか)、`zukan-{1280,390}`(`fullPage`)、`zukan-born-{1280,390}`(生まれた順)、`zukan-detail-{1280,390}`(詳細+前/次)、`result-zukan-button-{1280,390}`(結果画面のボタン並び)を保存。`read_file` で画像を開いて目視し、文字の欠け・はみ出し・カードの名前の長さ(例: 立花宗茂 など長い名前)・2 列のバランス・詳細の前/次ボタンのタップ領域・結果画面のボタンが増えた折り返しを確認する。**「問題なし」と断定せず、見つけた問題は直して撮り直す。** 実機スマホ・Firefox/Safari・スクリーンリーダー読み上げは未確認と記録する。
      Files: `tools/browser-check.js`(`scenarioScreens`)、`.agents\tasks\screens\`
      Verify: `node tools\browser-check.js --browser chrome --screenshots "ROOT\.agents\tasks\screens\chrome"` が成功し、画像が保存される。

- [ ] 8. README と作業記録(項目 7 までの事実に基づく)。
      `README.md`: 「4. 展示の運用」に小節「戦国武将図鑑」を追加し、場所(スタート画面の「戦国武将図鑑」ボタン/結果画面の「戦国武将図鑑を見る」)、見られる内容(20 人のカード一覧、生まれた順の並べ替え、詳細: 生没年・活躍した地域・主な功績・有名な出来事・診断用の性格イメージ・6 パラメータ、前/次の移動、診断を始めるボタン)、**診断・ランキング集計・localStorage に影響しないこと(閲覧しても人数は増えない、回答状態を作らない、運営用の操作は無い)**、無操作 150 秒で最初の画面に戻ること、パラメータは診断用の仮想モデルであること、武将情報は `js/generals.js` を直せば図鑑にも反映されること(二重管理なし)を書く。ファイル構成表に `js/zukan.js` を追加し、「9. 診断用の仮想モデル」「11. 既知の制限」で図鑑に触れるべき点があれば追記、「13. 動作確認記録」の検査数・シナリオ表・スクリーンショットの所見・未確認項目を実測値で更新。`.agents\tasks\build-fix-log.md` の末尾に今回の作業記録を追記。
      Files: `README.md`, `.agents\tasks\build-fix-log.md`
      Verify: 記載したコマンドをもう一度実行し、README の数字と一致する。

## 3. 全体の検証(最後に必ず全部実行。cwd=ROOT)

1. `node --check` を変更した JS 全部(`js\zukan.js` `js\app.js` `js\results.js` `tools\*.js`)
2. `node tools\simulate.js` → `RESULT: ALL PASS`、exit 0
3. `node tools\check-static.js` → `check-static: OK (15 files)`、exit 0
4. `node tools\browser-check.js --browser chrome --screenshots "ROOT\.agents\tasks\screens\chrome"` → ALL PASS(184 + zukan 分)
5. `node tools\browser-check.js --browser edge --screenshots "ROOT\.agents\tasks\screens\edge"` → ALL PASS
6. `node tools\browser-check.js --browser chrome --http --scenario smoke` → ALL PASS
7. スクリーンショット(1280x800 と 390x844)を目視
8. 元の依頼文との突き合わせ: 診断しなくても武将の情報を見られる/運営用の管理操作が図鑑に無い/集計に影響しない

## 4. 実装時に確認する項目(「問題なし」と断定しない)

- スタート画面 390x844 で新ボタンが城の装飾・幟旗・右下の「運営用(集計)」と重ならず押せるか。1280x800 で縦に収まるか(ボタンが 3 つになる)。
- 結果画面のボタンが 4 つになって高さ・並びが崩れないか。図鑑を開閉した後の結果画面のスクロール位置・フォーカス・TOP3 詳細・画像保存ボタンの状態。
- 詳細ダイアログの前/次: 画面幅 360px でボタンと「n / 20」が折り返さないか、ダイアログの最大高 90dvh 内でスクロールできるか、無操作警告(`#idle-toast`)がダイアログ内で見えて押せるか。
- 画像プレビュー(`#dlg-card`)が開いている間は結果画面のボタンを押せない(モーダル)ので、図鑑は開けない前提でよいか。
- 20 枚全部のカードの文字量(`title` が長い武将)で高さが揃うか(揃えるのは CSS の `grid-auto-rows` ではなく `align-items: stretch` で対応)。
- キーボードのみ・スクリーンリーダー(NVDA 等)での操作は、キーボードはシナリオで検査し、読み上げは未確認と明記する。

## 5. 範囲外

武将データの追加・複製・編集、地域など新しい分類データの追加、検索入力、お気に入りなどの保存、図鑑閲覧のカウント、サーバー送信、個人情報の入力、運営用リセットの変更。
