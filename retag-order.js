require('dotenv').config();
const https = require('https');
const d = require('./lib/db.js');

const order = d.listOrders().find(x => x.order_name === '#1003');
if (!order) {
  console.log('ORDER_NOT_FOUND');
  process.exit(0);
}

function tok() {
  return new Promise((resolve, reject) => {
    const p = JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'client_credentials'
    });
    const o = {
      hostname: 'baby-store-lbzitdyd.myshopify.com',
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
    };
    const r = https.request(o, s => {
      let x = '';
      s.on('data', c => (x += c));
      s.on('end', () => resolve(JSON.parse(x).access_token));
    });
    r.on('error', reject);
    r.write(p);
    r.end();
  });
}

tok().then(t => {
  const tag = 'risk-' + (order.risk_level || 'low');
  const body = JSON.stringify({ order: { id: order.id, tags: tag } });
  const o = {
    hostname: 'baby-store-lbzitdyd.myshopify.com',
    path: '/admin/api/2024-10/orders/' + order.id + '.json',
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const r = https.request(o, s => {
    let x = '';
    s.on('data', c => (x += c));
    s.on('end', () => console.log('ORDER', order.order_name, 'TAG', tag, 'WRITE_HTTP', s.statusCode));
  });
  r.on('error', e => console.log('ERR', e.message));
  r.write(body);
  r.end();
}).catch(e => console.log('TOK_ERR', e.message));
