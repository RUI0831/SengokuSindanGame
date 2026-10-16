#!/usr/bin/env node
/*
 * tools/browser-check.js — ヘッドレス Chrome / Edge を CDP で操作する E2E 確認(開発・展示前の確認用。アプリ本体ではない)
 *
 * 使い方(cwd = ROOT):
 *   node tools\browser-check.js [--browser chrome|edge] [--exe <パス>] [--scenario <名前|all>]
 *                               [--http] [--screenshots <フォルダ>] [--skip-long]
 *   --browser      既定 chrome。--exe で実行ファイルを上書きできる
 *   --scenario     既定 all(登録済みのシナリオをすべて実行)
 *   --http         Node の http モジュールで ROOT を 127.0.0.1:<空きポート> に読み取り専用で配信して開く(既定は file://)
 *   --screenshots  スクリーンショットの保存先
 *   --skip-long    時間のかかる確認(30 秒以上待つものなど)を省く
 *
 * 方針:
 *   - Node 標準モジュールと Node 22 以上のグローバル WebSocket だけを使う。通信先は自分で起動したブラウザの 127.0.0.1 だけ。
 *   - シナリオごとに新しい一時プロファイル(%TEMP%)でブラウザを起動し、終了時に必ず片付ける。
 *   - 終了させるのは自分が起動したプロセス(PID)だけ。名前指定の終了はしない(ユーザーのブラウザが閉じるため)。
 *   - console の error / warning、例外、Log の error / warning が出たら FAIL(シナリオごとの許可リストだけ除く)。
 *   - 結果は「[PASS] / [FAIL] <シナリオ> <AC>: 内容」。最後に RESULT を出し、FAIL があれば exit 1。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const BROWSERS = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
};

// ---- 引数 ----
function parseArgs(argv) {
  const o = { browser: 'chrome', exe: null, scenario: 'all', http: false, screenshots: null, skipLong: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--browser') { o.browser = String(argv[++i] || '').toLowerCase(); }
    else if (a === '--exe') { o.exe = argv[++i]; }
    else if (a === '--scenario') { o.scenario = argv[++i]; }
    else if (a === '--http') { o.http = true; }
    else if (a === '--screenshots') { o.screenshots = path.resolve(argv[++i]); }
    else if (a === '--skip-long') { o.skipLong = true; }
    else { throw new Error('不明な引数: ' + a); }
  }
  if (!o.exe) {
    if (!BROWSERS[o.browser]) { throw new Error('--browser は chrome か edge: ' + o.browser); }
    o.exe = BROWSERS[o.browser];
  }
  if (!fs.existsSync(o.exe)) { throw new Error('ブラウザが見つからない: ' + o.exe); }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 結果の記録 ----
const results = [];
function record(ok, scenario, ac, msg) {
  results.push({ ok, scenario, ac, msg });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + scenario + ' ' + ac + ': ' + msg);
}

// ---- http 配信(--http)。読み取り専用で、ROOT の外は 404 ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      let p;
      try { p = decodeURIComponent(String(req.url).split('?')[0].split('#')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
      if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (p.endsWith('/')) { p += 'index.html'; }
      const abs = path.resolve(ROOT, '.' + p);
      if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end(); return; }
      fs.stat(abs, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(abs).pipe(res);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---- CDP クライアント(ブラウザ単位の WebSocket 1 本。ページは flatten セッション) ----
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = new Set();
    const client = {
      send(method, params, sessionId) {
        const id = ++nextId;
        const msg = { id, method, params: params || {} };
        if (sessionId) { msg.sessionId = sessionId; }
        return new Promise((res, rej) => {
          pending.set(id, { res, rej, method });
          ws.send(JSON.stringify(msg));
        });
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { try { ws.close(); } catch (e) { /* 無視 */ } }
    };
    ws.onopen = () => resolve(client);
    ws.onerror = () => reject(new Error('CDP の WebSocket に接続できない'));
    ws.onclose = () => { pending.forEach((p) => p.rej(new Error('CDP 切断: ' + p.method))); pending.clear(); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) { p.rej(new Error(p.method + ': ' + msg.error.message)); } else { p.res(msg.result); }
        return;
      }
      listeners.forEach((fn) => fn(msg));
    };
  });
}

// ---- ブラウザの起動と後片付け(自分が起動した PID だけを終了する) ----
async function launch(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bc-'));
  const profile = path.join(dir, 'profile');
  const downloads = path.join(dir, 'downloads');
  fs.mkdirSync(profile);
  fs.mkdirSync(downloads);
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    'about:blank'];
  const child = spawn(opts.exe, args, { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((r) => child.once('exit', r));
  const portFile = path.join(profile, 'DevToolsActivePort');
  let lines = null;
  for (let t = 0; t < 150 && !lines; t++) {
    await sleep(100);
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
      if (txt[0] && txt[1]) { lines = txt; }
    }
  }
  const b = { child, exited, dir, downloads, cdp: null };
  if (!lines) { await shutdown(b); throw new Error('DevToolsActivePort が作られない'); }
  b.cdp = await connect('ws://127.0.0.1:' + lines[0].trim() + lines[1].trim());
  return b;
}

async function shutdown(b) {
  if (b.cdp) {
    try { await Promise.race([b.cdp.send('Browser.close'), sleep(3000)]); } catch (e) { /* 無視 */ }
    b.cdp.close();
  }
  const done = await Promise.race([b.exited.then(() => true), sleep(5000).then(() => false)]);
  if (!done && b.child.pid) {
    // 自分が起動したプロセス(とその子)だけを PID 指定で終了する
    spawnSync('taskkill', ['/PID', String(b.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await Promise.race([b.exited, sleep(3000)]);
  }
  try { fs.rmSync(b.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (e) { console.log('(一時フォルダを消せなかった: ' + b.dir + ')'); }
}

// ---- ページ操作の便利関数 ----
async function openPage(b, opts) {
  const { targetId } = await b.cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => b.cdp.send(m, p, sessionId);
  const page = { logs: [], problems: [], allow: [], send };

  b.cdp.on((msg) => {
    if (msg.sessionId !== sessionId) { return; }
    const p = msg.params || {};
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ');
      page.logs.push({ type: p.type, text });
      if (p.type === 'error' || p.type === 'warning' || p.type === 'assert') { page.problems.push('console.' + p.type + ': ' + text); }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      page.problems.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (msg.method === 'Log.entryAdded') {
      const e = p.entry || {};
      if (e.level === 'error' || e.level === 'warning') { page.problems.push('log.' + e.level + ': ' + e.text + (e.url ? ' (' + e.url + ')' : '')); }
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  // 式を評価して値を返す(Promise は待つ)
  page.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('eval 失敗: ' + ((d.exception && d.exception.description) || d.text) + ' / ' + expr.slice(0, 120));
    }
    return r.result.value;
  };
  // 式が truthy になるまで待つ
  page.waitFor = async (expr, timeout, label) => {
    const end = Date.now() + (timeout || 5000);
    for (;;) {
      let v = null;
      try { v = await page.eval('!!(' + expr + ')'); } catch (e) { v = false; }
      if (v) { return true; }
      if (Date.now() > end) { throw new Error('待ち時間切れ: ' + (label || expr)); }
      await sleep(40);
    }
  };
  // 要素の中心を実際のマウス操作でクリックする
  page.click = async (selector) => {
    const box = await page.eval('(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');' +
      'if(!el)return null;el.scrollIntoView({block:"center",inline:"center"});var r=el.getBoundingClientRect();' +
      'return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()');
    if (!box || !(box.w > 0 && box.h > 0)) { throw new Error('クリックできる要素がない: ' + selector); }
    await page.clickAt(box.x, box.y);
  };
  // 画面の座標をクリックする(ダイアログの背景クリックなど)
  page.clickAt = async (x, y) => {
    const base = { x, y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base));
    await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
    await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
  };
  // キー操作(Tab / Enter / Escape / 矢印 / Home / End)
  const KEYS = {
    Tab: { code: 'Tab', vk: 9 }, Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 },
    ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }
  };
  page.key = async (name) => {
    const k = KEYS[name];
    const base = { key: name, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, k.text ? { text: k.text, unmodifiedText: k.text } : {}));
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  };
  // 次の読み込みから、アプリより先に実行するスクリプトを登録する(identifier を返す)
  page.addInit = async (source) => (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  page.removeInit = (identifier) => send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  // ビューポートを設定し、innerWidth / innerHeight が一致することを確かめる
  page.setViewport = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 1024 });
    await page.waitFor('innerWidth===' + w + '&&innerHeight===' + h, 3000, 'viewport ' + w + 'x' + h);
  };
  page.goto = async (url) => {
    await send('Page.navigate', { url });
    await page.waitFor('document.readyState==="complete"&&window.SG&&SG.App&&document.getElementById("screen-start")', 10000, '読み込み');
  };
  // スクリーンショット(--screenshots のときだけ)
  page.screenshot = async (name, fullPage) => {
    if (!opts.screenshots) { return; }
    fs.mkdirSync(opts.screenshots, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!fullPage });
    const file = path.join(opts.screenshots, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('  screenshot: ' + file);
  };
  // 許可リストを除いた問題(console の error/warning・例外)を取り出す
  page.takeProblems = () => {
    const list = page.problems.filter((t) => !page.allow.some((re) => re.test(t)));
    page.problems = [];
    return list;
  };
  return page;
}

function appUrl(opts, server) {
  if (opts.http) { return 'http://127.0.0.1:' + server.address().port + '/index.html'; }
  return pathToFileURL(path.join(ROOT, 'index.html')).href;
}

// 検査の小道具
function check(scenario, ac, cond, msg) { record(!!cond, scenario, ac, msg); return !!cond; }
function checkNoProblems(page, scenario, ac, where) {
  const list = page.takeProblems();
  record(list.length === 0, scenario, ac, where + ' で console のエラー・警告・例外なし' + (list.length ? ' → ' + list.join(' | ') : ''));
}

const START_TEXTS = {
  title: '戦国武将性格診断',
  sub: 'もしあなたが戦国時代に生まれていたら、どの武将に似ていたのか？',
  desc: '15の質問からあなたの性格を分析。織田信長、徳川家康、伊達政宗など、名だたる戦国武将の中から、あなたに最も近い人物を診断します。',
  button: 'いざ、診断開始！'
};

// 画面のアニメーション(最大 約 1.4 秒)が落ち着くのを待つ
const settle = () => sleep(1500);

