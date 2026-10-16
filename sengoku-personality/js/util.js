/*
 * util.js — SG.Util
 * 副作用のない小さなユーティリティ関数だけを置く。
 * (HTML/SVG 用エスケープ、ローカル日付キー、clamp、連番 ID、フォント定数)
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  // HTML(innerHTML・属性)と SVG(XML)の両方で使える唯一のエスケープ関数。
  // & を最初に置換し、続けて < > " ' の順に置換する。null/undefined は空文字列。
  function esc(str) {
    if (str === null || str === undefined) { return ''; }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ローカル時刻の日付を YYYY-MM-DD で返す(UTC 変換はしない)。
  function localDateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // 画面内で重複しない ID 接頭辞を作る。乱数は使わず、モジュール内のカウンタで連番にする。
  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return prefix + '-' + uidCounter;
  }

  // フォント指定の唯一の定義。SVG の二重引用符の属性に埋め込めるよう、フォント名は単一引用符で囲む。
  var fonts = {
    serif: "'游明朝','Yu Mincho','YuMincho','Hiragino Mincho ProN','Hiragino Mincho Pro','BIZ UDMincho','MS PMincho','Noto Serif JP',serif",
    sans: "'游ゴシック Medium','Yu Gothic Medium','游ゴシック','Yu Gothic','Hiragino Kaku Gothic ProN','Hiragino Sans','Meiryo','Noto Sans JP',sans-serif"
  };

  SG.Util = {
    esc: esc,
    localDateKey: localDateKey,
    clamp: clamp,
    uid: uid,
    fonts: Object.freeze(fonts)
  };
  Object.freeze(SG.Util);
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Util; }
})(typeof window !== 'undefined' ? window : globalThis);
