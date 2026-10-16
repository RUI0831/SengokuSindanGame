# 戦国武将性格診断 Web アプリ一式(最終ビルドレビュー 第 2 回)

前回の指摘 5 件(MEDIUM 2・NIT 3)を直したあとの成果物全体の再レビュー。直した内容は 5 つ。ランキングのタブの矢印キー操作、PC 幅の本文 18px、理由文 P3 の語形、「独眼竜」の書き方、README の画像生成時間を範囲で書くこと。5 件ともコードと実測で直っていることを確かめた。cwd=ROOT で simulate(ALL PASS、warnings 0)・check-static(OK、13 files)・browser-check(Chrome、--skip-long。151 checks ALL PASS)を実行し、すべて exit 0 だった。新しく見つかったのは、見た目の NIT 1 件だけ。

Watch for: スタート画面のサブタイトルが「生まれて / いたら」で、1280 幅の説明文が「伊達政宗な / ど」で改行され、語の途中で切れる(confirmed。NIT)。

**Verdict**: APPROVED

## High-level view

診断の中核に変更はない。simulate の値は plan.md 1.2 の期待値と小数 2 桁まで一致した(#2 6.58%/3.00%、#3 9.76%/0.78%、#15 14.7%/30.9%、#16 β=0.10 協調寄り 19.28%・大胆寄り 19 人、β=0.15 32.36%、最近接ペア 9.06、#17 4.91%)。ランキングへの加算は `enterResult()` の 1 か所だけで `state.counted` が守っていて、ranking シナリオで往復・リサイズ・リロードによる再加算がないことも確認した。

前回の MEDIUM 2 件は解消している。ランキングのタブには ←→/Home/End の keydown 委譲が付いた(results.js:524-546)。この委譲は `clear()` の `unbindAll` で外れるので、ランキングを開き直しても二重に登録されない。PC 幅の本文は style.css:668 で 18px になり、layout シナリオの実測は 1280 幅で 18px、390 幅で 16px だった。

理由文 P3 は「〜が中くらいで、〜も高めのタイプです。」の形になり、simulate #11 (d2) で 60,000 件中の違反は 0 件だった。史実の記述は 20 人分を読み直し、断定しすぎている箇所はなかった。

スクリーンショット(390・1280 の各画面、結果カード PNG)に崩れ・はみ出しはない。残る粗は、要件 §4 の文言を大きな明朝で見せるスタート画面で、語の途中で折り返していることだけ。

<details>
<summary>Issues (1)</summary>

1. **[NIT] スタート画面のサブタイトルと説明文が語の途中で改行される**: `.start-sub` / `.start-desc`(index.html:52-53、css/style.css)。`word-break: auto-phrase`(Chrome/Edge 119 以降)を付けるか、文節の区切りに `<wbr>` を入れるか、句を inline-block の span で包んで、「生まれていたら、」「伊達政宗など、」の途中で折り返さないようにする。直したら 390 幅と 1280 幅で撮り直して目視する。

</details>

<details>
<summary>Details</summary>

### スタート画面の見出しの折り返し

start-1280.png と start-390.png のどちらでも、サブタイトル「もしあなたが戦国時代に生まれていたら、どの武将に似ていたのか？」は「生まれて」と「いたら、」の間で改行されている(confirmed)。1280 幅の説明文も「伊達政宗な」と「ど、」に分かれている。禁則処理で句読点が行頭に来ないよう、その前の 1 文字が次の行へ送られるためで、語の境界は考慮されない。来場者が最初に読む画面なので目につくが、動作には影響しない。

### この回で確かめていないこと

README 13 章の「153 checks」は --skip-long なしの全実行の値。今回は --skip-long で実行して 151 checks だったので、全実行の 153 はこの回では再現していない。

</details>

<details>
<summary>File map</summary>

- `index.html`: 5 画面・3 ダイアログ・トースト・`#fatal`、城・幟旗・家紋のインライン SVG、script 11 本
- `css/style.css`: 和風ゲーム UI(今回、1024px 以上で本文を 18px にした)
- `js/questions.js`・`js/generals.js`: 15 問の配点、20 人のデータ(今回、政宗の events を修正)
- `js/diagnosis.js`・`js/reason.js`: 診断の計算と理由文(今回、P3 の語形を修正)
- `js/results.js`: 結果・TOP3・ダイアログ・ランキング(今回、タブのキー操作を追加)
- `js/app.js`・`js/storage.js`・`js/chart.js`・`js/crest.js`・`js/share-card.js`・`js/util.js`: 状態とタイマー、集計、グラフ、家紋 SVG、PNG 生成、共通関数
- `tools/simulate.js`・`tools/check-static.js`・`tools/browser-check.js`: 分布・静的・E2E の検証(今回、#11 (d2)、layout の NFR-4、keyboard のタブの検査を追加)
- `README.md`・`assets/images/CREDITS.md`: 運用手順・検証結果・動作確認記録・画像の方針

git リポジトリではないので差分はない。成果物全体を読んでレビューした。

</details>
