# 診断中のホームへ戻る 機能レビュー (home-review.md)

対象: コミット 5c36d98(index.html / css/style.css / js/app.js / js/results.js / tools/browser-check.js / README.md)と home-build-log.md、スクリーンショット。
テストスイートは再実行せず、記録(home-build-log.md)とコード・画像を読んで判定した。

## 判定: APPROVED(ブロッカー 0 件)

## チェックリスト

1. PASS 全15問と診断演出にボタンあり・押しやすい配置
   - index.html の `#btn-home-q`(質問画面の `.q-head-row` 右端)と `#btn-home-a`(診断演出の左上隅)。どちらも `data-action="home"`、app.js の `els.homeBtns` で両方にバインド。質問画面は 1 つのボタンを全問で共用するので全15問に出る。
   - CSS `.btn-home` は min-height/min-width 44px。画面ヘッダー行に置かれ、選択肢や左下の「前の質問へ」から離れている。home-q1-1280.png / home-q1-390.png を目視: 右上に収まり、Q表示・場面タグと重ならず、選択肢との間隔は十分。記録の実測(15問で44px以上、他要素と16px以上)と画像が一致。
   - 演出画面は左上の隅(133x44、家紋・文言と重ならないという実測記録)。home-an-390.png は画面切替アニメーション中で暗く、ボタンの見た目の確認材料としては弱いが、位置とサイズは DOM 実測(⑨)で裏づけられている。ブロッカーではない。
2. PASS 確認ダイアログ
   - app.js:onHome の文言は「診断を中断してホームに戻りますか？ここまでの回答は消えます。」、ボタンは「続ける」「ホームへ戻る」(cancelLabel/okLabel)。既存の `Results.confirm()` と `#dlg-confirm` を再利用。
   - 初期フォーカスは既存どおり安全側(キャンセル側=「続ける」)。home-dlg-1280.png で「続ける」に金のフォーカス枠。
   - Esc は `cancel` イベントを止めて finishConfirm(false)、`close` でも finishConfirm(false)(results.js:422-424)。Esc の二重押しで cancel が発火しない場合も close 側で拾える。
   - フォーカストラップを results.js:426-439 に追加(Tab/Shift+Tab を 2 つのボタンで巡回)。`<dialog>` + showModal(失敗時のみ open 属性)+ aria-labelledby。閉じたときは opener(ホームボタン)へ戻る(記録②で確認済み)。
   - 390 幅では文言 2 行折り返し、ボタン縦並びで画面内(home-dlg-390.png)。
3. PASS 完全リセット
   - 確定は既存 `reset()`(app.js:483)をそのまま呼ぶ。clearTimers、`deferred = null`、runId 更新、`Object.assign(state, initialState())`、closeAllDialogs、結果/ランキング/来場者ランキング/図鑑 DOM の破棄、質問画面の初期化。
   - 回答や中断状態の localStorage/URL 保存はコード上なし(差分に storage 呼び出しなし)。記録③で localStorage/sessionStorage/URL に痕跡なし、再開始後 Q1・未選択・プログレス初期値と一致。
4. PASS 中断はランキングに加算されない
   - 加算は `enterResult()` の `state.counted` ガード 1 か所のみ(app.js:~345)で、差分は触れていない。中断経路は reset() のみで enterResult を通らない。記録④⑤⑥で累計 0 / +1 を確認。
