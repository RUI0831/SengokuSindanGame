# 来場者向け「みんなの結果ランキング」レビュー

**Verdict**: APPROVED

来場者向けの読み取り専用ランキング画面(js/player-ranking.js、phase PLAYER_RANKING)を追加し、結果画面のボタンを運営用画面から来場者向け画面に付け替えた変更。運営用のリセットはスタート画面右下の入口から従来どおり確認付きで動く。ブロッキングな問題は見つからなかった。

Watch for: 下の「非ブロッキングの所見」の3点のみ(いずれも修正必須ではない)。

## 確認結果(今回自分で再実行・確認したもの)
- (1) 来場者側にリセット系なし(confirmed): player-ranking.js を全文読み、reset/削除/運営/increment/removeItem・accesskey・隠し要素・キーショートカットが無いことを確認。Esc は「戻る」のみ。app.js は readOnlyStore() で getCounts/getTotalPlayers/isPersistent/todayKey だけを渡す。結果画面のボタンは data-action="ranking"(来場者向けを開く)で、運営用画面への導線は無い。check-static と browser-check player-ranking シナリオ(DOM・キー入力検査)も通過。
- (2) 運営用リセット(confirmed): results.js の data-action="reset" は confirm() 付き(確認ダイアログ)。入口は index.html の #open-ranking(スタート画面右下)のみで、app.js は phase が START のときだけ openRanking を呼ぶ。reset-confirm と player-ranking(f)が通過。
- (3) 加算は1回のみ(confirmed): store.increment は enterResult() 内の state.counted ガード1か所だけ。openPlayerRanking / onPlayerRankingBack は showScreen のみで enterResult を呼ばない。往復3回・リサイズ・リロードで不変の検査が通過。
- (4) storage.js 不変(likely): git が無く内容比較は不可。更新日時が 10/08 19:38 で、今回の変更ファイル(10/09 11:xx)より前。API 変更なし(player-ranking は既存 getCounts を読むだけ)。
- (5) 無操作・aria・キーボード(confirmed): idleLimit に PLAYER_RANKING、reset() で dispose。WAI-ARIA tabs(role=tablist/tab/tabpanel、aria-selected、roving tabindex、←→/Home/End)、Esc で戻る、戻り先へフォーカス復帰。prefers-reduced-motion は既存の全体指定(style.css 730 行)が適用され、browser-check の reduced-motion 検査が通過。
- (6) スクリーンショット目視: Chrome の start-with-button-{1280,390}、player-ranking-from-result-{1280,390} を今回開いて確認。新ボタンは開始ボタンの下に収まり城・幟旗と重ならない。TOP3 は枠と「1位」等の文字で区別でき、「あなた」バッジと is-me の強調が見える。390 幅では長い行が折り返すが崩れや横はみ出しは無い。
- (7) README(confirmed): 来場者向け/運営用の説明、リセットが来場者側に無いこと、結果画面の導線変更、ファイル構成、検査数(184 / 29 / 28 項目)が実測と一致。
- (8) 実行証拠(今回再実行): node --check 全 JS OK、simulate = RESULT: ALL PASS(exit 0)、check-static = OK (14 files)、browser-check Chrome = ALL PASS (184 checks)、Edge = ALL PASS (184 checks)、Chrome --http smoke = ALL PASS (29 checks)。

## 非ブロッキングの所見
1. 1280x800 のスタート画面で「運営用(集計)」が画面下端に小さく切れて見える(confirmed、目視)。README に記載済みで、来場者に目立たせない意図とも整合。入口の位置は要件どおり現状維持。
2. Edge のスクリーンショットと player-ranking-empty-1280・player-ranking-total-all-* は私も未目視(possible な見た目の問題は未確認)。README に未目視と明記済み。
3. 銀と銅の枠は暗い背景で差が小さい(confirmed、目視)。順位は文字でも示されるため支障なし。

## 未確認
実機スマホ、Firefox/Safari、スクリーンリーダー(README に記載済み)。

<details>
<summary>Issues (3)</summary>

1. **運営用リンクの切れ(1280x800)** — 非ブロッキング。必要なら下端の余白を調整。
2. **一部スクリーンショット未目視** — 非ブロッキング。余裕があれば Edge と total-all を目視。
3. **銀・銅の差が小さい** — 非ブロッキング。必要なら銅の色を少し強める。

</details>
