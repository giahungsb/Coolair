/* Kiểm thử nhật ký kiểm toán thao tác quản trị (admin audit log).
   Không cần MongoDB: stub model + chặn require, gọi trực tiếp handler thật của route. */
const test = require('node:test'), assert = require('node:assert'), Module = require('module'), path = require('path');

const { writeAudit, sanitizeNote, buildLogFilter } = require('../server/audit');

/* ---------- 1. buildLogFilter ---------- */
test('filter rỗng khi không có tham số', () => {
  assert.deepStrictEqual(buildLogFilter({}), {});
  assert.deepStrictEqual(buildLogFilter({ action: '', q: '  ' }), {});
});
test('lọc chính xác theo action', () => {
  assert.deepStrictEqual(buildLogFilter({ action: 'ban' }), { action: 'ban' });
});
test('q tìm trong target/note, escape ký tự regex', () => {
  const f = buildLogFilter({ q: 'a.c*(' });
  assert.strictEqual(f.$or.length, 2);
  // 'a.c*(' đã escape -> regex chỉ khớp đúng chuỗi đó, không phải pattern
  assert.ok(f.$or[0].target.test('a.c*('), 'phải khớp chuỗi gốc');
  assert.ok(!f.$or[0].target.test('axc'), 'không được khớp như regex');
});
test('action + q kết hợp được', () => {
  const f = buildLogFilter({ action: 'pfield_edit', q: 'Sở thích' });
  assert.strictEqual(f.action, 'pfield_edit');
  assert.strictEqual(f.$or.length, 2);
});

/* ---------- 2. sanitizeNote: không bao giờ rò rỉ bí mật ---------- */
test('che password/token/2fa trong note', () => {
  const s = sanitizeNote('đổi pass mới password=abc123 cho user, totp: 654321 xong');
  assert.ok(!s.includes('abc123'), 'mật khẩu bị lộ: ' + s);
  assert.ok(!s.includes('654321'), 'mã 2FA bị lộ: ' + s);
  assert.ok(s.includes('password=***') && s.includes('totp=***'), 'phải che dạng key=***: ' + s);
});
test('che secret dạng JSON', () => {
  const s = sanitizeNote('{"token": "xyz789", "ok": 1}');
  assert.ok(!s.includes('xyz789'), 'token bị lộ: ' + s);
});
test('note bình thường giữ nguyên', () => {
  assert.strictEqual(sanitizeNote('cấm 7 ngày vì spam'), 'cấm 7 ngày vì spam');
});

/* ---------- 3. writeAudit: ghi đúng định dạng, cắt ngắn ---------- */
test('writeAudit ghi đủ 4 trường + cắt ngắn', async () => {
  let saved = null;
  const AdminLogStub = { create: (doc) => { saved = doc; return Promise.resolve(doc); } };
  await writeAudit(AdminLogStub, 'admin1', 'ban', 'user_x', 'spam');
  assert.strictEqual(saved.admin, 'admin1');
  assert.strictEqual(saved.action, 'ban');
  assert.strictEqual(saved.target, 'user_x');
  assert.strictEqual(saved.note, 'spam');
  // cắt ngắn
  await writeAudit(AdminLogStub, 'admin1', 'x'.repeat(100), 't'.repeat(200), 'n'.repeat(500));
  assert.ok(saved.action.length <= 40 && saved.target.length <= 120 && saved.note.length <= 300, 'phải cắt ngắn');
});
test('writeAudit không ném lỗi khi DB hỏng (fire-and-forget)', async () => {
  const BadLog = { create: () => Promise.reject(new Error('db down')) };
  await writeAudit(BadLog, 'a', 'ban', 't', 'n');   // không throw
});

/* ---------- 4. Handler thật: profile_fields PATCH/DELETE gọi alog ---------- */
function loadProfileFields(stubs) {
  const handlers = {};
  const fakeRouter = new Proxy({}, {
    get: (_, m) => (...a) => {
      const h = a[a.length - 1];
      if (typeof a[0] === 'string' && typeof h === 'function') handlers[m + ' ' + a[0]] = h;
    },
  });
  const orig = Module._load;
  Module._load = function (req, parent) {
    if (parent && parent.filename.endsWith('profile_fields.js')) {
      if (req === './shared') return stubs.shared;
      if (req === '../aconfig') return { alog: stubs.alog };
    }
    return orig.apply(this, arguments);
  };
  const modPath = path.join(__dirname, '..', 'server', 'routes', 'profile_fields.js');
  delete require.cache[modPath];   // nạp lại để dùng stub alog mới của từng test
  require(modPath)(fakeRouter);
  Module._load = orig;
  return handlers;
}
const oid = '64b7c8d4e5f6a7b8c9d0e1f2';
const sharedStub = {
  isValidObjectId: (id) => /^[0-9a-f]{24}$/i.test(String(id || '')),
  User: { updateMany: async () => ({}) },
  ProfileField: {
    findByIdAndUpdate: async () => ({ id: 'f1', title: 'Sở thích' }),
    findByIdAndDelete: async () => ({ id: 'f1', title: 'Sở thích' }),
  },
  S: (v) => String(v == null ? '' : v),
  wrap: (h) => h,
  fail: (res, msg) => { throw new Error('FAIL:' + msg); },
  auth: (req, res, next) => next(),
  isAdmin: () => true,
};
const mkRes = () => { const r = {}; r.status = () => r; r.json = (d) => { r.data = d; return r; }; return r; };

