// SQLite 数据库模块：订单与风控评估存储
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'risk.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  shop TEXT,
  order_name TEXT,
  email TEXT,
  phone TEXT,
  total_price REAL,
  currency TEXT,
  financial_status TEXT,
  fulfillment_status TEXT,
  customer_name TEXT,
  customer_orders_count INTEGER,
  shipping_country TEXT,
  shipping_city TEXT,
  billing_country TEXT,
  line_items_count INTEGER,
  items_total_qty INTEGER,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  shop TEXT,
  risk_score INTEGER,
  risk_level TEXT,
  recommendation TEXT,
  triggered_rules TEXT,
  assessed_at TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_risk_order ON risk_assessments(order_id);
`);

// 保存订单（存在则更新）
function upsertOrder(shop, o) {
  const items = o.line_items || [];
  const info = db.prepare(`
    INSERT INTO orders (id, shop, order_name, email, phone, total_price, currency,
      financial_status, fulfillment_status, customer_name, customer_orders_count,
      shipping_country, shipping_city, billing_country, line_items_count,
      items_total_qty, created_at, updated_at, raw_json)
    VALUES (@id, @shop, @order_name, @email, @phone, @total_price, @currency,
      @financial_status, @fulfillment_status, @customer_name, @customer_orders_count,
      @shipping_country, @shipping_city, @billing_country, @line_items_count,
      @items_total_qty, @created_at, @updated_at, @raw_json)
    ON CONFLICT(id) DO UPDATE SET
      order_name=excluded.order_name, email=excluded.email, phone=excluded.phone,
      total_price=excluded.total_price, currency=excluded.currency,
      financial_status=excluded.financial_status, fulfillment_status=excluded.fulfillment_status,
      customer_name=excluded.customer_name, customer_orders_count=excluded.customer_orders_count,
      shipping_country=excluded.shipping_country, shipping_city=excluded.shipping_city,
      billing_country=excluded.billing_country, line_items_count=excluded.line_items_count,
      items_total_qty=excluded.items_total_qty, updated_at=excluded.updated_at, raw_json=excluded.raw_json
  `).run({
    id: o.id,
    shop,
    order_name: o.name || '',
    email: o.email || (o.customer && o.customer.email) || '',
    phone: (o.shipping_address && o.shipping_address.phone) || (o.billing_address && o.billing_address.phone) || '',
    total_price: parseFloat(o.total_price || 0),
    currency: o.currency || '',
    financial_status: o.financial_status || '',
    fulfillment_status: o.fulfillment_status || '',
    customer_name: o.customer ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(' ') : '',
    customer_orders_count: o.customer ? (o.customer.orders_count || 0) : 0,
    shipping_country: o.shipping_address ? o.shipping_address.country_code || '' : '',
    shipping_city: o.shipping_address ? o.shipping_address.city || '' : '',
    billing_country: o.billing_address ? o.billing_address.country_code || '' : '',
    line_items_count: items.length,
    items_total_qty: items.reduce((s, i) => s + (i.quantity || 0), 0),
    created_at: o.created_at || '',
    updated_at: o.updated_at || '',
    raw_json: JSON.stringify(o)
  });
  return info.changes;
}

// 保存风控评估
function saveAssessment(orderId, shop, result) {
  db.prepare(`
    INSERT INTO risk_assessments (order_id, shop, risk_score, risk_level, recommendation, triggered_rules, assessed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, shop, result.risk_score, result.risk_level || '', result.recommendation, JSON.stringify(result.triggered_rules || []), new Date().toISOString());
}

// 查询订单列表（带最新评估）
function listOrders(shop) {
  return db.prepare(`
    SELECT o.*, r.risk_score, r.risk_level, r.recommendation, r.triggered_rules, r.assessed_at
    FROM orders o
    LEFT JOIN risk_assessments r ON r.id = (
      SELECT id FROM risk_assessments WHERE order_id = o.id ORDER BY id DESC LIMIT 1
    )
    ${shop ? 'WHERE o.shop = ?' : ''}
    ORDER BY o.created_at DESC
  `).all(...(shop ? [shop] : []));
}

// 统计
function stats(shop) {
  const where = shop ? 'WHERE shop = ?' : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM orders ${where}`).get(...(shop ? [shop] : [])).c;
  const high = db.prepare(`SELECT COUNT(*) c FROM orders o JOIN risk_assessments r ON r.id=(SELECT id FROM risk_assessments WHERE order_id=o.id ORDER BY id DESC LIMIT 1) WHERE r.risk_level='high' ${shop ? 'AND o.shop=?' : ''}`).all(...(shop ? [shop] : [])).length;
  return { total_orders: total };
}

module.exports = { db, upsertOrder, saveAssessment, listOrders, stats };
