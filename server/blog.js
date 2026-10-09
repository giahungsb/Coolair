/* Nhật ký (blog) – port từ UCenter Home (space_blog / cp_blog): bài viết dài có tiêu đề, quyền riêng tư, lượt xem, bình luận.
   Khác "bài viết" ngắn trên bảng tin (Post). Nội dung là văn bản thuần: giao diện hiển thị bằng {{ }} nên không chạy được HTML/JS. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Blog, BlogCat } = require('./models');
const { award } = require('./credit');
const { blockedBetween, friendIds } = require('./vis');
const { getClicks } = require('./aconfig');
const { filter: censorFilter } = require('./censor');

const VIS = ['public', 'friends', 'private'];
const MAX_TITLE = 80, MAX_TEXT = 6000, MAX_COMMENT = 500, MAX_COMMENTS = 200, PER = 10, MAX_BLOGS = 500;   // 6000 ký tự tiếng Việt vẫn nằm trong giới hạn JSON 20kb của app.js
const talkLimit = rateLimit({ store: rlStore('blog.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, areFriends, N }) => {
  const bad = (res) => fail(res, 'Không tìm thấy nhật ký.', null, 404);
  const excerpt = (t) => (t.length > 140 ? t.slice(0, 140).trimEnd() + '…' : t);
  const bView = async (b) => ({ id: b.id, title: b.title, excerpt: excerpt(b.text), visibility: b.visibility, viewNum: b.viewNum || 0, commentNum: b.commentNum || 0,
    tags: b.tags || [], cat: b.cat && b.cat.name ? { id: String(b.cat._id || b.cat), name: b.cat.name } : null,
    clickNums: await clickNums(b), createdAt: b.createdAt, updatedAt: b.updatedAt });
  const bFull = async (b, me, owner) => ({ ...(await bView(b)), text: b.text, owner: owner ? { id: owner.id, name: owner.name, avatar: owner.avatar || '' } : null, mine: String(b.owner) === me,
    myClick: (b.clicks || []).some((c) => String(c.user) === me) ? (b.clicks.find((c) => String(c.user) === me) || {}).clickId : null,
    comments: b.comments.map((c) => ({ id: c.id, name: c.name, text: c.text, parent: c.parent ? String(c.parent) : null, av: (c.user && c.user.avatar) || '', createdAt: c.createdAt,
      canDel: String(b.owner) === me || (!!c.user && String(c.user._id || c.user) === me) })) });
  const clickNums = async (b) => { const CL = await getClicks(); const n = CL.map(() => 0); (b.clicks || []).forEach((c) => { if (c.clickId >= 0 && c.clickId < CL.length) n[c.clickId]++; }); return n; };
  const PC = { path: 'comments.user', select: 'avatar' };
  const canSee = async (b, me) => String(b.owner) === me || b.visibility === 'public' || (b.visibility === 'friends' && !!(await areFriends(me, b.owner)));
  const load = async (id, me, populate) => {
    const b = isValidObjectId(id) ? await (populate ? Blog.findById(id).populate(PC).populate('cat', 'name') : Blog.findById(id).populate('cat', 'name')) : null;
    return b && (await canSee(b, me)) ? b : null;
  };
  const fields = async (body) => {
    const title = await censorFilter(S(body.title).trim()), text = await censorFilter(S(body.text).replace(/\r\n/g, '\n').trim()), visibility = VIS.includes(S(body.visibility)) ? S(body.visibility) : 'public';
    if (!title || title.length > MAX_TITLE) return { err: `Tiêu đề cần từ 1 đến ${MAX_TITLE} ký tự.` };
    if (!text || text.length > MAX_TEXT) return { err: `Nội dung cần từ 1 đến ${MAX_TEXT} ký tự.` };
    const tags = (Array.isArray(body.tags) ? body.tags : []).map((t) => S(t).trim().replace(/\s+/g, ' ')).filter((t) => t && t.length <= 20).slice(0, 5);
    if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) return { err: 'Các tag không được trùng nhau.' };
    return { title, text, visibility, tags };
  };
  const catOf = async (uid, catId) => {
    if (!catId) return undefined;
    if (!isValidObjectId(catId)) return { err: 'Chuyên mục không hợp lệ.' };
    const c = await BlogCat.findOne({ _id: catId, owner: uid }).lean();
    if (!c) return { err: 'Chuyên mục không tồn tại.' };
    return { id: c._id };
  };

  /* Chuyên mục nhật ký (class của UCHome) */
  router.get('/blog-cats', auth, wrap(async (req, res) => {
    const mine = S(req.query.mine) !== '0';
    const owner = mine ? req.uid : (isValidObjectId(req.query.user) ? req.query.user : req.uid);
    const cats = await BlogCat.find({ owner }).sort({ name: 1 }).lean();
    // Xem chuyên mục của người khác: chỉ đếm blog mà mình được xem (không lộ số blog private)
    const { friendIds, visQ } = require('./vis');
    const match = mine ? { owner: new (require('mongoose').Types.ObjectId)(owner) }
      : { $and: [{ owner: new (require('mongoose').Types.ObjectId)(owner) }, visQ(req.uid, await friendIds(req.uid))] };
    const counts = await Blog.aggregate([{ $match: match }, { $group: { _id: '$cat', n: { $sum: 1 } } }]);
    const cm = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name, count: cm.get(String(c._id)) || 0 })) });
  }));
  router.post('/blog-cats', auth, talkLimit, wrap(async (req, res) => {
    const name = S(req.body.name).trim().slice(0, 40);
    if (name.length < 2) return fail(res, 'Tên chuyên mục cần ít nhất 2 ký tự.');
    if ((await BlogCat.countDocuments({ owner: req.uid })) >= 20) return fail(res, 'Mỗi người tối đa 20 chuyên mục.');
    try {
      const c = await BlogCat.create({ owner: req.uid, name });
      res.status(201).json({ cat: { id: String(c._id), name: c.name, count: 0 } });
    } catch (e) { if (e.code === 11000) return fail(res, 'Chuyên mục này đã có.', null, 409); throw e; }
  }));
  router.patch('/blog-cats/:id', auth, wrap(async (req, res) => {
    const name = S(req.body.name).trim().slice(0, 40);
    if (name.length < 2) return fail(res, 'Tên chuyên mục cần ít nhất 2 ký tự.');
    const c = await BlogCat.findOneAndUpdate({ _id: req.params.id, owner: req.uid }, { name }, { new: true });
    if (!c) return fail(res, 'Không tìm thấy chuyên mục.', null, 404);
    res.json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.delete('/blog-cats/:id', auth, wrap(async (req, res) => {
    const c = await BlogCat.findOneAndDelete({ _id: req.params.id, owner: req.uid });
    if (!c) return fail(res, 'Không tìm thấy chuyên mục.', null, 404);
    await Blog.updateMany({ cat: c._id }, { $unset: { cat: 1 } });
    res.json({ ok: true });
  }));

  /* Duyệt nhật ký theo tag (space_tag của UCHome) */
  router.get('/tags/:tag', auth, wrap(async (req, res) => {
    const tag = S(req.params.tag).trim().slice(0, 20);
    if (!tag) return fail(res, 'Tag không hợp lệ.');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const ids = await friendIds(req.uid);
    const q = { tags: tag, $or: [{ visibility: 'public' }, { visibility: 'friends', owner: { $in: [req.uid, ...ids] } }, { owner: req.uid }] };
    const [total, rows] = await Promise.all([
      Blog.countDocuments(q),
      Blog.find(q).sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).populate('owner', 'name avatar').lean(),
    ]);
    res.json({ tag, total, page, per, blogs: rows.filter((b) => b.owner).map((b) => ({
      id: b._id, title: b.title, excerpt: String(b.text || '').replace(/\s+/g, ' ').slice(0, 160),
      tags: b.tags || [], author: { id: String(b.owner._id), name: b.owner.name, avatar: b.owner.avatar || '' }, createdAt: b.createdAt })) });
  }));

  router.get('/blogs/suggest-tags', auth, wrap(async (req, res) => {
    const hay = (S(req.query.title) + '\n' + S(req.query.text)).toLowerCase();
    if (hay.trim().length < 4) return res.json({ tags: [] });
    const rows = await Blog.aggregate([
      { $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 300 },
    ]);
    const tags = [];
    for (const r of rows) {
      const t = String(r._id || '');
      if (t.length >= 2 && hay.includes(t.toLowerCase())) tags.push(t);
      if (tags.length >= 8) break;
    }
    res.json({ tags });
  }));

  router.get('/users/:id/blogs', auth, wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return bad(res);
    const me = req.uid, owner = req.params.id, page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { relOf, canViewSection } = require('./vis');
    const odoc = await User.findById(owner).select('privacy').lean();
    if (odoc && !canViewSection(odoc, 'blog', await relOf(me, owner))) return res.json({ blogs: [], total: 0, page, per: PER, hidden: true });
    const q = { owner };
    if (owner !== me) q.visibility = (await areFriends(me, owner)) ? { $ne: 'private' } : 'public';
    if (isValidObjectId(req.query.cat)) q.cat = req.query.cat;
    const [total, rows] = await Promise.all([Blog.countDocuments(q), Blog.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PER).limit(PER).select('-comments').populate('cat', 'name')]);
    res.json({ blogs: await Promise.all(rows.map(bView)), total, page, per: PER });
  }));

  router.post('/blogs', auth, talkLimit, wrap(async (req, res) => {
    const f = await fields(req.body);
    if (f.err) return fail(res, f.err);
    if ((await Blog.countDocuments({ owner: req.uid })) >= MAX_BLOGS) return fail(res, `Mỗi người tối đa ${MAX_BLOGS} nhật ký.`);
    const cc = await catOf(req.uid, req.body.cat);
    if (cc && cc.err) return fail(res, cc.err);
    const b = await Blog.create({ owner: req.uid, ...f, cat: cc ? cc.id : undefined });
    award(req.uid, 'blog');
    res.status(201).json({ blog: await bFull(b, req.uid, await User.findById(req.uid).select('name avatar')) });
  }));

  /* Biểu lộ cảm xúc định sẵn (click của UCHome): mỗi người một click, bấm lại để đổi/bỏ */
  router.get('/blogs/clicks', auth, wrap(async (req, res) => res.json({ clicks: await getClicks() })));

  /* Nhật ký công khai theo tag */
  router.get('/blogs', auth, wrap(async (req, res) => {
    const tag = S(req.query.tag).trim().slice(0, 20);
    if (!tag) return fail(res, 'Thiếu tag.');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = { tags: tag, visibility: 'public' };
    const [total, rows] = await Promise.all([Blog.countDocuments(q),
      Blog.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).select('-comments -text').populate('owner', 'name avatar').populate('cat', 'name').lean()]);
    res.json({ tag, total, page, per: PER, blogs: await Promise.all(rows.filter((b) => b.owner).map(async (b) => ({ ...(await bView(b)), owner: { id: String(b.owner._id), name: b.owner.name, avatar: b.owner.avatar || '' } }))) });
  }));

  router.get('/blogs/:id', auth, wrap(async (req, res) => {
    const b = await load(req.params.id, req.uid, true);
    if (!b) return bad(res);
    if (String(b.owner) !== req.uid) { await Blog.updateOne({ _id: b._id }, { $inc: { viewNum: 1 } }); b.viewNum = (b.viewNum || 0) + 1; }   // chủ nhật ký xem không tính lượt
    res.json({ blog: await bFull(b, req.uid, await User.findById(b.owner).select('name avatar')) });
  }));

  router.patch('/blogs/:id', auth, talkLimit, wrap(async (req, res) => {
    const f = await fields(req.body);
    if (f.err) return fail(res, f.err);
    const b = isValidObjectId(req.params.id) ? await Blog.findOne({ _id: req.params.id, owner: req.uid }).populate(PC) : null;
    if (!b) return bad(res);
    Object.assign(b, f);
    if (req.body.cat !== undefined) {
      const cc = await catOf(req.uid, req.body.cat);
      if (cc && cc.err) return fail(res, cc.err);
      b.cat = cc ? cc.id : undefined;
    }
    await b.save();
    res.json({ blog: await bFull(b, req.uid, await User.findById(req.uid).select('name avatar')) });
  }));

  router.delete('/blogs/:id', auth, wrap(async (req, res) => {
    const b = isValidObjectId(req.params.id) ? await Blog.findOneAndDelete({ _id: req.params.id, owner: req.uid }) : null;
    if (!b) return bad(res);
    await N.remove('blog_comment', b.id, String(b.owner));   // mục gốc đã xóa -> bỏ thông báo
    res.json({ ok: true });
  }));

  router.post('/blogs/:id/comments', auth, talkLimit, wrap(async (req, res) => {
    const text = await censorFilter(S(req.body.text).trim());
    if (!text || text.length > MAX_COMMENT) return fail(res, `Bình luận cần 1–${MAX_COMMENT} ký tự.`);
    const [u, b] = await Promise.all([User.findById(req.uid), load(req.params.id, req.uid, true)]);
    if (!u || !b) return bad(res);
    if (await blockedBetween(b.owner, req.uid)) return fail(res, 'Bạn không thể bình luận nhật ký này.', null, 403);
    if (b.comments.length >= MAX_COMMENTS) return fail(res, `Mỗi nhật ký tối đa ${MAX_COMMENTS} bình luận.`);
    let parent = null;
    if (req.body.parent) {   // trả lời đa cấp
      parent = b.comments.find((c) => String(c._id) === S(req.body.parent));
      if (!parent) return fail(res, 'Bình luận gốc không tồn tại.');
    }
    b.comments.push({ user: u.id, name: u.name, text, parent: parent ? parent._id : null });
    b.commentNum = b.comments.length;
    await b.save();
    award(req.uid, 'comment', 'blog');
    await N.add('blog_comment', b.id, String(b.owner), req.uid);
    await b.populate(PC);
    res.status(201).json({ blog: await bFull(b, req.uid, await User.findById(b.owner).select('name avatar')) });
  }));

  router.delete('/blogs/:id/comments/:cid', auth, wrap(async (req, res) => {
    const b = await load(req.params.id, req.uid, true);
    const c = b && isValidObjectId(req.params.cid) ? b.comments.id(req.params.cid) : null;
    if (!c) return bad(res);
    const by = c.user && String(c.user._id || c.user);
    if (String(b.owner) !== req.uid && by !== req.uid) return fail(res, 'Bạn không có quyền xóa bình luận này.', null, 403);
    const delIds = new Set([String(c._id)]);   // xóa cả các trả lời con
    b.comments = b.comments.filter((x) => !delIds.has(String(x._id)) && !(x.parent && delIds.has(String(x.parent))));
    b.commentNum = b.comments.length;
    await b.save();
    if (by && !b.comments.some((x) => x.user && String(x.user._id || x.user) === by)) await N.removeByOwner('blog_comment', b.id, String(b.owner), by);
    res.json({ blog: await bFull(b, req.uid, await User.findById(b.owner).select('name avatar')) });
  }));

  router.post('/blogs/:id/click', auth, talkLimit, wrap(async (req, res) => {
    const clickId = Math.floor(Number(req.body.clickId));
    const CL = await getClicks();
    if (!Number.isInteger(clickId) || clickId < 0 || clickId >= CL.length) return fail(res, 'Biểu lộ không hợp lệ.');
    const b = await load(req.params.id, req.uid, false);
    if (!b) return bad(res);
    if (await blockedBetween(b.owner, req.uid)) return fail(res, 'Bạn không thể bày tỏ cảm xúc ở đây.', null, 403);
    const i = (b.clicks || []).findIndex((c) => String(c.user) === req.uid);
    if (i >= 0 && b.clicks[i].clickId === clickId) b.clicks.splice(i, 1);        // bấm lại = bỏ
    else if (i >= 0) b.clicks[i].clickId = clickId;                              // đổi sang cái khác
    else b.clicks.push({ user: req.uid, clickId });
    await b.save();
    res.json({ clickNums: await clickNums(b), myClick: (b.clicks.find((c) => String(c.user) === req.uid) || {}).clickId ?? null });
  }));
};
