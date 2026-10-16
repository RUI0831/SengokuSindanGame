# 結果画面への「相性診断」節の追加

結果確定後に、診断の1位武将を除いた相性の良い武将3人、刺激をくれる相手1人、相性の良い性格タイプ、日常場面のひとことを表示する節を追加した。計算は新規の純粋関数モジュール `js/compat.js` が担当し、`results.js` が既存のカード・詳細ダイアログの仕組みを再利用して描画する。診断本体、武将データ、保存まわりは未変更。

Watch for: 実機のブラウザ再検証はしていない。判断はビルドログの証拠(simulate / check-static / Chrome・Edge の browser-check 265件PASS)と差分の読み取りによる(likely〜confirmed)。

**Verdict**: APPROVED

## High-level view

相性は `SG.Generals` と `SG.Diagnosis.AXIS_STATS` を読むだけの副作用なしの計算で、診断結果・ランキング・localStorage のコードには触れていない。相性度は「近さ」と「補完度」を 0.5/0.5 で合成し、乱数・日時を使わず、同点は配列順に確定する。

分布は一様乱数で最多16.9%、傾向付きで18.8%と25%目安を下回り、上位3に20人が出現する。1位武将は候補から除外され、刺激枠とも重複しない。

文言は理由文が必ず「診断用の性格モデルでは〜」で始まり(`validateData` が強制)、注記で史実・科学的根拠との区別を明示している。a11y(見出し・aria-label・details のキーボード操作・reduced-motion)とレイアウトはビルドログのブラウザ検査で確認済み。

<details>
<summary>Issues (2)</summary>

1. **Compat が diagnosis.js の AXIS_STATS に依存** — 整数丸めの近似値を弱み判定に使っている(likely、軽微)。実装上は問題なく、将来 AXIS_STATS を変えたら simulate.js #20 を再実行すること。
2. **スクリーンショット目視は Chrome 版のみ** — Edge 版は自動検査のみ(confirmed、軽微)。必要なら会場端末で最終確認する。

</details>

<details>
<summary>Details</summary>

## 相性スコアの設計と分布

`scoreAll` は近さ(6軸ユークリッド距離を基準距離 122.5 で正規化)と補完度(ユーザーの弱み軸を、武将平均より高い武将がどれだけ供給するか)を合成する。スコアは clamp により 0〜100 に収まる。並べ替えは値を 1e6 倍して整数化したうえで index 昇順をタイブレークとする全順序方式で、diagnosis.js と同じ流儀であり、同点は配列順になる。表示用の % は 55 + 0.45×素点の換算で、順位・選出には使わない。

ビルドログの30,000通りシミュレーションでは、最多は豊臣秀吉16.9%(一様)/真田幸村18.8%(傾向付き)で、20人全員が上位3に出現し、2%以上は17人/14人だった。基準の「最多25%以下」を満たす。診断の既存出力は変更前と比較して差分0件(追加行のみ)と記録されており、`diagnosis.js` / `generals.js` / `questions.js` / `storage.js` / `app.js` が未変更であることとも整合する。

## 表示と状態の扱い

`compatHtml` は `diagnosis` から毎回再計算するため、結果→図鑑/ランキング→戻るでも同じ内容になり、「最初に戻る」で画面ごと消える。保存領域への書き込みは compat.js にも新規コードにもなく、check-static に乱数・日時・保存領域の語が無いことの検査が追加されている。ブラウザ検査で、診断5回で集計が5人のまま増えないことも確認されている。

カードは既存の `[data-general-id]` と `.btn-detail` を使い、既存の委譲ハンドラが詳細ダイアログを開く。管理系の語は表示されない旨が検査されている。

## 文言とアクセシビリティ

理由文3種はテンプレート先頭が固定で、`validateData` が起動時に検証する。タイプ説明・場面アドバイスは断定を避けた前向きな文体で、60文字制限も検査される。相性度は `aria-label` を持ち、視覚表示は `aria-hidden` で二重読み上げを避けている。`details` はネイティブでキーボード操作可能、summary は min-height 44px、`prefers-reduced-motion` は全体ルールで transition/animation を無効化する。

</details>

<details>
<summary>File map</summary>

- js/compat.js: 新規。相性計算と文言データ
- js/results.js: 相性節の描画(`compatHtml` / `compatCardHtml`)を追加
- css/style.css: `.compat-*` スタイルとPC幅の3列化
- index.html: compat.js の読み込み登録
- tools/check-static.js: compat.js の禁止語検査を追加
- tools/simulate.js: #20 相性分布検査を追加
- tools/browser-check.js: scenarioCompat(30 checks)を追加
- README.md: 相性機能の説明・変更方法・計算式を追記

差分全体は git 管理外のため、上記ファイルを直接参照。

</details>

## チェックリスト

1. 合格: 診断系ファイル未変更、simulate 既存行の差分0件。
2. 合格: 乱数・日時なし、同回答で完全一致を検査済み。
3. 合格: clamp で 0〜100、index タイブレーク。
4. 合格: 最多16.9%/18.8%、20人出現、1位は候補から除外。
5. 合格: 武将は `SG.Generals` を参照のみ。複製なし。
6. 合格: 保存コードなし、集計が増えないことを検査済み。
7. 合格: 往復・最初に戻る・管理語なしを検査済み。
8. 合格: 外部通信・ES Modules・fetch・依存の追加なし(check-static OK)。
9. 合格: 1280x800 / 390x844 でのはみ出しなしを記録、Chrome 画像を目視確認済み。
10. 合格: aria・キーボード・reduced-motion を確認。
11. 合格: 理由文は「診断用の性格モデルでは〜」、注記あり。
12. 合格: README に説明・変更方法・計算式あり。
