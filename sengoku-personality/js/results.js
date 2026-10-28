/*
 * results.js — SG.Results
 * 結果画面・TOP3・20 人一覧・武将詳細ダイアログ・ランキング画面・確認ダイアログ・画像プレビューの DOM を描く(表示専用)。
 * 状態(answers・ランキング加算など)は持たない。状態の持ち主は app.js。
 * 3 つのダイアログ(#dlg-general / #dlg-confirm / #dlg-card)の DOM・イベント・フォーカス戻しは、このファイルが唯一の所有者。
 * データ由来の文字列は必ず SG.Util.esc() を通す。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  function esc(s) { return root.SG.Util.esc(s); }
  function doc() { return root.document; }
  function byId(id) { return doc().getElementById(id); }

  var DISCLAIMER = '※ 本アプリはエンターテインメント用の診断です。歴史上の人物の性格を科学的に判定するものではありません。' +
    '類似度は心理学的な確率ではなく、アプリ内の特徴量モデルにおける近さを示す数値です。';
  var REASON_NOTE = '※ 武将の紹介は一般的な史実の説明、診断の数値と解釈はアプリ独自の仮想モデルです。';

  // ---- root ごとのクリックハンドラ(イベント委譲)。描き直すたびに張り替え、二重に登録しない ----
  var bindings = [];
  function bind(el, type, handler) {
    bindings.push({ el: el, type: type, handler: handler });
    el.addEventListener(type, handler);
  }
  function unbindAll(el) {
    bindings = bindings.filter(function (b) {
      if (b.el === el) { b.el.removeEventListener(b.type, b.handler); return false; }
      return true;
    });
  }

  // カウントアップ用の requestAnimationFrame(clear で取り消す)
  var raf = { id: null, root: null };
  function cancelCountUp() {
    if (raf.id !== null && typeof root.cancelAnimationFrame === 'function') { root.cancelAnimationFrame(raf.id); }
    raf.id = null;
    raf.root = null;
  }

  // ---- 武将の画像(実画像があれば <img>、なければ家紋風の代替カード SVG) ----
  function crestHtml(g) {
    var label = g.name + 'の家紋風イメージ';
    return '<div class="portrait" role="img" aria-label="' + esc(label) + '">' +
      root.SG.Crest.svg(g, { idPrefix: root.SG.Util.uid('c'), title: label }) + '</div>';
  }
  function portraitHtml(g) {
    if (g.image) {
      return '<div class="portrait"><img src="' + esc(g.image) + '" alt="' + esc(g.name + 'の肖像イメージ') +
        '" data-fallback-id="' + esc(g.id) + '"></div>';
    }
    return crestHtml(g);
  }
  // <img> の読み込みに失敗したら、同じ場所を代替カードに差し替える(静かに回復する)
  function attachImageFallback(container) {
    var imgs = container.querySelectorAll('img[data-fallback-id]');
    Array.prototype.forEach.call(imgs, function (img) {
      img.addEventListener('error', function () {
        var g = findGeneral(img.getAttribute('data-fallback-id'));
        var wrap = img.parentNode;
        if (!g || !wrap || !wrap.parentNode) { return; }
        var tmp = doc().createElement('div');
        tmp.innerHTML = crestHtml(g);
        wrap.parentNode.replaceChild(tmp.firstChild, wrap);
      });
    });
  }

  function findGeneral(id) {
    var list = root.SG.Generals;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function pctText(row) { return row.similarityExact.toFixed(1) + '%'; }
  function pctLabel(row) { return '類似度' + row.similarityExact.toFixed(1) + 'パーセント'; }

  // ---- 相性診断の節(結果確定後の追加表示のみ。診断結果・ランキング・保存データには何も書かない) ----
  // 相性カードは [data-general-id] と .btn-detail を持つので、既存の委譲ハンドラが武将詳細ダイアログを開く
  function compatCardHtml(p, extraClass, kindLabel, pctHtml) {
    var rg = p.general;
    return '<li class="compat-card' + extraClass + '" data-general-id="' + esc(rg.id) + '">' +
      '<div class="compat-img">' + portraitHtml(rg) + '</div>' +
      '<div class="compat-body">' +
        '<span class="compat-name">' + esc(rg.name) + '</span>' +
        (kindLabel ? '<span class="compat-kind">' + esc(kindLabel) + '</span>' : '') +
        pctHtml +
        '<p class="compat-reason">' + esc(p.reason) + '</p>' +
        '<button type="button" class="btn-detail" aria-label="' + esc(rg.name + 'をくわしく見る') + '">くわしく見る</button>' +
      '</div>' +
    '</li>';
  }
  function compatHtml(diagnosis) {
    var Compat = root.SG.Compat;
    if (!Compat || typeof Compat.build !== 'function') { return ''; } // 相性が読めない環境では従来の画面にする
    var c = Compat.build(diagnosis);
    var partners = c.partners.map(function (p) {
      var pct = '<span class="compat-pct" aria-label="' + esc('相性度' + p.percent + 'パーセント') + '">' +
        '<span aria-hidden="true">相性度 <strong>' + p.percent + '</strong>%</span></span>';
      return compatCardHtml(p, '', p.label, pct);
    }).join('');
    var stim = c.stimulus ? '<h4 class="compat-sub">ちょっと刺激をくれる相手</h4>' +
      '<ol class="compat-list compat-list-stimulus">' + compatCardHtml(c.stimulus, ' compat-stimulus', '', '') + '</ol>' : '';
    var typeBlocks = '<div class="compat-type"><dt>補い合えるタイプ</dt>' +
      c.types.complement.map(function (t) { return '<dd>' + esc(t) + '</dd>'; }).join('') + '</div>' +
      '<div class="compat-type"><dt>気が合うタイプ</dt><dd>' + esc(c.types.same) + '</dd></div>';
    return '<section class="result-section compat" aria-labelledby="sec-compat">' +
      '<h3 id="sec-compat" class="section-title">あなたと相性の良い武将・性格タイプ</h3>' +
      '<h4 class="compat-sub">相性の良い武将</h4>' +
      '<ol class="compat-list">' + partners + '</ol>' +
      stim +
      '<h4 class="compat-sub">相性の良い性格タイプ</h4>' +
      '<dl class="compat-types">' + typeBlocks + '</dl>' +
      (c.types.balanced ? '<p class="compat-balanced">' + esc(c.types.balancedText) + '</p>' : '') +
      '<h4 class="compat-sub">こんなとき、こんな人</h4>' +
      '<ul class="compat-scenes">' + c.scenes.map(function (s) {
        return '<li><span class="compat-scene-label">' + esc(s.label) + '</span><span class="compat-scene-text">' + esc(s.text) + '</span></li>';
      }).join('') + '</ul>' +
      '<details class="compat-how"><summary>相性度のしくみ</summary>' +
        '<p>診断用の性格モデルで、6つの性格パラメータの「近さ」(気が合う度合い)と「補完」(あなたの苦手な面を補ってくれる度合い)を同じ重さで合わせて計算しています。</p>' +
        '<p>診断結果であなたに一番近かった武将は「似ている武将」で紹介済みなので、ここには出てきません。</p>' +
        '<p>この相性は結果の表示だけに使われ、診断結果や集計には影響しません。</p>' +
      '</details>' +
      '<p class="note compat-note">' + esc(c.note) + '</p>' +
    '</section>';
  }

  // ---- 結果画面 ----
  // root: #result-root、diagnosis: SG.Diagnosis.diagnose() の戻り値
  // handlers: { onSaveCard, onShowRanking, onRestart }、options: { countUpMs, reducedMotion }
  function showResult(rootEl, diagnosis, handlers, options) {
    clear(rootEl);
    options = options || {};
    var top = diagnosis.top;
    var g = top.general;
    var reason = root.SG.Reason.build(diagnosis.user, g);
    var nameChars = Array.from ? Array.from(g.name) : String(g.name).split('');

    var html = '<div class="result">' +
      '<p class="result-lead">あなたに最も似ている戦国武将は……</p>' +
      '<div class="result-main">' +
        '<div class="result-hero"><div class="gold-frame">' + portraitHtml(g) + '</div></div>' +
        '<div class="result-info">' +
          '<h2 class="general-name" id="result-heading" tabindex="-1" aria-label="' + esc(g.name) + '">' +
            nameChars.map(function (ch, i) {
              return '<span class="ch" aria-hidden="true" style="animation-delay:' + (300 + i * 80) + 'ms">' + esc(ch) + '</span>';
            }).join('') +
          '</h2>' +
          '<p class="result-sim" aria-label="' + esc('類似度' + top.similarity + 'パーセント') + '">' +
            '<span class="sim-label" aria-hidden="true">類似度</span> <span class="sim-num" aria-hidden="true">0</span>' +
            '<span class="sim-unit" aria-hidden="true">%</span></p>' +
          '<p class="result-type">「' + esc(g.title) + '」タイプ</p>' +
          '<p class="result-desc">' + esc(g.description) + '</p>' +
        '</div>' +
      '</div>' +

      '<section class="result-section" aria-labelledby="sec-analysis">' +
        '<h3 id="sec-analysis" class="section-title">あなたの性格分析</h3>' +
        '<div class="analysis"><div class="analysis-bars"></div><div class="radar"></div></div>' +
      '</section>' +

      '<section class="result-section" aria-labelledby="sec-reason">' +
        '<h3 id="sec-reason" class="section-title">あなたと' + esc(g.name) + 'が似ている理由</h3>' +
        '<div class="reason">' + reason.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
        '<p class="note">' + esc(REASON_NOTE) + '</p>' +
      '</section>' +

      compatHtml(diagnosis) +

      '<section class="result-section" aria-labelledby="sec-top3">' +
        '<h3 id="sec-top3" class="section-title">あなたに似ている武将 TOP3</h3>' +
        '<ol class="top3">' + diagnosis.top3.map(function (row) {
          var rg = row.general;
          return '<li class="top3-card rank-' + row.rank + '" data-general-id="' + esc(rg.id) + '">' +
            '<span class="top3-rank">' + row.rank + '位</span>' +
            '<div class="top3-img">' + portraitHtml(rg) + '</div>' +
            '<div class="top3-body">' +
              '<span class="top3-name">' + esc(rg.name) + '</span>' +
              '<span class="top3-pct" aria-label="' + esc(pctLabel(row)) + '">' + esc(pctText(row)) + '</span>' +
              '<button type="button" class="btn-detail" aria-label="' + esc(rg.name + 'をくわしく見る') + '">くわしく見る</button>' +
            '</div>' +
          '</li>';
        }).join('') + '</ol>' +
        '<details class="all-list">' +
          '<summary>20人すべての結果を見る</summary>' +
          '<ol class="all-rows">' + diagnosis.ranking.map(function (row) {
            var rg = row.general;
            return '<li class="all-row" data-general-id="' + esc(rg.id) + '">' +
              '<span class="all-rank">' + row.rank + '位</span>' +
              '<span class="all-name">' + esc(rg.name) + '</span>' +
              '<span class="all-bar" aria-hidden="true"><span style="width:' + row.similarityExact.toFixed(1) + '%"></span></span>' +
              '<span class="all-pct" aria-label="' + esc(pctLabel(row)) + '">' + esc(pctText(row)) + '</span>' +
              '<button type="button" class="btn-detail btn-detail-sm" aria-label="' + esc(rg.name + 'をくわしく見る') + '">くわしく</button>' +
            '</li>';
          }).join('') + '</ol>' +
        '</details>' +
      '</section>' +

      '<div class="result-actions">' +
        '<button type="button" class="btn btn-primary" data-action="save">結果を画像で保存</button>' +
        '<button type="button" class="btn btn-ranking" data-action="ranking">みんなの結果ランキング</button>' +
        '<button type="button" class="btn btn-sub" data-action="zukan">戦国武将図鑑を見る</button>' +
        '<button type="button" class="btn btn-sub" data-action="restart">最初に戻る</button>' +
      '</div>' +
      '<p class="disclaimer">' + esc(DISCLAIMER) + '</p>' +
      '</div>';

    rootEl.innerHTML = html;
    attachImageFallback(rootEl);
    root.SG.Chart.renderBars(rootEl.querySelector('.analysis-bars'), diagnosis.user);
    root.SG.Chart.renderRadar(rootEl.querySelector('.radar'), diagnosis.user, g);

    // クリックは root に付けた 1 つのハンドラで受ける(イベント委譲)
    bind(rootEl, 'click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      var act = t.closest('[data-action]');
      if (act && rootEl.contains(act)) {
        if (act.disabled) { return; }
        var name = act.getAttribute('data-action');
        if (name === 'save' && handlers && handlers.onSaveCard) { handlers.onSaveCard(); }
        else if (name === 'ranking' && handlers && handlers.onShowRanking) { handlers.onShowRanking(); }
        else if (name === 'zukan' && handlers && handlers.onShowZukan) { handlers.onShowZukan(); }
        else if (name === 'restart' && handlers && handlers.onRestart) { handlers.onRestart(); }
        return;
      }
      var card = t.closest('[data-general-id]');
      if (card && rootEl.contains(card)) {
        var cg = findGeneral(card.getAttribute('data-general-id'));
        if (cg) { openGeneralDialog(cg, card.querySelector('.btn-detail'), diagnosis.user); }
      }
    });

    startCountUp(rootEl, top.similarity, options);
  }

  // 大見出しの類似度を 0 → 実値(整数)へカウントアップする。reducedMotion のときは即時に表示する
  function startCountUp(rootEl, target, options) {
    var el = rootEl.querySelector('.sim-num');
    var ms = Number(options.countUpMs);
    if (!el) { return; }
    if (options.reducedMotion || !(ms > 0) || typeof root.requestAnimationFrame !== 'function') {
      el.textContent = String(target);
      return;
    }
    var start = null;
    raf.root = rootEl;
    function step(ts) {
      if (start === null) { start = ts; }
      var p = Math.min(1, (ts - start) / ms);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(p >= 1 ? target : Math.floor(target * eased));
      if (p < 1) { raf.id = root.requestAnimationFrame(step); } else { raf.id = null; raf.root = null; }
    }
    raf.id = root.requestAnimationFrame(step);
  }

  // 「結果を画像で保存」ボタンの表示切替(ボタンがなければ何もしない)
  function setSaveBusy(rootEl, busy) {
    if (!rootEl) { return; }
    var btn = rootEl.querySelector('[data-action="save"]');
    if (!btn) { return; }
    btn.disabled = !!busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.textContent = busy ? '作成中…' : '結果を画像で保存';
  }

  // ---- ダイアログ共通 ----
  // showModal が使えない・例外を投げる環境では open 属性を直接付ける
  function openDialog(dlg) {
    try {
      if (typeof dlg.showModal !== 'function') { throw new Error('showModal unsupported'); }
      dlg.showModal();
    } catch (e) {
      if (typeof console !== 'undefined') { console.warn('Results: showModal が使えないため open 属性で表示します'); }
      dlg.setAttribute('open', '');
    }
  }
  function closeDialog(dlg, value) {
    if (typeof dlg.close === 'function') { dlg.close(value); } else { dlg.removeAttribute('open'); }
  }
  function restoreFocus(el) {
    if (el && doc().contains(el) && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); }
    }
  }
  var dialogsBound = {};

  // ---- 武将詳細ダイアログ(#dlg-general) ----
  var generalOpener = null;
  var generalNav = null;  // 図鑑から開いたときの前/次の状態(閉じたら捨てる)
  var generalUser = undefined; // 開いたときのユーザー値(前/次で差し替えても同じ扱いにする)
  function bindGeneralDialog(dlg) {
    if (dialogsBound.general) { return; }
    dialogsBound.general = true;
    dlg.addEventListener('click', function (ev) {
      // dialog 自身がクリックされた = 背景(::backdrop)のクリック
      if (ev.target === dlg) { closeDialog(dlg); return; }
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      if (t.closest('.dlg-close')) { closeDialog(dlg); return; }
      var navBtn = t.closest('[data-nav]');
      if (navBtn && dlg.contains(navBtn) && !navBtn.disabled) { stepGeneralDialog(dlg, navBtn.getAttribute('data-nav')); }
    });
    dlg.addEventListener('close', function () {
      if (dlg.open) { return; } // すでに開き直されている
      dlg.replaceChildren();
      generalNav = null;
      generalUser = undefined;
      var opener = generalOpener;
      generalOpener = null;
      restoreFocus(opener);
    });
  }

  function listHtml(items) {
    return '<ul>' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  }

  // 前/次ボタン(図鑑から開いたときだけ表示)の HTML。端では disabled にして、ループさせない
  function navHtml(nav) {
    var atFirst = nav.index <= 0;
    var atLast = nav.index >= nav.total - 1;
    return '<div class="dlg-nav">' +
      '<button type="button" class="btn btn-sub dlg-nav-btn" data-nav="prev"' + (atFirst ? ' disabled aria-disabled="true"' : '') + '>前の武将</button>' +
      '<span class="dlg-nav-count">' + (nav.index + 1) + ' / ' + nav.total + '</span>' +
      '<button type="button" class="btn btn-sub dlg-nav-btn" data-nav="next"' + (atLast ? ' disabled aria-disabled="true"' : '') + '>次の武将</button>' +
      '</div>' +
      // 切り替え後の武将名をスクリーンリーダーへ知らせる(中身は切り替えのたびに入れる)
      '<p class="visually-hidden" role="status" aria-live="polite" data-role="nav-live"></p>';
  }

  // ダイアログの中身を組み立てる。nav があれば前/次ボタンを付ける(省略時は従来どおり)
  function fillGeneralDialog(dlg, general, userValues, nav) {
    var hid = root.SG.Util.uid('dlg-g');
    dlg.setAttribute('aria-labelledby', hid);
    dlg.innerHTML = '<div class="dlg-body">' +
      '<button type="button" class="dlg-close">閉じる</button>' +
      (nav ? navHtml(nav) : '') +
      '<div class="dlg-head">' +
        '<div class="dlg-portrait gold-frame gold-frame-sm">' + portraitHtml(general) + '</div>' +
        '<div class="dlg-titles"><h2 id="' + hid + '" class="dlg-name">' + esc(general.name) + '</h2>' +
        '<p class="dlg-type">「' + esc(general.title) + '」タイプ</p></div>' +
      '</div>' +
      '<dl class="dlg-facts">' +
        '<dt>生没年</dt><dd>' + esc(general.lifespan) + '</dd>' +
        '<dt>活躍した地域</dt><dd>' + esc(general.region) + '</dd>' +
      '</dl>' +
      '<p class="dlg-desc">' + esc(general.description) + '</p>' +
      '<h3>主な功績</h3>' + listHtml(general.achievements) +
      '<h3>有名な出来事</h3>' + listHtml(general.events) +
      '<h3>診断用の性格イメージ</h3><p>' + esc(general.imageOfType) + '</p>' +
      '<h3>診断用パラメータ</h3><div class="dlg-params"></div>' +
      '<p class="note">※ 史実の説明は一般的な通説に基づく要約です。逸話や諸説のあるものは断定していません。</p>' +
      '</div>';
    attachImageFallback(dlg);
    root.SG.Chart.renderMiniBars(dlg.querySelector('.dlg-params'), general, userValues);
  }

  // general: 武将データ、opener: 閉じたときにフォーカスを戻す要素、userValues: 丸め前のユーザー 6 値
  // options.nav: { index, total, onPrev(), onNext() }(図鑑用。onPrev/onNext は { general, index, opener } か null を返す)
  function openGeneralDialog(general, opener, userValues, options) {
    var dlg = byId('dlg-general');
    if (!dlg) { return; }
    if (dlg.open) { return; } // 二重に開かない
    bindGeneralDialog(dlg);
    generalOpener = opener || doc().activeElement;
    generalNav = options && options.nav ? options.nav : null;
    generalUser = userValues;
    fillGeneralDialog(dlg, general, userValues, generalNav);
    openDialog(dlg);
    var closeBtn = dlg.querySelector('.dlg-close');
    if (closeBtn) { closeBtn.focus(); }
  }

  // 前/次の押下: ダイアログは閉じず、中身だけを隣の武将に差し替える
  function stepGeneralDialog(dlg, dir) {
    var nav = generalNav;
    if (!nav) { return; }
    var next = dir === 'prev' ? nav.onPrev() : nav.onNext();
    if (!next || !next.general) { return; }
    nav.index = next.index;
    if (next.opener) { generalOpener = next.opener; } // 閉じたときは今見ている武将のカードへ戻る
    fillGeneralDialog(dlg, next.general, generalUser, nav);
    dlg.scrollTop = 0;
    var body = dlg.querySelector('.dlg-body');
    if (body) { body.scrollTop = 0; }
    var live = dlg.querySelector('[data-role="nav-live"]');
    if (live) { live.textContent = next.general.name + '(' + (nav.index + 1) + ' / ' + nav.total + ')'; }
    // フォーカスは押したのと同じ方向のボタンへ。端で無効なら閉じるボタンへ
    var btn = dlg.querySelector('[data-nav="' + dir + '"]');
    if (!btn || btn.disabled) { btn = dlg.querySelector('.dlg-close'); }
    if (btn) { btn.focus(); }
  }

  // ---- 確認ダイアログ(#dlg-confirm) ----
  var pendingConfirm = null; // { resolve, opener, done, openedAt }
  function finishConfirm(value) {
    var p = pendingConfirm;
    if (!p || p.done) { return; }
    p.done = true;
    pendingConfirm = null;
    var dlg = byId('dlg-confirm');
    if (dlg && dlg.open) { closeDialog(dlg, value ? 'ok' : 'cancel'); }
    if (dlg) { dlg.replaceChildren(); }
    restoreFocus(p.opener);
    p.resolve(value);
  }
  function bindConfirmDialog(dlg) {
    if (dialogsBound.confirm) { return; }
    dialogsBound.confirm = true;
    dlg.addEventListener('click', function (ev) {
      if (ev.target === dlg) {
        // 背景クリック = キャンセル。ただし開いた直後(ダブルクリックの 2 回目)は誤って閉じないよう無視する
        if (pendingConfirm && Date.now() - pendingConfirm.openedAt < pendingConfirm.backdropGuardMs) { return; }
        finishConfirm(false); return;
      }
      var t = ev.target;
      var btn = t && typeof t.closest === 'function' ? t.closest('[data-confirm]') : null;
      if (btn) { finishConfirm(btn.getAttribute('data-confirm') === 'ok'); }
    });
    // Esc = キャンセル(既定の閉じ方を止めて、同じ処理を通す)
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); finishConfirm(false); });
    dlg.addEventListener('close', function () { if (!dlg.open) { finishConfirm(false); } });
    // フォーカストラップ: Tab / Shift+Tab はダイアログ内の 2 つのボタンだけを巡回する
    // (showModal が使えず open 属性で開いた場合でも背景へ出ないようにする)
    dlg.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') { return; }
      var btns = dlg.querySelectorAll('button[data-confirm]');
      if (btns.length === 0) { return; }
      var first = btns[0];
      var last = btns[btns.length - 1];
      var active = doc().activeElement;
      if (ev.shiftKey && (active === first || !dlg.contains(active) || active === dlg)) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && (active === last || !dlg.contains(active) || active === dlg)) {
        ev.preventDefault(); first.focus();
      }
    });
  }

  // { message, okLabel, cancelLabel } → Promise<boolean>。true は okLabel のボタンを押したときだけ
  // cancelLabel を省略すると「キャンセル」。初期フォーカスは常に安全側(キャンセル側)
  // backdropGuardMs: 開いてからこの時間(ms)は背景クリックを無視する(ダブルクリックの 2 回目で閉じないため。省略時は 0)
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dlg = byId('dlg-confirm');
      if (!dlg) { resolve(false); return; }
      if (pendingConfirm) { finishConfirm(false); }
      bindConfirmDialog(dlg);
      var mid = root.SG.Util.uid('dlg-c');
      pendingConfirm = { resolve: resolve, opener: doc().activeElement, done: false, openedAt: Date.now(), backdropGuardMs: Number(opts.backdropGuardMs) > 0 ? Number(opts.backdropGuardMs) : 0 };
      dlg.setAttribute('aria-labelledby', mid);
      dlg.innerHTML = '<div class="dlg-body">' +
        '<p id="' + mid + '" class="confirm-msg">' + esc(opts.message || '') + '</p>' +
        '<div class="confirm-actions">' +
          '<button type="button" class="btn btn-sub" data-confirm="cancel">' + esc(opts.cancelLabel || 'キャンセル') + '</button>' +
          '<button type="button" class="btn btn-danger" data-confirm="ok">' + esc(opts.okLabel || 'OK') + '</button>' +
        '</div></div>';
      openDialog(dlg);
      // 初期フォーカスは JS で「キャンセル」に当てる(autofocus 属性には頼らない)
      var cancelBtn = dlg.querySelector('[data-confirm="cancel"]');
      if (cancelBtn) { cancelBtn.focus(); }
    });
  }

  // ---- 画像のプレビュー(#dlg-card) ----
  var card = null; // { onClosed, opener, done }
  // 閉じる処理の本体(冪等。2 回目以降は何もしない)
  function closeCardInternal() {
    var c = card;
    if (!c || c.done) { return; }
    c.done = true;
    card = null;
    var dlg = byId('dlg-card');
    if (dlg) {
      var img = dlg.querySelector('img');
      if (img) { img.removeAttribute('src'); } // img.src = '' はページ自身を再取得するブラウザがあるので使わない
      dlg.replaceChildren();
    }
    if (c.onClosed) { c.onClosed(); }
    if (dlg && dlg.open) { closeDialog(dlg); }
    restoreFocus(c.opener);
  }
  function bindCardDialog(dlg) {
    if (dialogsBound.card) { return; }
    dialogsBound.card = true;
    dlg.addEventListener('click', function (ev) {
      if (ev.target === dlg) { closeCardInternal(); return; }
      var t = ev.target;
      if (t && typeof t.closest === 'function' && t.closest('.dlg-close')) { closeCardInternal(); }
    });
    dlg.addEventListener('close', function () { if (!dlg.open) { closeCardInternal(); } });
  }

  // result: SG.ShareCard.generate() の戻り値。handlers: { onClosed, filename, opener(閉じたときのフォーカスの戻し先。任意) }
  function openCardPreview(result, handlers) {
    handlers = handlers || {};
    closeCardPreview(); // 前回のプレビューが残っていれば先に破棄する
    var dlg = byId('dlg-card');
    if (!dlg) { return; }
    bindCardDialog(dlg);
    // 生成中は保存ボタンが無効になりフォーカスが外れているので、戻し先は呼び出し側から受け取る
    var opener = handlers.opener || doc().activeElement;
    var hid = root.SG.Util.uid('dlg-k');
    dlg.setAttribute('aria-labelledby', hid);
    dlg.innerHTML = '<div class="dlg-body">' +
      '<button type="button" class="dlg-close">閉じる</button>' +
      '<h2 id="' + hid + '" class="dlg-name">診断結果の画像</h2>' +
      '<div class="card-preview"><img alt="診断結果の画像(武将名・類似度・性格タイプ・6つの性格パラメータ)"></div>' +
      '<p class="card-hint">保存されない場合は、画像を長押し(または右クリック)して保存してください。</p>' +
      '<p class="card-actions"><a class="btn btn-primary card-save">保存</a></p>' +
      '</div>';
    var src = result.previewSrc || result.dataUrl;
    dlg.querySelector('img').setAttribute('src', src);
    var a = dlg.querySelector('.card-save');
    a.setAttribute('href', src);
    a.setAttribute('download', handlers.filename || 'sengoku-result.png');
    card = { onClosed: handlers.onClosed, opener: opener, done: false };
    openDialog(dlg);
    var closeBtn = dlg.querySelector('.dlg-close');
    if (closeBtn) { closeBtn.focus(); }
  }

  // #dlg-card が開いていれば閉じる(開いていなければ何もしない。onClosed も呼ばない)
  function closeCardPreview() { closeCardInternal(); }

  // 開いているダイアログをすべて閉じる(reset() が使う)
  function closeAllDialogs() {
    var g = byId('dlg-general');
    if (g && g.open) {
      generalOpener = null; // リセット時はフォーカスを戻さない
      generalNav = null;
      closeDialog(g);
      g.replaceChildren();
    }
    finishConfirm(false);
    closeCardPreview();
  }

  // ---- ランキング画面 ----
  function dateLabel(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    if (!m) { return String(key); }
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  // root: #ranking-root、store: SG.Storage のストア、handlers: { onBack }
  function renderRankingScreen(rootEl, store, handlers) {
    clear(rootEl);
    var view = { scope: 'today', date: null, showAll: false };
    var tabs = [
      { scope: 'today', label: '本日' },
      { scope: 'date', label: '日付別' },
      { scope: 'total', label: '累計' }
    ];
    var pid = root.SG.Util.uid('rank');

    rootEl.innerHTML = '<div class="ranking">' +
      '<h2 class="ranking-title" tabindex="-1"></h2>' +
      '<div class="tabs" role="tablist" aria-label="集計の範囲">' + tabs.map(function (t) {
        return '<button type="button" role="tab" class="tab" id="' + pid + '-tab-' + t.scope + '" data-scope="' + t.scope + '"' +
          ' aria-controls="' + pid + '-panel">' + esc(t.label) +
          (t.scope === 'today' ? '<small class="tab-date">' + esc(dateLabel(store.todayKey())) + '</small>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="ranking-panel" id="' + pid + '-panel" role="tabpanel"></div>' +
      '<p class="note">集計はこの端末・このブラウザの中だけに保存され、他の端末とは共有されません。</p>' +
      (store.isPersistent() ? '' : '<p class="warn-text">この環境では集計を保存できません(このページを閉じると消えます)。</p>') +
      '<div class="ranking-actions"><button type="button" class="btn" data-action="back">戻る</button></div>' +
      '<details class="staff-menu"><summary>運営用メニュー</summary>' +
        '<p>展示担当者向けの操作です。</p>' +
        '<button type="button" class="btn-staff" data-action="reset">集計をリセット</button>' +
      '</details>' +
      '</div>';

    var titleEl = rootEl.querySelector('.ranking-title');
    var panel = rootEl.querySelector('.ranking-panel');

    function draw() {
      var dates = store.listDates();
      if (view.scope === 'date' && (view.date === null || dates.indexOf(view.date) < 0)) { view.date = dates.length ? dates[0] : null; }
      var key = view.scope === 'date' ? view.date : view.scope;
      titleEl.textContent = view.scope === 'today' ? '本日の戦国武将ランキング'
        : view.scope === 'total' ? '戦国武将ランキング(累計)'
        : '戦国武将ランキング(' + (view.date ? dateLabel(view.date) : '日付別') + ')';
      Array.prototype.forEach.call(rootEl.querySelectorAll('[role="tab"]'), function (b) {
        var on = b.getAttribute('data-scope') === view.scope;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
        if (on) { panel.setAttribute('aria-labelledby', b.id); }
      });

      var html = '';
      if (view.scope === 'date' && dates.length) {
        html += '<label class="date-pick"><span>日付</span><select aria-label="日付を選ぶ">' + dates.map(function (d) {
          return '<option value="' + esc(d) + '"' + (d === view.date ? ' selected' : '') + '>' +
            esc(dateLabel(d) + '(' + store.getTotalPlayers(d) + '人)') + '</option>';
        }).join('') + '</select></label>';
      }
      var counts = key ? store.getCounts(key) : [];
      if (!counts.length) {
        html += '<p class="empty">まだ診断結果がありません</p>';
      } else {
        var total = counts.reduce(function (s, r) { return s + r.count; }, 0);
        var max = counts[0].count;
        var shown = view.showAll ? counts : counts.slice(0, 10);
        html += '<p class="ranking-total">診断人数 <strong>' + total + '</strong>人</p>';
        html += '<ol class="ranking-list">' + shown.map(function (r, i) {
          var g = findGeneral(r.id);
          var name = g ? g.name : r.id;
          return '<li class="ranking-row"><span class="ranking-text">' + esc((i + 1) + '位 ' + name + '型　' + r.count + '人') + '</span>' +
            '<span class="ranking-bar" aria-hidden="true"><span style="width:' + (Math.round(r.count / max * 1000) / 10) + '%"></span></span></li>';
        }).join('') + '</ol>';
        if (!view.showAll && counts.length > 10) {
          html += '<button type="button" class="btn btn-sub btn-small" data-action="show-all">すべて表示</button>';
        }
      }
      panel.innerHTML = html;
    }

    bind(rootEl, 'click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      var tab = t.closest('[role="tab"]');
      if (tab && rootEl.contains(tab)) {
        view.scope = tab.getAttribute('data-scope');
        view.showAll = false;
        draw();
        return;
      }
      var act = t.closest('[data-action]');
      if (!act || !rootEl.contains(act)) { return; }
      var name = act.getAttribute('data-action');
      if (name === 'back') {
        if (handlers && handlers.onBack) { handlers.onBack(); }
      } else if (name === 'show-all') {
        view.showAll = true;
        draw();
      } else if (name === 'reset') {
        confirm({ message: '集計をすべて消します。この操作は取り消せません。', okLabel: 'リセットする' }).then(function (ok) {
          if (!ok || !rootEl.contains(panel)) { return; }
          store.reset();
          view.date = null;
          draw();
        });
      }
    });
    // タブのキーボード操作(WAI-ARIA の tabs パターン)。
    // 非選択タブは tabindex=-1 なので、←→ / Home / End でタブを切り替え、新しいタブにフォーカスを移す
    bind(rootEl, 'keydown', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      var tab = t.closest('[role="tab"]');
      if (!tab || !rootEl.contains(tab)) { return; }
      var cur = -1;
      tabs.forEach(function (x, i) { if (x.scope === tab.getAttribute('data-scope')) { cur = i; } });
      var next;
      if (ev.key === 'ArrowRight') { next = (cur + 1) % tabs.length; }
      else if (ev.key === 'ArrowLeft') { next = (cur - 1 + tabs.length) % tabs.length; }
      else if (ev.key === 'Home') { next = 0; }
      else if (ev.key === 'End') { next = tabs.length - 1; }
      else { return; }
      ev.preventDefault();
      view.scope = tabs[next].scope;
      view.showAll = false;
      draw();
      var nb = rootEl.querySelector('[role="tab"][data-scope="' + view.scope + '"]');
      if (nb) { nb.focus(); }
    });
    bind(rootEl, 'change', function (ev) {
      var t = ev.target;
      if (t && t.tagName === 'SELECT' && rootEl.contains(t)) {
        view.date = t.value;
        view.showAll = false;
        draw();
        var sel = rootEl.querySelector('select');
        if (sel) { sel.focus(); }
      }
    });

    draw();
  }

  // root の中身を空にする(結果 DOM・ランキング DOM の破棄)。保留中のカウントアップも取り消す
  function clear(rootEl) {
    if (!rootEl) { return; }
    if (raf.root === rootEl || raf.root === null) { cancelCountUp(); }
    unbindAll(rootEl);
    rootEl.replaceChildren();
  }

  SG.Results = {
    showResult: showResult,
    setSaveBusy: setSaveBusy,
    openGeneralDialog: openGeneralDialog,
    portraitHtml: portraitHtml,
    attachImageFallback: attachImageFallback,
    renderRankingScreen: renderRankingScreen,
    confirm: confirm,
    openCardPreview: openCardPreview,
    closeCardPreview: closeCardPreview,
    closeAllDialogs: closeAllDialogs,
    clear: clear
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Results; }
})(typeof window !== 'undefined' ? window : globalThis);
