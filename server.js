// e-commerce risk management - Shopify 风控 App 主服务
require('dotenv').config();
const express = require('express');
const path = require('path');
const { evaluateOrder } = require('./lib/rules');
const { upsertOrder, saveAssessment, listOrders } = require('./lib/db');
const { setAdminUser, login, logout, verifyAdminSession, verifyShopifyToken } = require('./lib/auth');

const { fetchOrders, getClientCredentialsToken } = require('./lib/shopifyApi');

const app = express();
app.use(express.json());

// 根路径跳转仪表盘（商店后台点击应用时的入口）
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// 嵌入式会话令牌校验（Shopify 后台 iframe 加载时携带 id_token）
function verifySessionToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const sig = require('crypto').createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(parts[0] + '.' + parts[1]).digest('base64url');
    if (sig !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 登录页
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 管理员登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const token = login(username, password);
  if (!token) return res.status(401).json({ error: '用户名或密码错误' });
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
  res.json({ ok: true });
});

// 登出
app.post('/api/logout', (req, res) => {
  const m = /admin_session=([^;]+)/.exec(req.headers.cookie || '');
  if (m) logout(m[1]);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// 双通道身份识别：返回 { role: 'admin' } 或 { role: 'shop', shop } 或 null
function identify(req) {
  // 通道一：管理员会话 Cookie
  const m = /admin_session=([^;]+)/.exec(req.headers.cookie || '');
  if (m && verifyAdminSession(m[1])) return { role: 'admin' };
  // 通道二：Shopify 嵌入式会话令牌（Authorization 头）
  const authz = req.headers.authorization || '';
  if (authz.startsWith('Bearer ')) {
    const s = verifyShopifyToken(authz.slice(7));
    if (s && s.shop) return { role: 'shop', shop: s.shop };
  }
  return null;
}

// 仪表盘页面（支持商店后台嵌入与直接访问；数据由接口层保护）
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 订单列表（含最新风控评估）——需管理员会话或商店嵌入式令牌
app.get('/api/orders', (req, res) => {
  const who = identify(req);
  if (!who) return res.status(401).json({ error: 'unauthorized' });
  try {
    // 商店身份只能看自己商店的订单；管理员可看全部或指定商店
    const shop = who.role === 'shop' ? who.shop : (req.query.shop || null);
    res.json({ orders: listOrders(shop), role: who.role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 同步订单：拉取 -> 风控评估 -> 入库
app.post('/api/orders/sync', async (req, res) => {
  try {
    const tk = await getClientCredentialsToken();
    process.env.SHOPIFY_ACCESS_TOKEN = tk;
    const orders = await fetchOrders({ limit: 50 });
    const shop = process.env.SHOP_DOMAIN;
    let assessed = 0;
    for (const o of orders) {
      upsertOrder(shop, o);
      const result = evaluateOrder(o);
      saveAssessment(o.id, shop, result);
      assessed++;
    }
    res.json({ synced: orders.length, assessed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动时加载已保存的长期访问令牌（OAuth 授权后生成）
try {
  const fs = require('fs');
  if (fs.existsSync('/opt/shopify-risk-app/.access-token')) {
    process.env.SHOPIFY_ACCESS_TOKEN = fs.readFileSync('/opt/shopify-risk-app/.access-token', 'utf8').trim();
    console.log('Loaded saved access token');
  }
} catch (e) {
  console.log('No saved access token:', e.message);
}

const PORT = process.env.PORT || 3000;

// 启动时初始化管理员账户（环境变量配置）
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  setAdminUser(process.env.ADMIN_USER, process.env.ADMIN_PASS);
  console.log('Admin user initialized:', process.env.ADMIN_USER);
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'e-commerce risk management', shop: process.env.SHOP_DOMAIN });
});

// 拉取商店订单并跑风控规则
app.get('/orders/risk', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '5', 10);
    const tk = await getClientCredentialsToken();
    process.env.SHOPIFY_ACCESS_TOKEN = tk;
    const orders = await fetchOrders({ limit });
    const results = orders.map(evaluateOrder);
    res.json({
      shop: process.env.SHOP_DOMAIN,
      count: results.length,
      results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 对单笔订单做风控评估（POST 传入订单对象）
app.post('/risk/evaluate', (req, res) => {
  try {
    res.json(evaluateOrder(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 授权入口：短链接自动跳转完整授权地址
app.get('/auth', (req, res) => {
  const shop = process.env.SHOP_DOMAIN;
  const scopes = 'read_orders,read_all_orders,read_customers,read_products,write_orders';
  const redirectUri = encodeURIComponent('https://shopifyriskdefence.com/auth/callback');
  const url = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(scopes)}&redirect_uri=${redirectUri}`;
  res.redirect(url);
});

// Webhook：订单创建事件（实时风控）
const crypto = require('crypto');

function verifyWebhookHmac(rawBody, hmacHeader) {
  const digest = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch (e) {
    return false;
  }
}

// 把风险等级标签回写到订单
async function writeRiskTag(shop, orderId, riskLevel) {
  const https = require('https');
  const tag = 'risk-' + riskLevel;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ order: { id: orderId, tags: tag } });
    const o = {
      hostname: shop,
      path: `/admin/api/2024-10/orders/${orderId}.json`,
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const r = https.request(o, s => {
      let d = '';
      s.on('data', c => (d += c));
      s.on('end', () => resolve({ status: s.statusCode, body: d.substring(0, 200) }));
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

app.post('/webhooks/orders/create', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (!hmacHeader || !verifyWebhookHmac(rawBody, hmacHeader)) {
      return res.status(401).send('Invalid HMAC');
    }
    const order = JSON.parse(rawBody);
    const shop = req.get('X-Shopify-Shop-Domain') || process.env.SHOP_DOMAIN;

    // 风控评估并入库
    const result = evaluateOrder(order);
    upsertOrder(shop, order);
    saveAssessment(order.id, shop, result);

    // 标签回写（失败不影响 webhook 响应）
    let tagResult = 'skipped';
    try {
      const tk = await getClientCredentialsToken();
      process.env.SHOPIFY_ACCESS_TOKEN = tk;
      const tr = await writeRiskTag(shop, order.id, result.risk_level);
      tagResult = 'HTTP ' + tr.status;
    } catch (e) {
      tagResult = 'error: ' + e.message;
    }
    console.log(`Webhook order ${order.name}: score=${result.risk_score} level=${result.risk_level} tag=${tagResult}`);
    res.status(200).send('ok');
  } catch (e) {
    console.error('Webhook error:', e.message);
    res.status(200).send('ok');
  }
});

// OAuth 授权回调：接收授权码换取长期访问令牌
app.get('/auth/callback', async (req, res) => {
  const { code, shop, state } = req.query;
  if (!code || !shop) {
    return res.status(400).send('Missing code or shop parameter');
  }
  try {
    const https = require('https');
    const query = require('querystring');
    const postData = query.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });
    const result = await new Promise((resolve, reject) => {
      const o = {
        hostname: shop,
        path: '/admin/oauth/access_token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
      };
      const r = https.request(o, s => {
        let d = '';
        s.on('data', c => (d += c));
        s.on('end', () => resolve({ status: s.statusCode, body: d }));
      });
      r.on('error', reject);
      r.write(postData);
      r.end();
    });
    const parsed = JSON.parse(result.body || '{}');
    if (result.status === 200 && parsed.access_token) {
      process.env.SHOPIFY_ACCESS_TOKEN = parsed.access_token;
      require('fs').writeFileSync('/opt/shopify-risk-app/.access-token', parsed.access_token, { mode: 0o600 });
      res.send(`<h2>Authorization successful</h2><p>Shop: ${shop}</p><p>Scopes: ${parsed.scope}</p><p>Access token saved. You can close this page.</p>`);
    } else {
      res.status(500).send(`<h2>Token exchange failed</h2><pre>${result.body}</pre>`);
    }
  } catch (e) {
    res.status(500).send('Auth callback error: ' + e.message);
  }
});

app.listen(PORT, () => {
  console.log(`Risk app listening on port ${PORT}, shop=${process.env.SHOP_DOMAIN}`);
});

module.exports = app;
