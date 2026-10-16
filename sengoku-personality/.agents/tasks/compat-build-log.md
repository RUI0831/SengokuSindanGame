# 相性診断 実装ログ (compat-build-log.md)

## 変更ファイル
- 新規 js/compat.js(SG.Compat。UMD 風・純粋関数。文言は先頭の日本語コメント付き定数)
- index.html / tools/check-static.js(compat.js 登録、compat.js に乱数・日時・保存領域の語が無い検査を追加)
- js/results.js(相性節を「似ている理由」の後・TOP3 の前に追加。既存の委譲ハンドラを再利用)
- css/style.css(.compat-*)、tools/simulate.js(#20)、tools/browser-check.js(scenarioCompat)、README.md
- 未変更: diagnosis.js / generals.js / questions.js / app.js / share-card.js / storage.js(結果画像には相性を含めない)

## 実行コマンドと結果
- node tools\simulate.js → RESULT: ALL PASS (warnings: 0)、終了コード 0。変更前出力と比較し、既存行の削除・変更は 0 件(#20 の追加行のみ)
- node tools\check-static.js → check-static: OK (16 files)
- node tools\browser-check.js --browser chrome --screenshots ...\screens\chrome → RESULT: ALL PASS (265 checks)
- node tools\browser-check.js --browser edge --screenshots ...\screens\edge → RESULT: ALL PASS (265 checks)
  (既存 235 + 相性シナリオ 30。初回に出た zukan の待ち時間切れは、実行を並行させたことによる干渉で、単独再実行・通し再実行とも PASS)

## 相性分布(#20、各 30,000 通り)
- 一様乱数(seed 20240620): 相性1位の最多 16.9%(豊臣秀吉)/ 1位が0回の武将 2 人 / 上位3に出る武将 20 人(2%以上 17 人)/ 刺激枠の最多 16.8%
- 傾向付き β=0.45(seed 20240621): 最多 18.8%(真田幸村)/ 0回 1 人 / 上位3に 20 人(2%以上 14 人)/ 刺激枠の最多 15.0%
- 重みは計画どおり WEIGHTS 0.5/0.5 のまま(調整不要)。1位武将は候補に含まれず、上位3と刺激枠は重複なし、同回答で完全一致、score/percent は 0〜100、同点は配列順

## ブラウザ検査(scenarioCompat)で確認した項目
節の順序・枚数、詳細ダイアログ再利用(Esc でフォーカス復帰)、details のキーボード開閉、図鑑/ランキング往復で保持、集計が増えない(診断5回で5人)、「最初に戻る」で消える、同回答で同結果・別回答で変化、運営系の語なし、1280x800 と 390x844 でのはみ出し・横スクロール無し・タップ領域44px以上、reduced-motion、コンソールエラー0
スクリーンショット: .agents\tasks\screens\{chrome,edge}\compat-1280.png / compat-390.png / *-full.png(Chrome 版を目視確認済み: PC 3列、スマホ 1列で崩れなし)

## 備考
- ワークスペースは git リポジトリではないためコミットは作成していない。
- 一時ファイル(TEMP の出力・ログ)は削除済み。