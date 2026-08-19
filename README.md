<div align="right">

**简体中文** · [English](README.en.md)

</div>

# MyChat — 私人 AI 试用台

跑在 Cloudflare Workers 免费版上的个人 AI 试用站,通过 OpenRouter 调用各家最新的对话模型和图片模型。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Elliott-byte/mychat)

> 👆 **点这个按钮即可一键部署。** 部署过程中 Cloudflare 会提示你填写
> `OPENROUTER_API_KEY` 和 `MASTER_PASSWORD`,填完自动构建上线,不需要任何命令行操作。

---

## 特点

- **全部免费资源** — Cloudflare Workers 免费版(每天 10 万次请求)+ 静态资源托管,无需付费计划
- **主密码保护** — 只有你能用,未登录时所有 API 一律 401
- **密钥安全** — OpenRouter API Key 存在 Cloudflare Secret 里,只在服务端使用,永远不会出现在网页源码或浏览器里
- **模型自动更新** — 模型列表实时从 OpenRouter 拉取,按上线时间倒序,新模型自动出现在最前面,无需改代码
- **ChatGPT 式界面** — 左侧历史记录侧边栏,流式输出、停止生成、重新生成、一键复制
- **历史云端保存** — 对话存在 Cloudflare D1(同样免费),换设备打开还是同一份记录
- **对话 + 图片** — 流式对话、文生图、图生图,一个站全包
- **React 前端** — React 19 + Vite 组件化开发,构建产物仅 66KB(gzip)

---

## 一、一键部署(推荐)

直接点本文顶部的 **Deploy to Cloudflare** 按钮,或访问:

<https://deploy.workers.cloudflare.com/?url=https://github.com/Elliott-byte/mychat>

Cloudflare 会:

1. 让你登录 Cloudflare 账号(没有就免费注册)
2. 把仓库 fork 到你的 GitHub
3. **提示你填写两个密钥**(这一步很关键):
   - `OPENROUTER_API_KEY` — 到 https://openrouter.ai/keys 创建,格式 `sk-or-v1-...`
   - `MASTER_PASSWORD` — 你自己设的登录密码,建议用 `openssl rand -base64 24` 生成
4. **自动创建 D1 数据库**(存聊天历史用)并回填配置,你不用管
5. 自动构建并部署,同时配好 CI/CD(以后 `git push` 就会自动重新部署)

完成后会给你一个网址,形如 `https://mychat.<账号名>.workers.dev`,打开输入主密码即可使用。

> 如果部署时漏填了密钥,登录页会直接红字提示缺哪个,按提示到
> **Cloudflare 控制台 → Workers & Pages → mychat → Settings → Variables and Secrets**
> 补上(类型选 **Secret**)再重新部署即可。

---

## 二、命令行部署(不想用 GitHub 的话)

```bash
git clone https://github.com/Elliott-byte/mychat.git && cd mychat
nvm use 22                                    # wrangler 需要 Node 22+

npm install
npx wrangler login                            # 打开浏览器登录 Cloudflare

npx wrangler secret put OPENROUTER_API_KEY    # 输入内容不会显示在屏幕上
npx wrangler secret put MASTER_PASSWORD

npm run deploy    # 会自动创建存历史的 D1 数据库
```

> 存历史的 D1 数据库由 wrangler 部署时自动创建,表结构由 Worker 首次运行时自动建立,
> 两步都不用你操心。
>
> ⚠️ **不要给 `wrangler.jsonc` 里的 `d1_databases` 补 `database_id`。** wrangler 只要
> 看到这个字段非空,就认定绑定已配置完整、跳过自动创建,然后把这个 ID 发给 API 被拒,
> 部署直接失败(错误码 10021)。留空着才是对的(需要 wrangler ≥ 4.45.0)。
> 不想要历史功能的话,把 `wrangler.jsonc` 里的 `d1_databases` 整段删掉即可 —— 聊天照常可用,只是不保存记录。

---

