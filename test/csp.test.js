/* Test CSP: server/csp.js là nguồn duy nhất, vercel.json phải đồng bộ.
   Chạy: npm test (không cần MongoDB). Sau khi sửa CSP: npm run csp:sync */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { directives, toHeaderString } = require('../server/csp');
const vercel = require('../vercel.json');

test('toHeaderString chuyển camelCase -> kebab-case đúng', () => {
  const s = toHeaderString({ scriptSrc: ["'self'", 'https://a.com'], objectSrc: ["'none'"] });
  assert.equal(s, "script-src 'self' https://a.com; object-src 'none'");
});
test('vercel.json CSP khớp với server/csp.js (chạy npm run csp:sync nếu lệch)', () => {
  const inVercel = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.equal(inVercel, toHeaderString(directives));
});
test('CSP chặn object/embed và chống clickjacking', () => {
  assert.deepEqual(directives.objectSrc, ["'none'"]);
  assert.deepEqual(directives.frameAncestors, ["'self'"]);
});
test('CSP cho phép Cloudinary upload (connect-src)', () => {
  assert.ok(directives.connectSrc.includes('https://api.cloudinary.com'), 'thiếu api.cloudinary.com -> upload sẽ bị chặn như lỗi mạng');
});
test('script-src không còn CDN (twemoji + ably đã bundle qua Vite); connect-src vẫn mở cho Ably', () => {
  assert.ok(!directives.scriptSrc.some((s) => s.startsWith('https://')), 'script-src không được có nguồn https ngoài');
  assert.ok(directives.connectSrc.includes('wss://*.ably.net'), 'thiếu wss://*.ably.net -> realtime không kết nối được');
});
test("script-src không có 'unsafe-eval' / 'unsafe-inline' (template Vue biên dịch lúc build)", () => {
  assert.ok(!directives.scriptSrc.includes("'unsafe-eval'"), 'unsafe-eval quay lại -> kiểm tra scripts/vite-vue-precompile.mjs');
  assert.ok(!directives.scriptSrc.includes("'unsafe-inline'"));
});
