/* Test store rate-limit (không cần MongoDB: dùng collection giả). Logic pipeline của MongoDB thì kiểm bằng cách chạy thật trên Atlas. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { MongoStore } = require('../server/ratestore');

const fake = (impl) => { const calls = []; return { calls, col: { createIndex: async () => 'ok', findOneAndUpdate: async (...a) => { calls.push(a); return impl(...a); }, updateOne: async () => ({}), deleteOne: async () => ({}) } }; };

test('increment gọi 1 lệnh findOneAndUpdate nguyên tử, khóa có tiền tố riêng từng limiter', async () => {
  const resetAt = new Date(Date.now() + 60000), f = fake(() => ({ _id: 'x', hits: 3, resetAt }));
  const s = new MongoStore('login#1', { collection: () => f.col }); s.init({ windowMs: 60000 });
  const r = await s.increment('1.2.3.4');
  assert.deepEqual(r, { totalHits: 3, resetTime: resetAt });
  const [filter, pipeline, opts] = f.calls[0];
  assert.deepEqual(filter, { _id: 'login#1:1.2.3.4' });
  assert.ok(Array.isArray(pipeline) && opts.upsert === true && opts.returnDocument === 'after');
});
test('đọc được cả kiểu trả về {value} của driver cũ', async () => {
  const f = fake(() => ({ ok: 1, value: { hits: 7, resetAt: new Date(Date.now() + 1000) } }));
  const s = new MongoStore('a', { collection: () => f.col }); s.init({ windowMs: 1000 });
  assert.equal((await s.increment('k')).totalHits, 7);
});
test('E11000 lần đầu (hai request cùng upsert) được thử lại', async () => {
  let n = 0; const f = fake(() => { if (!n++) { const e = new Error('dup'); e.code = 11000; throw e; } return { hits: 1, resetAt: new Date(Date.now() + 1000) }; });
  const s = new MongoStore('a', { collection: () => f.col }); s.init({ windowMs: 1000 });
  assert.equal((await s.increment('k')).totalHits, 1); assert.equal(f.calls.length, 2);
});
test('MongoDB lỗi -> đếm tạm trong RAM (không ném lỗi), hết cửa sổ thì đếm lại từ 1', async () => {
  const orig = console.error; console.error = () => {};
  try {
    const f = fake(() => { throw new Error('mất kết nối'); });
    const s = new MongoStore('a', { collection: () => f.col }); s.init({ windowMs: 40 });
    assert.equal((await s.increment('k')).totalHits, 1);
    assert.equal((await s.increment('k')).totalHits, 2);
    assert.equal((await s.increment('other')).totalHits, 1);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await s.increment('k')).totalHits, 1);
  } finally { console.error = orig; }
});
test('mọi rateLimit({...}) trong server/ đều gắn store dùng chung (limiter mới quên store sẽ báo ở đây)', () => {
  const dir = path.join(__dirname, '..', 'server'), bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const all = (t.match(/rateLimit\(\{/g) || []).length, ok = (t.match(/rateLimit\(\{ store: rlStore\(/g) || []).length;
    if (all !== ok) bad.push(f);
  }
  assert.deepEqual(bad, [], 'thiếu store ở: ' + bad.join(', '));
});
