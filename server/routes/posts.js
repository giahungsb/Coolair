/* Bài viết, bình luận, cảm xúc */
const { isValidObjectId, rateLimit, rlStore, User, Post, N, mention, social, media, EMOJI, S, wrap, fail, auth, award, completeTask, censorFilter, friendIds, areFriends } = require('./shared');

/* Parse location check-in từ client: { name, lat, lng }. Validate chặt để chống dữ liệu bẩn.
   Trả về object location hoặc undefined (không có check-in). */
const parseLocation = (body) => {
  const loc = body && body.location;
  if (!loc || typeof loc !== 'object') return undefined;
  const name = String(loc.name || '').trim().slice(0, 100);
  const lat = Number(loc.lat), lng = Number(loc.lng);
  if (!name) return undefined;   // phải có tên địa điểm
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return undefined;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return undefined;
  return { name, lat, lng };
};

module.exports = (router) => {
/* ---------- Posts ---------- */
// cảm xúc của một bình luận: likes = số người khác, reaction = cảm xúc của mình, emojis = tối đa 3 emoji phổ biến nhất (giống bài viết)
const crView = (c, me) => {
  const rs = c.reactions || [], mine = rs.find((r) => String(r.user) === me), count = {};
  rs.forEach((r) => { count[r.emoji] = (count[r.emoji] || 0) + 1; });
  return { likes: rs.length - (mine ? 1 : 0), reaction: mine ? mine.emoji : null, emojis: Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 3) };
};
const view = (p, me) => {
  const mine = p.reactions.find((r) => String(r.user) === me);
  return { id: p.id, name: p.author ? p.author.name : 'Người dùng đã xóa', av: (p.author && p.author.avatar) || '', tick: !!(p.author && p.author.blueTick), mine: !!p.author && String(p.author._id) === me,
    text: p.text || '', photos: p.photos || [], video: p.video && p.video.kind ? { kind: p.video.kind, site: p.video.site || '', vid: p.video.vid || '', url: p.video.url || '', title: p.video.title || '', thumb: p.video.thumb || '' } : null,
    createdAt: p.createdAt, editedAt: p.editedAt || null, visibility: p.visibility || 'public', likes: p.reactions.length - (mine ? 1 : 0), reaction: mine ? mine.emoji : null,
    location: p.location && p.location.name ? { name: p.location.name, lat: p.location.lat, lng: p.location.lng } : null,
    comments: p.comments.map((c) => ({ id: String(c._id), name: c.name, text: c.text, av: c.anon ? '' : (c.user && c.user.avatar) || '', tick: !!(c.user && c.user.blueTick), anon: !!c.anon,
      parent: c.parent ? String(c.parent) : null, ...crView(c, me), canDel: mine || String(c.user && (c.user._id || c.user)) === me })) };
};
const PP = [{ path: 'author', select: 'name avatar blueTick' }, { path: 'comments.user', select: 'avatar blueTick' }];   // lấy kèm ảnh đại diện
const findPost = (id) => Post.findById(id).populate(PP);
const VIS = ['public', 'friends', 'private'];

// Ai được xem bài: tác giả luôn thấy; 'private' chỉ tác giả; 'friends' cần là bạn bè; 'public' ai cũng thấy (bài cũ chưa có trường -> public)
const canSee = async (p, me) => {
  const a = String(p.author && p.author._id ? p.author._id : p.author);
  if (a === me) return true;
  const v = p.visibility || 'public';
  return v === 'public' || (v === 'friends' && !!(await areFriends(me, a)));
};

