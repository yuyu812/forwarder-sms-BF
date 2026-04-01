# SMS Forwarder - 短信转发统一接口

🚀 基于 Cloudflare Worker 的**通用短信转发网关**，提供统一 REST API 接口，将短信/验证码转发到 Bark / 飞书 / 企业微信 / 钉钉 / **微信个人号** 等多种推送渠道。

**支持接入任何能发送 HTTP 请求的设备**，包括但不限于：
- 📱 **iOS** - 通过快捷指令自动化
- 🤖 **Android** - 通过 Tasker / MacroDroid / SmsForwarder 等应用
- 🏭 **工业 4G 网关** - 通过 HTTP 回调接口
- 🖥️ **服务器/NAS** - 通过脚本或定时任务
- 🔌 **物联网设备** - 任何支持 HTTP POST 的设备

## 功能特性

- ✅ 统一 REST API 接口（POST JSON）
- ✅ Bearer Token 鉴权
- ✅ 自动提取验证码（支持多种格式）
- ✅ KV 去重（基于设备 + 内容，防止重复推送）
- ✅ 多设备推送支持
- ✅ 速率限制（优先设备标识，缺省回退 IP）
- ✅ 调试模式
- ✅ Bark 推送（支持多设备并行推送）
- ✅ 飞书自定义机器人 Webhook 推送
- ✅ 企业微信群机器人 Webhook 推送（Markdown 富文本）
- ✅ 钉钉自定义机器人 Webhook 推送（ActionCard 卡片）
- ✅ **微信个人号推送（通过 ilinkai Bot 接口）**
- ✅ 支持所有短信推送（不限验证码）

---

## 架构概览

```
手机收到短信
    ↓ HTTP POST
Cloudflare Worker（鉴权 → 去重 → 限流）
    ↓ 并行推送
┌────────┬────────┬────────┬────────┬────────┐
│  Bark  │  飞书  │ 企业微信│  钉钉  │ 微信   │
│  Push  │Webhook │Webhook │Webhook │ilinkai │
└────────┴────────┴────────┴────────┴────────┘

            ┌──────────────────┐
            │ 常驻服务器(可选)   │
            │ 微信 Token 保活   │
            └──────────────────┘
```

所有推送渠道并行发送，互不影响。任意渠道未配置时会静默跳过，只要有一个渠道成功即返回 `success: true`。

---

## 部署步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV Namespace

```bash
npx wrangler kv:namespace create SMS_CACHE
```

将输出的 `id` 填入 `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SMS_CACHE"
id = "你的 KV namespace id"
```

### 3. 配置 Secrets

```bash
# API 访问令牌
npx wrangler secret put API_TOKEN

# Bark 设备 Key（多个用逗号分隔，可选）
npx wrangler secret put BARK_KEYS

# 飞书自定义机器人 Webhook URL（可选）
npx wrangler secret put FEISHU_WEBHOOK

# 企业微信群机器人 Webhook URL（可选）
npx wrangler secret put WECOM_WEBHOOK

# 钉钉自定义机器人 Webhook URL（可选）
npx wrangler secret put DINGTALK_WEBHOOK

# 钉钉机器人加签密钥（可选）
npx wrangler secret put DINGTALK_SECRET

# 微信 ilinkai Bot Token（可选，详见下方微信配置章节）
npx wrangler secret put WEIXIN_BOT_TOKEN

# 微信目标用户 ID（可选）
npx wrangler secret put WEIXIN_TARGET_USER
```

### 4. 部署

```bash
npm run deploy
```

---

## API 接口

### POST `/api/sms/forward`

**Headers:**
```
Authorization: Bearer <your-api-token>
Content-Type: application/json
```

**Body:**
```json
{
  "device": "iphone-main",
  "content": "您的验证码是 834921，有效期5分钟",
  "code": "834921",
  "timestamp": 1737820000,
  "target": ["bark-key-1"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | ✅ | 短信内容（最大 1000 字符） |
| device | string | ❌ | 来源设备标识（用于去重与限流） |
| code | string | ❌ | 验证码（不传则自动提取） |
| timestamp | number | ❌ | Unix 时间戳（偏差>5分钟拒绝） |
| target | string[] | ❌ | 指定推送的 Bark keys |

**Response:**
```json
{
  "success": true,
  "message": "forwarded",
  "code": "834921",
  "feishu": true,
  "wecom": false,
  "dingtalk": false,
  "bark": 2,
  "weixin": true
}
```

---

## 设备接入示例

### iOS 快捷指令

1. 创建新的快捷指令
2. 添加「自动化」触发器 → 当收到短信时
3. 添加以下操作:

```
获取短信内容 → 变量：消息

