/* Test logic lọc quyền của GET /checkins: mô phỏng query MongoDB.
   Kiểm tra điều kiện $or: bài của mình / công khai / bạn bè. */
const test = require('node:test'), assert = require('node:assert');

// Mô phỏng logic filter phía server (trích từ server/routes/posts.js)
function visibleCheckins(allPosts, me, friendIds) {
  const fset = new Set(friendIds.map(String));
  return allPosts.filter(p => {
    const loc = p.location;
    if (!loc || !loc.name) return false;                       // phải có check-in
    const author = String(p.author);
    if (author === String(me)) return true;                    // bài của mình
    const v = p.visibility || 'public';
    if (v === 'public') return true;                           // công khai
    if (v === 'friends' && fset.has(author)) return true;       // bạn bè
    return false;                                              // private hoặc không phải bạn
  });
}

const P = (id, author, visibility, locName) => ({
  _id: id, author, visibility,
  location: locName ? { name: locName, lat: 10, lng: 106 } : null,
});

test('chỉ trả bài có check-in', () => {
  const posts = [P('1', 'u1', 'public', 'Hồ Gươm'), P('2', 'u1', 'public', null), P('3', 'u1', 'public', '')];
  const r = visibleCheckins(posts, 'me', []);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0]._id, '1');
});

test('bài private của người khác không hiện', () => {
  const posts = [P('1', 'u1', 'private', 'Hồ Gươm')];
  assert.strictEqual(visibleCheckins(posts, 'me', ['u1']).length, 0);
});

test('bài friends chỉ hiện với bạn bè', () => {
  const posts = [P('1', 'u1', 'friends', 'Hồ Gươm')];
  assert.strictEqual(visibleCheckins(posts, 'me', ['u1']).length, 1);   // là bạn -> thấy
  assert.strictEqual(visibleCheckins(posts, 'me', []).length, 0);       // không phải bạn -> không thấy
});

test('bài public hiện với mọi người', () => {
  const posts = [P('1', 'u1', 'public', 'Hồ Gươm')];
  assert.strictEqual(visibleCheckins(posts, 'stranger', []).length, 1);
});

test('bài của mình luôn hiện kể cả private', () => {
  const posts = [P('1', 'me', 'private', 'Nhà mình')];
  assert.strictEqual(visibleCheckins(posts, 'me', []).length, 1);
});

test('bài cũ chưa có visibility coi như public', () => {
  const posts = [{ _id: '1', author: 'u1', location: { name: 'X', lat: 1, lng: 1 } }];
  assert.strictEqual(visibleCheckins(posts, 'stranger', []).length, 1);
});
