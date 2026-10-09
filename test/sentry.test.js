/* Kiểm thử module giám sát lỗi Sentry (server/sentry.js).
   Không gửi gì lên Sentry thật: chỉ test logic lọc PII + bỏ qua lỗi ồn ào. */
const test = require('node:test'), assert = require('node:assert');
const { beforeSend, shouldIgnore, scrubObject } = require('../server/sentry');

/* ---------- shouldIgnore: bỏ qua 401/404 ---------- */
test('bỏ qua lỗi 401 và 404', () => {
  assert.strictEqual(shouldIgnore({ contexts: { response: { status_code: 401 } } }), true);
  assert.strictEqual(shouldIgnore({ contexts: { response: { status_code: 404 } } }), true);
});
test('không bỏ qua lỗi 500', () => {
  assert.strictEqual(shouldIgnore({ contexts: { response: { status_code: 500 } } }), false);
  assert.strictEqual(shouldIgnore({ message: 'TypeError: x is not a function' }), false);
});
test('event không có thông tin vẫn xử lý được', () => {
  assert.strictEqual(shouldIgnore({}), false);
  assert.strictEqual(shouldIgnore(null), false);
});

/* ---------- scrubObject: che dữ liệu nhạy cảm ---------- */
test('che password/token/cookie/authorization', () => {
  const out = scrubObject({ password: 'abc', token: 'xyz', cookie: 'c=1', authorization: 'Bearer t', name: 'An' });
  assert.strictEqual(out.password, '***');
  assert.strictEqual(out.token, '***');
  assert.strictEqual(out.cookie, '***');
  assert.strictEqual(out.authorization, '***');
  assert.strictEqual(out.name, 'An', 'trường thường giữ nguyên');
});
test('che lồng nhau (object trong object)', () => {
  const out = scrubObject({ user: { email: 'a@b.c', id: 5 }, data: { form: { pwd: 'secret' } } });
  assert.strictEqual(out.user.email, '***');
  assert.strictEqual(out.user.id, 5);
  assert.strictEqual(out.data.form.pwd, '***');
});
test('mảng và giá trị nguyên thủy giữ nguyên', () => {
  assert.deepStrictEqual(scrubObject(['a', 'b']), ['a', 'b']);
  assert.strictEqual(scrubObject('chuỗi'), 'chuỗi');
  assert.strictEqual(scrubObject(null), null);
});

/* ---------- beforeSend: lọc event trước khi gửi ---------- */
test('beforeSend trả null với 401 (không gửi)', () => {
  const r = beforeSend({ contexts: { response: { status_code: 401 } } });
  assert.strictEqual(r, null);
});
test('beforeSend che header/cookie/data và chỉ giữ user.id', () => {
  const event = {
    request: {
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      cookies: { ca_tk: 'token123' },
      data: { username: 'an', password: 'mật khẩu' },
    },
    user: { id: 'u1', email: 'an@x.y', username: 'an' },
  };
  const r = beforeSend(event);
  assert.strictEqual(r.request.headers.authorization, '***');
  assert.strictEqual(r.request.headers['content-type'], 'application/json');
  assert.strictEqual(r.request.cookies.ca_tk, '***');
  assert.strictEqual(r.request.data.password, '***');
  assert.strictEqual(r.request.data.username, 'an');
  assert.deepStrictEqual(r.user, { id: 'u1' }, 'chỉ giữ id, xóa email/username');
});
test('beforeSend giữ nguyên event lỗi 500 đã scrub', () => {
  const r = beforeSend({ message: 'TypeError: boom', contexts: { response: { status_code: 500 } } });
  assert.ok(r, 'phải giữ lại để gửi');
  assert.strictEqual(r.message, 'TypeError: boom');
});
