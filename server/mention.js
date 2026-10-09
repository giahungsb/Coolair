/* @nhắc tên: gõ @tên_đăng_nhập trong bài viết / bình luận -> người đó nhận thông báo (loại 'mention').
   Tên đăng nhập hợp lệ: chữ thường, số, dấu chấm, gạch dưới, 3–20 ký tự (xem /auth/register). Tối đa 5 người mỗi lần để không bị lạm dụng spam. */
const { User } = require('./models');
const N = require('./notify');
const { blockedBetween } = require('./vis');

const RE = /(^|[^a-z0-9._@\/])@([a-z0-9._]{3,20})/gi;
const MAX = 5;
const extract = (text) => {
  const out = new Set();
  for (const m of String(text || '').matchAll(RE)) {
    const u = m[2].toLowerCase().replace(/\.+$/, '');            // dấu chấm cuối câu không thuộc tên
    if (u.length >= 3) out.add(u);
    if (out.size >= MAX) break;
  }
  return [...out];
};

/* post: bài viết; kind: 'p' (nhắc trong bài) | 'c' (nhắc trong bình luận); skip: Set tên đã được báo trước đó (khi sửa bài).
   canSee(post, userId) do routes/posts.js truyền vào để chỉ báo cho người thật sự xem được bài. Lỗi ở đây không được làm hỏng việc chính. */
const notify = async (post, text, from, kind, canSee, skip) => {
  try {
    const names = extract(text).filter((n) => !(skip && skip.has(n)));
    if (!names.length) return 0;
    const users = await User.find({ username: { $in: names } }).select('_id').lean();
    const authorId = String(post.author && (post.author._id || post.author));
    let sent = 0;
    for (const u of users) {
      const id = String(u._id);
      if (id === String(from)) continue;
      if (kind === 'c' && id === authorId) continue;             // chủ bài đã nhận thông báo "bình luận" rồi
      if (await blockedBetween(from, id)) continue;
      if (!(await canSee(post, id))) continue;
      await N.swap('mention', post.id, id, from, kind); sent++;
    }
    return sent;
  } catch (e) { console.error('[mention]', e.message); return 0; }
};

module.exports = { extract, notify };
