/* Video – port module `video` của phpFox 3.0 (đầy đủ: tải lên, nhúng link, chuyên mục, video nổi bật,
   lượt xem, thích, bình luận). File video tải lên Cloudinary qua /upload/sign có sẵn (không cần biến .env mới). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, VideoCat, Video, Notification } = require('./models');
const { filter: censorFilter } = require('./censor');
const { award } = require('./credit');
const { cloud } = require('./upload');
const { grab } = require('./media');

const PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_video.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N, isAdmin, alog }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const vView = (v) => ({ id: String(v._id), title: v.title, desc: v.desc || '', kind: v.kind,
    url: v.url || '', site: v.site || '', vid: v.vid || '', thumb: v.thumb || '', duration: v.duration || 0,
    views: v.views || 0, likes: (v.likes || []).length, liked: v._liked || false, commentNum: v.commentNum || 0,
    featured: !!v.featured, cat: v.cat ? { id: String(v.cat._id || v.cat), name: v.cat.name || '' } : null,
    owner: v.owner && v.owner.name ? { id: String(v.owner._id || v.owner), name: v.owner.name, avatar: v.owner.avatar || '' } : null,
    createdAt: v.createdAt });

  router.get('/video/cats', auth, wrap(async (req, res) => {
    const cs = await VideoCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name })) });
  }));

  router.get('/videos', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = {}, qs = S(req.query.q).trim();
    if (oid(req.query.cat)) q.cat = req.query.cat;
    if (oid(req.query.owner)) q.owner = req.query.owner;
    if (req.query.featured === '1') q.featured = true;
    if (qs) q.title = new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const sort = req.query.sort === 'views' ? { views: -1 } : { createdAt: -1 };
    const [total, rows] = await Promise.all([
      Video.countDocuments(q),
      Video.find(q).sort(sort).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar').populate('cat', 'name').lean(),
    ]);
    rows.forEach((v) => { v._liked = (v.likes || []).some((u) => String(u) === req.uid); });
    res.json({ total, page, per: PER, videos: rows.map(vView) });
  }));

  router.post('/videos', auth, talkLimit, wrap(async (req, res) => {
    const b = req.body, title = S(b.title).trim(), kind = b.kind === 'embed' ? 'embed' : 'upload';
    if (!title || title.length > 120) return fail(res, 'Tiêu đề cần 1–120 ký tự.');
    const data = { owner: req.uid, title: await censorFilter(title), kind,
      desc: await censorFilter(S(b.desc).trim().slice(0, 2000)),
      duration: Math.max(0, Math.min(86400, Math.floor(Number(b.duration) || 0))) };
    if (kind === 'upload') {
      const url = S(b.url).trim();
      // Chỉ nhận file do chính người đăng tải lên Cloudinary qua /upload/sign?kind=video
      if (!cloud.mediaPublicId(url, req.uid, 'video')) return fail(res, 'Video tải lên không hợp lệ, hãy tải lại file.');
      data.url = url;
    } else {
      // Luôn tự phân tích lại từ link (như bài viết ở media.js): không tin site / id / thumb do trình duyệt gửi
      const g = await grab(S(b.url).trim());
      if (g.error) return fail(res, g.error);
      data.site = g.video.site; data.vid = g.video.vid; data.url = g.video.url || '';   // url chuẩn để nút "Mở video" hoạt động
      data.thumb = S(g.video.thumb).slice(0, 300);
    }
    const cat = oid(b.cat);
    if (cat) { if (!(await VideoCat.exists({ _id: cat }))) return fail(res, 'Chuyên mục không tồn tại.'); data.cat = cat; }
    const v = await Video.create(data);
    await award(req.uid, 'video_upload', 'Đăng video');
    res.status(201).json({ video: { id: String(v._id), title: v.title } });
  }));

  router.get('/videos/:id', auth, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).populate('owner', 'name avatar').populate('cat', 'name');
    if (!v) return bad(res, 'Không tìm thấy video.');
    v.views = (v.views || 0) + 1; await v.save();
    const o = v.toObject(); o._liked = (o.likes || []).some((u) => String(u) === req.uid);
    const comments = (o.comments || []).map((c) => ({ id: String(c._id), user: c.user ? { id: String(c.user), name: c.name || '' } : null, text: c.text, createdAt: c.createdAt }));
    res.json({ video: { ...vView(o), mine: String(v.owner._id) === req.uid, comments } });
  }));

  router.post('/videos/:id/comments', auth, talkLimit, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id owner comments');
    if (!v) return bad(res, 'Không tìm thấy video.');
    const text = S(req.body.text).trim();
    if (!text || text.length > 500) return fail(res, 'Bình luận cần 1–500 ký tự.');
    const me = await User.findById(req.uid).select('name');
    v.comments.push({ user: req.uid, name: me.name, text: await censorFilter(text) });
    v.commentNum = (v.commentNum || 0) + 1; await v.save();
    await N.add('video_comment', String(v._id), v.owner, req.uid);
    res.status(201).json({ ok: true, commentNum: v.commentNum });
  }));
  router.delete('/videos/:id/comments/:cid', auth, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id owner comments');
    if (!v) return bad(res, 'Không tìm thấy video.');
    const c = (v.comments || []).id(req.params.cid);
    if (!c) return bad(res, 'Không tìm thấy bình luận.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(c.user) !== req.uid && String(v.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa bình luận này.', null, 403);
    c.deleteOne(); v.commentNum = Math.max(0, (v.commentNum || 1) - 1); await v.save();
    res.json({ ok: true });
  }));

  router.post('/videos/:id/like', auth, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id');
    if (!v) return bad(res, 'Không tìm thấy video.');
    await Video.updateOne({ _id: v._id }, { $addToSet: { likes: req.uid } });
    res.json({ ok: true, liked: true });
  }));
  router.delete('/videos/:id/like', auth, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id');
    if (!v) return bad(res, 'Không tìm thấy video.');
    await Video.updateOne({ _id: v._id }, { $pull: { likes: req.uid } });
    res.json({ ok: true, liked: false });
  }));
  router.delete('/videos/:id', auth, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id owner kind url');
    if (!v) return bad(res, 'Không tìm thấy video.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(v.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa video này.', null, 403);
    await Promise.all([Video.deleteOne({ _id: v._id }), Notification.deleteMany({ item: String(v._id) })]);
    if (v.kind === 'upload') { const pid = cloud.mediaPublicId(v.url, String(v.owner), 'video'); if (pid) await cloud.destroy(pid, 'video'); }   // dọn file trên Cloudinary (phải await: serverless)
    res.json({ ok: true });
  }));

  /* ---------- Quản trị chuyên mục + video nổi bật ---------- */
  router.get('/admin/video-cats', auth, adminOnly, wrap(async (req, res) => {
    const cs = await VideoCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name, displayorder: c.displayorder || 0 })) });
  }));
  router.post('/admin/video-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 50) return fail(res, 'Tên chuyên mục cần 1–50 ký tự.');
    const c = await VideoCat.create({ name, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'videocat_add', name); res.status(201).json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.patch('/admin/video-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await VideoCat.findById(req.params.id);
    if (!c) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 50) return fail(res, 'Tên tối đa 50 ký tự.'); c.name = name; }
    if (req.body.displayorder !== undefined) c.displayorder = Number(req.body.displayorder) || 0;
    await c.save(); alog(req.uid, 'videocat_edit', c.name); res.json({ ok: true });
  }));
  router.delete('/admin/video-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await VideoCat.findById(req.params.id);
    if (!c) return bad(res);
    await Promise.all([Video.updateMany({ cat: c._id }, { $unset: { cat: 1 } }), c.deleteOne()]);
    alog(req.uid, 'videocat_del', c.name); res.json({ ok: true });
  }));
  router.patch('/admin/videos/:id/featured', auth, adminOnly, wrap(async (req, res) => {
    const v = oid(req.params.id) && await Video.findById(req.params.id).select('_id title');
    if (!v) return bad(res, 'Không tìm thấy video.');
    v.featured = req.body.featured === true; await v.save();
    alog(req.uid, 'video_featured', v.title + ':' + v.featured); res.json({ ok: true, featured: v.featured });
  }));
};
