import { UrlUtils_build } from "./utils/url";

declare let __COMMIT_HASH__: string;
declare let __ASSET_BASE__: string;

const cacheName = `mario-lift-${__COMMIT_HASH__}`;
const base = __ASSET_BASE__;

const filesToCache: Array<string | RegExp> = [
  `${base}/app.css?version=${__COMMIT_HASH__}`,
  `${base}/app.js?version=${__COMMIT_HASH__}`,
  `${base}/vendors.js?vendor=${__COMMIT_HASH__}`,
  `${base}/images/back-muscles.svg`,
  `${base}/images/front-muscles.svg`,
  `${base}/images/svgs/muscles-combined.svg`,
  /\/fonts\/.*/,
  `${base}/index.html`,
  `${base}/app/`,
  `${base}/app/index.html`,
  `${base}/icons/icon192.png`,
  `${base}/icons/icon512.png`,
  `${base}/manifest.json`,
  `${base}/notification.m4r`,
];

function shellPathnames(): string[] {
  return ["/", "/index.html", "/app", "/app/", "/app/index.html"].map((path) =>
    path === "/" ? `${base}/` : `${base}${path}`
  );
}

function isShellPath(pathname: string): boolean {
  return pathname === "index.html" || shellPathnames().includes(pathname);
}

function shellIndexUrl(): string {
  return `${self.location.origin}${base}/app/index.html`;
}

async function cacheRequest(request: Request, response: Response): Promise<Response> {
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function matchShell(request: Request): Promise<Response | undefined> {
  const direct = await caches.match(request, { ignoreSearch: true });
  if (direct) {
    return direct;
  }
  const index = await caches.match(shellIndexUrl());
  return index || undefined;
}

function shouldStore(url: URL): boolean {
  const pathAndSearch = `${url.pathname}${url.search}`;
  return filesToCache.some((entry) => {
    if (typeof entry === "string") {
      return pathAndSearch === entry || url.pathname === entry;
    }
    return entry.test(pathAndSearch);
  });
}

function initialize(service: ServiceWorkerGlobalScope): void {
  service.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(cacheName);
        const urls = filesToCache.filter((entry): entry is string => typeof entry === "string");
        await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
        await service.skipWaiting();
      })()
    );
  });

  service.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = (await caches.keys()).filter((key) => key !== cacheName);
        await Promise.all(keys.map((key) => caches.delete(key)));
        await service.clients.claim();
      })()
    );
  });

  service.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
      return;
    }
    const url = UrlUtils_build(event.request.url);
    if (url.origin !== self.location.origin) {
      return;
    }
    if (isShellPath(url.pathname)) {
      event.respondWith(networkFirstShell(event.request));
      return;
    }
    event.respondWith(cacheFirstAsset(event.request, url));
  });
}

async function networkFirstShell(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cached = await cacheRequest(request, response.clone());
      const path = UrlUtils_build(request.url).pathname;
      if (path.endsWith("/app/index.html") || path.endsWith("/app/") || path.endsWith("/app")) {
        const cache = await caches.open(cacheName);
        await cache.put(shellIndexUrl(), response.clone());
      }
      return cached;
    }
    const fallback = await matchShell(request);
    return fallback || response;
  } catch {
    const fallback = await matchShell(request);
    if (fallback) {
      return fallback;
    }
    return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

async function cacheFirstAsset(request: Request, url: URL): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok && shouldStore(url)) {
    return cacheRequest(request, response);
  }
  return response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
initialize(self as any);
