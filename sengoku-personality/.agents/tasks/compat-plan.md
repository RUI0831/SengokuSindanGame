# 相性診断 実装計画 (compat-plan.md)

対象: `c:\Users\村上琉伊\Desktop\大学祭\性格診断ゲーム戦国武将バージョン\sengoku-personality`(以下 ROOT)。
Windows/PowerShell(区切りは `;`、`&&` 不可)。ファイル操作は必ず絶対パス。既存の `*-plan.md` / `design.md` は変更しない。

## 0. 調査で確認した事実(計画の根拠)

- `js/diagnosis.js`: `SG.Diagnosis` は純粋関数のみ。`diagnose(answers)` が `{user(0〜100の6値・丸めなし), userRounded, ranking(20行), top, top3}` を返す。`AXES`(key/label/desc)と `AXIS_STATS`(mean/sd、凍結済み、一様乱数回答での各軸の平均と標準偏差)を公開している。距離の最大値は `MAX_DISTANCE = sqrt(6×100²) ≈ 244.9`(非公開)。並び替えは「二乗距離を 1e-6 で整数化したキー → 武将配列の index 昇順」の全順序。
- `js/generals.js`: 20 人、6 値は整数 0〜100、深く凍結される(simulate #5)。**唯一の情報源**。配列順がタイブレーク。武将の 6 値の平均/標準偏差(実測): 平均 統率55.6 行動51.5 知略48.9 社交40.0 慎重49.4 革新44.8 / SD 8.9 13.3 12.9 11.3 13.2 13.2。
- `js/results.js`: `showResult(rootEl, diagnosis, handlers, options)` が HTML 文字列を組み立てて `rootEl.innerHTML` に入れる。節の順は 性格分析(`#sec-analysis`)→ 似ている理由(`#sec-reason`)→ TOP3(`#sec-top3`)。クリックは `rootEl` の委譲ハンドラで受け、`[data-general-id]` を持つ祖先があれば `openGeneralDialog(g, card.querySelector('.btn-detail'), diagnosis.user)` を開く(**相性カードもこの属性とクラスを使えば既存ダイアログを再利用できる**)。`portraitHtml(g)`、`findGeneral(id)`、`esc()` が使える。
- `js/app.js`: `enterResult()` が `showResult` を 1 回呼び、ランキング加算は `state.counted` で 1 回に限る。結果→図鑑/ランキング→戻る は **結果 DOM を保持して表示だけ切り替える**(`onZukanBack`)ので、相性節は自動で保たれる。`reset()` で `result-root` は空になる。app.js は変更不要。
- `js/share-card.js`(Canvas 1080×1920 の結果画像)は**今回は変更しない**(判断 D-6)。
- `index.html` の script 順は `util → questions → generals → diagnosis → reason → storage → crest → chart → results → player-ranking → zukan → share-card → app`。`tools/check-static.js` の `SCRIPT_ORDER` が同じ順序を検査している(新規 js を足すなら両方更新が必要)。
- `tools/simulate.js`: `section(id, title, fn)` / `check(id, cond, msg)` / `mulberry32` / `uniformAnswers` / `tendencyAnswers`(β=0.45) / `tally` / `byId` / `nameOf` があり、末尾の `section(19,…)` の後に `RESULT:` 行を出す。localStorage の罠(`lsTrap`)を張ってから各 js を `require` し、ロード時に触れないことを #18/#19 で検査している(同じ方式を踏襲する)。
- `tools/browser-check.js`: `scenarioXxx(page, opts, url)` 群と `main()`(1881 行付近)。ヘルパー `startAndAnswer(page, pattern)` / `waitResult` / `openApp(page,url,w,h)` / `check(scenario, ac, cond, msg)` / `noHScroll` / `focusIs` がある。CDP(Chrome/Edge)を実際に起動する。
- `tools/check-static.js`: 外部通信 API・`type="module"`・script 順などを静的検査。来場者側の語彙検査(`PLAYER_FORBIDDEN`)は player-ranking.js と図鑑のみが対象。
- README.md の章: 4. 展示の運用(`### 戦国武将図鑑` の次に相性の小節を追加)、7. データの変更方法、9. 診断用の仮想モデル、13. 動作確認記録。

## 1. 設計判断(各 1〜2 文)

- **D-1 新規 `js/compat.js`(`SG.Compat`)に分離する。** diagnosis.js は検証済みの診断コアなので触らない。UMD 風(`(function(root){…})(typeof window…)` と `module.exports`)で Node から `require` でき、DOM・localStorage・Date・乱数に触れない純粋関数にする。`SG.Generals` / `SG.Diagnosis.AXES` / `AXIS_STATS` / `rankGenerals` を呼び出し時に参照し、武将データは複製しない。
- **D-2 相性度 = 補完度 × 0.5 + 近さ × 0.5(同点時は配列順)。** 近さだけだと「似ている武将 TOP3」と同じ顔ぶれになり、補完だけだと極端な武将に集中するため、要件どおり両方を等重みで混ぜる。重みは試作で検証済み(§2.4)。
- **D-3 相性の候補から診断結果の 1 位(自分と同じ武将)を除く。** 1 位は「似ている武将」で既に表示しているため。除外は `diagnosis.top.general.id` との比較だけで行い、出現均等化のための後付け操作は一切しない。
- **D-4 結果確定後の追加表示のみ。** `diagnose()` の戻り値は変更せず、`showResult` 内で `SG.Compat.build(diagnosis)` を呼んで描くだけ。ランキング・localStorage・state には何も保存しない。
- **D-5 UI は「相性の良い武将カード 3 枚 + ぶつかるけど成長できる相手 1 枚 + 相性の良い性格タイプ + 日常場面のひとこと 3 つ + 小さな注記」。** 長さ対策として「相性度のしくみ」だけを `<details>`(キーボード・aria はネイティブ)に折りたたむ。タブは使わない(タブ状態を図鑑往復で保持する必要が生じるため)。
- **D-6 結果画像(Canvas カード)には相性を含めない(現状維持)。** 1080×1920 の既存レイアウトに文章量の多い節を足すと崩れとテキスト折返しの検証コストが大きく、要件上も任意のため。share-card.js と browser-check の画像保存シナリオは無変更。
- **D-7 表示用の相性度(%)は「生スコア(0〜100)」を単調変換した値にする。** 生スコアは最良の相手でも中央値 43〜56 と低めで、来場者には「半分以下」と見えてしまうため、`percent = round(55 + 0.45 × score)`(55〜100)とする。順位や選出には生スコアのみを使い、変換は表示専用。README に「相性度は遊び用の目安」と明記する。

## 2. 相性ロジック(式・重み・根拠)

### 2.1 入力と前処理
- `u` = `diagnosis.user`(0〜100・丸めなしの 6 値)。`g` = 武将の 6 値。軸 k ∈ `KEYS`(`leadership, action, strategy, social, caution, innovation`)。
- ユーザーの標準化値: `zu_k = (u_k − AXIS_STATS.mean[k]) / AXIS_STATS.sd[k]`(**一様乱数回答の平均・SD** に対する位置。「平均より低い=弱み」を一般の来場者基準で判定するため)。
- 武将の標準化値: `zg_k = (g_k − gm_k) / gs_k`。`gm_k, gs_k` は `SG.Generals` 20 人の平均と母標準偏差を**呼び出し時に計算**(`SG.Generals` の参照をキーにキャッシュ。ハードコードしない=武将を追加・変更しても追従)。

### 2.2 近さ(同調度) closeness
`d = ユークリッド距離(u, g)`、`DREF = sqrt(6×100²) / 2 ≈ 122.5`、`closeness = max(0, 1 − d / DREF)` ∈ [0,1]。
(診断の類似度は 1 − d/244.9 で実際は 0.6〜0.95 に集まり差が出にくいため、半分の距離で 0 とするよう引き伸ばす。診断の類似度の式・関数は変更しない。)

### 2.3 補完度 complement
- 弱み(必要度): `need_k = max(0, −zu_k)` (自分が平均より低い軸ほど大きい)。
- 供給度: `supply_k = min(2, max(0, zg_k)) / 2` ∈ [0,1](相手がその軸で武将平均より高いほど大きい。+2σ で頭打ち)。
- `complement = Σ need_k × supply_k / Σ need_k`(`Σ need_k = 0`=弱みが全くないときは 0)。∈ [0,1]。

### 2.4 総合・重み・選出
- `score = 100 × (WC × closeness + WN × complement)`、**`WC = 0.5, WN = 0.5`**。両項が [0,1] なので score は必ず 0〜100(クランプも併用)。
- 選出: 1 位の武将を除外 → `key = Math.round(score × 1e6)` の降順 → 同点は `SG.Generals` の index 昇順(`rankGenerals` と同じ全順序方式)。上位 3 人が「相性の良い武将」。
- 「ぶつかるけど成長できる相手」(1 人): 上位 3 人と 1 位を除いた残りから `stimulus = 100 × (0.6 × (1 − closeness) + 0.4 × complement)` が最大の武将(違いが大きく、かつ自分の弱みを補う側面もある相手)。同点は index 昇順。
- 表示用 `percent`(D-7)は上位 3 人にだけ付ける。

### 2.5 分布の偏り基準をこの設計で満たす根拠(試作で実測済み)
ROOT 外の一時スクリプトで、実データ(`SG.Questions` / `SG.Generals` / `Diagnosis.rankGenerals`)を使い、乱数回答 30,000 通り(mulberry32 固定シード)で上記式を測った。

| 回答の作り方 | 相性 1 位の最多 | 相性 1 位が 0 回の武将 | 相性上位 3 に 2% 以上出る武将 | 上位 3 に 1 回以上出る武将 | 刺激枠の最多 |
|---|---|---|---|---|---|
| 一様乱数 | 17.2% | 2 人 | 17 人 | 20 人 | 16.6% |
| 傾向付き(β=0.45) | 18.7% | 2 人 | 14 人 | 20 人 | 14.4% |

重みを振った比較(一様 20,000 通り、(WC,WN)): (0.5,0.5)→最多 16.6%、(0.4,0.6)→15.8%、(0.3,0.7)→15.3%、(0.6,0.4)→16.7%。いずれも要件の「最多 25% 以下」を大きく下回る。補完を重くすると 0 回の武将が増える(0.3/0.7 で 5 人)ため、**偏りが小さく出現人数も多い (0.5, 0.5) を採用**する。
(1 位を除外し「近さ」を引き伸ばしていること、補完度が武将平均基準の標準化値であることで、特定の極端な武将への集中が抑えられている。)

simulate.js の合否基準(測定値に余裕を持たせた値。基準に収まらなければ**重み `WC/WN` と `DREF` と `supply` の頭打ちの調整のみ**で対処し、乱数・出現均等化の操作は禁止):
- 相性 1 位の最多 ≤ 25%(一様・傾向付きの両方)。
- 相性上位 3 に 1 回以上出る武将 ≥ 18 人 / 2% 以上出る武将 ≥ 12 人(両方)。
- 刺激枠の最多 ≤ 30%。
- 候補(上位 3 + 刺激枠)に 1 位の武将を含まない。上位 3 と刺激枠は互いに重複しない。
- 同じ回答で `JSON.stringify` が完全一致 / `score` と `percent` が 0〜100 の範囲(有限数)/ 並びが安定(同点は配列順)/ 入力 `diagnosis` を変更しない。

## 3. 文言データ(`js/compat.js` 内の日本語コメント付き定数。README に変更方法を書く)

すべて前向き・親しみやすい文体。理由は必ず「診断用の性格モデルでは〜」で始め、史実は書かない。

- `TYPE_COMPLEMENT`(キー=補ってほしい軸): 
  - leadership 'みんなを引っぱる頼れるまとめ役タイプ' / action 'まず動いて場を前に進める行動派タイプ' / strategy '慎重で計画的な参謀タイプ' / social '明るく人をつなぐ社交タイプ' / caution '落ち着いてリスクを見てくれる堅実タイプ' / innovation '新しい発想で風を通すひらめきタイプ'。
- `TYPE_SAME`(キー=自分の一番高い軸): 「あなたと同じく◯◯を大切にする、気が合うタイプ」形式の 6 文。
- 弱み軸の決め方: `zu_k < −0.3` の軸を z の小さい順に最大 2 つ(`weak[0]`, `weak[1]`)。1 つも無ければ「バランス型」として、最小の軸を `weak[0]` とし、説明文に「弱点が少ないバランス型。どんなタイプとも組みやすい」を足す。強み軸 `strong` は z 最大の軸(同値は `KEYS` 順)。
- 武将カードの一言(`reasonFor`): 補完項が大きい(`WN×complement ≥ WC×closeness`)なら「診断用の性格モデルでは、{名前}は{供給度が最大の軸}が高く、あなたの{weak[0]}を補ってくれる相手です。」、それ以外は「診断用の性格モデルでは、{名前}とは全体の傾向が近く、{strong}を大切にする気が合う相手です。」。ラベル(`補い合う相性` / `気が合う相性`)も同じ条件で付ける。
- 刺激枠の一言: 「診断用の性格モデルでは、{名前}は{|u−g| が最大の軸}の傾向が大きく違う相手。ぶつかることもありますが、新しい見方をもらえて成長できます。」
- `SCENES` と 場面別アドバイス(`ADVICE[scene][軸]` = 6 軸 × 3 場面 = 18 文、各 60 文字以内、断定しない・命令口調にしない):
  - 友だちになるなら → `strong` の軸(同調型)で選ぶ。
  - 一緒にグループを組むなら → `weak[0]`(補完型)で選ぶ。
  - 部活・サークルで頼れるのは → `weak[1]`(無ければ `weak[0]`)で選ぶ。
- 注記(小さく表示): 「※ 相性は診断用の性格モデルによるエンタメ向けの目安です。科学的な根拠のあるものではなく、史実の人間関係を表すものでもありません。」

## 4. 公開 API(`SG.Compat`)

```
SG.Compat = {
  WEIGHTS: { closeness: 0.5, complement: 0.5 },   // 重み(README 参照)
  build(diagnosis) -> {
    partners: [ { general, index, score, percent, closeness, complement, kind('complement'|'same'), label, reason } ×3 ],
    stimulus: { general, index, score(=stimulus), reason },
    types:  { complement: [typeName, …(1〜2)], same: typeName, balanced: bool },
    scenes: [ { key, label, text } ×3 ],
    note: '…'
  },
  scoreAll(user, generals?) -> 全 20 人の行(simulate 用),
  validateData() -> true | throw(文言表の網羅・文字数を検査)
}
```
`build` は `diagnosis.user` と `diagnosis.top.general.id` だけを入力にし、状態を持たない(戻り値は新規オブジェクト。入力は変更しない)。

## 5. 実装項目(依存順)

- [ ] 1. **基準の保存(変更前の simulate 出力)。** 変更前の `node tools\simulate.js` の出力を ROOT 外の一時ファイル(`$env:TEMP\sim-before.txt`)に保存する。後の項目 6 で「既存 #1〜#19 の出力が一字一句変わらない」ことの比較に使う。
  Files: なし(一時ファイルのみ)
  Verify: `node tools\simulate.js` が `RESULT: ALL PASS` で終わる。

- [ ] 2. **`js/compat.js` を新規作成(§2・§3・§4)。** UMD 風、`'use strict'`、`SG = root.SG = root.SG || {}`、`module.exports` あり。式・重み(`WEIGHTS`、`DREF` 相当、頭打ち 2、弱み判定しきい値 −0.3)は名前付き定数にして日本語コメントで根拠を書く。文言表(`TYPE_COMPLEMENT`、`TYPE_SAME`、`SCENES`、`ADVICE`、各テンプレート、注記)も同ファイルの先頭にまとめ、「ここを編集すれば文言を変えられる」旨のコメントを付ける。`validateData()` は全軸の文言が揃い 60 文字以内であること等を検査する。`Math.random` / `Date` / `localStorage` を使わない。
  Files: `ROOT\js\compat.js`(新規)
  Verify: `node -e "var G=require('./js/generals.js'),Q=require('./js/questions.js'),D=require('./js/diagnosis.js'),C=require('./js/compat.js');C.validateData();console.log(JSON.stringify(C.build(D.diagnose([0,1,2,3,0,1,2,3,0,1,2,3,0,1,2]))).slice(0,300))"` を ROOT で実行し、例外なく JSON が出る。

- [ ] 3. **`index.html` と `tools/check-static.js` に compat.js を登録する(項目 2 に依存)。** `index.html` の `<script src="js/reason.js">` の直後に `<script src="js/compat.js"></script>` を追加し、`check-static.js` の `SCRIPT_ORDER` の `'js/reason.js'` の直後に `'js/compat.js'` を追加する。さらに check-static.js に「`js/compat.js` に `Math.random` / `Date` / `localStorage` / `sessionStorage` / `SG.Storage` / `increment` が無いこと」を検査する小さなルールを足す(既存の `scan` / `report` の書き方に合わせる)。
  Files: `ROOT\index.html`, `ROOT\tools\check-static.js`
  Verify: `node tools\check-static.js` が違反 0 で終わる。

- [ ] 4. **`tools/simulate.js` に #20「相性ロジック」を追加する(項目 2 に依存)。** 他の js と同じく、localStorage の罠が生きているうちに `require('compat.js')` し、ロード時の触れ回数 0 を検査する(#18/#19 の方式)。`section(20, …)` を #19 の後・`RESULT:` 出力の前に追加し、§2.5 の合否基準をすべて `check(20, …)` で検査する。標本は #2 / #3 と同じ作り方(`uniformAnswers` / `tendencyAnswers`)で **シードは新規(例 20240620 / 20240621)・各 30,000 通り**。分布表(相性 1 位の上位・出現人数)を `line()` で表示する。診断本体の#1〜#19 のコードは変更しない。基準に収まらなければ compat.js の重みなど**式のパラメータだけ**を調整する。
  Files: `ROOT\tools\simulate.js`
  Verify: `node tools\simulate.js` が `RESULT: ALL PASS`。出力から #1〜#19 の行が項目 1 の保存ファイルと一致する(`Compare-Object (Get-Content $env:TEMP\sim-before.txt) (node tools\simulate.js)` の差分が #20 関連の行と末尾の件数だけ)。

- [ ] 5. **結果画面に「相性診断」節を追加(項目 2・3 に依存)。** `js/results.js` の `showResult` で `SG.Compat.build(diagnosis)` を呼び、`#sec-reason` の節の直後・`#sec-top3` の直前に次の節を差し込む。
  - `<section class="result-section compat" aria-labelledby="sec-compat">` / `<h3 id="sec-compat" class="section-title">あなたと相性の良い武将・性格タイプ</h3>`。
  - 相性の良い武将 3 枚: `<ol class="compat-list">` の各 `<li class="compat-card" data-general-id="…">` に `portraitHtml(g)`(家紋 SVG 代替カード/画像)、名前、相性度(`aria-label="相性度◯◯パーセント"`、数字だけの視覚表示は `aria-hidden`)、ラベル(補い合う相性/気が合う相性)、一言理由、`<button type="button" class="btn-detail" aria-label="◯◯をくわしく見る">くわしく見る</button>`。既存の委譲ハンドラがそのまま既存の武将詳細ダイアログを開く(ハンドラは変更しない)。
  - ぶつかるけど成長できる相手: 同じ構造で `compat-card compat-stimulus`、見出し小「ちょっと刺激をくれる相手」。
  - 相性の良い性格タイプ: `types.complement`(補完型)と `types.same`(同調型)を `<dl class="compat-types">` 風に 2 ブロックで表示。
  - 日常場面のひとこと 3 つ: `<ul class="compat-scenes">`(ラベル + 文)。
  - 注記 `<p class="note">`(`SG.Compat` の `note`)と、`<details class="compat-how"><summary>相性度のしくみ</summary>`(近さと補完の説明を 3 行、診断結果・ランキングに影響しないこと)。
  - データ由来の文字列は必ず `esc()`。`diagnosis.user` を渡しているので、ダイアログの診断用パラメータ棒は従来どおり。`state` / storage には触れない。`SG.Compat` が無い場合に備え、`root.SG.Compat` 不在なら節を出さずに従来の画面にする(防御)。
  Files: `ROOT\js\results.js`
  Verify: `node tools\simulate.js` と `node tools\check-static.js` が引き続き通る(results.js は DOM 依存なので Node の検査は構文だけ)。`node --check js\results.js` が成功する。見た目の確認は項目 7。

- [ ] 6. **CSS を追加(項目 5 に依存)。** `css/style.css` の `.top3` 系の近く(476 行付近)に `.compat-*` を追加する。既存の変数(`--gold` `--gold-light` `--gold-dark` `--crimson` `--sumi` `--ink` `--text` `--text-sub` `--font-serif`)と既存の `.top3-card` / `.btn-detail` / `.all-list summary` の見た目に合わせる。モバイル(390px)ではカードを 1 列、PC(1280px)では武将 3 枚を 3 列グリッド(`@media (min-width: 768px)`)。タップ領域 44px 以上、`overflow-wrap: anywhere`。`details.compat-how` の `summary` にフォーカスリング(`:focus-visible`)。アニメーションを足す場合は `@media (prefers-reduced-motion: reduce)`(771 行付近の既存ブロック)に無効化を追加する。横スクロールを出さない。
  Files: `ROOT\css\style.css`
  Verify: `node tools\check-static.js` が通る。見た目は項目 7 のスクリーンショットで確認。

- [ ] 7. **`tools/browser-check.js` に `scenarioCompat` を追加(項目 5・6 に依存)。** 既存シナリオ(`scenarioZukan` の書き方)に合わせて作り、`main()` のシナリオ一覧に登録する。検査内容:
  1. 結果画面に `#sec-compat` があり、DOM 順が `#sec-reason` → `#sec-compat` → `#sec-top3`。武将カード 3 枚・刺激カード 1 枚・性格タイプ 2 ブロック・場面 3 つがあり、1 位の武将(`#result-heading`)と同じ武将が相性カードに無い。
  2. 相性カードの「くわしく見る」を押すと `#dlg-general` が開き、見出しがその武将名。Esc で閉じ、フォーカスが元のボタンに戻る。カード本体のクリックでも開く。
  3. `<details class="compat-how">` が Enter/Space で開閉できる。キーボードで Tab 順に到達できる。
  4. 結果 → 図鑑 → 戻る、結果 → みんなの結果ランキング → 戻る の後も `#sec-compat` が残り、内容が変わらない。
  5. 同じ回答パターンで 2 回診断した相性武将名の並びが一致する(決定論)。別のパターン(全A と全D など)では内容が変わる。
  6. 相性節の追加前後で localStorage のキー集合と集計の人数が変わらない(診断 1 回で +1 のまま)。「最初に戻る」後に `#result-root` が空。
  7. 相性節のテキストに「運営」「リセット」が無い。「診断用の性格モデルでは」と注記(「科学的な根拠」)がある。
  8. 1280×800 と 390×844 で横スクロールなし(`noHScroll`)、はみ出しなし。`prefers-reduced-motion` 有効時もエラーなし。コンソールエラー/例外 0(`checkNoProblems`)。
  9. スクリーンショットを `.agents\tasks\screens\chrome\compat-1280.png` / `compat-390.png`(Edge も同様に `screens\edge\`)へ保存する。
  Files: `ROOT\tools\browser-check.js`
  Verify: README 13 章に記載のコマンド(Chrome と Edge)で `node tools\browser-check.js` を実行し、全シナリオ PASS(既存シナリオ・画像保存シナリオも含めて無回帰)。ブラウザが起動できない場合は、その旨を記録して手動確認手順を README に残す。

- [ ] 8. **README.md に相性機能を追記(項目 2〜7 に依存)。**
  - 「4. 展示の運用」の `### 戦国武将図鑑` の後に `### 相性診断(結果画面)` を追加: 場所(結果画面の『似ている理由』の後)、見え方、「診断結果・ランキング・保存データには影響しない」「結果画像には含めない」こと。
  - 「7. データの変更方法」に `### 相性の文言・重みの変更方法` を追加: 文言は `js\compat.js` 先頭の `TYPE_COMPLEMENT` / `TYPE_SAME` / `ADVICE` / テンプレート、重みは `WEIGHTS`(近さ/補完。合計 1 にする)と `DREF`、変更後は `node tools\simulate.js` の #20 が通ることを確認する手順。
  - 「9. 診断用の仮想モデルについて」に相性の式(近さ・補完度・重み・1 位を除くこと・決定論)を数行で追記し、「エンタメであり科学的根拠はない」旨を書く。
  - 「8. 分布の検証」と「13. 動作確認記録」に #20 の実測値と browser-check の結果を追記する。
  - ファイル構成の記述(js の一覧がある場合)に `compat.js` を追加する。
  Files: `ROOT\README.md`
  Verify: README 内のコマンド(`node tools\simulate.js` / `node tools\check-static.js` / `node tools\browser-check.js`)を実際に実行して、記載の実測値と一致する。

- [ ] 9. **最終回帰確認。** 全検査を通しで実行し、既存仕様を壊していないことを確認する。
  - `node tools\simulate.js`(ALL PASS、#1〜#19 の出力が項目 1 と一致、#20 が PASS)
  - `node tools\check-static.js`(違反 0)
  - `node tools\browser-check.js`(Chrome / Edge とも全 PASS)
  - 手動で `index.html` を `file://` で開き、診断 → 結果 → 相性節 → 武将ダイアログ → 図鑑往復 → 最初に戻る → 無操作自動復帰を確認する(ブラウザ検査で代替できる範囲は記録する)。
  - 一時ファイル(`$env:TEMP\sim-before.txt`、試作スクリプト)を削除する。
  Files: なし
  Verify: 上記すべてが成功する。

## 6. 既存仕様を壊さないための注意(実装者向けチェックリスト)

- `js/diagnosis.js` / `js/generals.js` / `js/questions.js` / `js/app.js` / `js/share-card.js` / `js/storage.js` は変更しない(`git diff` で確認)。
- 相性の計算は結果描画時の派生値。`state.diagnosis` に相性結果を足さない。
- 来場者画面に管理操作の語・UI を入れない(相性節のテキストと HTML に「運営」「リセット」「削除」を含めない)。
- 外部通信なし・ES Modules / fetch 不使用・npm 依存ゼロを維持する。
- 史実の断定は書かない。相性の理由は「診断用の性格モデルでは〜」で始める。
- 想定とのずれ(前提): ユーザーに確認できないため、「相性」は 6 パラメータから導くエンタメ用モデルと解釈した。表示用の相性度の換算(D-7)と結果画像への非掲載(D-6)は妥当な範囲での判断であり、変更したい場合は `compat.js` の換算式と `share-card.js` に限定して後から差し替えられる。
