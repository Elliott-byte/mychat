# MyChat — 私人 AI 试用台

跑在 Cloudflare Workers 免费版上的个人 AI 试用站,通过 OpenRouter 调用各家最新的对话模型和图片模型。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Elliott-byte/mychat)

> 👆 点击按钮即可一键部署。部署过程中会提示你填写 OpenRouter Key 和主密码。
> **把上面链接里的 `YOUR_GITHUB_USERNAME` 换成你自己的 GitHub 用户名。**

---

## 特点

- **全部免费资源** — Cloudflare Workers 免费版(每天 10 万次请求)+ 静态资源托管,无需付费计划
- **主密码保护** — 只有你能用,未登录时所有 API 一律 401
- **密钥安全** — OpenRouter API Key 存在 Cloudflare Secret 里,只在服务端使用,永远不会出现在网页源码或浏览器里
- **模型自动更新** — 模型列表实时从 OpenRouter 拉取,按上线时间倒序,新模型自动出现在最前面,无需改代码
- **对话 + 图片** — 流式对话、文生图、图生图,一个站全包

---

## 一、一键部署(推荐)

### 步骤 1:推到你自己的 GitHub

跑这一条命令就够了 —— 它会自动替换按钮里的用户名占位符、初始化 git、创建公开仓库并推送:

```bash
./setup-github.sh 你的GitHub用户名
```

> 一键部署按钮要求仓库是**公开的**(Cloudflare 需要读取它)。
> 本项目不含任何密钥(`.dev.vars` 已被 `.gitignore` 排除),公开是安全的。
> 脚本在推送前也会再检查一遍,发现 `.dev.vars` 被跟踪会直接中止。

没装 [`gh`](https://cli.github.com/) 的话,脚本会提示你手动建仓库后再 push,照做即可。

### 步骤 2:点按钮

回到 GitHub 上的仓库首页,点击 **Deploy to Cloudflare** 按钮。Cloudflare 会:

1. 让你登录 Cloudflare 账号(没有就免费注册)
2. 把仓库 fork 到你的 GitHub
3. **提示你填写两个密钥**(这一步很关键):
   - `OPENROUTER_API_KEY` — 到 https://openrouter.ai/keys 创建,格式 `sk-or-v1-...`
   - `MASTER_PASSWORD` — 你自己设的登录密码,建议用 `openssl rand -base64 24` 生成
4. 自动构建并部署,同时配好 CI/CD(以后 `git push` 就会自动重新部署)

完成后会给你一个网址,形如 `https://mychat.<账号名>.workers.dev`,打开输入主密码即可使用。

> 如果部署时漏填了密钥,登录页会直接红字提示缺哪个,按提示到
> **Cloudflare 控制台 → Workers & Pages → mychat → Settings → Variables and Secrets**
> 补上(类型选 **Secret**)再重新部署即可。

---

## 二、命令行部署(不想用 GitHub 的话)

```bash
cd /Users/elliott/repos/mychat
nvm use 22                                    # wrangler 需要 Node 22+

npm install
npx wrangler login                            # 打开浏览器登录 Cloudflare

npx wrangler secret put OPENROUTER_API_KEY    # 输入内容不会显示在屏幕上
npx wrangler secret put MASTER_PASSWORD

npm run deploy
```

---

## 三、本地开发

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入真实的 Key 和密码
nvm use 22
npm run dev
```

访问 http://localhost:8787 。`.dev.vars` 已在 `.gitignore` 中,不会被提交。

---

## 四、Node 版本说明

Wrangler 需要 **Node.js 22+**。你机器上默认是 v18,但已装了 v22.18.0,用之前先 `nvm use 22`。
嫌麻烦可以设为默认:`nvm alias default 22`。

(用一键部署按钮的话,构建在 Cloudflare 云端进行,本地 Node 版本无所谓。)

---

## 五、功能说明

### 💬 对话标签页
- 模型下拉框列出所有支持文字输出的模型,**按上线日期倒序**,最新的排最前
- 搜索框可按名称/ID 过滤,勾选「只看免费」只显示 `:free` 和零价格模型
- 信息栏显示:模型 ID、上线日期、上下文长度、每百万 token 价格
- 流式输出(打字机效果),支持多轮对话
- 「清空对话」重置上下文;切换模型**不会**清空历史,方便同一个问题对比不同模型

### 🎨 图片标签页
- 自动筛选出**支持图片输出**的模型(如 Nano Banana / GPT-5 Image 等)
- 输入提示词生成图片,可下载
- 支持**图生图**:点「📎 参考图」上传一张或多张图片作为参考

### ⟳ 刷新模型
模型列表在服务端缓存 1 小时,自动更新。想立刻拉最新的就点标题栏的 ⟳。

---

## 六、安全设计

| 项目 | 做法 |
|---|---|
| API Key 存储 | Cloudflare Secret(加密存储),仅服务端 `env.OPENROUTER_API_KEY` 读取 |
| 主密码存储 | Cloudflare Secret,不落代码库 |
| 会话凭证 | HMAC-SHA256 签名 Cookie,`HttpOnly` + `Secure` + `SameSite=Strict`,7 天有效 |
| 密码比对 | 恒定时间比较防时序攻击;失败延迟 1 秒,减缓暴力破解 |
| 接口保护 | `/api/models`、`/api/chat`、`/api/image` 全部校验会话,未登录返回 401 |
| 搜索引擎 | 页面带 `noindex, nofollow` |

浏览器里能看到的只有前端 HTML/JS 和登录后的会话 Cookie,**拿不到 API Key**。所有 OpenRouter 请求都由 Worker 代发。

**换密码**:重新设置 `MASTER_PASSWORD` 并重新部署。因为会话签名密钥从主密码派生,换密码会自动让所有已登录会话失效。

**⚠️ 仓库公开的前提是不含密钥** —— 本项目已用 `.gitignore` 排除 `.dev.vars`,请不要把真实 Key 写进任何被提交的文件。

---

## 七、免费额度

- **Cloudflare Workers 免费版**:每天 100,000 次请求,单次 CPU 时间 10ms(流式转发几乎不占 CPU)
- **静态资源**:免费且不计入请求数
- **OpenRouter**:`:free` 结尾的模型免费(有速率限制),其他按量计费

个人自用基本触不到 Cloudflare 的免费上限。

---

## 八、文件结构

```
mychat/
├── wrangler.jsonc        # Cloudflare 配置
├── package.json          # 含 cloudflare.bindings,用于一键部署时的密钥说明
├── src/index.js          # Worker:认证 + OpenRouter 代理
├── public/index.html     # 前端单页(登录 + 对话 + 图片)
├── setup-github.sh       # 一键推送到 GitHub 并生成部署链接
├── .dev.vars.example     # 一键部署据此提示填写密钥;也是本地开发模板
└── .gitignore
```

---

## 九、可选:绑定自己的域名

域名托管在 Cloudflare 的话,在 `wrangler.jsonc` 里加:

```jsonc
"routes": [
  { "pattern": "ai.yourdomain.com", "custom_domain": true }
]
```

然后重新部署。
