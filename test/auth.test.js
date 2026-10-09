/* Test đăng nhập / phân quyền admin.
   Logic copy từ server/routes/shared.js (isAdmin) và routes/profile_fields.js (adminOnly) để test
   không cần MongoDB. Nếu sửa logic ở đó, cập nhật test này theo.
   Chạy: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// --- copy logic từ server/routes/shared.js + profile_fields.js ---
const getAdmins = () => (process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const isAdmin = (u, admins = getAdmins()) => admins.includes(String(u.email || '').toLowerCase());
// adminOnly: !u || !isAdmin(u) || u.verified === false -> 403, ngược lại next()
const adminDecision = (u, admins) => {
  if (!u || !admins.includes(String(u.email || '').toLowerCase()) || u.verified === false) return 403;
  return 200;
};
// --- hết copy ---

test('isAdmin: chỉ email trong ADMIN_EMAILS mới là admin', () => {
  const admins = ['admin@coolair.vn', 'boss@gmail.com'];
  assert.equal(isAdmin({ email: 'admin@coolair.vn' }, admins), true);
  assert.equal(isAdmin({ email: 'ADMIN@COOLAIR.VN' }, admins), true, 'so sánh không phân biệt hoa thường');
  assert.equal(isAdmin({ email: 'user@gmail.com' }, admins), false);
  assert.equal(isAdmin({ email: '' }, admins), false);
  assert.equal(isAdmin({}, admins), false);
});
test('isAdmin: đọc ADMIN_EMAILS từ env, trim và lowercase', () => {
  process.env.ADMIN_EMAILS = '  Admin@CoolAir.vn ,, boss@GMAIL.com ';
  assert.deepEqual(getAdmins(), ['admin@coolair.vn', 'boss@gmail.com']);
  delete process.env.ADMIN_EMAILS;
  assert.deepEqual(getAdmins(), []);
});
test('adminOnly: chặn user thường (403)', () => {
  const admins = ['admin@coolair.vn'];
  assert.equal(adminDecision({ email: 'user@gmail.com', verified: true }, admins), 403);
  assert.equal(adminDecision(null, admins), 403, 'chưa đăng nhập');
  assert.equal(adminDecision(undefined, admins), 403);
});
test('adminOnly: chặn admin chưa xác thực email (chống chiếm quyền bằng cách đăng ký email admin)', () => {
  const admins = ['admin@coolair.vn'];
  assert.equal(adminDecision({ email: 'admin@coolair.vn', verified: false }, admins), 403);
});
test('adminOnly: cho qua admin đã xác thực', () => {
  const admins = ['admin@coolair.vn'];
  assert.equal(adminDecision({ email: 'admin@coolair.vn', verified: true }, admins), 200);
  assert.equal(adminDecision({ email: 'admin@coolair.vn' }, admins), 200, 'verified undefined (user cũ) vẫn cho qua');
});

// --- Origin check (copy logic từ middleware trong app.js) ---
const originDecision = (method, origin, referer, host, extra = '') => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 200;
  const o = origin || referer;
  if (!o) return 200; // curl/app mobile không gửi Origin -> cho qua (đã có auth)
  try {
    const u = new URL(o);
    const extraList = extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return (u.host.toLowerCase() === host.toLowerCase() || extraList.includes(u.host.toLowerCase())) ? 200 : 403;
  } catch { return 403; }
};
test('Origin check: chặn CSRF từ site lạ trên request ghi', () => {
  const h = 'coolair-beta.vercel.app';
  assert.equal(originDecision('POST', 'https://evil.com', null, h), 403);
  assert.equal(originDecision('PUT', 'https://evil.com', null, h), 403);
  assert.equal(originDecision('DELETE', null, 'https://evil.com/x', h), 403);
  assert.equal(originDecision('POST', 'not-a-url', null, h), 403);
});
test('Origin check: cho qua request cùng origin / không Origin / GET', () => {
  const h = 'coolair-beta.vercel.app';
  assert.equal(originDecision('POST', 'https://coolair-beta.vercel.app', null, h), 200);
  assert.equal(originDecision('POST', null, null, h), 200, 'curl không Origin');
  assert.equal(originDecision('GET', 'https://evil.com', null, h), 200, 'GET không kiểm tra');
  assert.equal(originDecision('POST', 'https://app.coolair.vn', null, h, 'app.coolair.vn'), 200, 'ALLOWED_ORIGINS');
});
