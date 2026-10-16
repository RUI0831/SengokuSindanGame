/*
 * chart.js — SG.Chart
 * 性格パラメータのグラフを描く(表示専用。状態は持たない)。
 *   renderBars     : 結果画面の横棒グラフ(6 行。軸名・説明・数値をテキストでも出す)
 *   renderRadar    : 自作 SVG のレーダーチャート(ユーザー=金の実線、1 位の武将=深紅系の破線)
 *   renderMiniBars : 武将詳細ダイアログ用の小さな横棒(診断用の仮想モデル値)
 * アニメーションは CSS のクラスで付ける。JS は値を描くだけにする。
 * データ由来の文字列は必ず SG.Util.esc() を通す。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  function esc(s) { return root.SG.Util.esc(s); }
  function axes() { return root.SG.Diagnosis.AXES; }
  function f1(n) { return String(Math.round(n * 10) / 10); }
  // バーの幅(%)は丸める前の値を 0〜100 に収めて使う
  function pct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

  // 横棒グラフ。user は丸める前のユーザー 6 値
  function renderBars(container, user) {
    var html = '<div class="bars">';
    axes().forEach(function (ax) {
      var v = user[ax.key];
      var shown = Math.round(v);
      html += '<div class="bar-row">' +
        '<div class="bar-label"><span class="bar-name">' + esc(ax.label) + '</span>' +
        '<span class="bar-desc">' + esc(ax.desc) + '</span></div>' +
        '<div class="bar-track" role="img" aria-label="' + esc(ax.label + ' ' + shown + '点') + '">' +
        '<div class="bar-fill" style="width:' + f1(pct(v)) + '%"></div></div>' +
        '<span class="bar-value">' + shown + '</span>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // レーダーの頂点座標。頂点 i の角度は −90° + 60°×i(真上から時計回り)
  var CX = 180, CY = 180, R = 120;
  function point(i, v) {
    var t = (-90 + 60 * i) * Math.PI / 180;
    var r = R * pct(v) / 100;
    return { x: CX + r * Math.cos(t), y: CY + r * Math.sin(t) };
  }
  function polygonPoints(values) {
    return values.map(function (v, i) { var p = point(i, v); return f1(p.x) + ',' + f1(p.y); }).join(' ');
  }

  // レーダーチャート。user は丸める前のユーザー 6 値、general は比較する武将(1 位)
  function renderRadar(container, user, general) {
    var list = axes();
    var uid = root.SG.Util.uid('radar');
    var userVals = list.map(function (ax) { return user[ax.key]; });
    var genVals = list.map(function (ax) { return general[ax.key]; });
    var descText = 'あなた: ' + list.map(function (ax) { return ax.label + ' ' + Math.round(user[ax.key]); }).join('、') +
      '。' + general.name + ': ' + list.map(function (ax) { return ax.label + ' ' + general[ax.key]; }).join('、') + '。';

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" width="360" height="360" role="img"' +
      ' aria-labelledby="' + uid + '-t ' + uid + '-d">' +
      '<title id="' + uid + '-t">' + esc('あなたと' + general.name + 'の性格パラメータの比較') + '</title>' +
      '<desc id="' + uid + '-d">' + esc(descText) + '</desc>';
    // 同心六角形(20/40/60/80/100)
    [20, 40, 60, 80, 100].forEach(function (lv) {
      svg += '<polygon class="radar-grid" points="' + polygonPoints([lv, lv, lv, lv, lv, lv]) + '" fill="none"' +
        ' stroke="#8c6d1f" stroke-opacity="' + (lv === 100 ? '0.9' : '0.45') + '" stroke-width="1" />';
    });
    // 軸線と頂点ラベル
    list.forEach(function (ax, i) {
      var p = point(i, 100);
      svg += '<line x1="' + CX + '" y1="' + CY + '" x2="' + f1(p.x) + '" y2="' + f1(p.y) + '" stroke="#8c6d1f" stroke-opacity="0.45" stroke-width="1" />';
      var t = (-90 + 60 * i) * Math.PI / 180;
      var lx = CX + (R + 18) * Math.cos(t), ly = CY + (R + 18) * Math.sin(t) + 5;
      var anchor = Math.abs(Math.cos(t)) < 0.01 ? 'middle' : (Math.cos(t) > 0 ? 'start' : 'end');
      if (i === 0) { ly -= 4; }
      if (i === 3) { ly += 8; }
      svg += '<text x="' + f1(lx) + '" y="' + f1(ly) + '" text-anchor="' + anchor + '" font-size="15" font-weight="700"' +
        ' fill="#f3ead2" font-family="' + root.SG.Util.fonts.sans + '">' + esc(ax.label) + '</text>';
    });
    // 武将(深紅系の破線)を先に、ユーザー(金の実線)を上に描く
    svg += '<polygon class="radar-poly radar-general" points="' + polygonPoints(genVals) + '" fill="#c2273d" fill-opacity="0.16"' +
      ' stroke="#e0566a" stroke-width="2.5" stroke-dasharray="7 5" stroke-linejoin="round" />';
    svg += '<polygon class="radar-poly radar-user" points="' + polygonPoints(userVals) + '" fill="#d4af37" fill-opacity="0.30"' +
      ' stroke="#f2d572" stroke-width="3" stroke-linejoin="round" />';
    userVals.forEach(function (v, i) {
      var p = point(i, v);
      svg += '<circle class="radar-poly radar-user-dot" cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="3.5" fill="#f2d572" />';
    });
    svg += '</svg>';

    container.innerHTML = svg +
      '<ul class="radar-legend">' +
      '<li><span class="legend-swatch legend-user" aria-hidden="true"></span>あなた(実線)</li>' +
      '<li><span class="legend-swatch legend-general" aria-hidden="true"></span>' + esc(general.name) + '(破線)</li>' +
      '</ul>' +
      '<p class="radar-note">目盛りは 0〜100。回答の傾向が強いほど外側に近づきます。武将の数値は診断用の仮想モデル値です。</p>';
  }

  // 詳細ダイアログ用の小さな横棒。user(任意)を渡すと「あなた」の値も並べて表示する
  function renderMiniBars(container, general, user) {
    var html = '<div class="mini-bars">';
    axes().forEach(function (ax) {
      var v = general[ax.key];
      html += '<div class="mini-row">' +
        '<span class="mini-name">' + esc(ax.label) + '</span>' +
        '<span class="mini-track" role="img" aria-label="' + esc(ax.label + ' ' + v + '点') + '">' +
        '<span class="mini-fill" style="width:' + f1(pct(v)) + '%"></span></span>' +
        '<span class="mini-value">' + v + '</span>';
      if (user) {
        html += '<span class="mini-user">あなた ' + Math.round(user[ax.key]) + '</span>';
      }
      html += '</div>';
    });
    html += '</div><p class="mini-note">※ 診断用の仮想モデル値です(歴史学的な根拠のある数値ではありません)。</p>';
    container.innerHTML = html;
  }

  SG.Chart = { renderBars: renderBars, renderRadar: renderRadar, renderMiniBars: renderMiniBars };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Chart; }
})(typeof window !== 'undefined' ? window : globalThis);
