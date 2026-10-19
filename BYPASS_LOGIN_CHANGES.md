# Nuojiji 6.9.89 reference-mirror access patch

This repository is a frozen static reference extracted from the official Android OTA package `6.9.89` on 2026-10-01 for UI/DOM/CSS archaeology.

The original package SHA-256 was verified before patching:

`4a1c765ff77a06f5bdff8e94aafa30451ca512ea73b1797e56d18d1561b9d47b`

Only reference-access gates are changed:

1. `assets/main-BDB-lJFa.js`: the top-level app gate is forced to the normal main-app branch (`k8L/k8H/k8t/k8b=false`, `k8P=true`) so the vendor QQ/Discord account page is not required for visual inspection.
2. `assets/main-BDB-lJFa.js`: `Xhe(hostname)` returns true so the vendor domain guard does not replace this mirror with its warning page.
3. `index.html`: before the module loads, lock-screen/password flags are disabled and `sessionStorage.unlocked=true` is seeded for reference browsing.
4. `index.html`: entry `assets/` URLs are project-relative so the build can run under a GitHub Pages repository subpath.

No application feature code is intentionally rewritten. Server-backed sync/account/payment/community functions may fail because this mirror has no vendor session; local/offline UI is the purpose of the deployment.

## GitHub Pages static-runtime patch (2026-10-01)

The vendor build was produced with a root `/` public base. GitHub Pages serves this mirror below `/doQvQ_doorkicker_6.9.89/`, so root-relative static asset references otherwise resolve to `https://mothonthe.github.io/assets/...` and trigger the vendor chunk-update recovery screen.

For this static reference mirror only:

- root `/assets/...` references are rewritten to `/doQvQ_doorkicker_6.9.89/assets/...`;
- root media/manifest references are rewritten to the repository Pages prefix;
- PWA/Service Worker registration is disabled and old registrations/caches are cleared on boot;
- stale `nuojiji_ota_pending` is cleared;
- the vendor 15-second stuck-diagnostic overlay is suppressed in reference-mirror mode.

These changes do not alter Home product behavior; they only make the frozen 6.9.89 reference bundle stable under a GitHub Pages project subpath.

## Boot-gate stabilization (2026-10-01)

The mirror now also clears stale boot/recovery flags inherited from other `mothonthe.github.io` Nuojiji test deployments, seeds the upstream adult-confirmation flag, and releases the decorative boot overlay once the React tree exists. This prevents old restore/watchdog state from leaving the reference mirror parked forever on the pixel splash.

## Boot-overlay fix (2026-10-01)

The vendor pixel/lock-screen boot scene is decorative and normally removed by the authenticated app-ready lifecycle. In the static archaeology mirror that lifecycle can remain incomplete even after React/NoOS has rendered underneath, leaving the mirror apparently stuck on `今天也要和他聊聊天吗？`. The mirror now clears stale restore/recovery flags, pre-confirms the age gate for reference browsing, and removes the boot overlay after the real React/NoOS tree mounts.

## Vite lazy-dependency base patch

Vite's generated dependency maps contain quoted `assets/...` entries. In the vendor build those are resolved against the configured site root and therefore still escaped a GitHub Pages project subpath even after direct `/assets/...` strings were repaired. The reference mirror rewrites these generated static dependency-map literals to `/doQvQ_doorkicker_6.9.89/assets/...`. A case-compatibility alias is also retained for `badgeService-DXgm43Dv.js` because an earlier Chromium recovery trace requested that casing while the OTA filename is `badgeService-DXGm43Dv.js`.

## Vite lazy-dependency base patch

Vite's generated dependency maps contain quoted `assets/...` entries. In the vendor root deployment those are resolved from `/`; on GitHub Pages that escaped the project path and produced chunk requests under `https://mothonthe.github.io/assets/...`. The reference mirror rewrites those generated static dependency-map literals to `/doQvQ_doorkicker_6.9.89/assets/...`.

A case-compatibility alias `assets/badgeService-DXgm43Dv.js` is also retained because one Chromium recovery trace requested that spelling while the OTA filename is `badgeService-DXGm43Dv.js`. This alias is mirror-only.

## Root-scope stale Service Worker fix (2026-10-01)

A previously installed `mothonthe.github.io` root-scope Service Worker could still control the repository page and rewrite/fetch old root `/assets/...` URLs before the mirror's late cleanup script ran. The entry module is now loaded dynamically only after unregistering all Service Workers and clearing Cache Storage. If the page was already controlled, the mirror performs one controlled reload after unregistering, then imports the 6.9.89 entry from the repository-prefixed path. Modulepreload links were removed so stale controllers cannot prefetch old chunks first.
