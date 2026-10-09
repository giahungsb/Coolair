/* Share – chia sẻ nội dung (port từ UCenter Home cp_share/space_share):
   chia sẻ bài viết / nhật ký / ảnh / sự kiện / bình chọn / trạng thái / link ngoài
   lên tường của mình kèm lời bình, tôn trọng quyền riêng tư của nội dung gốc. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Post, Blog, Photo, Album, Event, Poll, Doing, Share } = require('./models');
const { friendIds, visQ, blockedBetween, blockedIds, feedOptOutIds } = require('./vis');
const { filter: censorFilter } = require('./censor');
const { award } = require('./credit');

const KINDS = ['post', 'blog', 'photo', 'event', 'poll', 'doing', 'link'];
const MAX_NOTE = 200, MAX_COMMENT = 500, PER = 15;
const talkLimit = rateLimit({ store: rlStore('share.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

/* Lấy snapshot nội dung gốc + kiểm tra người share có được xem không */
const resolveTarget = async (kind, id, me, fids) => {
  if (!isValidObjectId(id)) return { err: 'Nội dung không tồn tại.' };
  const seen = (owner, vis) => String(owner) === me || vis === 'public' || (vis === 'friends' && fids.some((x) => String(x) === String(owner)));
  const who = (u) => ({ id: String(u._id), name: u.name, avatar: u.avatar || '' });
  if (kind === 'post') {
    const p = await Post.findById(id).populate('author', 'name avatar').lean();
    if (!p || !p.author || !seen(p.author._id, p.visibility)) return { err: 'Bài viết không tồn tại hoặc bạn không được xem.' };
    return { title: String(p.text || '').slice(0, 120), owner: who(p.author), image: (p.photos || [])[0] || '', url: '' };
  }
  if (kind === 'blog') {
    const b = await Blog.findById(id).populate('owner', 'name avatar').lean();
    if (!b || !b.owner || !seen(b.owner._id, b.visibility)) return { err: 'Nhật ký không tồn tại hoặc bạn không được xem.' };
    return { title: b.title, owner: who(b.owner), image: '', url: '' };
  }
  if (kind === 'photo') {
    const ph = await Photo.findById(id).populate('owner', 'name avatar').lean();
    if (!ph || !ph.owner) return { err: 'Ảnh không tồn tại.' };
    const al = await Album.findById(ph.album).select('visibility').lean();
    if (!seen(ph.owner._id, al ? al.visibility : 'public')) return { err: 'Bạn không được xem ảnh này.' };
    return { title: ph.caption || 'Ảnh', owner: who(ph.owner), image: ph.url, url: '' };
  }
  if (kind === 'event') {
    const e = await Event.findById(id).populate('owner', 'name avatar').lean();
    if (!e || !e.owner || !seen(e.owner._id, e.visibility)) return { err: 'Sự kiện không tồn tại hoặc bạn không được xem.' };
    return { title: e.title, owner: who(e.owner), image: '', url: '' };
  }
  if (kind === 'poll') {
    const p = await Poll.findById(id).populate('owner', 'name avatar').lean();
    if (!p || !p.owner || !seen(p.owner._id, p.visibility)) return { err: 'Bình chọn không tồn tại hoặc bạn không được xem.' };
    return { title: p.question, owner: who(p.owner), image: '', url: '' };
  }
  if (kind === 'doing') {
    const d = await Doing.findById(id).populate('author', 'name avatar').lean();
    if (!d || !d.author || !seen(d.author._id, d.visibility)) return { err: 'Trạng thái không tồn tại hoặc bạn không được xem.' };
    return { title: d.text.slice(0, 120), owner: who(d.author), image: '', url: '' };
  }
  return { err: 'Loại chia sẻ không hợp lệ.' };
};

