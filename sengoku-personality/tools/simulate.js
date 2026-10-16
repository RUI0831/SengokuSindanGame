/*
 * tools/simulate.js — 診断ロジックとデータの自動検証(Node 標準モジュールのみ)
 *
 * 使い方(sengoku-personality フォルダで): node tools\simulate.js
 *
 * 検査(番号は設計書 B-19 と同じ。#14 は tools/check-static.js の担当):
 *   #1 データ検証 / #2 一様乱数分布 / #3 傾向付き乱数分布 / #4 単調パターンと文字別プロファイル /
 *   #5 再現性 / #6 範囲と並び / #7 同点の安定性 / #8 二重加算なし / #9 質問の感度 /
 *   #10 傾向スポットチェック / #11 理由文 / #12 ストレージ / #13 家紋 SVG /
 *   #15 位置バイアス / #16 集団バイアス耐性 / #17 上位の差(表示のみ)
 *
 * 乱数はこのスクリプト内の mulberry32(シード固定)だけを使う。アプリ本体には乱数はない。
 * FAIL が 1 件でもあれば終了コード 1。
 */
'use strict';

var path = require('path');

function jsPath(name) { return path.join(__dirname, '..', 'js', name); }

// ---- #12 用: storage.js を読み込む前に、グローバルの localStorage に触れたら分かる罠を仕掛ける ----
var lsTrap = { hits: 0, installed: false, error: null, original: undefined };
try {
  lsTrap.original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: function () { lsTrap.hits += 1; throw new Error('localStorage に触れてはいけない'); }
  });
  lsTrap.installed = true;
} catch (e) {
  lsTrap.error = e;
}

// 読み込み順は util → questions → generals → diagnosis → reason → storage → crest
var Util = require(jsPath('util.js'));
var Questions = require(jsPath('questions.js'));
var Generals = require(jsPath('generals.js'));
var D = require(jsPath('diagnosis.js'));
var Reason = require(jsPath('reason.js'));
var storageLoad = { error: null, windowDefined: false };
var Storage;
try {
  Storage = require(jsPath('storage.js'));
} catch (e) {
  storageLoad.error = e;
}
storageLoad.windowDefined = typeof globalThis.window !== 'undefined';
var Crest = require(jsPath('crest.js'));
// 来場者向けランキング(罠が生きているうちに読み込み、ロード時に localStorage に触れないことを #18 で確認する)
var hitsBeforePlayerRanking = lsTrap.hits;
var playerRankingLoad = { error: null };
var PlayerRanking;
try { PlayerRanking = require(jsPath('player-ranking.js')); } catch (e) { playerRankingLoad.error = e; }
var playerRankingHits = lsTrap.hits - hitsBeforePlayerRanking;
// 武将図鑑(同じく罠が生きているうちに読み込み、#19 で確認する)
var hitsBeforeZukan = lsTrap.hits;
var zukanLoad = { error: null };
var Zukan;
try { Zukan = require(jsPath('zukan.js')); } catch (e) { zukanLoad.error = e; }
var zukanHits = lsTrap.hits - hitsBeforeZukan;
// 相性(同じく罠が生きているうちに読み込み、#20 で確認する)
var hitsBeforeCompat = lsTrap.hits;
var compatLoad = { error: null };
var Compat;
try { Compat = require(jsPath('compat.js')); } catch (e) { compatLoad.error = e; }
var compatHits = lsTrap.hits - hitsBeforeCompat;

// ---------------------------------------------------------------- 出力
var failCount = 0, warnCount = 0;
function line(s) { console.log(s); }
function pass(id, msg) { line('[PASS] #' + id + ' ' + msg); }
function fail(id, msg) { failCount += 1; process.exitCode = 1; line('[FAIL] #' + id + ' ' + msg); }
function warn(id, msg) { warnCount += 1; line('[WARN] #' + id + ' ' + msg); }
function check(id, cond, msg) { if (cond) { pass(id, msg); } else { fail(id, msg); } }
function section(id, title, fn) {
  line('');
  line('== #' + id + ' ' + title);
  try { fn(); } catch (e) { fail(id, '例外: ' + (e && e.stack ? e.stack : e)); }
}
function pct(n, total) { return (n / total * 100).toFixed(2) + '%'; }
function pad(s, n) { s = String(s); while (s.length < n) { s += '　'; } return s; }

// ---------------------------------------------------------------- 乱数(plan.md のコードそのまま)
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0;
  var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

var KEYS = D.AXES.map(function (a) { return a.key; });
var LABELS = D.AXES.map(function (a) { return a.label; });
var NQ = Questions.items.length;
var byId = {};
Generals.forEach(function (g) { byId[g.id] = g; });
function nameOf(id) { return byId[id] ? byId[id].name : id; }

