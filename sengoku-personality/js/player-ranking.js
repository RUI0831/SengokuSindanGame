/*
 * player-ranking.js — SG.PlayerRanking
 * 来場者向け「みんなの結果ランキング」画面の DOM を描く(表示専用)。
 * 受け取るのは読み取り専用のストア(getCounts / getTotalPlayers / isPersistent / todayKey だけ)で、
 * 集計を書き換える操作はこのファイルに存在しない。状態(画面遷移・加算)は持たない。
 * ロード時に DOM・localStorage には触れない。武将名などの文字列は必ず SG.Util.esc() を通す。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var INITIAL_ROWS = 10; // 初期表示の人数
  var TIERS = ['gold', 'silver', 'bronze'];

  function esc(s) { return root.SG.Util.esc(s); }

  // 件数の配列 [{id,count}](件数の多い順)から表示用の行を作る純粋関数。
  // 順位は並び順の連番、割合は全体に対する四捨五入、横棒は 1 位の件数に対する長さ(最大 100)。
  function buildRows(counts, highlightId) {
    if (!counts || !counts.length) { return []; }
    var total = 0;
    var i;
    for (i = 0; i < counts.length; i++) { total += counts[i].count; }
    var max = counts[0].count;
    var rows = [];
    for (i = 0; i < counts.length; i++) {
      var c = counts[i];
      rows.push({
        rank: i + 1,
        id: c.id,
        count: c.count,
        percent: total > 0 ? Math.round(c.count / total * 100) : 0,
        widthPct: max > 0 ? Math.round(c.count / max * 1000) / 10 : 0,
        isMe: highlightId !== undefined && highlightId !== null && c.id === highlightId,
        tier: i < TIERS.length ? TIERS[i] : null
      });
    }
    return rows;
  }

  function generalName(id) {
    var list = root.SG.Generals || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i].name; } }
    return id;
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

  // rootEl: #player-ranking-root、store: 読み取り専用ストア、handlers: { onBack }、options: { highlightId }
  function render(rootEl, store, handlers, options) {
    dispose(rootEl);
    var highlightId = options && options.highlightId ? options.highlightId : null;
    var view = { scope: 'today', showAll: false };
    var tabs = [
      { scope: 'today', label: '今日' },
      { scope: 'total', label: '累計' }
    ];
    var pid = root.SG.Util.uid('pr');

    rootEl.innerHTML = '<div class="pr">' +
      '<h2 class="pr-title" id="' + pid + '-title" tabindex="-1">みんなの結果ランキング</h2>' +
      '<div class="pr-tabs" role="tablist" aria-label="集計の範囲">' + tabs.map(function (t) {
        return '<button type="button" role="tab" class="pr-tab" id="' + pid + '-tab-' + t.scope + '" data-scope="' + t.scope + '"' +
          ' aria-controls="' + pid + '-panel">' + esc(t.label) + '</button>';
      }).join('') + '</div>' +
      '<div class="pr-panel" id="' + pid + '-panel" role="tabpanel"></div>' +
      '<p class="pr-note" data-role="scope-note">この端末・このブラウザの集計です(他の端末とは共有されません)</p>' +
      '<p class="pr-note pr-note-warn" data-role="volatile" hidden>この環境では集計を保存できません</p>' +
      '<div class="pr-actions"><button type="button" class="btn btn-primary pr-back" data-action="back">戻る</button></div>' +
      '</div>';

    var panel = rootEl.querySelector('.pr-panel');
    var volatileNote = rootEl.querySelector('[data-role="volatile"]');
    var scopeNote = rootEl.querySelector('[data-role="scope-note"]');

    // 選択中の範囲の一覧を描く。読み込みに失敗しても例外は外に出さず、案内の文言を出す
    function draw() {
      Array.prototype.forEach.call(rootEl.querySelectorAll('[role="tab"]'), function (b) {
        var on = b.getAttribute('data-scope') === view.scope;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
        if (on) { panel.setAttribute('aria-labelledby', b.id); }
      });
      var html;
      try {
        var persistent = store.isPersistent();
        volatileNote.hidden = persistent;
        if (typeof store.isShared === 'function' && store.isShared()) { scopeNote.textContent = 'いろいろな端末で診断した人たちの集計です'; }
        var counts = store.getCounts(view.scope);
        if (!counts.length && !persistent) {
          html = '<p class="pr-empty">集計を読み込めませんでした</p>';
        } else if (!counts.length) {
          html = '<p class="pr-empty">まだ診断結果がありません。あなたが最初の一人になろう！</p>';
        } else {
          var rows = buildRows(counts, highlightId);
          var total = 0;
          counts.forEach(function (r) { total += r.count; });
          // 自分の武将が 10 位より下なら、最初から全件を出して行が見えるようにする
          var meBelow = rows.some(function (r) { return r.isMe && r.rank > INITIAL_ROWS; });
          var showAll = view.showAll || meBelow;
          var shown = showAll ? rows : rows.slice(0, INITIAL_ROWS);
          html = '<p class="pr-total">診断人数 <strong>' + total + '</strong>人</p>';
          html += '<ol class="pr-list">' + shown.map(function (r) {
            var cls = 'pr-row' + (r.tier ? ' tier-' + r.tier : '') + (r.isMe ? ' is-me' : '');
            var text = r.rank + '位 ' + generalName(r.id) + '型　' + r.count + '人(' + r.percent + '%)';
            return '<li class="' + cls + '"><span class="pr-text">' + esc(text) + '</span>' +
              (r.isMe ? '<span class="pr-badge">あなた</span><span class="visually-hidden">(今回のあなたの結果)</span>' : '') +
              '<span class="pr-bar" aria-hidden="true"><span style="width:' + r.widthPct + '%"></span></span></li>';
          }).join('') + '</ol>';
          if (!showAll && rows.length > INITIAL_ROWS) {
            html += '<button type="button" class="btn btn-sub btn-small pr-more" data-action="show-all">すべて表示</button>';
          }
        }
      } catch (e) {
        html = '<p class="pr-empty">集計を読み込めませんでした</p>';
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
        var tabEl = rootEl.querySelector('[role="tab"][aria-selected="true"]');
        if (tabEl) { tabEl.focus(); }
      }
    });

    // キーボード操作: Esc で戻る。タブは WAI-ARIA の tabs パターン(←→ / Home / End で移動)
    bind(rootEl, 'keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (handlers && handlers.onBack) { handlers.onBack(); }
        return;
      }
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') { return; }
      var tab = t.closest('[role="tab"]');
      if (!tab || !rootEl.contains(tab)) { return; }
      var cur = 0;
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

    draw();
  }

  // 付けたイベントを外して中身を空にする
  function dispose(rootEl) {
    if (!rootEl) { return; }
    unbindAll(rootEl);
    rootEl.replaceChildren();
  }

  SG.PlayerRanking = { buildRows: buildRows, render: render, dispose: dispose };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.PlayerRanking; }
})(typeof window !== 'undefined' ? window : globalThis);
