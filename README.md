# YT Lingo · 在 YouTube 上学语言

一个帮助你在看 YouTube 时学外语的项目：**实时捕捉视频里说话者的字幕句子 → 点击任意句子收藏到「生词本」→ 自动翻译成中文（或任意目标语言）→ 多设备云端同步**。

包含三个部分：

| 目录 | 说明 |
|------|------|
| `server/` | 后端 API：账号认证、生词本云端同步、翻译代理、字幕代理 |
| `extension/` | Chrome 浏览器扩展：在 YouTube 播放页叠加可点击的字幕面板 |
| `web/` | 网站：管理生词本、粘贴 YouTube 链接学习 |

三端共用同一个后端，登录同一账号即可在扩展和网站间同步生词本。

---

## 整体架构

```
        ┌───────────────────────┐        ┌───────────────────────┐
        │  Chrome 扩展 (MV3)     │        │      网站 (React)      │
        │  · 抓 YouTube 字幕     │        │  · 生词本管理          │
        │  · 点击句子收藏         │        │  · 粘贴链接学习         │
        └───────────┬───────────┘        └───────────┬───────────┘
                    │            HTTP / JWT           │
                    └───────────────┬────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │        后端 (Express)          │
                    │  /api/auth      账号            │
                    │  /api/vocab     生词本 (SQLite) │
                    │  /api/translate 翻译代理        │
                    │  /api/captions  字幕代理        │
                    └───────────────────────────────┘
```

- **字幕捕捉**：优先读取 YouTube 自带字幕轨（人工/自动生成），带时间戳，可与视频精确同步。
  - **扩展**：在真实浏览器会话里直接抓取，稳定可靠（**推荐主路径**）。
  - **网站**：通过后端 `/api/captions` 代理抓取。⚠️ 注意 YouTube 近期对**服务器端**下载字幕正文做了限制（poToken 门槛），从数据中心 IP 请求常常返回空。因此网站的「链接学习」为**尽力而为**：拿不到字幕时会提示你改用扩展学习该视频，播放器仍可正常观看，生词本照常同步。
- **翻译**：当前用免费的 Google 翻译公开端点（无需 API Key）。后续升级只需替换 `server/src/translate.ts` 里的实现，其余代码不受影响。
- **云端同步**：后端用 SQLite 存储，账号用邮箱+密码（bcrypt 加密）+ JWT。后续可平滑迁移到云数据库。

---

## 我是普通用户，只想装扩展用

如果项目维护者已经部署了公网后端并发布了扩展，你**只需 3 步**：

