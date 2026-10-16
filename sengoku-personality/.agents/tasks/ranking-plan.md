# 実装計画: プレイヤー向け「みんなの結果ランキング」

ROOT = `c:\Users\村上琉伊\Desktop\大学祭\性格診断ゲーム戦国武将バージョン\sengoku-personality`(git リポジトリではない。コミット・push はしない。進捗は FEAT ファイルの status/findings に書く)
共通ルール: `.agents\tasks\task-sengoku-personality\step-rules.md`(絶対パス、PowerShell で `;` 区切り、UTF-8 は書き込みツールで、`?.` `??` `import` `http(s)://` をアプリのコードに書かない、classic script のみ)。
既存の `plan.md` `design.md` は上書きしない。

## 0. 調べて分かった現状(読んだコードに基づく)

- 運営用ランキング画面 = `index.html` の `#screen-ranking` / `#ranking-root`。`js/results.js` の `renderRankingScreen()` が描く(タブ 本日/日付別/累計、`<details class="staff-menu">` の中に `data-action="reset"`「集計をリセット」、確認は `SG.Results.confirm()`)。
- 現在の導線は 2 つ: スタート画面右下の小さな `#open-ranking`「運営用(集計)」と、**結果画面の `data-action="ranking"`「本日のランキングを見る」(results.js 149 行付近)**。後者は運営用画面(リセットの入口入り)を来場者に見せてしまう。要件 3 を守るため、**結果画面のこのボタンを新しい来場者向けランキングに置き換える**(重要な設計判断 D2)。
- 集計は `js/storage.js`(`SG.Storage`)。キー `sengoku-personality:v1:stats`、形式 `{ v:1, total:{id:件数}, daily:{'YYYY-MM-DD':{id:件数}} }`。`store.getCounts('today'|'total'|日付)` は `[{id,count}]` を件数降順(同数は武将の配列順)で返し、例外を投げない。`store.getTotalPlayers(scope)`、`store.isPersistent()`、`store.todayKey()` もある。**storage.js は変更しない(形式・キー・API 不変)**。
- 加算は `js/app.js` の `enterResult()` の 1 か所、`state.counted` で 1 回に限る。`openRanking()` / `onRankingBack()` は加算しない。結果 DOM は戻る時に保持される。
- 画面遷移は `app.js` の `SCREENS` と `showScreen(phase)`。無操作タイマーは `idleLimit()`(RESULT/RANKING は `IDLE_RESET_MS_RESULT`)。`reset()` は `SG.Results.clear(els.rankingRoot)` などで DOM を空にする。
- `tools/check-static.js` は `SCRIPT_ORDER`(index.html の script の並び)を検証する。`tools/browser-check.js` は `SCENARIOS` に登録したシナリオを `all` で全部実行する(現在 153 項目)。`tools/simulate.js` は Node で `require` して検査する。
- 既存の browser-check には「結果画面の `[data-action="ranking"]` を押すと運営用画面が開く」前提の箇所が複数ある(smoke 371 行付近、ranking 709 行付近、card 909 行付近、layout 1108 行付近、keyboard)。置き換え後は更新が必要。

## 1. 設計判断(各 1〜2 文)

- D1 来場者画面は新しい別画面 `#screen-player-ranking`(phase `PLAYER_RANKING`)にする。ダイアログにしない。既存のステートマシン・無操作タイマー・reset() の流れにそのまま乗せられ、結果画面の DOM に触れずに往復できるため。
- D2 結果画面の「本日のランキングを見る」を「みんなの結果ランキング」に置き換え、来場者向け画面を開く。運営用画面への入口はスタート画面右下の `#open-ranking` だけにする(従来どおり目立たない)。結果画面から運営用画面(リセットあり)に入れてしまうのは要件 3 に反するため。
- D3 来場者画面の描画は新ファイル `js/player-ranking.js`(`SG.PlayerRanking`)に分ける。results.js のリセット処理と同じファイルに置かないことで、「リセットのコードが来場者側に存在しない」ことを静的検査(check-static)で保証できる。`SCRIPT_ORDER` は results.js の後、share-card.js の前に入れる。
- D4 来場者側に渡すストアは読み取り専用のラッパー(`getCounts` / `getTotalPlayers` / `isPersistent` / `todayKey` だけ)にする。`reset` / `increment` を渡さない。app.js で作る。
- D5 集計は既存の `getCounts('today')` と `getCounts('total')` を読むだけ。新しい集計方式・データ形式は作らない。タブは「今日」「累計」の 2 つ(日付別は運営用だけ)。
- D6 順位は件数順の連番(同数は storage の並び順=武将の配列順。運営用と同じ)。TOP3 は金・銀・銅の枠と太い文字で強調し、色だけに頼らず「1位」などの文字を必ず出す。割合は `Math.round(count / total * 100)` %、横棒は 1 位の件数に対する長さ(運営用と同じ見え方)。初期表示は上位 10 人、「すべて表示」で 20 人。
- D7 結果画面から開いたときは、今回の武将の行に `is-me` クラス、「あなた」バッジ(文字)、視覚的に隠した文言を付ける。10 位より下なら最初から全件表示にしてその行を見えるようにする。
- D8 戻る: 結果画面から開いた場合は `showScreen('RESULT')` だけで戻る(`enterResult()` を呼ばない=再加算なし、結果 DOM は保持)。スタートから開いた場合は `showScreen('START')` で戻る。戻り先にフォーカスを戻す(開いたボタン)。Esc でも戻る。
- D9 読み込み失敗: 描画を `try/catch` で囲み、失敗時・0 件かつ保存不可のときは「集計を読み込めませんでした」を表示して診断本体は動かす。保存不可のときは小さな注記「この環境では集計を保存できません」も出す。
- D10 無操作: `idleLimit()` に PLAYER_RANKING を足す(RESULT/RANKING と同じ `IDLE_RESET_MS_RESULT`)。満了で `reset()` が来場者画面の DOM も空にする。

