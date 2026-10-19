// netease-proxy-worker.js
// ----------------------
// Self-hosted NetEase Cloud Music proxy for doQvQ_doorkicker 6.9.89.
//
// WHY THIS EXISTS
//   The frozen app (neteaseService-BRiOs1ds.js) hardcodes the author's
//   Cloudflare Worker (wispy-frog-4582.wcl20071005.workers.dev) as the proxy
//   for EVERY NetEase call (QR login, search, song URL, stream, lyric).
//   Browser → music.163.com direct calls are blocked by CORS, so a proxy is
//   required. That author worker is no longer reachable (DNS / suspended),
//   which is exactly why "获取登陆二维码失败".
//
//   This file is a drop-in replacement you deploy to YOUR OWN Cloudflare
//   Workers account. After deploying, point the app at it via:
//       localStorage.nuoNeteaseProxy = 'https://<your-worker>.<you>.workers.dev'
//   (or set window.__NUO_NETEASE_PROXY in index.html before the module script).
//   The patched neteaseService reads it automatically — no re-download needed.
//
// DEPLOY
//   1) wrangler login
//   2) wrangler deploy netease-proxy-worker.js      (creates <random>.workers.dev)
//   3) set localStorage.nuoNeteaseProxy to the resulting URL (once, in browser)
//
// NOTE ON API MAPPING
//   The paths below are the app's expected proxy contract (/login/qr/key,
//   /login/qr/check, /search, ...). They are forwarded to NetEase's web API
//   (/weapi/*, /eapi/*). NetEase periodically changes these endpoints and may
//   add signing; if an individual route returns 403/401, adjust that one
//   mapping (or adopt the open-source NeteaseCloudMusicApi project which
//   keeps those in sync). QR login (create/check) is implemented to match the
//   app's expected response shape ({unikey} / {unikey,cookie}).

const NET = "https://music.163.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cookie, X-Requested-With, Origin",
  "Access-Control-Max-Age": "86400",
};

// app-path -> netease route + how to build the request
//   p     : netease path under /weapi or /eapi
//   method: GET/POST
//   q(key): pull from incoming query
//   b(key): pull from incoming JSON body (POST)
const ROUTES = [
  // --- QR login (core of the user's failing flow) ---
  {
    app: "/login/qr/key",
    p: "/weapi/login/qr/create",
    m: "POST",
    body: () => ({ type: 1 }),
  },
  {
    app: "/login/qr/check",
    p: "/weapi/login/qr/check",
    m: "POST",
    body: (u, b) => ({
      key: u.get("key"),
      qrtype: 1,
      rememberLogin: false,
    }),
  },
  {
    app: "/login/status",
    p: "/eapi/wrapper/get/userinfo",
    m: "POST",
    body: () => ({ e: "" }),
  },
  // --- music content ---
  { app: "/search", p: "/weapi/search/get", m: "POST", body: (u, b) => ({ s: u.get("keywords"), type: 1, limit: +u.get("limit") || 20, offset: +u.get("offset") || 0 }) },
  { app: "/song/detail", p: "/weapi/song/detail", m: "POST", body: (u) => ({ songIds: (u.get("ids") || "").split(",").filter(Boolean).map(Number) }) },
  { app: "/song/url", p: "/weapi/song/url", m: "POST", body: (u) => ({ id: u.get("id"), br: +u.get("br") || 320000 }) },
  { app: "/lyric", p: "/weapi/lyric", m: "POST", body: (u) => ({ id: u.get("id"), lc: 0, m: 0, t: 0 }) },
  { app: "/user/playlist", p: "/weapi/user/playlist", m: "GET", q: (u) => ({ uid: u.get("uid"), limit: u.get("limit") }) },
  { app: "/personalized/newsong", p: "/weapi/personalized/newsong", m: "GET" },
  { app: "/playlist/detail", p: "/weapi/playlist/detail", m: "GET", q: (u) => ({ id: u.get("id"), limit: u.get("limit") }) },
];

// Stream: proxy 126.net audio bytes with permissive CORS so <audio> can play.
async function streamAudio(u) {
  const target = u.get("url");
  if (!target) return new Response("missing url", { status: 400, headers: CORS });
  const res = await fetch(target, {
    headers: { Referer: "https://music.163.com/" },
    cf: { cacheTtl: 3600 },
  });
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    headers: { ...CORS, "content-type": "audio/mpeg", "cache-control": "public, max-age=3600" },
  });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // audio stream
    if (u.pathname === "/stream") return streamAudio(u);

    // cookie forwarded by the app (from its localStorage) — attach it
    const cookie = u.searchParams.get("cookie");

    for (const r of ROUTES) {
      if (u.pathname !== r.app) continue;
      const headers = { ...CORS, "content-type": "application/json", Referer: "https://music.163.com/" };
      if (cookie) headers["cookie"] = cookie;

      // QR routes must NEVER be cached at the edge or by the browser, otherwise
      // a stale unikey is reused and the app sees an "instant-expired" QR.
      const noCache = r.app === "/login/qr/key" || r.app === "/login/qr/check";
      let out;
      if (r.m === "GET") {
        const qs = r.q ? new URLSearchParams(r.q(u)).toString() : "";
        const full = NET + r.p + (qs ? "?" + qs : "");
        out = await fetch(full, { headers, cf: noCache ? { cacheTtl: 0, noStore: true } : { cacheTtl: 300 } });
      } else {
        let body = {};
        try { body = await req.clone().json(); } catch (_) {}
        const payload = r.body ? r.body(u, body) : {};
        out = await fetch(NET + r.p, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(payload),
          cf: noCache ? { cacheTtl: 0, noStore: true } : undefined,
        });
      }
      const text = await out.text();
      const respHeaders = { ...CORS, "content-type": out.headers.get("content-type") || "application/json" };
      if (noCache) respHeaders["cache-control"] = "no-store, max-age=0";
      return new Response(text, { status: out.ok ? 200 : out.status, headers: respHeaders });
    }

    // Fallback: unknown app path → forward as /weapi passthrough
    const full = NET + "/weapi" + u.pathname + "?" + u.search;
    const res = await fetch(full, {
      headers: { ...CORS, Referer: "https://music.163.com/" },
      cf: { cacheTtl: 60 },
    });
    const t = await res.text();
    return new Response(t, { status: res.ok ? 200 : res.status, headers: { ...CORS, "content-type": "application/json" } });
  },
};
