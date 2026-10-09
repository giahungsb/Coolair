/* NGUỒN DUY NHẤT cho Content-Security-Policy.
   - app.js: dùng `directives` cho helmet (object camelCase)
   - vercel.json: chạy `npm run csp:sync` để sinh chuỗi header từ đây (kebab-case)
   SỬA Ở ĐÂY, không sửa lẻ tẻ ở app.js hay vercel.json. Sau khi sửa, chạy `npm run csp:sync` rồi deploy. */
const directives = {
  defaultSrc: ["'self'"],
  // script-src KHÔNG có 'unsafe-inline' (index.html không còn script inline; đừng thêm <script>…</script> hay onclick="…"/javascript: vào trang).
  // KHÔNG có 'unsafe-eval': template Vue biên dịch lúc build (scripts/vite-vue-precompile.mjs). Đừng dùng eval/new Function/Vue.compile ở client. style-src giữ 'unsafe-inline' vì template dùng style="…".
  scriptSrc: ["'self'"],   // twemoji và ably đều bundle qua npm (Vite) -> không cần CDN nào trong script-src (connect-src vẫn cần domain Ably cho WebSocket)
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://cdn.jsdelivr.net', 'https://res.cloudinary.com', 'https://i.ytimg.com', 'https://img.youtube.com', 'https://i.vimeocdn.com', 'https://*.tile.openstreetmap.org'],   // tile bản đồ check-in nhóm
  mediaSrc: ["'self'", 'blob:', 'data:', 'https://res.cloudinary.com'],
  // Ably v2: main.realtime.ably.net + máy chủ dự phòng ably-realtime.com
  connectSrc: ["'self'", 'https://nominatim.openstreetmap.org', 'https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io', 'https://api.cloudinary.com', 'https://*.ably.io', 'wss://*.ably.io', 'https://*.ably.net', 'wss://*.ably.net', 'https://*.ably-realtime.com', 'wss://*.ably-realtime.com'],
  frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://www.tiktok.com'],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],   // chống clickjacking: không cho site khác nhúng CoolAir trong iframe
};

// Object helmet (camelCase) -> chuỗi header "script-src 'self' ...; ..."
const toHeaderString = (dirs) =>
  Object.entries(dirs)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} ${v.join(' ')}`)
    .join('; ');

module.exports = { directives, toHeaderString };