## 2. 実装項目(依存順)

- [ ] 1. 来場者向け画面の描画モジュールを作る(純粋ロジックを分けて Node でテスト可能にする)。
      `js/player-ranking.js` を新規作成。UMD 風(`SG.PlayerRanking`、`module.exports`)。ロード時は DOM・localStorage に触れない。
      - `buildRows(counts, highlightId)`: `[{id,count}]` から `[{rank, id, count, percent, widthPct, isMe, tier}]` を作る純粋関数(`tier` は 1〜3 位のみ 'gold'/'silver'/'bronze')。
      - `render(rootEl, readOnlyStore, handlers, options)`: `handlers = { onBack }`、`options = { highlightId }`。見出し「みんなの結果ランキング」、`role="tablist"` の 2 タブ(今日/累計。←→/Home/End で移動する WAI-ARIA tabs、選択タブだけ tabindex=0)、`role="tabpanel"`、人数・順位リスト(`<ol>`、「1位 織田信長型　25人(40%)」の文言と横棒)、0 件文言「まだ診断結果がありません。あなたが最初の一人になろう！」、注記「この端末・このブラウザの集計です(他の端末とは共有されません)」、大きな「戻る」ボタン。個人情報・リセット・削除・運営の語は DOM に出さない。武将名は `SG.Util.esc` を通す。重要処理に日本語コメント。
      - `dispose(rootEl)`: 付けたイベントを外して中身を空にする。
      Files: `js/player-ranking.js`
      Verify: `node --check js\player-ranking.js`。項目 2 の simulate で `buildRows` を検査する。

- [ ] 2. HTML・CSS・配線を足す(項目 1 に依存)。
      - `index.html`: `#screen-player-ranking`(`<section class="screen screen-player-ranking" aria-labelledby=… hidden>` と `#player-ranking-root`)を `#screen-ranking` の後に追加。スタート画面の `#btn-start` の下、`.start-note` の前に目立つ `<button type="button" id="btn-player-ranking" class="btn btn-ranking">みんなの結果ランキング</button>` を追加(運営用リンク `#open-ranking` は現状維持)。`<script src="js/player-ranking.js">` を `results.js` の後に追加。
      - `js/results.js`: 結果画面のボタン `data-action="ranking"` のラベルを「みんなの結果ランキング」に変更(`btn btn-ranking` のスタイル)。`renderRankingScreen`(運営用)は変更しない。
      - `js/app.js`: `SCREENS` に `PLAYER_RANKING: 'screen-player-ranking'`、`openPlayerRanking(returnTo)`(読み取り専用ラッパーを作り `SG.PlayerRanking.render`、`state.rankingReturnTo` に記録、`showScreen('PLAYER_RANKING')`、見出しにフォーカス)、`onPlayerRankingBack()`(D8)、`onShowRanking`(結果画面)を `openPlayerRanking('RESULT')` に差し替え、スタートの新ボタンを `openPlayerRanking('START')` に配線。`openRanking`(運営用)は START からの呼び出しだけにして、`onRankingBack` の RESULT 分岐は削除(運営用の戻り先は常に START)。`idleLimit()` に PLAYER_RANKING を追加。`reset()` に `SG.PlayerRanking.dispose(els.playerRankingRoot)` を追加。`getState().rankingReturnTo` は残す。`phase === 'RESULT'` / `'START'` 以外で開けない条件を付ける。ランキング加算(`enterResult()`)は触らない。
      - `css/style.css`: `.btn-ranking`(金枠・深紅の目立つ大きなボタン、min-height 52px)、`.screen-player-ranking` 以下(`.pr-title` `.pr-tabs` `.pr-tab` `.pr-row` `.pr-row.tier-gold/silver/bronze` `.pr-row.is-me` `.pr-badge` `.pr-bar` `.pr-empty` `.pr-note`)を既存の変数(`--gold` `--gold-light` `--crimson` `--ink` `--font-serif`)で追加。ボタン・タブは 48px 以上。`:focus-visible` を目立たせる。バー幅のトランジションがある場合は `@media (prefers-reduced-motion: reduce)` で無効にする(既存の動きを減らす指定の書き方に合わせる)。
      - `tools/check-static.js`: `SCRIPT_ORDER` に `js/player-ranking.js` を results.js の後に追加。さらに「`js/player-ranking.js` と `#screen-player-ranking` の HTML ブロックに reset / removeItem / リセット / 削除 / 運営 / increment が含まれない」検査を足す(違反は `ファイル:行番号: パターン` 形式)。
      Files: `index.html`, `js/results.js`, `js/app.js`, `css/style.css`, `tools/check-static.js`
      Verify: `node --check js\app.js`、`node --check js\results.js`、`node tools\check-static.js` → `check-static: OK (14 files)`。

