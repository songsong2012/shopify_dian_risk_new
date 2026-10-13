// 自定义电商风控规则引擎
// 每个规则返回 { triggered: bool, score: number, reason: string }

const HIGH_RISK_COUNTRIES = (process.env.HIGH_RISK_COUNTRIES || 'NG,ID,VN,BR,PK').split(',');
const BLOCKED_EMAIL_DOMAINS = (process.env.BLOCKED_EMAIL_DOMAINS || 'tempmail.com,mailinator.com').split(',');

function ruleHighRiskCountry(order) {
  const country = order.shipping_address && order.shipping_address.country_code;
  if (country && HIGH_RISK_COUNTRIES.includes(country.toUpperCase())) {
    return { triggered: true, score: 30, reason: `High risk shipping country: ${country}` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleLargeAmount(order) {
  const threshold = parseFloat(process.env.LARGE_ORDER_THRESHOLD || '500');
  const amount = parseFloat(order.total_price || 0);
  if (amount > threshold) {
    return { triggered: true, score: 25, reason: `Order amount ${amount} exceeds threshold ${threshold}` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleBulkPurchase(order) {
  const items = order.line_items || [];
  const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
  if (totalQty >= parseInt(process.env.BULK_QTY_THRESHOLD || '10', 10)) {
    return { triggered: true, score: 20, reason: `Bulk purchase quantity: ${totalQty}` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleAddressMismatch(order) {
  const sa = order.shipping_address || {};
  const ba = order.billing_address || {};
  if (sa.country_code && ba.country_code && sa.country_code !== ba.country_code) {
    return { triggered: true, score: 15, reason: `Shipping(${sa.country_code}) != Billing(${ba.country_code})` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleTempEmail(order) {
  const email = (order.email || '').toLowerCase();
  const domain = email.split('@')[1];
  if (domain && BLOCKED_EMAIL_DOMAINS.includes(domain)) {
    return { triggered: true, score: 35, reason: `Blocked email domain: ${domain}` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleNewCustomerLarge(order) {
  const amount = parseFloat(order.total_price || 0);
  const isNew = !(order.customer && order.customer.orders_count > 0);
  const newThreshold = parseFloat(process.env.NEW_CUSTOMER_THRESHOLD || '300');
  if (isNew && amount > newThreshold) {
    return { triggered: true, score: 20, reason: `New customer large order: ${amount}` };
  }
  return { triggered: false, score: 0, reason: '' };
}

function ruleMissingPhone(order) {
  const ba = order.billing_address || {};
  if (!ba.phone) {
    return { triggered: true, score: 10, reason: 'Missing billing phone' };
  }
  return { triggered: false, score: 0, reason: '' };
}

const ALL_RULES = [
  { name: 'high_risk_country', fn: ruleHighRiskCountry },
  { name: 'large_amount', fn: ruleLargeAmount },
  { name: 'bulk_purchase', fn: ruleBulkPurchase },
  { name: 'address_mismatch', fn: ruleAddressMismatch },
  { name: 'temp_email', fn: ruleTempEmail },
  { name: 'new_customer_large', fn: ruleNewCustomerLarge },
  { name: 'missing_phone', fn: ruleMissingPhone }
];

function evaluateOrder(order) {
  const triggered = [];
  let totalScore = 0;
  for (const r of ALL_RULES) {
    let res;
    try {
      res = r.fn(order);
    } catch (e) {
      res = { triggered: false, score: 0, reason: `rule error: ${e.message}` };
    }
    if (res.triggered) {
      totalScore += res.score;
      triggered.push({ rule: r.name, score: res.score, reason: res.reason });
    }
  }
  const blockThreshold = parseInt(process.env.BLOCK_SCORE_THRESHOLD || '60', 10);
  const reviewThreshold = parseInt(process.env.REVIEW_SCORE_THRESHOLD || '30', 10);
  let recommendation = 'approve';
  let riskLevel = 'low';
  if (totalScore >= blockThreshold) { recommendation = 'block'; riskLevel = 'high'; }
  else if (totalScore >= reviewThreshold) { recommendation = 'review'; riskLevel = 'mid'; }

  return {
    order_id: order.id,
    order_name: order.name,
    total_price: order.total_price,
    risk_score: totalScore,
    risk_level: riskLevel,
    recommendation,
    triggered_rules: triggered
  };
}

module.exports = { evaluateOrder, ALL_RULES };