// ---- シナリオ: smoke ----
async function scenarioSmoke(page, opts, url) {
  const S = 'smoke';
  // 1. 開く(AC-1)。390×844 と 1280×800 でスタート画面を確かめる
  // viewport meta のない about:blank では mobile エミュレーションの幅が 980 になるので、読み込んでから設定する
  await page.goto(url);
  await page.setViewport(390, 844);
  checkNoProblems(page, S, 'AC-1', '読み込み直後(' + (opts.http ? 'http' : 'file://') + ')');
  const st = await page.eval('(function(){function t(s){var e=document.querySelector(s);return e?e.textContent.trim():null;}' +
    'return {title:t(".start-title"),sub:t(".start-sub"),desc:t(".start-desc"),button:t("#btn-start"),' +
    'visible:!document.getElementById("screen-start").hidden,phase:SG.App.getState().phase,' +
    'castle:!!document.querySelector(".deco-castle"),banners:document.querySelectorAll(".deco-banner").length,' +
    'crest:!!document.querySelector(".deco-crest-bg"),staff:!!document.getElementById("open-ranking")};})()');
  check(S, 'AC-1', st.visible && st.phase === 'START', 'スタート画面が表示され phase=START');
  ['title', 'sub', 'desc', 'button'].forEach((k) => check(S, 'AC-1', st[k] === START_TEXTS[k], 'スタート画面の文言 ' + k + ' が要件どおり(' + st[k] + ')'));
  check(S, 'AC-1', st.castle && st.banners === 2 && st.crest && st.staff, '城・幟旗 2 本・家紋の装飾と「運営用(集計)」がある');
  for (const vp of [[390, 844], [1280, 800]]) {
    await page.setViewport(vp[0], vp[1]);
    await settle();
    const ov = await page.eval('({sw:document.documentElement.scrollWidth,iw:innerWidth,' +
      'btn:(function(){var r=document.getElementById("btn-start").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})(),' +
      'title:(function(){var r=document.querySelector(".start-title").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()})');
    check(S, 'AC-22', ov.sw <= ov.iw, vp.join('x') + ' でスタート画面に横スクロールなし(scrollWidth ' + ov.sw + ' / ' + ov.iw + ')');
    check(S, 'AC-1', ov.btn && ov.title, vp.join('x') + ' でタイトルと開始ボタンが画面内に収まる');
    await page.screenshot('start-' + vp[0]);
  }

  // 2. 開始(AC-2)
  await page.click('#btn-start');
  await page.waitFor('SG.App.getState().phase==="QUESTION"', 3000, 'QUESTION へ');
  const q1 = await page.eval('({count:document.getElementById("q-count").textContent,' +
    'now:document.getElementById("q-progress").getAttribute("aria-valuenow"),max:document.getElementById("q-progress").getAttribute("aria-valuemax"),' +
    'text:document.getElementById("q-text").textContent,prevDisabled:document.getElementById("btn-prev").disabled})');
  check(S, 'AC-2', /(^|\D)1 \/ 15$/.test(q1.count) && q1.now === '1' && q1.max === '15', '「' + q1.count + '」と progressbar(valuenow=' + q1.now + ', max=' + q1.max + ')');
  check(S, 'AC-2', q1.text === 'あなたがグループのリーダーになったら？', 'Q1 の質問文が表示される');
  await settle();
  await page.screenshot('question-1280');

  // 3. 15 問に答える(決まった回答パターン)。最後のクリックから結果までの時間をページ内で測る
  const pattern = [0, 1, 2, 3, 1, 0, 3, 2, 2, 1, 0, 3, 1, 2, 0];
  await page.eval('(function(){window.__tClick=0;window.__tResult=0;' +
    'document.addEventListener("pointerdown",function(){window.__tClick=performance.now();},true);' +
    'new MutationObserver(function(){if(!document.getElementById("screen-result").hidden&&!window.__tResult){window.__tResult=performance.now();}})' +
    '.observe(document.getElementById("screen-result"),{attributes:true,attributeFilter:["hidden"]});})()');
  for (let i = 0; i < 15; i++) {
    await page.waitFor('(function(){var s=SG.App.getState();return s.phase==="QUESTION"&&s.current===' + i + '&&!s.locked;})()', 3000, 'Q' + (i + 1));
    await page.click('#screen-question .opt[data-index="' + pattern[i] + '"]');
  }
  await page.waitFor('SG.App.getState().phase==="ANALYZING"', 2000, 'ANALYZING へ');
  check(S, 'AC-6', true, '15 問の回答後に診断演出(ANALYZING)へ進む');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  const elapsed = await page.eval('window.__tResult-window.__tClick');
  check(S, 'AC-6', elapsed >= 2500 && elapsed <= 3300, '最後の回答から結果表示まで ' + Math.round(elapsed) + 'ms(期待 約 2740ms)');

  // 4. 大見出しの整数と TOP3 が SG.Diagnosis.diagnose と一致する(AC-7・AC-8)
  await sleep(1300); // カウントアップ(1000ms)の完了を待つ
  const r = await page.eval('(function(){var s=SG.App.getState();var d=SG.Diagnosis.diagnose(s.answers);' +
    'var cards=[].map.call(document.querySelectorAll("#result-root .top3-card"),function(e){return {id:e.getAttribute("data-general-id"),pct:e.querySelector(".top3-pct").textContent};});' +
    'var rows=[].map.call(document.querySelectorAll("#result-root .all-row"),function(e){return e.getAttribute("data-general-id");});' +
    'return {answers:s.answers,counted:s.counted,topId:s.topId,dTop:d.top.general.id,dSim:d.top.similarity,' +
    'shown:document.querySelector("#result-root .sim-num").textContent,aria:document.querySelector("#result-root .result-sim").getAttribute("aria-label"),' +
    'name:document.querySelector("#result-root .general-name").getAttribute("aria-label"),dName:d.top.general.name,' +
    'cards:cards,dTop3:d.top3.map(function(x){return {id:x.general.id,pct:x.similarityExact.toFixed(1)+"%"};}),' +
    'rows:rows,dRows:d.ranking.map(function(x){return x.general.id;}),' +
    'bars:document.querySelectorAll("#result-root .bar-row").length,radar:!!document.querySelector("#result-root .radar svg"),' +
    'reason:document.querySelectorAll("#result-root .reason p").length,total:SG.Storage.getDefault().getTotalPlayers("total")};})()');
  check(S, 'AC-5', JSON.stringify(r.answers) === JSON.stringify(pattern), 'state.answers が回答どおり');
  check(S, 'AC-7', r.shown === String(r.dSim) && r.aria === '類似度' + r.dSim + 'パーセント', '大見出しの類似度 ' + r.shown + '% = diagnose().top.similarity ' + r.dSim);
  check(S, 'AC-7', r.name === r.dName && r.topId === r.dTop, '武将名「' + r.name + '」と getState().topId が diagnose() の 1 位と一致');
  check(S, 'AC-8', JSON.stringify(r.cards) === JSON.stringify(r.dTop3), 'TOP3 の id と小数 1 桁の表示が一致(' + r.cards.map((c) => c.id + ' ' + c.pct).join(', ') + ')');
  check(S, 'AC-8', JSON.stringify(r.rows) === JSON.stringify(r.dRows) && r.rows.length === 20, '20 人一覧の並びが diagnose() の順位と一致');
  check(S, 'AC-7', r.bars === 6 && r.radar && r.reason >= 3, '棒グラフ 6 本・レーダー・理由文 ' + r.reason + ' 段落');
  check(S, 'AC-15', r.counted === true && r.total === 1, 'ランキングに 1 回だけ加算(累計 ' + r.total + ')');
  checkNoProblems(page, S, 'AC-1', '結果表示まで');
  await page.screenshot('result-1280', true);

  // 5. ランキングを開いて戻る(再加算しない)
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const rk = await page.eval('({title:document.querySelector("#player-ranking-root .pr-title").textContent,' +
    'rows:[].map.call(document.querySelectorAll("#player-ranking-root .pr-text"),function(e){return e.textContent;}),' +
    'tabs:document.querySelectorAll("#player-ranking-root [role=tab]").length,' +
    'me:document.querySelectorAll("#player-ranking-root .pr-row.is-me").length})');
  const expectRow = '1位 ' + r.dName + '型　1人(100%)';
  check(S, 'AC-16', rk.title === 'みんなの結果ランキング' && rk.tabs === 2 && rk.rows[0] === expectRow && rk.me === 1,
    '来場者向けランキング画面「' + rk.title + '」に「' + rk.rows[0] + '」(あなたの行 ' + rk.me + ')');
  await page.screenshot('ranking-1280');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  const back = await page.eval('({total:SG.Storage.getDefault().getTotalPlayers("total"),today:SG.Storage.getDefault().getTotalPlayers("today"),' +
    'kept:document.querySelectorAll("#result-root .top3-card").length})');
  check(S, 'AC-15', back.total === 1 && back.today === 1 && back.kept === 3, 'ランキングの往復で再加算されず結果画面が残る(本日 ' + back.today + ' / 累計 ' + back.total + ')');

  // 6. 最初に戻る(AC-19)
  await page.click('#result-root [data-action="restart"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  const z = await page.eval('(function(){var s=SG.App.getState();return {answers:s.answers,topId:s.topId,counted:s.counted,' +
    'result:document.getElementById("result-root").childElementCount,ranking:document.getElementById("ranking-root").childElementCount,' +
    'pressed:document.querySelectorAll("#screen-question .opt[aria-pressed=true]").length,start:!document.getElementById("screen-start").hidden,' +
    'focus:document.activeElement&&document.activeElement.id};})()');
  check(S, 'AC-19', z.answers.length === 15 && z.answers.every((a) => a === null), '「最初に戻る」で answers がすべて null');
  check(S, 'AC-19', z.topId === null && z.counted === false && z.result === 0 && z.ranking === 0 && z.pressed === 0,
    '結果・ランキングの DOM が空になり、選択の強調も消える');
  check(S, 'AC-19', z.start && z.focus === 'btn-start', 'スタート画面に戻り、開始ボタンにフォーカス');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ======== FEAT-003: 残りのシナリオ ========
const PATTERN = [0, 1, 2, 3, 1, 0, 3, 2, 2, 1, 0, 3, 1, 2, 0];
// 1 位が「真田幸村（信繁）」(いちばん長い名前)になる回答。表示崩れの確認に使う
const PATTERN_LONG = [0, 0, 1, 1, 0, 0, 2, 3, 3, 0, 1, 3, 2, 2, 1];
const ANALYZE_MESSAGES = ['あなたの武将としての資質を分析中……', '戦国の英傑たちと比較中……', 'あなたの運命の武将は……'];
const STATS_KEY = 'sengoku-personality:v1:stats';

async function waitQuestion(page, i) {
  await page.waitFor('(function(){var s=SG.App.getState();return s.phase==="QUESTION"&&s.current===' + i + '&&!s.locked;})()', 3000, 'Q' + (i + 1));
}
// スタートボタンを押し、pattern のとおりに 15 問へ答える(最後のクリックまで)
async function startAndAnswer(page, pattern) {
  await page.click('#btn-start');
  for (let i = 0; i < 15; i++) {
    await waitQuestion(page, i);
    await page.click('#screen-question .opt[data-index="' + pattern[i] + '"]');
  }
}
// 結果画面になり、カウントアップ(1000ms)が終わるまで待つ
async function waitResult(page) {
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  await sleep(1300);
}
async function openApp(page, url, w, h) {
  await page.goto(url);
  await page.setViewport(w || 1280, h || 800);
}
// フォーカスが selector の要素に移るのを待つ(close イベントは非同期なので最大 1 秒待つ)。失敗時は実際の要素を表示する
async function focusIs(page, selector) {
  const expr = 'document.activeElement===document.querySelector(' + JSON.stringify(selector) + ')';
  try { await page.waitFor(expr, 1000, 'focus'); return true; } catch (e) {
    const a = await page.eval('(function(){var a=document.activeElement;return a?a.tagName+"."+a.className+"#"+a.id:"null";})()');
    console.log('  (フォーカスの実際: ' + a + ' / 期待: ' + selector + ')');
    return false;
  }
}
const dlgOpen = (id) => 'document.getElementById("' + id + '").open';
const totalOf = (scope) => 'SG.Storage.getDefault().getTotalPlayers("' + scope + '")';

// ---- questions: 文言・連打・戻る・回答の変更(AC-2〜AC-5) ----
async function scenarioQuestions(page, opts, url) {
  const S = 'questions';
  await openApp(page, url);
  await page.click('#btn-start');
  await waitQuestion(page, 0);
  const q1 = await page.eval('(function(){var p=document.getElementById("btn-prev");return {d:p.disabled,a:p.getAttribute("aria-disabled"),' +
    'h:p.getBoundingClientRect().height,next:document.getElementById("btn-next").hidden};})()');
  check(S, 'AC-2', q1.d && q1.a === 'true' && q1.h > 0, 'Q1 の「前の質問へ」は表示されたまま無効(disabled・aria-disabled=true)');
  check(S, 'AC-2', q1.next, 'Q1 は未回答なので「次の質問へ」は出ない');

  // 画面の文言がデータ(SG.Questions)と一致するかを読む式
  const readQ = '(function(){var s=SG.App.getState();var it=SG.Questions.items[s.current];' +
    'var o=[].map.call(document.querySelectorAll("#screen-question .opt"),function(b){return {label:b.querySelector(".opt-label").textContent,' +
    'text:b.querySelector(".opt-text").textContent,pressed:b.getAttribute("aria-pressed")};});' +
    'var ok=document.getElementById("q-text").textContent===it.text&&document.getElementById("q-scene").textContent===it.scene&&o.length===4&&' +
    'o.every(function(x,k){return x.text===it.options[k].text&&x.label===it.options[k].label;})&&' +
    'document.getElementById("q-count").textContent==="Q"+(s.current+1)+" / 15"&&' +
    'document.getElementById("q-progress").getAttribute("aria-valuenow")===String(s.current+1);' +
    'return {i:s.current,ok:ok,pressed:o.map(function(x){return x.pressed;}),next:!document.getElementById("btn-next").hidden};})()';
  const textOk = new Set();
  const noteText = async () => { const r = await page.eval(readQ); if (r.ok) { textOk.add(r.i); } return r; };

  // AC-4: Q1 で同じ選択肢を 2 回すばやく押しても 1 問だけ進む
  await noteText();
  await page.click('#screen-question .opt[data-index="0"]');
  await page.click('#screen-question .opt[data-index="1"]');
  await sleep(700);
  const dbl = await page.eval('SG.App.getState()');
  check(S, 'AC-4', dbl.current === 1 && dbl.answers[0] === 0 && dbl.answers[1] === null,
    '2 回の高速クリックで 1 問だけ進み、最初のクリックの回答が残る(current=' + dbl.current + ', answers[0]=' + dbl.answers[0] + ')');

  for (let i = 1; i < 5; i++) {
    await waitQuestion(page, i);
    await noteText();
    await page.click('#screen-question .opt[data-index="' + PATTERN[i] + '"]');
  }
  // Q6 から 2 問戻り、Q4 の回答を変える(AC-5)
  await waitQuestion(page, 5);
  await noteText();
  await page.click('#btn-prev');
  await waitQuestion(page, 4);
  const b5 = await page.eval(readQ);
  check(S, 'AC-5', b5.pressed[PATTERN[4]] === 'true' && b5.pressed.filter((p) => p === 'true').length === 1 && b5.next,
    'Q5 に戻ると選んだ選択肢だけが aria-pressed=true で、「次の質問へ」が出る');
  await page.click('#btn-prev');
  await waitQuestion(page, 3);
  const b4 = await page.eval(readQ);
  check(S, 'AC-5', b4.pressed[PATTERN[3]] === 'true', 'Q4 に戻ると選んだ選択肢(' + 'ABCD'[PATTERN[3]] + ')が強調される');
  const alt = (PATTERN[3] + 1) % 4;
  await page.click('#screen-question .opt[data-index="' + alt + '"]');
  await waitQuestion(page, 4);
  const a5 = await page.eval(readQ);
  check(S, 'AC-5', a5.pressed[PATTERN[4]] === 'true' && a5.next, '回答を変えたあと Q5 の回答は残っている');
  await page.click('#btn-next');
  for (let i = 5; i < 15; i++) {
    await waitQuestion(page, i);
    await noteText();
    await page.click('#screen-question .opt[data-index="' + PATTERN[i] + '"]');
  }
  check(S, 'AC-3', textOk.size === 15, 'Q1〜Q15 の質問文・場面・選択肢・番号・progressbar がデータと一致(' + textOk.size + ' / 15 問)');
  await waitResult(page);
  const expected = PATTERN.slice();
  expected[3] = alt;
  const r = await page.eval('(function(){var s=SG.App.getState();var e=SG.Diagnosis.diagnose(' + JSON.stringify(expected) + ');' +
    'var o=SG.Diagnosis.diagnose(' + JSON.stringify(PATTERN) + ');return {answers:s.answers,topId:s.topId,eTop:e.top.general.id,eSim:e.top.similarity,' +
    'oTop:o.top.general.id,shown:document.querySelector("#result-root .sim-num").textContent,' +
    'cards:[].map.call(document.querySelectorAll("#result-root .top3-card"),function(x){return x.getAttribute("data-general-id");}),' +
    'eTop3:e.top3.map(function(x){return x.general.id;}),total:' + totalOf('total') + '};})()');
  check(S, 'AC-5', JSON.stringify(r.answers) === JSON.stringify(expected), 'state.answers は変更後の回答だけを持つ');
  check(S, 'AC-5', r.topId === r.eTop && r.shown === String(r.eSim) && JSON.stringify(r.cards) === JSON.stringify(r.eTop3),
    '結果(1 位 ' + r.topId + ' ' + r.shown + '%・TOP3)が「最初からその回答」の diagnose() と一致(変更前の回答なら ' + r.oTop + ')');
  check(S, 'AC-5', r.total === 1, '戻って回答を変えても加算は 1 回(累計 ' + r.total + ')');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- analyzing: 3 段階の文言・時間・演出中のクリック(AC-6) ----
async function scenarioAnalyzing(page, opts, url) {
  const S = 'analyzing';
  await openApp(page, url);
  await page.eval('(function(){window.__an=[];window.__anRes=0;var t0=0;var sec=document.getElementById("screen-analyzing");' +
    'var msg=document.getElementById("analyzing-msg");var res=document.getElementById("screen-result");' +
    'function rec(){if(!t0&&!sec.hidden){t0=performance.now();}if(t0){var t=msg.textContent;var l=window.__an[window.__an.length-1];' +
    'if(!l||l.text!==t){window.__an.push({t:performance.now()-t0,text:t});}}}' +
    'new MutationObserver(rec).observe(sec,{attributes:true,attributeFilter:["hidden"]});' +
    'new MutationObserver(rec).observe(msg,{childList:true,characterData:true,subtree:true});' +
    'new MutationObserver(function(){if(t0&&!res.hidden&&!window.__anRes){window.__anRes=performance.now()-t0;}}).observe(res,{attributes:true,attributeFilter:["hidden"]});})()');
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="ANALYZING"', 2000, 'ANALYZING へ');
  // 演出中に連打する(マウスと Enter)
  for (let k = 0; k < 6; k++) { await page.click('#screen-analyzing .analyzing-stage'); await page.key('Enter'); }
  const mid = await page.eval('SG.App.getState().phase');
  check(S, 'AC-6', mid === 'ANALYZING', '演出中のクリック・Enter の連打では画面が進まない(phase=' + mid + ')');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  await sleep(1500);
  const r = await page.eval('({an:window.__an,res:window.__anRes,total:' + totalOf('total') + ',today:' + totalOf('today') + ',counted:SG.App.getState().counted})');
  const texts = r.an.map((x) => x.text);
  check(S, 'AC-6', JSON.stringify(texts) === JSON.stringify(ANALYZE_MESSAGES), '3 つの文言が順に表示される(' + texts.join(' → ') + ')');
  const ts = r.an.map((x) => Math.round(x.t));
  const near = (v, e, tol) => typeof v === 'number' && Math.abs(v - e) <= tol;
  check(S, 'AC-6', ts.length === 3 && near(ts[0], 0, 100) && near(ts[1], 833, 200) && near(ts[2], 1667, 200),
    '文言の切り替え時刻 ' + ts.join(' / ') + 'ms(期待 0 / 約 833 / 約 1667)');
  check(S, 'AC-6', near(r.res, 2500, 250), '演出の開始から結果まで ' + Math.round(r.res) + 'ms(期待 2500)');
  check(S, 'AC-6', r.counted && r.total === 1 && r.today === 1, '連打しても加算は 1 回だけ(本日 ' + r.today + ' / 累計 ' + r.total + ')');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- result: 結果画面の全要素と小数 1 桁の表示・並び(AC-7・AC-8・AC-25) ----
async function scenarioResult(page, opts, url) {
  const S = 'result';
  await openApp(page, url);
  await startAndAnswer(page, PATTERN_LONG);
  await waitResult(page);
  const r = await page.eval('(function(){var s=SG.App.getState();var d=SG.Diagnosis.diagnose(s.answers);var R=document.getElementById("result-root");' +
    'function q(x){return R.querySelector(x);}function t(x){var e=q(x);return e?e.textContent:null;}' +
    'var gen=q(".radar svg polygon.radar-general");' +
    'return {lead:t(".result-lead"),name:q(".general-name").getAttribute("aria-label"),nameText:t(".general-name"),sim:t(".sim-num"),' +
    'simAria:q(".result-sim").getAttribute("aria-label"),type:t(".result-type"),frameSvg:!!q(".gold-frame .portrait[role=img] svg"),' +
    'bars:R.querySelectorAll(".bar-row").length,barVals:[].map.call(R.querySelectorAll(".bar-value"),function(e){return e.textContent;}),' +
    'barNames:[].map.call(R.querySelectorAll(".bar-name"),function(e){return e.textContent;}),' +
    'expVals:SG.Diagnosis.AXES.map(function(a){return String(Math.round(d.user[a.key]));}),expNames:SG.Diagnosis.AXES.map(function(a){return a.label;}),' +
    'radarUser:!!q(".radar svg polygon.radar-user"),radarGen:!!gen,dash:gen?gen.getAttribute("stroke-dasharray"):null,' +
    'legend:[].map.call(R.querySelectorAll(".radar-legend li"),function(e){return e.textContent;}),' +
    'reason:R.querySelectorAll(".reason p").length,reasonTitle:t("#sec-reason"),' +
    'cards:[].map.call(R.querySelectorAll(".top3-card"),function(e){return {id:e.getAttribute("data-general-id"),pct:e.querySelector(".top3-pct").textContent,' +
    'name:e.querySelector(".top3-name").textContent,img:!!e.querySelector(".portrait svg")};}),' +
    'rows:[].map.call(R.querySelectorAll(".all-row"),function(e){return {id:e.getAttribute("data-general-id"),pct:e.querySelector(".all-pct").textContent};}),' +
    'disc:t(".disclaimer"),actions:[].map.call(R.querySelectorAll("[data-action]"),function(e){return e.getAttribute("data-action");}),' +
    'd:{name:d.top.general.name,title:d.top.general.title,sim:d.top.similarity,' +
    'top3:d.top3.map(function(x){return {id:x.general.id,pct:x.similarityExact.toFixed(1)+"%",name:x.general.name};}),' +
    'rank:d.ranking.map(function(x){return {id:x.general.id,pct:x.similarityExact.toFixed(1)+"%",s:x.similarity,e:x.similarityExact};})}};})()');
  check(S, 'AC-7', r.lead === 'あなたに最も似ている戦国武将は……', '見出し「' + r.lead + '」');
  check(S, 'AC-7', r.name === r.d.name && r.nameText === r.d.name, '武将名「' + r.nameText + '」');
  check(S, 'AC-7', /^\d+$/.test(r.sim) && r.sim === String(r.d.sim) && r.simAria === '類似度' + r.d.sim + 'パーセント', '類似度は整数 ' + r.sim + '%');
  check(S, 'AC-7', r.type === '「' + r.d.title + '」タイプ', 'タイプ ' + r.type);
  check(S, 'AC-7', r.frameSvg, '金枠の中に代替カード(SVG)がある');
  check(S, 'AC-7', r.bars === 6 && JSON.stringify(r.barVals) === JSON.stringify(r.expVals) && JSON.stringify(r.barNames) === JSON.stringify(r.expNames),
    '横棒グラフ 6 本の軸名と数値(' + r.barVals.join(',') + ')');
  check(S, 'AC-7', r.radarUser && r.radarGen && !!r.dash && r.legend.length === 2 && r.legend[0].indexOf('あなた') === 0 && r.legend[1].indexOf(r.d.name) === 0,
    'レーダーにユーザー(実線)と 1 位(破線)の 2 系列と凡例(' + r.legend.join(' / ') + ')');
  check(S, 'AC-7', r.reason >= 3 && r.reasonTitle === 'あなたと' + r.d.name + 'が似ている理由', '「' + r.reasonTitle + '」に ' + r.reason + ' 段落');
  check(S, 'AC-8', JSON.stringify(r.cards.map((c) => ({ id: c.id, pct: c.pct, name: c.name }))) === JSON.stringify(r.d.top3) && r.cards.every((c) => c.img),
    'TOP3 の名前・画像・小数 1 桁の類似度が diagnose() と一致(' + r.cards.map((c) => c.name + ' ' + c.pct).join(', ') + ')');
  check(S, 'AC-8', r.rows.length === 20 && JSON.stringify(r.rows) === JSON.stringify(r.d.rank.map((x) => ({ id: x.id, pct: x.pct }))),
    '20 人一覧の並びと小数 1 桁の表示が diagnose() と一致');
  const rk = r.d.rank;
  const mono = rk.every((x, i) => i === 0 || (x.s <= rk[i - 1].s && x.e <= rk[i - 1].e));
  const consistent = rk.every((x) => Math.round(x.e) === x.s && /^\d+\.\d%$/.test(x.pct));
  check(S, 'AC-8', mono && consistent, 'similarity と similarityExact は非増加で、各行 Math.round(exact)===similarity(1 位 ' + rk[0].pct + '、20 位 ' + rk[19].pct + ')');
  check(S, 'AC-25', !!r.disc && r.disc.indexOf('エンターテインメント') >= 0 && r.disc.indexOf('確率ではなく') >= 0, '免責(エンタメ診断・類似度は確率ではない)を表示');
  check(S, 'AC-7', ['save', 'ranking', 'restart'].every((a) => r.actions.indexOf(a) >= 0), '「結果を画像で保存」「ランキング」「最初に戻る」のボタンがある');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- dialog: 武将詳細ダイアログ(AC-26・NIT 4) ----
async function scenarioDialog(page, opts, url) {
  const S = 'dialog';
  await openApp(page, url);
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  // showModal の呼び出し回数を数える(二重に開かないことの確認)
  await page.eval('(function(){window.__opens=0;var o=HTMLDialogElement.prototype.showModal;' +
    'HTMLDialogElement.prototype.showModal=function(){window.__opens++;return o.apply(this,arguments);};})()');
  const readDlg = '(function(){var d=document.getElementById("dlg-general");function all(s){return [].map.call(d.querySelectorAll(s),function(e){return e.textContent.trim();});}' +
    'return {open:d.open,opens:window.__opens,name:(d.querySelector(".dlg-name")||{}).textContent,dt:all(".dlg-facts dt"),dd:all(".dlg-facts dd"),h3:all("h3"),' +
    'li:d.querySelectorAll("li").length,mini:d.querySelectorAll(".mini-row").length,focus:document.activeElement&&document.activeElement.className};})()';
  const names = await page.eval('({top3:[].map.call(document.querySelectorAll("#result-root .top3-name"),function(e){return e.textContent;}),' +
    'rows:[].map.call(document.querySelectorAll("#result-root .all-name"),function(e){return e.textContent;})})');

  // 1) カード本体(名前の部分)のクリック → 1 回だけ開く → Esc で閉じてボタンにフォーカスが戻る
  await page.click('#result-root .top3-card:nth-child(1) .top3-name');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await sleep(300);
  let d = await page.eval(readDlg);
  check(S, 'NIT-4', d.open && d.opens === 1, 'カード本体のクリックでダイアログが 1 回だけ開く(showModal ' + d.opens + ' 回)');
  check(S, 'AC-26', d.name === names.top3[0], 'ダイアログの武将名「' + d.name + '」');
  check(S, 'AC-26', JSON.stringify(d.dt) === JSON.stringify(['生没年', '活躍した地域']) && d.dd.every((x) => x.length > 0),
    '生没年「' + d.dd[0] + '」・活躍した地域「' + d.dd[1] + '」');
  check(S, 'AC-26', ['主な功績', '有名な出来事', '診断用の性格イメージ'].every((h) => d.h3.indexOf(h) >= 0) && d.li >= 3 && d.mini === 6,
    '主な功績・有名な出来事・診断用の性格イメージ・パラメータ 6 行がある');
  check(S, 'AC-26', d.focus === 'dlg-close', '開いた直後のフォーカスは「閉じる」');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, 'Esc で閉じる');
  let f = await focusIs(page, '#result-root .top3-card:nth-child(1) .btn-detail');
  check(S, 'AC-26', f, 'Esc で閉じ、カードの「くわしく見る」にフォーカスが戻る');

  // 2) 「くわしく見る」ボタンのクリック → 1 回だけ開く → 閉じるボタン
  await page.click('#result-root .top3-card:nth-child(2) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ 2');
  d = await page.eval(readDlg);
  check(S, 'NIT-4', d.opens === 2 && d.name === names.top3[1], 'ボタンのクリックでも 1 回だけ開く(累計 showModal ' + d.opens + ' 回、' + d.name + ')');
  await page.click('#dlg-general .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じるボタンで閉じる');
  f = await focusIs(page, '#result-root .top3-card:nth-child(2) .btn-detail');
  check(S, 'AC-26', f, '閉じるボタンで閉じ、フォーカスが元のボタンに戻る');

  // 3) 20 人一覧の行 → 背景クリックで閉じる
  await page.click('#result-root details.all-list > summary');
  await page.click('#result-root .all-row:nth-child(5) .all-name');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '一覧からの詳細ダイアログ');
  d = await page.eval(readDlg);
  check(S, 'NIT-4', d.opens === 3 && d.name === names.rows[4], '一覧の行のクリックで 5 位の武将(' + d.name + ')が 1 回だけ開く');
  await page.clickAt(4, 4);
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '背景クリックで閉じる');
  f = await focusIs(page, '#result-root .all-row:nth-child(5) .btn-detail');
  check(S, 'AC-26', f, '背景クリックで閉じ、行の「くわしく」にフォーカスが戻る');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');

  // 4) ダイアログ表示中に想定外の例外が起きても、#fatal がダイアログの下に隠れず「最初に戻る」を押せる
  await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ(例外の確認)');
  await page.eval('setTimeout(function(){throw new Error("__bc_fatal_probe__");},0);true');
  await page.waitFor('!document.getElementById("fatal").hidden', 2000, '#fatal の表示');
  const fz = await page.eval('(function(){var b=document.getElementById("fatal-restart");var r=b.getBoundingClientRect();' +
    'var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {open:' + dlgOpen('dlg-general') + ',ok:e===b||b.contains(e)};})()');
  check(S, 'AC-1', !fz.open && fz.ok, 'ダイアログ表示中の例外で、ダイアログが閉じて #fatal の「最初に戻る」を押せる');
  await page.click('#fatal-restart');
  await page.waitFor('SG.App.getState().phase==="START"&&document.getElementById("fatal").hidden', 2000, '#fatal から START へ');
  check(S, 'AC-19', true, '#fatal の「最初に戻る」でスタート画面に戻る');
  // この確認で意図的に起こした例外とその記録だけを除く
  page.allow.push(/__bc_fatal_probe__/, /^console\.error: App: 想定外のエラー/);
  checkNoProblems(page, S, 'AC-1', '例外の確認');
}

// 過去の日付を含む集計データ(ranking・reset-confirm で使う)
const SEED = { v: 1, total: { 'oda-nobunaga': 5, 'date-masamune': 2 },
  daily: { '2024-11-01': { 'oda-nobunaga': 3, 'date-masamune': 2 }, '2024-11-02': { 'oda-nobunaga': 2 } } };
const readRanking = '(function(){var R=document.getElementById("ranking-root");function all(s){return [].map.call(R.querySelectorAll(s),function(e){return e.textContent;});}' +
  'var sel=R.querySelector("select");return {title:(R.querySelector(".ranking-title")||{}).textContent,rows:all(".ranking-text"),empty:all(".empty"),' +
  'tabs:[].map.call(R.querySelectorAll("[role=tab]"),function(e){return e.getAttribute("data-scope")+":"+e.getAttribute("aria-selected");}),' +
  'options:sel?[].map.call(sel.options,function(o){return o.value;}):null,selected:sel?sel.value:null,warn:all(".warn-text")};})()';

// ---- ranking: 加算・再加算なし・タブ・日付の select・0 件の表示(AC-15・AC-16) ----
async function scenarioRanking(page, opts, url) {
  const S = 'ranking';
  await openApp(page, url);
  // 0 件のとき(スタート画面の「運営用(集計)」から開く)
  await page.click('#open-ranking');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  const e0 = await page.eval(readRanking);
  await page.click('#ranking-root [role=tab][data-scope="total"]');
  const e1 = await page.eval(readRanking);
  await page.click('#ranking-root [role=tab][data-scope="date"]');
  const e2 = await page.eval(readRanking);
  const EMPTY = 'まだ診断結果がありません';
  check(S, 'AC-16', e0.title === '本日の戦国武将ランキング' && e0.tabs.join() === 'today:true,date:false,total:false' && e0.empty[0] === EMPTY,
    '0 件の「本日」に「' + e0.empty[0] + '」');
  check(S, 'AC-16', e1.empty[0] === EMPTY && e2.empty[0] === EMPTY && e2.options === null && e1.rows.length === 0,
    '0 件の「累計」「日付別」も「' + EMPTY + '」で、日付の select は出ない');
  await page.click('#ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');

  // 過去の日付を localStorage に入れてから開き直す(再読み込みで上書きしないよう 1 回だけ)
  await page.addInit('(function(){try{if(!localStorage.getItem("__sg_seeded")){localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',' +
    JSON.stringify(JSON.stringify(SEED)) + ');localStorage.setItem("__sg_seeded","1");}}catch(e){}})()');
  await openApp(page, url);
  const meta = await page.eval('({ids:SG.Generals.map(function(g){return g.id;}),names:SG.Generals.map(function(g){return g.name;}),today:SG.Storage.getDefault().todayKey()})');
  const nameOf = (id) => meta.names[meta.ids.indexOf(id)];
  const rowsOf = (counts) => Object.keys(counts).map((id) => ({ id, c: counts[id] }))
    .sort((a, b) => (b.c - a.c) || (meta.ids.indexOf(a.id) - meta.ids.indexOf(b.id)))
    .map((x, i) => (i + 1) + '位 ' + nameOf(x.id) + '型　' + x.c + '人');
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  const T = await page.eval('SG.App.getState().topId');
  const expTotal = Object.assign({}, SEED.total);
  expTotal[T] = (expTotal[T] || 0) + 1;
  const countsNow = () => page.eval('({today:SG.Storage.getDefault().getCounts("today"),total:SG.Storage.getDefault().getCounts("total")})');
  const c1 = await countsNow();
  check(S, 'AC-15', JSON.stringify(c1.today) === JSON.stringify([{ id: T, count: 1 }]) && c1.total.find((x) => x.id === T).count === expTotal[T],
    '結果確定で ' + nameOf(T) + ' の本日が 1、累計が ' + expTotal[T] + ' になる');

  // 結果画面からは来場者向けランキングを往復し、リサイズしても増えないことを確かめる
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  await page.setViewport(390, 844);
  await sleep(300);
  await page.setViewport(1280, 800);
  await sleep(300);
  const c2 = await countsNow();
  check(S, 'AC-15', JSON.stringify(c2) === JSON.stringify(c1), 'ランキングの往復とリサイズで再加算されない');

  // 運営用の集計表は、最初に戻ってスタート画面の「運営用(集計)」から開く
  await page.click('#result-root [data-action="restart"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await page.click('#open-ranking');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  const r0 = await page.eval(readRanking);
  check(S, 'AC-16', JSON.stringify(r0.rows) === JSON.stringify(['1位 ' + nameOf(T) + '型　1人']), '本日: ' + r0.rows.join(' / '));
  await page.click('#ranking-root [role=tab][data-scope="total"]');
  const r1 = await page.eval(readRanking);
  check(S, 'AC-16', r1.tabs.join() === 'today:false,date:false,total:true' && JSON.stringify(r1.rows) === JSON.stringify(rowsOf(expTotal)),
    '累計(降順): ' + r1.rows.join(' / '));
  await page.click('#ranking-root [role=tab][data-scope="date"]');
  const r2 = await page.eval(readRanking);
  check(S, 'AC-16', JSON.stringify(r2.options) === JSON.stringify([meta.today, '2024-11-02', '2024-11-01']) && r2.selected === meta.today &&
    JSON.stringify(r2.rows) === JSON.stringify(['1位 ' + nameOf(T) + '型　1人']),
    '日付別: select は新しい順(' + (r2.options || []).join(', ') + ')で既定は最新');
  await page.eval('(function(){var s=document.querySelector("#ranking-root select");s.value="2024-11-01";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  const r3 = await page.eval(readRanking);
  check(S, 'AC-16', r3.selected === '2024-11-01' && JSON.stringify(r3.rows) === JSON.stringify(rowsOf(SEED.daily['2024-11-01'])) && /2024年11月1日/.test(r3.title),
    '過去の日付を選ぶとその日の集計: ' + r3.title + ' ' + r3.rows.join(' / '));

  // リロードで増えない
  await page.click('#ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await openApp(page, url);
  const c3 = await countsNow();
  const ph = await page.eval('SG.App.getState().phase');
  check(S, 'AC-15', JSON.stringify(c3) === JSON.stringify(c1) && ph === 'START', 'リロードしても再加算されず、スタート画面から始まる(累計 ' +
    c3.total.reduce((s, x) => s + x.count, 0) + '人)');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- reset-confirm: 運営用メニュー・確認ダイアログ(AC-17・AC-29) ----
async function scenarioResetConfirm(page, opts, url) {
  const S = 'reset-confirm';
  await openApp(page, url);
  await page.eval('localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',' + JSON.stringify(JSON.stringify(SEED)) + ')');
  const seeded = await page.eval(totalOf('total'));
  const before = await page.eval('document.querySelectorAll("[data-action=reset]").length');
  check(S, 'AC-17', seeded === 7 && before === 0, 'スタート画面にはリセットのボタンがない(集計 ' + seeded + '人を用意)');
  await page.click('#open-ranking');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  const m = await page.eval('(function(){var b=document.querySelectorAll("[data-action=reset]");var d=b[0]&&b[0].closest("details.staff-menu");' +
    'return {n:b.length,inMenu:!!d,closed:d?!d.open:false,' +
    // 閉じた details の中身は content-visibility で隠れる(矩形は残る)ので、checkVisibility で「見えない」ことを確かめる
    'visible:b[0]?(b[0].checkVisibility?b[0].checkVisibility():b[0].getBoundingClientRect().height>0):null,summary:d?d.querySelector("summary").textContent:null};})()');
  check(S, 'AC-17', m.n === 1 && m.inMenu && m.closed && m.visible === false, 'リセットは閉じた「' + m.summary + '」の中にだけあり、開くまで表示されない(' + JSON.stringify(m) + ')');
  await page.click('#ranking-root details.staff-menu > summary');
  const shown = await page.eval('(function(){var b=document.querySelector("[data-action=reset]");return b.checkVisibility?b.checkVisibility():b.getBoundingClientRect().height>0;})()');
  check(S, 'AC-17', shown === true, '「運営用メニュー」を開くとリセットのボタンが見える');

  const openConfirm = async () => {
    await page.click('#ranking-root [data-action="reset"]');
    await page.waitFor(dlgOpen('dlg-confirm'), 2000, '確認ダイアログ');
    return page.eval('({focus:document.activeElement&&document.activeElement.getAttribute("data-confirm"),msg:document.querySelector("#dlg-confirm .confirm-msg").textContent})');
  };
  const afterClose = async (label) => {
    await page.waitFor('!' + dlgOpen('dlg-confirm'), 2000, label);
    return page.eval(totalOf('total'));
  };
  let o = await openConfirm();
  check(S, 'AC-29', o.focus === 'cancel', '確認ダイアログ「' + o.msg + '」を開いた直後のフォーカスは「キャンセル」');
  await page.key('Escape');
  let t = await afterClose('Esc');
  check(S, 'AC-29', t === 7, 'Esc はキャンセル扱いで集計は消えない(' + t + '人)');
  check(S, 'AC-29', await focusIs(page, '#ranking-root [data-action="reset"]'), '閉じたあとフォーカスはリセットのボタンに戻る');
  await openConfirm();
  await page.clickAt(4, 4);
  t = await afterClose('背景クリック');
  check(S, 'AC-29', t === 7, '背景クリックはキャンセル扱いで集計は消えない(' + t + '人)');
  await openConfirm();
  await page.click('#dlg-confirm [data-confirm="cancel"]');
  t = await afterClose('キャンセル');
  check(S, 'AC-17', t === 7, '「キャンセル」では集計は消えない(' + t + '人)');
  await openConfirm();
  await page.click('#dlg-confirm [data-confirm="ok"]');
  t = await afterClose('リセットする');
  await sleep(200);
  const z = await page.eval('({raw:localStorage.getItem(' + JSON.stringify(STATS_KEY) + '),r:' + readRanking + '})');
  check(S, 'AC-17', t === 0 && z.raw === null && z.r.empty[0] === 'まだ診断結果がありません', '「リセットする」で集計が消え、0 件の表示になる');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// PNG の先頭(シグネチャと IHDR)から幅と高さを読む
function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig) || buf.toString('ascii', 12, 16) !== 'IHDR') { return null; }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
// ダウンロードの完了(.crdownload が消え、ファイルができる)を待つ
async function waitDownload(dir, name, timeout) {
  const file = path.join(dir, name);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const partial = fs.readdirSync(dir).some((f) => /\.crdownload$|\.tmp$/i.test(f));
    if (!partial && fs.existsSync(file) && fs.statSync(file).size > 0) { return file; }
    await sleep(100);
  }
  return null;
}
function parseCardLog(page, from) {
  const lines = page.logs.slice(from || 0).filter((l) => /^ShareCard:/.test(l.text));
  const last = lines[lines.length - 1];
  if (!last) { return null; }
  const m = /usedFallback=(true|false)(?: reason=(\S+))? bytes=(\S+) dataUrlLength=(\d+)/.exec(last.text);
  return { text: last.text, type: last.type, count: lines.length,
    usedFallback: m ? m[1] === 'true' : null, reason: m ? m[2] || null : null, bytes: m && m[3] !== 'null' ? Number(m[3]) : null, dataUrlLength: m ? Number(m[4]) : null };
}
// 結果画面で「結果を画像で保存」を押し、プレビューが開くまで待つ(所要時間 ms を返す)
async function saveCard(page) {
  const t0 = Date.now();
  await page.click('#result-root [data-action="save"]');
  await page.waitFor(dlgOpen('dlg-card') + '&&SG.App.getState().hasCardResult&&!SG.App.getState().cardBusy', 6000, 'プレビュー');
  await page.waitFor('(function(){var i=document.querySelector("#dlg-card img");return i&&i.complete&&i.naturalWidth>0;})()', 3000, 'プレビュー画像');
  return Date.now() - t0;
}
const readPreview = '(function(){var i=document.querySelector("#dlg-card img");var a=document.querySelector("#dlg-card .card-save");' +
  'return i?{w:i.naturalWidth,h:i.naturalHeight,complete:i.complete,src:(i.getAttribute("src")||"").slice(0,5),href:a&&a.getAttribute("href")===i.getAttribute("src"),' +
  'download:a&&a.getAttribute("download")}:null;})()';

// ---- card: 結果画像の保存(AC-14) ----
async function scenarioCard(page, opts, url, b) {
  const S = 'card';
  await openApp(page, url);
  await startAndAnswer(page, PATTERN_LONG);
  await waitResult(page);
  const id = await page.eval('SG.App.getState().topId');
  const name = 'sengoku-' + id + '.png';
  const ms = await saveCard(page);
  check(S, 'NFR-3', ms <= 5000, '保存ボタンからプレビュー表示まで ' + ms + 'ms(5 秒以内)');
  const file = await waitDownload(b.downloads, name, 10000);
  check(S, 'AC-14', !!file, name + ' がダウンロードされる');
  let size = null;
  let bytes = 0;
  if (file) {
    const buf = fs.readFileSync(file);
    bytes = buf.length;
    size = pngSize(buf);
    if (opts.screenshots) {
      fs.mkdirSync(opts.screenshots, { recursive: true });
      fs.copyFileSync(file, path.join(opts.screenshots, name));
      console.log('  png: ' + path.join(opts.screenshots, name));
    }
  }
  check(S, 'AC-14', size && size.w === 1080 && size.h === 1920, 'PNG の IHDR が 1080×1920(' + (size ? size.w + '×' + size.h : '読めない') + ')、' + bytes + ' バイト');
  const log = parseCardLog(page);
  check(S, 'AC-14', log && log.usedFallback === false && log.type === 'info', 'console に「' + (log ? log.text : 'なし') + '」(usedFallback=false)');
  check(S, 'AC-14', log && log.bytes === bytes, 'ログの bytes とダウンロードした PNG のバイト数が一致(' + (log ? log.bytes : '-') + ')');
  let pv = await page.eval(readPreview);
  check(S, 'AC-14', pv && pv.w === 1080 && pv.h === 1920 && pv.href && pv.download === name,
    'プレビュー画像 ' + (pv ? pv.w + '×' + pv.h + '(src=' + pv.src + '…)' : 'なし') + '、保存リンクの download=' + (pv ? pv.download : '-'));
  if (!opts.skipLong) {
    await sleep(31000);
    pv = await page.eval(readPreview);
    const reload = await page.eval('new Promise(function(r){var s=document.querySelector("#dlg-card img").getAttribute("src");var i=new Image();' +
      'i.onload=function(){r(i.naturalWidth);};i.onerror=function(){r(-1);};i.src=s;})');
    check(S, 'AC-14', pv && pv.w === 1080 && pv.complete && reload === 1080, '31 秒後もプレビューが表示され、src から読み直せる(naturalWidth ' + (pv ? pv.w : '-') + ' / 再読込 ' + reload + ')');
  } else {
    console.log('  (--skip-long: 31 秒後のプレビュー確認を省略)');
  }
  await page.click('#dlg-card .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-card'), 2000, 'プレビューを閉じる');
  const st = await page.eval('({has:SG.App.getState().hasCardResult,imgs:document.querySelectorAll("#dlg-card img").length})');
  check(S, 'AC-14', !st.has && st.imgs === 0, 'プレビューを閉じると結果画像の参照と DOM が破棄される');
  check(S, 'AC-14', await focusIs(page, '#result-root [data-action="save"]'), '閉じたあとフォーカスは保存ボタンに戻る');
  // 2 回目の保存(同じページから続けて保存できるか。複数ダウンロードの扱いは記録のみ)
  const from = page.logs.length;
  await saveCard(page);
  const log2 = parseCardLog(page, from);
  check(S, 'AC-14', log2 && log2.usedFallback === false, '2 回目の保存も usedFallback=false');
  await sleep(1500);
  const pngs = fs.readdirSync(b.downloads).filter((f) => /\.png$/i.test(f));
  console.log('  (情報) ダウンロード先の PNG: ' + pngs.join(', '));
  await page.click('#dlg-card .dlg-close');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- no-storage: localStorage が例外を投げる環境(AC-18) ----
async function scenarioNoStorage(page, opts, url) {
  const S = 'no-storage';
  page.allow.push(/^console\.warning: Storage:/);
  await page.addInit('(function(){var t=function(){throw new DOMException("blocked","SecurityError");};' +
    'try{Object.defineProperty(window,"localStorage",{configurable:true,get:t});}catch(e){}' +
    'try{Storage.prototype.getItem=t;Storage.prototype.setItem=t;Storage.prototype.removeItem=t;}catch(e){}})()');
  await openApp(page, url);
  const env = await page.eval('(function(){try{window.localStorage.getItem("x");return false;}catch(e){return true;}})()');
  const p = await page.eval('SG.Storage.getDefault().isPersistent()');
  check(S, 'AC-18', env && p === false, 'localStorage が例外を投げる状態で起動し、メモリ内の集計に切り替わる(isPersistent=false)');
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  const r = await page.eval('({top:SG.App.getState().topId,cards:document.querySelectorAll("#result-root .top3-card").length})');
  check(S, 'AC-18', !!r.top && r.cards === 3, '診断と結果表示が動く(1 位 ' + r.top + ')');
  await saveCard(page);
  const log = parseCardLog(page);
  check(S, 'AC-18', log && log.usedFallback === false, '画像保存も動く(' + (log ? log.text : 'ログなし') + ')');
  await page.click('#dlg-card .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-card'), 2000, 'プレビューを閉じる');
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const rk = await page.eval('(function(){var R=document.getElementById("player-ranking-root");var w=R.querySelector(".pr-note-warn");' +
    'return {warn:w&&!w.hidden?[w.textContent]:[],rows:[].map.call(R.querySelectorAll(".pr-text"),function(e){return e.textContent;})};})()');
  check(S, 'AC-18', rk.warn.length === 1 && rk.warn[0].indexOf('この環境では集計を保存できません') === 0, 'ランキングに「' + rk.warn[0] + '」');
  check(S, 'AC-18', rk.rows.length === 1 && /1人\(100%\)$/.test(rk.rows[0]), 'このページの中では集計される(' + rk.rows.join(' / ') + ')');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- idle: 無操作タイマー(AC-20)。SG_CONFIG_OVERRIDE で時間を短くする ----
async function scenarioIdle(page, opts, url) {
  const S = 'idle';
  const toastShown = '!document.getElementById("idle-toast").hidden';
  let initId = await page.addInit('window.SG_CONFIG_OVERRIDE={IDLE_RESET_MS_QUESTION:3000,IDLE_RESET_MS_RESULT:3000,IDLE_WARN_MS:1000};');
  await openApp(page, url);
  // START では張らない
  await sleep(3600);
  let s = await page.eval('({phase:SG.App.getState().phase,toast:' + toastShown + '})');
  check(S, 'AC-20', s.phase === 'START' && !s.toast, 'スタート画面では 3.6 秒待っても警告もリセットもない');

  // 質問画面: 警告 → 満了でスタートへ
  await page.click('#btn-start');
  let t0 = Date.now();
  await page.waitFor(toastShown, 5000, '警告');
  const tWarn = Date.now() - t0;
  const phW = await page.eval('SG.App.getState().phase');
  await page.waitFor('SG.App.getState().phase==="START"', 4000, '満了');
  const tReset = Date.now() - t0;
  s = await page.eval('({answers:SG.App.getState().answers,toast:' + toastShown + '})');
  check(S, 'AC-20', phW === 'QUESTION' && tWarn >= 1700 && tWarn <= 2700, '質問画面で満了 1 秒前に警告が出る(' + tWarn + 'ms、期待 約 2000)');
  check(S, 'AC-20', tReset >= 2700 && tReset <= 3900 && s.answers.every((a) => a === null) && !s.toast, '満了でスタート画面に戻り回答が消える(' + tReset + 'ms、期待 約 3000)');

  // 「続ける」で張り直す
  await page.click('#btn-start');
  await page.waitFor(toastShown, 5000, '警告 2');
  await page.click('#idle-toast button');
  t0 = Date.now();
  await sleep(1500);
  s = await page.eval('({phase:SG.App.getState().phase,toast:' + toastShown + '})');
  check(S, 'AC-20', s.phase === 'QUESTION' && !s.toast, '「続ける」で警告が消え、タイマーが張り直される');
  await page.waitFor('SG.App.getState().phase==="START"', 4000, '満了 2');
  const tReset2 = Date.now() - t0;
  check(S, 'AC-20', tReset2 >= 2500 && tReset2 <= 3900, '「続ける」から約 3 秒で満了(' + tReset2 + 'ms)');

  // 結果画面(詳細ダイアログを開いたまま)でも戻る
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await page.waitFor(toastShown, 5000, '結果画面の警告');
  // モーダルのダイアログ(トップレイヤー)の上に警告が見えていて、「続ける」の中心をクリックできる
  const hit = await page.eval('(function(){var b=document.querySelector("#idle-toast button");var r=b.getBoundingClientRect();' +
    'var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {x:r.left+r.width/2,y:r.top+r.height/2,' +
    'ok:!!e&&(e===b||b.contains(e)),inView:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};})()');
  check(S, 'AC-20', hit.ok && hit.inView, 'ダイアログ表示中も警告がダイアログより手前に表示され、「続ける」を押せる位置にある');
  await page.clickAt(hit.x, hit.y);
  await sleep(300);
  s = await page.eval('({open:' + dlgOpen('dlg-general') + ',toast:' + toastShown + ',inBody:document.getElementById("idle-toast").parentNode===document.body,phase:SG.App.getState().phase})');
  check(S, 'AC-20', s.open && !s.toast && s.inBody && s.phase === 'RESULT', '「続ける」でダイアログは開いたまま警告が消え、警告は body へ戻る');
  await page.waitFor(toastShown, 5000, '結果画面の警告 2');
  await page.waitFor('SG.App.getState().phase==="START"', 4000, '結果画面の満了');
  s = await page.eval('({open:' + dlgOpen('dlg-general') + ',result:document.getElementById("result-root").childElementCount,top:SG.App.getState().topId})');
  check(S, 'AC-20', !s.open && s.result === 0 && s.top === null, '結果画面(ダイアログ表示中)も満了でスタートに戻り、ダイアログと結果が消える');
  s = await page.eval('({inBody:document.getElementById("idle-toast").parentNode===document.body,toast:' + toastShown + '})');
  check(S, 'AC-20', s.inBody && !s.toast, 'ダイアログ表示中の満了のあとも、警告は body に戻り非表示');

  // 演出中は張らない(質問 2 秒 < 演出 2.5 秒)/ 0 で無効
  await page.removeInit(initId);
  initId = await page.addInit('window.SG_CONFIG_OVERRIDE={IDLE_RESET_MS_QUESTION:2000,IDLE_RESET_MS_RESULT:0,IDLE_WARN_MS:1000};');
  await openApp(page, url);
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="ANALYZING"', 2000, 'ANALYZING へ');
  await page.waitFor('SG.App.getState().phase!=="ANALYZING"', 5000, '演出の終了');
  const after = await page.eval('SG.App.getState().phase');
  check(S, 'AC-20', after === 'RESULT', '演出中(2.5 秒)は質問の無操作時間(2 秒)を過ぎてもリセットされず結果へ進む(' + after + ')');
  await sleep(3500);
  s = await page.eval('({phase:SG.App.getState().phase,toast:' + toastShown + '})');
  check(S, 'AC-20', s.phase === 'RESULT' && !s.toast, 'IDLE_RESET_MS_RESULT=0 なら結果画面は 3.5 秒待っても戻らない(無効)');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- image-fallback: 画像の読み込み失敗で代替カードへ(AC-21) ----
async function scenarioImageFallback(page, opts, url) {
  const S = 'image-fallback';
  page.allow.push(/__missing__/); // 存在しない画像の読み込み失敗ログは想定どおり
  // generals.js が SG.Generals に代入するときに、存在しない画像のパスを差し込んだコピーにすり替える
  await page.addInit('(function(){var store;var SG={};Object.defineProperty(SG,"Generals",{configurable:true,enumerable:true,' +
    'get:function(){return store;},set:function(v){store=Object.freeze(v.map(function(g){var c=Object.assign({},g);' +
    'c.image="assets/images/__missing__-"+g.id+".png";c.imageCredit="テスト用(存在しない画像)";return Object.freeze(c);}));}});window.SG=SG;})()');
  await openApp(page, url);
  const img = await page.eval('SG.Generals[0].image');
  check(S, 'AC-21', /__missing__/.test(img), 'SG.Generals に存在しない画像のパスを差し込んだ(' + img + ')');
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  await page.waitFor('document.querySelectorAll("#result-root img[data-fallback-id]").length===0', 3000, '代替カードへの差し替え');
  await sleep(1300);
  const r = await page.eval('({hero:!!document.querySelector("#result-root .gold-frame .portrait[role=img] svg"),' +
    'top3:[].every.call(document.querySelectorAll("#result-root .top3-card"),function(c){return !!c.querySelector(".portrait[role=img] svg");}),' +
    'imgs:document.querySelectorAll("#result-root img").length,fatal:!document.getElementById("fatal").hidden})');
  check(S, 'AC-21', r.hero && r.top3 && r.imgs === 0 && !r.fatal, '結果画面の金枠と TOP3 の画像がすべて代替カード(SVG)に替わり、エラー画面は出ない');
  await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await page.waitFor('document.querySelectorAll("#dlg-general img").length===0&&!!document.querySelector("#dlg-general .portrait[role=img] svg")', 3000, 'ダイアログの代替カード');
  check(S, 'AC-21', true, '詳細ダイアログの画像も代替カードに替わる');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  await saveCard(page);
  const log = parseCardLog(page);
  check(S, 'AC-21', log && log.usedFallback === false, '画像がなくても結果画像を保存できる(' + (log ? log.text : 'ログなし') + ')');
  const others = page.problems.filter((t) => !/__missing__/.test(t));
  check(S, 'AC-21', page.problems.length > 0 && others.length === 0, '出た問題は画像の読み込み失敗(' + page.problems.length + ' 件)だけ');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体(画像の読み込み失敗を除く)');
}

// ---- layout: 横スクロール・360×540 の縦の予算・360×640 の閉じるボタン(AC-22・AC-34) ----
const WIDTHS = [320, 360, 390, 768, 1280, 1920];
async function noHScroll(page, S, label) {
  const bad = [];
  for (const w of WIDTHS) {
    await page.setViewport(w, 800);
    await sleep(200);
    const m = await page.eval('({sw:document.documentElement.scrollWidth,bw:document.body.scrollWidth,iw:innerWidth})');
    if (m.sw > m.iw || m.bw > m.iw) { bad.push(w + ':' + m.sw + '/' + m.iw); }
  }
  check(S, 'AC-22', bad.length === 0, label + 'に ' + WIDTHS.join('・') + ' の幅で横スクロールがない' + (bad.length ? ' → ' + bad.join(', ') : ''));
}
// 要素が表示領域の中にあるか
const inView = (sel) => '(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;var r=e.getBoundingClientRect();' +
  'return {ok:r.width>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,r:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]};})()';

async function scenarioLayout(page, opts, url) {
  const S = 'layout';
  await openApp(page, url);
  await noHScroll(page, S, 'スタート画面');
  await page.click('#btn-start');
  await waitQuestion(page, 0);
  await noHScroll(page, S, '質問画面');
  await page.setViewport(360, 540);
  await sleep(450);
  const hs = [];
  const bad = [];
  for (let i = 0; i < 15; i++) {
    await waitQuestion(page, i);
    await sleep(80);
    const m = await page.eval('({sh:document.documentElement.scrollHeight,ih:innerHeight,nav:' + inView('#btn-prev') + ',d:' + inView('#screen-question .opt[data-index="3"]') + '})');
    hs.push(m.sh);
    if (!(m.sh <= m.ih && m.nav.ok && m.d.ok)) { bad.push('Q' + (i + 1) + ':' + m.sh + '/' + m.ih); }
    if (i === 0 || i === 14) { await page.screenshot('layout-q' + (i + 1) + '-360x540'); }
    await page.click('#screen-question .opt[data-index="' + PATTERN_LONG[i] + '"]');
  }
  check(S, 'AC-22', bad.length === 0, '360×540 で Q1〜Q15 すべて scrollHeight <= innerHeight で、D と「前の質問へ」が見える(最大 ' +
    Math.max.apply(null, hs) + 'px / 540)' + (bad.length ? ' → ' + bad.join(', ') : ''));
  await waitResult(page);
  await page.click('#result-root details.all-list > summary');
  await noHScroll(page, S, '結果画面(20 人一覧を開いた状態)');

  // NFR-4: 本文の文字サイズ(PC 1280 幅で 18px 以上、スマホ 390 幅で 16px 以上)
  const readFont = '(function(){function fs(s){var e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):0;}' +
    'return {body:fs("body"),reason:fs("#result-root .reason p"),desc:fs("#result-root .result-desc"),dlg:fs("#dlg-general[open] .dlg-body li")};})()';
  const fonts = {};
  for (const w of [390, 1280]) {
    await page.setViewport(w, 800);
    await sleep(200);
    await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
    await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
    fonts[w] = await page.eval(readFont);
    await page.key('Escape');
    await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  }
  const minOf = (f) => Math.min(f.body, f.reason, f.desc, f.dlg);
  check(S, 'NFR-4', minOf(fonts[1280]) >= 18 && minOf(fonts[390]) >= 16,
    '本文(body・似ている理由・武将の説明・詳細ダイアログ)が 1280 幅で 18px 以上、390 幅で 16px 以上(' + JSON.stringify(fonts) + ')');

  // 360×640: 結果画面・詳細ダイアログ・画像プレビューの閉じるボタン
  await page.setViewport(360, 640);
  await page.eval('scrollTo(0,0)');
  await sleep(300);
  const nm = await page.eval(inView('#result-root .general-name'));
  check(S, 'AC-34', nm && nm.ok, '360×640 で結果画面の武将名「真田幸村（信繁）」が横にはみ出さない(' + (nm ? nm.r.join(',') : '-') + ')');
  await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await sleep(300);
  const c1 = await page.eval(inView('#dlg-general .dlg-close'));
  await page.eval('(function(){var d=document.getElementById("dlg-general");d.scrollTop=d.scrollHeight;})()');
  await sleep(200);
  const c2 = await page.eval('({c:' + inView('#dlg-general .dlg-close') + ',dlg:' + inView('#dlg-general') + ',ow:(function(){var d=document.getElementById("dlg-general");return d.scrollWidth<=d.clientWidth;})()})');
  check(S, 'AC-34', c1.ok && c2.c.ok && c2.dlg.ok && c2.ow, '360×640 で詳細ダイアログの「閉じる」が、開いた直後も最後までスクロールしたあとも表示領域内(' + c1.r.join(',') + ' / ' + c2.c.r.join(',') + ')');
  await page.screenshot('layout-dialog-360x640');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  await saveCard(page);
  await sleep(300);
  const k1 = await page.eval('({c:' + inView('#dlg-card .dlg-close') + ',img:' + inView('#dlg-card img') + '})');
  await page.eval('(function(){var d=document.getElementById("dlg-card");d.scrollTop=d.scrollHeight;})()');
  await sleep(200);
  const k2 = await page.eval(inView('#dlg-card .dlg-close'));
  check(S, 'AC-34', k1.c.ok && k2.ok && k1.img.ok, '360×640 で画像プレビューの「閉じる」と画像が表示領域内(' + k1.c.r.join(',') + ' / 画像 ' + k1.img.r.join(',') + ')');
  await page.screenshot('layout-card-360x640');
  await page.click('#dlg-card .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-card'), 2000, 'プレビューを閉じる');
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await noHScroll(page, S, '来場者向けランキング画面');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  await page.click('#result-root [data-action="restart"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await page.click('#open-ranking');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  await page.click('#ranking-root details.staff-menu > summary');
  await noHScroll(page, S, 'ランキング画面(運営用メニューを開いた状態)');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- reduced-motion: アニメーションを止め、数値はすぐ最終値(AC-23) ----
async function scenarioReducedMotion(page, opts, url) {
  const S = 'reduced-motion';
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openApp(page, url);
  const anim = (sels) => '(function(){var o={};' + JSON.stringify(sels) + '.forEach(function(s){var p=s.split("::");var e=document.querySelector(p[0]);' +
    'o[s]=e?getComputedStyle(e,p[1]?"::"+p[1]:null).animationName:"(なし)";});return o;})()';
  const allNone = (o) => Object.keys(o).every((k) => o[k] === 'none');
  const fmt = (o) => Object.keys(o).map((k) => k + '=' + o[k]).join(', ');
  const mm = await page.eval('matchMedia("(prefers-reduced-motion: reduce)").matches');
  const a1 = await page.eval(anim(['.deco-crest-bg', '.deco-banner', '#btn-start', '#screen-start']));
  check(S, 'AC-23', mm && allNone(a1), 'スタート画面のアニメーションが止まる(' + fmt(a1) + ')');
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="ANALYZING"', 2000, 'ANALYZING へ');
  const a2 = await page.eval(anim(['.analyzing-crest', '.ripple', '.analyzing-stage::before', '#screen-analyzing::before', '#screen-analyzing::after']));
  check(S, 'AC-23', allNone(a2), '演出画面の回転・波紋・金粉が止まる(' + fmt(a2) + ')');
  await page.waitFor('document.getElementById("analyzing-msg").textContent===' + JSON.stringify(ANALYZE_MESSAGES[2]), 3000, '3 つ目の文言');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ');
  const r = await page.eval('({shown:document.querySelector("#result-root .sim-num").textContent,sim:SG.Diagnosis.diagnose(SG.App.getState().answers).top.similarity})');
  check(S, 'AC-23', r.shown === String(r.sim), '結果になった直後に類似度が最終値 ' + r.shown + '%(カウントアップなし)');
  const a3 = await page.eval(anim(['.gold-frame', '.gold-frame::after', '.general-name .ch', '.bar-fill', '.radar-poly', '#screen-result']));
  check(S, 'AC-23', allNone(a3), '結果画面の金枠・文字・グラフのアニメーションが止まる(' + fmt(a3) + ')');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- keyboard: Tab / Enter / Esc だけで操作できる ----
async function scenarioKeyboard(page, opts, url) {
  const S = 'keyboard';
  await openApp(page, url);
  let tabs = 0;
  for (; tabs < 10; tabs++) {
    if (await page.eval('document.activeElement&&document.activeElement.id==="btn-start"')) { break; }
    await page.key('Tab');
  }
  check(S, 'NFR-5', tabs < 10, 'Tab ' + tabs + ' 回で「いざ、診断開始！」にフォーカスが届く');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="QUESTION"', 3000, 'QUESTION へ');
  let okFocus = 0;
  for (let i = 0; i < 15; i++) {
    await waitQuestion(page, i);
    // 質問文 → A → B → C → D の順にフォーカスが進む
    for (let k = 0; k <= PATTERN[i]; k++) { await page.key('Tab'); }
    if (await page.eval('document.activeElement===document.querySelector(\'#screen-question .opt[data-index="' + PATTERN[i] + '"]\')')) { okFocus++; }
    await page.key('Enter');
  }
  check(S, 'NFR-5', okFocus === 15, '15 問すべて Tab で選択肢に移り Enter で回答できる(' + okFocus + ' / 15)');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  const top = await page.eval('SG.App.getState().topId===SG.Diagnosis.diagnose(' + JSON.stringify(PATTERN) + ').top.general.id');
  check(S, 'NFR-5', top, 'キーボードで答えた結果がマウスと同じ回答の結果と一致');
  await page.eval('document.querySelector("#result-root .top3-card:nth-child(1) .btn-detail").focus()');
  await page.key('Enter');
  await page.waitFor(dlgOpen('dlg-general'), 2000, 'Enter で詳細ダイアログ');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, 'Esc で閉じる');
  check(S, 'NFR-5', await focusIs(page, '#result-root .top3-card:nth-child(1) .btn-detail'), 'Enter で開いた詳細ダイアログが Esc で閉じ、フォーカスが戻る');
  // close イベント(非同期)の処理が終わるまで待つ。先に進むと restoreFocus が後からフォーカスを奪う
  await page.waitFor('document.getElementById("dlg-general").childElementCount===0', 2000, 'close イベントの処理');
  // ランキングのタブ: Tab で選択中のタブに入り、←→ / Home / End で 3 つを切り替えられる
  // 来場者向けランキング(結果画面から。タブは 今日/累計 の 2 つ)
  await page.eval('document.querySelector("#result-root [data-action=ranking]").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  let pHops = 0;
  for (; pHops < 5; pHops++) {
    if (await page.eval('document.activeElement&&document.activeElement.getAttribute("role")==="tab"')) { break; }
    await page.key('Tab');
  }
  const readPTab = '(function(){var a=document.activeElement;var sel=document.querySelector("#player-ranking-root [role=tab][aria-selected=true]");' +
    'return (a&&a.getAttribute("role")==="tab"?a.getAttribute("data-scope"):"-")+"/"+(sel?sel.getAttribute("data-scope"):"-");})()';
  const pSeq = [await page.eval(readPTab)];
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    await page.key(k);
    pSeq.push(await page.eval(readPTab));
  }
  const pExpect = ['today/today', 'total/total', 'today/today', 'total/total', 'today/today', 'total/total'];
  check(S, 'NFR-5', pHops < 5 && JSON.stringify(pSeq) === JSON.stringify(pExpect),
    '来場者向けランキングのタブに Tab ' + pHops + ' 回で届き、←→ / Home / End でフォーカスと選択が移る(' + pSeq.join(' → ') + ')');
  await page.eval('document.querySelector("#player-ranking-root [data-action=back]").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  check(S, 'NFR-5', await focusIs(page, '#result-root [data-action="ranking"]'), '戻るとフォーカスは開いたボタンに戻る');
  // Esc でも戻れる
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await page.key('Escape');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'Esc で RESULT へ戻る');
  // 運営用の集計表(スタート画面の「運営用(集計)」から。タブは 本日/日付別/累計 の 3 つ)
  await page.eval('document.querySelector("#result-root [data-action=restart]").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await page.eval('document.getElementById("open-ranking").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  let tabHops = 0;
  for (; tabHops < 5; tabHops++) {
    if (await page.eval('document.activeElement&&document.activeElement.getAttribute("role")==="tab"')) { break; }
    await page.key('Tab');
  }
  const readTab = '(function(){var a=document.activeElement;var sel=document.querySelector("#ranking-root [role=tab][aria-selected=true]");' +
    'return (a&&a.getAttribute("role")==="tab"?a.getAttribute("data-scope"):"-")+"/"+(sel?sel.getAttribute("data-scope"):"-");})()';
  const tabSeq = [await page.eval(readTab)];
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    await page.key(k);
    tabSeq.push(await page.eval(readTab));
  }
  const tabExpect = ['today/today', 'date/date', 'total/total', 'today/today', 'total/total', 'today/today', 'total/total'];
  check(S, 'NFR-5', tabHops < 5 && JSON.stringify(tabSeq) === JSON.stringify(tabExpect),
    'ランキングのタブに Tab ' + tabHops + ' 回で届き、←→ / Home / End でフォーカスと選択が移る(' + tabSeq.join(' → ') + ')');
  const title = await page.eval('document.querySelector("#ranking-root .ranking-title").textContent');
  check(S, 'NFR-5', title === '戦国武将ランキング(累計)', 'キーボードで選んだタブの集計が表示される(' + title + ')');
  await page.eval('document.querySelector("#ranking-root [data-action=back]").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  check(S, 'NFR-5', await focusIs(page, '#btn-start'), 'Enter で運営用画面の「戻る」を押すとスタート画面の開始ボタンにフォーカス');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

// ---- screens: 390×844 と 1280×800 のスクリーンショット(--screenshots のときだけ) ----
async function scenarioScreens(page, opts, url) {
  const S = 'screens';
  if (!opts.screenshots) { console.log('  (--screenshots がないので撮影を省略)'); return; }
  for (const vp of [[390, 844], [1280, 800]]) {
    const w = vp[0];
    await openApp(page, url, vp[0], vp[1]);
    await page.eval('localStorage.removeItem(' + JSON.stringify(STATS_KEY) + ')');
    await settle();
    await page.screenshot('start-' + w);
    await page.screenshot('start-with-button-' + w);
    await page.screenshot('start-zukan-' + w);
    // 戦国武将図鑑: 一覧(五十音順)・詳細(前/次つき)
    await page.click('#btn-zukan');
    await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'ZUKAN へ');
    await settle();
    await page.screenshot('zukan-' + w, true);
    await page.click('#zukan-root .zukan-card[data-general-id="sanada-yukimura"]');
    await page.waitFor(dlgOpen('dlg-general'), 2000, '図鑑の詳細');
    await sleep(500);
    await page.screenshot('zukan-detail-' + w);
    await page.key('Escape');
    await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
    await page.click('#zukan-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
    // 来場者向けランキング: 0 件 → 全 20 人ぶんの種データ(累計)
    await page.click('#btn-player-ranking');
    await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
    await settle();
    await page.screenshot('player-ranking-empty-' + w);
    await page.click('#player-ranking-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
    await page.eval('(function(){var t={};SG.Generals.forEach(function(g,i){t[g.id]=(i%7===0?0:1)+((i*7)%11)+1;});' +
      'localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',JSON.stringify({v:1,total:t,daily:{}}));})()');
    await page.click('#btn-player-ranking');
    await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
    await page.click('#player-ranking-root [role=tab][data-scope="total"]');
    await settle();
    await page.screenshot('player-ranking-total-' + w, true);
    await page.click('#player-ranking-root [data-action="show-all"]');
    await settle();
    await page.screenshot('player-ranking-total-all-' + w, true);
    await page.click('#player-ranking-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
    await page.click('#btn-start');
    await settle();
    await page.screenshot('question-' + w);
    for (let i = 0; i < 15; i++) {
      await waitQuestion(page, i);
      await page.click('#screen-question .opt[data-index="' + PATTERN_LONG[i] + '"]');
    }
    await page.waitFor('SG.App.getState().phase==="ANALYZING"', 2000, 'ANALYZING へ');
    await sleep(1100);
    await page.screenshot('analyzing-' + w);
    await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
    await sleep(1800);
    await page.screenshot('result-' + w, true);
    await page.screenshot('result-with-button-' + w, true);
    await page.screenshot('result-zukan-button-' + w, true);
    await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
    await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
    await sleep(500);
    await page.screenshot('dialog-' + w);
    await page.key('Escape');
    await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
    await saveCard(page);
    await sleep(400);
    await page.screenshot('card-' + w);
    await page.click('#dlg-card .dlg-close');
    await page.waitFor('!' + dlgOpen('dlg-card'), 2000, 'プレビューを閉じる');
    await page.click('#result-root [data-action="ranking"]');
    await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
    await settle();
    await page.screenshot('ranking-' + w);
    await page.click('#player-ranking-root [role=tab][data-scope="total"]');
    await settle();
    await page.screenshot('player-ranking-from-result-' + w, true);
    await page.click('#player-ranking-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
    await page.click('#result-root [data-action="restart"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
    await page.click('#open-ranking');
    await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
    await settle();
    await page.screenshot('ranking-staff-' + w);
  }
  checkNoProblems(page, S, 'AC-1', '撮影の操作全体');
}

// ---- player-ranking: 来場者向け「みんなの結果ランキング」(要件: 来場者が見られる。リセットは置かない) ----
// 修飾キー付きのキー入力(page.key は修飾キーを送れないので CDP を直接使う)
async function pressCombo(page, key, code, vk, modifiers) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 };
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
}
const readPR = '(function(){var R=document.getElementById("player-ranking-root");function all(s){return [].map.call(R.querySelectorAll(s),function(e){return e.textContent;});}' +
  'return {title:(R.querySelector(".pr-title")||{}).textContent,total:(R.querySelector(".pr-total")||{}).textContent,rows:all(".pr-text"),empty:all(".pr-empty"),' +
  'classes:[].map.call(R.querySelectorAll(".pr-row"),function(e){return e.className;}),' +
  'tabs:[].map.call(R.querySelectorAll("[role=tab]"),function(e){return e.getAttribute("data-scope")+":"+e.getAttribute("aria-selected")+":"+e.getAttribute("tabindex");}),' +
  'note:all(".pr-note"),me:all(".pr-row.is-me .pr-badge")};})()';
// 結果画面の状態(再加算・DOM 変化の検出用)
const snapResult = '(function(){var s=SG.App.getState();return JSON.stringify({counted:s.counted,answers:s.answers,top:s.topId,phase:s.phase,' +
  'html:document.getElementById("result-root").innerHTML.length,' +
  'text:document.getElementById("result-root").textContent,total:SG.Storage.getDefault().getTotalPlayers("total")});})()';

async function scenarioPlayerRanking(page, opts, url) {
  const S = 'player-ranking';
  const EMPTY = 'まだ診断結果がありません。あなたが最初の一人になろう！';
  // a. スタート画面から開く(0 件)。開くだけでは増えない
  await openApp(page, url);
  const btn = await page.eval('(function(){var b=document.getElementById("btn-player-ranking");return b?b.textContent.trim():null;})()');
  check(S, 'PR-1', btn === 'みんなの結果ランキング', 'スタート画面に「みんなの結果ランキング」のボタンがある(' + btn + ')');
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const a0 = await page.eval(readPR);
  const t0 = await page.eval(totalOf('total'));
  check(S, 'PR-1', a0.title === 'みんなの結果ランキング' && a0.empty[0] === EMPTY && a0.rows.length === 0 && t0 === 0,
    '0 件のとき「' + a0.empty[0] + '」。開いても合計は ' + t0 + ' のまま');
  check(S, 'PR-1', a0.note.indexOf('この端末・このブラウザの集計です(他の端末とは共有されません)') >= 0, '注記「この端末・このブラウザの集計です」が出る');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ戻る');
  check(S, 'PR-1', await focusIs(page, '#btn-player-ranking'), '戻るとスタート画面の開いたボタンにフォーカスが戻る');

  // b. 種データで順位・人数・割合・TOP3・今日/累計の切り替え・キー操作
  await page.addInit('(function(){try{if(!localStorage.getItem("__sg_seeded")){localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',' +
    JSON.stringify(JSON.stringify(SEED)) + ');localStorage.setItem("__sg_seeded","1");}}catch(e){}})()');
  await openApp(page, url);
  const meta = await page.eval('({ids:SG.Generals.map(function(g){return g.id;}),names:SG.Generals.map(function(g){return g.name;})})');
  const nameOf = (id) => meta.names[meta.ids.indexOf(id)];
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const b0 = await page.eval(readPR);
  check(S, 'PR-2', b0.tabs.join() === 'today:true:0,total:false:-1' && b0.empty[0] === EMPTY, '「今日」は種データが過去の日付なので 0 件(' + b0.tabs.join() + ')');
  await page.click('#player-ranking-root [role=tab][data-scope="total"]');
  const b1 = await page.eval(readPR);
  const exp = ['1位 ' + nameOf('oda-nobunaga') + '型　5人(71%)', '2位 ' + nameOf('date-masamune') + '型　2人(29%)'];
  check(S, 'PR-2', JSON.stringify(b1.rows) === JSON.stringify(exp) && b1.total === '診断人数 7人', '「累計」の順位・人数・割合: ' + b1.rows.join(' / '));
  check(S, 'PR-2', /tier-gold/.test(b1.classes[0]) && /tier-silver/.test(b1.classes[1]) && b1.tabs.join() === 'today:false:-1,total:true:0',
    '1 位が金・2 位が銀の枠で、選択タブだけ tabindex=0(' + b1.classes.join(' | ') + ')');
  await page.eval('document.querySelector("#player-ranking-root [role=tab][data-scope=total]").focus()');
  const seq = [];
  for (const k of ['ArrowLeft', 'End', 'Home']) {
    await page.key(k);
    seq.push(await page.eval('(function(){var a=document.activeElement;var s=document.querySelector("#player-ranking-root [role=tab][aria-selected=true]");return a.getAttribute("data-scope")+"/"+s.getAttribute("data-scope");})()'));
  }
  check(S, 'PR-2', seq.join() === 'today/today,total/total,today/today', 'タブを ←・End・Home で移動できる(' + seq.join(' → ') + ')');

  // c. 結果画面から開閉しても再加算・変化なし(往復 3 回、リサイズ)
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  const T = await page.eval('SG.App.getState().topId');
  const before = await page.eval(snapResult);
  const resultBtn = await page.eval('document.querySelector("#result-root [data-action=ranking]").textContent.trim()');
  check(S, 'PR-3', resultBtn === 'みんなの結果ランキング', '結果画面のボタンが「みんなの結果ランキング」(' + resultBtn + ')');
  let allSame = true;
  let meOk = true;
  for (let i = 0; i < 3; i++) {
    await page.click('#result-root [data-action="ranking"]');
    await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
    await page.click('#player-ranking-root [role=tab][data-scope="total"]');
    const m = await page.eval(readPR);
    if (!(m.me.length === 1 && m.me[0] === 'あなた' && m.rows.some((r) => r.indexOf(nameOf(T) + '型') >= 0))) { meOk = false; }
    await page.click('#player-ranking-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
    if ((await page.eval(snapResult)) !== before) { allSame = false; }
  }
  check(S, 'PR-3', meOk, '結果画面から開くと自分の武将の行に「あなた」のバッジが 1 つだけ付く');
  check(S, 'PR-3', allSame, '往復 3 回しても counted・回答・結果の DOM・合計人数が変わらない');
  await page.setViewport(390, 844);
  await sleep(300);
  await page.setViewport(1280, 800);
  await sleep(300);
  check(S, 'PR-3', (await page.eval(snapResult)) === before, 'リサイズしても変わらない');

  // d. 「最初に戻る」で回答・結果・来場者画面の DOM が空
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  // e. 来場者画面と結果画面にリセット・削除・運営用の操作がない
  const dom = await page.eval('(function(){var sc=document.getElementById("screen-player-ranking");var bad=/リセット|削除|消す|運営|clear|delete|reset/i;' +
    'return {resetAttr:sc.querySelectorAll("[data-action=reset],[data-action=clear],[data-action=delete]").length,' +
    'btnBad:[].filter.call(sc.querySelectorAll("button,a,summary,input"),function(e){return bad.test(e.textContent+" "+(e.getAttribute("aria-label")||"")+" "+(e.value||""));}).length,' +
    'details:sc.querySelectorAll("details,summary,dialog").length,accesskey:sc.querySelectorAll("[accesskey]").length,' +
    'textBad:bad.test(sc.textContent),' +
    'resultStaff:document.querySelectorAll("#result-root [data-action=reset],#result-root details.staff-menu,#result-root #open-ranking").length,' +
    'resultBad:[].filter.call(document.querySelectorAll("#result-root button"),function(e){return /リセット|削除|運営|集計表/.test(e.textContent);}).length};})()');
  check(S, 'PR-4', dom.resetAttr === 0 && dom.btnBad === 0 && dom.details === 0 && dom.accesskey === 0 && !dom.textBad,
    '来場者画面の DOM にリセット・削除・運営の操作、文言、details、accesskey がない(' + JSON.stringify(dom) + ')');
  check(S, 'PR-4', dom.resultStaff === 0 && dom.resultBad === 0, '結果画面の DOM に運営用画面への導線がない');
  // 隠しショートカット(修飾キー付き・一般的なキー)を送っても確認ダイアログも画面遷移も起きない
  const combos = [['R', 'KeyR', 82, 10], ['D', 'KeyD', 68, 10], ['r', 'KeyR', 82, 1], ['Delete', 'Delete', 46, 0], ['Backspace', 'Backspace', 8, 0],
    ['r', 'KeyR', 82, 0], ['c', 'KeyC', 67, 2], ['F2', 'F2', 113, 0], ['ArrowUp', 'ArrowUp', 38, 0], ['ArrowDown', 'ArrowDown', 40, 0]];
  for (const c of combos) { await pressCombo(page, c[0], c[1], c[2], c[3]); }
  await sleep(300);
  const sc = await page.eval('({confirm:' + dlgOpen('dlg-confirm') + ',phase:SG.App.getState().phase,total:' + totalOf('total') + '})');
  check(S, 'PR-4', !sc.confirm && sc.phase === 'PLAYER_RANKING' && sc.total === 8, 'ショートカットや一般的なキーを送っても確認ダイアログは開かず、集計も消えない(' + JSON.stringify(sc) + ')');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  await page.click('#result-root [data-action="restart"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  // 来場者画面を開いたまま「最初に戻る」相当(無操作リセット)は g で確認。ここでは戻った後の DOM を見る
  const emp = await page.eval('({r:document.getElementById("result-root").childElementCount,p:document.getElementById("player-ranking-root").childElementCount,' +
    'a:SG.App.getState().answers.every(function(x){return x===null;}),top:SG.App.getState().topId})');
  check(S, 'PR-5', emp.r === 0 && emp.p === 0 && emp.a && emp.top === null, '最初に戻ると回答・結果・来場者画面の DOM が空(' + JSON.stringify(emp) + ')');

  // f. 運営用: #open-ranking → 運営用画面 → staff-menu → 確認付きリセット → 来場者画面が 0 件
  await page.click('#open-ranking');
  await page.waitFor('SG.App.getState().phase==="RANKING"', 3000, 'RANKING へ');
  await page.click('#ranking-root details.staff-menu > summary');
  await page.click('#ranking-root [data-action="reset"]');
  await page.waitFor(dlgOpen('dlg-confirm'), 2000, '確認ダイアログ');
  await page.click('#dlg-confirm [data-confirm="cancel"]');
  await page.waitFor('!' + dlgOpen('dlg-confirm'), 2000, 'キャンセル');
  const kept = await page.eval(totalOf('total'));
  await page.click('#ranking-root [data-action="reset"]');
  await page.waitFor(dlgOpen('dlg-confirm'), 2000, '確認ダイアログ 2');
  await page.click('#dlg-confirm [data-confirm="ok"]');
  await page.waitFor('!' + dlgOpen('dlg-confirm'), 2000, 'リセットする');
  const gone = await page.eval(totalOf('total'));
  check(S, 'PR-6', kept === 8 && gone === 0, '運営用は確認付き: キャンセルで残り(' + kept + '人)、OK で消える(' + gone + '人)');
  await page.click('#ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const f1 = await page.eval(readPR);
  check(S, 'PR-6', f1.empty[0] === EMPTY && f1.rows.length === 0, 'リセット後、来場者画面は 0 件の表示になる');

  // i. console 0 件(ここまで)
  checkNoProblems(page, S, 'AC-1', '通常の操作');

  // k. 1280×800 と 390×844 で横スクロールなしとボタンの高さ
  await openApp(page, url);
  await page.eval('localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',' + JSON.stringify(JSON.stringify(SEED)) + ')');
  const tall = [];
  for (const vp of [[1280, 800], [390, 844]]) {
    await page.setViewport(vp[0], vp[1]);
    await page.click('#btn-player-ranking');
    await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
    const hs = await page.eval('(function(){return [].map.call(document.querySelectorAll("#screen-player-ranking button"),function(b){return Math.round(b.getBoundingClientRect().height);});})()');
    hs.forEach((h) => { if (h < 48) { tall.push(vp[0] + ':' + h); } });
    await page.click('#player-ranking-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  }
  check(S, 'PR-7', tall.length === 0, '来場者画面のボタン・タブの高さがすべて 48px 以上' + (tall.length ? ' → ' + tall.join(', ') : ''));
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await noHScroll(page, S, '来場者向けランキング画面');
  await page.setViewport(1280, 800);
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');

  // h. localStorage が使えない環境でも例外なく表示され、診断は完了できる
  page.allow.push(/^console\.warning: Storage:/);
  const initNS = await page.addInit('(function(){var t=function(){throw new DOMException("blocked","SecurityError");};' +
    'try{Object.defineProperty(window,"localStorage",{configurable:true,get:t});}catch(e){}' +
    'try{Storage.prototype.getItem=t;Storage.prototype.setItem=t;Storage.prototype.removeItem=t;}catch(e){}})()');
  await openApp(page, url);
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const h0 = await page.eval('(function(){var R=document.getElementById("player-ranking-root");var w=R.querySelector(".pr-note-warn");' +
    'return {warn:w&&!w.hidden?w.textContent:"",empty:(R.querySelector(".pr-empty")||{}).textContent};})()');
  check(S, 'PR-8', h0.warn === 'この環境では集計を保存できません' && h0.empty === '集計を読み込めませんでした',
    '保存できない環境で「' + h0.empty + '」と注記「' + h0.warn + '」が出る');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  check(S, 'PR-8', !!(await page.eval('SG.App.getState().topId')), '保存できない環境でも診断は結果まで進む');
  checkNoProblems(page, S, 'AC-1', '保存できない環境');
  await page.removeInit(initNS);

  // j. prefers-reduced-motion
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openApp(page, url);
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  const rm = await page.eval('(function(){var R=document.getElementById("screen-player-ranking");var bad=[];[].forEach.call(R.querySelectorAll("*"),function(e){var c=getComputedStyle(e);' +
    'if(parseFloat(c.transitionDuration)>0.001||c.animationName!=="none"){bad.push(e.className||e.tagName);}});return {mm:matchMedia("(prefers-reduced-motion: reduce)").matches,bad:bad};})()');
  check(S, 'PR-9', rm.mm && rm.bad.length === 0, '動きを減らす設定で来場者画面の transition・animation が止まる' + (rm.bad.length ? ' → ' + rm.bad.join(',') : ''));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // g. 無操作: 来場者画面表示中に警告 → 自動でスタートへ、DOM が空
  await page.addInit('window.SG_CONFIG_OVERRIDE={IDLE_RESET_MS_QUESTION:3000,IDLE_RESET_MS_RESULT:3000,IDLE_WARN_MS:1000};');
  await openApp(page, url);
  await page.click('#btn-player-ranking');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await page.waitFor('!document.getElementById("idle-toast").hidden', 5000, '警告');
  const vis = await page.eval('(function(){var b=document.querySelector("#idle-toast button");var r=b.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);' +
    'return !!e&&(e===b||b.contains(e));})()');
  check(S, 'PR-10', vis, '来場者画面で無操作の警告が見え、「続ける」を押せる位置にある');
  await page.waitFor('SG.App.getState().phase==="START"', 4000, '自動でスタートへ');
  const idleDom = await page.eval('document.getElementById("player-ranking-root").childElementCount');
  check(S, 'PR-10', idleDom === 0, '無操作で自動的にスタート画面へ戻り、来場者画面の DOM が空になる');
  checkNoProblems(page, S, 'AC-1', '無操作の確認');
}

// ---- zukan: 戦国武将図鑑(診断なしで武将の情報を見られる。閲覧が診断・集計・保存に影響しない) ----
// localStorage 全体(キーと値)を文字列にする。閲覧の前後で変わらないことの検査に使う
const lsDump = '(function(){return JSON.stringify(Object.keys(localStorage).sort().map(function(k){return [k,localStorage.getItem(k)];}));})()';
// 診断状態(回答・加算済みフラグ・実行番号)。閲覧で変わらないことの検査に使う
const stateDump = '(function(){var s=SG.App.getState();return JSON.stringify({a:s.answers,c:s.counted,r:s.runId,t:s.topId,cur:s.current});})()';
const readZukanCards = '(function(){return [].map.call(document.querySelectorAll("#zukan-root .zukan-card"),function(c){' +
  'return {id:c.getAttribute("data-general-id"),name:(c.querySelector(".zukan-card-name")||{}).textContent,reading:(c.querySelector(".zukan-card-reading")||{}).textContent,type:(c.querySelector(".zukan-card-type")||{}).textContent,' +
  'svg:!!c.querySelector("svg"),label:c.getAttribute("aria-label")};});})()';
const readZukanDlg = '(function(){var d=document.getElementById("dlg-general");var q=function(s){return d.querySelector(s);};' +
  'return {name:(q(".dlg-name")||{}).textContent,count:(q(".dlg-nav-count")||{}).textContent,' +
  'prevDis:!!(q("[data-nav=prev]")||{}).disabled,nextDis:!!(q("[data-nav=next]")||{}).disabled,navCount:d.querySelectorAll("[data-nav]").length,' +
  'facts:(q(".dlg-facts")||{}).textContent,h3:[].map.call(d.querySelectorAll("h3"),function(e){return e.textContent;}),' +
  'rows:d.querySelectorAll(".mini-row").length,user:d.querySelectorAll(".mini-user").length,note:(q(".mini-note")||{}).textContent,' +
  'live:(q("[data-role=nav-live]")||{}).textContent,active:d.contains(document.activeElement)};})()';

async function scenarioZukan(page, opts, url) {
  const S = 'zukan';
  const zs = () => sleep(600);
  const openZ = async () => {
    await page.click('#btn-zukan');
    await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'ZUKAN へ');
    await zs();
  };
  const backZ = async () => {
    await page.click('#zukan-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  };

  // a. スタートから図鑑を開ける。20 枚・名前・タイプ・代替カード。閲覧しても状態と localStorage は変わらない
  await openApp(page, url);
  await page.eval('localStorage.setItem(' + JSON.stringify(STATS_KEY) + ',' + JSON.stringify(JSON.stringify(SEED)) + ')');
  const ls0 = await page.eval(lsDump);
  const st0 = await page.eval(stateDump);
  const label = await page.eval('(function(){var b=document.getElementById("btn-zukan");return b?b.textContent.trim():null;})()');
  check(S, 'ZK-1', label === '戦国武将図鑑', 'スタート画面に「戦国武将図鑑」のボタンがある(' + label + ')');
  await openZ();
  const cards = await page.eval(readZukanCards);
  const meta = await page.eval('SG.Generals.map(function(g){return {id:g.id,name:g.name,reading:g.reading,title:g.title,lifespan:g.lifespan};})');
  const metaById = {};
  meta.forEach((m) => { metaById[m.id] = m; });
  check(S, 'ZK-2', cards.length === 20 && cards.every((c) => metaById[c.id] && c.name === metaById[c.id].name && c.type === metaById[c.id].title && c.svg),
    'カードがちょうど 20 枚で、各カードに名前・タイプ・代替カード(SVG)がある');
  // 五十音順(20 人の順序を厳密に検査)
  const EXPECTED_NAMES = ['明智光秀', '石田三成', '上杉謙信', '織田信長', '加藤清正', '黒田官兵衛', '真田幸村（信繁）', '島津義弘', '武田信玄', '竹中半兵衛',
    '立花宗茂', '伊達政宗', '長宗我部元親', '徳川家康', '豊臣秀吉', '直江兼続', '北条氏康', '本多忠勝', '前田利家', '毛利元就'];
  check(S, 'ZK-4', cards.map((c) => c.name).join() === EXPECTED_NAMES.join(),
    '20 枚が名前の五十音順に並ぶ(' + cards.map((c) => c.name).join('→') + ')');
  check(S, 'ZK-4', cards.every((c) => c.reading === metaById[c.id].reading && /^[ぁ-ゖー]+$/.test(c.reading)), '各カードに名前のふりがな(ひらがな)が出る');
  const sortUi = await page.eval('document.querySelectorAll("#zukan-root [data-sort], #zukan-root .zukan-sort").length + "/" + ' +
    '([].filter.call(document.querySelectorAll("#zukan-root button"),function(b){return b.textContent.indexOf("標準の順")>=0;}).length)');
  check(S, 'ZK-4', sortUi === '0/0', '「標準の順」の選択肢・並べ替えボタンが存在しない(' + sortUi + ')');
  check(S, 'ZK-2', cards.every((c) => c.label === c.name + 'をくわしく見る'), '各カードに aria-label「(名前)をくわしく見る」がある');
  const note = await page.eval('document.querySelector("#zukan-root .zukan-note").textContent');
  check(S, 'ZK-2', note.indexOf('診断用の仮想モデル') >= 0 && note.indexOf('史実の数値ではありません') >= 0, '一覧に「診断用の仮想モデルで史実の数値ではない」旨の注記がある');
  check(S, 'ZK-2', await focusIs(page, '#zukan-root .zukan-title'), '図鑑を開くと見出しにフォーカスが移る');
  // 往復 3 回しても変わらない
  await backZ();
  check(S, 'ZK-3', await focusIs(page, '#btn-zukan'), '戻るとスタート画面の「戦国武将図鑑」ボタンにフォーカスが戻る');
  for (let i = 0; i < 3; i++) { await openZ(); await backZ(); }
  await openZ();
  check(S, 'ZK-3', (await page.eval(lsDump)) === ls0 && (await page.eval(stateDump)) === st0 && (await page.eval(totalOf('total'))) === 7,
    '閲覧(往復 3 回)しても localStorage 全体・回答・counted・runId が変わらない(合計 7 人のまま)');

  // b. 画面表示どおりの並び(五十音順)を、詳細の前後移動の基準にする
  const bornCards = cards;

  // c. 詳細: 内容・前後移動・端の無効化・閉じたときのフォーカス
  await page.click('#zukan-root .zukan-card');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  const d0 = await page.eval(readZukanDlg);
  check(S, 'ZK-5', d0.name === '明智光秀' && d0.facts.indexOf('1582年') >= 0 && d0.facts.indexOf('生没年') >= 0 && d0.facts.indexOf('活躍した地域') >= 0 &&
    ['主な功績', '有名な出来事', '診断用の性格イメージ', '診断用パラメータ'].every((h) => d0.h3.indexOf(h) >= 0) && d0.rows === 6,
    '詳細に生没年・活躍した地域・主な功績・有名な出来事・診断用の性格イメージ・6 本のパラメータがある');
  check(S, 'ZK-5', d0.user === 0 && d0.note.indexOf('診断用の仮想モデル値です') >= 0 && d0.note.indexOf('歴史学的な根拠のある数値ではありません') >= 0,
    '「あなた」の値は出さず、仮想モデル値の注記が付く');
  check(S, 'ZK-5', d0.active && d0.count === '1 / 20' && d0.prevDis && !d0.nextDis, '開いた直後のフォーカスはダイアログ内。「1 / 20」で先頭は「前の武将」が無効');
  await page.click('#dlg-general [data-nav="next"]');
  await page.waitFor('document.querySelector("#dlg-general .dlg-name").textContent!==' + JSON.stringify(d0.name), 2000, '次の武将');
  const d1 = await page.eval(readZukanDlg);
  check(S, 'ZK-5', d1.name === bornCards[1].name && d1.count === '2 / 20' && !d1.prevDis && d1.rows === 6 && d1.live.indexOf(d1.name) >= 0,
    '「次の武将」で表示中の並び順の次(' + bornCards[1].name + ')に切り替わり、「2 / 20」・読み上げ領域に名前が入る');
  check(S, 'ZK-5', await focusIs(page, '#dlg-general [data-nav="next"]'), '押したボタンにフォーカスが残る');
  await page.click('#dlg-general [data-nav="prev"]');
  await page.waitFor('document.querySelector("#dlg-general .dlg-name").textContent===' + JSON.stringify(d0.name), 2000, '前の武将');
  check(S, 'ZK-5', (await page.eval(readZukanDlg)).count === '1 / 20', '「前の武将」で戻れる');
  await page.click('#dlg-general [data-nav="next"]');
  await page.waitFor('document.querySelector("#dlg-general .dlg-name").textContent===' + JSON.stringify(bornCards[1].name), 2000, '次の武将');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, 'Esc で閉じる');
  check(S, 'ZK-5', await focusIs(page, '#zukan-root .zukan-card[data-general-id="' + bornCards[1].id + '"]'),
    'Esc で閉じるとフォーカスは最後に見ていた武将(' + bornCards[1].name + ')のカードに戻る');
  // 末尾
  await page.click('#zukan-root .zukan-card[data-general-id="' + bornCards[19].id + '"]');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ(末尾)');
  const dl = await page.eval(readZukanDlg);
  check(S, 'ZK-5', dl.count === '20 / 20' && dl.nextDis && !dl.prevDis, '末尾は「20 / 20」で「次の武将」が無効(ループしない)');
  await page.click('#dlg-general .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じるボタンで閉じる');
  check(S, 'ZK-5', await focusIs(page, '#zukan-root .zukan-card[data-general-id="' + bornCards[19].id + '"]'), '「閉じる」でもカードにフォーカスが戻る');
  // 先頭から「次の武将」で最後まで進み、画面の五十音順と同じ順に移動することを確かめる
  await page.click('#zukan-root .zukan-card[data-general-id="' + bornCards[0].id + '"]');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ(先頭)');
  const walked = [(await page.eval(readZukanDlg)).name];
  for (let i = 1; i < 20; i++) {
    const prevName = walked[walked.length - 1];
    await page.click('#dlg-general [data-nav="next"]');
    await page.waitFor('document.querySelector("#dlg-general .dlg-name").textContent!==' + JSON.stringify(prevName), 2000, '次の武将');
    walked.push((await page.eval(readZukanDlg)).name);
  }
  check(S, 'ZK-5', walked.join() === bornCards.map((c) => c.name).join() && walked.join() === EXPECTED_NAMES.join(), '「次の武将」で 20 人が一覧と同じ五十音順に移動する');
  await page.click('#dlg-general .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  check(S, 'ZK-3', (await page.eval(lsDump)) === ls0 && (await page.eval(stateDump)) === st0, '詳細の前後移動のあとも localStorage と診断状態は変わらない');

  // d. 図鑑から診断を始める → 完走。戻る / Esc でスタートへ
  await page.key('Escape');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'Esc で START へ');
  check(S, 'ZK-6', await focusIs(page, '#btn-zukan') && (await page.eval('document.getElementById("zukan-root").childElementCount')) === 0,
    'Esc でもスタートに戻り、図鑑の DOM が空になる');
  await openZ();
  await page.click('#zukan-root [data-action="start"]');
  await page.waitFor('SG.App.getState().phase==="QUESTION"', 3000, 'QUESTION へ');
  const q = await page.eval('({a:SG.App.getState().answers.every(function(x){return x===null;}),cur:SG.App.getState().current,z:document.getElementById("zukan-root").childElementCount,' +
    'text:document.getElementById("q-count").textContent})');
  check(S, 'ZK-6', q.a && q.cur === 0 && q.z === 0 && q.text === 'Q1 / 15', '「診断を始める」で Q1 が表示され、回答は全て未回答・図鑑の DOM は空');
  for (let i = 0; i < 15; i++) {
    await waitQuestion(page, i);
    await page.click('#screen-question .opt[data-index="' + PATTERN[i] + '"]');
  }
  await waitResult(page);
  const T = await page.eval('SG.App.getState().topId');
  check(S, 'ZK-6', !!T && (await page.eval(totalOf('total'))) === 8, '図鑑から始めた診断も結果まで進み、集計には 1 人だけ加算される(合計 8 人)');

  // e. 結果画面 → 図鑑 → 戻る(結果保持・再加算なし)
  const before = await page.eval(snapResult);
  const lsR = await page.eval(lsDump);
  const zb = await page.eval('(function(){var b=document.querySelector("#result-root [data-action=zukan]");return b?b.textContent.trim():null;})()');
  check(S, 'ZK-7', zb === '戦国武将図鑑を見る', '結果画面に「戦国武将図鑑を見る」のボタンがある(' + zb + ')');
  let same = true;
  for (let i = 0; i < 2; i++) {
    await page.click('#result-root [data-action="zukan"]');
    await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'ZUKAN へ');
    await zs();
    if ((await page.eval('document.querySelectorAll("#zukan-root .zukan-card").length')) !== 20) { same = false; }
    await page.click('#zukan-root .zukan-card');
    await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
    await page.key('Escape');
    await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
    await page.click('#zukan-root [data-action="back"]');
    await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
    if ((await page.eval(snapResult)) !== before || (await page.eval(lsDump)) !== lsR) { same = false; }
  }
  check(S, 'ZK-7', same, '結果画面→図鑑(詳細も開く)→戻るを 2 回行っても、結果 DOM・counted・回答・合計人数・localStorage が変わらない');
  check(S, 'ZK-7', await focusIs(page, '#result-root [data-action="zukan"]'), '戻ると結果画面の「戦国武将図鑑を見る」ボタンにフォーカスが戻る');
  await page.click('#result-root .top3-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, 'TOP3 詳細');
  const rd = await page.eval(readZukanDlg);
  check(S, 'ZK-7', rd.navCount === 0 && rd.user === 6, '結果画面の詳細ダイアログには前/次が出ず、「あなた」の値は今までどおり出る(user=' + rd.user + ')');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  await page.click('#result-root [data-action="zukan"]');
  await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'ZUKAN へ');
  await page.click('#zukan-root [data-action="start"]');
  await page.waitFor('SG.App.getState().phase==="QUESTION"', 3000, 'QUESTION へ');
  const fresh = await page.eval('({r:document.getElementById("result-root").childElementCount,z:document.getElementById("zukan-root").childElementCount,' +
    'a:SG.App.getState().answers.every(function(x){return x===null;}),c:SG.App.getState().counted,t:' + totalOf('total') + '})');
  check(S, 'ZK-7', fresh.r === 0 && fresh.z === 0 && fresh.a && !fresh.c && fresh.t === 8,
    '結果画面から図鑑→「診断を始める」で、前回の結果 DOM が空になり新しい診断が始まる(加算はまだ 8 人のまま)');
  await page.eval('SG.App.getState()'); // 状態を読むだけ
  // 最初の画面へ戻しておく(質問中の無操作リセットを待たず、ページを開き直す)
  await openApp(page, url);

  // f. 管理操作が図鑑にない
  await openZ();
  await page.click('#zukan-root .zukan-card');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  const dom = await page.eval('(function(){var bad=/リセット|削除|消す|運営|集計|clear|delete|reset/i;var sc=document.getElementById("screen-zukan");var dl=document.getElementById("dlg-general");' +
    'function bads(root){return [].filter.call(root.querySelectorAll("button,a,summary,input"),function(e){return bad.test(e.textContent+" "+(e.getAttribute("aria-label")||"")+" "+(e.value||""));}).length;}' +
    'return {resetAttr:document.querySelectorAll("#screen-zukan [data-action=reset],#dlg-general [data-action=reset],#screen-zukan [data-action=clear],#screen-zukan [data-action=delete]").length,' +
    'btnBad:bads(sc)+bads(dl),textBad:bad.test(sc.textContent+dl.textContent),details:sc.querySelectorAll("details,summary").length+dl.querySelectorAll("details,summary").length,' +
    'accesskey:sc.querySelectorAll("[accesskey]").length+dl.querySelectorAll("[accesskey]").length,' +
    'inputs:sc.querySelectorAll("input,textarea,select").length+dl.querySelectorAll("input,textarea,select").length};})()');
  check(S, 'ZK-8', dom.resetAttr === 0 && dom.btnBad === 0 && !dom.textBad && dom.details === 0 && dom.accesskey === 0,
    '図鑑と詳細の DOM にリセット・削除・運営・集計の操作や文言、details、accesskey がない(' + JSON.stringify(dom) + ')');
  check(S, 'ZK-8', dom.inputs === 0, '入力欄(input・textarea・select)がない=文字入力や検索はない');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  const combos = [['R', 'KeyR', 82, 10], ['D', 'KeyD', 68, 10], ['r', 'KeyR', 82, 1], ['Delete', 'Delete', 46, 0], ['Backspace', 'Backspace', 8, 0],
    ['r', 'KeyR', 82, 0], ['c', 'KeyC', 67, 2], ['F2', 'F2', 113, 0]];
  for (const c of combos) { await pressCombo(page, c[0], c[1], c[2], c[3]); }
  await sleep(300);
  const sc = await page.eval('({confirm:' + dlgOpen('dlg-confirm') + ',phase:SG.App.getState().phase,total:' + totalOf('total') + '})');
  check(S, 'ZK-8', !sc.confirm && sc.phase === 'ZUKAN' && sc.total === 8, 'ショートカットや一般的なキーを送っても確認ダイアログは開かず、集計も消えない(' + JSON.stringify(sc) + ')');

  // k. レイアウト: 1280×800 と 390×844
  const lay = {};
  for (const vp of [[1280, 800], [390, 844]]) {
    await page.setViewport(vp[0], vp[1]);
    await sleep(300);
    lay[vp[0]] = await page.eval('(function(){var c=[].slice.call(document.querySelectorAll("#zukan-root .zukan-card"));var t0=c[0].getBoundingClientRect().top;var cols=c.filter(function(e){return Math.abs(e.getBoundingClientRect().top-t0)<6;}).length;' +
      'var small=[].filter.call(document.querySelectorAll("#screen-zukan button"),function(b){return b.getBoundingClientRect().height<48;}).length;' +
      'var out=c.filter(function(e){var r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth;}).length;' +
      'var over=c.filter(function(e){return e.scrollWidth>e.clientWidth+1;}).length;' +
      'return {cols:cols,small:small,out:out,over:over,n:c.length};})()');
  }
  check(S, 'ZK-9', lay[1280].cols >= 4 && lay[390].cols === 2, 'カードの列数: 1280px で ' + lay[1280].cols + ' 列(4 列以上)・390px で ' + lay[390].cols + ' 列(2 列)');
  check(S, 'ZK-9', lay[1280].small === 0 && lay[390].small === 0 && lay[1280].out === 0 && lay[390].out === 0 && lay[390].over === 0 && lay[1280].over === 0,
    'ボタン・カードの高さがすべて 48px 以上で、画面外・カード外にはみ出さない(' + JSON.stringify(lay) + ')');
  await noHScroll(page, S, '図鑑の一覧');
  await page.setViewport(390, 844);
  await page.click('#zukan-root .zukan-card[data-general-id="tachibana-muneshige"]');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ(スマホ)');
  const nv = await page.eval('(function(){var n=document.querySelector("#dlg-general .dlg-nav");var d=document.getElementById("dlg-general").getBoundingClientRect();' +
    'var bs=[].map.call(n.querySelectorAll("button"),function(b){var r=b.getBoundingClientRect();return {h:Math.round(r.height),inside:r.left>=d.left&&r.right<=d.right};});' +
    'return {bs:bs,fit:n.scrollWidth<=n.clientWidth};})()');
  check(S, 'ZK-9', nv.fit && nv.bs.every((b) => b.h >= 48 && b.inside), '390px の詳細で前/次ボタンが 48px 以上でダイアログ内に収まる(' + JSON.stringify(nv) + ')');
  await page.setViewport(360, 640);
  await sleep(200);
  const nv2 = await page.eval('(function(){var n=document.querySelector("#dlg-general .dlg-nav");return {fit:n.scrollWidth<=n.clientWidth,h:n.getBoundingClientRect().height};})()');
  check(S, 'ZK-9', nv2.fit, '360px でも前/次ボタンと「n / 20」が折り返さず収まる(' + JSON.stringify(nv2) + ')');
  await page.screenshot('zukan-detail-360x640');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  await page.setViewport(1280, 800);

  // l. キーボードのみ
  await page.eval('document.getElementById("zukan-root").querySelector("[data-action=back]").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  await page.eval('document.getElementById("btn-zukan").focus()');
  await page.key('Enter');
  await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'Enter で ZUKAN へ');
  let hops = 0;
  for (; hops < 8; hops++) {
    if (await page.eval('document.activeElement&&document.activeElement.classList.contains("zukan-card")')) { break; }
    await page.key('Tab');
  }
  check(S, 'ZK-10', hops < 8, 'Tab ' + hops + ' 回で最初のカードにフォーカスが届く');
  await page.key('Enter');
  await page.waitFor(dlgOpen('dlg-general'), 2000, 'Enter で詳細');
  let trapped = true;
  for (let i = 0; i < 12; i++) {
    await page.key('Tab');
    // モーダルのダイアログは、背景(図鑑のカードなど)へはフォーカスが出ない。一周するときだけブラウザ側(body)を経由する
    if (!(await page.eval('(function(){var d=document.getElementById("dlg-general");var a=document.activeElement;return d.contains(a)||a===document.body;})()'))) {
      trapped = false;
      console.log('  (Tab ' + (i + 1) + ' 回目のフォーカス: ' + await page.eval('(function(){var a=document.activeElement;return a?a.tagName+"."+a.className:"null";})()') + ')');
    }
  }
  check(S, 'ZK-10', trapped, 'Enter で開いた詳細の中で Tab を 12 回押しても、フォーカスは詳細の中(一周時のみブラウザ側)にとどまり、背景のカードへ出ない');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, 'Esc で閉じる');
  check(S, 'ZK-10', await focusIs(page, '#zukan-root .zukan-card'), 'Esc で詳細を閉じるとカードにフォーカスが戻る');
  await page.key('Escape');
  await page.waitFor('SG.App.getState().phase==="START"', 3000, 'Esc で START へ');
  check(S, 'ZK-10', await focusIs(page, '#btn-zukan'), 'もう一度 Esc で図鑑からスタートに戻り、ボタンにフォーカスが戻る');

  // j. prefers-reduced-motion
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openApp(page, url);
  await openZ();
  const rm = await page.eval('(function(){var R=document.getElementById("screen-zukan");var bad=[];[].forEach.call(R.querySelectorAll("*"),function(e){var c=getComputedStyle(e);' +
    'if(parseFloat(c.transitionDuration)>0.001||c.animationName!=="none"){bad.push(e.className||e.tagName);}});return {mm:matchMedia("(prefers-reduced-motion: reduce)").matches,bad:bad};})()');
  check(S, 'ZK-11', rm.mm && rm.bad.length === 0, '動きを減らす設定で図鑑の transition・animation が止まる' + (rm.bad.length ? ' → ' + rm.bad.join(',') : ''));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // i. ここまでの操作で console のエラー・警告・例外が 0 件
  checkNoProblems(page, S, 'AC-1', '図鑑の通常操作');

  // h. localStorage が使えない環境でも図鑑は開け、診断も始められる
  page.allow.push(/^console\.warning: Storage:/);
  const initNS = await page.addInit('(function(){var t=function(){throw new DOMException("blocked","SecurityError");};' +
    'try{Object.defineProperty(window,"localStorage",{configurable:true,get:t});}catch(e){}' +
    'try{Storage.prototype.getItem=t;Storage.prototype.setItem=t;Storage.prototype.removeItem=t;}catch(e){}})()');
  await openApp(page, url);
  await openZ();
  check(S, 'ZK-12', (await page.eval('document.querySelectorAll("#zukan-root .zukan-card").length')) === 20, '保存できない環境でも図鑑が開き、20 枚表示される');
  await page.click('#zukan-root .zukan-card');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  await page.click('#zukan-root [data-action="start"]');
  await page.waitFor('SG.App.getState().phase==="QUESTION"', 3000, 'QUESTION へ');
  check(S, 'ZK-12', true, '保存できない環境でも詳細の表示と「診断を始める」ができる');
  checkNoProblems(page, S, 'AC-1', '保存できない環境');
  await page.removeInit(initNS);

  // g. 無操作: 図鑑一覧の表示中と、詳細ダイアログの表示中の両方で自動復帰する
  await page.addInit('window.SG_CONFIG_OVERRIDE={IDLE_RESET_MS_QUESTION:3000,IDLE_RESET_MS_RESULT:3000,IDLE_WARN_MS:1000};');
  await openApp(page, url);
  await openZ();
  await page.waitFor('!document.getElementById("idle-toast").hidden', 5000, '警告(一覧)');
  const vis = await page.eval('(function(){var b=document.querySelector("#idle-toast button");var r=b.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!e&&(e===b||b.contains(e));})()');
  check(S, 'ZK-13', vis, '図鑑の一覧で無操作の警告が見え、「続ける」を押せる位置にある');
  await page.waitFor('SG.App.getState().phase==="START"', 4000, '自動でスタートへ(一覧)');
  check(S, 'ZK-13', (await page.eval('document.getElementById("zukan-root").childElementCount')) === 0, '一覧の表示中に無操作で自動的にスタートへ戻り、図鑑の DOM が空になる');
  await openZ();
  await page.click('#zukan-root .zukan-card');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '詳細ダイアログ');
  await page.waitFor('!document.getElementById("idle-toast").hidden', 5000, '警告(詳細)');
  const vis2 = await page.eval('(function(){var b=document.querySelector("#idle-toast button");var r=b.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!e&&(e===b||b.contains(e));})()');
  check(S, 'ZK-13', vis2, '詳細ダイアログの表示中でも警告が見え、「続ける」を押せる位置にある');
  await page.click('#idle-toast button');
  await sleep(300);
  const cont = await page.eval('({phase:SG.App.getState().phase,open:' + dlgOpen('dlg-general') + '})');
  check(S, 'ZK-13', cont.phase === 'ZUKAN' && cont.open, '「続ける」を押すと詳細の表示が継続する');
  await page.waitFor('SG.App.getState().phase==="START"', 6000, '自動でスタートへ(詳細)');
  const after = await page.eval('({open:' + dlgOpen('dlg-general') + ',z:document.getElementById("zukan-root").childElementCount,d:document.getElementById("dlg-general").childElementCount})');
  check(S, 'ZK-13', !after.open && after.z === 0 && after.d === 0, '詳細の表示中に無操作で自動的にスタートへ戻り、ダイアログも閉じて空になる');
  checkNoProblems(page, S, 'AC-1', '無操作の確認');
}

// ---- compat: 結果画面の相性診断(決定論・詳細ダイアログ・往復で保持・集計に影響しない・レイアウト) ----
// 相性節の中身(武将名の並び・タイプ・場面)を文字列にする。比較用
const readCompat = '(function(){var h=document.getElementById("sec-compat");if(!h)return null;var s=h.closest("section");' +
  'function t(q){return [].map.call(s.querySelectorAll(q),function(e){return e.textContent.trim();});}' +
  'return JSON.stringify({partners:t(".compat-list:not(.compat-list-stimulus) .compat-name"),stim:t(".compat-stimulus .compat-name"),' +
  'types:t(".compat-type dd"),scenes:t(".compat-scenes li"),reasons:t(".compat-reason")});})()';
async function scenarioCompat(page, opts, url) {
  const S = 'compat';
  const restart = async () => {
    await page.click('#result-root [data-action="restart"]');
    await page.waitFor('SG.App.getState().phase==="START"', 3000, 'START へ');
  };
  await openApp(page, url);
  const lsBase = await page.eval(lsDump);
  check(S, 'CP-1', lsBase === '[]', '開始時の localStorage は空(' + lsBase + ')');

  // 1. 診断完走 → 相性節。DOM 順、枚数、1 位の武将が相性候補に無い、注記・文言
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  const lsR = await page.eval(lsDump);
  const st = await page.eval('(function(){var h=document.getElementById("sec-compat");if(!h)return null;var s=h.closest("section");var q=function(x){return s.querySelectorAll(x);};' +
    'var P=document.getElementById("sec-reason"),T=document.getElementById("sec-top3");' +
    'var top=document.getElementById("result-heading").getAttribute("aria-label");' +
    'var names=[].map.call(q(".compat-name"),function(e){return e.textContent.trim();});' +
    'return {order:!!(P.compareDocumentPosition(s)&4)&&!!(s.compareDocumentPosition(T)&4),partners:q(".compat-list:not(.compat-list-stimulus) .compat-card").length,' +
    'stim:q(".compat-stimulus").length,types:q(".compat-type").length,scenes:q(".compat-scenes li").length,hasTop:names.indexOf(top)>=0,names:names,' +
    'text:s.textContent,labelled:s.getAttribute("aria-labelledby"),pcts:[].map.call(q(".compat-pct"),function(e){return e.getAttribute("aria-label");}),' +
    'noteSmall:parseFloat(getComputedStyle(q(".compat-note")[0]).fontSize),total:SG.Storage.getDefault().getTotalPlayers("total"),counted:SG.App.getState().counted};})()');
  check(S, 'CP-1', !!st && st.order && st.labelled === 'sec-compat', '結果画面に「相性診断」の節があり、「似ている理由」→相性→TOP3 の順');
  check(S, 'CP-1', st.partners === 3 && st.stim === 1 && st.types === 2 && st.scenes === 3,
    '相性武将 3 枚・刺激の相手 1 枚・性格タイプ 2 ブロック・日常場面 3 つ(' + [st.partners, st.stim, st.types, st.scenes].join('/') + ')');
  check(S, 'CP-1', !st.hasTop && st.names.length === 4 && new Set(st.names).size === 4, '診断 1 位の武将は相性カードに出ず、4 人は重複しない(' + st.names.join('・') + ')');
  check(S, 'CP-1', st.pcts.length === 3 && st.pcts.every((p) => /^相性度\d+パーセント$/.test(p)), '相性度に読み上げ用の aria-label がある(' + st.pcts.join(',') + ')');
  check(S, 'CP-7', st.text.indexOf('診断用の性格モデルでは') >= 0 && st.text.indexOf('科学的な根拠') >= 0 && st.text.indexOf('エンタメ向けの目安') >= 0 &&
    st.text.indexOf('友だちになるなら') >= 0 && st.text.indexOf('一緒にグループを組むなら') >= 0 && st.text.indexOf('部活・サークルで頼れるのは') >= 0,
    '「診断用の性格モデルでは」の理由、小さな注記(科学的な根拠なし)、3 つの場面がある');
  check(S, 'CP-7', !/運営|リセット|削除/.test(st.text), '相性節に「運営」「リセット」「削除」の語がない');
  check(S, 'CP-4', st.total === 1 && st.counted === true, '診断 1 回で集計は 1 人だけ加算されている(' + st.total + ')');
  const base = await page.eval(readCompat);
  console.log('  相性(PATTERN): ' + base);

  // 2. 相性カードのボタン・カード本体で既存の詳細ダイアログが開き、閉じると結果画面が保たれる
  const c0 = JSON.parse(base);
  await page.click('#result-root .compat-list:not(.compat-list-stimulus) .compat-card:nth-child(1) .btn-detail');
  await page.waitFor(dlgOpen('dlg-general'), 2000, '相性カードの詳細ダイアログ');
  const dn = await page.eval('document.querySelector("#dlg-general .dlg-name").textContent');
  check(S, 'CP-3', dn === c0.partners[0] && (await page.eval('document.querySelectorAll("#dlg-general [data-nav]").length')) === 0,
    '「くわしく見る」で既存の武将詳細ダイアログが開き、見出しが相性武将名(' + dn + ')。前/次ボタンは出ない');
  await page.key('Escape');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, 'Esc で閉じる');
  check(S, 'CP-3', await focusIs(page, '#result-root .compat-list:not(.compat-list-stimulus) .compat-card:nth-child(1) .btn-detail'), 'Esc で閉じると元のボタンにフォーカスが戻る');
  await page.click('#result-root .compat-stimulus .compat-reason');
  await page.waitFor(dlgOpen('dlg-general'), 2000, 'カード本体クリックの詳細');
  const dn2 = await page.eval('document.querySelector("#dlg-general .dlg-name").textContent');
  check(S, 'CP-3', dn2 === c0.stim[0], 'カード本体のクリックでも開く(刺激の相手: ' + dn2 + ')');
  await page.click('#dlg-general .dlg-close');
  await page.waitFor('!' + dlgOpen('dlg-general'), 2000, '閉じる');
  check(S, 'CP-3', (await page.eval(readCompat)) === base && (await page.eval('SG.App.getState().phase')) === 'RESULT', '閉じても結果画面と相性の内容は変わらない');

  // 3. 「相性度のしくみ」: キーボードで到達・開閉
  await page.eval('document.querySelector("#result-root .compat-stimulus .btn-detail").focus()');
  await sleep(300);
  await page.key('Tab');
  await sleep(300);
  const onSummary = await page.eval('document.activeElement===document.querySelector("#result-root .compat .compat-how summary")');
  check(S, 'CP-5', onSummary, 'Tab で「相性度のしくみ」の見出しに届く');
  await page.key('Enter');
  await sleep(200);
  const open1 = await page.eval('document.querySelector("#result-root .compat .compat-how").open');
  await page.key('Enter');
  await sleep(200);
  const open2 = await page.eval('document.querySelector("#result-root .compat .compat-how").open');
  check(S, 'CP-5', open1 === true && open2 === false, 'Enter で開閉できる(開く→' + open1 + '、閉じる→' + open2 + ')');

  // 4. 図鑑・ランキングを往復しても相性が保たれ、集計は増えない
  let keep = true;
  await page.click('#result-root [data-action="zukan"]');
  await page.waitFor('SG.App.getState().phase==="ZUKAN"', 3000, 'ZUKAN へ');
  await page.click('#zukan-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  if ((await page.eval(readCompat)) !== base) { keep = false; }
  await page.click('#result-root [data-action="ranking"]');
  await page.waitFor('SG.App.getState().phase==="PLAYER_RANKING"', 3000, 'PLAYER_RANKING へ');
  await page.click('#player-ranking-root [data-action="back"]');
  await page.waitFor('SG.App.getState().phase==="RESULT"', 3000, 'RESULT へ戻る');
  if ((await page.eval(readCompat)) !== base) { keep = false; }
  check(S, 'CP-6', keep, '結果→図鑑→戻る、結果→みんなの結果ランキング→戻るの後も相性節が保たれ、内容が同じ');
  check(S, 'CP-4', (await page.eval(lsDump)) === lsR && (await page.eval(totalOf('total'))) === 1, '相性の表示・往復で localStorage と集計(1 人)は変わらない');

  // 5. 最初に戻る → 相性表示も消える。同じ回答なら同じ、別の回答なら変わる(決定論)
  await restart();
  check(S, 'CP-5', (await page.eval('document.getElementById("result-root").childElementCount')) === 0 &&
    (await page.eval('document.getElementById("sec-compat")')) === null, '「最初に戻る」で結果画面ごと相性表示も消える(次の人に残らない)');
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  check(S, 'CP-2', (await page.eval(readCompat)) === base, '同じ回答でもう一度診断すると相性の武将・タイプ・場面が完全に同じ');
  await restart();
  const alt = [];
  for (const pat of [new Array(15).fill(0), new Array(15).fill(3), PATTERN_LONG]) {
    await startAndAnswer(page, pat);
    await waitResult(page);
    alt.push(await page.eval(readCompat));
    await restart();
  }
  check(S, 'CP-2', alt.every((a) => a !== base) && new Set(alt).size === 3, '別の回答(全A・全D・別パターン)では相性の内容が変わる');
  check(S, 'CP-4', (await page.eval(totalOf('total'))) === 5, '診断 5 回で集計はちょうど 5 人(相性表示で増えていない)');
  checkNoProblems(page, S, 'AC-1', '相性の操作');

  // 6. レイアウト(1280×800 / 390×844)とスクリーンショット
  await startAndAnswer(page, PATTERN);
  await waitResult(page);
  for (const vp of [[1280, 800], [390, 844]]) {
    await page.setViewport(vp[0], vp[1]);
    await sleep(300);
    const m = await page.eval('(function(){var s=document.getElementById("sec-compat").closest("section"),W=innerWidth;' +
      'var bad=[].filter.call(s.querySelectorAll(".compat-card,.compat-type,.compat-scenes li,.compat-how summary"),function(e){var r=e.getBoundingClientRect();return r.left<-0.5||r.right>W+0.5;}).length;' +
      'var over=[].filter.call(s.querySelectorAll(".compat-card,.compat-type,.compat-scenes li"),function(e){return e.scrollWidth>e.clientWidth+1;}).length;' +
      'var small=[].filter.call(s.querySelectorAll(".btn-detail,.compat-how summary"),function(e){return e.getBoundingClientRect().height<44;}).length;' +
      'var c=[].slice.call(s.querySelectorAll(".compat-list:not(.compat-list-stimulus) .compat-card"));var t0=c[0].getBoundingClientRect().top;' +
      'var cols=c.filter(function(e){return Math.abs(e.getBoundingClientRect().top-t0)<6;}).length;' +
      'return {bad:bad,over:over,small:small,cols:cols,sw:document.documentElement.scrollWidth,iw:W};})()');
    check(S, 'CP-8', m.bad === 0 && m.over === 0 && m.sw <= m.iw, vp[0] + '×' + vp[1] + ': 相性節がはみ出さず横スクロールがない(' + JSON.stringify(m) + ')');
    check(S, 'CP-8', m.small === 0, vp[0] + '×' + vp[1] + ': ボタン・見出しのタップ領域が 44px 以上');
    check(S, 'CP-8', vp[0] === 1280 ? m.cols === 3 : m.cols === 1, vp[0] + '×' + vp[1] + ': 相性武将カードが ' + m.cols + ' 列(PC は 3 列、スマホは 1 列)');
    await page.eval('document.getElementById("sec-compat").scrollIntoView({block:"start"})');
    await sleep(300);
    await page.screenshot('compat-' + vp[0]);
    await page.screenshot('compat-' + vp[0] + '-full', true);
  }
  // 動きを減らす設定でもエラーなし
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openApp(page, url);
  await startAndAnswer(page, PATTERN);
  await page.waitFor('SG.App.getState().phase==="RESULT"', 6000, 'RESULT へ');
  check(S, 'CP-8', (await page.eval(readCompat)) === base, 'prefers-reduced-motion でも相性節が同じ内容で表示される');
  checkNoProblems(page, S, 'AC-1', 'シナリオ全体');
}

const SCENARIOS = {
  smoke: scenarioSmoke,
  questions: scenarioQuestions,
  analyzing: scenarioAnalyzing,
  result: scenarioResult,
  dialog: scenarioDialog,
  ranking: scenarioRanking,
  'reset-confirm': scenarioResetConfirm,
  card: scenarioCard,
  'no-storage': scenarioNoStorage,
  idle: scenarioIdle,
  'image-fallback': scenarioImageFallback,
  layout: scenarioLayout,
  'reduced-motion': scenarioReducedMotion,
  keyboard: scenarioKeyboard,
  'player-ranking': scenarioPlayerRanking,
  zukan: scenarioZukan,
  compat: scenarioCompat,
  screens: scenarioScreens
};

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  const names = opts.scenario === 'all' ? Object.keys(SCENARIOS) : [opts.scenario];
  const unknown = names.filter((n) => !SCENARIOS[n]);
  if (unknown.length) { console.error('不明なシナリオ: ' + unknown.join(', ') + '(使えるもの: ' + Object.keys(SCENARIOS).join(', ') + ')'); process.exitCode = 2; return; }
  console.log('browser-check: ' + opts.exe + ' / ' + (opts.http ? 'http' : 'file://') + ' / scenarios: ' + names.join(', '));

  let server = null;
  try {
    if (opts.http) { server = await startServer(); console.log('  http server: 127.0.0.1:' + server.address().port); }
    const url = appUrl(opts, server);
    for (const name of names) {
      let b = null;
      try {
        b = await launch(opts);
        // ダウンロードは必ずこの実行の一時フォルダへ(ユーザーの Downloads フォルダに書かない)
        await b.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: b.downloads, eventsEnabled: true });
        const page = await openPage(b, opts);
        await SCENARIOS[name](page, opts, url, b);
      } catch (e) {
        record(false, name, '-', '実行中の例外: ' + (e && e.stack ? e.stack : e));
      } finally {
        if (b) { await shutdown(b); }
      }
    }
  } finally {
    if (server) { await new Promise((r) => server.close(r)); }
  }
  const failed = results.filter((x) => !x.ok).length;
  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: ALL PASS (' + results.length + ' checks)');
  if (failed) { process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