router.get('/posts', auth, wrap(async (req, res) => {
  const q = {};
  if (req.query.before) { const d = new Date(S(req.query.before)); if (isNaN(d)) return fail(res, 'Tham số before không hợp lệ.'); q.createdAt = { $lt: d }; }
  const author = S(req.query.author);
  if (S(req.query.mine) === '1' || author === req.uid) q.author = req.uid;          // bài của mình (tab Nhật ký): thấy hết
  else if (isValidObjectId(author)) {                                               // trang cá nhân của người khác
    q.author = author;
    q.visibility = (await areFriends(req.uid, author)) ? { $ne: 'private' } : { $in: ['public', null] };
  } else {                                                                          // bảng tin: bài của mình + bạn bè (trừ bài riêng tư)
    const { blockedIds, feedOptOutIds } = require('../vis');
    // Chạy song song (trước đây ~6 truy vấn nối đuôi nhau: mỗi cái tốn 1 vòng mạng tới MongoDB -> bảng tin chậm khi Vercel và DB ở xa nhau)
    const [all, hid, blocked, meDoc] = await Promise.all([
      friendIds(req.uid), social.hiddenFriendIds(req.uid), blockedIds(req.uid),
      User.findById(req.uid).select('feedHidden magicFx').lean(),
    ]);
    const ids = hid.size ? all.filter((x) => !hid.has(String(x))) : all;   // nhóm bạn đã chọn ẩn khỏi bảng tin (groupignore)
    const blk = new Set(blocked.map(String));                              // loại người đã chặn / bị chặn
    ((meDoc && meDoc.feedHidden) || []).forEach((x) => blk.add(String(x)));   // + những người tự ẩn khỏi bảng tin
    const feedIds = ids.filter((x) => !blk.has(String(x)));
    const noPost = new Set(await feedOptOutIds(feedIds, 'post'));   // người tắt "hiện bài viết lên bảng tin bạn bè"
    const finalIds = feedIds.filter((x) => !noPost.has(String(x)));
    q.$or = [{ author: req.uid }, { author: { $in: finalIds }, visibility: { $ne: 'private' } }];
    const mf = meDoc && meDoc.magicFx;   // đạo cụ Lặn sâu: ẩn bài chỉ định (lean() trả object thường, không phải Map)
    const sunk = mf && (typeof mf.get === 'function' ? mf.get('downdateline') : mf.downdateline);
    if (sunk && sunk.exp > Date.now() && sunk.ids && sunk.ids.length) q._id = { $nin: sunk.ids };
  }
  const limit = Math.min(Math.max(parseInt(S(req.query.limit), 10) || 20, 1), 50);
  const list = await Post.find(q).sort({ createdAt: -1 }).limit(limit).populate(PP);
  res.json(list.map((p) => view(p, req.uid)));
}));

const postLimit = rateLimit({ store: rlStore('routes.postLimit'), windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn đăng bài quá nhanh, vui lòng thử lại sau ít phút.' } });
/* Bản đồ check-in nhóm: trả về các điểm check-in mà user hiện tại được quyền xem.
   Quyền xem = quyền xem bài gốc (của mình / công khai / bạn bè). */
router.get('/checkins', auth, wrap(async (req, res) => {
  const me = String(req.uid);
  const fids = await friendIds(me);
  const q = {
    'location.name': { $nin: ['', null] },
    $or: [
      { author: req.uid },                                   // bài của mình: thấy hết
      { visibility: { $in: ['public', null] } },              // công khai (kể cả bài cũ chưa có trường)
      { visibility: 'friends', author: { $in: fids } },       // bạn bè: chỉ bạn mới thấy
    ],
  };
  const list = await Post.find(q).select('author text location createdAt visibility')
    .populate({ path: 'author', select: 'name avatar blueTick' }).sort({ createdAt: -1 }).limit(500).lean();
  res.json(list.map(p => ({
    postId: String(p._id),
    authorId: p.author ? String(p.author._id) : '',
    name: p.author ? p.author.name : 'Người dùng đã xóa',
    av: (p.author && p.author.avatar) || '',
    text: (p.text || '').slice(0, 120),
    location: { name: p.location.name, lat: p.location.lat, lng: p.location.lng },
    createdAt: p.createdAt,
  })));
}));

/* Chi tiết 1 bài viết (dùng cho bản đồ: bấm marker mở bài gốc). Kiểm quyền xem như các API khác. */
router.get('/posts/:id', auth, wrap(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 'Không tìm thấy bài viết.', null, 404);
  const p = await findPost(req.params.id);
  if (!p || !(await canSee(p, req.uid))) return fail(res, 'Không tìm thấy bài viết.', null, 404);
  res.json(view(p, req.uid));
}));

router.post('/posts', auth, postLimit, wrap(async (req, res) => {
  const text = await censorFilter(S(req.body.text).trim());
  if (text.length > 2000) return fail(res, 'Bài viết tối đa 2000 ký tự.');
  const m = await media.build(req.body, req.uid);   // ảnh / video đính kèm (có thể trống)
  if (m.error) return fail(res, m.error);
  if (!text && !m.photos.length && !m.video) return fail(res, 'Bài viết cần nội dung, ảnh hoặc video.');
  const visibility = VIS.includes(S(req.body.visibility)) ? S(req.body.visibility) : 'public';
  const location = parseLocation(req.body);
  const p = await Post.create({ author: req.uid, text, visibility, photos: m.photos.length ? m.photos : undefined, video: m.video || undefined, location });
  if (visibility !== 'private') await N.addMany('friend_post', p.id, await friendIds(req.uid), req.uid);
  await mention.notify(p, text, req.uid, 'p', canSee);   // @nhắc tên   // báo cho BẠN BÈ (người lạ thì không); bài riêng tư không báo ai
  award(req.uid, 'post'); completeTask(req.uid, 'post');
  res.status(201).json(view(await findPost(p.id), req.uid));
}));

