/*
 * api/stats.js — 全端末共通のランキング集計 API(Vercel Function)
 * 保存先は Upstash Redis(Vercel Marketplace の Upstash for Redis)。REST API を fetch で呼ぶので依存パッケージは不要。
 * 環境変数: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN(または KV_REST_API_URL / KV_REST_API_TOKEN)
 * 保存するのは武将 id ごとの件数だけ。1 つのハッシュに "total:<id>" と "d:<日付>:<id>" を持つ。
 *   GET  /api/stats → { v:1, total:{id:n}, daily:{date:{id:n}} }
 *   POST /api/stats  body: { id, date? } → 該当武将を 1 件加算
 */
'use strict';

const HASH_KEY = 'sengoku-personality:v1:stats';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDS = require('../js/generals.js').map(function (g) { return g.id; });

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token: token } : null;
}

async function pipeline(cfg, commands) {
  const res = await fetch(cfg.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) { throw new Error('redis ' + res.status); }
  return res.json();
}

// 会場は日本。サーバー側の「今日」は日本時間で決める
function jstDateKey(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + (offsetDays || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

// 端末が送ってきた日付は、日本時間の前日〜翌日の範囲だけ受け付ける(端末の時計ずれ対策)
function pickDate(value) {
  if (typeof value === 'string' && DATE_RE.test(value) &&
      [-1, 0, 1].some(function (o) { return jstDateKey(o) === value; })) {
    return value;
  }
  return jstDateKey(0);
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
  return b && typeof b === 'object' ? b : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = redisConfig();
  if (!cfg) { res.status(503).json({ error: 'storage not configured' }); return; }
  try {
    if (req.method === 'GET') {
      const out = await pipeline(cfg, [['HGETALL', HASH_KEY]]);
      const flat = (out[0] && out[0].result) || [];
      const data = { v: 1, total: {}, daily: {} };
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const field = String(flat[i]);
        const n = parseInt(flat[i + 1], 10);
        if (!(n >= 1)) { continue; }
        if (field.indexOf('total:') === 0) {
          data.total[field.slice(6)] = n;
        } else if (field.indexOf('d:') === 0) {
          const date = field.slice(2, 12);
          const id = field.slice(13);
          if (!DATE_RE.test(date)) { continue; }
          (data.daily[date] = data.daily[date] || {})[id] = n;
        }
      }
      res.status(200).json(data);
      return;
    }
    if (req.method === 'POST') {
      const body = parseBody(req);
      if (!body || typeof body.id !== 'string' || IDS.indexOf(body.id) < 0) {
        res.status(400).json({ error: 'invalid id' });
        return;
      }
      const date = pickDate(body.date);
      await pipeline(cfg, [
        ['HINCRBY', HASH_KEY, 'total:' + body.id, 1],
        ['HINCRBY', HASH_KEY, 'd:' + date + ':' + body.id, 1]
      ]);
      res.status(200).json({ ok: true });
      return;
    }
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(502).json({ error: 'storage error' });
  }
};