1. 到 [GitHub Releases](https://github.com/gengen-gui/YouTube--Language-learning/releases) 下载最新 `YT-Lingo-Extension.zip` 并解压
2. 打开 `chrome://extensions/` → 右上角开启「开发者模式」→「加载已解压的扩展程序」→ 选解压后的文件夹
3. 打开任意 YouTube 视频 → 点扩展图标 → 用邮箱注册 / 登录 → 选目标语言即可

> 这个 Release 版本的扩展**已内置公网后端地址**，无需手动填 API server，装上直接注册就能用。

---

## 快速开始（开发者 / 自己部署）

> 需要 Node.js 18+（后端翻译用到了全局 `fetch`）。

### ☁️ 方式一：部署公网后端到 Render + Neon（免费、无需信用卡，数据永久）

想让**普通用户下载扩展就能直接注册使用**，就把后端部署到公网。
这套组合完全免费、**不用绑卡**：Render 跑后端，Neon 提供免费 PostgreSQL 存数据（永久不丢）。
后端代码会**自动检测 `DATABASE_URL`**：设了就用 Postgres（生产），没设就用本地 SQLite（开发/Docker）。

**A. 建免费 Postgres（Neon）**

1. 打开 <https://neon.tech> → 用 GitHub/Google 免费注册（不用绑卡）
2. 新建一个 Project（Region 选离你近的，比如 Singapore / US East）
3. 建好后复制 **Connection string**，形如：
   `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`

**B. 部署后端（Render Blueprint，一键）**

1. 打开 <https://render.com> → 用 GitHub 免费注册登录（不用绑卡）
2. 顶部 **New → Blueprint** → 选择你的仓库 `YouTube--Language-learning`
   （Render 会自动读取仓库根目录的 `render.yaml`）
3. 点部署时会让你填一个环境变量 **`DATABASE_URL`** → 粘贴上一步 Neon 的连接串
   （`JWT_SECRET` 会自动随机生成，无需手填）
4. 点 **Apply / Create**，等 3~5 分钟构建部署

部署完成后你会得到一个公网地址，例如 `https://yt-lingo-server.onrender.com`。
访问 `https://yt-lingo-server.onrender.com/api/health` 返回 `{"ok":true}` 即成功。

> ⚠️ Render 免费实例 15 分钟无访问会休眠，下次首个请求需等 ~30 秒唤醒（之后正常）。数据在 Neon，不受休眠影响。

**C. 让发布的扩展默认连这个后端**

到 GitHub 仓库 → **Settings → Secrets and variables → Actions → Variables → New repository variable**：
- Name：`YT_LINGO_API_BASE`
- Value：你的 Render 地址（如 `https://yt-lingo-server.onrender.com`）

然后更新 workflow 的构建步骤读取这个变量（`.github/workflows/build-extension.yml` 的 Build 步骤加 `env: YT_LINGO_API_BASE: ${{ vars.YT_LINGO_API_BASE }}`）。
之后每次打 tag（`git tag v0.1.0 && git push origin v0.1.0`）触发构建，都会把这个地址烤进扩展，用户下载 Release 版即插即用。

> 如果你只是想自己本地测，跳过这步，扩展会默认连 `http://localhost:8787`。

### 🐳 方式二：一键 Docker 自托管

最省事，**任何人 fork 之后一条命令拉起**（后端 + 网站 + 持久化数据卷）。

```bash
git clone https://github.com/gengen-gui/YouTube--Language-learning.git
cd YouTube--Language-learning

# 可选：改 JWT_SECRET（生产必改）
export JWT_SECRET="$(openssl rand -hex 32)"

docker compose up -d --build
# 等待约 30 秒，看到 "yt-lingo-server healthy" 后：
```

- 网站：<http://localhost:8080>
- 后端 API：<http://localhost:8787/api/health>
- 数据存在 Docker volume `ytlingo-server-data`（重启/升级不丢）

停止：`docker compose down`
升级：`docker compose up -d --build`
清空数据：`docker compose down -v`

> **扩展怎么连到自托管后端**：装好扩展后，点图标 → 把 "API server" 改成 `http://localhost:8787`（或你的公网域名）。

### 🛠 方式三：本地源码启动（开发者）

#### 1. 启动后端

```bash
cd server
cp .env.example .env      # 按需修改 JWT_SECRET / PORT
npm install
npm run dev               # 默认 http://localhost:8787
```

#### 2. 启动网站

```bash
cd web
npm install
npm run dev               # http://localhost:5173（已自动代理 /api 到后端）
```

打开 http://localhost:5173 → 注册账号 → 进入「学习」标签粘贴一个 YouTube 链接试试。

#### 3. 安装浏览器扩展

```bash
cd extension
npm install
npm run build             # 产物在 extension/dist/
```

然后在 Chrome：
1. 打开 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择 `extension/dist/` 目录
4. 打开任意 YouTube 视频页，右侧会出现「YT Lingo」字幕面板
5. 点击扩展图标 → 用第 1 步注册的账号登录、选择目标语言
6. 点击面板里的任意句子 → 展开后点「★ Save」收藏（会自动翻译并存到你的生词本）

> 开发时可用 `npm run watch` 自动重新构建。
> 想让本地构建默认连公网后端：`YT_LINGO_API_BASE=https://你的名字.fly.dev npm run build`。

---

## 使用流程

1. 在浏览器扩展或网站登录同一账号。
2. **扩展**：看 YouTube 时右侧字幕面板随视频高亮当前句，点击句子可回放该句或收藏。
3. **网站**：在「学习」粘贴链接学习任意视频；在「生词本」查看所有收藏、切换翻译目标语言、点链接跳回视频原位置复习。

---

## 目标语言

内置：中文（简/繁）、日语、韩语、西班牙语、法语、德语、英语。
在扩展 popup 或网站里随时切换；生词本里每条都能单独重新翻译成其它语言。

---

## 后续可升级方向

- **翻译质量**：把 `server/src/translate.ts` 换成 DeepL / OpenAI / 腾讯翻译（通过环境变量配置 Key，切勿硬编码）。
- **网站端字幕**：由于 YouTube 限制服务器端字幕下载，若要让网站也能稳定抓字幕，可：① 官方 YouTube Data API（需 OAuth，仅能取自己拥有视频的字幕）；② 接入 poToken/visitorData 方案（较复杂）；③ 让扩展把抓到的字幕回传给网站。目前推荐直接用扩展。
- **无字幕视频**：接入 Whisper 等语音识别（ASR）作为兜底。
- **云端部署**：后端换成云数据库 + 部署到云函数/服务器；扩展的 `API server` 地址改成线上域名即可。
- **学习增强**：生词本加复习提醒、单词高亮、导出 Anki 等。

---

## 安全说明

- 密码用 bcrypt 加密存储，接口用 JWT 鉴权，生词本按用户隔离（每次操作校验归属）。
- 生产环境务必修改 `server/.env` 里的 `JWT_SECRET`。
- 翻译/字幕代理只请求 YouTube 与翻译服务等固定外部域名，不访问内网。