router.delete('/posts/:id', auth, wrap(async (req, res) => {
  const old = isValidObjectId(req.params.id) ? await Post.findOneAndDelete({ _id: req.params.id, author: req.uid }) : null;
  if (old) { await N.purge(['post_comment', 'post_react', 'friend_post'], req.params.id); await media.destroyMedia(old); }   // bài đã xóa -> dọn thông báo + ảnh / video trên Cloudinary
  old ? res.json({ ok: true }) : fail(res, 'Không tìm thấy bài viết của bạn.', null, 404);
}));

router.patch('/posts/:id', auth, wrap(async (req, res) => {                 // tác giả sửa nội dung (và/hoặc quyền riêng tư) bài của mình
  const set = {};
  if (req.body.text !== undefined) {
    const text = await censorFilter(S(req.body.text).trim());
    if (text.length > 2000) return fail(res, 'Bài viết tối đa 2000 ký tự.');
    set.text = text;
  }
  if (req.body.visibility !== undefined) {
    if (!VIS.includes(S(req.body.visibility))) return fail(res, 'Quyền riêng tư không hợp lệ.');
    set.visibility = S(req.body.visibility);
  }
  if (req.body.location !== undefined) {
    const loc = parseLocation(req.body);
    set.location = loc || { name: '' };   // xóa check-in: gửi location rỗng
  }
  if (!Object.keys(set).length) return fail(res, 'Không có gì để cập nhật.');
  const old = isValidObjectId(req.params.id) ? await Post.findOne({ _id: req.params.id, author: req.uid }).select('text photos video') : null;
  if (!old) return fail(res, 'Không tìm thấy bài viết của bạn.', null, 404);
  if (set.text === '' && !(old.photos && old.photos.length) && !(old.video && old.video.kind)) return fail(res, 'Bài viết cần nội dung, ảnh hoặc video.');
  if (set.text !== undefined && set.text !== old.text) set.editedAt = new Date();
  const p = await Post.findOneAndUpdate({ _id: req.params.id, author: req.uid }, set, { new: true }).populate(PP);
  if (p && set.text && set.visibility !== 'private' && p.visibility !== 'private') await mention.notify(p, set.text, req.uid, 'p', canSee, new Set(mention.extract(old.text)));
  if (p && set.visibility === 'private') await N.purge(['friend_post'], p.id);
  res.json(view(p, req.uid));
}));

router.patch('/posts/:id/visibility', auth, wrap(async (req, res) => {      // tác giả đổi quyền riêng tư của bài
  const v = S(req.body.visibility);
  if (!VIS.includes(v)) return fail(res, 'Quyền riêng tư không hợp lệ.');
  const p = await Post.findOneAndUpdate({ _id: req.params.id, author: req.uid }, { visibility: v }, { new: true }).populate(PP);
  if (p && v === 'private') await N.purge(['friend_post'], p.id);
  p ? res.json(view(p, req.uid)) : fail(res, 'Không tìm thấy bài viết của bạn.', null, 404);
}));

router.post('/posts/:id/react', auth, wrap(async (req, res) => {
  const e = S(req.body.emoji);
  if (!EMOJI.includes(e)) return fail(res, 'Cảm xúc không hợp lệ.');
  const p = await findPost(req.params.id);
  if (!p || !(await canSee(p, req.uid))) return fail(res, 'Không tìm thấy bài viết.', null, 404);
  const i = p.reactions.findIndex((r) => String(r.user) === req.uid);
  let removed = false;
  if (i >= 0 && p.reactions[i].emoji === e) { p.reactions.splice(i, 1); removed = true; }       // bấm lại -> bỏ cảm xúc
  else if (i >= 0) p.reactions[i].emoji = e;
  else p.reactions.push({ user: req.uid, emoji: e });
  await p.save();
  await N.swap('post_react', p.id, String(p.author._id || p.author), req.uid, removed ? null : e);   // bỏ cảm xúc -> xóa thông báo; đổi cảm xúc -> thay dòng cũ
  res.json(view(p, req.uid));
}));

