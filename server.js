/**
 * 株式会社AIインフルエンサー コーポレートサイト
 * 静的ページの配信 ＋ お問い合わせの受信・保存
 *
 * 起動:  node server.js
 * 依存:  express のみ（保存は Node 標準の node:sqlite）
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- データベース ---------- */
const DB_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DB_DIR, 'contact.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS inquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    company    TEXT NOT NULL,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    tel        TEXT,
    timing     TEXT,
    body       TEXT NOT NULL,
    ip         TEXT,
    created_at TEXT NOT NULL
  )
`);

/* ---------- 共通設定 ---------- */
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* 本番環境では http でのアクセスを https に寄せる */
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  next();
});

/* セキュリティ関連のヘッダ */
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

/* 静的ファイル（HTML・CSS・画像） */
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(jpg|jpeg|png|svg|webp|ico)$/i.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=604800');
    } else if (/\.(css|js)$/i.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  },
}));

/* ---------- 簡易レート制限（同一IPから短時間の連投を止める） ---------- */
const recent = new Map();
const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS ?? 30000);
function tooFast(ip) {
  if (!(RATE_LIMIT_MS > 0)) return false;
  const now = Date.now();
  const last = recent.get(ip) || 0;
  for (const [k, v] of recent) if (now - v > 600000) recent.delete(k);
  if (now - last < RATE_LIMIT_MS) return true;
  recent.set(ip, now);
  return false;
}

/* ---------- 入力チェック ---------- */
const KINDS = ['製品の導入', '受託開発', 'システムの点検', 'その他'];

function validate(b) {
  const errors = [];
  const s = (v) => (typeof v === 'string' ? v.trim() : '');

  const kind = s(b.kind);
  const company = s(b.company);
  const name = s(b.name);
  const email = s(b.email);
  const tel = s(b.tel);
  const timing = s(b.timing);
  const body = s(b.body);

  if (!KINDS.includes(kind)) errors.push('ご相談の種類をお選びください。');
  if (!company) errors.push('会社名をご入力ください。');
  if (company.length > 100) errors.push('会社名が長すぎます。');
  if (!name) errors.push('お名前をご入力ください。');
  if (name.length > 60) errors.push('お名前が長すぎます。');
  if (!email) errors.push('メールアドレスをご入力ください。');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('メールアドレスの形式をご確認ください。');
  if (email.length > 200) errors.push('メールアドレスが長すぎます。');
  if (tel && !/^[0-9+\-() ]{6,20}$/.test(tel)) errors.push('電話番号の形式をご確認ください。');
  if (timing.length > 60) errors.push('ご希望時期が長すぎます。');
  if (!body) errors.push('お問い合わせ内容をご入力ください。');
  if (body.length > 4000) errors.push('お問い合わせ内容が長すぎます（4000文字まで）。');

  /* 空でなければならない隠しフィールド（自動投稿よけ） */
  if (s(b.website)) errors.push('送信できませんでした。');

  return { errors, data: { kind, company, name, email, tel, timing, body } };
}

/* ---------- 受信 ---------- */
app.post('/api/contact', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  if (tooFast(ip)) {
    return res.status(429).json({ ok: false, errors: ['送信の間隔が短すぎます。少し時間をおいてからお試しください。'] });
  }

  const { errors, data } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ ok: false, errors });

  try {
    db.prepare(`
      INSERT INTO inquiries (kind, company, name, email, tel, timing, body, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.kind, data.company, data.name, data.email, data.tel, data.timing, data.body, ip, new Date().toISOString());

    console.log(`[受信] ${new Date().toLocaleString('ja-JP')} ${data.company} ${data.name} (${data.kind})`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('保存に失敗:', e);
    return res.status(500).json({ ok: false, errors: ['送信に失敗しました。お手数ですが時間をおいてお試しください。'] });
  }
});

/* ---------- 受信一覧（Basic認証） ---------- */
function auth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    return res.status(503).send('ADMIN_USER と ADMIN_PASS が設定されていません。');
  }
  const h = req.headers.authorization || '';
  const [scheme, encoded] = h.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (u === user && p === pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="admin"');
  return res.status(401).send('認証が必要です。');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.get('/admin', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 500').all();
  const list = rows.map((r) => `
    <tr>
      <td>${r.id}</td>
      <td>${esc(new Date(r.created_at).toLocaleString('ja-JP'))}</td>
      <td>${esc(r.kind)}</td>
      <td>${esc(r.company)}<br><small>${esc(r.name)}</small></td>
      <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a><br><small>${esc(r.tel || '-')}</small></td>
      <td>${esc(r.timing || '-')}</td>
      <td style="white-space:pre-wrap;max-width:420px">${esc(r.body)}</td>
    </tr>`).join('');

  res.type('html').send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>お問い合わせ一覧</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#2f3440;background:#f5f9fd}
h1{font-size:20px;color:#1b1b4b}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
th,td{border:1px solid #dbe6f3;padding:9px 10px;text-align:left;vertical-align:top}
th{background:#eef4fb;color:#1b1b4b;white-space:nowrap}
small{color:#6b7280}
</style></head><body>
<h1>お問い合わせ一覧（${rows.length}件）</h1>
<table><thead><tr>
<th>#</th><th>受信日時</th><th>種類</th><th>会社／氏名</th><th>連絡先</th><th>時期</th><th>内容</th>
</tr></thead><tbody>${list || '<tr><td colspan="7">まだ受信はありません。</td></tr>'}</tbody></table>
</body></html>`);
});

/* CSVで書き出し */
app.get('/admin/export.csv', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM inquiries ORDER BY id DESC').all();
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['id', '受信日時', '種類', '会社名', '氏名', 'メール', '電話', '希望時期', '内容'].map(q).join(',');
  const body = rows.map((r) =>
    [r.id, r.created_at, r.kind, r.company, r.name, r.email, r.tel, r.timing, r.body].map(q).join(',')).join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="inquiries.csv"');
  res.send('\uFEFF' + head + '\n' + body);
});

/* ---------- 404 ---------- */
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.listen(PORT, () => {
  console.log(`起動しました  ->  http://localhost:${PORT}`);
  console.log(`受信一覧      ->  http://localhost:${PORT}/admin`);
});
