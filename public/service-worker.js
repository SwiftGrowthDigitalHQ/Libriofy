const VERSION = "2026-03-31-01";
const CORE_CACHE = `libriofy-core-${VERSION}`;
const PAGE_CACHE = `libriofy-pages-${VERSION}`;
const ASSET_CACHE = `libriofy-assets-${VERSION}`;
const LAST_VISITED_PAGE_KEY = "/__libriofy_last_visited__";

const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.replace(/\/$/, "");
const buildAppUrl = (path) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const fullPath = `${scopePath}${normalizedPath}`.replace(/\/{2,}/g, "/");
  return fullPath || "/";
};

const OFFLINE_FALLBACK_URL = buildAppUrl("/offline.html");
const SCAN_URL = buildAppUrl("/scan");
const DASHBOARD_URL = buildAppUrl("/dashboard");
const AUTH_URL = buildAppUrl("/auth");
const HOME_URL = buildAppUrl("/");
const PRECACHE_URLS = [
  HOME_URL,
  SCAN_URL,
  AUTH_URL,
  DASHBOARD_URL,
  OFFLINE_FALLBACK_URL,
  buildAppUrl("/manifest.webmanifest"),
  buildAppUrl("/scan-manifest.webmanifest"),
  buildAppUrl("/favicon.svg"),
  buildAppUrl("/icons/pwa-192x192.png"),
  buildAppUrl("/icons/pwa-512x512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith("libriofy-") && ![CORE_CACHE, PAGE_CACHE, ASSET_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (["style", "script", "worker", "font", "image"].includes(request.destination)) {
    event.respondWith(handleStaticAssetRequest(event, request));
  }
});

async function handleNavigationRequest(request) {
  const pageCache = await caches.open(PAGE_CACHE);
  const requestUrl = new URL(request.url);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await pageCache.put(request, networkResponse.clone());
      await pageCache.put(LAST_VISITED_PAGE_KEY, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedPage = await pageCache.match(request);
    if (cachedPage) {
      return cachedPage;
    }

    if (requestUrl.pathname.startsWith(SCAN_URL)) {
      const scanShell = await caches.match(SCAN_URL);
      if (scanShell) {
        return scanShell;
      }
    }

    const lastVisitedPage = await pageCache.match(LAST_VISITED_PAGE_KEY);
    if (lastVisitedPage) {
      return lastVisitedPage;
    }

    const dashboardShell = await caches.match(DASHBOARD_URL);
    if (dashboardShell) {
      return dashboardShell;
    }

    const authShell = await caches.match(AUTH_URL);
    if (authShell) {
      return authShell;
    }

    const homeShell = await caches.match(HOME_URL);
    if (homeShell) {
      return homeShell;
    }

    return (
      (await caches.match(OFFLINE_FALLBACK_URL)) ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function handleStaticAssetRequest(event, request) {
  const assetCache = await caches.open(ASSET_CACHE);
  const cachedResponse = await assetCache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        assetCache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkFetch);
    return cachedResponse;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) {
    return networkResponse;
  }

  return Response.error();
}
