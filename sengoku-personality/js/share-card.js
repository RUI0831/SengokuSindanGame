/*
 * share-card.js — SG.ShareCard
 * 診断結果を縦長のカード画像(PNG 1080×1920)にする。描画元はすべてローカルで生成し、外部には何も送らない。
 *   full      : 家紋風の代替カード SVG(data URI)を drawImage する通常の描画
 *   primitive : 画像を一切使わず、Canvas の図形と文字だけで描く予備の描画(full が失敗したときだけ使う)
 * full の失敗コードは 5 種: svg-load-error / svg-timeout / tainted / draw-exception / export-error。
 * 生成のたびに console に 1 行だけ結果を出す(常時フォールバックしているのに気づかない、を防ぐため)。
 * blob URL はこのモジュールが管理し、dispose() ですべて revoke する。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var W = 1080, H = 1920;
  var SVG_LOAD_TIMEOUT_MS = 3000;   // SVG の読み込み待ちの上限
  var TOBLOB_TIMEOUT_MS = 1500;     // toBlob の待ちの上限(時間切れなら blob なしで続ける)
  var REVOKE_AFTER_MS = 30000;      // 自動ダウンロード用の blob URL を破棄するまで
  var PREVIEW_BLOB_THRESHOLD = 1500000; // dataUrl がこれより長ければ、プレビューには blob URL を使う

  // primitive でも使えるよう、軸名はここに直接持つ(他モジュールの定数に依存しない)
  var AXIS_ROWS = [
    ['leadership', '統率力'], ['action', '行動力'], ['strategy', '知略'],
    ['social', '社交性'], ['caution', '慎重さ'], ['innovation', '革新性']
  ];

  var urls = [];        // 未 revoke の blob URL
  var revokeTimers = []; // 保留中の revoke タイマー

  function trackUrl(blob) {
    var u = root.URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }
  function revoke(u) {
    var i = urls.indexOf(u);
    if (i < 0) { return; }
    urls.splice(i, 1);
    try { root.URL.revokeObjectURL(u); } catch (e) { /* 無視 */ }
  }

  function fail(code, cause) {
    var e = new Error(code + (cause && cause.message ? ': ' + cause.message : ''));
    e.code = code;
    return e;
  }

  // ---- 描画の部品 ----
  function fitFont(ctx, text, weight, size, minSize, family, maxWidth) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (s > minSize && ctx.measureText(text).width > maxWidth) {
      s -= 2;
      ctx.font = weight + ' ' + s + 'px ' + family;
    }
    return s;
  }

  function drawBackground(ctx) {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0c12');
    bg.addColorStop(1, '#161b2b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 薄い青海波(円弧の繰り返し)
    ctx.save();
    ctx.strokeStyle = 'rgba(212,175,55,0.07)';
    ctx.lineWidth = 2;
    for (var y = 0; y <= H + 60; y += 60) {
      for (var x = (y / 60) % 2 ? 60 : 0; x <= W + 120; x += 120) {
        for (var r = 60; r >= 20; r -= 20) {
          ctx.beginPath();
          ctx.arc(x, y, r, Math.PI, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    // 外枠: 金の二重罫線
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.lineWidth = 2;
    ctx.strokeRect(52, 52, W - 104, H - 104);
  }

  function drawPanelFrame(ctx) {
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 6;
    ctx.strokeRect(219, 294, 642, 852);
    ctx.lineWidth = 2;
    ctx.strokeRect(207, 282, 666, 876);
  }

  // 武将名・類似度・タイプ・6 パラメータ・フッター(full と primitive で共通。フォントだけ切り替える)
  function drawTexts(ctx, d, serif, sans) {
    var g = d.top.general;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#f2d572';
    ctx.font = '700 64px ' + serif;
    ctx.fillText('戦国武将性格診断', W / 2, 150);
    ctx.fillStyle = '#f3ead2';
    ctx.font = '400 38px ' + serif;
    ctx.fillText('あなたに最も似ている戦国武将は……', W / 2, 232);

    ctx.fillStyle = '#f2d572';
    fitFont(ctx, g.name, '700', 124, 60, serif, 920);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(g.name, W / 2, 1290);
    ctx.fillText(g.name, W / 2, 1290);

    ctx.fillStyle = '#f3ead2';
    ctx.font = '700 76px ' + sans;
    ctx.fillText('類似度 ' + d.top.similarity + '%', W / 2, 1385);

    var type = '「' + g.title + '」タイプ';
    ctx.fillStyle = '#f2d572';
    fitFont(ctx, type, '700', 44, 30, serif, 940);
    ctx.fillText(type, W / 2, 1455);

    // 6 パラメータ(丸めた値)
    var u = d.userRounded;
    AXIS_ROWS.forEach(function (row, i) {
      var y = 1530 + i * 54;
      var v = Math.max(0, Math.min(100, Number(u[row[0]]) || 0));
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f3ead2';
      ctx.font = '700 32px ' + sans;
      ctx.fillText(row[1], 150, y + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(300, y - 12, 520, 26);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(300, y - 12, 520 * v / 100, 26);
      ctx.strokeStyle = '#8c6d1f';
      ctx.lineWidth = 2;
      ctx.strokeRect(300, y - 12, 520, 26);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f3ead2';
      ctx.fillText(String(v), 930, y + 12);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c9bf9f';
    ctx.font = '400 26px ' + sans;
    // 内側の金罫線(y=1868)と重ならない高さに置く
    ctx.fillText('※エンターテインメント診断です。数値は診断用の仮想モデルです', W / 2, 1850);
  }

  // primitive 用の武将パネル(図形と文字だけ)
  function drawPrimitivePanel(ctx, g) {
    var c = g.crest || {};
    var grad = ctx.createLinearGradient(0, 300, 0, 1140);
    grad.addColorStop(0, /^#[0-9a-fA-F]{6}$/.test(c.bg1) ? c.bg1 : '#3a1a1a');
    grad.addColorStop(1, /^#[0-9a-fA-F]{6}$/.test(c.bg2) ? c.bg2 : '#0a0c12');
    ctx.fillStyle = grad;
    ctx.fillRect(225, 300, 630, 840);
    var accent = /^#[0-9a-fA-F]{6}$/.test(c.accent) ? c.accent : '#d4af37';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(540, 560, 170, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(540, 560, 190, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(540, 560, 60, 0, 2 * Math.PI);
    ctx.fill();
    var chars = String(c.display || g.name || '').split('');
    var size = chars.length >= 3 ? 110 : 140;
    ctx.textAlign = 'center';
    ctx.font = '700 ' + size + 'px serif';
    chars.forEach(function (ch, i) {
      ctx.fillText(ch, 540, 860 + i * (size + 8) - (chars.length - 2) * 40);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new root.Image();
      var settled = false;
      var timer = root.setTimeout(function () {
        if (settled) { return; }
        settled = true;
        reject(fail('svg-timeout'));
      }, SVG_LOAD_TIMEOUT_MS);
      img.onload = function () {
        if (settled) { return; }
        settled = true;
        root.clearTimeout(timer);
        resolve(img);
      };
      img.onerror = function () {
        if (settled) { return; }
        settled = true;
        root.clearTimeout(timer);
        reject(fail('svg-load-error'));
      };
      img.src = src;
    });
  }

  // toBlob を時間切れ付きで待つ。非対応・null・時間切れは blob なし(null)で続ける
  function exportBlob(canvas) {
    if (typeof canvas.toBlob !== 'function') { return Promise.resolve(null); }
    var timer = null;
    var viaBlob = new Promise(function (resolve) {
      try {
        canvas.toBlob(function (b) { resolve(b || null); }, 'image/png');
      } catch (e) {
        resolve(null);
      }
    });
    var timeout = new Promise(function (resolve) { timer = root.setTimeout(function () { resolve(null); }, TOBLOB_TIMEOUT_MS); });
    return Promise.race([viaBlob, timeout]).then(function (b) { root.clearTimeout(timer); return b; });
  }

  // dataUrl(base64 の PNG)から同じ内容の Blob を作る。toBlob が時間切れ・非対応のときの代わり(失敗なら null)
  // 1080×1920 の PNG は約 1.5MB あり、toBlob の再エンコードが TOBLOB_TIMEOUT_MS を超えることがあるため
  function blobFromDataUrl(dataUrl) {
    try {
      if (typeof root.atob !== 'function' || typeof root.Blob !== 'function') { return null; }
      var bin = root.atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
      return new root.Blob([bytes], { type: 'image/png' });
    } catch (e) {
      return null;
    }
  }

  // 書き出し: dataUrl は必ず取得する(取れなければ export-error)
  function exportCanvas(canvas) {
    var dataUrl;
    try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { return Promise.reject(fail('export-error', e)); }
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png') !== 0) { return Promise.reject(fail('export-error')); }
    return exportBlob(canvas).then(function (blob) { return { blob: blob || blobFromDataUrl(dataUrl), dataUrl: dataUrl }; });
  }

  function newCanvas() {
    var canvas = root.document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) { throw new Error('2D context unavailable'); }
    return { canvas: canvas, ctx: ctx };
  }

  function renderFull(d) {
    var g = d.top.general;
    var cv;
    var src;
    try {
      cv = newCanvas();
      src = root.SG.Crest.dataUri(g);
    } catch (e) {
      return Promise.reject(fail('draw-exception', e));
    }
    return loadImage(src).then(function (img) {
      try {
        var fonts = root.SG.Util.fonts;
        drawBackground(cv.ctx);
        cv.ctx.drawImage(img, 225, 300, 630, 840);
        drawPanelFrame(cv.ctx);
        drawTexts(cv.ctx, d, fonts.serif, fonts.sans);
      } catch (e) {
        throw fail('draw-exception', e);
      }
      // 汚染(taint)の検知: 汚染されていれば getImageData が SecurityError を投げる
      try { cv.ctx.getImageData(0, 0, 1, 1); } catch (e) { throw fail('tainted', e); }
      return exportCanvas(cv.canvas);
    });
  }

  function renderPrimitive(d) {
    return new Promise(function (resolve) {
      var cv = newCanvas();
      drawBackground(cv.ctx);
      drawPrimitivePanel(cv.ctx, d.top.general);
      drawPanelFrame(cv.ctx);
      drawTexts(cv.ctx, d, 'serif', 'sans-serif');
      resolve(exportCanvas(cv.canvas));
    });
  }

  function finish(out, usedFallback, reason) {
    var previewSrc = out.dataUrl;
    if (out.dataUrl.length > PREVIEW_BLOB_THRESHOLD && out.blob) { previewSrc = trackUrl(out.blob); }
    var result = { blob: out.blob, dataUrl: out.dataUrl, previewSrc: previewSrc, usedFallback: usedFallback, reason: reason };
    var size = 'bytes=' + (out.blob ? out.blob.size : 'null') + ' dataUrlLength=' + out.dataUrl.length;
    if (usedFallback) { console.warn('ShareCard: usedFallback=true reason=' + reason + ' ' + size); }
    else { console.info('ShareCard: usedFallback=false ' + size); }
    return result;
  }

  // diagnosis: SG.Diagnosis.diagnose() の戻り値 → Promise<{ blob, dataUrl, previewSrc, usedFallback, reason }>
  function generate(d) {
    return renderFull(d).then(function (out) {
      return finish(out, false, null);
    }, function (e) {
      var code = e && e.code ? e.code : 'draw-exception';
      return renderPrimitive(d).then(function (out) { return finish(out, true, code); });
    }).catch(function (e) {
      console.error('ShareCard: failed ' + (e && e.message ? e.message : String(e)));
      throw e;
    });
  }

  // 自動ダウンロード。blob があれば blob URL(30 秒後に revoke)、なければ dataUrl を使う
  function download(result, filename) {
    var href = result.blob ? trackUrl(result.blob) : result.dataUrl;
    var a = root.document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    a.hidden = true;
    root.document.body.appendChild(a);
    a.click();
    root.document.body.removeChild(a);
    if (result.blob) {
      var t = root.setTimeout(function () {
        revokeTimers = revokeTimers.filter(function (x) { return x !== t; });
        revoke(href);
      }, REVOKE_AFTER_MS);
      revokeTimers.push(t);
    }
  }

  // 未 revoke の blob URL をすべて revoke し、保留中のタイマーを解除する(何度呼んでもよい)
  function dispose() {
    revokeTimers.forEach(function (t) { root.clearTimeout(t); });
    revokeTimers = [];
    urls.slice().forEach(revoke);
  }

  SG.ShareCard = { generate: generate, download: download, dispose: dispose };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.ShareCard; }
})(typeof window !== 'undefined' ? window : globalThis);
