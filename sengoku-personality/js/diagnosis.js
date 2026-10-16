/*
 * diagnosis.js — SG.Diagnosis
 * 診断ロジック(純粋関数のみ。DOM・localStorage・Date・乱数には触れない)。
 *   回答(answers: 長さ 15、各 0〜3)→ 6 軸の素点 → 0〜100 に正規化 → 20 人との 6 次元ユークリッド距離 → 類似度と順位。
 * 同じ answers からは必ず同じ結果になる(並び替えは全順序で、浮動小数の加算順も固定)。
 * 依存先(SG.Questions / SG.Generals / SG.Crest / SG.Util)は呼び出し時に参照する。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var KEYS = ['leadership', 'action', 'strategy', 'social', 'caution', 'innovation'];
  var MAX_DISTANCE = Math.sqrt(KEYS.length * 100 * 100);
  // 武将の人数。武将を追加するときはこの値も変える(validateData が件数を検査する)。
  var EXPECTED_GENERAL_COUNT = 20;
  var MIN_PAIR_DISTANCE = 8;

  var AXES = [
    { key: 'leadership', label: '統率力', desc: '周囲をまとめて導く力' },
    { key: 'action', label: '行動力', desc: '決断して実行する力' },
    { key: 'strategy', label: '知略', desc: '分析・計画・戦略を考える傾向' },
    { key: 'social', label: '社交性', desc: '人と協力し関係を築く傾向' },
    { key: 'caution', label: '慎重さ', desc: 'リスクを考えて判断する傾向' },
    { key: 'innovation', label: '革新性', desc: '新しい発想や変化を好む傾向' }
  ];
  // 理由文(reason.js)で使う、一様乱数回答での各軸の平均・標準偏差(整数丸め)。
  // tools/simulate.js が実測値と ±1 以内で一致することを検査する。
  var AXIS_STATS = {
    mean: { leadership: 46, action: 44, strategy: 41, social: 37, caution: 46, innovation: 43 },
    sd: { leadership: 11, action: 10, strategy: 11, social: 10, caution: 11, innovation: 11 }
  };

  function questions() { return root.SG.Questions; }
  function generalsList() { return root.SG.Generals; }

  function isValidAnswer(v) {
    return typeof v === 'number' && Math.floor(v) === v && v >= 0 && v <= 3;
  }

  // 全問回答済みか(長さ 15 で、すべて整数 0〜3)
  function isComplete(answers) {
    var n = questions().count;
    if (!Array.isArray(answers) || answers.length !== n) { return false; }
    for (var i = 0; i < n; i++) { if (!isValidAnswer(answers[i])) { return false; } }
    return true;
  }

  function assertAnswers(answers) {
    if (!isComplete(answers)) { throw new RangeError('INVALID_ANSWERS'); }
  }

  // 回答から 6 軸の素点を合計する。状態は持たず、毎回全問を計算し直す(入力は変更しない)。
  function computeRaw(answers) {
    assertAnswers(answers);
    var items = questions().items;
    var raw = [0, 0, 0, 0, 0, 0];
    for (var q = 0; q < items.length; q++) {
      var s = items[q].options[answers[q]].scores;
      for (var k = 0; k < 6; k++) { raw[k] += s[k]; }
    }
    return raw;
  }

  // 各軸の取りうる最小合計・最大合計を質問データから算出する(データが凍結されているので結果をキャッシュする)。
  var rangeCache = { src: null, value: null };
  function getRanges() {
    var items = questions().items;
    if (rangeCache.src === items) { return rangeCache.value; }
    var ranges = {};
    for (var k = 0; k < 6; k++) {
      var min = 0, max = 0;
      for (var q = 0; q < items.length; q++) {
        var lo = Infinity, hi = -Infinity;
        for (var o = 0; o < items[q].options.length; o++) {
          var v = items[q].options[o].scores[k];
          if (v < lo) { lo = v; }
          if (v > hi) { hi = v; }
        }
        min += lo;
        max += hi;
      }
      ranges[KEYS[k]] = Object.freeze({ min: min, max: max });
    }
    rangeCache = { src: items, value: Object.freeze(ranges) };
    return rangeCache.value;
  }

  // 正規化(設計書 B-6): (raw − min) / (max − min) × 100 を 0〜100 に収める。丸めない。
  function normalize(raw) {
    var ranges = getRanges();
    var out = {};
    for (var k = 0; k < 6; k++) {
      var r = ranges[KEYS[k]];
      var v = (raw[k] - r.min) / (r.max - r.min) * 100;
      out[KEYS[k]] = Math.max(0, Math.min(100, v));
    }
    return out;
  }

  function scoreUser(answers) { return normalize(computeRaw(answers)); }

  // 類似度(要件 §8 の式そのまま): round(max(0, min(100, (1 − d / sqrt(6×100²)) × 100)))
  // similarityExact は表示用の小数 1 桁(切り捨て)。常に Math.round(similarityExact) === similarity。
  function similarity(user, general) {
    var d2 = 0;
    for (var i = 0; i < 6; i++) { var e = user[KEYS[i]] - general[KEYS[i]]; d2 += e * e; }
    var d = Math.sqrt(d2);
    var pctRaw = Math.max(0, Math.min(100, (1 - d / MAX_DISTANCE) * 100));
    var pct = Math.round(pctRaw);
    var exact = Math.floor(pctRaw * 10) / 10;
    exact = Math.min(pct + 0.4, Math.max(pct - 0.5, exact)); // 浮動小数誤差の保険
    exact = Math.round(exact * 10) / 10;                     // 表現誤差を落とす
    return { distance: d, distanceSq: d2, similarity: pct, similarityExact: exact };
  }

  // 全武将との類似度を求め、近い順に並べる。
  // 並び替えキーは丸める前の二乗距離を 1e-6 単位で整数化したもの。同値は武将配列の index 昇順(全順序)。
  function rankGenerals(user, generals) {
    var list = generals || generalsList();
    var rows = list.map(function (g, index) {
      var s = similarity(user, g);
      return {
        general: g, index: index, distance: s.distance, distanceSq: s.distanceSq,
        similarity: s.similarity, similarityExact: s.similarityExact,
        key: Math.round(s.distanceSq * 1e6)
      };
    });
    rows.sort(function (a, b) { return (a.key - b.key) || (a.index - b.index); });
    rows.forEach(function (r, i) {
      r.rank = i + 1;
      // 表示用の類似度は直前の順位の値を超えないようにする(非増加の保証)。整数と小数 1 桁の両方。
      if (i > 0) {
        var prev = rows[i - 1];
        if (r.similarity > prev.similarity) { r.similarity = prev.similarity; }
        if (r.similarityExact > prev.similarityExact) { r.similarityExact = prev.similarityExact; }
      }
    });
    return rows;
  }

  // 6 軸の値をそれぞれ Math.round した新しいオブジェクトを返す(入力は変更しない)
  function roundAll(obj) {
    var out = {};
    for (var k = 0; k < 6; k++) { out[KEYS[k]] = Math.round(obj[KEYS[k]]); }
    return out;
  }

  // 診断の入口。answers だけから結果をすべて作る(派生値なので、何度呼んでも同じ結果になる)。
  function diagnose(answers) {
    var user = scoreUser(answers);
    var ranking = rankGenerals(user);
    return { user: user, userRounded: roundAll(user), ranking: ranking, top: ranking[0], top3: ranking.slice(0, 3) };
  }

  // ---- データ検証(起動時とテストで実行。違反があれば箇所を含めて throw する) ----

  var HISTORY_ENDINGS = ['知られています。', 'とされます。', 'と伝えられます。'];

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  function validateData() {
    var errors = [];
    function err(msg) { errors.push(msg); }
    var Q = questions();
    var list = generalsList();
    var Util = root.SG.Util;

    // 家紋モジュールは呼び出し時に参照する(未ロードなら検証できない)
    var Crest = root.SG.Crest;
    if (!Crest || !Crest.kinds || !Crest.patterns) { throw new Error('CREST_NOT_LOADED'); }

    // 質問
    if (!Q || !Array.isArray(Q.items)) {
      err('questions: 未ロード');
    } else {
      if (Q.items.length !== 15 || Q.count !== 15) { err('questions: 15問ではない(' + Q.items.length + '問)'); }
      Q.items.forEach(function (item, qi) {
        var p = 'questions[' + qi + ']';
        if (!isNonEmptyString(item.text)) { err(p + '.text: 空'); }
        else if (item.text.length > 30) { err(p + '.text: 30文字を超える(' + item.text.length + '文字)'); }
        if (!Array.isArray(item.options) || item.options.length !== 4) { err(p + '.options: 4択ではない'); return; }
        item.options.forEach(function (o, oi) {
          var op = p + '.options[' + oi + ']';
          if (o.label !== 'ABCD'.charAt(oi)) { err(op + '.label: A〜Dの順ではない'); }
          if (!isNonEmptyString(o.text)) { err(op + '.text: 空'); }
          else if (o.text.length > 26) { err(op + '.text: 26文字を超える(' + o.text.length + '文字)'); }
          if (!Array.isArray(o.scores) || o.scores.length !== 6) { err(op + '.scores: 長さ6ではない'); return; }
          o.scores.forEach(function (s, si) {
            if (!isInt(s) || s < -2 || s > 3) { err(op + '.scores[' + si + ']: 整数-2〜3ではない'); }
          });
        });
      });
      if (errors.length === 0) {
        var ranges = getRanges();
        KEYS.forEach(function (key) {
          if (!(ranges[key].max - ranges[key].min > 0)) { throw new RangeError('AXIS_RANGE_ZERO'); }
        });
      }
    }

    // 武将
    if (!Array.isArray(list)) {
      err('generals: 未ロード');
    } else {
      if (list.length !== EXPECTED_GENERAL_COUNT) { err('generals: ' + EXPECTED_GENERAL_COUNT + '件ではない(' + list.length + '件)'); }
      var ids = {}, histories = {}, combos = {};
      list.forEach(function (g, i) {
        var p = 'generals[' + i + ']';
        if (typeof g.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.id)) { err(p + '.id: kebab-caseではない'); }
        else if (ids[g.id]) { err(p + '.id: 重複(' + g.id + ')'); }
        ids[g.id] = true;
        ['name', 'title', 'description', 'lifespan', 'region'].forEach(function (f) {
          if (!isNonEmptyString(g[f])) { err(p + '.' + f + ': 空'); }
        });
        KEYS.forEach(function (key) {
          if (!isInt(g[key]) || g[key] < 0 || g[key] > 100) { err(p + '.' + key + ': 整数0〜100ではない'); }
        });
        if (!Array.isArray(g.achievements) || g.achievements.length < 2 || g.achievements.length > 3 ||
            !g.achievements.every(isNonEmptyString)) {
          err(p + '.achievements: ' + (Array.isArray(g.achievements) ? g.achievements.length : 0) + '件(2〜3件の非空文字列が必要)');
        }
        if (!Array.isArray(g.events) || g.events.length < 1 || g.events.length > 2 || !g.events.every(isNonEmptyString)) {
          err(p + '.events: ' + (Array.isArray(g.events) ? g.events.length : 0) + '件(1〜2件の非空文字列が必要)');
        }
        if (!isNonEmptyString(g.imageOfType) || g.imageOfType.indexOf('診断では') !== 0) {
          err(p + '.imageOfType: 「診断では」で始まらない');
        }
        var h = g.reason && g.reason.history;
        if (!isNonEmptyString(h)) {
          err(p + '.reason.history: 空');
        } else {
          if (histories[h]) { err(p + '.reason.history: 重複'); }
          histories[h] = true;
          var okEnd = HISTORY_ENDINGS.some(function (e) { return h.length >= e.length && h.lastIndexOf(e) === h.length - e.length; });
          if (!okEnd) { err(p + '.reason.history: 文末が不正'); }
        }
        if (g.image !== null) {
          if (typeof g.image !== 'string' || g.image === '' || /^(https?:|\/\/)/i.test(g.image) ||
              (/^[a-z][a-z0-9+.-]*:/i.test(g.image) && g.image.indexOf('data:image/') !== 0) || g.image.charAt(0) === '/') {
            err(p + '.image: 相対パスまたは data:image/ ではない');
          }
          if (!isNonEmptyString(g.imageCredit)) { err(p + '.imageCredit: image があるのに空'); }
        }
        // 家紋
        var c = g.crest;
        if (!c) { err(p + '.crest: なし'); return; }
        if (Crest.kinds.indexOf(c.kind) < 0) { err(p + '.crest.kind: 不明(' + c.kind + ')'); }
        if (Crest.patterns.indexOf(c.pattern) < 0) { err(p + '.crest.pattern: 不明(' + c.pattern + ')'); }
        if (typeof c.display !== 'string' || c.display.length < 2 || c.display.length > 3) { err(p + '.crest.display: 2〜3文字ではない'); }
        if (c.kind === 'glyph' && (typeof c.glyph !== 'string' || c.glyph.length !== 1)) { err(p + '.crest.glyph: 1文字ではない'); }
        ['bg1', 'bg2', 'accent'].forEach(function (f) { if (!isColor(c[f])) { err(p + '.crest.' + f + ': #rrggbbではない'); } });
        var combo = [c.kind, c.pattern, c.accent, c.bg1].join('|');
        if (combos[combo]) { err(p + '.crest: (kind,pattern,accent,bg1) の組が重複'); }
        combos[combo] = true;
      });
      // 最近接ペアの距離(近すぎる 2 人は区別がつかないため 8 以上を求める)
      var np = nearestPair(list);
      if (np && np.distance < MIN_PAIR_DISTANCE) {
        err('generals: 最近接ペアの距離が' + MIN_PAIR_DISTANCE + '未満(' + np.a.id + '–' + np.b.id + ' ' + np.distance.toFixed(2) + ')');
      }
    }

    // フォント定数(SVG の属性に埋め込むため " < & を含まないこと)
    if (!Util || !Util.fonts) {
      err('util: 未ロード');
    } else {
      ['serif', 'sans'].forEach(function (f) {
        var v = Util.fonts[f];
        if (typeof v !== 'string' || /["<&]/.test(v)) { err('util.fonts.' + f + ': 不正な文字を含む'); }
      });
    }

    if (errors.length) { throw new Error('VALIDATION_FAILED: ' + errors.join(' / ')); }
    return true;
  }

  // 全ペアのうち最も近い 2 人と距離を返す(検証とテスト用)
  function nearestPair(list) {
    var best = null;
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var d = similarity(list[i], list[j]).distance;
        if (!best || d < best.distance) { best = { a: list[i], b: list[j], distance: d }; }
      }
    }
    return best;
  }

  SG.Diagnosis = {
    AXES: AXES,
    AXIS_STATS: AXIS_STATS,
    EXPECTED_GENERAL_COUNT: EXPECTED_GENERAL_COUNT,
    validateData: validateData,
    nearestPair: nearestPair,
    isComplete: isComplete,
    computeRaw: computeRaw,
    getRanges: getRanges,
    normalize: normalize,
    scoreUser: scoreUser,
    similarity: similarity,
    rankGenerals: rankGenerals,
    diagnose: diagnose
  };
  (function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
  })({ AXES: AXES, AXIS_STATS: AXIS_STATS });
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Diagnosis; }
})(typeof window !== 'undefined' ? window : globalThis);
