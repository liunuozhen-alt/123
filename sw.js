/* 纯联网版 · 自毁 Service Worker
   目的：彻底关闭离线能力，并清掉已部署机器上残留的旧 SW / 缓存。
   机制：装上即接管 → 激活时清空所有 Cache Storage，然后注销自身 → 页面回到「纯联网」状态。
   说明：厂商 bundle 仍会尝试注册 /sw.js，但本 SW 装上后会立刻自毁，因此不会留下任何离线缓存。 */
self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) 清空所有缓存（旧的离线预缓存 / workbox 缓存一并清掉）
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_e) { }
    // 2) 注销自身，让页面不再被任何 Service Worker 接管
    try { await self.registration.unregister(); } catch (_e) { }
  })());
});