test('PATCH /admin/profile-fields/:id ghi log pfield_edit', async () => {
  const calls = [];
  const h = loadProfileFields({ shared: sharedStub, alog: (...a) => calls.push(a) });
  const handler = h['patch /admin/profile-fields/:id'];
  assert.ok(handler, 'không tìm thấy handler PATCH');
  await handler({ uid: 'admin1', params: { id: oid }, body: { title: 'Sở thích', formtype: 'text', maxsize: 50 } }, mkRes());
  assert.strictEqual(calls.length, 1, 'phải ghi đúng 1 log');
  assert.strictEqual(calls[0][0], 'admin1');
  assert.strictEqual(calls[0][1], 'pfield_edit');
  assert.strictEqual(calls[0][2], 'Sở thích');
});
test('DELETE /admin/profile-fields/:id ghi log pfield_del', async () => {
  const calls = [];
  const h = loadProfileFields({ shared: sharedStub, alog: (...a) => calls.push(a) });
  const handler = h['delete /admin/profile-fields/:id'];
  assert.ok(handler, 'không tìm thấy handler DELETE');
  await handler({ uid: 'admin1', params: { id: oid }, body: {} }, mkRes());
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][1], 'pfield_del');
  assert.strictEqual(calls[0][2], 'Sở thích');
});

/* ---------- 5. Handler thật: admin ban ghi log 'ban' ---------- */
function loadAdminBan(stubs) {
  const handlers = {};
  const fakeRouter = new Proxy({}, {
    get: (_, m) => (...a) => {
      const h = a[a.length - 1];
      if (typeof a[0] === 'string' && typeof h === 'function') handlers[m + ' ' + a[0]] = h;
    },
  });
  // aconfig gọi inline trong handler -> patch trực tiếp exports trong require.cache
  const aconfigPath = path.join(__dirname, '..', 'server', 'aconfig.js');
  require(aconfigPath);
  const origAlog = require.cache[aconfigPath].exports.alog;
  require.cache[aconfigPath].exports.alog = stubs.alog;
  const orig = Module._load;
  Module._load = function (req, parent) {
    if (parent && parent.filename.endsWith(path.join('server', 'admin.js'))) {
      if (req === './models') return stubs.models;
      if (req === './aconfig') return require.cache[aconfigPath].exports;  // dùng bản đã patch
      if (req === './session') return { bustBanCache: () => {} };
      if (req === './social' || req === './notify' || req === './upload' || req === './media') return {};
    }
    return orig.apply(this, arguments);
  };
  require(path.join(__dirname, '..', 'server', 'admin.js'))(fakeRouter, {
    auth: (q, r, n) => n(), wrap: (h) => h,
    fail: (res, msg) => { throw new Error('FAIL:' + msg); },
    S: (v) => String(v == null ? '' : v), isAdmin: (u) => !!(u && /admin@/.test(u.email || '')),
  });
  Module._load = orig;
  return { handlers, restore: () => { require.cache[aconfigPath].exports.alog = origAlog; } };
}
test('POST /admin/users/:id/ban ghi log ban', async () => {
  const calls = [];
  const fakeUser = { _id: oid, username: 'spammer1', name: 'Spammer', save: async () => {}, email: 'x@y.z' };
  const { handlers: h, restore } = loadAdminBan({
    models: { User: { findById: async () => fakeUser }, Event: {}, EventMember: {}, Poll: {}, PollVote: {}, Post: {}, Guestbook: {}, Friendship: {}, Message: {}, Poke: {}, Notification: {}, Album: {}, Photo: {}, Blog: {}, Doing: {}, Share: {}, SsoCode: {}, Group: {}, GroupMember: {}, GroupInvite: {}, Thread: {}, GroupPost: {}, Visitor: {}, Invite: {}, ForumThread: {}, ForumPost: {}, ForumSub: {}, MusicAlbum: {}, MusicSong: {}, MusicPlaylist: {}, Video: {}, Quiz: {}, QuizAttempt: {}, Page: {} },
    alog: (...a) => calls.push(a),
  });
  const handler = h['post /admin/users/:id/ban'];
  assert.ok(handler, 'không tìm thấy handler ban');
  await handler({ uid: 'admin1', params: { id: oid }, body: { reason: 'spam', days: 7 } }, mkRes());
  const banCall = calls.find((c) => c[1] === 'ban');
  assert.ok(banCall, 'phải có log action=ban, thực tế: ' + JSON.stringify(calls.map((c) => c[1])));
  assert.strictEqual(banCall[0], 'admin1');
  assert.strictEqual(banCall[2], 'spammer1');
  restore();
});
