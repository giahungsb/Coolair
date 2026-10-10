/* Topic – chủ đề nóng (port từ UCenter Home cp_topic/space_topic):
   admin tạo chủ đề, người dùng tham gia và gắn bài viết / nhật ký / trạng thái của mình vào. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Post, Blog, Doing, Topic, TopicMember, TopicPost } = require('./models');
const { blockedBetween } = require('./vis');

const lim = rateLimit({ store: rlStore('topic.lim'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });
const ATTACHABLE = { post: Post, blog: Blog, doing: Doing };

module.exports = (router, { auth, wrap, fail, S, isAdmin }) => {
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const tView = (t, joined) => ({ id: t._id, title: t.title, desc: t.desc || '', pic: t.pic || '', hot: !!t.hot,
    closed: !!t.closed, joinNum: t.joinNum || 0, postNum: t.postNum || 0, createdAt: t.createdAt, joined: !!joined });

  router.get('/topics', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const mine = await TopicMember.find({ user: req.uid }).select('topic').lean();
    const joined = new Set(mine.map((m) => String(m.topic)));
    const isAdm = await User.findById(req.uid).select('email siteAdmin').lean().then((u) => isAdmin(u));
    const q = (isAdm && S(req.query.all) === '1') ? {} : { closed: { $ne: true } };
    const [total, rows] = await Promise.all([
      Topic.countDocuments(q),
      Topic.find(q).sort({ hot: -1, joinNum: -1, _id: -1 }).skip((page - 1) * per).limit(per).lean(),
    ]);
    res.json({ total, page, per, topics: rows.map((t) => tView(t, joined.has(String(t._id)))) });
  }));

  router.post('/topics', auth, adminOnly, wrap(async (req, res) => {
    const title = S(req.body.title).trim(), desc = S(req.body.desc).trim().slice(0, 300), pic = S(req.body.pic).trim().slice(0, 500);
    if (!title || title.length > 60) return fail(res, 'Tên chủ đề cần từ 1 đến 60 ký tự.');
    const t = await Topic.create({ title, desc, pic, hot: req.body.hot === true });
    res.status(201).json({ topic: tView(t.toObject(), false) });
  }));

  router.patch('/topics/:id', auth, adminOnly, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findById(req.params.id) : null;
    if (!t) return fail(res, 'Không tìm thấy chủ đề.', null, 404);
    if (req.body.title !== undefined) { const v = S(req.body.title).trim(); if (!v || v.length > 60) return fail(res, 'Tên không hợp lệ.'); t.title = v; }
    if (req.body.desc !== undefined) t.desc = S(req.body.desc).trim().slice(0, 300);
    if (req.body.pic !== undefined) t.pic = S(req.body.pic).trim().slice(0, 500);
    if (req.body.hot !== undefined) t.hot = req.body.hot === true;
    if (req.body.closed !== undefined) t.closed = req.body.closed === true;
    await t.save();
    res.json({ topic: tView(t.toObject(), false) });
  }));

  router.delete('/topics/:id', auth, adminOnly, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findByIdAndDelete(req.params.id) : null;
    if (!t) return fail(res, 'Không tìm thấy chủ đề.', null, 404);
    await Promise.all([TopicMember.deleteMany({ topic: t._id }), TopicPost.deleteMany({ topic: t._id })]);
    res.json({ ok: true });
  }));

  router.post('/topics/:id/join', auth, lim, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findById(req.params.id) : null;
    if (!t || t.closed) return fail(res, 'Chủ đề không tồn tại hoặc đã đóng.', null, 404);
    try { await TopicMember.create({ topic: t._id, user: req.uid }); await Topic.updateOne({ _id: t._id }, { $inc: { joinNum: 1 } }); }
    catch (e) { if (e.code !== 11000) throw e; }
    res.json({ ok: true });
  }));

  router.delete('/topics/:id/join', auth, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findById(req.params.id) : null;
    if (!t) return fail(res, 'Không tìm thấy chủ đề.', null, 404);
    const r = await TopicMember.deleteOne({ topic: t._id, user: req.uid });
    if (r.deletedCount) await Topic.updateOne({ _id: t._id }, { $inc: { joinNum: -1 } });
    await TopicPost.deleteMany({ topic: t._id, author: req.uid });
    res.json({ ok: true });
  }));

  router.get('/topics/:id', auth, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findById(req.params.id).lean() : null;
    if (!t) return fail(res, 'Không tìm thấy chủ đề.', null, 404);
    if (t.closed) {   // chủ đề đã đóng: chỉ admin xem được (danh sách đã ẩn)
      const me = await User.findById(req.uid).select('email siteAdmin').lean();
      if (!isAdmin(me)) return fail(res, 'Không tìm thấy chủ đề.', null, 404);
    }
    const joined = await TopicMember.exists({ topic: t._id, user: req.uid });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 15;
    const [total, atts] = await Promise.all([
      TopicPost.countDocuments({ topic: t._id }),
      TopicPost.find({ topic: t._id }).sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).lean(),
    ]);
    const items = [];
    for (const a of atts) {
      const M = ATTACHABLE[a.kind];
      const doc = M ? await M.findById(a.target).select(a.kind === 'blog' ? 'title' : 'text').lean() : null;
      if (!doc) continue;
      const au = await User.findById(a.author).select('name avatar').lean();
      items.push({ id: a._id, kind: a.kind, target: String(a.target), title: a.kind === 'blog' ? doc.title : String(doc.text || '').slice(0, 100),
        author: au ? { id: String(au._id), name: au.name, avatar: au.avatar || '' } : null, createdAt: a.createdAt });
    }
    res.json({ topic: tView(t, joined), total, page, per, items });
  }));

  router.post('/topics/:id/attach', auth, lim, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await Topic.findById(req.params.id) : null;
    if (!t || t.closed) return fail(res, 'Chủ đề không tồn tại hoặc đã đóng.', null, 404);
    const kind = S(req.body.kind), target = S(req.body.target);
    const M = ATTACHABLE[kind];
    if (!M || !isValidObjectId(target)) return fail(res, 'Nội dung không hợp lệ.');
    const doc = await M.findById(target).select(kind === 'blog' ? 'owner visibility' : 'author visibility').lean();
    if (!doc || String(doc.author || doc.owner) !== req.uid) return fail(res, 'Chỉ gắn được nội dung của chính bạn.', null, 403);
    try { await TopicPost.create({ topic: t._id, kind, target, author: req.uid }); await Topic.updateOne({ _id: t._id }, { $inc: { postNum: 1 } }); }
    catch (e) { if (e.code === 11000) return fail(res, 'Nội dung này đã có trong chủ đề.', null, 409); throw e; }
    res.status(201).json({ ok: true });
  }));

  router.delete('/topics/:id/attach/:aid', auth, wrap(async (req, res) => {
    const a = isValidObjectId(req.params.aid) ? await TopicPost.findById(req.params.aid) : null;
    if (!a || String(a.topic) !== req.params.id) return fail(res, 'Không tìm thấy.', null, 404);
    const t = await Topic.findById(a.topic).lean();
    const me = await User.findById(req.uid).select('email siteAdmin').lean();
    if (String(a.author) !== req.uid && !isAdmin(me)) return fail(res, 'Bạn không có quyền gỡ.', null, 403);
    await a.deleteOne();
    await Topic.updateOne({ _id: a.topic }, { $inc: { postNum: -1 } });
    res.json({ ok: true });
  }));
};
