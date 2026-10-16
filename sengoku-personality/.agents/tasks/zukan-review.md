# 戦国武将図鑑(診断なしで武将を閲覧する画面)

スタート画面と結果画面から開ける閲覧専用の図鑑を追加した。`js/zukan.js` が `SG.Generals` を読んで 20 枚のカードを描き、詳細は既存の `SG.Results.openGeneralDialog` に前/次ナビ(`options.nav`)を足して再利用している。app.js には `ZUKAN` フェーズが加わり、図鑑へ渡すのは遷移コールバック(`onBack`/`onStart`)だけで、ストア・回答状態は渡していない。

Watch for: ブロッキングな問題は見つからなかった(confirmed)。README の動作確認表に zukan 行が重複している(confirmed、文書のみ)。実機スマホ・Firefox/Safari・スクリーンリーダーは実装者も未確認のまま。

**Verdict**: APPROVED

## High-level view

データは `generals.js` を唯一の情報源として読むだけで、図鑑用の複製はない。詳細ダイアログも結果画面と同じ実装を使うため、表示の二重管理も発生しない。

図鑑モジュールは保存・集計・リセットのコードを持たず、app.js 側も `ZUKAN` 中は state.answers やカウントに触れない。結果画面から往復しても結果 DOM は保持され、`enterResult` を呼ばないので再加算は起きない。「診断を始める」だけが `reset()` を挟んで新規診断に入る。

無操作タイマーは `ZUKAN` を結果画面と同じ上限で扱い、`reset()` が図鑑 DOM とオープナーも片付ける。アクセシビリティ(aria-pressed、ダイアログのフォーカス復帰、前/次後の `role="status"` 通知、reduced-motion の全体規則)と 48px 以上のボタンは仕様どおりで、README にも節・ファイル表・検証表が追記されている。

<details>
<summary>Issues (2)</summary>

1. **README の zukan 行が重複**(confirmed) — 13 章の表に zukan の行が 2 つある(内容が少し違う)。1 行にまとめる。
2. **README の戻り先の記述**(confirmed) — 「『戻る』(または Esc)でスタートへ戻ります」は、結果画面から開いた場合は結果画面に戻る実装と食い違う。「開いた元の画面へ」に直す。

</details>

<details>
<summary>Details</summary>

## 結果画面からの往復と「診断を始める」

`openZukan(returnTo)` は現在のフェーズが `returnTo` と一致するときしか動かず、RESULT では `state.diagnosis` が無ければ開かない。戻りは `showScreen` の切り替えだけで、結果 DOM とフォーカス(開いたボタン)を復元する。一方 `onZukanStart` は `reset()` で結果・ダイアログ・図鑑を全部消してから開始するため、結果画面経由でも前の利用者の痕跡は残らない。この挙動は結果が失われる点で「戻る」と異なるが、ボタン名が「診断を始める」なので意図どおりと判断した。

## 検証記録の範囲

検証記録は `build-fix-log.md` の末尾にあり、simulate、check-static、browser-check(Chrome/Edge 各 235、zukan 51 件)、http smoke がすべて通ったと書かれている。再実行はしていない。未確認として明記されているのは実機スマホ、Firefox/Safari、スクリーンリーダーで、いずれも会場運用前の手動確認項目として残る(possible: 実機でのダイアログ内スクロールと前/次ボタンの押しやすさ)。git リポジトリではないため、差分は新規ファイルと該当箇所の読み取りで確認した。

</details>

<details>
<summary>File map</summary>

- js/zukan.js — 新規。図鑑の描画と並べ替え(表示専用)
- js/results.js — portraitHtml/attachImageFallback の公開、詳細ダイアログの前/次、結果画面のボタン
- js/app.js — ZUKAN フェーズ、遷移、idle 対象、reset での片付け
- index.html — #screen-zukan、スタートのボタン、script 追加
- css/style.css — 図鑑のグリッド・ボタン・前/次ナビ
- tools/*.js — zukan シナリオ、静的検査、シミュレーション(実行はしていない)
- README.md — 図鑑の節、ファイル表、検証表

</details>
