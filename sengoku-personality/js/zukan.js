/*
 * zukan.js — SG.Zukan
 * 「戦国武将図鑑」(診断をしなくても武将の情報を見られる画面)の DOM を描く(表示専用)。
 * 武将データは SG.Generals(js/generals.js)を読むだけで、複製や追加はしない(唯一の情報源)。
 * 詳細表示は SG.Results.openGeneralDialog を再利用する(UI の二重管理をしない)。
 * 受け取るのは画面遷移のコールバック { onBack, onStart } だけで、集計や回答の状態には一切触れない。
 * ロード時に DOM には触れない。武将名などの文字列は必ず SG.Util.esc() を通す。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  function esc(s) { return root.SG.Util.esc(s); }

  // 読み(ひらがな)の五十音順に並べた新しい配列を返す純粋関数(元の配列は変更しない)。
  // Intl.Collator は環境差が出るため使わず、ひらがなの文字コード順(濁音は清音の直後)で比べる。
  // 読みが同じなら generals.js の配列順を保つ(安定)。読みが無ければ末尾に置く
  function sortGenerals(list) {
    var items = list.map(function (g, i) { return { g: g, i: i, r: String(g.reading || '') }; });
    items.sort(function (a, b) {
      if (a.r !== b.r) {
        if (!a.r) { return 1; }
        if (!b.r) { return -1; }
        return a.r < b.r ? -1 : 1;
      }
      return a.i - b.i;
    });
    return items.map(function (x) { return x.g; });
  }

  // ---- 画面ごとのイベント(描き直すたびに外す) ----
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

  function cardHtml(g) {
    return '<li class="zukan-item"><button type="button" class="zukan-card" data-general-id="' + esc(g.id) + '"' +
      ' aria-label="' + esc(g.name + 'をくわしく見る') + '">' +
      '<span class="zukan-card-img" aria-hidden="true">' + root.SG.Results.portraitHtml(g) + '</span>' +
      '<span class="zukan-card-name">' + esc(g.name) + '</span>' +
      (g.reading ? '<span class="zukan-card-reading">' + esc(g.reading) + '</span>' : '') +
      '<span class="zukan-card-type">' + esc(g.title) + '</span>' +
      '</button></li>';
  }

  // rootEl: #zukan-root、handlers: { onBack, onStart }
  function render(rootEl, handlers) {
    dispose(rootEl);
    var all = root.SG.Generals || [];
    var view = { order: sortGenerals(all) }; // 常に五十音順
    var pid = root.SG.Util.uid('zk');

    rootEl.innerHTML = '<div class="zukan">' +
      '<h2 class="zukan-title" id="' + pid + '-title" tabindex="-1">戦国武将図鑑</h2>' +
      '<p class="zukan-lead">診断をしなくても、' + all.length + '人の戦国武将の紹介を見られます。気になる武将を選んでください。名前の五十音順で並んでいます。</p>' +
      '<ul class="zukan-grid" aria-label="戦国武将の一覧(五十音順)"></ul>' +
      '<p class="zukan-note">史実の説明は一般的な通説に基づく要約です。性格パラメータは診断用の仮想モデルで、史実の数値ではありません。</p>' +
      '<div class="zukan-actions">' +
        '<button type="button" class="btn btn-primary zukan-start" data-action="start">診断を始める</button>' +
        '<button type="button" class="btn btn-sub zukan-back" data-action="back">戻る</button>' +
      '</div>' +
      '</div>';

    var grid = rootEl.querySelector('.zukan-grid');

    // 一覧を五十音順で描く
    function draw() {
      grid.innerHTML = view.order.map(cardHtml).join('');
      root.SG.Results.attachImageFallback(grid);
    }

    function cardOf(id) {
      return grid.querySelector('[data-general-id="' + id + '"]');
    }
    function indexOfId(id) {
      for (var i = 0; i < view.order.length; i++) { if (view.order[i].id === id) { return i; } }
      return -1;
    }

    // 詳細ダイアログの前/次。表示中の並び順で隣の武将を返し、端では null(ループしない)
    function makeNav(startId) {
      var curId = startId;
      function step(d) {
        var i = indexOfId(curId) + d;
        if (i < 0 || i >= view.order.length) { return null; }
        curId = view.order[i].id;
        return { general: view.order[i], index: i, opener: cardOf(curId) };
      }
      return {
        index: indexOfId(startId),
        total: view.order.length,
        onPrev: function () { return step(-1); },
        onNext: function () { return step(1); }
      };
    }

    bind(rootEl, 'click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      var card = t.closest('.zukan-card');
      if (card && rootEl.contains(card)) {
        var id = card.getAttribute('data-general-id');
        var idx = indexOfId(id);
        if (idx >= 0) {
          // userValues は渡さない(「あなた」の値は出さず、仮想モデルの注記だけが付く)
          root.SG.Results.openGeneralDialog(view.order[idx], card, undefined, { nav: makeNav(id) });
        }
        return;
      }
      var act = t.closest('[data-action]');
      if (!act || !rootEl.contains(act)) { return; }
      var name = act.getAttribute('data-action');
      if (name === 'back') {
        if (handlers && handlers.onBack) { handlers.onBack(); }
      } else if (name === 'start') {
        if (handlers && handlers.onStart) { handlers.onStart(); }
      }
    });

    // キーボード: Esc で戻る(詳細ダイアログが開いている間はダイアログ側の Esc が先に働く)
    bind(rootEl, 'keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (handlers && handlers.onBack) { handlers.onBack(); }
      }
    });

    draw();
  }

  // 付けたイベントを外して中身を空にする
  function dispose(rootEl) {
    if (!rootEl) { return; }
    unbindAll(rootEl);
    rootEl.replaceChildren();
  }

  SG.Zukan = { sortGenerals: sortGenerals, render: render, dispose: dispose };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Zukan; }
})(typeof window !== 'undefined' ? window : globalThis);
