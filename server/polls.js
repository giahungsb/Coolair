/* Bình chọn (poll) – port ý tưởng từ UCenter Home (space_poll / cp_poll): 2–10 lựa chọn, chọn một hoặc nhiều, hạn chót,
   mỗi người bình chọn một lần (không đổi được), chủ bình chọn xóa được. Nội dung là văn bản thuần. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Poll, PollVote } = require('./models');
const { friendIds, visQ, blockedBetween } = require('./vis');

const VIS = ['public', 'friends', 'private'];
const MAX_Q = 100, MAX_OPT = 60, MIN_OPTS = 2, MAX_OPTS = 10, PER = 10, MAX_POLLS = 100;
const talkLimit = rateLimit({ store: rlStore('polls.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S }) => {
  const bad = (res) => fail(res, 'Không tìm thấy bình chọn.', null, 404);
  const expired = (p) => !!p.expires && p.expires < new Date();
  const pView = (p, me, owner) => ({ id: p.id, question: p.question, optionNum: p.options.length, voterNum: p.voterNum || 0, multiple: !!p.multiple, maxChoice: p.maxChoice || 1,
    expires: p.expires || null, expired: expired(p), visibility: p.visibility, createdAt: p.createdAt, mine: String(p.owner._id || p.owner) === me,
    owner: owner ? { id: owner.id, name: owner.name, avatar: owner.avatar || '' } : null });
  const canSee = async (p, me) => String(p.owner) === me || p.visibility === 'public' || (p.visibility === 'friends' && (await friendIds(me)).some((x) => String(x) === String(p.owner)));
  const load = async (id) => (isValidObjectId(id) ? Poll.findById(id) : null);
  const full = async (p, me) => {
    const [owner, my, recent] = await Promise.all([User.findById(p.owner).select('name avatar'), PollVote.findOne({ poll: p._id, user: me }).select('choices').lean(),
      PollVote.find({ poll: p._id }).sort({ createdAt: -1 }).limit(20).populate('user', 'name avatar').lean()]);
    const base = Math.max(1, p.voterNum || 0);
    return { ...pView(p, me, owner), my: my ? my.choices : null, canVote: !my && !expired(p),
      options: p.options.map((o, i) => ({ i, text: o.text, voteNum: o.voteNum || 0, pct: Math.round(((o.voteNum || 0) * 100) / base) })),
      voters: recent.filter((v) => v.user).map((v) => ({ id: String(v.user._id), name: v.user.name, avatar: v.user.avatar || '' })) };
  };

  router.get('/polls', auth, wrap(async (req, res) => {
    const me = req.uid, view = ['all', 'mine', 'friends'].includes(S(req.query.view)) ? S(req.query.view) : 'all', page = Math.max(1, parseInt(req.query.page, 10) || 1);
    let q;
    if (view === 'mine') q = { owner: me };
    else {
      const ids = await friendIds(me);
      q = view === 'friends' ? { owner: { $in: ids }, visibility: { $ne: 'private' } } : visQ(me, ids);
    }
    const [total, rows] = await Promise.all([Poll.countDocuments(q), Poll.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar')]);
    res.json({ polls: rows.map((p) => pView(p, me, p.owner)), total, page, per: PER });
  }));

  router.post('/polls', auth, talkLimit, wrap(async (req, res) => {
    const b = req.body, question = S(b.question).trim(), visibility = VIS.includes(S(b.visibility)) ? S(b.visibility) : 'public';
    const opts = (Array.isArray(b.options) ? b.options : []).map((x) => S(x).trim()).filter(Boolean);
    const multiple = b.multiple === true, days = Math.floor(Number(b.days) || 0);
    if (!question || question.length > MAX_Q) return fail(res, `Câu hỏi cần từ 1 đến ${MAX_Q} ký tự.`);
    if (opts.length < MIN_OPTS || opts.length > MAX_OPTS) return fail(res, `Cần từ ${MIN_OPTS} đến ${MAX_OPTS} lựa chọn.`);
    if (opts.some((o) => o.length > MAX_OPT)) return fail(res, `Mỗi lựa chọn tối đa ${MAX_OPT} ký tự.`);
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return fail(res, 'Các lựa chọn không được trùng nhau.');
    if (days < 0 || days > 90) return fail(res, 'Hạn bình chọn từ 0 đến 90 ngày (0 = không giới hạn).');
    const maxChoice = multiple ? Math.min(opts.length, Math.max(2, Math.floor(Number(b.maxChoice) || opts.length))) : 1;
    if ((await Poll.countDocuments({ owner: req.uid })) >= MAX_POLLS) return fail(res, `Mỗi người tối đa ${MAX_POLLS} bình chọn.`);
    const p = await Poll.create({ owner: req.uid, question, options: opts.map((text) => ({ text })), multiple, maxChoice, visibility, expires: days ? new Date(Date.now() + days * 86400000) : undefined });
    res.status(201).json({ poll: await full(p, req.uid) });
  }));

  router.get('/polls/:id', auth, wrap(async (req, res) => {
    const p = await load(req.params.id);
    if (!p || !(await canSee(p, req.uid))) return bad(res);
    res.json({ poll: await full(p, req.uid) });
  }));

  router.post('/polls/:id/vote', auth, talkLimit, wrap(async (req, res) => {
    const p = await load(req.params.id);
    if (!p || !(await canSee(p, req.uid))) return bad(res);
    if (await blockedBetween(p.owner, req.uid)) return fail(res, 'Bạn không thể bình chọn ở đây.', null, 403);
    if (expired(p)) return fail(res, 'Bình chọn này đã hết hạn.');
    const raw = Array.isArray(req.body.choices) ? req.body.choices : [];
    const choices = [...new Set(raw.map((x) => (Number.isInteger(x) ? x : -1)))];
    if (!choices.length || choices.some((i) => i < 0 || i >= p.options.length)) return fail(res, 'Lựa chọn không hợp lệ.');
    if (!p.multiple && choices.length !== 1) return fail(res, 'Bình chọn này chỉ được chọn một đáp án.');
    if (p.multiple && choices.length > (p.maxChoice || p.options.length)) return fail(res, `Chọn tối đa ${p.maxChoice} đáp án.`);
    try { await PollVote.create({ poll: p._id, user: req.uid, choices }); }
    catch (e) { if (e.code === 11000) return fail(res, 'Bạn đã bình chọn rồi.', null, 409); throw e; }
    const inc = { voterNum: 1 };
    choices.forEach((i) => { inc['options.' + i + '.voteNum'] = 1; });
    await Poll.updateOne({ _id: p._id }, { $inc: inc });
    res.json({ poll: await full(await Poll.findById(p._id), req.uid) });
  }));

  router.delete('/polls/:id', auth, wrap(async (req, res) => {
    const p = isValidObjectId(req.params.id) ? await Poll.findOneAndDelete({ _id: req.params.id, owner: req.uid }) : null;
    if (!p) return bad(res);
    await PollVote.deleteMany({ poll: p._id });
    res.json({ ok: true });
  }));
};