5. PASS 演出タイマー競合
   - reset が `clearTimers()` で全 `later()` タイマーを解除し、さらに `guard()`/`myRun !== state.runId` で二重に守る。保留処理 `deferred` も reset で破棄。startDiagnosis も runId を進めるので、前の演出の満了が新しい診断に割り込まない(記録⑥は前演出の満了が2回目の演出中に来る配置で検証)。
   - 連打: `state.homeAsking` で二重オープン防止、finishConfirm の `done` ガード、`.then` 内の runId 照合で確定は 1 回(記録⑦)。400ms の背景クリック無視(`backdropGuardMs`、既定 0 で他の確認ダイアログの挙動は不変)でダブルクリックの 2 回目で閉じない。
   - ダイアログ表示中に演出/次の問へのタイマーが満了した場合: `runOrDefer` が `deferred` に 1 件保留(同時に保留される進行処理は 1 件しか存在し得ない:回答ロック中の次の問へ、または演出満了の結果表示)。「続ける」で `.then` から再開、再開時も runId/phase を再チェック。「ホームへ戻る」/無操作リセットなら破棄。コード上、破綻する経路は見つからなかった。
6. PASS 無操作自動復帰
   - `idleLimit()` に homeAsking 時の質問中と同じ時間を追加。onHome で armIdleTimer を呼び、「続ける」後に再度 armIdleTimer(演出中は idleLimit=0 に戻りタイマー停止)。警告は既存の showIdleToast(dialog[open] の中へ一時移動)をそのまま使用。無操作リセット後は runId が変わるので `.then` は何もしない。記録⑧で警告表示・「続ける」・放置→スタート復帰を確認。
7. PASS 既存機能の回帰なし
   - onOption/onPrev/onNext の本体ロジックは `runOrDefer` で包んだだけ(homeAsking でなければ即時実行で従来と同じ)。回答は setAnswer のみ書き込み、スコアは毎回再計算のため二重加算なし。結果画面・図鑑・ランキングにホームボタンなし(`data-action="home"` は index.html の 2 か所のみ)。リセット等の管理操作はプレイヤー画面に増えていない。全シナリオ 308 チェック通過(Chrome・Edge)。
8. PASS file://・外部通信なし・ES Modules/npm 追加なし
   - 差分に fetch/XHR/外部 URL/外部フォント/import・export・package.json の追加なし。アイコンはインライン SVG。check-static OK の記録。
9. PASS デザイン
   - 墨地+金の細罫、既存の変数・フォント(--gold-dark、--font-serif)を使用、フォーカス表示は既存ボタンのルール、`transition` のみで reduced-motion は既存のグローバルルールで 0s(記録⑩)。1280x800 / 390x844 のスクリーンショットで崩れ・重なりなし。重要処理に日本語コメントあり。
10. PASS 検証記録
   - 記録: simulate.js ALL PASS(終了コード0)、check-static OK (16 files)、browser-check 全シナリオ Chrome・Edge とも 308 checks ALL PASS(既存 265 + home 43)、①〜⑩ が scenarioHome として追加(browser-check.js の差分で ①〜⑩ の見出しを確認)、コンソールエラー 0 件、診断ロジック(diagnosis/generals/questions)は差分に含まれない。記録時刻(16:11)は最終コード編集(15:55)より後で、記録は最新のコードに対するもの。作業ツリーは新規の vercel 関連(前タスク由来)の未追跡ファイル以外クリーンで、一時ファイルの残りなし。記録は home-build-log.md にある。
11. PASS README に「診断中のホームへ戻る」節(確認あり・回答は消える・ランキングに加算されない・演出中の挙動)と、無操作リセットの例外を追記。
12. PASS Vercel 関連・既存記録
   - コミットの変更ファイルに vercel.json / .vercelignore / .vercel は含まれない。それらの更新時刻(15:25〜15:35)は本機能の最初のコード編集(15:41)より前で、本変更で触れられていない。ビルドログに vercel コマンド実行の記載なし。既存の *-review.* と *-build-log.md は変更されておらず、追加は home-build-log.md と home-*.png のみ(既存スクリーンショットは差分なし)。

## 指摘一覧(ブロッカーのみ)
なし。

## 補足(非ブロッキング)
- home-an-390.png は切替アニメーション中の暗い画像で、演出画面のボタンの見た目の証跡としては弱い。位置・サイズ・非重なりは DOM 実測で担保されている。
