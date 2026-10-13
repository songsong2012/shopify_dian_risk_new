// Shopify Admin API 客户端：使用 Client Credentials / access token 拉取订单
const https = require('https');

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOP_DOMAIN = process.env.SHOP_DOMAIN || 'baby-store-lbzitdyd.myshopify.com';
const API_VERSION = process.env.API_VERSION || '2024-10';

// 若已通过 OAuth 安装拿到永久 access token，则直接用；否则未安装时用 Client Credentials 换取 token（自定义 App）
function adminRequest(path, method = 'GET', body = null, accessToken = null) {
  return new Promise((resolve, reject) => {
    const token = accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!token) {
      return reject(new Error('No Shopify access token available (set SHOPIFY_ACCESS_TOKEN or complete OAuth)'));
    }
    const options = {
      hostname: SHOP_DOMAIN,
      path: `/admin/api/${API_VERSION}${path}`,
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 拉取订单列表
async function fetchOrders({ limit = 10, status = 'any' } = {}) {
  const res = await adminRequest(`/orders.json?status=${status}&limit=${limit}`);
  if (res.status !== 200) {
    throw new Error(`Fetch orders failed: HTTP ${res.status} - ${JSON.stringify(res.body)}`);
  }
  return res.body.orders || [];
}

// 用 Client Credentials 向 Shopify 换取 token（自定义 App 场景）
async function getClientCredentialsToken() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: 'client_credentials'
    });
    const options = {
      hostname: SHOP_DOMAIN,
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`Token failed: ${res.statusCode} ${data}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { adminRequest, fetchOrders, getClientCredentialsToken };
