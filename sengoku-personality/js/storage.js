/*
 * storage.js — SG.Storage
 * 「戦国武将ランキング」の集計を localStorage に保存する(localStorage 以外には触れない)。
 * 保存するのは武将 id ごとの件数だけ(累計と日付別)。回答・結果・個人情報は保存しない。
 * モジュールのロード時には何もしない(create() は呼ばない)。既定のストアは getDefault() の初回呼び出しで作る。
 * localStorage が使えない環境では、同じ API のままメモリ内だけで集計する(isPersistent() === false)。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var KEY = 'sengoku-personality:v1:stats';
  var CORRUPT_KEY = KEY + ':corrupt';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function emptyData() { return { v: 1, total: {}, daily: {} }; }

  function generalIds() {
    var list = root.SG.Generals;
    return Array.isArray(list) ? list.map(function (g) { return g.id; }) : [];
  }
  function isKnownId(id) { return typeof id === 'string' && generalIds().indexOf(id) >= 0; }
  function isCount(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1; }
  function isPlainObject(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  // { id: 件数 } から、未知の id・非整数・0 以下を読み飛ばした新しいオブジェクトを作る(修復)
  function cleanCounts(obj) {
    var out = {};
    if (!isPlainObject(obj)) { return out; }
    Object.keys(obj).forEach(function (id) {
      if (isKnownId(id) && isCount(obj[id])) { out[id] = obj[id]; }
    });
    return out;
  }

  // 保存文字列を検証して読み込む。壊れていれば null(呼び出し側で空として扱い、退避する)
  function parseData(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return null; }
    if (!isPlainObject(parsed) || parsed.v !== 1 || !isPlainObject(parsed.total) || !isPlainObject(parsed.daily)) { return null; }
    var data = emptyData();
    data.total = cleanCounts(parsed.total);
    Object.keys(parsed.daily).forEach(function (date) {
      if (!DATE_RE.test(date)) { return; } // 不正な日付キーは日付ごと読み飛ばす
      var c = cleanCounts(parsed.daily[date]);
      if (Object.keys(c).length) { data.daily[date] = c; }
    });
    return data;
  }

  function copyData(d) { return JSON.parse(JSON.stringify(d)); }

  function hasStorageApi(s) {
    return s !== null && typeof s === 'object' &&
      typeof s.getItem === 'function' && typeof s.setItem === 'function' && typeof s.removeItem === 'function';
  }

  // setItem/removeItem の往復で、実際に書き込めるかを確かめる
  function probe(s) {
    try {
      var k = KEY + ':probe';
      s.setItem(k, '1');
      s.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) { console.warn(msg); }
  }

  // storageLike: getItem/setItem/removeItem を持つオブジェクト、null(メモリのみ)、undefined(ブラウザなら localStorage)
  // clockFn: 現在時刻の Date を返す関数(テストで日付を注入する)
  function create(storageLike, clockFn) {
    var clock = typeof clockFn === 'function' ? clockFn : function () { return new Date(); };
    var backend = null;
    if (storageLike === undefined) {
      // Node(window がない)では localStorage に一切触れない
      if (typeof window !== 'undefined') {
        try {
          var ls = window.localStorage; // 参照自体が SecurityError を投げる環境がある
          if (hasStorageApi(ls) && probe(ls)) { backend = ls; }
        } catch (e) {
          backend = null;
        }
      }
    } else if (hasStorageApi(storageLike)) {
      if (probe(storageLike)) { backend = storageLike; }
    }
    var mem = emptyData();

    // 最新の保存内容を読む(複数タブの上書きを減らすため、毎回読み直す)
    function load() {
      if (!backend) { return mem; }
      var text;
      try {
        text = backend.getItem(KEY);
      } catch (e) {
        warn('Storage: 読み込みに失敗したため、メモリ内で集計します');
        backend = null;
        return mem;
      }
      if (text === null || text === undefined) { mem = emptyData(); return mem; }
      var data = parseData(text);
      if (!data) {
        // 壊れたデータは退避して、空として扱う(退避の失敗は無視)
        try { backend.setItem(CORRUPT_KEY, String(text)); } catch (e) { /* 無視 */ }
        data = emptyData();
      }
      mem = data;
      return mem;
    }

    function save(data) {
      mem = data;
      if (!backend) { return false; }
      try {
        backend.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        warn('Storage: 保存に失敗したため、メモリ内で集計します');
        backend = null;
        return false;
      }
    }

    function todayKey() { return root.SG.Util.localDateKey(clock()); }

    // scope('total' | 'today' | 'YYYY-MM-DD')を件数のオブジェクトに解決する。不正なら null
    function resolve(data, scope) {
      if (scope === 'total') { return data.total; }
      var date = scope === 'today' ? todayKey() : scope;
      if (typeof date !== 'string' || !DATE_RE.test(date)) { return null; }
      return data.daily[date] || null;
    }

    var store = {
      isPersistent: function () { return backend !== null; },
      // 結果確定時に 1 位の武将 id を 1 件加算する。例外は外へ出さない
      increment: function (id) {
        try {
          if (!isKnownId(id)) { return { ok: false }; }
          var data = copyData(load());
          var day = todayKey();
          data.total[id] = (data.total[id] || 0) + 1;
          data.daily[day] = data.daily[day] || {};
          data.daily[day][id] = (data.daily[day][id] || 0) + 1;
          return { ok: save(data) };
        } catch (e) {
          warn('Storage: 加算に失敗しました');
          return { ok: false };
        }
      },
      // [{ id, count }] を件数の多い順(同数は武将の配列順)で返す。不正な scope は []
      getCounts: function (scope) {
        try {
          var counts = resolve(load(), scope);
          if (!counts) { return []; }
          var ids = generalIds();
          return Object.keys(counts)
            .map(function (id) { return { id: id, count: counts[id] }; })
            .sort(function (a, b) { return (b.count - a.count) || (ids.indexOf(a.id) - ids.indexOf(b.id)); });
        } catch (e) {
          return [];
        }
      },
      getTotalPlayers: function (scope) {
        return store.getCounts(scope).reduce(function (sum, r) { return sum + r.count; }, 0);
      },
      // 保存されている日付(件数 1 以上)を新しい順で返す
      listDates: function () {
        try {
          var daily = load().daily;
          return Object.keys(daily).filter(function (d) {
            return DATE_RE.test(d) && Object.keys(daily[d]).length > 0;
          }).sort().reverse();
        } catch (e) {
          return [];
        }
      },
      // 集計をすべて消す(退避キーも消す)
      reset: function () {
        mem = emptyData();
        if (!backend) { return; }
        try {
          backend.removeItem(KEY);
          backend.removeItem(CORRUPT_KEY);
        } catch (e) {
          warn('Storage: リセットに失敗しました');
        }
      },
      todayKey: function () { return todayKey(); }
    };
    return store;
  }

  // アプリ用の既定ストア(初回呼び出し時に 1 度だけ作る)
  var defaultStore = null;
  function getDefault() {
    if (!defaultStore) { defaultStore = create(); }
    return defaultStore;
  }

  SG.Storage = { create: create, getDefault: getDefault, KEY: KEY, CORRUPT_KEY: CORRUPT_KEY };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Storage; }
})(typeof window !== 'undefined' ? window : globalThis);