// 一様乱数の回答: q = 0..14 の順に floor(rnd()*4)
function uniformAnswers(rnd) {
  var a = [];
  for (var q = 0; q < NQ; q++) { a.push(Math.floor(rnd() * 4)); }
  return a;
}
// Box–Muller: u1 = max(rnd(), 1e-12)、u2 = rnd()
function normal(rnd) {
  var u1 = Math.max(rnd(), 1e-12), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
// 選択肢の効用 Σ w_k × scores_k
function utility(option, w) {
  var u = 0;
  for (var k = 0; k < 6; k++) { u += w[k] * option.scores[k]; }
  return u;
}
// 重みに比例して 1 つ選ぶ(rnd を 1 回だけ消費。r を順に引いて負になった選択肢。最後まで負にならなければ 3)
function pickWeighted(rnd, weights) {
  var sum = 0, j;
  for (j = 0; j < weights.length; j++) { sum += weights[j]; }
  var r = rnd() * sum;
  for (j = 0; j < weights.length; j++) { r -= weights[j]; if (r < 0) { return j; } }
  return weights.length - 1;
}
// 傾向付き回答: w を 6 本引き、各問で exp(beta × 効用) に比例して選ぶ
function biasedAnswersWith(rnd, w, beta) {
  var a = [];
  for (var q = 0; q < NQ; q++) {
    var weights = Questions.items[q].options.map(function (o) { return Math.exp(beta * utility(o, w)); });
    a.push(pickWeighted(rnd, weights));
  }
  return a;
}
function tendencyAnswers(rnd) {
  var w = [];
  for (var k = 0; k < 6; k++) { w.push(normal(rnd)); }
  return biasedAnswersWith(rnd, w, 0.45);
}
// 各問で効用が最大の選択肢(同値は小さい index)
function argmaxAnswers(w) {
  return Questions.items.map(function (item) {
    var best = 0, bu = -Infinity;
    item.options.forEach(function (o, j) { var u = utility(o, w); if (u > bu) { bu = u; best = j; } });
    return best;
  });
}

// ---------------------------------------------------------------- #6 の不変条件(全乱数試行で使う)
var rangeStats = { checked: 0, violations: [] };
function checkRanking(d) {
  rangeStats.checked += 1;
  if (rangeStats.violations.length > 5) { return; }
  var v = rangeStats.violations;
  KEYS.forEach(function (k) {
    if (!(d.user[k] >= 0 && d.user[k] <= 100)) { v.push('user.' + k + '=' + d.user[k]); }
  });
  var r = d.ranking;
  if (r.length !== Generals.length) { v.push('ranking の件数 ' + r.length); }
  var seen = {};
  for (var i = 0; i < r.length; i++) {
    var row = r[i];
    if (seen[row.general.id]) { v.push('id 重複 ' + row.general.id); }
    seen[row.general.id] = true;
    if (!(Math.floor(row.similarity) === row.similarity && row.similarity >= 0 && row.similarity <= 100)) { v.push('similarity=' + row.similarity); }
    if (Math.round(row.similarityExact) !== row.similarity) { v.push('round(exact)≠similarity ' + row.similarityExact + '/' + row.similarity); }
    if (Math.abs(row.similarityExact * 10 - Math.round(row.similarityExact * 10)) > 1e-9) { v.push('exact が小数1桁でない ' + row.similarityExact); }
    if (row.rank !== i + 1) { v.push('rank ' + row.rank); }
    if (i > 0) {
      var p = r[i - 1];
      if (row.key < p.key) { v.push('key が減少'); }
      if (row.key === p.key && row.index < p.index) { v.push('同キーで index が逆順'); }
      if (row.key !== p.key && row.distance - p.distance < -1e-9) { v.push('distance が減少'); }
      if (row.similarity > p.similarity) { v.push('similarity が増加'); }
      if (row.similarityExact > p.similarityExact) { v.push('similarityExact が増加'); }
    }
  }
}

// ---------------------------------------------------------------- 標本の準備(#1 の AXIS_STATS、#2、#6、#17 で使う)
function tally(list) {
  var counts = {};
  Generals.forEach(function (g) { counts[g.id] = 0; });
  list.forEach(function (id) { counts[id] += 1; });
  return Generals.map(function (g) { return { id: g.id, count: counts[g.id] }; })
    .sort(function (a, b) { return (b.count - a.count) || (Generals.indexOf(byId[a.id]) - Generals.indexOf(byId[b.id])); });
}

var N_UNI = 100000;
var uniform = { tops: [], sum: [0, 0, 0, 0, 0, 0], sumSq: [0, 0, 0, 0, 0, 0], top12int: 0, top123int: 0, top12exact: 0, gaps: [] };
(function () {
  var rnd = mulberry32(20240601);
  for (var t = 0; t < N_UNI; t++) {
    var a = uniformAnswers(rnd);
    var d = D.diagnose(a);
    checkRanking(d);
    uniform.tops.push(d.top.general.id);
    for (var k = 0; k < 6; k++) { var x = d.user[KEYS[k]]; uniform.sum[k] += x; uniform.sumSq[k] += x * x; }
    var r = d.ranking;
    if (r[0].similarity === r[1].similarity) { uniform.top12int += 1; }
    if (r[0].similarity === r[1].similarity && r[1].similarity === r[2].similarity) { uniform.top123int += 1; }
    if (r[0].similarityExact === r[1].similarityExact) { uniform.top12exact += 1; }
    uniform.gaps.push(Math.round((r[0].similarityExact - r[1].similarityExact) * 10) / 10);
  }
})();

// ================================================================ #1 データ検証
section(1, 'データ検証', function () {
  var ok = true;
  try { D.validateData(); } catch (e) { ok = false; fail(1, 'validateData: ' + e.message); }
  if (ok) { pass(1, 'validateData() 成功(質問 ' + NQ + ' 問・武将 ' + Generals.length + ' 人・家紋・フォント)'); }

  // AXIS_STATS と一様乱数の実測(±1)
  var msgs = [], statOk = true;
  for (var k = 0; k < 6; k++) {
    var m = uniform.sum[k] / N_UNI;
    var sd = Math.sqrt(uniform.sumSq[k] / N_UNI - m * m);
    var em = D.AXIS_STATS.mean[KEYS[k]], es = D.AXIS_STATS.sd[KEYS[k]];
    if (Math.abs(m - em) > 1 || Math.abs(sd - es) > 1) { statOk = false; }
    msgs.push(LABELS[k] + ' ' + m.toFixed(1) + '/' + sd.toFixed(1) + '(定数 ' + em + '/' + es + ')');
  }
  check(1, statOk, 'AXIS_STATS が実測と ±1 以内: ' + msgs.join('、'));

  // AC-3: Q1〜Q5 の文言が要件 §5 と完全一致
  var REQ = [
    ['あなたがグループのリーダーになったら？', ['自分の考えで積極的に引っ張る', '仲間の意見を聞きながら進める', '慎重に計画を立てて行動する', '得意な人に役割を任せる']],
    ['予想外のトラブルが起きたら？', ['すぐに行動して解決を目指す', '原因を分析してから対処する', '周囲の人と協力する', '今までにない方法を考える']],
    ['あなたが最も大切にしているものは？', ['成功と挑戦', '信頼と仲間', '安定と計画', '自由と個性']],
    ['ライバルに負けたときは？', ['次は絶対に勝つと決意する', '負けた原因を分析する', '仲間と一緒に成長する', '別の方法で勝つことを考える']],
    ['あなたが新しい企画を考えるときは？', ['大胆で目立つ企画を考える', '現実的に実現できる企画を考える', 'みんなが楽しめる企画を考える', '誰も思いつかない企画を考える']]
  ];
  var mismatch = [];
  REQ.forEach(function (req, i) {
    var item = Questions.items[i];
    if (item.text !== req[0]) { mismatch.push('Q' + (i + 1) + ' 質問文'); }
    req[1].forEach(function (t, j) { if (item.options[j].text !== t) { mismatch.push('Q' + (i + 1) + ' ' + 'ABCD'.charAt(j)); } });
  });
  check(1, mismatch.length === 0, 'Q1〜Q5 の文言が要件 §5 と完全一致(AC-3)' + (mismatch.length ? ': 不一致 ' + mismatch.join(', ') : ''));
  var fourEach = Questions.items.every(function (it) { return it.options.length === 4; });
  check(1, NQ === 15 && Questions.count === 15 && fourEach, '15 問・各 4 択(AC-3)');

  // getRanges() が B-5 の範囲表と一致
  var EXPECT = { leadership: [-3, 31], action: [-9, 38], strategy: [-8, 39], social: [-11, 44], caution: [-24, 37], innovation: [-14, 42] };
  var rg = D.getRanges(), rgOk = true, rgMsg = [];
  KEYS.forEach(function (k, i) {
    if (rg[k].min !== EXPECT[k][0] || rg[k].max !== EXPECT[k][1]) { rgOk = false; }
    rgMsg.push(LABELS[i] + ' ' + rg[k].min + '〜' + rg[k].max);
  });
  check(1, rgOk, 'getRanges() が B-5 の範囲表と一致: ' + rgMsg.join('、'));

  // AC-27: 6 値が整数 0〜100、id 一意、最近接ペア ≥ 8
  var intOk = Generals.every(function (g) { return KEYS.every(function (k) { return Number.isInteger(g[k]) && g[k] >= 0 && g[k] <= 100; }); });
  var ids = Generals.map(function (g) { return g.id; });
  var uniq = ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length === ids.length;
  var np = D.nearestPair(Generals);
  check(1, intOk && uniq && np.distance >= 8, '武将の 6 値は整数 0〜100・id 一意・最近接ペア ' + np.a.name + '–' + np.b.name + ' ' + np.distance.toFixed(2) + '(基準 ≥ 8、AC-27)');
  check(1, Generals.length === D.EXPECTED_GENERAL_COUNT, '武将数 ' + Generals.length + ' = EXPECTED_GENERAL_COUNT');
});

// ================================================================ #2 一様乱数分布
function printTable(rows, total) {
  rows.forEach(function (r, i) { line('    ' + (i + 1 < 10 ? ' ' : '') + (i + 1) + '. ' + pad(nameOf(r.id), 9) + ' ' + pct(r.count, total) + ' (' + r.count + ')'); });
}
section(2, '一様乱数分布(seed 20240601、100,000 通り)', function () {
  var rows = tally(uniform.tops);
  var max = rows[0], min = rows[rows.length - 1];
  var appeared = rows.filter(function (r) { return r.count > 0; }).length;
  printTable(rows, N_UNI);
  check(2, appeared === Generals.length && max.count / N_UNI <= 0.09 && min.count / N_UNI >= 0.015,
    '最多 ' + nameOf(max.id) + ' ' + pct(max.count, N_UNI) + ' / 最少 ' + nameOf(min.id) + ' ' + pct(min.count, N_UNI) +
    ' / 出現 ' + appeared + '人(基準: 全員・最多 ≤ 9%・最少 ≥ 1.5%、AC-11)');
});

// ================================================================ #3 傾向付き乱数分布
section(3, '傾向付き乱数分布(seed 20240602、100,000 通り、β=0.45)', function () {
  var rnd = mulberry32(20240602), tops = [], N = 100000;
  for (var t = 0; t < N; t++) {
    var d = D.diagnose(tendencyAnswers(rnd));
    checkRanking(d);
    tops.push(d.top.general.id);
  }
  var rows = tally(tops);
  var max = rows[0], min = rows[rows.length - 1];
  var appeared = rows.filter(function (r) { return r.count > 0; }).length;
  printTable(rows, N);
  var msg = '最多 ' + nameOf(max.id) + ' ' + pct(max.count, N) + ' / 最少 ' + nameOf(min.id) + ' ' + pct(min.count, N) + ' / 出現 ' + appeared + '人';
  check(3, appeared === Generals.length && max.count / N <= 0.12 && min.count / N >= 0.005, msg + '(基準: 全員・最多 ≤ 12%・最少 ≥ 0.5%、AC-11)');
  if (max.count / N > 0.11 || min.count / N < 0.006) { warn(3, 'WARN: 余裕が薄い(最多 > 11% または最少 < 0.6%)'); }
});

// ================================================================ #4 単調パターンと文字別プロファイル
section(4, '単調パターンと文字別プロファイル', function () {
  var tops = [], profiles = [];
  for (var x = 0; x < 4; x++) {
    var a = []; for (var q = 0; q < NQ; q++) { a.push(x); }
    var d = D.diagnose(a);
    tops.push(d.top.general.id);
    profiles.push(d.user);
    line('    全' + 'ABCD'.charAt(x) + ': ' + KEYS.map(function (k) { return d.user[k].toFixed(1); }).join(' / ') +
      ' → ' + nameOf(d.top.general.id) + '(' + d.top.similarity + '%)');
  }
  var distinct = tops.filter(function (id, i) { return tops.indexOf(id) === i; }).length === 4;
  var noOda = tops.indexOf('oda-nobunaga') < 0;
  check(4, distinct && noOda, '全A〜全D の 1 位が相異なり信長でない: ' + tops.map(nameOf).join(' / ') + '(AC-12)');

  var diffs = KEYS.map(function (k) {
    var vals = profiles.map(function (p) { return p[k]; });
    return Math.max.apply(null, vals) - Math.min.apply(null, vals);
  });
  check(4, diffs.every(function (v) { return v <= 15; }),
    '文字間の最大差 ' + diffs.map(function (v, i) { return LABELS[i] + ' ' + v.toFixed(1); }).join('、') + '(基準 ≤ 15、AC-31)');

  [['A→D 循環', function (q) { return q % 4; }], ['D→A 循環', function (q) { return 3 - q % 4; }]].forEach(function (c) {
    var a = []; for (var q = 0; q < NQ; q++) { a.push(c[1](q)); }
    var d = D.diagnose(a);
    line('    ' + c[0] + ' → ' + nameOf(d.top.general.id) + '(' + d.top.similarity + '%)(参考)');
    if (d.top.general.id === 'oda-nobunaga') { warn(4, c[0] + ' の 1 位が織田信長'); }
  });
});

// ================================================================ #5 再現性
function deepFrozen(o) {
  if (o === null || typeof o !== 'object') { return true; }
  if (!Object.isFrozen(o)) { return false; }
  return Object.keys(o).every(function (k) { return deepFrozen(o[k]); });
}
section(5, '再現性(seed 20240605、200 通り × 5 回)', function () {
  var before = JSON.stringify([Questions, Generals]);
  var rnd = mulberry32(20240605), same = true, inputSame = true;
  for (var t = 0; t < 200; t++) {
    var a = uniformAnswers(rnd), copy = a.slice();
    var first = JSON.stringify(D.diagnose(a));
    for (var r = 0; r < 4; r++) { if (JSON.stringify(D.diagnose(a)) !== first) { same = false; } }
    if (JSON.stringify(a) !== JSON.stringify(copy)) { inputSame = false; }
  }
  check(5, same, '同じ answers の診断結果が JSON 文字列として完全一致(1000 回、AC-9)');
  check(5, inputSame && JSON.stringify([Questions, Generals]) === before, '入力 answers とデータが変更されない');
  check(5, deepFrozen(Questions) && deepFrozen(Generals), 'SG.Questions / SG.Generals が深く凍結されている');
  var threw = false;
  try { D.computeRaw([0, 1]); } catch (e) { threw = e instanceof RangeError && e.message === 'INVALID_ANSWERS'; }
  var threw2 = false;
  try { D.computeRaw(new Array(15).fill(null)); } catch (e) { threw2 = e instanceof RangeError; }
  check(5, threw && threw2, '不正な answers で RangeError(INVALID_ANSWERS)');
});

// ================================================================ #6 範囲と並び
section(6, '範囲と並び(#2・#3 の全試行)', function () {
  check(6, rangeStats.violations.length === 0,
    rangeStats.checked + ' 件で 6 値 0〜100・類似度は整数 0〜100・' + Generals.length + ' 件 id 重複なし・key 非減少・同キーは index 順・' +
    'similarity と similarityExact が非増加・round(similarityExact)=similarity・小数 1 桁(AC-8・AC-10)' +
    (rangeStats.violations.length ? ': ' + rangeStats.violations.slice(0, 5).join(' | ') : ''));
  var d = D.diagnose(new Array(15).fill(0));
  check(6, d.top.general.id === 'naoe-kanetsugu' && d.top.similarity === 89,
    '全A の 1 位 = ' + d.top.general.name + ' ' + d.top.similarity + '%(期待: 直江兼続 89%)');
});

// ================================================================ #7 同点の安定性
section(7, '同点の安定性', function () {
  function mk(id, v) { var g = { id: id }; KEYS.forEach(function (k, i) { g[k] = v[i]; }); return g; }
  var user = { leadership: 50, action: 50, strategy: 50, social: 50, caution: 50, innovation: 50 };
  var tg = [
    mk('t0', [60, 40, 50, 50, 50, 50]),
    mk('t1', [70, 70, 70, 70, 70, 70]),
    mk('t2', [55, 55, 55, 55, 55, 55]),
    mk('t3', [60, 40, 50, 50, 50, 50]), // t0 と同一
    mk('t4', [40, 50, 50, 50, 50, 50]), // t5 と左右対称(距離が数学的に等しい)
    mk('t5', [60, 50, 50, 50, 50, 50])
  ];
  var r1 = D.rankGenerals(user, tg).map(function (r) { return r.general.id; });
  var r2 = D.rankGenerals(user, tg).map(function (r) { return r.general.id; });
  var ok = r1.indexOf('t0') < r1.indexOf('t3') && r1.indexOf('t4') < r1.indexOf('t5') && r1.join() === r2.join();
  check(7, ok, '同一パラメータと左右対称の同点が配列順になり、2 回の結果が一致: ' + r1.join(' > '));
});

// ================================================================ #8 二重加算なし
section(8, '二重加算なし(seed 20240608、1000 通り)', function () {
  var rnd = mulberry32(20240608), ok = true;
  for (var t = 0; t < 1000; t++) {
    var answers = new Array(15).fill(null);
    // 前へ進みながら答え、ときどき前の問に戻って答え直す(app.js の setAnswer と同じく、上書きだけ)
    for (var step = 0; step < 40; step++) {
      var q = Math.floor(rnd() * 15);
      answers[q] = Math.floor(rnd() * 4);
    }
    for (var q2 = 0; q2 < 15; q2++) { if (answers[q2] === null) { answers[q2] = Math.floor(rnd() * 4); } }
    var a = D.diagnose(answers), b = D.diagnose(answers.slice());
    if (JSON.stringify(a) !== JSON.stringify(b)) { ok = false; }
  }
  check(8, ok, '書き換えたあとの最終 answers の結果が、最初からその answers で答えた結果と一致(AC-5)');
});

// ================================================================ #9 質問の感度
section(9, '質問の感度(質問ごとに 4,000 通り、seed 20240609 + q×1000)', function () {
  var rates = [];
  for (var q = 0; q < NQ; q++) {
    var rnd = mulberry32(20240609 + q * 1000), changed = 0;
    for (var t = 0; t < 4000; t++) {
      var a = tendencyAnswers(rnd);
      var top = D.diagnose(a).top.general.id;
      var b = a.slice();
      b[q] = (a[q] + 1 + Math.floor(rnd() * 3)) % 4;
      if (D.diagnose(b).top.general.id !== top) { changed += 1; }
    }
    rates.push(changed / 4000);
  }
  line('    ' + rates.map(function (r, i) { return 'Q' + (i + 1) + ' ' + (r * 100).toFixed(1) + '%'; }).join('  '));
  var mn = Math.min.apply(null, rates), mx = Math.max.apply(null, rates);
  check(9, mn >= 0.10, '1 問だけ変えたとき 1 位が変わる割合 ' + (mn * 100).toFixed(1) + '%〜' + (mx * 100).toFixed(1) + '%(基準: 全問 ≥ 10%)');
});

// ================================================================ #10 傾向スポットチェック
section(10, '傾向スポットチェック', function () {
  var SPOT = [
    ['統率重視', [3, 0, 0, 0, 0, 0], ['shimazu-yoshihiro', 'honda-tadakatsu', 'chosokabe-motochika']],
    ['行動重視', [0, 3, 0, 0, 0, 0], ['shimazu-yoshihiro', 'chosokabe-motochika', 'uesugi-kenshin', 'sanada-yukimura']],
    ['知略重視', [0, 0, 3, 0, 0, 0], ['akechi-mitsuhide', 'takenaka-hanbei', 'ishida-mitsunari', 'kuroda-kanbei']],
    ['社交重視', [0, 0, 0, 3, 0, 0], ['maeda-toshiie', 'toyotomi-hideyoshi', 'tachibana-muneshige']],
    ['慎重重視', [0, 0, 0, 0, 3, 0], ['mori-motonari', 'tokugawa-ieyasu', 'hojo-ujiyasu']],
    ['革新重視', [0, 0, 0, 0, 0, 3], ['oda-nobunaga', 'date-masamune', 'sanada-yukimura', 'chosokabe-motochika']],
    ['行動+革新', [0, 1, 0, 0, -1, 2], ['oda-nobunaga', 'date-masamune', 'sanada-yukimura']],
    ['知略+慎重', [0, -0.5, 2, 0, 2, 0], ['akechi-mitsuhide', 'ishida-mitsunari', 'mori-motonari', 'hojo-ujiyasu']]
  ];
  var okCount = 0;
  SPOT.forEach(function (s) {
    var d = D.diagnose(argmaxAnswers(s[1]));
    var ok = s[2].indexOf(d.top.general.id) >= 0;
    if (ok) { okCount += 1; }
    check(10, ok, s[0] + ': ' + d.top3.map(function (r) { return r.general.name + ' ' + r.similarity + '%'; }).join(' / ') + '(AC-13)');
  });
  line('    合格 ' + okCount + ' / ' + SPOT.length);
});

// ================================================================ #11 理由文
var reasonStats = {};
section(11, '理由文', function () {
  var P = Reason.PHRASES, W = Reason.GENERAL_WORDS;
  var problems = [];
  function verify(res, user, g, tag) {
    var bad = function (m) { if (problems.length < 8) { problems.push(tag + ' ' + g.id + ': ' + m); } };
    var ps = res.paragraphs;
    if (!Array.isArray(ps) || ps.length < 3) { bad('段落が 3 未満'); return; }
    if (ps.some(function (p) { return typeof p !== 'string' || /undefined|NaN|null/.test(p); })) { bad('undefined/NaN を含む'); }
    var sa = res.sharedAxes;
    if (!(sa.length === 2 && sa[0] !== sa[1])) { bad('(a) sharedAxes'); return; }
    // (b) P1 に両軸の句(levels.user の水準)が含まれる
    if (ps[0].indexOf(P[sa[0]][res.levels.user[0]]) < 0 || ps[0].indexOf(P[sa[1]][res.levels.user[1]]) < 0) { bad('(b) P1 の句'); }
    // (c) P3 に共通 2 軸のラベルがあり、他の 4 軸のラベルはない
    var idx0 = KEYS.indexOf(sa[0]), idx1 = KEYS.indexOf(sa[1]);
    LABELS.forEach(function (lab, i) {
      var has = ps[2].indexOf(lab) >= 0;
      if ((i === idx0 || i === idx1) !== has) { bad('(c) P3 のラベル ' + lab); }
    });
    // (d) P3 の水準語が levels.general と一致
    var head = g.name + 'も診断上は' + LABELS[idx0] + 'が' + W[res.levels.general[0]] + 'で、' + LABELS[idx1] + 'も' + W[res.levels.general[1]] + 'のタイプです。';
    if (ps[2].indexOf(head) !== 0) { bad('(d) P3 の水準語'); }
    // (d2) 形容詞に「で、」や「タイプ」を直接つなぐ崩れがない(例:「ほどよいで、」「高めタイプ」)
    //      (「中くらいで、」は名詞+「で」なので許す)
    if (/[^ら]いで、|[^の]タイプです/.test(ps[2])) { bad('(d2) P3 の語形'); }
    // levels.general は武将側の z 値の水準
    [0, 1].forEach(function (i) {
      var k = sa[i], z = (g[k] - D.AXIS_STATS.mean[k]) / D.AXIS_STATS.sd[k];
      var lv = z >= 0.6 ? 'high' : (z <= -0.6 ? 'low' : 'mid');
      if (res.levels.general[i] !== lv) { bad('levels.general'); }
    });
    // (e) diffAxis は共通軸に含まれない
    if (res.diffAxis !== null && sa.indexOf(res.diffAxis) >= 0) { bad('(e) diffAxis'); }
    if ((res.diffAxis !== null) !== (ps.length === 4)) { bad('P4 と diffAxis の対応'); }
    // (f) 共通軸でユーザー水準と武将水準が真逆でない(最終手段を使っていないとき)
    if (!res.usedOppositeFill) {
      [0, 1].forEach(function (i) {
        var k = sa[i], zu = (user[k] - D.AXIS_STATS.mean[k]) / D.AXIS_STATS.sd[k];
        var lu = zu >= 0.6 ? 'high' : (zu <= -0.6 ? 'low' : 'mid'), lg = res.levels.general[i];
        if ((lu === 'high' && lg === 'low') || (lu === 'low' && lg === 'high')) { bad('(f) 真逆の軸'); }
      });
    }
    // (i) allNear による文面の切り替え
    if (res.allNear) {
      if (ps[0].indexOf('ととても近い結果') < 0 || ps[2].indexOf('数値が近いことが') < 0) { bad('(i) allNear=true の文面'); }
    } else {
      if (ps[0].indexOf('と近い結果') < 0 || ps[2].indexOf('比較的近い軸でした') < 0 || ps[2].indexOf('数値が近いことが') >= 0) { bad('(i) allNear=false の文面'); }
    }
    if (ps[1] !== g.reason.history) { bad('P2 が reason.history でない'); }
  }

  // 全 20 人 × 乱数ユーザー 200 回
  var rnd = mulberry32(20240611), n = 0;
  Generals.forEach(function (g) {
    for (var t = 0; t < 200; t++) {
      var user = D.scoreUser(uniformAnswers(rnd));
      verify(Reason.build(user, g), user, g, '全員×200');
      n += 1;
    }
  });
  check(11, problems.length === 0, '全 ' + Generals.length + ' 人 × 200 回(' + n + ' 件)で 3 段落以上・(a)〜(f)・(i) を満たす(AC-28)' + (problems.length ? ': ' + problems.join(' | ') : ''));

  // 信長と逆向き(革新性・行動力が低い)の人工ユーザー
  problems = [];
  var oda = byId['oda-nobunaga'];
  var inv = { leadership: 46, action: 25, strategy: 41, social: 37, caution: 62, innovation: 20 };
  var ri = Reason.build(inv, oda);
  verify(ri, inv, oda, '逆向き');
  check(11, problems.length === 0, '信長と逆向きの人工ユーザーでも P1 と P3 が同じ 2 軸(' + ri.sharedAxes.join(',') + ')を述べる' + (problems.length ? ': ' + problems.join(' | ') : ''));

  // (ii) 異符号・差 ≤ 15 の軸(tier2)が補完より先に選ばれる
  var tg = { id: 'tier2-test', name: '検査用', reason: { history: '検査用の文として知られています。' },
    leadership: 58, action: 42, strategy: 60, social: 57, caution: 66, innovation: 63 };
  var tu = { leadership: 60, action: 51, strategy: 41, social: 37, caution: 46, innovation: 43 };
  var rt = Reason.build(tu, tg);
  check(11, rt.sharedAxes.join() === 'leadership,action' && rt.levels.user.join() === 'high,high' && rt.allNear === true,
    '(ii) 異符号・差 ≤ 15 の軸が補完より先に選ばれる: sharedAxes=' + rt.sharedAxes.join(',') + ' levels.user=' + rt.levels.user.join(',') + ' allNear=' + rt.allNear);

  // reason.history: 重複なし・文末・軸ラベルを含まない
  var hs = Generals.map(function (g) { return g.reason.history; });
  var dup = hs.filter(function (h, i) { return hs.indexOf(h) !== i; });
  var badEnd = Generals.filter(function (g) { return !/(知られています。|とされます。|と伝えられます。)$/.test(g.reason.history); }).map(function (g) { return g.id; });
  var withLabel = Generals.filter(function (g) { return LABELS.some(function (l) { return g.reason.history.indexOf(l) >= 0; }); }).map(function (g) { return g.id; });
  check(11, dup.length === 0, '20 人の reason.history が重複しない');
  check(11, badEnd.length === 0, '(h) reason.history の文末が「知られています。」「とされます。」「と伝えられます。」' + (badEnd.length ? ': ' + badEnd.join(',') : ''));
  check(11, withLabel.length === 0, '(iii) reason.history に軸ラベルを含まない' + (withLabel.length ? ': ' + withLabel.join(',') : ''));

  // (g) 1 位の組(一様 30,000・傾向付き 30,000)で最終手段が働かない。補完率を出力する(iv)
  problems = [];
  var total = 0, opp = 0, fill = 0, lvDiff = 0, lvTotal = 0;
  [[20240612, uniformAnswers, '一様'], [20240613, tendencyAnswers, '傾向付き']].forEach(function (c) {
    var r = mulberry32(c[0]);
    for (var t = 0; t < 30000; t++) {
      var d = D.diagnose(c[1](r));
      var res = Reason.build(d.user, d.top.general);
      verify(res, d.user, d.top.general, c[2]);
      total += 1;
      if (res.usedOppositeFill) { opp += 1; }
      if (!res.allNear) { fill += 1; }
      [0, 1].forEach(function (i) { lvTotal += 1; if (res.levels.user[i] !== res.levels.general[i]) { lvDiff += 1; } });
    }
  });
  reasonStats = { total: total, opp: opp, fillRate: fill / total, lvDiffRate: lvDiff / lvTotal };
  check(11, opp === 0 && problems.length === 0, '(g) 1 位の組 ' + total + ' 件で usedOppositeFill=0 件・整合性違反 ' + problems.length + ' 件' + (problems.length ? ': ' + problems.join(' | ') : ''));
  line('    (iv) 1 位の組での補完率 ' + (fill / total * 100).toFixed(2) + '%(目安 約 7%)、共通軸で水準が異なる割合 ' + (lvDiff / lvTotal * 100).toFixed(1) + '%');
});

// ================================================================ #12 ストレージ
section(12, 'ストレージ', function () {
  // 読み込み時の副作用なし
  check(12, lsTrap.installed, 'localStorage の罠を設置できた' + (lsTrap.error ? ': ' + lsTrap.error.message : ''));
  check(12, !storageLoad.error && lsTrap.hits === 0 && !storageLoad.windowDefined,
    'require(storage.js) で例外なし・localStorage への参照 ' + lsTrap.hits + ' 回・window 未定義のまま');
  var def = Storage.create();
  check(12, def.isPersistent() === false && lsTrap.hits === 0, 'create()(引数省略)は Node でメモリ版を返し、localStorage に触れない');
  // 罠を外す
  if (lsTrap.installed) {
    if (lsTrap.original) { Object.defineProperty(globalThis, 'localStorage', lsTrap.original); } else { delete globalThis.localStorage; }
  }

  var origWarn = console.warn, warned = 0;
  console.warn = function () { warned += 1; };
  try {
    var now = new Date(2025, 10, 1, 12, 0, 0);
    var clock = function () { return now; };
    function mock(opts) {
      opts = opts || {};
      var data = {};
      if (opts.preset) { Object.keys(opts.preset).forEach(function (k) { data[k] = opts.preset[k]; }); }
      return {
        data: data,
        getItem: function (k) { if (opts.getThrows) { throw new Error('get'); } return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) {
          if (opts.setThrows === true || (opts.setThrows === 'key' && k === Storage.KEY)) { throw new Error('quota'); }
          data[k] = String(v);
        },
        removeItem: function (k) { delete data[k]; }
      };
    }
    function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    // plan 項目 6 の Verify
    var s0 = Storage.create(null, function () { return new Date(2025, 10, 1); });
    s0.increment('oda-nobunaga'); s0.increment('oda-nobunaga');
    check(12, eq(s0.getCounts('total'), [{ id: 'oda-nobunaga', count: 2 }]) && eq(s0.listDates(), ['2025-11-01']) && s0.isPersistent() === false,
      'create(null, clock) で 2 回加算 → total [{oda-nobunaga,2}]・listDates [2025-11-01]・isPersistent=false');

    // 正常なモック + 日付別集計
    var m = mock();
    var s = Storage.create(m, clock);
    check(12, s.isPersistent() === true && eq(s.listDates(), []), '正常なモックで isPersistent=true、未加算の listDates は [](e)');
    s.increment('oda-nobunaga'); s.increment('oda-nobunaga'); s.increment('toyotomi-hideyoshi');
    now = new Date(2025, 10, 2, 9, 0, 0);
    var r1 = s.increment('oda-nobunaga');
    check(12, r1.ok === true && s.todayKey() === '2025-11-02', 'increment は {ok:true}、todayKey はクロックのローカル日付');
    check(12, eq(s.listDates(), ['2025-11-02', '2025-11-01']), '(a) listDates が降順 ' + JSON.stringify(s.listDates()));
    check(12, eq(s.getCounts('2025-11-01'), [{ id: 'oda-nobunaga', count: 2 }, { id: 'toyotomi-hideyoshi', count: 1 }]) &&
      eq(s.getCounts('2025-11-02'), [{ id: 'oda-nobunaga', count: 1 }]) &&
      eq(s.getCounts('today'), s.getCounts('2025-11-02')) &&
      eq(s.getCounts('total'), [{ id: 'oda-nobunaga', count: 3 }, { id: 'toyotomi-hideyoshi', count: 1 }]),
      '(b) 日付別・本日・累計の件数');
    check(12, s.getTotalPlayers('2025-11-01') === 3 && s.getTotalPlayers('total') === 4, '(c) getTotalPlayers');
    var badScopes = ['2025-1-1', 'foo', null, undefined, 123, '2024-01-01'];
    check(12, badScopes.every(function (sc) { return eq(s.getCounts(sc), []) && s.getTotalPlayers(sc) === 0; }), '(d) 不正な scope と保存されていない日付は [] と 0');
    var persisted = Storage.create(m, clock);
    check(12, eq(persisted.getCounts('total'), s.getCounts('total')), '同じストレージから作り直しても累計が保たれる');
    check(12, s.increment('unknown-general').ok === false && s.getTotalPlayers('total') === 4, '未知の id は加算しない');
    // 同数は SG.Generals の配列順
    var tie = Storage.create(null, clock);
    tie.increment('tachibana-muneshige'); tie.increment('oda-nobunaga');
    check(12, eq(tie.getCounts('total').map(function (r) { return r.id; }), ['oda-nobunaga', 'tachibana-muneshige']), '同数は武将の配列順');
    s.reset();
    check(12, eq(s.listDates(), []) && eq(s.getCounts('total'), []) && m.data[Storage.KEY] === undefined, '(f) reset() 後は空・キーも削除');

    // setItem が常に例外 → 最初からメモリ
    var sf = Storage.create(mock({ setThrows: true }), clock);
    var okf = sf.increment('oda-nobunaga');
    check(12, sf.isPersistent() === false && okf.ok === false && sf.getTotalPlayers('total') === 1, 'setItem が例外のモック → メモリで集計(例外なし)');
    // 保存だけ失敗(容量超過) → 途中からメモリ
    var sq = Storage.create(mock({ setThrows: 'key' }), clock);
    var before = sq.isPersistent();
    var okq = sq.increment('oda-nobunaga');
    check(12, before === true && okq.ok === false && sq.isPersistent() === false && sq.getTotalPlayers('total') === 1,
      '保存失敗で isPersistent=false に切り替わり、メモリの値は更新される');
    // getItem が例外
    var sg = Storage.create(mock({ getThrows: true }), clock);
    sg.increment('oda-nobunaga');
    check(12, sg.getTotalPlayers('total') === 1 && sg.isPersistent() === false, 'getItem が例外のモック → メモリで集計');
    // 無効(API を持たない)
    var sn = Storage.create({}, clock);
    sn.increment('oda-nobunaga');
    check(12, sn.isPersistent() === false && sn.getTotalPlayers('total') === 1, 'API を持たない storageLike → メモリで集計');

    // 壊れた JSON → 空として扱い、退避キーに保存。reset() で退避キーも消える
    var mb = mock({ preset: { 'sengoku-personality:v1:stats': '{broken' } });
    var sb = Storage.create(mb, clock);
    check(12, eq(sb.getCounts('total'), []) && mb.data[Storage.CORRUPT_KEY] === '{broken', '壊れた JSON は空として扱い、生文字列を退避する');
    sb.reset();
    check(12, mb.data[Storage.CORRUPT_KEY] === undefined && mb.data[Storage.KEY] === undefined, 'reset() で退避キーも削除される(NIT 9)');
    // v が違う
    var sv = Storage.create(mock({ preset: { 'sengoku-personality:v1:stats': JSON.stringify({ v: 2, total: { 'oda-nobunaga': 1 }, daily: {} }) } }), clock);
    check(12, eq(sv.getCounts('total'), []), 'v!==1 は空として扱う');
    // 不正な日付キー・未知の id・非整数・0 の修復
    var mr = mock({ preset: { 'sengoku-personality:v1:stats': JSON.stringify({ v: 1,
      total: { 'oda-nobunaga': 1, 'unknown': 5, 'kato-kiyomasa': 0, 'maeda-toshiie': 1.5, 'date-masamune': -2 },
      daily: { 'bad': { 'oda-nobunaga': 1 }, '2025-11-01': { 'oda-nobunaga': 1 }, '2025-11-03': { 'unknown': 3 } } }) } });
    var sr = Storage.create(mr, clock);
    check(12, eq(sr.listDates(), ['2025-11-01']) && eq(sr.getCounts('total'), [{ id: 'oda-nobunaga', count: 1 }]),
      '(g) 不正な日付キー・未知の id・非整数・0 以下は読み飛ばす: ' + JSON.stringify(sr.listDates()));
  } finally {
    console.warn = origWarn;
  }
  line('    (console.warn の呼び出し ' + warned + ' 回は想定どおりの縮退の通知)');
});

// ================================================================ #13 家紋 SVG
function assertWellFormedSvg(str) {
  var errs = [];
  // (c) 使ってよい実体は &amp; &lt; &gt; &quot; &#39; だけ
  if (/&(?!(?:amp|lt|gt|quot|#39);)/.test(str)) { errs.push('(c) 不正な実体'); }
  if (/<!--|<!\[CDATA\[/.test(str)) { errs.push('コメントまたは CDATA'); }
  var stack = [], re = /<[^>]*>/g, m, last = 0, rootCount = 0;
  while ((m = re.exec(str)) !== null) {
    var text = str.slice(last, m.index);
    if (text.indexOf('<') >= 0) { errs.push('テキスト中の <'); }
    if (stack.length === 0 && text.trim() !== '') { errs.push('ルート外のテキスト'); }
    last = re.lastIndex;
    var tag = m[0];
    if (/^<\//.test(tag)) {
      var nm = (/^<\/([A-Za-z][\w:.-]*)\s*>$/.exec(tag) || [])[1];
      if (!nm) { errs.push('終了タグの形式 ' + tag); continue; }
      var top = stack.pop();
      if (top !== nm) { errs.push('(b) 対応しない終了タグ </' + nm + '>(期待 ' + top + ')'); }
      continue;
    }
    var open = /^<([A-Za-z][\w:.-]*)/.exec(tag);
    if (!open) { errs.push('タグの形式 ' + tag.slice(0, 30)); continue; }
    if (stack.length === 0) { rootCount += 1; }
    var selfClose = /\/>$/.test(tag);
    var body = tag.slice(open[0].length, tag.length - (selfClose ? 2 : 1));
    // (a) 属性値はすべて二重引用符。(d) 属性値に生の < がない。属性名の重複もない
    var attrRe = /\s+([A-Za-z_:][\w:.-]*)="([^"]*)"/y, names = {}, pos = 0, am;
    attrRe.lastIndex = 0;
    while ((am = attrRe.exec(body)) !== null) {
      if (names[am[1]]) { errs.push('属性の重複 ' + am[1]); }
      names[am[1]] = true;
      if (am[2].indexOf('<') >= 0) { errs.push('(d) 属性値に <'); }
      pos = attrRe.lastIndex;
    }
    if (body.slice(pos).trim() !== '') { errs.push('(a) 二重引用符でない属性: ' + body.slice(pos, pos + 30)); }
    if (!selfClose) { stack.push(open[1]); }
  }
  if (str.slice(last).trim() !== '') { errs.push('末尾のテキスト'); }
  if (stack.length) { errs.push('(b) 閉じていない要素 ' + stack.join(',')); }
  if (rootCount !== 1) { errs.push('ルート要素が ' + rootCount + ' 個'); }
  return errs;
}
section(13, '家紋 SVG', function () {
  var FORBID = /<image|foreignObject|style|<script|<br/i;
  var problems = [], allIds = {}, dupAcross = 0;
  function inspect(str, tag) {
    var bad = function (msg) { if (problems.length < 8) { problems.push(tag + ': ' + msg); } };
    if (str.indexOf('<svg') !== 0) { bad('<svg で始まらない'); }
    if (str.slice(-6) !== '</svg>') { bad('</svg> で終わらない'); }
    if (FORBID.test(str)) { bad('禁止要素/属性を含む'); }
    var ids = (str.match(/\sid="[^"]*"/g) || []);
    var seen = {};
    ids.forEach(function (x) { if (seen[x]) { bad('id 重複 ' + x); } seen[x] = true; if (allIds[x]) { dupAcross += 1; } allIds[x] = true; });
    assertWellFormedSvg(str).forEach(bad);
    // 縁取りの text は paint-order を属性として持つ
    (str.match(/<text[^>]*stroke="#000000"[^>]*>/g) || []).forEach(function (t) { if (t.indexOf('paint-order="stroke"') < 0) { bad('paint-order がない'); } });
  }
  Generals.forEach(function (g) {
    inspect(Crest.svg(g), g.id);
    inspect(Crest.svg(g, { title: g.name }), g.id + '(title)');
  });
  check(13, problems.length === 0 && dupAcross === 0, '全 ' + Generals.length + ' 人(title あり/なし)で <svg〜</svg>・id 重複なし(画面内の複数インスタンス間も)・禁止要素なし・XML 整形式' +
    (problems.length ? ': ' + problems.join(' | ') : '') + (dupAcross ? ' / インスタンス間の id 重複 ' + dupAcross : ''));
  // 未知の kind はフォールバック
  problems = [];
  var unknown = { id: 'x', name: '未知', crest: { kind: 'no-such-kind', pattern: 'no-such-pattern', bg1: '#111111', bg2: '#000000', accent: '#f0c75e', display: '未知' } };
  var su = Crest.svg(unknown);
  inspect(su, 'unknown');
  check(13, problems.length === 0 && su.indexOf('stroke-width="14"') >= 0, '未知の kind/pattern でも例外なく rings で代用');
  // エスケープ
  problems = [];
  var evil = { id: 'evil', name: '信長&"<>\'', crest: { kind: 'glyph', pattern: 'kikkou', bg1: '#111111', bg2: '#000000', accent: '#f0c75e', glyph: '<', display: '&<\'' } };
  inspect(Crest.svg(evil, { title: '信長&"<>' }), 'escape');
  check(13, problems.length === 0, 'name/display/glyph/title に & < > " \' を含めてもエスケープされ整形式');
  // title オプション
  var st = Crest.svg(Generals[0], { title: '信長&"<>' });
  var afterOpen = st.slice(st.indexOf('>') + 1);
  check(13, afterOpen.indexOf('<title>信長&amp;&quot;&lt;&gt;</title>') === 0, 'title は <svg> の最初の子で内容がエスケープされる');
  check(13, Crest.svg(Generals[0]).indexOf('<title') < 0 && Crest.svg(Generals[0], { title: '' }).indexOf('<title') < 0, 'title 省略・空文字列では <title> を出さない');
  check(13, Crest.dataUri(Generals[0]).indexOf('data:image/svg+xml') === 0 && decodeURIComponent(Crest.dataUri(Generals[0]).split(',').slice(1).join(',')).indexOf('<title') < 0,
    'dataUri() は data:image/svg+xml で title なし');
  check(13, Crest.kinds.length === 17 && Crest.patterns.length === 6, 'kind 17 種・pattern 6 種');
  // SG.Util.esc のユニットテスト
  check(13, Util.esc('&<>"\'') === '&amp;&lt;&gt;&quot;&#39;' && Util.esc(null) === '' && Util.esc(undefined) === '' && Util.esc(0) === '0' && Util.esc('&amp;') === '&amp;amp;',
    'SG.Util.esc の 5 文字変換と null/undefined');
});

// ================================================================ #15 位置バイアス
section(15, '位置バイアス(各 20,000 通り、seed 20240615 + X×10 + round(p×100))', function () {
  var N = 20000, worst = { 0.7: 0, 0.85: 0 };
  [0.7, 0.85].forEach(function (p) {
    for (var x = 0; x < 4; x++) {
      var rnd = mulberry32(20240615 + x * 10 + Math.round(p * 100)), tops = [];
      for (var t = 0; t < N; t++) {
        var a = [];
        for (var q = 0; q < NQ; q++) { a.push(rnd() < p ? x : Math.floor(rnd() * 4)); }
        tops.push(D.diagnose(a).top.general.id);
      }
      var rows = tally(tops), max = rows[0];
      var appeared = rows.filter(function (r) { return r.count > 0; }).length;
      var limit = p === 0.7 ? 0.25 : 0.40;
      worst[p] = Math.max(worst[p], max.count / N);
      check(15, max.count / N <= limit && appeared >= 18,
        'p=' + p + ' 全' + 'ABCD'.charAt(x) + ' 寄り: 最多 ' + pad(nameOf(max.id), 7) + ' ' + pct(max.count, N) + '・出現 ' + appeared + '人(基準 ≤ ' + (limit * 100) + '%・18 人以上、AC-30)');
    }
  });
  line('    最大: p=0.7 ' + (worst[0.7] * 100).toFixed(1) + '%、p=0.85 ' + (worst[0.85] * 100).toFixed(1) + '%');
});

// ================================================================ #16 集団バイアス耐性
section(16, '集団バイアス耐性(各 20,000 通り、seed 20240701 + 集団×10 + round(β×100))', function () {
  var GROUPS = [
    ['協調寄り', [0, 0, 0, 1, 1, -1]],
    ['大胆寄り', [1, 1, 0, 0, -1, 1]],
    ['社交', [0, 0, 0, 1, 0, 0]],
    ['慎重', [0, 0, 0, 0, 1, 0]],
    ['知略', [0, 0, 1, 0, 0, 0]]
  ];
  var N = 20000;
  [0.10, 0.15].forEach(function (beta) {
    GROUPS.forEach(function (gp, gi) {
      var rnd = mulberry32(20240701 + gi * 10 + Math.round(beta * 100)), tops = [];
      for (var t = 0; t < N; t++) { tops.push(D.diagnose(biasedAnswersWith(rnd, gp[1], beta)).top.general.id); }
      var rows = tally(tops), max = rows[0], min = rows[rows.length - 1];
      var over = rows.filter(function (r) { return r.count >= N * 0.001; }).length;
      var msg = 'β=' + beta.toFixed(2) + ' ' + pad(gp[0], 4) + ': 最多 ' + pad(nameOf(max.id), 7) + ' ' + pct(max.count, N) +
        '・最少 ' + pad(nameOf(min.id), 7) + ' ' + pct(min.count, N) + '・0.1% 以上 ' + over + '人';
      if (beta === 0.10) {
        check(16, max.count / N <= 0.25 && over >= 18, msg + '(基準 ≤ 25%・18 人以上、AC-32)');
      } else {
        line('       ' + msg);
        if (max.count / N > 0.35) { warn(16, msg + '(β=0.15 で最多が 35% 超)'); }
      }
    });
  });
});

// ================================================================ #17 上位の差(表示のみ)
section(17, '上位の差(表示のみ。#2 の標本)', function () {
  var g = uniform.gaps.slice().sort(function (a, b) { return a - b; });
  var median = g[Math.floor((g.length - 1) * 0.5)], p90 = g[Math.floor((g.length - 1) * 0.9)];
  var exactSame = uniform.top12exact / N_UNI;
  line('    整数%で 1 位と 2 位が同じ ' + pct(uniform.top12int, N_UNI) + '、1〜3 位が同じ ' + pct(uniform.top123int, N_UNI) +
    '、小数 1 桁で 1 位と 2 位が同じ ' + pct(uniform.top12exact, N_UNI) + '、1 位−2 位の差 中央値 ' + median.toFixed(1) + '・p90 ' + p90.toFixed(1));
  if (exactSame > 0.05) { warn(17, '小数 1 桁で 1 位と 2 位が同じ割合が 5% を超えた(' + (exactSame * 100).toFixed(2) + '%、AC-33)'); }
  else { pass(17, '出力済み(小数 1 桁が同じ割合 ' + (exactSame * 100).toFixed(2) + '% ≤ 5%、AC-33)'); }
});

section(18, '来場者向けランキング(buildRows)', function () {
  check(18, !playerRankingLoad.error && playerRankingHits === 0 && typeof PlayerRanking.buildRows === 'function',
    'require(player-ranking.js) で例外なし・localStorage への参照 ' + playerRankingHits + ' 回');
  var B = PlayerRanking.buildRows;
  check(18, Array.isArray(B([])) && B([]).length === 0, '0 件は空配列');
  var counts = [{ id: 'a', count: 25 }, { id: 'b', count: 15 }, { id: 'c', count: 10 }, { id: 'd', count: 7 }, { id: 'e', count: 3 }];
  var rows = B(counts, 'c');
  check(18, rows.length === 5, '行数が入力と同じ(' + rows.length + ')');
  check(18, rows.every(function (r, i) { return r.rank === i + 1 && r.id === counts[i].id && r.count === counts[i].count; }),
    '順位が 1 からの連番で、件数の降順が保たれる');
  var counts2 = counts.map(function (r) { return r.count; });
  check(18, rows.every(function (r, i) { return i === 0 || rows[i - 1].count >= r.count; }), '件数が降順(' + counts2.join(',') + ')');
  check(18, rows[0].percent === 42 && rows[1].percent === 25 && rows[3].percent === 12 && rows[4].percent === 5, '割合は四捨五入(25/60=42、15/60=25、7/60=12、3/60=5)');
  check(18, rows[0].widthPct === 100 && rows.every(function (r) { return r.widthPct > 0 && r.widthPct <= 100; }), '横棒は 1 位が 100 で最大 100');
  check(18, rows.map(function (r) { return r.tier; }).join(',') === 'gold,silver,bronze,,', 'tier は 1〜3 位だけ gold/silver/bronze');
  check(18, rows.filter(function (r) { return r.isMe; }).length === 1 && rows[2].isMe, 'highlightId の行だけ isMe');
  check(18, B(counts).every(function (r) { return r.isMe === false; }), 'highlightId なしなら isMe はなし');
});

section(19, '武将図鑑(reading / sortGenerals: 五十音順)', function () {
  check(19, !zukanLoad.error && zukanHits === 0 && typeof Zukan.sortGenerals === 'function',
    'require(zukan.js) で例外なし・localStorage への参照 ' + zukanHits + ' 回');
  check(19, Generals.every(function (g) { return typeof g.reading === 'string' && /^[ぁ-ゖー]+$/.test(g.reading); }), '20 人全員にひらがなだけの reading がある');
  var before = Generals.map(function (g) { return g.id; }).join(',');
  var s = Zukan.sortGenerals(Generals);
  var ids = s.map(function (g) { return g.id; });
  check(19, s.length === 20 && s !== Generals && ids.filter(function (x, i) { return ids.indexOf(x) === i; }).length === 20, '20 件・id の重複なし・新しい配列');
  var expected = 'あけちみつひで,いしだみつなり,うえすぎけんしん,おだのぶなが,かとうきよまさ,くろだかんべえ,さなだゆきむら,しまづよしひろ,たけだしんげん,たけなかはんべえ,たちばなむねしげ,だてまさむね,ちょうそかべもとちか,とくがわいえやす,とよとみひでよし,なおえかねつぐ,ほうじょううじやす,ほんだただかつ,まえだとしいえ,もうりもとなり';
  line('  図鑑の順: ' + s.map(function (g) { return g.name + '(' + g.reading + ')'; }).join(' → '));
  check(19, s.map(function (g) { return g.reading; }).join(',') === expected, '読みの五十音順(あけち→…→もうり)に並ぶ');
  // 同じ読みなら元の順を保つ(安定)
  var dup = [{ id: 'x1', reading: 'あ' }, { id: 'x2', reading: 'い' }, { id: 'x3', reading: 'あ' }, { id: 'x4' }];
  check(19, Zukan.sortGenerals(dup).map(function (g) { return g.id; }).join(',') === 'x1,x3,x2,x4', '同じ読みは元の順(安定)・読みが無ければ末尾');
  check(19, Generals.map(function (g) { return g.id; }).join(',') === before, '元の配列(SG.Generals)を変更しない');
});

section(20, '相性ロジック(seed 20240620 一様 / 20240621 傾向付き β=0.45、各 30,000 通り)', function () {
  check(20, !compatLoad.error && compatHits === 0 && typeof Compat.build === 'function',
    'require(compat.js) で例外なし・localStorage への参照 ' + compatHits + ' 回');
  var valid = false;
  try { valid = Compat.validateData() === true; } catch (e) { line('  validateData: ' + e.message); }
  check(20, valid, '文言表が揃い、場面別アドバイスが 60 文字以内');
  check(20, Math.abs(Compat.WEIGHTS.closeness + Compat.WEIGHTS.complement - 1) < 1e-9, '重みの合計が 1');

  var N = 30000;
  [{ name: '一様乱数', seed: 20240620, gen: uniformAnswers }, { name: '傾向付き(β=0.45)', seed: 20240621, gen: tendencyAnswers }].forEach(function (cfg) {
    var rnd = mulberry32(cfg.seed);
    var first = {}, inTop = {}, stimCnt = {};
    var bad = { range: 0, selfIncluded: 0, overlap: 0, count: 0, order: 0, nondeterministic: 0, mutated: 0, texts: 0 };
    for (var t = 0; t < N; t++) {
      var ans = cfg.gen(rnd);
      var d = D.diagnose(ans);
      var snap = JSON.stringify(d.user) + d.top.general.id;
      var r1 = Compat.build(d);
      if (t < 2000 && JSON.stringify(r1) !== JSON.stringify(Compat.build(D.diagnose(ans)))) { bad.nondeterministic += 1; }
      if (JSON.stringify(d.user) + d.top.general.id !== snap) { bad.mutated += 1; }
      var ids = r1.partners.map(function (p) { return p.general.id; });
      if (r1.partners.length !== 3 || !r1.stimulus) { bad.count += 1; continue; }
      if (ids.indexOf(d.top.general.id) >= 0 || r1.stimulus.general.id === d.top.general.id) { bad.selfIncluded += 1; }
      if (ids.indexOf(r1.stimulus.general.id) >= 0 || ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) { bad.overlap += 1; }
      r1.partners.forEach(function (p, i) {
        if (!(isFinite(p.score) && p.score >= 0 && p.score <= 100 && isFinite(p.percent) && p.percent >= 0 && p.percent <= 100)) { bad.range += 1; }
        if (i > 0) {
          var q = r1.partners[i - 1];
          var kp = Math.round(p.score * 1e6), kq = Math.round(q.score * 1e6);
          if (kq < kp || (kq === kp && q.index > p.index)) { bad.order += 1; }
        }
      });
      if (r1.scenes.length !== 3 || r1.scenes.some(function (s) { return !s.text; }) || !r1.types.complement.length || !r1.types.same) { bad.texts += 1; }
      first[ids[0]] = (first[ids[0]] || 0) + 1;
      ids.forEach(function (id) { inTop[id] = (inTop[id] || 0) + 1; });
      stimCnt[r1.stimulus.general.id] = (stimCnt[r1.stimulus.general.id] || 0) + 1;
    }
    function maxOf(o) { return Math.max.apply(null, Object.keys(o).map(function (k) { return o[k]; })); }
    var maxFirst = maxOf(first) / N, maxStim = maxOf(stimCnt) / N;
    var appear = Object.keys(inTop).length;
    var appear2 = Object.keys(inTop).filter(function (id) { return inTop[id] / N >= 0.02; }).length;
    var zeroFirst = Generals.filter(function (g) { return !first[g.id]; }).length;
    var rows = Object.keys(first).sort(function (a, b) { return first[b] - first[a]; }).slice(0, 5)
      .map(function (id) { return nameOf(id) + ' ' + pct(first[id], N); }).join(' / ');
    line('  [' + cfg.name + '] 相性 1 位の上位: ' + rows);
    line('  [' + cfg.name + '] 相性 1 位の最多 ' + (maxFirst * 100).toFixed(1) + '% / 1 位が 0 回の武将 ' + zeroFirst + ' 人 / 上位 3 に出る武将 ' + appear +
      ' 人(2% 以上 ' + appear2 + ' 人)/ 刺激枠の最多 ' + (maxStim * 100).toFixed(1) + '%');
    check(20, maxFirst <= 0.25, cfg.name + ': 相性 1 位の最多が 25% 以下(' + (maxFirst * 100).toFixed(1) + '%)');
    check(20, appear >= 18 && appear2 >= 12, cfg.name + ': 上位 3 に 1 回以上出る ' + appear + ' 人(≥18)/ 2% 以上 ' + appear2 + ' 人(≥12)');
    check(20, maxStim <= 0.30, cfg.name + ': 刺激枠の最多が 30% 以下(' + (maxStim * 100).toFixed(1) + '%)');
    check(20, bad.count === 0 && bad.selfIncluded === 0 && bad.overlap === 0,
      cfg.name + ': 候補に診断 1 位を含まず、上位 3 と刺激枠が重複しない(件数不備 ' + bad.count + ' / 自分 ' + bad.selfIncluded + ' / 重複 ' + bad.overlap + ')');
    check(20, bad.nondeterministic === 0, cfg.name + ': 同じ回答なら結果が完全一致(先頭 2,000 通り)');
    check(20, bad.range === 0 && bad.order === 0, cfg.name + ': score / percent が 0〜100 の有限値・降順で同点は配列順(範囲 ' + bad.range + ' / 並び ' + bad.order + ')');
    check(20, bad.mutated === 0 && bad.texts === 0, cfg.name + ': 入力 diagnosis を変更せず、タイプ・場面の文言が必ず出る');
  });

  // 同点の安定性: 全武将が同じ値(全員同じ 6 値)なら index 昇順になる
  var flat = Generals.slice(0, 5).map(function (g, i) { return Object.assign({}, g, { id: 'f' + i, leadership: 50, action: 50, strategy: 50, social: 50, caution: 50, innovation: 50 }); });
  var sc = Compat.scoreAll({ leadership: 50, action: 50, strategy: 50, social: 50, caution: 50, innovation: 50 }, flat);
  check(20, sc.length === 5 && sc.every(function (r, i) { return r.index === i && r.score === sc[0].score; }), 'scoreAll は入力と同じ index 順で、同条件なら同点(選出時は配列順)');
});

line('');
if (failCount === 0) {
  line('RESULT: ALL PASS (warnings: ' + warnCount + ')');
} else {
  line('RESULT: FAIL (' + failCount + ')');
  process.exitCode = 1;
}
