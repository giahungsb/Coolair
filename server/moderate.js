/* Kiểm duyệt: chặn người dùng (blacklist) + tố cáo nội dung (report) – port từ UCenter Home.
   - Chặn: hai chiều, bị chặn thì không xem trang, không nhắn tin/chọc/kết bạn/lưu bút/bình luận được.
   - Tố cáo: người dùng gửi, admin duyệt (bỏ qua / xóa nội dung / khóa tài khoản). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Post, Blog, Photo, Album, Event, Poll, Doing, Share, Blacklist, Report } = require('./models');
const { blockedBetween } = require('./vis');

const REPORT_KINDS = ['post', 'blog', 'photo', 'album', 'event', 'poll', 'doing', 'share', 'user', 'comment'];
const CONTENT_MODELS = { post: Post, blog: Blog, photo: Photo, album: Album, event: Event, poll: Poll, doing: Doing, share: Share };
const lim = rateLimit({ store: rlStore('moderate.lim'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, isAdmin, N }) => {
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });

  /* ---------- Chặn ---------- */
  router.get('/blacklist', auth, wrap(async (req, res) => {
    const rows = await Blacklist.find({ owner: req.uid }).populate('blocked', 'name avatar').sort({ createdAt: -1 }).lean();
    res.json({ blacklist: rows.filter((r) => r.blocked).map((r) => ({ id: r._id, user: { id: String(r.blocked._id), name: r.blocked.name, avatar: r.blocked.avatar || '' }, createdAt: r.createdAt })) });
  }));

  router.post('/blacklist', auth, lim, wrap(async (req, res) => {
    const id = S(req.body.user);
    if (!isValidObjectId(id) || id === req.uid) return fail(res, 'Người dùng không hợp lệ.');
    const u = await User.findById(id).select('_id').lean();
    if (!u) return fail(res, 'Người dùng không tồn tại.', null, 404);
    try { await Blacklist.create({ owner: req.uid, blocked: id }); }
    catch (e) { if (e.code !== 11000) throw e; }
    res.status(201).json({ ok: true });
  }));

  router.delete('/blacklist/:id', auth, wrap(async (req, res) => {
    await Blacklist.deleteOne({ owner: req.uid, blocked: req.params.id });
    res.json({ ok: true });
  }));

  /* ---------- Tố cáo ---------- */
  router.post('/reports', auth, lim, wrap(async (req, res) => {
    const kind = S(req.body.kind), target = S(req.body.target);
    const reason = S(req.body.reason).trim();
    if (!REPORT_KINDS.includes(kind)) return fail(res, 'Loại tố cáo không hợp lệ.');
    if (!isValidObjectId(target)) return fail(res, 'Nội dung không hợp lệ.');
    if (!reason || reason.length > 300) return fail(res, 'Lý do cần từ 1 đến 300 ký tự.');
    let meta = '';
    if (kind === 'comment') {   // cần biết bình luận nằm trong nội dung nào
      const parentKind = S(req.body.parentKind), commentId = S(req.body.commentId);
      if (!CONTENT_MODELS[parentKind] || !isValidObjectId(commentId)) return fail(res, 'Thiếu thông tin bình luận bị tố cáo.');
      meta = JSON.stringify({ parentKind, commentId });
    }
    try { await Report.create({ reporter: req.uid, kind, target, reason, meta }); }
    catch (e) {
      if (e.code === 11000) return fail(res, 'Bạn đã tố cáo nội dung này rồi.', null, 409);
      throw e;
    }
    res.status(201).json({ ok: true });
  }));

  /* ---------- Admin duyệt tố cáo ---------- */
  router.get('/admin/reports', auth, adminOnly, wrap(async (req, res) => {
    const status = ['open', 'reviewing', 'resolved', 'dismissed'].includes(S(req.query.status)) ? S(req.query.status) : 'open';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const [total, rows] = await Promise.all([
      Report.countDocuments({ status }),
      Report.find({ status }).sort({ createdAt: -1 }).skip((page - 1) * per).limit(per)
        .populate('reporter', 'name avatar').populate('targetOwner', 'name avatar').lean(),
    ]);
    res.json({ total, page, per, reports: rows.map((r) => ({ id: r._id, kind: r.kind, target: String(r.target), meta: r.meta,
      reason: r.reason, status: r.status, note: r.note || '', createdAt: r.createdAt,
      reporter: r.reporter ? { id: String(r.reporter._id), name: r.reporter.name } : null })) });
  }));

  router.patch('/admin/reports/:id', auth, adminOnly, wrap(async (req, res) => {
    const r = isValidObjectId(req.params.id) ? await Report.findById(req.params.id) : null;
    if (!r) return fail(res, 'Không tìm thấy tố cáo.', null, 404);
    const action = S(req.body.action);   // dismiss | delete | ban
    const note = S(req.body.note).trim().slice(0, 300);
    if (!['dismiss', 'delete', 'ban'].includes(action)) return fail(res, 'Hành động không hợp lệ.');
    if (action === 'dismiss') { r.status = 'dismissed'; }
    else if (action === 'delete') {
      if (r.kind === 'comment') {
        try {
          const { parentKind, commentId } = JSON.parse(r.meta || '{}');
          const M = CONTENT_MODELS[parentKind];
          if (M) { const doc = await M.findById(r.target); if (doc && doc.comments) { doc.comments = doc.comments.filter((c) => String(c._id) !== commentId); await doc.save(); } }
        } catch (e) { /* meta hỏng thì bỏ qua */ }
      } else if (r.kind === 'user') {
        const u = await User.findById(r.target);
        if (u && (String(u._id) === String(req.uid) || isAdmin(u))) return fail(res, 'Không thể khóa chính bạn hoặc tài khoản quản trị viên.', null, 403);
        if (u) { u.banned = true; u.banReason = 'Vi phạm quy định cộng đồng'; u.bannedAt = new Date(); await u.save(); require('./session').bustBanCache(null, u._id); }
      } else {
        const M = CONTENT_MODELS[r.kind];
        if (M) await M.findByIdAndDelete(r.target);
      }
      r.status = 'resolved';
    } else if (action === 'ban') {
      let uid = r.kind === 'user' ? r.target : r.targetOwner;
      if (!uid && r.kind !== 'user') {   // thử suy ra chủ nội dung
        const M = CONTENT_MODELS[r.kind];
        const doc = M ? await M.findById(r.target).select('author owner').lean() : null;
        uid = doc ? (doc.author || doc.owner) : null;
      }
      if (uid) {
        const u = await User.findById(uid);
        if (u && (String(u._id) === String(req.uid) || isAdmin(u))) return fail(res, 'Không thể khóa chính bạn hoặc tài khoản quản trị viên.', null, 403);
        if (u) { u.banned = true; u.banReason = 'Vi phạm quy định cộng đồng'; u.bannedAt = new Date(); await u.save(); require('./session').bustBanCache(null, u._id); }
      }
      r.status = 'resolved';
    }
    r.note = note; await r.save();
    if (N) await N.remove('report', r.id, req.uid);
    try { require('./aconfig').alog(req.uid, 'report_' + action, r.kind + ':' + r.target); } catch (e) {}
    res.json({ ok: true, status: r.status });
  }));
};
module.exports.blockedBetween = blockedBetween;
