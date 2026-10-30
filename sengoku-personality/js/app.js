/*
 * app.js — SG.App
 * アプリの状態・画面遷移(ステートマシン)・タイマー・イベントを持つ唯一のモジュール。
 *   START → QUESTION(0〜14) → ANALYZING → RESULT → (最初に戻る) START
 *   来場者向けランキング(PLAYER_RANKING)と戦国武将図鑑(ZUKAN)は START / RESULT から開き、同じ画面へ戻る。運営用 RANKING は START からだけ
 *   図鑑は閲覧専用で、回答・診断結果・ランキング集計には触れない(「診断を始める」だけは reset() してから診断を開始する)
 * 回答の真実の源は state.answers だけ。スコアや順位は SG.Diagnosis.diagnose(answers) で毎回全部計算し直す
 * (加算するコードがないので、前の質問に戻って回答を変えても二重加算は起こらない)。
 * ランキングへの加算は enterResult() の 1 か所だけで、state.counted で 1 回に限る。
 * 診断中(QUESTION / ANALYZING)の「ホームへ戻る」: 確認ダイアログ(Results.confirm)で「ホームへ戻る」が確定したときだけ reset() する。
 *   reset() は「最初に戻る」と同じ完全リセット(回答・結果・タイマー・世代 runId を破棄)。中断した診断は enterResult を通らないので、ランキングに加算されない。
 *   ダイアログが開いている間に進行用のタイマー(次の問へ・結果表示)が満了したら、その場では実行せず deferred に保留し、「続ける」で再開する。
 * #toast・#idle-toast・#fatal はこのファイルだけが扱う。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  // ---- 設定(展示用。0 以下・非数の無操作時間は「無効」) ----
  var CONFIG = {
    IDLE_RESET_MS_QUESTION: 90000,   // 質問中: 90秒。0 で無効
    IDLE_RESET_MS_RESULT: 150000,    // 結果/ランキング/ダイアログ表示中: 150秒。0 で無効
    IDLE_WARN_MS: 10000,             // 満了の何ms前に警告を出すか
    ANSWER_ADVANCE_MS: 240,          // 回答後に次の問へ進むまで
    ANALYZE_TOTAL_MS: 2500,          // 演出の総時間。2000〜3000 に clamp。文言切替は TOTAL/3 刻み(別定数なし)
    COUNTUP_MS: 1000                 // 類似度カウントアップ
  };
  var DEFAULTS = {};
  Object.keys(CONFIG).forEach(function (k) { DEFAULTS[k] = CONFIG[k]; });

  var ANALYZE_MESSAGES = [
    'あなたの武将としての資質を分析中……',
    '戦国の英傑たちと比較中……',
    'あなたの運命の武将は……'
  ];
  var SCREENS = {
    START: 'screen-start',
    QUESTION: 'screen-question',
    ANALYZING: 'screen-analyzing',
    RESULT: 'screen-result',
    RANKING: 'screen-ranking',
    PLAYER_RANKING: 'screen-player-ranking',
    ZUKAN: 'screen-zukan'
  };
  var QUESTION_COUNT = 15;

  function initialState() {
    return {
      phase: 'START',
      answers: emptyAnswers(),
      current: 0,
      diagnosis: null,
      counted: false,
      rankingReturnTo: 'START',
      zukanReturnTo: 'START',
      cardResult: null,
      cardBusy: false,
      locked: false,
      homeAsking: false // 「ホームへ戻る」の確認ダイアログを開いている間 true
    };
  }
  function emptyAnswers() {
    var a = [];
    for (var i = 0; i < QUESTION_COUNT; i++) { a.push(null); }
    return a;
  }

  var state = initialState();
  state.runId = 0;

  var timers = [];     // 遷移・演出のタイマー(clearTimers で全解除)
  var idleTimers = []; // 無操作タイマー [warnId, expireId]
  var toastTimer = null;
  var store = null;
  var playerRankingOpener = null; // 来場者向けランキングを開いたボタン(戻るときにフォーカスを返す)
  var zukanOpener = null;         // 図鑑を開いたボタン(戻るときにフォーカスを返す)
  var started = false;
  var deferred = null; // 確認ダイアログ表示中に満了した進行処理(次の問へ・結果表示)。「続ける」で実行、リセットで破棄
  var els = {};

  function $(id) { return root.document.getElementById(id); }

  // ---- 設定の反映と検証 ----
  // テスト用: window.SG_CONFIG_OVERRIDE があれば、CONFIG に存在するキーのうち有限の数値だけを上書きする
  // (tools/browser-check.js が無操作タイマーを短くするために使う。通常運用では未定義。診断結果には影響しない)
  function applyOverride() {
    var o = root.SG_CONFIG_OVERRIDE;
    if (!o || typeof o !== 'object') { return; }
    Object.keys(CONFIG).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(o, k) && typeof o[k] === 'number' && isFinite(o[k])) { CONFIG[k] = o[k]; }
    });
  }
  function validateConfig() {
    ['IDLE_RESET_MS_QUESTION', 'IDLE_RESET_MS_RESULT', 'IDLE_WARN_MS'].forEach(function (k) {
      var v = CONFIG[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) {
        console.warn('App: CONFIG.' + k + ' が不正なため無効にします');
        CONFIG[k] = 0;
      }
    });
    ['ANSWER_ADVANCE_MS', 'COUNTUP_MS'].forEach(function (k) {
      var v = CONFIG[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) {
        console.warn('App: CONFIG.' + k + ' が不正なため既定値にします');
        CONFIG[k] = DEFAULTS[k];
      }
    });
    // 演出は要件の 2〜3 秒に収める
    var t = CONFIG.ANALYZE_TOTAL_MS;
    if (typeof t !== 'number' || !isFinite(t)) {
      console.warn('App: CONFIG.ANALYZE_TOTAL_MS が不正なため既定値にします');
      CONFIG.ANALYZE_TOTAL_MS = DEFAULTS.ANALYZE_TOTAL_MS;
    } else if (t < 2000 || t > 3000) {
      console.warn('App: CONFIG.ANALYZE_TOTAL_MS を 2000〜3000 に丸めます');
      CONFIG.ANALYZE_TOTAL_MS = Math.max(2000, Math.min(3000, t));
    }
  }

  // ---- タイマー ----
  function later(fn, ms) {
    var id = root.setTimeout(function () {
      timers = timers.filter(function (x) { return x !== id; });
      fn();
    }, ms);
    timers.push(id);
    return id;
  }
  function clearIdleTimers() {
    idleTimers.forEach(function (id) { root.clearTimeout(id); });
    idleTimers = [];
  }
  function clearTimers() {
    timers.forEach(function (id) { root.clearTimeout(id); });
    timers = [];
    clearIdleTimers();
  }

  function prefersReducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ---- 画面の切り替え ----
  function showScreen(phase) {
    state.phase = phase;
    Object.keys(SCREENS).forEach(function (p) {
      var el = $(SCREENS[p]);
      if (!el) { return; }
      if (p === phase) {
        el.hidden = false;
        el.classList.remove('is-entering');
        void el.offsetWidth; // アニメーションを毎回やり直す
        el.classList.add('is-entering');
      } else {
        el.hidden = true;
        el.classList.remove('is-entering');
      }
    });
    root.scrollTo(0, 0);
    armIdleTimer();
  }
  function focusEl(el) {
    if (!el) { return; }
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  function focusHeading(phase) {
    var sec = $(SCREENS[phase]);
    if (sec) { focusEl(sec.querySelector('[tabindex="-1"]')); }
  }

  // ---- 回答(状態の唯一の書き込み口) ----
  function setAnswer(i, idx) {
    state.answers[i] = idx;
    state.diagnosis = null;
  }

  // ---- 質問画面 ----
  function renderQuestion(i) {
    var item = SG.Questions.items[i];
    var n = i + 1;
    els.qCount.textContent = 'Q' + n + ' / ' + QUESTION_COUNT;
    els.qScene.textContent = item.scene;
    els.qText.textContent = item.text;
    els.progress.setAttribute('aria-valuenow', String(n));
    els.progress.setAttribute('aria-valuetext', QUESTION_COUNT + '問中' + n + '問目');
    els.progressFill.style.width = (n / QUESTION_COUNT * 100) + '%';
    els.options.forEach(function (btn, k) {
      var opt = item.options[k];
      btn.querySelector('.opt-label').textContent = opt.label;
      btn.querySelector('.opt-text').textContent = opt.text;
      var on = state.answers[i] === k;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-selected', on);
    });
    // Q1 の「前の質問へ」は表示したまま無効にする
    els.prev.disabled = i === 0;
    els.prev.setAttribute('aria-disabled', i === 0 ? 'true' : 'false');
    // 「次の質問へ」は回答済みのときだけ出す(Q15 は「診断結果を見る」)
    els.next.hidden = state.answers[i] === null;
    els.next.textContent = i === QUESTION_COUNT - 1 ? '診断結果を見る' : '次の質問へ';
    focusEl(els.qText);
  }

  // 質問画面の見た目を初期状態に戻す(reset 用。文言は次の renderQuestion(0) が上書きする)
  function resetQuestionScreen() {
    els.options.forEach(function (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('is-selected');
    });
    els.progressFill.style.width = '0%';
    els.progress.setAttribute('aria-valuenow', '1');
    els.progress.setAttribute('aria-valuetext', QUESTION_COUNT + '問中1問目');
    els.next.hidden = true;
  }

  function startDiagnosis() {
    if (state.phase !== 'START' || state.locked) { return; }
    state.answers = emptyAnswers();
    state.current = 0;
    state.diagnosis = null;
    state.counted = false;
    state.runId += 1;
    showScreen('QUESTION');
    renderQuestion(0);
  }

  function onOption(ev) {
    var btn = ev.currentTarget;
    if (state.phase !== 'QUESTION' || state.locked) { return; }
    var idx = Number(btn.getAttribute('data-index'));
    if (!(idx >= 0 && idx <= 3 && Math.floor(idx) === idx)) {
      console.warn('App: 不正な選択肢の番号です');
      return;
    }
    state.locked = true; // 連打で 2 問進まないようにロックする
    var i = state.current;
    setAnswer(i, idx);
    els.options.forEach(function (b, k) {
      b.setAttribute('aria-pressed', k === idx ? 'true' : 'false');
      b.classList.toggle('is-selected', k === idx);
    });
    var myRun = state.runId;
    later(function () {
      if (myRun !== state.runId || state.phase !== 'QUESTION') { return; }
      runOrDefer(function () {
        if (myRun !== state.runId || state.phase !== 'QUESTION') { return; }
        state.locked = false;
        if (i < QUESTION_COUNT - 1) {
          state.current = i + 1;
          renderQuestion(i + 1);
        } else {
          enterAnalyzing();
        }
      });
    }, CONFIG.ANSWER_ADVANCE_MS);
  }

  function onPrev() {
    if (state.phase !== 'QUESTION' || state.locked || state.current <= 0) { return; }
    state.current -= 1;
    renderQuestion(state.current);
  }

  function onNext() {
    if (state.phase !== 'QUESTION' || state.locked) { return; }
    var i = state.current;
    if (state.answers[i] === null) { return; }
    if (i < QUESTION_COUNT - 1) {
      state.current = i + 1;
      renderQuestion(i + 1);
    } else {
      enterAnalyzing();
    }
  }

  // ---- 診断中の「ホームへ戻る」 ----
  // 確認ダイアログを開いている間は、進行処理(次の問へ・結果表示)をその場で実行せず保留する
  function runOrDefer(fn) {
    if (state.homeAsking) { deferred = fn; } else { fn(); }
  }
  function onHome() {
    // 質問中と診断演出中だけ。ダイアログ表示中の再押下・連打は無視する(二重に開かない・二重に処理しない)
    if ((state.phase !== 'QUESTION' && state.phase !== 'ANALYZING') || state.homeAsking) { return; }
    state.homeAsking = true;
    var myRun = state.runId;
    armIdleTimer(); // 診断演出中でも、ダイアログのまま放置されたら無操作タイマーで戻れるようにする
    SG.Results.confirm({
      message: '診断を中断してホームに戻りますか？ここまでの回答は消えます。',
      okLabel: 'ホームへ戻る',
      backdropGuardMs: 400, // ホームボタンのダブルクリックの 2 回目(背景への押下)で、開いた直後に閉じてしまわないようにする
      cancelLabel: '続ける' // 初期フォーカスはこちら(安全側)。Esc・背景クリックも「続ける」
    }).then(function (ok) {
      // 無操作リセットなどで世代が変わっていたら、何もしない(リセット済み)
      if (myRun !== state.runId || !state.homeAsking) { return; }
      if (ok) {
        // 「最初に戻る」と同じ完全リセット。回答は保存していないので、ここで消せば何も残らない
        reset();
        return;
      }
      state.homeAsking = false;
      armIdleTimer();
      var fn = deferred;
      deferred = null;
      if (fn) { fn(); } // 保留していた進行処理を再開する
    });
  }

  // ---- 診断演出(3 段階の文言。時間は ANALYZE_TOTAL_MS だけで決まる) ----
  function enterAnalyzing() {
    if (state.phase !== 'QUESTION') { return; } // 二重遷移の防止
    if (!SG.Diagnosis.isComplete(state.answers)) {
      // 未回答があれば、最初の未回答の問へ戻す
      var first = state.answers.indexOf(null);
      state.current = first < 0 ? 0 : first;
      renderQuestion(state.current);
      return;
    }
    showScreen('ANALYZING');
    var myRun = state.runId;
    var total = CONFIG.ANALYZE_TOTAL_MS;
    var step = total / 3;
    els.analyzingMsg.textContent = ANALYZE_MESSAGES[0];
    focusHeading('ANALYZING');
    function guard() { return myRun === state.runId && state.phase === 'ANALYZING'; }
    later(function () { if (guard()) { els.analyzingMsg.textContent = ANALYZE_MESSAGES[1]; } }, step);
    later(function () { if (guard()) { els.analyzingMsg.textContent = ANALYZE_MESSAGES[2]; } }, step * 2);
    later(function () {
      if (!guard()) { return; }
      // 確認ダイアログを開いている間は結果へ進まない(「続ける」で再開、「ホームへ戻る」なら破棄される)
      runOrDefer(function () {
        if (!guard()) { return; }
        try {
          state.diagnosis = SG.Diagnosis.diagnose(state.answers);
        } catch (e) {
          console.error('App: 診断に失敗しました', e);
          reset();
          showToast('診断に失敗しました。最初からやり直してください');
          return;
        }
        enterResult();
      });
    }, total);
  }

  // ---- 結果 ----
  function enterResult() {
    showScreen('RESULT');
    SG.Results.showResult(els.resultRoot, state.diagnosis, {
      onSaveCard: onSaveCard,
      onShowRanking: onShowRanking,
      onShowZukan: onShowZukan,
      onRestart: reset
    }, { countUpMs: CONFIG.COUNTUP_MS, reducedMotion: prefersReducedMotion() });
    // ランキングへの加算は、この診断で 1 回だけ(書き込みに失敗しても counted は true)
    if (!state.counted) {
      state.counted = true;
      store.increment(state.diagnosis.top.general.id);
    }
    focusEl(els.resultRoot.querySelector('#result-heading'));
  }

  function onCardClosed() {
    state.cardResult = null;
    SG.ShareCard.dispose();
  }

  // 結果画像の生成 → 自動ダウンロード → プレビュー(plan.md 1.4 の順序)
  function onSaveCard() {
    if (state.cardBusy || state.phase !== 'RESULT' || !state.diagnosis) { return; }
    // 新しい blob URL を作る前に、前回のプレビューを破棄する
    SG.Results.closeCardPreview();
    state.cardBusy = true;
    SG.Results.setSaveBusy(els.resultRoot, true);
    var myRun = state.runId;
    var d = state.diagnosis;
    var filename = 'sengoku-' + d.top.general.id + '.png';
    var p;
    try { p = SG.ShareCard.generate(d); } catch (e) { p = Promise.reject(e); }
    p.then(function (result) {
      if (myRun !== state.runId) { SG.ShareCard.dispose(); return; } // リセット済みなら破棄する
      state.cardResult = result;
      SG.ShareCard.download(result, filename);
      SG.Results.openCardPreview(result, {
        onClosed: onCardClosed,
        filename: filename,
        opener: els.resultRoot.querySelector('[data-action="save"]') // 閉じたら保存ボタンへフォーカスを戻す
      });
    }, function () {
      if (myRun === state.runId) { showToast('画像の作成に失敗しました。画面をスクリーンショットで保存してください'); }
    }).then(function () {
      state.cardBusy = false;
      SG.Results.setSaveBusy(els.resultRoot, false);
    });
  }

  // ---- ランキング ----
  // 全端末共通の集計を取り直してから画面を出す。待つのは最大 1.5 秒(つながらなければ端末内の集計で出す)
  var REFRESH_WAIT_MS = 1500;
  var rankingOpening = false;
  function refreshThen(fn) {
    if (rankingOpening) { return; }
    rankingOpening = true;
    var myRun = state.runId;
    var phase = state.phase;
    var done = false;
    var go = function () {
      if (done) { return; }
      done = true;
      rankingOpening = false;
      if (myRun !== state.runId || state.phase !== phase) { return; } // 待つ間にリセット・遷移した
      fn();
    };
    var p;
    try { p = store.refresh(); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') { go(); return; }
    p.then(go, go);
    root.setTimeout(go, REFRESH_WAIT_MS);
  }
  function openRanking(returnTo) {
    refreshThen(function () {
      state.rankingReturnTo = returnTo;
      SG.Results.renderRankingScreen(els.rankingRoot, store, { onBack: onRankingBack });
      showScreen('RANKING');
      focusHeading('RANKING');
    });
  }
  // 運営用の画面からは、いつでも最初の画面へ戻る
  function onRankingBack() {
    if (state.phase !== 'RANKING') { return; }
    reset();
  }

  // ---- 来場者向け「みんなの結果ランキング」 ----
  // 来場者側へ渡すのは読み取り専用のラッパーだけ(集計を書き換える操作は渡さない)
  function readOnlyStore() {
    return {
      getCounts: function (scope) { return store.getCounts(scope); },
      getTotalPlayers: function (scope) { return store.getTotalPlayers(scope); },
      isPersistent: function () { return store.isPersistent(); },
      isShared: function () { return store.isShared(); },
      todayKey: function () { return store.todayKey(); }
    };
  }
  // returnTo: 'START' か 'RESULT'(開いた元の画面。その画面からしか開けない)
  function openPlayerRanking(returnTo) {
    if (state.phase !== returnTo || (returnTo !== 'START' && returnTo !== 'RESULT')) { return; }
    if (returnTo === 'RESULT' && !state.diagnosis) { return; }
    playerRankingOpener = root.document.activeElement;
    refreshThen(function () {
      state.rankingReturnTo = returnTo;
      var highlightId = returnTo === 'RESULT' ? state.diagnosis.top.general.id : null;
      SG.PlayerRanking.render(els.playerRankingRoot, readOnlyStore(), { onBack: onPlayerRankingBack }, { highlightId: highlightId });
      showScreen('PLAYER_RANKING');
      focusHeading('PLAYER_RANKING');
    });
  }
  function onShowRanking() {
    openPlayerRanking('RESULT');
  }
  function onPlayerRankingBack() {
    if (state.phase !== 'PLAYER_RANKING') { return; }
    var opener = playerRankingOpener;
    playerRankingOpener = null;
    SG.PlayerRanking.dispose(els.playerRankingRoot);
    if (state.rankingReturnTo === 'RESULT' && state.diagnosis) {
      // 結果画面へは表示の切り替えだけ(結果 DOM は保持。enterResult は呼ばないので再加算しない)
      showScreen('RESULT');
      focusEl(opener && root.document.contains(opener) ? opener : els.resultRoot.querySelector('#result-heading'));
    } else {
      showScreen('START');
      focusEl(opener && root.document.contains(opener) ? opener : els.playerRankingBtn);
    }
  }

  // ---- 戦国武将図鑑 ----
  // 閲覧専用。図鑑へ渡すのは画面遷移のコールバックだけで、ストアも回答状態も渡さない(集計に触れられない)
  // returnTo: 'START' か 'RESULT'(開いた元の画面。その画面からしか開けない)
  function openZukan(returnTo) {
    if (state.phase !== returnTo || (returnTo !== 'START' && returnTo !== 'RESULT')) { return; }
    if (returnTo === 'RESULT' && !state.diagnosis) { return; }
    state.zukanReturnTo = returnTo;
    zukanOpener = root.document.activeElement;
    SG.Zukan.render(els.zukanRoot, { onBack: onZukanBack, onStart: onZukanStart });
    showScreen('ZUKAN');
    focusHeading('ZUKAN');
  }
  function onShowZukan() {
    openZukan('RESULT');
  }
  function onZukanBack() {
    if (state.phase !== 'ZUKAN') { return; }
    var opener = zukanOpener;
    zukanOpener = null;
    SG.Zukan.dispose(els.zukanRoot);
    if (state.zukanReturnTo === 'RESULT' && state.diagnosis) {
      // 結果画面へは表示の切り替えだけ(結果 DOM は保持。enterResult は呼ばないので再加算しない)
      showScreen('RESULT');
      focusEl(opener && root.document.contains(opener) ? opener : els.resultRoot.querySelector('#result-heading'));
    } else {
      showScreen('START');
      focusEl(opener && root.document.contains(opener) ? opener : els.zukanBtn);
    }
  }
  // 図鑑から診断を始める: 前回の結果や図鑑の DOM を残さないよう、全部片付けてから開始する
  function onZukanStart() {
    if (state.phase !== 'ZUKAN') { return; }
    reset();
    startDiagnosis();
  }

  // ---- リセット(前の利用者の痕跡を DOM とメモリから消す) ----
  function reset() {
    clearTimers();
    deferred = null; // 保留中の進行処理は破棄する(後から結果画面へ進ませない)
    var nextRun = state.runId + 1;
    Object.assign(state, initialState());
    state.runId = nextRun;
    SG.Results.closeAllDialogs();
    state.cardResult = null;
    SG.ShareCard.dispose();
    SG.Results.clear(els.resultRoot);
    SG.Results.clear(els.rankingRoot);
    SG.PlayerRanking.dispose(els.playerRankingRoot);
    playerRankingOpener = null;
    SG.Zukan.dispose(els.zukanRoot);
    zukanOpener = null;
    resetQuestionScreen();
    hideIdleToast();
    showScreen('START');
    focusEl(els.start);
  }

  // ---- 無操作タイマー(START と ANALYZING では張らない。ただし「ホームへ戻る」の確認ダイアログ中は張る) ----
  function idleLimit() {
    if (state.homeAsking) { return CONFIG.IDLE_RESET_MS_QUESTION; } // 確認ダイアログ中は(診断演出中でも)質問中と同じ時間
    if (state.phase === 'QUESTION') { return CONFIG.IDLE_RESET_MS_QUESTION; }
    if (state.phase === 'RESULT' || state.phase === 'RANKING' || state.phase === 'PLAYER_RANKING' || state.phase === 'ZUKAN') { return CONFIG.IDLE_RESET_MS_RESULT; }
    return 0;
  }
  function armIdleTimer() {
    clearIdleTimers();
    hideIdleToast();
    var ms = idleLimit();
    if (!(ms > 0)) { return; }
    var warn = CONFIG.IDLE_WARN_MS;
    if (warn > 0 && ms > warn) {
      idleTimers.push(root.setTimeout(showIdleToast, ms - warn));
    }
    idleTimers.push(root.setTimeout(function () {
      idleTimers = [];
      reset();
    }, ms));
  }
  function onActivity() { if (started) { armIdleTimer(); } }

  // 警告を出す。モーダルのダイアログが開いているときは、ダイアログ(トップレイヤー)の中へ一時的に移す
  // (body に置いたままだと背景の暗幕の下に隠れ、「続ける」も押せないため)。
  // 移した警告は hideIdleToast() が body へ戻す。入力・リセットのたびに hideIdleToast() が先に呼ばれるので、
  // ダイアログの中身が作り直される前に必ず戻る(戻す前に外れても、外れた要素をそのまま body へ戻せる)。
  function showIdleToast() {
    if (!els.idleToast) { return; }
    var dlg = root.document.querySelector('dialog[open]');
    if (dlg && els.idleToast.parentNode !== dlg) { dlg.appendChild(els.idleToast); }
    els.idleToast.hidden = false;
  }
  function hideIdleToast() {
    if (!els.idleToast) { return; }
    els.idleToast.hidden = true;
    if (els.idleToast.parentNode !== root.document.body) { root.document.body.appendChild(els.idleToast); }
  }

  function showToast(msg) {
    if (!els.toast) { return; }
    els.toast.textContent = msg;
    els.toast.hidden = false;
    if (toastTimer !== null) { root.clearTimeout(toastTimer); }
    toastTimer = root.setTimeout(function () { els.toast.hidden = true; toastTimer = null; }, 5000);
  }

  // 想定外の例外: #fatal に表示する(withRestart=true なら「最初に戻る」ボタン付き)
  function showFatal(msg, withRestart) {
    var f = $('fatal');
    if (!f) { return; }
    // モーダルのダイアログ(トップレイヤー)が開いたままだと #fatal がその下に隠れて押せないので、先に閉じる
    try { if (SG.Results) { SG.Results.closeAllDialogs(); } } catch (e) { /* 表示を優先する */ }
    hideIdleToast();
    f.innerHTML = '<div class="fatal-body"><p>' + SG.Util.esc(msg) + '</p>' +
      (withRestart ? '<button type="button" class="btn btn-primary" id="fatal-restart">最初に戻る</button>' : '') + '</div>';
    f.hidden = false;
    var b = $('fatal-restart');
    if (b) {
      b.addEventListener('click', function () {
        f.hidden = true;
        f.replaceChildren();
        try { reset(); } catch (e) { root.location.reload(); }
      });
      focusEl(b);
    }
  }

  function bindErrorHandlers() {
    root.addEventListener('error', function (ev) {
      if (!ev || !ev.error && !ev.message) { return; } // 画像などの読み込み失敗はここに来ない(捕捉しない)
      console.error('App: 想定外のエラー', ev.error || ev.message);
      showFatal('問題が発生しました。「最初に戻る」を押してください。', true);
    });
    root.addEventListener('unhandledrejection', function (ev) {
      console.error('App: 想定外のエラー', ev && ev.reason);
      showFatal('問題が発生しました。「最初に戻る」を押してください。', true);
    });
  }

  // ---- 起動 ----
  function init() {
    if (started) { return; }
    applyOverride();
    validateConfig();
    bindErrorHandlers();
    try {
      SG.Diagnosis.validateData();
    } catch (e) {
      console.error('App: データの検証に失敗しました', e);
      showFatal('データに誤りがあります。', false);
      return;
    }
    store = SG.Storage.getDefault();

    els.start = $('btn-start');
    els.openRanking = $('open-ranking');
    els.qCount = $('q-count');
    els.qScene = $('q-scene');
    els.qText = $('q-text');
    els.progress = $('q-progress');
    els.progressFill = els.progress.querySelector('.progress-fill');
    els.options = Array.prototype.slice.call(root.document.querySelectorAll('#screen-question .opt'));
    els.prev = $('btn-prev');
    els.next = $('btn-next');
    els.homeBtns = Array.prototype.slice.call(root.document.querySelectorAll('[data-action="home"]'));
    els.analyzingMsg = $('analyzing-msg');
    els.resultRoot = $('result-root');
    els.rankingRoot = $('ranking-root');
    els.playerRankingRoot = $('player-ranking-root');
    els.playerRankingBtn = $('btn-player-ranking');
    els.zukanRoot = $('zukan-root');
    els.zukanBtn = $('btn-zukan');
    els.idleToast = $('idle-toast');
    els.toast = $('toast');

    els.start.addEventListener('click', startDiagnosis);
    els.openRanking.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (state.phase === 'START') { openRanking('START'); }
    });
    els.playerRankingBtn.addEventListener('click', function () { openPlayerRanking('START'); });
    els.zukanBtn.addEventListener('click', function () { openZukan('START'); });
    els.options.forEach(function (b) { b.addEventListener('click', onOption); });
    els.prev.addEventListener('click', onPrev);
    els.next.addEventListener('click', onNext);
    els.homeBtns.forEach(function (b) { b.addEventListener('click', onHome); });
    var cont = els.idleToast.querySelector('button');
    if (cont) { cont.addEventListener('click', armIdleTimer); }

    // 入力があるたびに無操作タイマーを張り直す
    ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (type) {
      root.addEventListener(type, onActivity, { capture: true, passive: true });
    });
    // bfcache から復元されたら、前の利用者の画面を残さない
    root.addEventListener('pageshow', function (ev) { if (ev.persisted) { reset(); } });

    started = true;
    showScreen('START');
  }

  // デバッグ・検査用: 読み取り専用のコピーを返す
  function getState() {
    return {
      phase: state.phase,
      answers: state.answers.slice(),
      current: state.current,
      counted: state.counted,
      rankingReturnTo: state.rankingReturnTo,
      zukanReturnTo: state.zukanReturnTo,
      cardBusy: state.cardBusy,
      locked: state.locked,
      homeAsking: state.homeAsking,
      runId: state.runId,
      topId: state.diagnosis ? state.diagnosis.top.general.id : null,
      hasCardResult: state.cardResult !== null
    };
  }

  SG.App = { init: init, getState: getState };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.App; }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', SG.App.init);
  }
})(typeof window !== 'undefined' ? window : globalThis);
