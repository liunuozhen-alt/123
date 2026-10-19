// Custom Service Worker Handlers
// Injected via Workbox importScripts

// 🔧 允許客戶端在 chunk 加載失敗時強制激活新 SW
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting()
    }
})

// 🧪 坏 index 自救毒丸
// 場景：CF Pages 還在 build 中時，東京鏡像 GitHub Action 抓了上一版 index.html
// （引用上一版的 chunk hash）→ rsync 到東京 → 大陸用戶從東京拿到「舊 index」
// → SW 用 NetworkFirst 把這份舊 index 緩存了 30 分鐘 → 期間用戶每次打開都拿坏 index
// → 引用的 main-XXX.js 在線上實際已被新 build 覆蓋為 404 → handleChunkLoadFailure
// 反覆 reload，SW 又給同樣的舊 index → 死循環。
//
// 自救策略：偵測到 /assets/main-*.js（或 /assets/vendor-react-*.js）回 404 →
//   1. 清掉所有 caches（包含 workbox 的 pages-cache 裡的舊 index）
//   2. unregister 自己
//   3. 通知客戶端 hard reload（main.jsx 的 hardReload 會帶 ?__nuojiji_reload=ts 繞瀏覽器 HTTP cache）
// 下一次刷新就走原生網路拿最新 index + 最新 hash，徹底脫困。
const POISON_ENTRY_PATTERN = /^\/assets\/(main|vendor-react|vendor-supabase|vendor-dexie)-[A-Za-z0-9_-]{6,}\.js$/

let poisonTriggered = false

const triggerPoisonPill = async (reason) => {
    if (poisonTriggered) return
    poisonTriggered = true
    console.error('[SW] 偵測到坏 index 引用了不存在的核心 chunk：', reason)
    try {
        if ('caches' in self) {
            const names = await caches.keys()
            await Promise.all(names.map(n => caches.delete(n)))
            console.warn('[SW] 已清空所有 caches')
        }
    } catch (e) {
        console.warn('[SW] 清 caches 失敗:', e?.message)
    }
    try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        clientList.forEach(client => {
            try {
                client.postMessage({ type: 'POISON_PILL_HARD_RELOAD', reason })
            } catch (_) {}
        })
    } catch (e) {
        console.warn('[SW] 通知客戶端失敗:', e?.message)
    }
    try {
        await self.registration.unregister()
        console.warn('[SW] 已 unregister 自己')
    } catch (e) {
        console.warn('[SW] unregister 失敗:', e?.message)
    }
}

// ============ /assets/* 兩層 fallback：cache → network ============
// 之前還有第三層 R2 fallback，已移除：
//   原因 1：edge-router Worker 已對大陸用戶做東京加速 + CF Pages 404 fallback，
//          /assets/* 在 Worker 層幾乎不會 404，R2 兜底已冗餘。
//   原因 2：SW 從 /r2-fallback/* 拿到 chunk 後，即使重新包裝 Response，
//          某些瀏覽器（Android Chromium 系如 Edge）仍可能把 module URL 認成 r2-fallback，
//          導致同一份 React 以兩個 URL 進 module registry → 雙實例 → useMemo null 崩潰。
//   結論：少一層 = 少一個 bug 來源。chunk 真的拿不到時，由 main.jsx 的
//        handleChunkLoadFailure 走 clean reload，比 R2 fallback 更可靠。
//
// 註冊順序：importScripts 先於 workbox 自身的 fetch handler，本 handler 先接管。
self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.method !== 'GET') return

    let url
    try {
        url = new URL(request.url)
    } catch (_e) {
        return
    }

    if (url.origin !== self.location.origin) return
    if (!url.pathname.startsWith('/assets/')) return

    // 🔧 強制刷新模式（main.jsx 的 hardReload(true) 會在主 URL 加 ?__nuojiji_reload=<ts>）
    // 這代表用戶剛因 chunk 錯誤 / React 雙實例觸發了清緩存重載，
    // 此時必須繞過 Cache Storage 和瀏覽器 HTTP cache，從 network 重新取乾淨資源
    let bypassCacheForReload = false
    try {
        const referrer = request.referrer || ''
        if (referrer.includes('__nuojiji_reload=')) {
            bypassCacheForReload = true
        }
    } catch (_e) {}

    event.respondWith((async () => {
        // 1) 先試 cache（含 workbox 預緩存的 hash 化檔案）
        // 強制刷新模式跳過，避免拿到污染的舊緩存
        if (!bypassCacheForReload) {
            try {
                const cached = await caches.match(request)
                if (cached) return cached
            } catch (_e) {
                // cache API 異常 → 繼續嘗試網路
            }
        }

        // 2) 走網路（Worker 攔截 → 東京 / fallback CF Pages）
        // 強制刷新模式：用 cache: 'reload' 強制繞過瀏覽器 HTTP cache
        const fetchOpts = bypassCacheForReload ? { cache: 'reload' } : undefined
        const response = await (fetchOpts ? fetch(request, fetchOpts) : fetch(request))

        // 🧪 自救：核心 entry chunk 拿到 404 = 緩存的舊 index 引用了已不存在的 hash
        // 任何來源（東京/CF Pages/直連）都會被 Worker 兜到同一張 404，無法 fallback 救回
        // → 觸發毒丸，讓客戶端走 hard reload 拿最新 index
        if (response.status === 404 && POISON_ENTRY_PATTERN.test(url.pathname)) {
            // 不 await — 讓 404 response 先回給瀏覽器（瀏覽器會丟 chunk-load-error
            // 觸發 handleChunkLoadFailure），毒丸在背景並行執行，下次 reload 就乾淨了
            triggerPoisonPill(`404 on ${url.pathname}`)
        }
        return response
    })())
})

