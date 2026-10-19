# 糯嘰機 doorkicker 6.9.89 — 自用镜像 · Cloudflare Pages 部署说明

## 这套东西是什么
- 冻结的 6.9.89 PWA，入口 `index.html` + `assets/main-DPBOWPC8.css` / `main-*.js`。
- 已做 4 处登录/门控绕过（见 `BYPASS_LOGIN_CHANGES.md`）：厂商域校验恒真、锁定屏关闭、sessionStorage 预置、根相对路径改写。
- 注入 `__NUO_OFFLINE_LAYER__`（内联在 index.html head，module 脚本之前）：**外科手术式拦截**，只把厂商 OTA `assets.nuojiji.app/ota/version.json` 钉在 `{version:'6.9.89'}`（防自动更新/重载/迁移 nag），**其余所有端点全走真实网络**。

## 为什么记忆宫殿 / 此时此刻「一直转圈」
这些数据型 App 全部以一个 `userId` 作为本地数据锚点。它**不是**从 localStorage 读的，而是从 **IndexedDB（`NuojijiStructuredDB`）**：
- `profileUsers` ← `users` 表
- `currentProfileUserId` ← `globalSettings` 表

绕过厂商登录 = 没有 userId 下发 → 两张表为空 → 每个 screen 的 `useEffect` 命中 `if (!userId) return;`，spinner 永不解除。

本镜像的注入层已在 **IndexedDB 直写**：
- `users` 表塞一行 `{ uid: 'mirror_local_xxx', name: 'Mirror' }`
- `globalSettings` 表写入 `nuojiji_current_profile_user_id = 该行 uid`

等待 App 先建好 DB（v820，全表齐全）后，用「无版本号 open」方式写入（不会触发 versionchange 冲突）。App 启动后：
- 记忆宫殿拿到 userId → `getRoomStats()` 正常读 Dexie → **显示「空宫殿」骨架而非卡死**（你还没在这里录入过记忆，这是正确的）
- 之后每录入一条，数据就累积在本地

> 旧版（`doQvQ_doorkicker-main.zip`）是早期单 bundle 构建，记忆宫殿没有 `currentProfileUserId` 严格门控，所以不需要 seed；6.9.89 版本**新增**了 `getRoomStats(userId)` + 严格 gating，才需要这次的 IDB seed。

## 哪些保留、哪些被钉
| 端点 | 行为 | 说明 |
|------|------|------|
| `assets.nuojiji.app/ota/version.json` | 钉为 6.9.89 | 唯一被桩；保持冻结版不自我更新 |
| `*.workers.dev`（MCP hotsearch / 网易云代理 stream / push） | **放行** | 你的 key 正常生效 |
| `pb.nuojiji.app` / `*.supabase.co`（云同步 / auth-refresh） | **放行** | 有会话才同步；无会话自动降级为本地 |
| `upload.nuojiji.app`（附件上传） | **放行** | |
| 三方 AI/媒体（OpenAI/MiniMax/ElevenLabs/DeepL/Bilibili/GitHub…） | **放行** | 全部走真实网络 |

> 想完全离线（连三方 API 也不发）时，把 `offline-layer.js` 里的 `RULES` 加回 `worker/cloud` 规则并重新跑 `inject.js` 即可——默认不这么做，以保住你要的 MCP / 网易云 / 三方功能。

## 目录即部署根
本目录（含 `index.html`、`assets/`、`_headers`、`_redirects`、`_routes.json`、`sw.js`、`manifest.webmanifest`、`_headers` 等）就是 Cloudflare Pages 的 **publish 根**。不要多套一层。

## 方式 A：wrangler（推荐）
```bash
# 安装（一次性）
npm i -g wrangler        # 或 npx wrangler ...

# 登录（首次）
npx wrangler login

# 在【本目录内】执行：上传整个目录为静态资源
cd <这个目录>
npx wrangler pages deploy --project-name doorkicker-mirror
```
Pages 会自动读取根目录的 `_headers` / `_redirects`。产物域名：`https://doorkicker-mirror.pages.dev`（或你取的 `*.pages.dev` 子域）。

## 方式 B：Dashboard 拖拽
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Direct Upload**。
2. 项目名随意（如 `doorkicker-mirror`）。
3. 把本目录打成 zip（见下）或直接拖本目录进去。
4. Deploy → 得到 `https://<project>.pages.dev`。

### 打包 zip（含隐藏文件 .nojekyll）
```bash
# 在「上一层」（即本目录的父目录）执行，保证 zip 顶层就是 index.html 同级
powershell -NoProfile -Command "Compress-Archive -LiteralPath ./* -DestinationPath ../doorkicker-mirror.zip -Force"
```
> ⚠️ zip 顶层必须直接是 `index.html` / `assets/` / `_headers` …，不要多套 `runtime/` 一层，否则 Pages 找不到入口。

