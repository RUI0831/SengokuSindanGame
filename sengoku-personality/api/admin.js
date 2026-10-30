/*
 * api/admin.js — 運営用の操作(パスワードの確認・集計のリセット)
 * パスワードは Vercel の環境変数 ADMIN_PASSWORD に入れる(コードやリポジトリには書かない)。
 *   POST /api/admin  body: { action: 'verify' | 'reset', password }
 *   verify: パスワードが合っていれば 200、違えば 401
 *   reset : 合っていれば共通の集計をすべて消して 200
 * ADMIN_PASSWORD が未設定のときは 503(誰でもリセットできる状態にはしない)。
 */
'use strict';

const crypto = require('crypto');

const HASH_KEY = 'sengoku-personality:v1:stats';

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token: token } : null;
}

// 長さが違っても時間差で漏れないよう、ハッシュにしてから比較する
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
  return b && typeof b === 'object' ? b : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) { res.status(503).json({ error: 'admin password not configured' }); return; }

  const body = parseBody(req);
  if (!body || typeof body.password !== 'string' || body.password.length > 200 ||
      (body.action !== 'verify' && body.action !== 'reset')) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  if (!sameSecret(body.password, expected)) {
    // 総当たりを遅らせる
    await new Promise(function (r) { setTimeout(r, 1000); });
    res.status(401).json({ error: 'wrong password' });
    return;
  }
  if (body.action === 'verify') { res.status(200).json({ ok: true }); return; }

  const cfg = redisConfig();
  if (!cfg) { res.status(503).json({ error: 'storage not configured' }); return; }
  try {
    const r = await fetch(cfg.url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify([['DEL', HASH_KEY]])
    });
    if (!r.ok) { throw new Error('redis ' + r.status); }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'storage error' });
  }
};
