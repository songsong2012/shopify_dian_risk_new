# e-commerce risk management 改造方案（已确认待实施）

日期：2026-10-12
状态：第一阶段服务器端已完成，待重新授权后验证；第二阶段待实施

## 总体目标

商店新订单产生 → Shopify webhook 秒级推送到服务器 → 风控引擎立即评估 → 结果入库 → 通过订单标签/嵌入式仪表盘呈现给商家

## 第一阶段：订单标签回写（实时风控闭环）

已完成：
1. 应用配置已部署（版本 e-commerce-risk-management-4）：
   - 权限范围：read_orders,read_all_orders,read_customers,read_products,write_orders
   - 已注册 orders/create webhook 订阅，回调地址 /webhooks/orders/create
2. 服务器端已实现：
   - webhook 接收接口（含 HMAC 签名校验）
   - 收到新订单自动：风控评估 → 入库 → 回写风险等级标签（risk-high / risk-mid / risk-low）
   - 授权短链接入口 /auth（避免长链接复制不全）

待完成：
1. 商店重新授权（新增 write_orders 权限需商家批准）：访问 https://<域名>/auth
2. 验证实时链路：创建测试订单，确认自动评估和标签回写

## 第二阶段：嵌入式仪表盘（体验升级）

要点：
1. 应用配置 embedded = true（已具备）
2. 在应用配置中添加后台导航入口（App Home / Navigation 链接指向 /dashboard）
3. 仪表盘页面适配 Shopify 嵌入式认证（session token 校验），否则 iframe 内会被拒绝加载
4. 完成后商家在 Shopify 后台点击应用即可看到风控仪表盘

## 基础设施：正式域名替换 sslip.io

原因：工作网络把 sslip.io 当测试域名拦截

步骤：
1. 申请正式域名（腾讯云域名注册或自有域名）
2. DNS 解析 A 记录指向服务器 119.28.61.151
3. 用 certbot 申请新域名 SSL 证书
4. 更新 nginx 配置（server_name 与证书路径）
5. 更新应用配置 application_url 和 redirect_urls 并重新部署
6. 商店重新授权（回调域名变更）
7. webhook 回调地址同步更新

## 当前接口清单

- 仪表盘：/dashboard
- 订单列表：/api/orders
- 订单同步：POST /api/orders/sync
- 健康检查：/health
- 订单风控评估：/orders/risk
- 单笔评估：POST /risk/evaluate
- 授权入口：/auth
- 授权回调：/auth/callback
- 订单事件接收：/webhooks/orders/create

## 风控规则（当前 7 条，阈值可用环境变量调整）

1. high_risk_country 高风险收货地区（30分）
2. large_amount 大额订单超阈值500（25分）
3. bulk_purchase 批量采购≥10件（20分）
4. address_mismatch 账单收货国家不一致（15分）
5. temp_email 临时邮箱域名（35分）
6. new_customer_large 新客大额首单超300（20分）
7. missing_phone 缺失账单电话（10分）

评分线：≥60 拦截（高风险）、≥30 人工审核（中风险）、<30 放行（低风险）
