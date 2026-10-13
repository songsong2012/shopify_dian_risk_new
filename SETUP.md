# e-commerce risk management 完整搭建操作手册

本手册记录从零搭建 Shopify 电商风控 App 的全部步骤，按顺序执行即可成功。

## 架构总览

- 服务器：腾讯云轻量应用服务器（Ubuntu 24.04，香港）
- 域名：shopifyriskdefence.com（A 记录指向服务器公网 IP）
- 技术栈：Node.js 20 + Express + SQLite（better-sqlite3）+ nginx + pm2 + Let's Encrypt
- 核心链路：商店新订单 → Shopify webhook 秒级推送 → 风控引擎评估 → SQLite 入库 → 风险标签回写订单 → 仪表盘展示

## 一、服务器环境准备

```bash
# 1. 安装 Node.js 20.x 与编译工具（better-sqlite3 需要 g++）
sudo apt-get update
sudo apt-get install -y nodejs npm g++
# 2. 安装 pm2（进程守护）与 Shopify CLI
sudo npm install -g pm2 @shopify/cli@latest
# 3. 安装 nginx 与 certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

## 二、项目部署

```bash
# 1. 克隆代码
git clone https://github.com/songsong2012/shopify_dian_risk_new.git /opt/shopify-risk-app
cd /opt/shopify-risk-app
# 2. 安装依赖
npm install
# 3. 创建环境变量文件（参照下方模板，填入自己的凭据）
cp .env.example .env  # 或手动创建
```

.env 模板（关键项）：
```
SHOPIFY_API_KEY=<应用的 Client ID>
SHOPIFY_API_SECRET=<应用的 Client secret>
SHOP_DOMAIN=<商店域名>.myshopify.com
PORT=3000
```

## 三、Shopify 应用配置

1. 在开发者控制台 https://dev.shopify.com/dashboard/ 创建应用（或使用已有应用），记录 Client ID 和 Client secret
2. 项目根目录 shopify.app.toml 关键配置：
```toml
client_id = "<你的 Client ID>"
application_url = "https://<你的域名>"
embedded = true

[access_scopes]
scopes = "read_orders,read_all_orders,read_customers,read_products,write_orders"

[auth]
redirect_urls = [ "https://<你的域名>/auth/callback" ]

[webhooks]
api_version = "2024-10"
  [[webhooks.subscriptions]]
  topics = [ "orders/create" ]
  uri = "/webhooks/orders/create"
```
3. 部署配置到 Shopify：
```bash
cd /opt/shopify-risk-app && shopify app deploy --allow-updates
```
注意：read_all_orders 是受保护权限。开发商店（dev store）保存申请理由后直接生效；真实商店需先在控制台 API access requests 提交人工审核。

## 四、域名与 HTTPS

1. 域名控制台添加两条 A 记录：主机记录 @ 和 www，记录值填服务器公网 IP
2. 验证解析生效：`nslookup <你的域名> 8.8.8.8`
3. 申请 SSL 证书（自动续期）：
```bash
sudo certbot certonly --webroot -w /var/www/html -d <你的域名> -d www.<你的域名> --non-interactive --agree-tos -m <你的邮箱>
```
4. nginx 配置（/etc/nginx/conf.d/<你的域名>.conf，参照仓库内配置文件结构）：80 端口做证书校验并 301 跳转 HTTPS；443 端口挂证书反向代理到 127.0.0.1:3000；不要加 X-Frame-Options（Shopify 后台用 iframe 嵌入）
5. 检查并重载：`nginx -t && systemctl reload nginx`
6. 云防火墙放行 80/443 端口

## 五、启动服务与授权

```bash
# 1. pm2 启动并守护
cd /opt/shopify-risk-app && pm2 start server.js --name risk-app
pm2 save
# 2. 浏览器完成商店授权（用商店所有者账号登录后打开）
# https://<你的域名>/auth
# 点击 Install / Approve，回调成功后令牌自动保存
```

## 六、注册订单事件订阅（实时推送）

部署配置后如商店 webhook 列表为空，通过 API 主动注册：
```bash
node -e "/* 用 client_credentials 换取令牌后 POST /admin/api/2024-10/webhooks.json
body: {webhook:{topic:'orders/create',address:'https://<你的域名>/webhooks/orders/create',format:'json'}} */"
```
验证：GET /admin/api/2024-10/webhooks.json 应返回订阅记录。

## 七、验证全链路

1. 健康检查：`curl https://<你的域名>/health` 返回 status ok
2. 仪表盘：浏览器打开 https://<你的域名>/dashboard，点击『同步最新订单』应拉取并展示订单
3. 实时链路：在商店创建一笔测试订单，几秒后：
   - 仪表盘出现该订单及风控评分
   - Shopify 后台订单列表该订单自动带 risk-high / risk-mid / risk-low 标签
   - 服务器日志出现 `Webhook order #xxx: score=xx level=xx tag=HTTP 200`

## 八、风控规则说明（lib/rules.js）

7 条规则：高风险收货地区(30分)、大额订单超500(25分)、批量采购≥10件(20分)、账单收货国家不一致(15分)、临时邮箱域名(35分)、新客大额首单超300(20分)、缺失账单电话(10分)

评分线：≥60 拦截(高风险)、≥30 人工审核(中风险)、<30 放行(低风险)。阈值均可通过 .env 环境变量调整（LARGE_ORDER_THRESHOLD、BLOCK_SCORE_THRESHOLD 等），改后 `pm2 restart risk-app`。

## 九、常见问题

1. **Admin API 返回 403『Non-expiring access tokens are no longer accepted』**：Shopify 已停用永久令牌，代码已改为每次用 client_credentials 自动换取临时令牌（有效期约24小时），无需人工干预
2. **订单列表为空但计数有值**：应用缺少 read_all_orders 时只能读安装后的订单；确认权限已批准并重新授权
3. **webhook 标签回写 403**：确认商店已批准 write_orders 权限（重新授权），且回写使用临时令牌
4. **redirect_uri 报错**：授权链接必须完整复制；用短链接 /auth 可避免；确认 shopify.app.toml 的 redirect_urls 与授权链接回调一致
5. **better-sqlite3 安装失败**：先 `sudo apt-get install -y g++` 再重装
6. **端口被占用（EADDRINUSE）**：`ss -lntp | grep :3000` 查占用进程，停掉残留进程或改 .env 的 PORT
7. **本地网络无法访问服务器**：检查云防火墙放行 443；公司网络可能拦截境外 IP 或测试域名，换网络或使用正式域名

## 十、日常运维

- 服务管理：`pm2 list / pm2 restart risk-app / pm2 logs risk-app`
- 数据备份：定期复制 /opt/shopify-risk-app/risk.db（SQLite 单文件，含全部订单与评估记录）
- 证书续期：certbot 已配置自动续期任务，无需人工操作
- 代码更新：git pull 后 `npm install`（如有新依赖）再 `pm2 restart risk-app`
