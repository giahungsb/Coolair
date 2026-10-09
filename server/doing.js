/* Doing – trạng thái ngắn kiểu Twitter (port từ UCenter Home cp_doing/space_doing):
   tối đa 200 ký tự, kèm tâm trạng (mood), trả lời đa cấp, quyền riêng tư.
   Kèm API đặt tâm trạng hiện tại (space_mood). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Doing } = require('./models');
const { friendIds, visQ, blockedBetween, blockedIds, feedOptOutIds, relOf, canViewSection } = require('./vis');
const { filter: censorFilter } = require('./censor');
const { award, completeTask } = require('./credit');

const MAX_TEXT = 200, MAX_REPLY = 200, PER = 15;
const MOODS = ['😊 vui', '😢 buồn', '🤩 phấn khích', '😴 mệt', '😍 yêu đời', '😠 bực mình', '😐 bình thường', '🤒 ốm', '🎉 ăn mừng', '💪 quyết tâm'];
const talkLimit = rateLimit({ store: rlStore('doing.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N }) => {
  const bad = (res) => fail(res, 'Không tìm thấy trạng thái.', null, 404);
  const who = (u) => (u ? { id: String(u._id), name: u.name, avatar: u.avatar || '' } : null);
  const dView = (d, me) => ({ id: d._id, text: d.text, mood: d.mood || '', visibility: d.visibility,
    replyNum: d.replyNum || 0, createdAt: d.createdAt, mine: String(d.author._id || d.author) === me, author: who(d.author) });
  const canSee = async (d, me) => {
    if (String(d.author) === me) return true;
    if (await blockedBetween(d.author, me)) return false;
    return d.visibility === 'public' || (d.visibility === 'friends' && (await friendIds(me)).some((x) => String(x) === String(d.author)));
  };
  const full = async (d, me) => {
    const owner = await User.findById(d.author).select('name avatar').lean();
    const reps = (d.replies || []).map((r) => ({ id: r._id, name: r.name, text: r.text, parent: r.parent ? String(r.parent) : null,
      av: '', createdAt: r.createdAt, mine: String(r.user) === me,
      canDel: String(d.author) === me || String(r.user) === me }));
    return { ...dView({ ...d.toObject?.() ?? d, author: owner }, me), replies: reps };
  };

  router.get('/doings', auth, wrap(async (req, res) => {
    const me = req.uid, view = ['feed', 'mine', 'user'].includes(S(req.query.view)) ? S(req.query.view) : 'feed';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const ids = await friendIds(me), blk = await blockedIds(me);
    let q;
    if (view === 'mine') q = { author: me };
    else if (view === 'user') {
      const oid = isValidObjectId(req.query.id) ? req.query.id : me;   // chặn NoSQL operator injection qua ?id[$ne]=...
      const odoc = await User.findById(oid).select('privacy').lean();
      if (odoc && !canViewSection(odoc, 'doing', await relOf(me, oid))) return res.json({ doings: [], total: 0, page, per: PER, hidden: true, moods: MOODS });
      q = { author: oid, ...visQ(me, ids, 'author') };
    }
    else {
      const hidden = (await User.findById(me).select('feedHidden').lean())?.feedHidden || [];
      const noDoing = await feedOptOutIds(ids, 'doing');   // người tắt "hiện trạng thái lên bảng tin bạn bè"
      q = { $and: [visQ(me, ids, 'author'), { author: { $nin: [...blk, ...hidden, ...noDoing].map(String) } }] };
    }
    const [total, rows] = await Promise.all([
      Doing.countDocuments(q),
      Doing.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar').lean(),
    ]);
    res.json({ doings: rows.filter((d) => d.author).map((d) => dView(d, me)), total, page, per: PER, moods: MOODS });
  }));

  router.post('/doings', auth, talkLimit, wrap(async (req, res) => {
    const text = await censorFilter(S(req.body.text).trim()), mood = S(req.body.mood).trim().slice(0, 20);
    const visibility = ['public', 'friends', 'private'].includes(S(req.body.visibility)) ? S(req.body.visibility) : 'public';
    if (!text || text.length > MAX_TEXT) return fail(res, `Trạng thái cần từ 1 đến ${MAX_TEXT} ký tự.`);
    if (mood && !MOODS.includes(mood)) return fail(res, 'Tâm trạng không hợp lệ.');
    const d = await Doing.create({ author: req.uid, text, mood, visibility });
    award(req.uid, 'doing'); completeTask(req.uid, 'doing');
    res.status(201).json({ doing: await full(d, req.uid) });
  }));

  router.delete('/doings/:id', auth, wrap(async (req, res) => {
    const d = isValidObjectId(req.params.id) ? await Doing.findOneAndDelete({ _id: req.params.id, author: req.uid }) : null;
    if (!d) return bad(res);
    res.json({ ok: true });
  }));

  router.get('/doings/:id', auth, wrap(async (req, res) => {
    const d = isValidObjectId(req.params.id) ? await Doing.findById(req.params.id) : null;
    if (!d) return bad(res);
    if (String(d.author) !== req.uid && !(await canSee(d, req.uid))) return bad(res);
    res.json({ doing: await full(d, req.uid) });
  }));

  router.post('/doings/:id/replies', auth, talkLimit, wrap(async (req, res) => {
    const d = isValidObjectId(req.params.id) ? await Doing.findById(req.params.id) : null;
    if (!d || !(await canSee(d, req.uid))) return bad(res);
    if (await blockedBetween(d.author, req.uid)) return fail(res, 'Bạn không thể trả lời trạng thái này.', null, 403);
    const text = await censorFilter(S(req.body.text).trim());
    if (!text || text.length > MAX_REPLY) return fail(res, `Trả lời cần từ 1 đến ${MAX_REPLY} ký tự.`);
    let parent = null;
    if (req.body.parent) {
      parent = (d.replies || []).find((r) => String(r._id) === S(req.body.parent));
      if (!parent) return fail(res, 'Bình luận gốc không tồn tại.');
    }
    const me = await User.findById(req.uid).select('name').lean();
    d.replies.push({ user: req.uid, name: me.name, text, parent: parent ? parent._id : null });
    d.replyNum = (d.replies || []).length; await d.save();
    award(req.uid, 'comment', 'doing');
    if (String(d.author) !== req.uid) await N.add('doing_reply', d.id, String(d.author), req.uid, d.text.slice(0, 60));
    else if (parent && String(parent.user) !== req.uid) await N.add('doing_reply', d.id, String(parent.user), req.uid, d.text.slice(0, 60));
    res.status(201).json({ doing: await full(d, req.uid) });
  }));

  router.delete('/doings/:id/replies/:rid', auth, wrap(async (req, res) => {
    const d = isValidObjectId(req.params.id) ? await Doing.findById(req.params.id) : null;
    if (!d) return bad(res);
    const r = (d.replies || []).find((x) => String(x._id) === req.params.rid);
    if (!r) return fail(res, 'Không tìm thấy trả lời.', null, 404);
    if (!(String(d.author) === req.uid || String(r.user) === req.uid)) return fail(res, 'Bạn không có quyền xóa.', null, 403);
    d.replies = d.replies.filter((x) => String(x._id) !== req.params.rid && String(x.parent || '') !== req.params.rid);
    d.replyNum = d.replies.length; await d.save();
    res.json({ doing: await full(d, req.uid) });
  }));

  /* Tâm trạng hiện tại (space_mood): đặt / xem */
  router.put('/me/mood', auth, talkLimit, wrap(async (req, res) => {
    const mood = S(req.body.mood).trim();
    if (mood && !MOODS.includes(mood)) return fail(res, 'Tâm trạng không hợp lệ.');
    await User.findByIdAndUpdate(req.uid, { mood });
    res.json({ mood });
  }));
  router.get('/users/:id/mood', auth, wrap(async (req, res) => {
    if (await blockedBetween(req.params.id, req.uid)) return fail(res, 'Không xem được.', null, 403);
    const u = await User.findById(req.params.id).select('mood').lean();
    res.json({ mood: u ? u.mood || '' : '' });
  }));
};
module.exports.MOODS = MOODS;
