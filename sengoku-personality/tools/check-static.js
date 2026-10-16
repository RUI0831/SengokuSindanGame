#!/usr/bin/env node
/*
 * tools/check-static.js — 静的検査(設計書 B-19 #14 / AC-24)
 * 走査対象: index.html・js/*.js・css/style.css
 *   共通: http:// / https:// を禁止(許可は SVG 名前空間 http://www.w3.org/2000/svg のみ。コメント中も対象)
 *   HTML: type="module"、js/ 以外の <script src>、相対パス以外の <link href>、相対パス・data:image/ 以外の <img src>、
 *         <iframe>、<base>、属性値のプロトコル相対 URL(//host)
 *   JS  : fetch( / XMLHttpRequest / WebSocket / sendBeacon / new EventSource / importScripts / navigator.serviceWorker /
 *         .src = 'http… / 行頭の import・export / import( / ?. と ??(コメントと文字列を除いた本文で検査)
 *   CSS : @import、@font-face 内の data: 以外の url(、url( に続く http: / https: / //
 *   整合性: <script src> の参照先が存在し、順序が設計書 B-3 と一致する。<link rel="stylesheet"> の参照先が存在する。
 * 違反は「ファイル:行番号: パターン」で出力し、exit 1。違反がなければ「check-static: OK (n files)」。
 * Node 標準モジュールだけを使う。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SVG_NS = 'http://www.w3.org/2000/svg';
var SCRIPT_ORDER = [
  'js/util.js', 'js/questions.js', 'js/generals.js', 'js/diagnosis.js', 'js/reason.js', 'js/compat.js', 'js/storage.js',
  'js/crest.js', 'js/chart.js', 'js/results.js', 'js/player-ranking.js', 'js/zukan.js', 'js/share-card.js', 'js/app.js'
];
// 来場者側のコード・HTML に含めてはいけない語(集計の書き換え・運営用の操作)
var PLAYER_FORBIDDEN = /reset|removeItem|リセット|削除|運営|increment/gi;
// 図鑑(js/zukan.js と #screen-zukan)はさらに保存領域・集計への参照も禁止(閲覧が集計や保存に触れないことの静的な保証)
var ZUKAN_FORBIDDEN = /reset|removeItem|localStorage|sessionStorage|SG\.Storage|increment|リセット|削除|運営/gi;

// 相性(js/compat.js)は純粋関数: 乱数・日時・保存領域・ランキング加算に触れてはいけない(コメントも対象)
var COMPAT_FORBIDDEN = /Math\.random|\bDate\b|localStorage|sessionStorage|SG\.Storage|increment/g;

var violations = [];
function report(file, line, pattern) { violations.push(file + ':' + line + ': ' + pattern); }

function lineOf(text, index) {
  var n = 1;
  for (var i = 0; i < index && i < text.length; i++) { if (text.charCodeAt(i) === 10) { n++; } }
  return n;
}

// 正規表現(g フラグ)のすべての一致を報告する
function scan(file, text, re, label) {
  re.lastIndex = 0;
  var m;
  while ((m = re.exec(text)) !== null) {
    report(file, lineOf(text, m.index), label);
    if (m[0].length === 0) { re.lastIndex++; }
  }
}

// 共通: http(s):// の禁止(SVG 名前空間だけは許可)
function checkUrls(file, text) {
  var re = /https?:\/\//gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    if (text.substr(m.index, SVG_NS.length) === SVG_NS) { continue; }
    report(file, lineOf(text, m.index), 'http(s):// の URL(許可は SVG 名前空間のみ)');
  }
}

// JS のコメントと文字列リテラル(テンプレート文字列を含む)を空白に置き換える(改行は残して行番号を保つ)。
// 正規表現リテラルも空白にする(/["<&]/ のような引用符を含む正規表現で文字列の判定がずれないようにするため)。
function stripJs(src) {
  var out = src.split('');
  var i = 0, n = src.length;
  var lastSig = ''; // 直前の意味のある文字(正規表現リテラルの判定に使う)
  var lastWord = '';
  function blank(from, to) { for (var k = from; k < to; k++) { if (out[k] !== '\n' && out[k] !== '\r') { out[k] = ' '; } } }
  while (i < n) {
    var c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      var e = src.indexOf('\n', i); if (e < 0) { e = n; }
      blank(i, e); i = e; continue;
    }
    if (c === '/' && d === '*') {
      var e2 = src.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2;
      blank(i, e2); i = e2; continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      var j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c !== '`' && src[j] === '\n') { break; }
        j++;
      }
      blank(i, Math.min(n, j + 1)); i = j + 1; lastSig = 'str'; lastWord = ''; continue;
    }
    if (c === '/') {
      var regexAllowed = lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(lastSig) >= 0 ||
        ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new'].indexOf(lastWord) >= 0;
      if (regexAllowed) {
        var k2 = i + 1, inClass = false;
        while (k2 < n && src[k2] !== '\n') {
          if (src[k2] === '\\') { k2 += 2; continue; }
          if (src[k2] === '[') { inClass = true; } else if (src[k2] === ']') { inClass = false; }
          else if (src[k2] === '/' && !inClass) { break; }
          k2++;
        }
        k2++;
        while (k2 < n && /[a-z]/i.test(src[k2])) { k2++; }
        blank(i, k2); i = k2; lastSig = 'regex'; lastWord = ''; continue;
      }
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      var w = i;
      while (w < n && /[A-Za-z0-9_$]/.test(src[w])) { w++; }
      lastWord = src.slice(i, w); lastSig = 'word'; i = w; continue;
    }
    lastSig = c; lastWord = ''; i++;
  }
  return out.join('');
}

function checkJs(file, text) {
  checkUrls(file, text);
  scan(file, text, /\bfetch\s*\(/g, 'fetch(');
  scan(file, text, /XMLHttpRequest/g, 'XMLHttpRequest');
  scan(file, text, /\bWebSocket\b/g, 'WebSocket');
  scan(file, text, /sendBeacon/g, 'sendBeacon');
  scan(file, text, /new\s+EventSource/g, 'new EventSource');
  scan(file, text, /importScripts/g, 'importScripts');
  scan(file, text, /navigator\s*\.\s*serviceWorker/g, 'navigator.serviceWorker');
  scan(file, text, /\.src\s*=\s*['"`]\s*https?:/gi, ".src = 'http…");
  scan(file, text, /^[ \t]*import\s/gm, '行頭の import');
  scan(file, text, /^[ \t]*export\s/gm, '行頭の export');
  scan(file, text, /\bimport\s*\(/g, 'import(');
  var body = stripJs(text);
  scan(file, body, /\?\?|\?\.[A-Za-z_$[(]/g, '?. または ?? 演算子');
}

function isRelativePath(v) {
  return v !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(v) && v.charAt(0) !== '/' && v.charAt(0) !== '\\';
}

function checkHtml(file, text) {
  checkUrls(file, text);
  scan(file, text, /<script\b[^>]*\btype\s*=\s*["']?module/gi, '<script type="module">');
  scan(file, text, /<iframe\b/gi, '<iframe>');
  scan(file, text, /<base\b/gi, '<base>');
  scan(file, text, /\s(?:src|href|action|poster|data|srcset)\s*=\s*["']?\s*\/\//gi, 'プロトコル相対 URL(//)');

  var m;
  var scripts = [];
  var reScript = /<script\b([^>]*)>/gi;
  while ((m = reScript.exec(text)) !== null) {
    var sm = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(m[1]);
    if (!sm) { continue; }
    var src = sm[1];
    scripts.push({ src: src, line: lineOf(text, m.index) });
    if (!/^js\/[A-Za-z0-9_.-]+\.js$/.test(src)) { report(file, lineOf(text, m.index), '<script src> が js/ 配下の相対パスではない(' + src + ')'); }
    else if (!fs.existsSync(path.join(ROOT, src))) { report(file, lineOf(text, m.index), '<script src> の参照先がない(' + src + ')'); }
  }
  var order = scripts.map(function (s) { return s.src; });
  if (order.join('|') !== SCRIPT_ORDER.join('|')) {
    report(file, scripts.length ? scripts[0].line : 1, '<script> の順序が設計書 B-3 と違う(' + order.join(', ') + ')');
  }

  var reLink = /<link\b([^>]*)>/gi;
  while ((m = reLink.exec(text)) !== null) {
    var hm = /\bhref\s*=\s*["']([^"']*)["']/i.exec(m[1]);
    if (!hm) { continue; }
    var href = hm[1];
    var ln = lineOf(text, m.index);
    if (!isRelativePath(href)) { report(file, ln, '<link href> が相対パスではない(' + href + ')'); continue; }
    if (/\brel\s*=\s*["']?stylesheet/i.test(m[1]) && !fs.existsSync(path.join(ROOT, href.split(/[?#]/)[0]))) {
      report(file, ln, '<link rel="stylesheet"> の参照先がない(' + href + ')');
    }
  }

  var reImg = /<img\b([^>]*)>/gi;
  while ((m = reImg.exec(text)) !== null) {
    var im = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(m[1]);
    if (!im) { continue; }
    if (!isRelativePath(im[1]) && im[1].indexOf('data:image/') !== 0) {
      report(file, lineOf(text, m.index), '<img src> が相対パス・data:image/ ではない(' + im[1] + ')');
    }
  }
}

function checkCss(file, text) {
  checkUrls(file, text);
  scan(file, text, /@import\b/gi, '@import');
  scan(file, text, /url\(\s*['"]?\s*(?:https?:|\/\/)/gi, 'url( に外部 URL');
  var reFace = /@font-face\s*\{[^}]*\}/gi;
  var m;
  while ((m = reFace.exec(text)) !== null) {
    var block = m[0];
    var reUrl = /url\(\s*['"]?\s*([^'")\s]*)/gi;
    var u;
    while ((u = reUrl.exec(block)) !== null) {
      if (u[1].indexOf('data:') !== 0) { report(file, lineOf(text, m.index + u.index), '@font-face の url( が data: ではない'); }
    }
  }
}

// 来場者向けの画面(js/player-ranking.js と HTML ブロック)にリセット系の語・コードがないこと(コメントも対象)
function checkPlayerSide(file, text, lineOffset, re) {
  re = re || PLAYER_FORBIDDEN;
  re.lastIndex = 0;
  var m;
  while ((m = re.exec(text)) !== null) {
    report(file, lineOffset + lineOf(text, m.index), '来場者側に使えない語: ' + m[0]);
  }
}

function main() {
  var files = [];
  var html = path.join(ROOT, 'index.html');
  var css = path.join(ROOT, 'css', 'style.css');
  var jsDir = path.join(ROOT, 'js');
  if (fs.existsSync(html)) { files.push(html); } else { report('index.html', 1, 'ファイルがない'); }
  if (fs.existsSync(css)) { files.push(css); } else { report('css/style.css', 1, 'ファイルがない'); }
  if (fs.existsSync(jsDir)) {
    fs.readdirSync(jsDir).filter(function (f) { return /\.js$/i.test(f); }).sort().forEach(function (f) {
      files.push(path.join(jsDir, f));
    });
  }
  files.forEach(function (abs) {
    var rel = path.relative(ROOT, abs).split(path.sep).join('/');
    var text = fs.readFileSync(abs, 'utf8');
    if (rel === 'js/player-ranking.js') { checkPlayerSide(rel, text, 0); }
    if (rel === 'js/compat.js') { checkPlayerSide(rel, text, 0, COMPAT_FORBIDDEN); }
    if (rel === 'js/zukan.js') { checkPlayerSide(rel, text, 0, ZUKAN_FORBIDDEN); }
    if (rel === 'index.html') {
      var zs = text.indexOf('id="screen-zukan"');
      if (zs < 0) { report(rel, 1, '#screen-zukan がない'); }
      else {
        var ze = text.indexOf('</section>', zs);
        checkPlayerSide(rel, text.slice(zs, ze < 0 ? text.length : ze), lineOf(text, zs) - 1, ZUKAN_FORBIDDEN);
      }
      // #screen-player-ranking のブロック(開始タグから </section> まで)だけを検査する
      var s = text.indexOf('id="screen-player-ranking"');
      if (s < 0) { report(rel, 1, '#screen-player-ranking がない'); }
      else {
        var e = text.indexOf('</section>', s);
        checkPlayerSide(rel, text.slice(s, e < 0 ? text.length : e), lineOf(text, s) - 1);
      }
    }
    if (/\.html$/i.test(abs)) { checkHtml(rel, text); }
    else if (/\.css$/i.test(abs)) { checkCss(rel, text); }
    else { checkJs(rel, text); }
  });
  if (violations.length) {
    violations.forEach(function (v) { console.log(v); });
    console.log('check-static: FAIL (' + violations.length + ' violations in ' + files.length + ' files)');
    process.exitCode = 1;
  } else {
    console.log('check-static: OK (' + files.length + ' files)');
  }
}

main();
