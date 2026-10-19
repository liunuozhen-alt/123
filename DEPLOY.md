# 糯嘰機 doorkicker 6.9.89 — 自用镜像 · Cloudflare Pages 部署说明

## 这套东西是什么
- 冻结的 6.9.89 PWA，入口 `index.html` + `assets/main-DPBOWPC8.css` / `main-*.js`。
- 已做 4 处登录/门控绕过（见 `BYPASS_LOGIN_CHANGES.md`）：厂商域校验恒真、锁定屏关闭、sessionStorage 预置、根相对路径改写。
- 注入 `__NUO_OFFLINE_LAYER__`（内联在 index.html head，module 脚本之前）：**外科手术式拦截**，只把厂商 OTA `assets.nuojiji.app/ota/version.json` 钉在 `{version:'6.9.89'}`（防自动更新/重载/迁移 nag），**其余所有端点全走真实网络**。

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

## 安全提醒
- 这是**单用户自用镜像**，勿公开发布：它绕过厂商登录/域校验，并保留对 `pb.nuojiji.app`、`*.supabase.co`、`*.workers.dev` 的直连（里面带你的 API key）。
- 你的三方 key 存在浏览器 localStorage（`nuo.*` 前缀），请只在信任的设备上登录。
- 镜像不含厂商源码，所有补丁/拦截层为原创；勿再转发厂商原始 bundle。
