/* Test phân quyền riêng tư: bài viết (server/routes/posts.js, canSee) và album (server/album.js ~L36).
   Logic copy nguyên bản để test không cần MongoDB. Nếu sửa logic ở source, cập nhật test này theo.
   Chạy: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// --- copy logic từ server/routes/posts.js (canSee của post) ---
const postCanSee = async (p, me, areFriends) => {
  const a = String(p.author && p.author._id ? p.author._id : p.author);
  if (a === me) return true;
  const v = p.visibility || 'public';
  return v === 'public' || (v === 'friends' && !!(await areFriends(me, a)));
};
// --- copy logic từ server/album.js (canSee của album, đã đồng nhất default 'public' như post) ---
const albumCanSee = async (a, me, areFriends) =>
  String(a.owner) === me || (a.visibility || 'public') === 'public' || (a.visibility === 'friends' && !!(await areFriends(me, a.owner)));
// --- hết copy ---

// areFriends giả: user1 <-> user2 là bạn, còn lại không
const areFriends = async (me, other) => {
  const pair = [String(me), String(other)].sort().join('|');
  return pair === 'user1|user2';
};

test('Chủ luôn xem được bài/album của mình (mọi visibility)', async () => {
  for (const v of ['public', 'friends', 'private', undefined]) {
    assert.equal(await postCanSee({ author: 'user1', visibility: v }, 'user1', areFriends), true, `post ${v}`);
    assert.equal(await albumCanSee({ owner: 'user1', visibility: v }, 'user1', areFriends), true, `album ${v}`);
  }
});
test('Bài/album public: ai cũng xem được', async () => {
  for (const me of ['user2', 'user3']) {
    assert.equal(await postCanSee({ author: 'user1', visibility: 'public' }, me, areFriends), true);
    assert.equal(await albumCanSee({ owner: 'user1', visibility: 'public' }, me, areFriends), true);
  }
});
test('Bài/album friends: chỉ bạn bè xem được', async () => {
  assert.equal(await postCanSee({ author: 'user1', visibility: 'friends' }, 'user2', areFriends), true, 'bạn xem được');
  assert.equal(await postCanSee({ author: 'user1', visibility: 'friends' }, 'user3', areFriends), false, 'người lạ KHÔNG xem được');
  assert.equal(await albumCanSee({ owner: 'user1', visibility: 'friends' }, 'user2', areFriends), true, 'bạn xem được');
  assert.equal(await albumCanSee({ owner: 'user1', visibility: 'friends' }, 'user3', areFriends), false, 'người lạ KHÔNG xem được');
});
test('Bài/album private: chỉ chủ xem được', async () => {
  for (const me of ['user2', 'user3']) {
    assert.equal(await postCanSee({ author: 'user1', visibility: 'private' }, me, areFriends), false, `post: ${me} KHÔNG xem được`);
    assert.equal(await albumCanSee({ owner: 'user1', visibility: 'private' }, me, areFriends), false, `album: ${me} KHÔNG xem được`);
  }
});
test('visibility rỗng/undefined mặc định là public', async () => {
  assert.equal(await postCanSee({ author: 'user1' }, 'user3', areFriends), true);
  assert.equal(await albumCanSee({ owner: 'user1' }, 'user3', areFriends), true);
});
test('author dạng object populate (author._id) vẫn so sánh đúng', async () => {
  const p = { author: { _id: 'user1' }, visibility: 'private' };
  assert.equal(await postCanSee(p, 'user1', areFriends), true, 'chủ (populate) xem được');
  assert.equal(await postCanSee(p, 'user2', areFriends), false, 'bạn KHÔNG xem được bài private');
});