function buildNotificationTargetUrl({ charId, userId, groupId, screen }) {
    const scopeUrl = new URL(self.registration?.scope || '/', self.location.origin);

    if (screen) {
        scopeUrl.searchParams.set('openScreen', screen);
        if (charId) scopeUrl.searchParams.set('openChat', String(charId));
        if (userId) scopeUrl.searchParams.set('openChatUser', String(userId));
    } else if (groupId) {
        scopeUrl.searchParams.set('openGroup', String(groupId));
        if (userId) {
            scopeUrl.searchParams.set('openGroupUser', String(userId));
        }
    } else if (charId) {
        scopeUrl.searchParams.set('openChat', String(charId));
        if (userId) {
            scopeUrl.searchParams.set('openChatUser', String(userId));
        }
    }

    return scopeUrl;
}

function isAppWindow(client) {
    try {
        const clientUrl = new URL(client.url);
        const scopeUrl = new URL(self.registration?.scope || '/', self.location.origin);
        return clientUrl.origin === scopeUrl.origin && clientUrl.pathname.startsWith(scopeUrl.pathname);
    } catch (_error) {
        return true;
    }
}

async function focusAndDispatch(client, payload) {
    try {
        await client.focus();
    } catch (_error) {
        // Ignore focus failures and still try to dispatch the open request.
    }

    // Worker 產生的消息 → 通知客戶端同步
    if (payload.fromWorker) {
        client.postMessage({ type: 'SYNC_WORKER_MESSAGES', userId: payload.userId, messageId: payload.messageId });
    }

    if (payload.screen) {
        client.postMessage({ type: 'OPEN_SCREEN', screen: payload.screen, charId: payload.charId, userId: payload.userId });
    } else if (payload.groupId) {
        client.postMessage({ type: 'OPEN_GROUP_CHAT', groupId: payload.groupId, userId: payload.userId });
    } else if (payload.charId) {
        client.postMessage({ type: 'OPEN_CHAT', charId: payload.charId, userId: payload.userId });
    }
}

// Handle notification click: focus app and open the correct chat
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const charId = event.notification.data?.charId;
    const userId = event.notification.data?.userId;
    const groupId = event.notification.data?.groupId;
    const screen = event.notification.data?.screen;
    const fromWorker = event.notification.data?.fromWorker;
    const messageId = event.notification.data?.messageId;
    const targetUrl = buildNotificationTargetUrl({ charId, userId, groupId, screen });

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
            const appClients = clientList.filter(isAppWindow);
            const visibleClient = appClients.find(client => client.visibilityState === 'visible' || client.focused);

            if (visibleClient) {
                await focusAndDispatch(visibleClient, { charId, userId, groupId, screen, fromWorker, messageId });
                return;
            }

            const hiddenClient = appClients[0];
            if (hiddenClient) {
                // 先嘗試 focus — 若 client 已被系統回收（Android 低記憶體），focus 會拋錯
                let focusSucceeded = false;
                try {
                    await hiddenClient.focus();
                    focusSucceeded = true;
                } catch (_error) {
                    // client 已死，後續 fall through 到 openWindow
                }

                if (focusSucceeded) {
                    // Worker 產生的消息 → 通知客戶端同步
                    if (fromWorker) {
                        hiddenClient.postMessage({ type: 'SYNC_WORKER_MESSAGES', userId, messageId });
                    }
                    // client 還活著，直接 postMessage 讓 SPA 內部導航（避免 navigate 整頁重載）
                    if (screen) {
                        hiddenClient.postMessage({ type: 'OPEN_SCREEN', screen, charId, userId });
                    } else if (groupId) {
                        hiddenClient.postMessage({ type: 'OPEN_GROUP_CHAT', groupId, userId });
                    } else if (charId) {
                        hiddenClient.postMessage({ type: 'OPEN_CHAT', charId, userId });
                    }
                    return;
                }
                // focus 失敗 → client 已死，fall through 到 openWindow
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl.href);
            }
        })
    );
});