- [ ] 3. simulate に来場者側ロジックの検査を足す(項目 1 に依存)。
      `tools/simulate.js` に新しい節: `require(js/player-ranking.js)` で `buildRows` を検査(降順・連番の rank・percent の丸め・0 件は []・TOP3 だけ tier・highlightId の行だけ isMe・widthPct の最大 100)、ロード時に localStorage に触れないこと(既存の罠の流儀に合わせる)。既存の節番号と罠の順序は壊さない。
      Files: `tools/simulate.js`
      Verify: `node tools\simulate.js` → `RESULT: ALL PASS`(exit 0)。

- [ ] 4. 既存の browser-check を新しい導線に合わせて直す(項目 2 に依存。検査を緩めない)。
      `grep` で `[data-action="ranking"]` と `#open-ranking` の全箇所を洗い出し、結果画面からの運営用画面の確認は「スタート画面の `#open-ranking`」経由に付け替える(運営用の 本日/日付別/累計・日付 select・リセット確認・キーボードのタブ操作・layout の運営用メニュー展開が対象)。smoke の「ランキングを開いて戻る(再加算しない)」は結果画面から来場者向け画面を開く検査に直す(1 位の行・人数・戻って結果画面が保持・カウント不変)。検査の閾値・件数は減らさない。
      Files: `tools/browser-check.js`
      Verify: `node tools\browser-check.js --browser chrome` → ALL PASS(件数は 153 以上)。

- [ ] 5. 新シナリオ `player-ranking` を browser-check に追加(項目 2・4 に依存)。`SCENARIOS` に登録し、`--scenario all` に自動で含める。内容:
      a. スタート画面に「みんなの結果ランキング」があり、押すと PLAYER_RANKING になる(0 件: 「まだ診断結果がありません。あなたが最初の一人になろう！」、注記あり、`SG.Storage` の合計は 0 のまま=開くだけで増えない)。
      b. 種データ(localStorage に既存形式 `SEED` を投入)で順位・人数・割合・TOP3 クラスが反映され、今日/累計の切替で件数が変わる。←→/Home/End でタブ移動、`aria-selected` / `tabindex` が正しい。
      c. 結果画面まで診断→ボタンで開く→自分の武将が `is-me`+「あなた」→戻るで RESULT、`counted` / 回答 / 結果 DOM / 合計人数が不変。往復 3 回しても増えない。リサイズ・リロードでも増えない。
      d. 「最初に戻る」で回答・結果・来場者画面の DOM が空。
      e. 来場者画面の DOM(`#screen-player-ranking` 全体)に `[data-action=reset]`・`button` の文言(リセット/削除/消す/運営/clear/delete)・`details`・`hidden` 要素の操作・`accesskey`・隠しショートカット(キー入力 `Ctrl+Shift+R` 等と一般的なキー列を送っても確認ダイアログが開かない)が無い。結果画面の DOM にも運営用画面への導線が無い。
      f. 運営用: スタートの `#open-ranking` → 運営用画面 → 閉じた `staff-menu` を開く → リセットは確認ダイアログ付き(キャンセルで消えない、OK で消える)。その後来場者画面が 0 件表示になる。
      g. 無操作: `SG_CONFIG_OVERRIDE` で短くして、来場者画面表示中に警告→自動復帰し、DOM が空になる。
      h. localStorage 不可(既存 `no-storage` と同じ方法で `Storage` を使えなくする): 来場者画面が例外なく「集計を読み込めませんでした」または保存不可の注記を出し、診断は完了できる。
      i. `checkNoProblems` で console のエラー・警告・例外が 0。
      j. `prefers-reduced-motion: reduce` で来場者画面の要素の `transition-duration` / `animation-duration` が 0 に近い。
      k. 1280×800 と 390×844 で横スクロールなし(`noHScroll`)、ボタンの高さ 48px 以上。
      Files: `tools/browser-check.js`
      Verify: `node tools\browser-check.js --browser chrome --scenario player-ranking` と `--browser edge` → ALL PASS。

