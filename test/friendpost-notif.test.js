/* Test logic thông báo friend_post: bạn bè đăng bài -> bạn nhận được thông báo.
   Mô phỏng resolver phía server (trích từ server/notify.js) */
const test = require('node:test'), assert = require('node:assert');

// Mô phỏng logic filter của RESOLVERS.friend_post
function friendPostFilter(docs, friendships, uid) {
  const mine = new Set(friendships
    .filter(f => f.status === 'accepted' && (String(f.from) === String(uid) || String(f.to) === String(uid)))
    .map(f => String(f.from) === String(uid) ? String(f.to) : String(f.from)));
  return docs.filter(d => d.visibility !== 'private' && mine.has(String(d.author)));
}

const P = (id, author, visibility) => ({ _id: id, author, visibility });
const F = (from, to, status = 'accepted') => ({ from, to, status });

test('bạn bè đăng bài public -> nhận thông báo', () => {
  const docs = [P('1', 'friend1', 'public')];
  const fs = [F('me', 'friend1')];
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 1);
});

test('bạn bè đăng bài friends -> nhận thông báo', () => {
  const docs = [P('1', 'friend1', 'friends')];
  const fs = [F('me', 'friend1')];
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 1);
});

test('bạn bè đăng bài private -> KHÔNG nhận thông báo', () => {
  const docs = [P('1', 'friend1', 'private')];
  const fs = [F('me', 'friend1')];
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 0);
});

test('người lạ đăng bài -> KHÔNG nhận thông báo', () => {
  const docs = [P('1', 'stranger', 'public')];
  const fs = [F('me', 'friend1')];
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 0);
});

test('đã hủy kết bạn -> thông báo biến mất', () => {
  const docs = [P('1', 'exfriend', 'public')];
  const fs = []; // không còn friendship
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 0);
});

test('chính mình đăng bài -> KHÔNG tự nhận thông báo', () => {
  // addMany đã filter bỏ chính mình, nhưng resolver cũng phải đúng
  const docs = [P('1', 'me', 'public')];
  const fs = [F('me', 'friend1')];
  const r = friendPostFilter(docs, fs, 'me');
  assert.strictEqual(r.length, 0); // 'me' không có trong set bạn bè của chính mình
});
