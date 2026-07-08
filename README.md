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

## 快速开始

> 需要 Node.js 18+（后端翻译用到了全局 `fetch`）。

### 🐳 方式一：一键 Docker 自托管（推荐）

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

### 🛠 方式二：本地源码启动（开发者）

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

### 📦 方式三：只装扩展，用现成后端

到 [GitHub Releases](https://github.com/gengen-gui/YouTube--Language-learning/releases) 下载最新的 `YT-Lingo-Extension.zip`：
1. 解压
2. `chrome://extensions/` → 开启开发者模式 → 加载已解压扩展 → 选解压目录
3. 装好后在扩展 popup 里把 "API server" 改成你部署的公网后端地址

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