## 验证部署
打开 `https://<project>.pages.dev`：
- 无登录门 / 无锁定屏；
- 主屏 + 底部 dock 正常渲染；
- 开发者工具 Network：`version.json` 返回本地钉住值，`*.workers.dev`、`*.supabase.co`、AI 厂商域名**真实发出**（200/带你的 key）。

## 排错
- 白屏/404 子路由：确认 `_redirects` 在根目录且含 `/* /index.html 200`。
- 旧 index.html 缓存导致"回到上一版"：`_headers` 已给 `/`、`/index.html` 设 `no-cache`；硬刷新 `Ctrl+F5` 或 URL 加 `?v=2`。
- OTA 仍弹更新：确认拦截层在 module 脚本之前注入（`index.html` 搜索 `__NUO_OFFLINE_LAYER__` 应存在且位于 `<script type="module">` 上方）。

## 网易云登录二维码获取失败（已修复）
6.9.89 的 `neteaseService-BRiOs1ds.js` 把**所有**网易云调用（QR 登录 key/check/status、搜索、歌曲 URL、歌词、流媒体）统一发到作者公开的 Cloudflare Worker `wispy-frog-4582.wcl20071005.workers.dev` 作为 CORS 代理（`music.163.com` 不发 CORS 头，浏览器直连会被拦）。该 worker 已**不可达**（DNS 解析到非 CF IP、TCP 连接超时），旧版 `wcl20091007.workers.dev` 也已失效 → 这就是「获取登录二维码失败」的根因。

已做两处改动：
1. `runtime/assets/neteaseService-BRiOs1ds.js` — 把 3 处写死的死 worker 基址改为可覆盖：
   - 模块加载时读 `window.__NUO_NETEASE_PROXY` 或 `localStorage.nuoNeteaseProxy`，都没有才回落到原死 worker（行为不变，纯兼容）。
   - 控制台会打印一行 `[NuoMirror] NetEase proxy base = <实际地址>`，可在 DevTools 确认当前用的哪个。
2. `offline-layer.js`（已注入 `index.html`）— 提供 `NETEASE_PROXY_BASE` 变量（默认空串 = 回落到原死 worker）。填上你自己的 worker URL 后：
   - 启动时写入 `window.__NUO_NETEASE_PROXY` + `localStorage.nuoNeteaseProxy`
   - 无需重新下载 App，改一个变量、重新注入、硬刷新即可。

### 部署你自己的网易云代理 Worker
1. `runtime/netease-proxy-worker.js` 是可直接部署的 Cloudflare Worker 源码，实现了 App 期望的路由契约（`/login/qr/key`、`/login/qr/check`、`/login/status`、`/search`、`/song/detail`、`/song/url`、`/lyric`、`/user/playlist`、`/playlist/detail`、`/personalized/newsong`、`/stream?url=`）并转发到 `music.163.com` 的 `/weapi`/`/eapi`。
2. 在你的 Cloudflare 账号里部署：
   ```bash
   npx wrangler deploy netease-proxy-worker.js   # 生成 https://<name>-<you>.workers.dev
   ```
   或 Dashboard → Workers → Create → Upload 拖进去。
3. 把 worker URL 填进 `offline-layer.js` 的 `NETEASE_PROXY_BASE`（或在浏览器控制台跑一次 `localStorage.setItem('nuoNeteaseProxy','https://<your-worker>')` 然后 `location.reload()`）。
4. 打开 App → 网易云 → 点「登录」，此时「获取登录二维码」应能成功；扫码后 cookie 会写进本地 `neteaseMusicCookie`，后续搜索/播放/歌单都走你自己 worker。

> **注意**：网易云 API 偶尔会加签或改路由，如果某个子路由 403/401，单独调整 `netease-proxy-worker.js` 里对应的 `ROUTES` 项；或者把 [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapi/NeteaseCloudMusicApi) 的 `server.js` 逻辑嵌进你的 Worker（路由映射保持不变，只换后端转发目标即可，App 端无需再改）。

## 安全提醒
- 这是**单用户自用镜像**，勿公开发布：它绕过厂商登录/域校验，并保留对 `pb.nuojiji.app`、`*.supabase.co`、`*.workers.dev` 的直连（里面带你的 API key）。
- 你的三方 key 存在浏览器 localStorage（`nuo.*` 前缀），请只在信任的设备上登录。
- 镜像不含厂商源码，所有补丁/拦截层为原创；勿再转发厂商原始 bundle。
