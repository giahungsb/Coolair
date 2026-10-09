/* Diễn đàn độc lập (forum) – port module `forum` của phpFox 3.0 (viết lại bằng Node + MongoDB, không chép mã PHP).
   Giữ cách phpFox vận hành: chuyên mục -> box diễn đàn -> chủ đề -> bài trả lời; mod riêng từng box;
   chủ đề ghim / khóa / tinh hoa; theo dõi chủ đề hoặc cả box; lượt xem; thông báo khi có trả lời mới. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, ForumCat, Forum, ForumThread, ForumPost, ForumSub, Notification } = require('./models');
const { filter: censorFilter } = require('./censor');
const { award } = require('./credit');

const PER = 20, POST_PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_forum.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N, isAdmin, alog }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    req.me = u; next();
  });
  // mod của box = admin site hoặc có tên trong forum.moderators
  const canMod = async (forum, uid) => {
    if (!forum) return false;
    if ((forum.moderators || []).some((m) => String(m) === String(uid))) return true;
    const u = await User.findById(uid).select('email');
    return !!(u && isAdmin(u));
  };
  const tView = (t, forum) => ({ id: String(t._id), forum: forum ? { id: String(forum._id), name: forum.name } : undefined,
    title: t.title, author: t.author && t.author.name ? { id: String(t.author._id || t.author), name: t.author.name, avatar: t.author.avatar || '' } : null,
    views: t.views || 0, replyNum: t.replyNum || 0, sticky: !!t.sticky, locked: !!t.locked, digest: !!t.digest,
    lastAt: t.lastAt, lastBy: t.lastBy || '', createdAt: t.createdAt });

  /* ---------- Đọc ---------- */
  router.get('/forums/latest', auth, wrap(async (req, res) => {   // chủ đề mới nhất toàn diễn đàn
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, rows] = await Promise.all([
      ForumThread.countDocuments({}),
      ForumThread.find({}).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar').populate('forum', 'name'),
    ]);
    res.json({ total, page, per: PER, threads: rows.map((t) => tView(t, t.forum)) });
  }));

  router.get('/forums/subs', auth, wrap(async (req, res) => {   // chủ đề/box tôi đang theo dõi
    const subs = await ForumSub.find({ user: req.uid }).populate('thread').populate('forum', 'name').sort({ createdAt: -1 }).lean();
    res.json({ subs: subs.filter((s) => s.thread || s.forum).map((s) => s.thread
      ? { kind: 'thread', thread: { id: String(s.thread._id), title: s.thread.title, replyNum: s.thread.replyNum || 0, lastAt: s.thread.lastAt } }
      : { kind: 'forum', forum: { id: String(s.forum._id), name: s.forum.name } }) });
  }));

  router.get('/forums', auth, wrap(async (req, res) => {
    const cats = await ForumCat.find({}).sort({ displayorder: 1 }).lean();
    const forums = await Forum.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name, desc: c.desc || '',
      forums: forums.filter((f) => String(f.cat) === String(c._id)).map((f) => ({
        id: String(f._id), name: f.name, desc: f.desc || '', threadNum: f.threadNum || 0, postNum: f.postNum || 0,
        lastAt: f.lastAt || null, lastBy: f.lastBy || '', closed: !!f.closed })) })) });
  }));

  router.get('/forums/threads/:tid', auth, wrap(async (req, res) => {
    const t = oid(req.params.tid) && await ForumThread.findById(req.params.tid).populate('author', 'name avatar').populate('forum', 'name closed');
    if (!t || !t.forum) return bad(res, 'Không tìm thấy chủ đề.');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, posts] = await Promise.all([
      ForumPost.countDocuments({ thread: t._id }),
      ForumPost.find({ thread: t._id }).sort({ createdAt: 1 }).skip((page - 1) * POST_PER).limit(POST_PER).populate('author', 'name avatar').lean(),
    ]);
    t.views = (t.views || 0) + 1; await t.save();   // lượt xem (như phpFox)
    const subbed = await ForumSub.exists({ user: req.uid, thread: t._id });
    const mine = String(t.author._id || t.author) === req.uid;
    const mod = await canMod(t.forum, req.uid);
    res.json({ thread: { ...tView(t, t.forum), text: t.text, mine, mod,
        subbed: !!subbed, author: { id: String(t.author._id), name: t.author.name, avatar: t.author.avatar || '' } },
      total, page, per: POST_PER,
      posts: posts.filter((p) => p.author).map((p) => ({ id: String(p._id), text: p.text, createdAt: p.createdAt,
        author: { id: String(p.author._id), name: p.author.name, avatar: p.author.avatar || '' }, mine: String(p.author._id) === req.uid })) });
  }));

  router.get('/forums/:id', auth, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Forum.findById(req.params.id).populate('cat', 'name');
    if (!f) return bad(res, 'Không tìm thấy diễn đàn.');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, rows] = await Promise.all([
      ForumThread.countDocuments({ forum: f._id }),
      ForumThread.find({ forum: f._id }).sort({ sticky: -1, lastAt: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar'),
    ]);
    const subbed = await ForumSub.exists({ user: req.uid, forum: f._id });
    const mod = await canMod(f, req.uid);
    res.json({ forum: { id: String(f._id), name: f.name, desc: f.desc || '', cat: f.cat ? f.cat.name : '',
      threadNum: f.threadNum || 0, postNum: f.postNum || 0, closed: !!f.closed, subbed: !!subbed, mod },
      total, page, per: PER, threads: rows.map((t) => tView(t)) });
  }));

  /* ---------- Viết ---------- */
  router.post('/forums/:id/threads', auth, talkLimit, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Forum.findById(req.params.id);
    if (!f) return bad(res, 'Không tìm thấy diễn đàn.');
    if (f.closed) return fail(res, 'Diễn đàn này đã đóng, không đăng chủ đề mới được.');
    const title = S(req.body.title).trim(), text = S(req.body.text).trim();
    if (!title || title.length > 120) return fail(res, 'Tiêu đề cần 1–120 ký tự.');
    if (!text || text.length > 10000) return fail(res, 'Nội dung cần 1–10000 ký tự.');
    const me = await User.findById(req.uid).select('name');
    const t = await ForumThread.create({ forum: f._id, author: req.uid, title: await censorFilter(title), text: await censorFilter(text), lastBy: me.name });
    await Forum.updateOne({ _id: f._id }, { $inc: { threadNum: 1 }, $set: { lastThread: t._id, lastAt: new Date(), lastBy: me.name } });
    await ForumSub.create({ user: req.uid, thread: t._id });   // người đăng tự theo dõi chủ đề của mình (như phpFox)
    await award(req.uid, 'forum_thread', 'Đăng chủ đề diễn đàn');
    res.status(201).json({ thread: { id: String(t._id), title: t.title } });
  }));

  router.post('/forums/threads/:tid/posts', auth, talkLimit, wrap(async (req, res) => {
    const t = oid(req.params.tid) && await ForumThread.findById(req.params.tid).populate('forum', 'closed moderators');
    if (!t || !t.forum) return bad(res, 'Không tìm thấy chủ đề.');
    if (t.locked) return fail(res, 'Chủ đề này đã bị khóa, không trả lời thêm được.');
    if (t.forum.closed) return fail(res, 'Diễn đàn này đã đóng.');
    const text = S(req.body.text).trim();
    if (!text || text.length > 10000) return fail(res, 'Nội dung trả lời cần 1–10000 ký tự.');
    const me = await User.findById(req.uid).select('name');
    const p = await ForumPost.create({ thread: t._id, author: req.uid, text: await censorFilter(text) });
    await ForumThread.updateOne({ _id: t._id }, { $inc: { replyNum: 1 }, $set: { lastAt: new Date(), lastBy: me.name } });
    await Forum.updateOne({ _id: t.forum._id }, { $inc: { postNum: 1 }, $set: { lastThread: t._id, lastAt: new Date(), lastBy: me.name } });
    // thông báo: chủ chủ đề + người theo dõi (trừ người vừa trả lời)
    await N.add('forum_reply', String(t._id), t.author, req.uid);
    const subs = await ForumSub.find({ $or: [{ thread: t._id }, { forum: t.forum._id }] }).select('user').lean();
    await N.addMany('forum_sub_reply', String(t._id), subs.map((s) => s.user).filter((u) => String(u) !== String(t.author)), req.uid);
    await award(req.uid, 'forum_post', 'Trả lời chủ đề diễn đàn');
    res.status(201).json({ post: { id: String(p._id), text: p.text, createdAt: p.createdAt } });
  }));

  router.post('/forums/threads/:tid/sub', auth, wrap(async (req, res) => {
    const t = oid(req.params.tid) && await ForumThread.exists({ _id: req.params.tid });
    if (!t) return bad(res, 'Không tìm thấy chủ đề.');
    try { await ForumSub.create({ user: req.uid, thread: req.params.tid }); }
    catch (e) { if (e.code !== 11000) throw e; }
    res.json({ ok: true, subbed: true });
  }));
  router.delete('/forums/threads/:tid/sub', auth, wrap(async (req, res) => {
    const tid = oid(req.params.tid);
    if (!tid) return bad(res, 'Không tìm thấy chủ đề.');   // oid null -> 404, không để `thread: undefined` khớp nhầm
    await ForumSub.deleteOne({ user: req.uid, thread: tid });
    res.json({ ok: true, subbed: false });
  }));
  router.post('/forums/:id/sub', auth, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Forum.exists({ _id: req.params.id });
    if (!f) return bad(res, 'Không tìm thấy diễn đàn.');
    try { await ForumSub.create({ user: req.uid, forum: req.params.id }); }
    catch (e) { if (e.code !== 11000) throw e; }
    res.json({ ok: true, subbed: true });
  }));
  router.delete('/forums/:id/sub', auth, wrap(async (req, res) => {
    await ForumSub.deleteOne({ user: req.uid, forum: oid(req.params.id) || undefined });
    res.json({ ok: true, subbed: false });
  }));

  // Sửa / ghim / khóa / tinh hoa (chủ đề: chủ sửa nội dung; mod/admin: ghim/khóa/tinh hoa)
  router.patch('/forums/threads/:tid', auth, wrap(async (req, res) => {
    const t = oid(req.params.tid) && await ForumThread.findById(req.params.tid).populate('forum', 'moderators');
    if (!t || !t.forum) return bad(res, 'Không tìm thấy chủ đề.');
    const mine = String(t.author) === req.uid, mod = await canMod(t.forum, req.uid);
    if (!mine && !mod) return fail(res, 'Bạn không có quyền sửa chủ đề này.', null, 403);
    const set = {};
    if (mine || mod) {
      const title = S(req.body.title).trim(), text = S(req.body.text).trim();
      if (title) { if (title.length > 120) return fail(res, 'Tiêu đề tối đa 120 ký tự.'); set.title = await censorFilter(title); }
      if (text) { if (text.length > 10000) return fail(res, 'Nội dung tối đa 10000 ký tự.'); set.text = await censorFilter(text); }
    }
    if (mod) for (const k of ['sticky', 'locked', 'digest']) if (req.body[k] !== undefined) set[k] = req.body[k] === true;
    if (!Object.keys(set).length) return fail(res, 'Không có gì để sửa.');
    await ForumThread.updateOne({ _id: t._id }, { $set: set });
    res.json({ ok: true });
  }));

  router.delete('/forums/threads/:tid', auth, wrap(async (req, res) => {
    const t = oid(req.params.tid) && await ForumThread.findById(req.params.tid).populate('forum', 'moderators');
    if (!t || !t.forum) return bad(res, 'Không tìm thấy chủ đề.');
    const mine = String(t.author) === req.uid, mod = await canMod(t.forum, req.uid);
    if (!mine && !mod) return fail(res, 'Bạn không có quyền xóa chủ đề này.', null, 403);
    const [postIds] = await Promise.all([ForumPost.find({ thread: t._id }).select('_id').lean()]);
    await Promise.all([
      ForumPost.deleteMany({ thread: t._id }),
      ForumSub.deleteMany({ thread: t._id }),
      Notification.deleteMany({ item: { $in: [String(t._id), ...postIds.map((p) => String(p._id))] } }),
      ForumThread.deleteOne({ _id: t._id }),
      Forum.updateOne({ _id: t.forum._id }, { $inc: { threadNum: -1, postNum: -(t.replyNum || 0) } }),
    ]);
    res.json({ ok: true });
  }));

  router.delete('/forums/posts/:pid', auth, wrap(async (req, res) => {
    const p = oid(req.params.pid) && await ForumPost.findById(req.params.pid).populate({ path: 'thread', populate: { path: 'forum', select: 'moderators' } });
    if (!p || !p.thread || !p.thread.forum) return bad(res, 'Không tìm thấy bài trả lời.');
    const mine = String(p.author) === req.uid, mod = await canMod(p.thread.forum, req.uid);
    if (!mine && !mod) return fail(res, 'Bạn không có quyền xóa bài này.', null, 403);
    await Promise.all([
      ForumPost.deleteOne({ _id: p._id }),
      Notification.deleteMany({ item: String(p._id) }),
      ForumThread.updateOne({ _id: p.thread._id }, { $inc: { replyNum: -1 } }),
      Forum.updateOne({ _id: p.thread.forum._id }, { $inc: { postNum: -1 } }),
    ]);
    res.json({ ok: true });
  }));

  /* ---------- Quản trị (admincp_forum của phpFox) ---------- */
  router.get('/admin/forum-cats', auth, adminOnly, wrap(async (req, res) => {
    const cats = await ForumCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name, desc: c.desc || '', displayorder: c.displayorder || 0 })) });
  }));
  router.post('/admin/forum-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 60) return fail(res, 'Tên chuyên mục cần 1–60 ký tự.');
    const c = await ForumCat.create({ name, desc: S(req.body.desc).trim().slice(0, 300), displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'forumcat_add', name); res.status(201).json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.patch('/admin/forum-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await ForumCat.findById(req.params.id);
    if (!c) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 60) return fail(res, 'Tên tối đa 60 ký tự.'); c.name = name; }
    if (req.body.desc !== undefined) c.desc = S(req.body.desc).trim().slice(0, 300);
    if (req.body.displayorder !== undefined) c.displayorder = Number(req.body.displayorder) || 0;
    await c.save(); alog(req.uid, 'forumcat_edit', c.name); res.json({ ok: true });
  }));
  router.delete('/admin/forum-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await ForumCat.findById(req.params.id);
    if (!c) return bad(res);
    if (await Forum.exists({ cat: c._id })) return fail(res, 'Chuyên mục còn diễn đàn, hãy chuyển/xóa hết diễn đàn trước.', null, 409);
    await c.deleteOne(); alog(req.uid, 'forumcat_del', c.name); res.json({ ok: true });
  }));

  router.get('/admin/forums', auth, adminOnly, wrap(async (req, res) => {
    const forums = await Forum.find({}).populate('cat', 'name').sort({ displayorder: 1 }).lean();
    res.json({ forums: forums.map((f) => ({ id: String(f._id), cat: f.cat ? f.cat.name : '', name: f.name,
      desc: f.desc || '', displayorder: f.displayorder || 0, closed: !!f.closed,
      threadNum: f.threadNum || 0, postNum: f.postNum || 0, moderators: (f.moderators || []).map(String) })) });
  }));
  router.post('/admin/forums', auth, adminOnly, wrap(async (req, res) => {
    const cat = oid(req.body.cat), name = S(req.body.name).trim();
    if (!cat || !(await ForumCat.exists({ _id: cat }))) return fail(res, 'Chuyên mục không hợp lệ.');
    if (!name || name.length > 80) return fail(res, 'Tên diễn đàn cần 1–80 ký tự.');
    const f = await Forum.create({ cat, name, desc: S(req.body.desc).trim().slice(0, 500), displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'forum_add', name); res.status(201).json({ forum: { id: String(f._id), name: f.name } });
  }));
  router.patch('/admin/forums/:id', auth, adminOnly, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Forum.findById(req.params.id);
    if (!f) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 80) return fail(res, 'Tên tối đa 80 ký tự.'); f.name = name; }
    if (req.body.desc !== undefined) f.desc = S(req.body.desc).trim().slice(0, 500);
    if (req.body.cat !== undefined) { const cat = oid(req.body.cat); if (!cat || !(await ForumCat.exists({ _id: cat }))) return fail(res, 'Chuyên mục không hợp lệ.'); f.cat = cat; }
    if (req.body.displayorder !== undefined) f.displayorder = Number(req.body.displayorder) || 0;
    if (req.body.closed !== undefined) f.closed = req.body.closed === true;
    if (req.body.moderators !== undefined) {   // danh sách id người dùng làm mod box
      const ids = (Array.isArray(req.body.moderators) ? req.body.moderators : []).filter(oid).slice(0, 20);
      f.moderators = (await User.find({ _id: { $in: ids } }).select('_id').lean()).map((u) => u._id);
    }
    await f.save(); alog(req.uid, 'forum_edit', f.name); res.json({ ok: true });
  }));
  router.delete('/admin/forums/:id', auth, adminOnly, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Forum.findById(req.params.id);
    if (!f) return bad(res);
    const threads = await ForumThread.find({ forum: f._id }).select('_id').lean();
    const tids = threads.map((t) => t._id);
    const posts = tids.length ? await ForumPost.find({ thread: { $in: tids } }).select('_id').lean() : [];
    await Promise.all([
      ForumPost.deleteMany({ thread: { $in: tids } }),
      ForumSub.deleteMany({ $or: [{ forum: f._id }, { thread: { $in: tids } }] }),
      ForumThread.deleteMany({ forum: f._id }),
      Notification.deleteMany({ item: { $in: [...tids, ...posts.map((p) => p._id)].map(String) } }),
      f.deleteOne(),
    ]);
    alog(req.uid, 'forum_del', f.name); res.json({ ok: true });
  }));
};