获取 URL 的内容
  URL: https://your-worker.workers.dev/api/sms/forward
  方法: POST
  Headers:
    Authorization: Bearer your-api-token
    Content-Type: application/json
  Body: {
    "device": "我的iPhone",
    "content": [消息内容],
    "timestamp": [当前日期的Unix时间戳]
  }
```

### Android（SmsForwarder / Tasker）

推荐使用开源应用 [SmsForwarder](https://github.com/pppscn/SmsForwarder)，配置 Webhook 转发：

- **Webhook URL**: `https://your-worker.workers.dev/api/sms/forward`
- **请求方法**: POST
- **请求头**:
  ```
  Authorization: Bearer your-api-token
  Content-Type: application/json
  ```
- **请求体**:
  ```json
  {
    "device": "Android-设备名",
    "content": "[msg]",
    "timestamp": [timestamp]
  }
  ```

### 工业 4G 网关 / 物联网设备

配置 HTTP 回调地址，发送 POST 请求：

```bash
curl -X POST "https://your-worker.workers.dev/api/sms/forward" \
  -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '{
    "device": "4G-Gateway-01",
    "content": "您的验证码是 123456",
    "timestamp": 1737820000
  }'
```

### 通用脚本（Python 示例）

```python
import requests
import time

response = requests.post(
    "https://your-worker.workers.dev/api/sms/forward",
    headers={
        "Authorization": "Bearer your-api-token",
        "Content-Type": "application/json"
    },
    json={
        "device": "Server-01",
        "content": "您的验证码是 654321",
        "timestamp": int(time.time())
    }
)
print(response.json())
```

---

## 推送渠道配置

### Bark

```bash
npx wrangler secret put BARK_KEYS
# 输入 Bark 设备 Key，多个用逗号分隔
```

`BARK_SERVER` 默认为 `https://api.day.app`，如使用自建服务器可在 `wrangler.toml` 中修改。

### 飞书自定义机器人

1. 在飞书群聊中添加自定义机器人
2. 复制 Webhook 地址

```bash
npx wrangler secret put FEISHU_WEBHOOK
```

消息以交互卡片格式推送，包含验证码高亮、短信内容、来源设备、接收时间。

### 企业微信群机器人

1. 在企业微信群聊中添加群机器人
2. 复制 Webhook 地址

```bash
npx wrangler secret put WECOM_WEBHOOK
```

消息以 Markdown 富文本格式推送，验证码以警告色高亮显示。

### 钉钉自定义机器人

1. 在钉钉群聊中添加自定义机器人
2. 复制 Webhook 地址和加签密钥（如有）

```bash
npx wrangler secret put DINGTALK_WEBHOOK
npx wrangler secret put DINGTALK_SECRET  # 可选
```

消息以 ActionCard 卡片格式推送，支持 HMAC-SHA256 签名验证。

### 微信个人号（ilinkai Bot）

微信渠道通过 ilinkai Bot 接口实现单向推送到个人微信。与其他渠道不同，微信渠道需要额外的保活机制。

#### 第一步：获取 Token 和 User ID

```bash
node scripts/weixin-setup.mjs
```

脚本会输出一个 URL，在浏览器中打开后用微信扫码登录。登录后用目标微信号给 Bot 发一条消息，脚本自动获取 `WEIXIN_BOT_TOKEN` 和 `WEIXIN_TARGET_USER`。

#### 第二步：配置 Worker

```bash
npx wrangler secret put WEIXIN_BOT_TOKEN
npx wrangler secret put WEIXIN_TARGET_USER
```

#### 第三步：部署保活脚本

ilinkai 的 token 需要通过持续长轮询保持 session 在线，否则会很快失效。需要在一台常驻服务器上部署保活脚本。

**上传脚本：**

```bash
mkdir -p /opt/weixin-keepalive
scp scripts/weixin-keepalive.mjs user@server:/opt/weixin-keepalive/
```

**创建 systemd 服务：**