module.exports = (router, { auth, wrap, fail, S, N }) => {
  const bad = (res) => fail(res, 'Không tìm thấy chia sẻ.', null, 404);
  const who = (u) => (u ? { id: String(u._id), name: u.name, avatar: u.avatar || '' } : null);
  const sView = (s, me) => ({ id: s._id, note: s.note, kind: s.kind, target: s.target ? String(s.target) : null,
    targetTitle: s.targetTitle || '', targetOwner: who(s.targetOwner), url: s.url || '', image: s.image || '',
    visibility: s.visibility, commentNum: s.commentNum || 0, createdAt: s.createdAt,
    mine: String(s.author._id || s.author) === me, author: who(s.author) });

  router.get('/shares', auth, wrap(async (req, res) => {
    const me = req.uid, view = ['feed', 'mine', 'user'].includes(S(req.query.view)) ? S(req.query.view) : 'feed';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const ids = await friendIds(me), blk = await blockedIds(me);
    let q;
    if (view === 'mine') q = { author: me };
    else if (view === 'user') q = { author: isValidObjectId(req.query.id) ? req.query.id : me, ...visQ(me, ids, 'author') };
    else {
      const hidden = (await User.findById(me).select('feedHidden').lean())?.feedHidden || [];
      const noShare = await feedOptOutIds(ids, 'share');   // người tắt "hiện chia sẻ lên bảng tin bạn bè"
      q = { $and: [visQ(me, ids, 'author'), { author: { $nin: [...blk, ...hidden, ...noShare].map(String) } }] };
    }
    const [total, rows] = await Promise.all([
      Share.countDocuments(q),
      Share.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PER).limit(PER)
        .populate('author', 'name avatar').populate('targetOwner', 'name avatar').lean(),
    ]);
    res.json({ shares: rows.filter((s) => s.author).map((s) => sView(s, me)), total, page, per: PER });
  }));

  router.post('/shares', auth, talkLimit, wrap(async (req, res) => {
    const kind = S(req.body.kind);
    if (!KINDS.includes(kind)) return fail(res, 'Loại chia sẻ không hợp lệ.');
    const note = await censorFilter(S(req.body.note).trim().slice(0, MAX_NOTE));
    const visibility = ['public', 'friends', 'private'].includes(S(req.body.visibility)) ? S(req.body.visibility) : 'public';
    const fids = await friendIds(req.uid);
    let snap = { title: '', owner: null, image: '', url: '' }, target = null, targetOwner = null;
    if (kind === 'link') {
      const url = S(req.body.url).trim().slice(0, 500);
      if (!/^https?:\/\//i.test(url)) return fail(res, 'Liên kết không hợp lệ (cần bắt đầu bằng http:// hoặc https://).');
      snap = { title: S(req.body.title).trim().slice(0, 120) || url, owner: null, image: '', url };
    } else {
      target = S(req.body.target);
      const r = await resolveTarget(kind, target, req.uid, fids);
      if (r.err) return fail(res, r.err, null, 404);
      snap = r; targetOwner = r.owner ? r.owner.id : null;
      if (targetOwner && String(targetOwner) === req.uid) return fail(res, 'Bạn không cần chia sẻ nội dung của chính mình.');
      if (await blockedBetween(targetOwner, req.uid)) return fail(res, 'Bạn không thể chia sẻ nội dung này.', null, 403);
    }
    const s = await Share.create({ author: req.uid, note, kind, target: target || undefined,
      targetTitle: snap.title, targetOwner: targetOwner || undefined, url: snap.url, image: snap.image, visibility });
    award(req.uid, 'share');
    if (targetOwner && String(targetOwner) !== req.uid)
      await N.add('share', s.id, String(targetOwner), req.uid, (note || snap.title).slice(0, 80));
    res.status(201).json({ share: sView(await Share.findById(s._id).populate('author', 'name avatar').populate('targetOwner', 'name avatar').lean(), req.uid) });
  }));

  router.delete('/shares/:id', auth, wrap(async (req, res) => {
    const s = isValidObjectId(req.params.id) ? await Share.findOneAndDelete({ _id: req.params.id, author: req.uid }) : null;
    if (!s) return bad(res);
    res.json({ ok: true });
  }));

  router.post('/shares/:id/comments', auth, talkLimit, wrap(async (req, res) => {
    const s = isValidObjectId(req.params.id) ? await Share.findById(req.params.id) : null;
    if (!s) return bad(res);
    const me = req.uid, ids = await friendIds(me);
    const ok = String(s.author) === me || s.visibility === 'public' || (s.visibility === 'friends' && ids.some((x) => String(x) === String(s.author)));
    if (!ok || await blockedBetween(s.author, me)) return fail(res, 'Bạn không thể bình luận.', null, 403);
    const text = await censorFilter(S(req.body.text).trim());
    if (!text || text.length > MAX_COMMENT) return fail(res, `Bình luận cần từ 1 đến ${MAX_COMMENT} ký tự.`);
    let parent = null;
    if (req.body.parent) {
      parent = (s.comments || []).find((c) => String(c._id) === S(req.body.parent));
      if (!parent) return fail(res, 'Bình luận gốc không tồn tại.');
    }
    const u = await User.findById(me).select('name').lean();
    s.comments.push({ user: me, name: u.name, text, parent: parent ? parent._id : null });
    s.commentNum = s.comments.length; await s.save();
    award(me, 'comment', 'share');
    if (String(s.author) !== me) await N.add('share_comment', s.id, String(s.author), me, text.slice(0, 60));
    res.status(201).json({ ok: true, commentNum: s.commentNum });
  }));

  router.get('/shares/:id/comments', auth, wrap(async (req, res) => {
    const s = isValidObjectId(req.params.id) ? await Share.findById(req.params.id).populate('comments.user', 'name avatar').lean() : null;
    if (!s) return bad(res);
    const me = req.uid, ids = await friendIds(me);
    const ok = String(s.author) === me || s.visibility === 'public' || (s.visibility === 'friends' && ids.some((x) => String(x) === String(s.author)));
    if (!ok || await blockedBetween(s.author, me)) return fail(res, 'Bạn không được xem.', null, 403);
    res.json({ comments: (s.comments || []).map((c) => ({ id: String(c._id), name: c.name, text: c.text, parent: c.parent ? String(c.parent) : null,
      av: (c.user && c.user.avatar) || '', createdAt: c.createdAt, mine: String(c.user && (c.user._id || c.user)) === me || String(s.author) === me })) });
  }));

  router.delete('/shares/:id/comments/:cid', auth, wrap(async (req, res) => {
    const s = isValidObjectId(req.params.id) ? await Share.findById(req.params.id) : null;
    if (!s) return bad(res);
    const c = (s.comments || []).find((x) => String(x._id) === req.params.cid);
    if (!c) return fail(res, 'Không tìm thấy bình luận.', null, 404);
    if (!(String(s.author) === req.uid || String(c.user) === req.uid)) return fail(res, 'Bạn không có quyền xóa.', null, 403);
    s.comments = s.comments.filter((x) => String(x._id) !== req.params.cid && String(x.parent || '') !== req.params.cid);
    s.commentNum = s.comments.length; await s.save();
    res.json({ ok: true });
  }));
};
