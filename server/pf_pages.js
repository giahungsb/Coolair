/* Trang cộng đồng (pages) – port module `pages` của phpFox 3.0: trang thông tin được "thích/theo dõi"
   (khác nhóm ở chỗ quan hệ 1 chiều, không cần duyệt thành viên), nhiều quản trị trang, chuyên mục trang,
   trang xác thực (verified) do admin duyệt. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, PageCat, Page, Notification } = require('./models');
const { filter: censorFilter } = require('./censor');
const { award } = require('./credit');

const PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_pages.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N, isAdmin, alog }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const pView = (p, me) => ({ id: String(p._id), name: p.name, desc: p.desc || '', pic: p.pic || '', cover: p.cover || '',
    cat: p.cat ? { id: String(p.cat._id || p.cat), name: p.cat.name || '' } : null,
    likeNum: p.likeNum || 0, liked: (p.likes || []).some((u) => String(u) === me), verified: !!p.verified,
    owner: p.owner && p.owner.name ? { id: String(p.owner._id || p.owner), name: p.owner.name } : null, createdAt: p.createdAt });
  const canAdmin = async (p, uid) => {
    if (String(p.owner) === String(uid)) return true;
    if ((p.admins || []).some((a) => String(a) === String(uid))) return true;
    const u = await User.findById(uid).select('email siteAdmin');
    return !!(u && isAdmin(u));
  };

  router.get('/page-cats', auth, wrap(async (req, res) => {
    const cs = await PageCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name })) });
  }));

  router.get('/pages', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = {}, qs = S(req.query.q).trim();
    if (oid(req.query.cat)) q.cat = req.query.cat;
    if (req.query.mine === '1') q.owner = req.uid;
    if (req.query.liked === '1') q.likes = req.uid;
    if (qs) q.name = new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const sort = req.query.sort === 'likes' ? { likeNum: -1 } : { createdAt: -1 };
    const [total, rows] = await Promise.all([
      Page.countDocuments(q),
      Page.find(q).sort(sort).skip((page - 1) * PER).limit(PER).populate('owner', 'name').populate('cat', 'name').lean(),
    ]);
    res.json({ total, page, per: PER, pages: rows.map((p) => pView(p, req.uid)) });
  }));

  router.post('/pages', auth, talkLimit, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 80) return fail(res, 'Tên trang cần 1–80 ký tự.');
    const cat = oid(req.body.cat);
    if (req.body.cat && !cat) return fail(res, 'Chuyên mục không hợp lệ.');
    if (cat && !(await PageCat.exists({ _id: cat }))) return fail(res, 'Chuyên mục không tồn tại.');
    const p = await Page.create({ owner: req.uid, admins: [req.uid], name: await censorFilter(name),
      desc: await censorFilter(S(req.body.desc).trim().slice(0, 2000)), cat: cat || undefined,
      pic: S(req.body.pic).trim().slice(0, 300), cover: S(req.body.cover).trim().slice(0, 300) });
    await award(req.uid, 'page_create', 'Tạo trang cộng đồng');
    res.status(201).json({ page: { id: String(p._id), name: p.name } });
  }));

  router.get('/pages/:id', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).populate('owner', 'name avatar').populate('cat', 'name').populate('admins', 'name avatar').lean();
    if (!p) return bad(res, 'Không tìm thấy trang.');
    const me = req.uid;
    res.json({ page: { ...pView(p, me), admins: (p.admins || []).filter(Boolean).map((a) => ({ id: String(a._id), name: a.name, avatar: a.avatar || '' })),
      canAdmin: String(p.owner._id) === me || (p.admins || []).some((a) => a && String(a._id) === me) } });
  }));

  router.patch('/pages/:id', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id);
    if (!p) return bad(res, 'Không tìm thấy trang.');
    if (!(await canAdmin(p, req.uid))) return fail(res, 'Bạn không có quyền quản lý trang này.', null, 403);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 80) return fail(res, 'Tên trang tối đa 80 ký tự.'); p.name = await censorFilter(name); }
    if (req.body.desc !== undefined) p.desc = await censorFilter(S(req.body.desc).trim().slice(0, 2000));
    if (req.body.pic !== undefined) p.pic = S(req.body.pic).trim().slice(0, 300);
    if (req.body.cover !== undefined) p.cover = S(req.body.cover).trim().slice(0, 300);
    if (req.body.cat !== undefined) { const cat = oid(req.body.cat); if (req.body.cat && (!cat || !(await PageCat.exists({ _id: cat })))) return fail(res, 'Chuyên mục không hợp lệ.'); p.cat = cat || undefined; }
    await p.save(); res.json({ ok: true });
  }));

  router.post('/pages/:id/like', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id owner likes likeNum');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    const had = (p.likes || []).some((u) => String(u) === req.uid);
    await Page.updateOne({ _id: p._id }, { $addToSet: { likes: req.uid }, $inc: { likeNum: had ? 0 : 1 } });
    if (!had) await N.add('page_like', String(p._id), p.owner, req.uid);
    res.json({ ok: true, liked: true });
  }));
  router.delete('/pages/:id/like', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id owner likes likeNum');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    const had = (p.likes || []).some((u) => String(u) === req.uid);
    await Page.updateOne({ _id: p._id }, { $pull: { likes: req.uid }, $inc: { likeNum: had ? -1 : 0 } });
    if (had) await N.removeByOwner('page_like', String(p._id), p.owner, req.uid);
    res.json({ ok: true, liked: false });
  }));

  // Thêm / gỡ quản trị trang (chỉ chủ trang)
  router.post('/pages/:id/admins', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id owner admins');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    if (String(p.owner) !== req.uid) return fail(res, 'Chỉ chủ trang mới được thêm quản trị.', null, 403);
    const uid = oid(req.body.user);
    if (!uid || !(await User.exists({ _id: uid }))) return fail(res, 'Người dùng không hợp lệ.');
    await Page.updateOne({ _id: p._id }, { $addToSet: { admins: uid } });
    res.json({ ok: true });
  }));
  router.delete('/pages/:id/admins/:uid', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id owner admins');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    if (String(p.owner) !== req.uid && req.params.uid !== req.uid) return fail(res, 'Bạn không có quyền.', null, 403);
    if (String(p.owner) === req.params.uid) return fail(res, 'Không thể gỡ chủ trang.');
    await Page.updateOne({ _id: p._id }, { $pull: { admins: oid(req.params.uid) || undefined } });
    res.json({ ok: true });
  }));

  router.delete('/pages/:id', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id owner name');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(p.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa trang này.', null, 403);
    await Promise.all([Page.deleteOne({ _id: p._id }), Notification.deleteMany({ item: String(p._id) })]);
    res.json({ ok: true });
  }));

  /* ---------- Quản trị chuyên mục trang + duyệt verified ---------- */
  router.get('/admin/page-cats', auth, adminOnly, wrap(async (req, res) => {
    const cs = await PageCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name, displayorder: c.displayorder || 0 })) });
  }));
  router.post('/admin/page-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 50) return fail(res, 'Tên chuyên mục cần 1–50 ký tự.');
    const c = await PageCat.create({ name, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'pagecat_add', name); res.status(201).json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.patch('/admin/page-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await PageCat.findById(req.params.id);
    if (!c) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 50) return fail(res, 'Tên tối đa 50 ký tự.'); c.name = name; }
    if (req.body.displayorder !== undefined) c.displayorder = Number(req.body.displayorder) || 0;
    await c.save(); alog(req.uid, 'pagecat_edit', c.name); res.json({ ok: true });
  }));
  router.delete('/admin/page-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await PageCat.findById(req.params.id);
    if (!c) return bad(res);
    await Promise.all([Page.updateMany({ cat: c._id }, { $unset: { cat: 1 } }), c.deleteOne()]);
    alog(req.uid, 'pagecat_del', c.name); res.json({ ok: true });
  }));
  router.patch('/admin/pages/:id/verify', auth, adminOnly, wrap(async (req, res) => {
    const p = oid(req.params.id) && await Page.findById(req.params.id).select('_id name');
    if (!p) return bad(res, 'Không tìm thấy trang.');
    await Page.updateOne({ _id: p._id }, { $set: { verified: req.body.verified === true } });
    alog(req.uid, 'page_verify', p.name); res.json({ ok: true });
  }));
};