- [ ] 6. スクリーンショットを撮って目視する(項目 5 に依存)。`screens` シナリオに追加するか `--screenshots` で、`.agents\tasks\screens\` 配下(chrome\・edge\)に `player-ranking-start-{1280,390}`、`player-ranking-empty-*`、`player-ranking-total-*`、`player-ranking-from-result-*`(ハイライト)、`start-with-button-*`、`result-with-button-*` を保存。`read_file` で画像を開いて目視し、文字の欠け・はみ出し・ボタンと城や幟旗の重なり・結果画面の操作ボタンの並び(ボタンが増えて折り返す)・TOP3 の見やすさ・バッジの見え方を確認する。**「問題なし」と断定せず、見つけた問題は直して撮り直し、見えにくい点は記録する。** 実機のスマホ・他ブラウザ(Firefox/Safari/iOS)は確認できないので「未確認」として README に残す。
      Files: `tools/browser-check.js`(`scenarioScreens`)、`.agents\tasks\screens\`
      Verify: コマンドが成功し、画像ファイルが保存され、目視した所見を FEAT-002 の `findings` に書く。

- [ ] 7. README を更新(項目 2 以降の事実に基づく)。`README.md` の「4. 展示の運用 > ランキングの見方」を「来場者向け(みんなの結果ランキング)」と「運営用(集計表)」に分けて書く: 場所(スタート画面と結果画面の大きなボタン / 運営用はスタート画面右下の小さな「運営用(集計)」)、違い(来場者向けは 今日/累計だけ・人数と割合だけ・個人情報なし / 運営用は日付別とリセットあり)、**来場者向け画面にリセットは無いこと**、結果画面のボタンが来場者向けに変わり運営用画面は結果画面からは開けなくなったこと、集計はこの端末・このブラウザのみ。「ランキングのリセット」の手順(スタート画面から入る)は変えない。ファイル構成表に `js/player-ranking.js` を追加し、「13. 動作確認記録」の検査数・シナリオ表・スクリーンショットの所見・未確認項目を実測値に更新する。`.agents\tasks\build-fix-log.md` の末尾に今回の作業記録を追記する。
      Files: `README.md`, `.agents\tasks\build-fix-log.md`
      Verify: 記載したコマンドをもう一度実行し、README の数字と一致する。

## 3. 全体の検証(最後に必ず全部実行。cwd=ROOT)

1. `node --check` を変更した JS 全部(`js\player-ranking.js` `js\app.js` `js\results.js` `tools\*.js`)
2. `node tools\simulate.js` → `RESULT: ALL PASS`、exit 0
3. `node tools\check-static.js` → `check-static: OK (14 files)`、exit 0
4. `node tools\browser-check.js --browser chrome --screenshots "ROOT\.agents\tasks\screens\chrome"` → ALL PASS(153 + 新シナリオ分)
5. `node tools\browser-check.js --browser edge --screenshots "ROOT\.agents\tasks\screens\edge"` → ALL PASS
6. `node tools\browser-check.js --browser chrome --http --scenario smoke` → ALL PASS
7. スクリーンショット(1280×800 と 390×844)を目視

## 4. 実装時に実機/ブラウザで確認する項目(「問題なし」と断定しない)

- スタート画面 390×844 で新ボタンが城の装飾・右下の「運営用(集計)」・幟旗と重ならず押せるか。1280×800 で縦に収まるか。
- 結果画面でボタンが増える/ラベルが長くなって折り返しや高さの崩れが出ないか。
- 来場者画面を結果画面から開閉した後、結果画面のスクロール位置・フォーカス・詳細ダイアログ・画像保存ボタンの状態が壊れないか(画像プレビュー表示中は開けない/閉じてから開く)。
- 無操作警告(`#idle-toast`)が来場者画面で見えて「続ける」が押せるか。
- キーボードだけ(Tab / ←→ / Home / End / Enter / Esc)で最後まで操作できるか。スクリーンリーダー(NVDA 等)での読み上げはこの環境では未確認とする。
- 20 人全員が出た場合の 20 行表示の長さ、武将名が長い行(例: 立花宗茂)の折り返し。
- 日付が変わった後の「今日」(0 件になる)表示。

## 5. 範囲外

storage.js の形式変更、日付別・リセット・削除を来場者側に置くこと、サーバー送信、個人情報の入力。運営用のリセット(確認付き)と入口の位置は現状維持。
