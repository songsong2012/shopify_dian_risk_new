// 认证模块：管理员账户密码 + Shopify 嵌入式会话令牌 双通道
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL = 24 * 60 * 60; // 管理员会话有效期 24 小时

// 初始化管理员表
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  expires_at INTEGER
);
`);

// 密码哈希（盐 + sha256）
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(password, s, 32).toString('hex');
  return s + ':' + h;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const h = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
  } catch (e) {
    return false;
  }
}

// 创建/更新管理员账户
function setAdminUser(username, password) {
  const hash = hashPassword(password);
  db.prepare(`INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash`)
    .run(username, hash, new Date().toISOString());
}

// 登录校验，成功返回会话令牌
function login(username, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, user.id, Math.floor(Date.now() / 1000) + SESSION_TTL);
  return token;
}

// 校验管理员会话
function verifyAdminSession(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT username FROM admin_users WHERE id = ?').get(s.user_id);
}

// 登出
function logout(token) {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

// 验证 Shopify 嵌入式会话令牌（JWT 格式，HMAC-SHA256 签名）
function verifyShopifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const sig = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(parts[0] + '.' + parts[1]).digest('base64url');
    if (sig !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    // 提取商店域名（dest 形如 https://xxx.myshopify.com）
    let shop = null;
    if (payload.dest) shop = payload.dest.replace(/^https?:\/\//, '');
    return { shop, sub: payload.sub };
  } catch (e) {
    return null;
  }
}

module.exports = { setAdminUser, login, logout, verifyAdminSession, verifyShopifyToken };