router.post('/posts/:id/comments', auth, wrap(async (req, res) => {
  const text = await censorFilter(S(req.body.text).trim());
  if (!text || text.length > 500) return fail(res, 'Bình luận cần 1–500 ký tự.');
  const [u, p] = await Promise.all([User.findById(req.uid), findPost(req.params.id)]);
  if (!u || !p || !(await canSee(p, req.uid))) return fail(res, 'Không tìm thấy dữ liệu.', null, 404);
  const { blockedBetween } = require('../vis');
  if (await blockedBetween(p.author, req.uid)) return fail(res, 'Bạn không thể bình luận bài viết này.', null, 403);
  let parent = null;
  if (req.body.parent) {   // trả lời đa cấp: parent = id bình luận cha
    parent = (p.comments || []).find((c) => String(c._id) === S(req.body.parent));
    if (!parent) return fail(res, 'Bình luận gốc không tồn tại.');
  }
  let anon = false;
  if (req.body.anonymous) {   // đạo cụ Ẩn danh
    const fx = u.magicFx && u.magicFx.get('anonymous');
    if (fx && (fx.count || 0) > 0) {
      anon = true;
      await User.updateOne({ _id: req.uid }, { $inc: { 'magicFx.anonymous.count': -1 } });
    }
  }
  p.comments.push({ user: u.id, name: anon ? 'Ẩn danh 🎭' : u.name, text, parent: parent ? parent._id : null, anon });
  await p.save();
  award(req.uid, 'comment', 'post');
  await N.add('post_comment', p.id, String(p.author._id || p.author), req.uid);
  if (!anon) await mention.notify(p, text, req.uid, 'c', canSee);   // @nhắc tên (không áp dụng cho bình luận ẩn danh)
  await p.populate({ path: 'comments.user', select: 'avatar blueTick' });
  res.status(201).json(view(p, req.uid));
}));

router.post('/posts/:id/comments/:cid/react', auth, wrap(async (req, res) => {   // thả / đổi / bỏ cảm xúc cho một bình luận (bấm lại cùng emoji = bỏ)
  const e = S(req.body.emoji);
  if (!EMOJI.includes(e)) return fail(res, 'Cảm xúc không hợp lệ.');
  if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.cid)) return fail(res, 'Không tìm thấy bình luận.', null, 404);
  const p = await findPost(req.params.id);
  if (!p || !(await canSee(p, req.uid))) return fail(res, 'Không tìm thấy bài viết.', null, 404);
  const c = (p.comments || []).find((x) => String(x._id) === req.params.cid);
  if (!c) return fail(res, 'Không tìm thấy bình luận.', null, 404);
  const owner = String(c.user && (c.user._id || c.user));
  if (await require('../vis').blockedBetween(owner, req.uid)) return fail(res, 'Bạn không thể thả cảm xúc bình luận này.', null, 403);
  if (!c.reactions) c.reactions = [];
  const i = c.reactions.findIndex((r) => String(r.user) === req.uid);
  let removed = false;
  if (i >= 0 && c.reactions[i].emoji === e) { c.reactions.splice(i, 1); removed = true; }
  else if (i >= 0) c.reactions[i].emoji = e;
  else c.reactions.push({ user: req.uid, emoji: e });
  await p.save();
  await N.swap('comment_react', req.params.cid, owner, req.uid, removed ? null : e);
  res.json(view(p, req.uid));
}));

router.delete('/posts/:id/comments/:cid', auth, wrap(async (req, res) => {
  const p = await findPost(req.params.id);
  if (!p) return fail(res, 'Không tìm thấy bài viết.', null, 404);
  const c = (p.comments || []).find((x) => String(x._id) === req.params.cid);
  if (!c) return fail(res, 'Không tìm thấy bình luận.', null, 404);
  const authorId = String(p.author._id || p.author), by = String(c.user && (c.user._id || c.user));
  if (authorId !== req.uid && by !== req.uid) return fail(res, 'Bạn không có quyền xóa.', null, 403);
  const del = new Set([req.params.cid]);
  const gone = p.comments.filter((x) => del.has(String(x._id)) || (x.parent && del.has(String(x.parent)))).map((x) => String(x._id));
  p.comments = p.comments.filter((x) => !del.has(String(x._id)) && !(x.parent && del.has(String(x.parent))));
  await p.save();
  for (const id of gone) await N.purge(['comment_react'], id);
  await p.populate({ path: 'comments.user', select: 'avatar blueTick' });
  res.json(view(p, req.uid));
}));
};
module.exports.parseLocation = parseLocation;   // cho unit test
