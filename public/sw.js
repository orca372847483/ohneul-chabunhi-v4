// 앱 껍데기만 캐시(오프라인에서도 자료함·필기 사용). /api/* 와 PDF 는 캐시하지 않는다.
const V = 'ohneul-v4-1';
const SHELL = ['/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/icon.svg', '/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // JS/CSS/HTML: 네트워크 우선(수정이 바로 반영) → 실패하면 캐시. 글꼴·cMap 등 vendor 는 캐시 우선.
  const vendor = u.pathname.startsWith('/vendor/');
  e.respondWith((async () => {
    const c = await caches.open(V);
    if (vendor) { const hit = await c.match(e.request); if (hit) return hit; }
    try { const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }
    catch { const hit = await c.match(e.request) || (e.request.mode === 'navigate' ? await c.match('/index.html') : null); if (hit) return hit; throw new Error('offline'); }
  })());
});
