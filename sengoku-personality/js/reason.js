/*
 * reason.js — SG.Reason
 * 「あなたとこの武将が似ている理由」の文章を自動生成する(純粋関数。DOM には触れない)。
 * P1(あなたの特徴)と P3(武将側の診断上の水準)は、必ず同じ 2 軸(sharedAxes)から作るので、
 * 文章どうしが矛盾しない。P2 は武将固有の史実 1 文(generals.js の reason.history)。
 * 史実の文と診断上の解釈は段落を分けて書き、混同させない。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  // ユーザー側の水準ごとの句(P1 用)
  var PHRASES = {
    leadership: { high: '周囲をまとめて導く統率力', mid: 'ほどよく場をまとめるバランス感覚', low: '一歩引いて全体を見守る姿勢' },
    action: { high: '迷わず決断して動く行動力', mid: '状況を見ながら動き出す柔軟さ', low: 'じっくり構える落ち着き' },
    strategy: { high: '先を読んで考え抜く知略', mid: '状況に応じて頭を使う判断力', low: '直感を大切にするひらめき' },
    social: { high: '人と協力して関係を築く社交性', mid: 'ほどよい距離感の人付き合い', low: '自分の信念を貫くマイペースさ' },
    caution: { high: 'リスクを見極める慎重さ', mid: '慎重さと大胆さのバランス', low: '恐れずに踏み出す大胆さ' },
    innovation: { high: '常識にとらわれない革新性', mid: '新旧を取り入れる柔軟な発想', low: '実績ある方法を大切にする堅実さ' }
  };
  // 武将側の水準語(P3 用)。「〜で、」「〜のタイプ」の両方に自然につながるよう、すべて名詞的な語にする
  var GENERAL_WORDS = { high: '高め', mid: '中くらい', low: '控えめ' };

  var NEAR_DIFF = 15;     // 「数値が近い」とみなす差
  var DIFF_SENTENCE = 25; // 相違の 1 文(P4)を足す差

  function level(z) {
    if (z >= 0.6) { return 'high'; }
    if (z <= -0.6) { return 'low'; }
    return 'mid';
  }

  function byStrength(a, b) { return (b.strength - a.strength) || (a.diff - b.diff) || (a.idx - b.idx); }
  function byDiff(a, b) { return (a.diff - b.diff) || (a.idx - b.idx); }

  // user: 丸める前のユーザー 6 値、general: 1 位の武将
  function build(user, general) {
    var D = root.SG.Diagnosis;
    var AXES = D.AXES;
    var mean = D.AXIS_STATS.mean, sd = D.AXIS_STATS.sd;

    // 手順 1・2: 各軸の z 値・差・水準を求める
    var axes = AXES.map(function (ax, idx) {
      var zu = (user[ax.key] - mean[ax.key]) / sd[ax.key];
      var zg = (general[ax.key] - mean[ax.key]) / sd[ax.key];
      var lu = level(zu), lg = level(zg);
      return {
        key: ax.key, label: ax.label, idx: idx, zu: zu, zg: zg, lu: lu, lg: lg,
        diff: Math.abs(user[ax.key] - general[ax.key]),
        sameSign: zu * zg > 0,
        opposite: (lu === 'high' && lg === 'low') || (lu === 'low' && lg === 'high'),
        strength: (Math.abs(zu) + Math.abs(zg)) / 2
      };
    });

    // 手順 3: 共通軸を 2 本選ぶ。
    //   tier1: 真逆でなく差 ≤ 15 で同符号の軸(強さ順)→ tier2: 差 ≤ 15 で異符号の軸(強さ順)
    //   → 補完: 真逆でない残りの軸を差の小さい順 → 最終手段: 真逆の軸を差の小さい順
    var eligible = axes.filter(function (a) { return !a.opposite; });
    var near = eligible.filter(function (a) { return a.diff <= NEAR_DIFF; });
    var picked = near.filter(function (a) { return a.sameSign; }).sort(byStrength)
      .concat(near.filter(function (a) { return !a.sameSign; }).sort(byStrength))
      .slice(0, 2)
      .map(function (a) { return { axis: a, userLevel: a.lu, fromNear: true }; });

    function isPicked(a) { return picked.some(function (p) { return p.axis === a; }); }

    var usedOppositeFill = false;
    if (picked.length < 2) {
      // 補完した軸は、ユーザー側の句を mid にする(P1 の句 = levels.user の水準の句)
      eligible.filter(function (a) { return !isPicked(a); }).sort(byDiff).forEach(function (a) {
        if (picked.length < 2) { picked.push({ axis: a, userLevel: 'mid' }); }
      });
    }
    if (picked.length < 2) {
      axes.filter(function (a) { return a.opposite && !isPicked(a); }).sort(byDiff).forEach(function (a) {
        if (picked.length < 2) { picked.push({ axis: a, userLevel: 'mid' }); usedOppositeFill = true; }
      });
    }
    // 補完なし(2 軸とも差 ≤ 15 の候補から選べた)のときだけ「とても近い」と書く
    var allNear = !picked.some(function (p) { return !p.fromNear; });

    var a0 = picked[0].axis, a1 = picked[1].axis;
    var levelsUser = [picked[0].userLevel, picked[1].userLevel];
    var levelsGeneral = [a0.lg, a1.lg];
    var name = general.name;

    // 手順 5: 相違軸(共通軸以外で差が最大。25 以上のときだけ 1 文足す)
    var diffAxis = null;
    var maxDiff = -1;
    axes.forEach(function (a) {
      if (a === a0 || a === a1) { return; }
      if (a.diff > maxDiff) { maxDiff = a.diff; diffAxis = a; }
    });
    if (!diffAxis || diffAxis.diff < DIFF_SENTENCE) { diffAxis = null; }

    var paragraphs = [];
    // P1: ユーザー側の特徴(ユーザー水準の句)
    paragraphs.push('あなたは' + PHRASES[a0.key][levelsUser[0]] + 'と' + PHRASES[a1.key][levelsUser[1]] +
      'が特徴です。診断のモデルでは、この2点が' + name + 'と' + (allNear ? 'とても近い' : '近い') + '結果になりました。');
    // P2: 武将固有の史実 1 文
    paragraphs.push(general.reason.history);
    // P3: 武将側の診断上の水準(P1 と同じ 2 軸だけを述べる)
    paragraphs.push(name + 'も診断上は' + a0.label + 'が' + GENERAL_WORDS[levelsGeneral[0]] + 'で、' +
      a1.label + 'も' + GENERAL_WORDS[levelsGeneral[1]] + 'のタイプです。' +
      (allNear ? 'この2つの軸の数値が近いことが、今回の診断での共通点です。'
               : a0.label + 'と' + a1.label + 'は、今回の診断では比較的近い軸でした。'));
    // P4: 相違(条件付き)
    if (diffAxis) {
      paragraphs.push('一方、' + diffAxis.label + 'は' + name + 'のモデルのほうが' +
        (general[diffAxis.key] > user[diffAxis.key] ? '高め' : '低め') + 'です。');
    }

    return {
      paragraphs: paragraphs,
      sharedAxes: [a0.key, a1.key],
      levels: { user: levelsUser, general: levelsGeneral },
      diffAxis: diffAxis ? diffAxis.key : null,
      usedOppositeFill: usedOppositeFill,
      allNear: allNear
    };
  }

  (function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
  })({ p: PHRASES, g: GENERAL_WORDS });

  SG.Reason = { build: build, PHRASES: PHRASES, GENERAL_WORDS: GENERAL_WORDS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Reason; }
})(typeof window !== 'undefined' ? window : globalThis);
