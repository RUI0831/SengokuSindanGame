/*
 * crest.js — SG.Crest
 * 武将の画像の代わりに表示する「代替カード」(家紋風シンボル+和柄+名前)の SVG 文字列を作る(純粋関数)。
 * 実在の家紋の複製ではなく、単純な図形を組み合わせた自作のデザイン。外部の画像素材は使わない。
 * data:image/svg+xml として XML パースされても壊れないよう、次を守る:
 *   属性値は二重引用符、データ由来の文字列は SG.Util.esc() を通す、要素はすべて閉じる、
 *   書式は属性で指定する(style 要素・style 属性・image・foreignObject・script は使わない)。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var KINDS = ['petals5', 'petals8', 'tomoe3', 'diamonds4', 'coins6', 'stars3', 'scales3', 'crossring', 'rings',
    'sun', 'stripes3', 'mountain3', 'trefoil', 'crescent', 'arrows', 'waves', 'glyph'];
  var PATTERNS = ['seigaiha', 'asanoha', 'shippo', 'uroko', 'kikkou', 'ichimatsu'];

  var CX = 150, CY = 170; // シンボルの中心(半径 70 を基準に描く)

  function esc(s) { return root.SG.Util.esc(s); }
  function f1(n) { return String(Math.round(n * 10) / 10); }

  // 角度 deg(0 = 真上、時計回り)と半径 r の点
  function polar(deg, r) {
    var t = (deg - 90) * Math.PI / 180;
    return { x: CX + r * Math.cos(t), y: CY + r * Math.sin(t) };
  }

  // ---- 和柄(<pattern> の中身。userSpaceOnUse のタイル) ----
  function patternTile(name, a) {
    var s = ' stroke="' + a + '" fill="none" stroke-width="1.5"';
    switch (name) {
      case 'seigaiha': // 青海波: 同心の半円弧を千鳥に並べる
        return { w: 40, h: 20, body:
          [20, 14, 8].map(function (r) {
            return '<path d="M' + (20 - r) + ',20 A' + r + ',' + r + ' 0 0,1 ' + (20 + r) + ',20"' + s + ' />' +
              '<path d="M' + (-r) + ',10 A' + r + ',' + r + ' 0 0,1 ' + r + ',10"' + s + ' />' +
              '<path d="M' + (40 - r) + ',10 A' + r + ',' + r + ' 0 0,1 ' + (40 + r) + ',10"' + s + ' />';
          }).join('') };
      case 'asanoha': // 麻の葉: 六角と放射線
        return { w: 40, h: 46, body:
          '<path d="M20,0 L40,11.5 L40,34.5 L20,46 L0,34.5 L0,11.5 Z"' + s + ' />' +
          '<path d="M20,0 L20,46 M0,11.5 L40,34.5 M40,11.5 L0,34.5"' + s + ' />' };
      case 'shippo': // 七宝: 重なる円
        return { w: 30, h: 30, body:
          '<circle cx="0" cy="0" r="15"' + s + ' /><circle cx="30" cy="0" r="15"' + s + ' />' +
          '<circle cx="0" cy="30" r="15"' + s + ' /><circle cx="30" cy="30" r="15"' + s + ' />' +
          '<circle cx="15" cy="15" r="15"' + s + ' />' };
      case 'uroko': // 鱗: 三角の千鳥
        return { w: 30, h: 26, body:
          '<polygon points="0,26 15,0 30,26" fill="' + a + '" />' };
      case 'kikkou': // 亀甲: 六角形の敷き詰め
        return { w: 36, h: 62, body:
          '<path d="M9,0 L27,0 L36,15.5 L27,31 L9,31 L0,15.5 Z M27,31 L36,46.5 L27,62 M9,31 L0,46.5 L9,62"' + s + ' />' };
      default: // ichimatsu 市松
        return { w: 30, h: 30, body:
          '<rect x="0" y="0" width="15" height="15" fill="' + a + '" />' +
          '<rect x="15" y="15" width="15" height="15" fill="' + a + '" />' };
    }
  }

  // ---- 家紋風シンボル(中心 (150,170)、半径 70 基準) ----
  function symbol(kind, c, a, bg) {
    var fill = ' fill="' + a + '"';
    var out = '';
    var i, p;
    switch (kind) {
      case 'petals5': // 5 つの円+中心円
        for (i = 0; i < 5; i++) { p = polar(i * 72, 38); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="25"' + fill + ' />'; }
        return out + '<circle cx="150" cy="170" r="15" fill="' + bg + '" stroke="' + a + '" stroke-width="3" />';
      case 'petals8': // 8 枚の楕円を放射状に
        for (i = 0; i < 8; i++) {
          out += '<ellipse cx="150" cy="130" rx="12" ry="30"' + fill + ' transform="rotate(' + (i * 45) + ' 150 170)" />';
        }
        return out + '<circle cx="150" cy="170" r="12" fill="' + bg + '" stroke="' + a + '" stroke-width="3" />';
      case 'tomoe3': // 三つ巴: 勾玉形を 3 つ
        for (i = 0; i < 3; i++) {
          out += '<g transform="rotate(' + (i * 120) + ' 150 170)">' +
            '<circle cx="150" cy="128" r="20"' + fill + ' />' +
            '<path d="M170,128 Q174,170 132,186" fill="none" stroke="' + a + '" stroke-width="10" stroke-linecap="round" /></g>';
        }
        return out;
      case 'diamonds4': // 4 つの菱形
        [[0, -24], [24, 0], [0, 24], [-24, 0]].forEach(function (d) {
          var x = CX + d[0], y = CY + d[1];
          out += '<polygon points="' + x + ',' + (y - 21) + ' ' + (x + 21) + ',' + y + ' ' + x + ',' + (y + 21) + ' ' + (x - 21) + ',' + y + '"' + fill + ' />';
        });
        return out;
      case 'coins6': // 六連銭風: 円形 6 個(中に四角い穴)
        [[110, 145], [150, 145], [190, 145], [110, 195], [150, 195], [190, 195]].forEach(function (q) {
          out += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="18"' + fill + ' />' +
            '<rect x="' + (q[0] - 5) + '" y="' + (q[1] - 5) + '" width="10" height="10" fill="' + bg + '" />';
        });
        return out;
      case 'stars3': // 一文字に三つ星
        return '<rect x="92" y="114" width="116" height="16" rx="3"' + fill + ' />' +
          '<circle cx="150" cy="162" r="20"' + fill + ' /><circle cx="118" cy="204" r="20"' + fill + ' />' +
          '<circle cx="182" cy="204" r="20"' + fill + ' />';
      case 'scales3': // 三つ鱗
        return '<polygon points="150,108 115,168 185,168"' + fill + ' />' +
          '<polygon points="115,172 80,232 150,232"' + fill + ' />' +
          '<polygon points="185,172 150,232 220,232"' + fill + ' />';
      case 'crossring': // 丸に十字
        return '<circle cx="150" cy="170" r="55" fill="none" stroke="' + a + '" stroke-width="10" />' +
          '<rect x="143" y="115" width="14" height="110"' + fill + ' />' +
          '<rect x="95" y="163" width="110" height="14"' + fill + ' />';
      case 'sun': // 円+12 本の放射
        out = '<circle cx="150" cy="170" r="30"' + fill + ' />';
        for (i = 0; i < 12; i++) {
          var p1 = polar(i * 30, 40), p2 = polar(i * 30, 62);
          out += '<line x1="' + f1(p1.x) + '" y1="' + f1(p1.y) + '" x2="' + f1(p2.x) + '" y2="' + f1(p2.y) +
            '" stroke="' + a + '" stroke-width="6" stroke-linecap="round" />';
        }
        return out;
      case 'stripes3': // 丸に三本線
        return '<circle cx="150" cy="170" r="58" fill="none" stroke="' + a + '" stroke-width="6" />' +
          '<rect x="103.5" y="140" width="93" height="14"' + fill + ' />' +
          '<rect x="98" y="163" width="104" height="14"' + fill + ' />' +
          '<rect x="103.5" y="186" width="93" height="14"' + fill + ' />';
      case 'mountain3': // 三つ山
        return '<polygon points="80,215 110,160 130,185 150,125 170,185 190,160 220,215"' + fill + ' />' +
          '<rect x="80" y="222" width="140" height="8"' + fill + ' />';
      case 'trefoil': // 三つ葉
        for (i = 0; i < 3; i++) {
          out += '<ellipse cx="150" cy="138" rx="19" ry="32"' + fill + ' transform="rotate(' + (i * 120) + ' 150 170)" />';
        }
        return out + '<circle cx="150" cy="170" r="9" fill="' + bg + '" />';
      case 'crescent': // 三日月
        return '<path d="M150,120 A50,50 0 0,0 150,220 A60,60 0 0,1 150,120 Z"' + fill + ' />' +
          '<circle cx="178" cy="150" r="6"' + fill + ' />';
      case 'arrows': // 交差する矢
        [[95, 225, 205, 115], [205, 225, 95, 115]].forEach(function (v) {
          var dx = v[2] - v[0], dy = v[3] - v[1], len = Math.sqrt(dx * dx + dy * dy);
          var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          var hx = v[2], hy = v[3];
          out += '<line x1="' + v[0] + '" y1="' + v[1] + '" x2="' + v[2] + '" y2="' + v[3] + '" stroke="' + a + '" stroke-width="6" />' +
            '<polygon points="' + f1(hx + ux * 8) + ',' + f1(hy + uy * 8) + ' ' + f1(hx - ux * 14 + nx * 9) + ',' + f1(hy - uy * 14 + ny * 9) +
            ' ' + f1(hx - ux * 14 - nx * 9) + ',' + f1(hy - uy * 14 - ny * 9) + '"' + fill + ' />';
          for (var k = 0; k < 2; k++) {
            var bx = v[0] + ux * (6 + k * 10), by = v[1] + uy * (6 + k * 10);
            out += '<line x1="' + f1(bx) + '" y1="' + f1(by) + '" x2="' + f1(bx + nx * 10 - ux * 8) + '" y2="' + f1(by + ny * 10 - uy * 8) +
              '" stroke="' + a + '" stroke-width="4" />' +
              '<line x1="' + f1(bx) + '" y1="' + f1(by) + '" x2="' + f1(bx - nx * 10 - ux * 8) + '" y2="' + f1(by - ny * 10 - uy * 8) +
              '" stroke="' + a + '" stroke-width="4" />';
          }
        });
        return out;
      case 'waves': // 波の弧 3 段
        [140, 170, 200].forEach(function (y) {
          out += '<path d="M85,' + y + ' Q107,' + (y - 25) + ' 129,' + y + ' T173,' + y + ' T217,' + y +
            '" fill="none" stroke="' + a + '" stroke-width="7" stroke-linecap="round" />';
        });
        return out;
      case 'glyph': // 円内に 1 文字
        return '<circle cx="150" cy="170" r="58" fill="none" stroke="' + a + '" stroke-width="5" />' +
          '<text x="150" y="198" text-anchor="middle" font-size="80" font-weight="700" font-family="' + root.SG.Util.fonts.serif +
          '"' + fill + ' paint-order="stroke" stroke="#000000" stroke-width="3">' + esc(c.glyph) + '</text>';
      default: // rings 蛇の目(未知の kind もここ)
        return '<circle cx="150" cy="170" r="52" fill="none" stroke="' + a + '" stroke-width="14" />' +
          '<circle cx="150" cy="170" r="22"' + fill + ' />';
    }
  }

  // general: 武将データ、opts: { idPrefix, title }
  function svg(general, opts) {
    opts = opts || {};
    var c = general.crest || {};
    var Util = root.SG.Util;
    var kind = KINDS.indexOf(c.kind) >= 0 ? c.kind : 'rings';
    var pattern = PATTERNS.indexOf(c.pattern) >= 0 ? c.pattern : 'seigaiha';
    var bg1 = esc(c.bg1 || '#1a1a1a'), bg2 = esc(c.bg2 || '#000000'), a = esc(c.accent || '#f0c75e');
    var id = esc(opts.idPrefix || Util.uid('crest'));
    var serif = Util.fonts.serif; // 固定の信頼値(validateData が " < & を含まないことを保証)
    var tile = patternTile(pattern, a);

    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">';
    if (typeof opts.title === 'string' && opts.title !== '') { out += '<title>' + esc(opts.title) + '</title>'; }
    out += '<defs>' +
      '<linearGradient id="' + id + '-bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + bg1 + '" /><stop offset="1" stop-color="' + bg2 + '" /></linearGradient>' +
      '<radialGradient id="' + id + '-glow" cx="0.5" cy="0.4" r="0.5">' +
      '<stop offset="0" stop-color="' + a + '" stop-opacity="0.18" /><stop offset="1" stop-color="' + a + '" stop-opacity="0" /></radialGradient>' +
      '<pattern id="' + id + '-pat" width="' + tile.w + '" height="' + tile.h + '" patternUnits="userSpaceOnUse">' + tile.body + '</pattern>' +
      '</defs>';
    // 1. 背景 2. 和柄 3. 光
    out += '<rect x="0" y="0" width="300" height="400" fill="url(#' + id + '-bg)" />' +
      '<rect x="0" y="0" width="300" height="400" fill="url(#' + id + '-pat)" opacity="0.10" />' +
      '<rect x="0" y="0" width="300" height="400" fill="url(#' + id + '-glow)" />';
    // 4. 家紋風シンボル(名前を縦に積む余白を取るため、少し上へ寄せて縮小する)+外周の二重円
    out += '<g transform="translate(150 146) scale(0.86) translate(-150 -170)">' + symbol(kind, c, a, bg2) +
      '<circle cx="150" cy="170" r="80" fill="none" stroke="' + a + '" stroke-width="3" />' +
      '<circle cx="150" cy="170" r="87" fill="none" stroke="' + a + '" stroke-width="1.5" /></g>';
    // 5. 名前(1 文字ずつ縦に積む。縦書き CSS は画像変換時の互換性が低いので使わない)
    var chars = Array.from ? Array.from(String(c.display || '')) : String(c.display || '').split('');
    var size = chars.length >= 3 ? 34 : 50;
    var lead = chars.length >= 3 ? 36 : 54;
    var y0 = 232 + size * 0.88;
    chars.forEach(function (ch, i) {
      out += '<text x="150" y="' + f1(y0 + i * lead) + '" text-anchor="middle" font-size="' + size + '" font-weight="700" font-family="' +
        serif + '" fill="' + a + '" paint-order="stroke" stroke="#000000" stroke-width="3">' + esc(ch) + '</text>';
    });
    // 6. 下部の帯(武将名を横書き)
    out += '<line x1="40" y1="350" x2="260" y2="350" stroke="' + a + '" stroke-width="1" />' +
      '<line x1="40" y1="378" x2="260" y2="378" stroke="' + a + '" stroke-width="1" />' +
      '<text x="150" y="370" text-anchor="middle" font-size="18" font-family="' + serif + '" fill="' + a + '">' + esc(general.name) + '</text>';
    // 7. 外周の二重フレームと四隅の飾り
    out += '<rect x="5" y="5" width="290" height="390" fill="none" stroke="' + a + '" stroke-width="3" />' +
      '<rect x="12" y="12" width="276" height="376" fill="none" stroke="' + a + '" stroke-width="1" />';
    [[12, 12, 1, 1], [288, 12, -1, 1], [12, 388, 1, -1], [288, 388, -1, -1]].forEach(function (k) {
      out += '<path d="M' + k[0] + ',' + (k[1] + k[3] * 22) + ' L' + k[0] + ',' + k[1] + ' L' + (k[0] + k[2] * 22) + ',' + k[1] +
        '" fill="none" stroke="' + a + '" stroke-width="4" />' +
        '<circle cx="' + (k[0] + k[2] * 9) + '" cy="' + (k[1] + k[3] * 9) + '" r="2.5" fill="' + a + '" />';
    });
    return out + '</svg>';
  }

  // 結果カード用の data URI(title なし)
  function dataUri(general) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(general));
  }

  SG.Crest = { svg: svg, dataUri: dataUri, kinds: Object.freeze(KINDS.slice()), patterns: Object.freeze(PATTERNS.slice()) };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Crest; }
})(typeof window !== 'undefined' ? window : globalThis);