```ini
# /etc/systemd/system/weixin-keepalive.service
[Unit]
Description=WeChat ilinkai Bot Keepalive
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=WEIXIN_BOT_TOKEN=<your_bot_token>
Environment=WEIXIN_STATE_FILE=/opt/weixin-keepalive/state.json
ExecStart=/usr/bin/node /opt/weixin-keepalive/weixin-keepalive.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**启动服务：**

```bash
systemctl daemon-reload
systemctl enable weixin-keepalive
systemctl start weixin-keepalive
```

**查看状态：**

```bash
systemctl status weixin-keepalive
journalctl -u weixin-keepalive -f
```

#### 保活脚本说明

- 脚本通过持续调用 `getupdates` 长轮询接口（服务端 hold 35 秒）保持 session 在线
- 支持游标持久化（重启不丢失状态）
- 内存占用 ~25MB，CPU 几乎为零，适合树莓派 / Armbian 等低功耗设备
- 服务器重启后 systemd 自动拉起，token 不会因重启而变更

#### 需要重新扫码的情况

- 保活脚本长时间未运行（服务器宕机数小时）
- 微信服务端主动踢下线
- 日志中持续出现 `errcode=-14`（session 过期）

重新扫码后需同时更新服务器 systemd 环境变量和 Cloudflare Worker Secret。

---

## 调试模式

添加 `?debug=true` 参数，只写入 KV 缓存，不发送任何推送:

```bash
curl -X POST "https://your-worker.workers.dev/api/sms/forward?debug=true" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"content":"验证码 123456"}'
```

---

## 本地开发

```bash
# 启动开发服务器
npm run dev

# 测试请求
curl -X POST http://localhost:8787/api/sms/forward \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"content":"您的验证码是 654321","device":"test"}'
```

---

## 环境变量

| 变量 | 类型 | 必填 | 说明 |
|------|------|------|------|
| API_TOKEN | Secret | ✅ | API 访问令牌 |
| BARK_KEYS | Secret | ❌ | Bark 设备 Keys（逗号分隔） |
| BARK_SERVER | Var | ❌ | Bark 服务器地址（默认: `https://api.day.app`） |
| FEISHU_WEBHOOK | Secret | ❌ | 飞书自定义机器人 Webhook URL |
| WECOM_WEBHOOK | Secret | ❌ | 企业微信群机器人 Webhook URL |
| DINGTALK_WEBHOOK | Secret | ❌ | 钉钉自定义机器人 Webhook URL |
| DINGTALK_SECRET | Secret | ❌ | 钉钉机器人加签密钥 |
| WEIXIN_BOT_TOKEN | Secret | ❌ | 微信 ilinkai Bot Token |
| WEIXIN_TARGET_USER | Secret | ❌ | 微信目标用户 ID（`xxx@im.wechat`） |
| WEIXIN_BASE_URL | Var | ❌ | ilinkai 接口地址（默认: `https://ilinkai.weixin.qq.com`） |
| RATE_LIMIT | Var | ❌ | 每分钟最大请求数（默认: 10） |
| DEBUG | Var | ❌ | 调试模式（默认: false） |

## 去重与限流说明

- 去重基于 `device + content` 计算 SHA-256 哈希，TTL 300 秒。未提供 device 时仅使用 content。
- 速率限制优先使用 device；未提供 device 时回退到客户端 IP。默认 10 次/分钟。

---

## 项目结构

```
├── src/
│   ├── index.js              # Worker 入口，路由分发 + 微信保活 Cron
│   ├── handlers/
│   │   └── sms.js            # SMS 转发处理器（鉴权/验证/去重/并行推送）
│   └── utils/
│       ├── bark.js            # Bark 推送
│       ├── feishu.js          # 飞书 Webhook 推送
│       ├── wecom.js           # 企业微信 Webhook 推送
│       ├── dingtalk.js        # 钉钉 Webhook 推送
│       ├── weixin.js          # 微信 ilinkai 推送 + 保活
│       ├── validator.js       # Token 验证 + 验证码提取
│       └── rateLimit.js       # KV 速率限制
├── scripts/
│   ├── weixin-setup.mjs       # 微信扫码配置工具（获取 token + user ID）
│   └── weixin-keepalive.mjs   # 微信 Token 保活脚本（部署到常驻服务器）
├── wrangler.toml              # Cloudflare Worker 配置
└── package.json
```

---

## License

MIT
