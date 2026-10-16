/*
 * compat.js — SG.Compat
 * 結果画面の「相性診断」の計算と文言を担当する(純粋関数。DOM・保存領域・日時・乱数には一切触れない)。
 *
 * 考え方(エンターテインメント用の仮想モデル。科学的根拠や史実の人間関係を表すものではない):
 *   相性度 = 近さ(気が合う度合い)× WEIGHTS.closeness + 補完度(自分の弱みを補ってくれる度合い)× WEIGHTS.complement
 *   診断結果(1 位の武将・類似度・順位)は一切変更しない。結果確定後に「追加で表示する」ためだけに使う。
 *   武将データは SG.Generals だけを情報源にし、複製しない(武将を追加・変更しても自動で追従する)。
 *   同じ回答なら必ず同じ結果(乱数・日時を使わない)。同点は SG.Generals の並び順(index の小さい方)が先。
 *
 * 文言の変更方法: このファイルの先頭にある「文言データ」(TYPE_COMPLEMENT / TYPE_SAME / ADVICE / テンプレート)を編集する。
 * 重みの変更方法: WEIGHTS(合計 1)と DREF を編集し、`node tools\simulate.js` の #20 が通ることを確認する。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  // =====================================================================
  // 文言データ(ここを編集すれば文言を変えられる)
  // 理由文は必ず「診断用の性格モデルでは〜」で始め、史実は書かない。前向きで親しみやすい文体にする。
  // =====================================================================

  // 軸の並び(計算順・同値のときの優先順)。diagnosis.js の AXES と同じ並びであること(validateData で確認)
  var KEYS = ['leadership', 'action', 'strategy', 'social', 'caution', 'innovation'];

  // 「補ってほしい軸」ごとの、相性の良い性格タイプ名(補完型)
  var TYPE_COMPLEMENT = {
    leadership: 'みんなを引っぱる頼れるまとめ役タイプ',
    action: 'まず動いて場を前に進める行動派タイプ',
    strategy: '慎重で計画的な参謀タイプ',
    social: '明るく人をつなぐ社交タイプ',
    caution: '落ち着いてリスクを見てくれる堅実タイプ',
    innovation: '新しい発想で風を通すひらめきタイプ'
  };

  // 「自分の一番高い軸」ごとの、気が合う性格タイプの説明(同調型)
  var TYPE_SAME = {
    leadership: 'あなたと同じく、みんなをまとめる統率力を大切にする、気が合うタイプ',
    action: 'あなたと同じく、思い立ったらすぐ動く行動力を大切にする、気が合うタイプ',
    strategy: 'あなたと同じく、先を読んで考える知略を大切にする、気が合うタイプ',
    social: 'あなたと同じく、人とのつながりを大切にする社交性のある、気が合うタイプ',
    caution: 'あなたと同じく、物事を慎重に見極めることを大切にする、気が合うタイプ',
    innovation: 'あなたと同じく、新しい発想や変化を楽しむ革新性のある、気が合うタイプ'
  };

  // 弱みが目立たないときに足す一文
  var BALANCED_TEXT = '大きな弱点が少ないバランス型なので、どんなタイプの人とも組みやすいのがあなたの持ち味です。';

  // 日常場面。key は ADVICE のキー。pick は「どの軸でアドバイスを選ぶか」
  //   strong = あなたの一番高い軸(同調型) / weak0 = 補ってほしい軸 1 つ目(補完型) / weak1 = 2 つ目(無ければ weak0)
  var SCENES = [
    { key: 'friend', label: '友だちになるなら', pick: 'strong' },
    { key: 'group', label: '一緒にグループを組むなら', pick: 'weak0' },
    { key: 'club', label: '部活・サークルで頼れるのは', pick: 'weak1' }
  ];

  // 場面別アドバイス(各 60 文字以内。断定せず、命令口調にしない)
  var ADVICE = {
    friend: {
      leadership: '目標を語り合える、引っぱる力のある人とは、頼もしい友だちになれそうです。',
      action: 'フットワークの軽い人とは、思い立ってすぐ出かけられる気軽な友だちになれそうです。',
      strategy: 'じっくり考えるのが好きな人とは、話し込める深い友だちになれそうです。',
      social: '人づきあいが好きな人とは、会うだけで場が明るくなる友だちになれそうです。',
      caution: '慎重な人とは、安心して何でも相談できる友だちになれそうです。',
      innovation: '新しいもの好きな人とは、おもしろいことを一緒に見つけられそうです。'
    },
    group: {
      leadership: 'まとめ役が得意な人がいると、グループの進む方向が定まりやすくなりそうです。',
      action: 'まず動ける人がいると、話し合いで止まっても前に進めそうです。',
      strategy: '段取り上手な人がいると、計画が整って落ち着いて進められそうです。',
      social: '人をつなぐのが上手な人がいると、グループの雰囲気がやわらぎそうです。',
      caution: 'リスクに気づける人がいると、見落としが減って安心して進められそうです。',
      innovation: 'ひらめきのある人がいると、行き詰まったときに新しい道が見つかりそうです。'
    },
    club: {
      leadership: 'みんなを引っぱってくれる人が頼れる存在になりそうです。',
      action: 'すぐ動いて準備を進める人が頼れる存在になりそうです。',
      strategy: '計画を立てて段取りを組む人が頼れる存在になりそうです。',
      social: '新しい仲間とも打ち解ける人が頼れる存在になりそうです。',
      caution: 'お金や日程をしっかり見る人が頼れる存在になりそうです。',
      innovation: '新企画を思いつく人が頼れる存在になりそうです。'
    }
  };
  var ADVICE_MAX_CHARS = 60;

  // 相性武将カードの一言(理由)のテンプレート。{name}={武将名}、{axis}={軸名}、{weak}={補ってほしい軸名}
  var REASON_COMPLEMENT = '診断用の性格モデルでは、{name}は{axis}が高めで、あなたの{weak}を補ってくれる相手です。';
  var REASON_SAME = '診断用の性格モデルでは、{name}とは全体の傾向が近く、{strong}を大切にする気が合う相手です。';
  var REASON_STIMULUS = '診断用の性格モデルでは、{name}は{axis}の傾向が大きく違う相手。ぶつかることもありますが、新しい見方をもらえて成長できます。';
  var LABEL_COMPLEMENT = '補い合う相性';
  var LABEL_SAME = '気が合う相性';

  // 小さく表示する注記
  var NOTE = '※ 相性は診断用の性格モデルによるエンタメ向けの目安です。科学的な根拠のあるものではなく、史実の人間関係を表すものでもありません。';

  // =====================================================================
  // 式のパラメータ(根拠は README の「相性診断」と tools/simulate.js #20 を参照)
  // =====================================================================

  // 相性度 = 100 × (closeness × 近さ + complement × 補完度)。合計 1 にすること
  var WEIGHTS = { closeness: 0.5, complement: 0.5 };
  // 近さの基準距離。6 軸の最大距離(100×√6)の半分で近さ 0 になるよう引き伸ばす(診断の類似度の式は変更しない)
  var DREF = Math.sqrt(6) * 100 / 2;
  // 補完度で、相手の「武将平均からの高さ」を頭打ちにする標準偏差の数(+2σ で供給度 1)
  var SUPPLY_CAP = 2;
  // 「弱み」とみなす標準化値のしきい値(一様乱数回答の平均・SD に対する位置)
  var WEAK_Z = -0.3;
  // 「ぶつかるけど成長できる相手」の重み(違い 0.6 + 補完 0.4)
  var STIMULUS_WEIGHTS = { difference: 0.6, complement: 0.4 };
  // 表示用の相性度(%)への換算: percent = round(PERCENT_BASE + PERCENT_SLOPE × score)。順位・選出には使わない
  var PERCENT_BASE = 55;
  var PERCENT_SLOPE = 0.45;
  var PARTNER_COUNT = 3;

  // =====================================================================
  // 計算
  // =====================================================================

  function generalsList() { return root.SG.Generals; }
  function axes() { return root.SG.Diagnosis.AXES; }
  function labelOf(key) {
    var a = axes();
    for (var i = 0; i < a.length; i++) { if (a[i].key === key) { return a[i].label; } }
    return key;
  }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function fill(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m; });
  }

  // 武将 6 値の平均と標準偏差(母標準偏差)。SG.Generals の参照をキーにキャッシュする(ハードコードしない)
  var statCache = { ref: null, len: -1, mean: null, sd: null };
  function generalStats(list) {
    if (statCache.ref === list && statCache.len === list.length) { return statCache; }
    var mean = {}, sd = {};
    KEYS.forEach(function (k) {
      var sum = 0, i;
      for (i = 0; i < list.length; i++) { sum += list[i][k]; }
      var m = sum / list.length, v = 0;
      for (i = 0; i < list.length; i++) { v += (list[i][k] - m) * (list[i][k] - m); }
      mean[k] = m;
      sd[k] = Math.sqrt(v / list.length) || 1; // 全員同じ値でも 0 除算にしない
    });
    statCache = { ref: list, len: list.length, mean: mean, sd: sd };
    return statCache;
  }

  // ユーザーの標準化値(一様乱数回答の平均・SD に対する位置。低い=弱み)
  function userZ(user) {
    var st = root.SG.Diagnosis.AXIS_STATS;
    var z = {};
    KEYS.forEach(function (k) { z[k] = (user[k] - st.mean[k]) / st.sd[k]; });
    return z;
  }

  // 全武将の素点を返す(index 順)。user: 丸めなし 6 値、generals: 省略時は SG.Generals
  // 各行: { index, general, score(0〜100), closeness(0〜1), complement(0〜1), contrib(補完に最も寄与した軸), diffAxis(最も違う軸) }
  function scoreAll(user, generals) {
    var list = generals || generalsList();
    var gs = generalStats(list);
    var zu = userZ(user);
    // 必要度: 平均より低い軸ほど大きい
    var need = {}, needSum = 0;
    KEYS.forEach(function (k) { need[k] = Math.max(0, -zu[k]); needSum += need[k]; });

    return list.map(function (g, index) {
      var d2 = 0, diffAxis = KEYS[0], diffMax = -1;
      KEYS.forEach(function (k) {
        var diff = Math.abs(user[k] - g[k]);
        d2 += diff * diff;
        if (diff > diffMax) { diffMax = diff; diffAxis = k; } // 同値は KEYS 順で先の軸
      });
      var closeness = Math.max(0, 1 - Math.sqrt(d2) / DREF);

      var complement = 0, contrib = null, contribMax = 0;
      if (needSum > 0) {
        var acc = 0;
        KEYS.forEach(function (k) {
          var zg = (g[k] - gs.mean[k]) / gs.sd[k];
          var supply = Math.min(SUPPLY_CAP, Math.max(0, zg)) / SUPPLY_CAP;
          var c = need[k] * supply;
          acc += c;
          if (c > contribMax) { contribMax = c; contrib = k; }
        });
        complement = acc / needSum;
      }
      closeness = clamp01(closeness);
      complement = clamp01(complement);
      var score = 100 * (WEIGHTS.closeness * closeness + WEIGHTS.complement * complement);
      score = Math.min(100, Math.max(0, score));
      return { index: index, general: g, score: score, closeness: closeness, complement: complement, contrib: contrib, diffAxis: diffAxis };
    });
  }

  // 並び: キー(整数化した値)の降順 → 同点は index 昇順(安定。diagnosis.js の並べ替えと同じ全順序方式)
  function sortedBy(rows, keyFn) {
    return rows.map(function (r) { return { r: r, key: Math.round(keyFn(r) * 1e6) }; })
      .sort(function (a, b) { return (b.key - a.key) || (a.r.index - b.r.index); })
      .map(function (x) { return x.r; });
  }

  // 弱み軸(最大 2、z の小さい順・同値は KEYS 順)と強み軸(z 最大・同値は KEYS 順)
  function pickAxes(user) {
    var zu = userZ(user);
    var order = KEYS.map(function (k, i) { return { k: k, z: zu[k], i: i }; });
    var weakList = order.filter(function (x) { return x.z < WEAK_Z; })
      .sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); }).slice(0, 2).map(function (x) { return x.k; });
    var balanced = weakList.length === 0;
    if (balanced) { // 弱点が少ないバランス型: 最も低い軸を weak0 として扱う
      weakList = [order.slice().sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); })[0].k];
    }
    var strong = order.slice().sort(function (a, b) { return (b.z - a.z) || (a.i - b.i); })[0].k;
    return { weak: weakList, strong: strong, balanced: balanced };
  }

  // 結果確定後に使う相性の一式。入力は diagnosis.user と diagnosis.top.general.id だけ(状態を持たず、入力も変更しない)
  function build(diagnosis) {
    var user = diagnosis.user;
    var topId = diagnosis.top.general.id;
    var rows = scoreAll(user);
    var ax = pickAxes(user);

    // 候補から診断 1 位(自分と同じ武将)を除く。「似ている武将」で既に表示しているため
    var candidates = rows.filter(function (r) { return r.general.id !== topId; });
    var top = sortedBy(candidates, function (r) { return r.score; }).slice(0, PARTNER_COUNT);

    var partners = top.map(function (r) {
      var wc = WEIGHTS.complement * r.complement, ws = WEIGHTS.closeness * r.closeness;
      var byComplement = wc >= ws && r.contrib !== null;
      var vars = { name: r.general.name };
      if (byComplement) {
        vars.axis = labelOf(r.contrib);
        vars.weak = labelOf(r.contrib); // 補完に最も寄与した軸=あなたの弱みを実際に補っている軸
      } else {
        vars.strong = labelOf(ax.strong);
      }
      return {
        general: r.general,
        index: r.index,
        score: r.score,
        percent: Math.round(PERCENT_BASE + PERCENT_SLOPE * r.score),
        closeness: r.closeness,
        complement: r.complement,
        kind: byComplement ? 'complement' : 'same',
        label: byComplement ? LABEL_COMPLEMENT : LABEL_SAME,
        reason: fill(byComplement ? REASON_COMPLEMENT : REASON_SAME, vars)
      };
    });

    // ちょっと刺激をくれる相手: 上位 3 人と 1 位を除いた残りから、違いが大きく補う面もある武将
    var taken = {};
    top.forEach(function (r) { taken[r.general.id] = true; });
    var rest = candidates.filter(function (r) { return !taken[r.general.id]; });
    var stim = sortedBy(rest, function (r) {
      return 100 * (STIMULUS_WEIGHTS.difference * (1 - r.closeness) + STIMULUS_WEIGHTS.complement * r.complement);
    })[0];
    var stimulus = stim ? {
      general: stim.general,
      index: stim.index,
      score: 100 * (STIMULUS_WEIGHTS.difference * (1 - stim.closeness) + STIMULUS_WEIGHTS.complement * stim.complement),
      reason: fill(REASON_STIMULUS, { name: stim.general.name, axis: labelOf(stim.diffAxis) })
    } : null;

    // 相性の良い性格タイプ
    var types = {
      complement: ax.weak.map(function (k) { return TYPE_COMPLEMENT[k]; }),
      same: TYPE_SAME[ax.strong],
      balanced: ax.balanced,
      balancedText: ax.balanced ? BALANCED_TEXT : ''
    };

    // 日常場面のひとこと
    var scenes = SCENES.map(function (s) {
      var k = s.pick === 'strong' ? ax.strong : (s.pick === 'weak1' ? (ax.weak[1] || ax.weak[0]) : ax.weak[0]);
      return { key: s.key, label: s.label, text: ADVICE[s.key][k] };
    });

    return { partners: partners, stimulus: stimulus, types: types, scenes: scenes, note: NOTE };
  }

  // 文言表の網羅・文字数を検査する(不備があれば例外)
  function validateData() {
    var a = axes();
    if (a.length !== KEYS.length || a.some(function (x, i) { return x.key !== KEYS[i]; })) { throw new Error('compat: 軸の並びが diagnosis.js と違う'); }
    if (Math.abs(WEIGHTS.closeness + WEIGHTS.complement - 1) > 1e-9) { throw new Error('compat: WEIGHTS の合計が 1 ではない'); }
    KEYS.forEach(function (k) {
      if (!TYPE_COMPLEMENT[k]) { throw new Error('compat: TYPE_COMPLEMENT.' + k + ' がない'); }
      if (!TYPE_SAME[k]) { throw new Error('compat: TYPE_SAME.' + k + ' がない'); }
      SCENES.forEach(function (s) {
        var t = ADVICE[s.key] && ADVICE[s.key][k];
        if (!t) { throw new Error('compat: ADVICE.' + s.key + '.' + k + ' がない'); }
        if (Array.from(t).length > ADVICE_MAX_CHARS) { throw new Error('compat: ADVICE.' + s.key + '.' + k + ' が ' + ADVICE_MAX_CHARS + ' 文字を超えている'); }
      });
    });
    [REASON_COMPLEMENT, REASON_SAME, REASON_STIMULUS].forEach(function (t) {
      if (t.indexOf('診断用の性格モデルでは') !== 0) { throw new Error('compat: 理由文が「診断用の性格モデルでは」で始まっていない'); }
    });
    return true;
  }

  SG.Compat = {
    WEIGHTS: WEIGHTS,
    DREF: DREF,
    build: build,
    scoreAll: scoreAll,
    validateData: validateData
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Compat; }
})(typeof window !== 'undefined' ? window : globalThis);
