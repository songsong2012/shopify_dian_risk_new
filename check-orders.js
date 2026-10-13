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
        console.log('TOKEN_RESP:', d.substring(0, 400));
        try { resolve(JSON.parse(d).access_token || ''); } catch (e) { resolve(''); }
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
    path: '/admin/api/2024-10/orders.json?status=any&limit=10',
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': t }
  };
  const r = https.request(o, s => {
    let d = '';
    s.on('data', c => (d += c));
    s.on('end', () => {
      console.log('HTTP', s.statusCode);
      console.log('BODY:', d.substring(0, 800));
    });
  });
  r.on('error', e => console.log('ERR', e.message));
  r.end();
}).catch(e => console.log('TOK_ERR', e.message));
