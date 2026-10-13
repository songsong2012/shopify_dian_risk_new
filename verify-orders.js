require('dotenv').config();
const https = require('https');

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
      let d = '';
      s.on('data', c => (d += c));
      s.on('end', () => {
        const j = JSON.parse(d);
        console.log('SCOPE:', j.scope);
        resolve(j.access_token || '');
      });
    });
    r.on('error', reject);
    r.write(p);
    r.end();
  });
}

tok().then(t => {
  if (!t) { console.log('NO_TOKEN'); return; }
  const o = {
    hostname: 'baby-store-lbzitdyd.myshopify.com',
    path: '/admin/api/2024-10/orders.json?status=any&limit=10&fields=id,name,total_price,email,financial_status,created_at',
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': t }
  };
  const r = https.request(o, s => {
    let d = '';
    s.on('data', c => (d += c));
    s.on('end', () => {
      const b = JSON.parse(d || '{}');
      console.log('HTTP', s.statusCode, 'ORDER_COUNT:', (b.orders || []).length);
      console.log(JSON.stringify(b.orders || [], null, 1).substring(0, 1500));
    });
  });
  r.on('error', e => console.log('ERR', e.message));
  r.end();
}).catch(e => console.log('TOK_ERR', e.message));
