/* Kiểm thử tick xanh xác thực thành viên (blueTick).
   Test logic serialize + toggle mà không cần DB thật. */
const test = require('node:test'), assert = require('node:assert');

// Giả lập logic toggle của API /admin/users/:id/tick
function toggleTick(user) {
  user.blueTick = !user.blueTick;
  return user.blueTick ? 'tick_grant' : 'tick_revoke';
}

test('toggle tick: false -> true (cấp), ghi log tick_grant', () => {
  const u = { username: 'an', blueTick: false };
  const action = toggleTick(u);
  assert.strictEqual(u.blueTick, true);
  assert.strictEqual(action, 'tick_grant');
});

test('toggle tick: true -> false (gỡ), ghi log tick_revoke', () => {
  const u = { username: 'an', blueTick: true };
  const action = toggleTick(u);
  assert.strictEqual(u.blueTick, false);
  assert.strictEqual(action, 'tick_revoke');
});

test('toggle 2 lần trở về trạng thái ban đầu', () => {
  const u = { blueTick: false };
  toggleTick(u); toggleTick(u);
  assert.strictEqual(u.blueTick, false);
});

test('user mới mặc định không có tick', () => {
  // Schema default: blueTick: false
  const schema = require('../server/models');
  const path = schema.User.schema.path('blueTick');
  assert.ok(path, 'User schema phải có field blueTick');
  assert.strictEqual(path.defaultValue, false);
});

test('frontend map(): tick của author được giữ', () => {
  // map() trong core.js: t:!!p.tick
  const src = require('fs').readFileSync(__dirname + '/../src/lib/core.js', 'utf8');
  assert.ok(src.includes('t:!!p.tick'), 'map() phải map p.tick -> t');
  assert.ok(src.includes('!!c.tick'), 'map() phải map c.tick cho comment');
});

test('CTick component được export và đăng ký', () => {
  const postSrc = require('fs').readFileSync(__dirname + '/../src/modules/post.js', 'utf8');
  assert.ok(postSrc.includes('const CTick='), 'phải định nghĩa CTick');
  assert.ok(postSrc.includes('CTick,'), 'phải export CTick');
  const mountSrc = require('fs').readFileSync(__dirname + '/../src/mount.js', 'utf8');
  assert.ok(mountSrc.includes("component('CTick',CTick)"), 'phải đăng ký CTick');
});