## 三、本地开发

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入真实的 Key 和密码
nvm use 22
npm install
npm run dev          # 自动构建前端 + 启动 Worker,访问 http://localhost:8787
```

改前端想要热更新的话,再开一个终端:

```bash
npm run dev:ui       # Vite 开发服务器,/api 自动转发给上面的 wrangler
```

跑测试(构建 + 在 jsdom 里验证 React 应用能正常挂载渲染):

```bash
npm test
```

`.dev.vars` 和 `dist/` 都在 `.gitignore` 中,不会被提交。

---

## 四、Node 版本说明

Wrangler 需要 **Node.js 22+**。如果你的默认版本较低,先切换:

```bash
nvm use 22                  # 临时切换
nvm alias default 22        # 或设为默认,一劳永逸
```

(用一键部署按钮的话,构建在 Cloudflare 云端进行,本地 Node 版本无所谓。)

---

## 五、功能说明

### 💬 对话
- 左侧边栏是历史记录列表,点任意一条即可回到当时的上下文继续聊
- 标题自动取自你的第一句话;鼠标悬停可**重命名(✎)或删除(🗑)**
- 流式输出(打字机效果),生成中按钮变成 **■ 停止生成**,随时可中断
- 每条消息悬停可**复制**;助手消息还可**↻ 重新生成**(丢弃该条及之后的内容,重新回答)
- 代码块自动高亮边框,右上角有独立的**复制代码**按钮
- 模型下拉框按**上线日期倒序**,最新的排最前;可搜索、可勾选「只看免费」
- 信息栏显示:模型 ID、上线日期、上下文长度、每百万 token 价格
- 切换模型**不会**清空当前对话,方便同一个问题对比不同模型
- 输入框随内容自动增高;滚动到历史位置时不会被新内容强行拽到底部

### 🎨 图片
- 自动筛选出**支持图片输出**的模型(如 Nano Banana / GPT-5 Image 等)
- 输入提示词生成图片,可下载
- 支持**图生图**:点「📎 参考图」上传一张或多张图片作为参考

### ⟳ 刷新模型
模型列表在服务端缓存 1 小时,自动更新。想立刻拉最新的就点左下角的「⟳ 刷新模型」。

### 📱 手机上
宽度小于 820px 时侧边栏自动收起,点左上角 ☰ 唤出。历史存在云端,手机和电脑看到的是同一份。

---

## 六、更新已部署的站点

### 推荐:让 Worker 直接连本仓库(一次配置,以后 push 即部署)

**Cloudflare 控制台 → Workers & Pages → 你的 Worker → Settings → Builds → Git Repository → Manage**,
选择本仓库。之后每次 `git push` 都会自动重新构建部署,不产生任何克隆仓库。

新建 Worker 时也可以走这条路:**Workers & Pages → Create → Workers → Import a repository**。

> 注意 `wrangler.jsonc` 里的 `name` 必须和目标 Worker 同名 —— 它决定部署到哪个 Worker,
> 也决定访问网址。名字对不上会创建出一个全新的 Worker,密钥需要重填。

### 说明:一键部署按钮会克隆仓库

点 **Deploy to Cloudflare** 按钮部署时,Cloudflare 不是直接连接本仓库,而是**克隆一份新仓库**
(本仓库名被占用时自动加后缀,如 `mychat-deploy`),CI/CD 接在克隆仓库上。
这种情况下往本仓库推代码,线上不会更新。

如果你已经是这个状态,用同步脚本把更新推过去:

```bash
./sync-deploy.sh                 # 默认目标 mychat-deploy
./sync-deploy.sh 你的部署仓库名    # 名字不同时手动指定
```

脚本以合并方式同步(不重写历史),并自动保留克隆仓库里被改写过的 Worker 名 ——
直接覆盖会部署出一个全新 Worker,网址变了、密钥还得重填。

长期建议还是改用上面的直连方式,单一仓库更清爽。

---

## 七、安全设计

| 项目 | 做法 |
|---|---|
| API Key 存储 | Cloudflare Secret(加密存储),仅服务端 `env.OPENROUTER_API_KEY` 读取 |
| 主密码存储 | Cloudflare Secret,不落代码库 |
| 会话凭证 | HMAC-SHA256 签名 Cookie,`HttpOnly` + `Secure` + `SameSite=Strict`,7 天有效 |
| 密码比对 | 恒定时间比较防时序攻击;失败延迟 1 秒,减缓暴力破解 |
| 接口保护 | `/api/models`、`/api/chat`、`/api/image` 全部校验会话,未登录返回 401 |
| 聊天历史 | 存于你自己的 Cloudflare D1,只有登录后才能读写,不经过任何第三方 |
| 搜索引擎 | 页面带 `noindex, nofollow` |

浏览器里能看到的只有前端 HTML/JS 和登录后的会话 Cookie,**拿不到 API Key**。所有 OpenRouter 请求都由 Worker 代发。

**换密码**:重新设置 `MASTER_PASSWORD` 并重新部署。因为会话签名密钥从主密码派生,换密码会自动让所有已登录会话失效。

**⚠️ 仓库公开的前提是不含密钥** —— 本项目已用 `.gitignore` 排除 `.dev.vars`,请不要把真实 Key 写进任何被提交的文件。

---

## 八、免费额度

- **Cloudflare Workers 免费版**:每天 100,000 次请求,单次 CPU 时间 10ms(流式转发几乎不占 CPU)
- **静态资源**:免费且不计入请求数
- **Cloudflare D1**(聊天历史):免费版含 5GB 存储、每天 500 万行读取 / 10 万行写入
- **OpenRouter**:`:free` 结尾的模型免费(有速率限制),其他按量计费

个人自用基本触不到 Cloudflare 的免费上限。

---

## 九、文件结构

```
mychat/
├── wrangler.jsonc            # Cloudflare 配置(含 D1 绑定与前端构建命令)
├── vite.config.mjs           # Vite 配置:web/ → dist/
├── package.json              # 含 cloudflare.bindings,用于一键部署时的密钥说明
├── src/index.js              # Worker:认证 + 历史记录(D1)+ OpenRouter 代理
├── web/                      # React 前端源码
│   ├── index.html
│   └── src/
│       ├── main.jsx          # 入口
│       ├── App.jsx           # 全局状态与编排
│       ├── api.js            # 后端接口封装(含流式解析)
│       ├── markdown.jsx      # 极简 Markdown 渲染(无第三方依赖)
│       ├── styles.css
│       └── components/       # Login / Sidebar / ModelBar / ChatView / ImageView
├── test/smoke.mjs            # jsdom 冒烟测试:验证应用能挂载并正确渲染
├── setup-github.sh           # 一键推送到 GitHub 并生成部署链接
├── sync-deploy.sh            # 把更新同步到一键部署克隆出的仓库
├── .dev.vars.example         # 一键部署据此提示填写密钥;也是本地开发模板
└── .gitignore                # 已排除 dist/ 与 .dev.vars
```

> 前端构建由 `wrangler.jsonc` 的 `build.command` 触发,`wrangler deploy` 会自动先跑
> `npm run build`,所以 Cloudflare 云端构建**不需要额外配置**。

---

## 十、可选:环境变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `OPENROUTER_API_KEY` | Secret | **必填**,OpenRouter 密钥 |
| `MASTER_PASSWORD` | Secret | **必填**,登录主密码 |
| `OPENROUTER_BASE_URL` | 普通变量 | 可选。默认 `https://openrouter.ai/api/v1`,网络不通时可指向镜像或自建代理 |

---

## 十一、可选:绑定自己的域名

域名托管在 Cloudflare 的话,在 `wrangler.jsonc` 里加:

```jsonc
"routes": [
  { "pattern": "ai.yourdomain.com", "custom_domain": true }
]
```

然后重新部署。
