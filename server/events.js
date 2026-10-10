/* Sự kiện (event) – port ý tưởng từ UCenter Home (space_event / cp_event): tiêu đề, thời gian, địa điểm, giới hạn người,
   tham gia (going) / có thể (maybe), bình luận. Nội dung là văn bản thuần (giao diện hiển thị bằng {{ }}). */
const { isValidObjectId } = require('mongoose');
const { need } = require('./perms');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Event, EventMember, EventCat } = require('./models');
const { friendIds, visQ, blockedBetween } = require('./vis');

const VIS = ['public', 'friends', 'private'];
const MAX_TITLE = 80, MAX_DETAIL = 2000, MAX_LOC = 80, MAX_COMMENT = 500, MAX_COMMENTS = 200, PER = 10, MAX_EVENTS = 100, MAX_LIMIT = 5000;
const talkLimit = rateLimit({ store: rlStore('events.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N }) => {
  const bad = (res) => fail(res, 'Không tìm thấy sự kiện.', null, 404);
  const ownerOf = (u) => (u ? { id: u.id, name: u.name, avatar: u.avatar || '' } : null);
  const eView = (e, mine, owner) => ({ id: e.id, title: e.title, location: e.location, start: e.start, end: e.end || null, visibility: e.visibility, limit: e.limit || 0,
    cat: e.cat && e.cat.name ? { id: String(e.cat._id || e.cat), name: e.cat.name } : null,
    goingNum: e.goingNum || 0, maybeNum: e.maybeNum || 0, commentNum: e.commentNum || 0, past: e.endAt < new Date(), mine: String(e.owner._id || e.owner) === mine, owner: ownerOf(owner) });
  const PC = { path: 'comments.user', select: 'avatar' };
  const canSee = async (e, me) => String(e.owner) === me || e.visibility === 'public' || (e.visibility === 'friends' && (await friendIds(me)).some((x) => String(x) === String(e.owner)));
  const load = async (id, me, populate) => {
    const e = isValidObjectId(id) ? await (populate ? Event.findById(id).populate(PC).populate('cat', 'name') : Event.findById(id).populate('cat', 'name')) : null;
    return e && (await canSee(e, me)) ? e : null;
  };
  const full = async (e, me) => {
    const [owner, my, going] = await Promise.all([User.findById(e.owner).select('name avatar'), EventMember.findOne({ event: e._id, user: me }).select('status').lean(),
      EventMember.find({ event: e._id, status: 'going' }).sort({ createdAt: 1 }).limit(24).populate('user', 'name avatar').lean()]);
    return { ...eView(e, me, owner), detail: e.detail, my: my ? my.status : '',
      going: going.filter((m) => m.user).map((m) => ({ id: String(m.user._id), name: m.user.name, avatar: m.user.avatar || '' })),
      comments: e.comments.map((c) => ({ id: c.id, name: c.name, text: c.text, av: (c.user && c.user.avatar) || '', createdAt: c.createdAt,
        canDel: String(e.owner) === me || (!!c.user && String(c.user._id || c.user) === me) })) };
  };
  const recount = async (e) => {
    const [g, m] = await Promise.all([EventMember.countDocuments({ event: e._id, status: 'going' }), EventMember.countDocuments({ event: e._id, status: 'maybe' })]);
    e.goingNum = g; e.maybeNum = m;
    await Event.updateOne({ _id: e._id }, { goingNum: g, maybeNum: m });
  };
  const catOf = async (catId) => {
    if (!catId) return undefined;
    if (!isValidObjectId(catId)) return { err: 'Phân loại không hợp lệ.' };
    const c = await EventCat.findById(catId).lean();
    if (!c) return { err: 'Phân loại không tồn tại.' };
    return { id: c._id };
  };
  const fields = (b) => {
    const title = S(b.title).trim(), detail = S(b.detail).replace(/\r\n/g, '\n').trim(), location = S(b.location).trim();
    const visibility = VIS.includes(S(b.visibility)) ? S(b.visibility) : 'public';
    const start = new Date(S(b.start)), end = S(b.end) ? new Date(S(b.end)) : null, limit = Math.floor(Number(b.limit) || 0);
    const yr = 5 * 365 * 24 * 3600 * 1000, now = Date.now();
    if (!title || title.length > MAX_TITLE) return { err: `Tên sự kiện cần từ 1 đến ${MAX_TITLE} ký tự.` };
    if (detail.length > MAX_DETAIL) return { err: `Mô tả tối đa ${MAX_DETAIL} ký tự.` };
    if (location.length > MAX_LOC) return { err: `Địa điểm tối đa ${MAX_LOC} ký tự.` };
    if (isNaN(start) || Math.abs(start - now) > yr) return { err: 'Thời gian bắt đầu không hợp lệ.' };
    if (end && (isNaN(end) || end < start || end - start > 366 * 24 * 3600 * 1000)) return { err: 'Thời gian kết thúc phải sau thời gian bắt đầu (tối đa 1 năm).' };
    if (limit < 0 || limit > MAX_LIMIT) return { err: `Giới hạn người tham gia từ 0 đến ${MAX_LIMIT} (0 = không giới hạn).` };
    return { title, detail, location, start, end: end || undefined, endAt: end || start, visibility, limit };
  };

  router.get('/event-cats', auth, wrap(async (req, res) => {
    const cats = await EventCat.find().sort({ name: 1 }).lean();
    const counts = await Event.aggregate([{ $group: { _id: '$cat', n: { $sum: 1 } } }]);
    const cm = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name, count: cm.get(String(c._id)) || 0 })) });
  }));

  router.get('/events', auth, wrap(async (req, res) => {
    const me = req.uid, view = ['upcoming', 'past', 'mine', 'going'].includes(S(req.query.view)) ? S(req.query.view) : 'upcoming';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), now = new Date();
    let q, sort = { start: 1, _id: 1 };
    if (view === 'mine') { q = { owner: me }; sort = { start: -1, _id: -1 }; }
    else {
      const ids = await friendIds(me);
      q = { ...visQ(me, ids) };
      if (view === 'going') { const ms = await EventMember.find({ user: me }).select('event').lean(); q = { _id: { $in: ms.map((m) => m.event) }, ...visQ(me, ids) }; }
      else if (view === 'past') { q.endAt = { $lt: now }; sort = { start: -1, _id: -1 }; }
      else q.endAt = { $gte: now };
    }
    if (isValidObjectId(req.query.cat)) q.cat = req.query.cat;
    const [total, rows] = await Promise.all([Event.countDocuments(q), Event.find(q).sort(sort).skip((page - 1) * PER).limit(PER).select('-comments -detail').populate('owner', 'name avatar').populate('cat', 'name')]);
    res.json({ events: rows.map((e) => eView(e, me, e.owner)), total, page, per: PER });
  }));

  router.post('/events', auth, talkLimit, need('event_create'), wrap(async (req, res) => {
    const f = fields(req.body);
    if (f.err) return fail(res, f.err);
    const cc = await catOf(req.body.cat);
    if (cc && cc.err) return fail(res, cc.err);
    if ((await Event.countDocuments({ owner: req.uid })) >= MAX_EVENTS) return fail(res, `Mỗi người tối đa ${MAX_EVENTS} sự kiện.`);
    const e = await Event.create({ owner: req.uid, ...f, cat: cc ? cc.id : undefined });
    await EventMember.create({ event: e._id, user: req.uid, status: 'going' });   // người tạo mặc định tham gia
    await recount(e);
    res.status(201).json({ event: await full(e, req.uid) });
  }));

  router.get('/events/:id', auth, wrap(async (req, res) => {
    const e = await load(req.params.id, req.uid, true);
    if (!e) return bad(res);
    res.json({ event: await full(e, req.uid) });
  }));

  router.patch('/events/:id', auth, talkLimit, wrap(async (req, res) => {
    const f = fields(req.body);
    if (f.err) return fail(res, f.err);
    const e = await Event.findOne({ _id: req.params.id, owner: req.uid }).populate(PC);
    if (!e) return bad(res);
    if (f.limit && f.limit < e.goingNum) return fail(res, `Đã có ${e.goingNum} người tham gia, giới hạn không được thấp hơn.`);
    if (req.body.cat !== undefined) {
      const cc = await catOf(req.body.cat);
      if (cc && cc.err) return fail(res, cc.err);
      e.cat = cc ? cc.id : undefined;
    }
    Object.assign(e, f);
    await e.save();
    res.json({ event: await full(e, req.uid) });
  }));

  router.delete('/events/:id', auth, wrap(async (req, res) => {
    const e = await Event.findOneAndDelete({ _id: req.params.id, owner: req.uid });
    if (!e) return bad(res);
    await EventMember.deleteMany({ event: e._id });
    await Promise.all([N.remove('event_comment', e.id, String(e.owner)), N.remove('event_join', e.id, String(e.owner))]);
    res.json({ ok: true });
  }));

  router.post('/events/:id/join', auth, talkLimit, wrap(async (req, res) => {
    const status = S(req.body.status);
    if (!['going', 'maybe'].includes(status)) return fail(res, 'Trạng thái không hợp lệ.');
    const e = await load(req.params.id, req.uid, true);
    if (!e) return bad(res);
    if (e.endAt < new Date()) return fail(res, 'Sự kiện này đã kết thúc.');
    if (await blockedBetween(e.owner, req.uid)) return fail(res, 'Bạn không thể tham gia sự kiện này.', null, 403);
    const cur = await EventMember.findOne({ event: e._id, user: req.uid });
    if (status === 'going' && (!cur || cur.status !== 'going') && e.limit) {
      // Chiếm chỗ NGUYÊN TỬ: chỉ cho qua khi goingNum < limit (2 request song song không thể cùng lọt)
      const seat = await Event.updateOne({ _id: e._id, goingNum: { $lt: e.limit } }, { $inc: { goingNum: 1 } });
      if (!seat.modifiedCount) return fail(res, 'Sự kiện đã đủ người tham gia.', null, 409);
    }
    await EventMember.updateOne({ event: e._id, user: req.uid }, { $set: { status } }, { upsert: true });
    await recount(e);   // đồng bộ lại số liệu thật từ members
    if (status === 'going') await N.add('event_join', e.id, String(e.owner), req.uid);
    else await N.removeByOwner('event_join', e.id, String(e.owner), req.uid);
    res.json({ event: await full(e, req.uid) });
  }));

  router.delete('/events/:id/join', auth, wrap(async (req, res) => {
    const e = await load(req.params.id, req.uid, true);
    if (!e) return bad(res);
    if (String(e.owner) === req.uid) return fail(res, 'Người tạo sự kiện không thể rút khỏi sự kiện của mình.');
    await EventMember.deleteOne({ event: e._id, user: req.uid });
    await recount(e);
    await N.removeByOwner('event_join', e.id, String(e.owner), req.uid);
    res.json({ event: await full(e, req.uid) });
  }));

  router.get('/events/:id/members', auth, wrap(async (req, res) => {
    const e = await load(req.params.id, req.uid);
    if (!e) return bad(res);
    const status = S(req.query.status) === 'maybe' ? 'maybe' : 'going', page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 30;
    const [total, rows] = await Promise.all([EventMember.countDocuments({ event: e._id, status }),
      EventMember.find({ event: e._id, status }).sort({ createdAt: 1 }).skip((page - 1) * per).limit(per).populate('user', 'name avatar').lean()]);
    res.json({ total, page, per, users: rows.filter((m) => m.user).map((m) => ({ id: String(m.user._id), name: m.user.name, avatar: m.user.avatar || '' })) });
  }));

  router.post('/events/:id/comments', auth, talkLimit, need('comment'), wrap(async (req, res) => {
    const text = S(req.body.text).trim();
    if (!text || text.length > MAX_COMMENT) return fail(res, `Bình luận cần 1–${MAX_COMMENT} ký tự.`);
    const [u, e] = await Promise.all([User.findById(req.uid), load(req.params.id, req.uid, true)]);
    if (!u || !e) return bad(res);
    if (await blockedBetween(e.owner, req.uid)) return fail(res, 'Bạn không thể bình luận sự kiện này.', null, 403);
    if (e.comments.length >= MAX_COMMENTS) return fail(res, `Mỗi sự kiện tối đa ${MAX_COMMENTS} bình luận.`);
    e.comments.push({ user: u.id, name: u.name, text });
    e.commentNum = e.comments.length;
    await e.save();
    await N.add('event_comment', e.id, String(e.owner), req.uid);
    await e.populate(PC);
    res.status(201).json({ event: await full(e, req.uid) });
  }));

  router.delete('/events/:id/comments/:cid', auth, wrap(async (req, res) => {
    const e = await load(req.params.id, req.uid, true);
    const c = e && isValidObjectId(req.params.cid) ? e.comments.id(req.params.cid) : null;
    if (!c) return bad(res);
    const by = c.user && String(c.user._id || c.user);
    if (String(e.owner) !== req.uid && by !== req.uid) return fail(res, 'Bạn không có quyền xóa bình luận này.', null, 403);
    c.deleteOne();
    e.commentNum = e.comments.length;
    await e.save();
    if (by && !e.comments.some((x) => x.user && String(x.user._id || x.user) === by)) await N.removeByOwner('event_comment', e.id, String(e.owner), by);
    res.json({ event: await full(e, req.uid) });
  }));
};
