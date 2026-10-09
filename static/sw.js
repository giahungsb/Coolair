/* CoolAir service worker: (1) cache vỏ ứng dụng để mở nhanh + có trang báo mất mạng, (2) nhận & hiển thị thông báo đẩy.
   KHÔNG bao giờ cache /api/* (dữ liệu luôn lấy mới). Đổi số phiên bản V khi muốn buộc mọi máy tải lại tài nguyên tĩnh. */
const V = 'coolair-v3';
const STATIC = ['/neo.css', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/img/nologo.jpg'];
const OFFLINE = '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoolAir – Mất kết nối</title>'
  + '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fff;color:#333;text-align:center"><div style="padding:24px">'
  + '<div style="font-size:48px">☁️</div><h2>Không có kết nối mạng</h2><p style="color:#777">Hãy kiểm tra Wi-Fi / 4G rồi thử lại.</p>'
  + '<button onclick="location.reload()" style="padding:10px 18px;border:0;border-radius:6px;background:#E85D00;color:#fff;font-size:15px">Thử lại</button></div></body></html>';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(STATIC.concat(['/']).map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/sw.js') return;   // để trình duyệt tự xử lý
  if (r.mode === 'navigate') {   // trang: ưu tiên mạng (luôn bản mới sau mỗi lần deploy), mất mạng thì dùng bản đã lưu
    e.respondWith(fetch(r).then((res) => { if (res.ok) caches.open(V).then((c) => c.put('/', res.clone())); return res; })
      .catch(() => caches.match('/').then((m) => m || new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (/^\/(img|icons)\//.test(u.pathname) || /\.(css|json)$/.test(u.pathname)) {   // tài nguyên tĩnh: dùng bản lưu ngay, đồng thời cập nhật ngầm
    e.respondWith(caches.open(V).then((c) => c.match(r).then((hit) => {
      const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});

/* ---- Thông báo đẩy ---- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // đang xem CoolAir (cửa sổ hiện + có tiêu điểm) thì thôi: chuông / chat trong app đã báo realtime rồi
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || 'CoolAir', {
      body: d.body || '', icon: d.icon || '/icons/icon-192.png', badge: d.badge || '/icons/badge-96.png',
      tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === location.origin);
    if (w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
