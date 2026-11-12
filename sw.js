/* 会議録音・議事録作成ツール：通信が遅い・つながらないときでも開けるようにする仕組み（Service Worker）
   ・画面は毎回まず最新版を取りに行く（4秒以内に届けば最新版を表示）
   ・届かないときだけ、端末に控えておいた前回の画面を表示する
   ・録音データやスプシとの通信には関与しない */
const CACHE = 'recorder-v2';
const FILES = /\/(index\.html|manifest\.json|icon-192\.png|icon-512\.png)?$/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);   // 古い控えは削除
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (req.cache === 'no-store' || req.cache === 'reload') return;
  const scope = new URL(self.registration.scope).pathname;
  if (!u.pathname.startsWith(scope)) return;
  let path = u.pathname.slice(scope.length - 1);
  if (path === '/') path = '/index.html';
  if (!FILES.test(path)) return;
  const key = scope + path.slice(1);
  e.respondWith(caches.open(CACHE).then(async c => {
    const net = fetch(req.url, { cache: 'no-store' }).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
    const timeout = new Promise(res => setTimeout(res, 4000, null));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (x) { }
    const hit = await c.match(key);
    if (hit) { e.waitUntil(net.catch(() => { })); return hit; }
    return net;   // 控えもない場合は届くまで待つ
  }));
});