// Handle incoming Web Push events from Cloudflare Worker
self.addEventListener('push', (event) => {
    console.log('[SW push] 收到推送事件', event.data ? '有 payload' : '無 payload');

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_e) {
        data = { title: '糯嘰機', body: event.data?.text() || '新消息' };
    }

    console.log('[SW push] payload:', JSON.stringify(data).substring(0, 200));

    const isAlarm = !!data.alarmId;
    const title = data.title || '糯嘰機';
    const options = {
        body: data.body || '新消息',
        icon: data.avatar || '/pwa-512x512.png',
        badge: '/pwa-512x512.png',
        tag: isAlarm ? `alarm-${data.alarmId}` : `worker-${Date.now()}`,
        vibrate: [200, 100, 200],
        // 鬧鐘通知不自動消失，需要用戶手動關閉
        requireInteraction: isAlarm,
        data: {
            charId: data.charId,
            userId: data.userId,
            messageId: data.messageId,
            groupId: data.groupId,
            fromWorker: true,
        },
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
            .then(() => console.log('[SW push] showNotification 成功:', title))
            .catch((err) => {
                console.error('[SW push] showNotification 失敗:', err);
                // 最後手段：顯示一個最簡單的通知，確保用戶至少看到東西
                return self.registration.showNotification('糯嘰機', { body: data.body || '新消息' });
            })
    );
});

// 訂閱過期/刷新時，自動向 Worker 註冊新的訂閱
self.addEventListener('pushsubscriptionchange', (event) => {
    console.log('[SW] pushsubscriptionchange 觸發');

    event.waitUntil((async () => {
        try {
            const newSub = await self.registration.pushManager.subscribe(
                event.oldSubscription.options
            );
            console.log('[SW] 新訂閱已建立:', newSub.endpoint.substring(0, 60));

            // 將 ArrayBuffer 轉為 base64url 字串
            function toBase64url(buffer) {
                return btoa(String.fromCharCode(...new Uint8Array(buffer)))
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            }

            const res = await fetch('/api/push/resubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    oldEndpoint: event.oldSubscription.endpoint,
                    newSubscription: {
                        endpoint: newSub.endpoint,
                        keys: {
                            p256dh: toBase64url(newSub.getKey('p256dh')),
                            auth: toBase64url(newSub.getKey('auth')),
                        }
                    }
                }),
            });
            console.log('[SW] 訂閱更新回應:', res.status);
        } catch (err) {
            console.error('[SW] pushsubscriptionchange 處理失敗:', err);
        }
    })());
});

// Handle notification dismiss (optional, for future analytics)
self.addEventListener('notificationclose', (event) => {
    // Currently no-op
});

// ============ Periodic Background Sync ============
// Android Chrome PWA 限定：OS 級別在後台定期喚醒 SW，繞過瀏覽器 timer throttle。
// 觸發時做兩件事：
//   1. ping 自家 API 維持連線（讓 Worker 知道用戶還活著）
//   2. 通知所有開著的 client 重新確認保活媒體狀態（被 OS pause 掉就 resume）
// iOS / 桌面瀏覽器不支援此 API，會 silently fallback 到原本機制（媒體保活 + Worker 心跳）。
self.addEventListener('periodicsync', (event) => {
    if (event.tag !== 'nuojiji-keepalive') return;
    event.waitUntil((async () => {
        // 1) Ping 連線
        try {
            await fetch('/api/ping', { method: 'POST', keepalive: true, body: '' });
        } catch (_e) {}
        // 2) 通知所有 client 重啟保活媒體
        try {
            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            clientList.forEach(client => {
                try {
                    client.postMessage({ type: 'PERIODIC_SYNC_TICK', tag: event.tag, timestamp: Date.now() });
                } catch (_) {}
            });
        } catch (_e) {}
    })());
});
