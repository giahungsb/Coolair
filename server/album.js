/* Album ảnh – port từ UCenter Home (album / pic). Ảnh tải thẳng lên Cloudinary qua /upload/sign?kind=album (server/upload.js),
   rồi trình duyệt gọi POST /albums/:id/photos {url} để đăng ký. Server chỉ nhận URL đúng cloud + thư mục + id của chính người gọi.
   Ảnh có cảm xúc + bình luận (như bài viết), chuyển ảnh giữa các album, và phân trang (album: theo trang; ảnh: "xem thêm" theo con trỏ _id). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Album, Photo } = require('./models');
const { cloud } = require('./upload');
const { blockedBetween } = require('./vis');

const VIS = ['public', 'friends', 'private'], EMOJI = ['👍', '😍', '😂', '😮', '😢'];
const MAX_ALBUMS = 50, MAX_PHOTOS = 200, MAX_COMMENTS = 200, PER_ALBUMS = 12, PER_PHOTOS = 24, MAX_BATCH = 100;
const photoLimit = async (uid) => {   // đạo cụ Kho ảnh: +100 ảnh mỗi album (vĩnh viễn, cộng dồn)
  const u = await User.findById(uid).select('magicFx').lean();
  const ex = u && u.magicFx && u.magicFx.get('attachsize');
  return MAX_PHOTOS + (ex && ex.extra ? ex.extra : 0);
};
const talkLimit = rateLimit({ store: rlStore('album.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, areFriends, N }) => {
  const bad = (res) => fail(res, 'Không tìm thấy dữ liệu.', null, 404);
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(S).filter(isValidObjectId))].slice(0, MAX_BATCH);
  const aView = (a) => ({ id: a.id, title: a.title, visibility: a.visibility, cover: a.cover || '', photoNum: a.photoNum, updatedAt: a.updatedAt });
  // Dạng gọn cho lưới ảnh (không kèm mảng bình luận / cảm xúc)
  const pView = (p) => ({ id: p.id, url: p.url, caption: p.caption || '', createdAt: p.createdAt, likes: p.likeNum || 0, comments: p.commentNum || 0 });
  // Dạng đầy đủ cho khung xem ảnh: cảm xúc của mình, bình luận kèm ảnh đại diện, quyền xóa bình luận (người viết hoặc chủ ảnh)
  const pFull = (p, me) => {
    const mine = p.reactions.find((r) => String(r.user) === me), own = String(p.owner) === me;
    return { ...pView(p), likes: p.reactions.length - (mine ? 1 : 0), reaction: mine ? mine.emoji : null,
      comments: p.comments.map((c) => ({ id: c.id, name: c.name, text: c.text, av: (c.user && c.user.avatar) || '', createdAt: c.createdAt,
        canDel: own || (!!c.user && String(c.user._id || c.user) === me) })) };
  };
  const PC = { path: 'comments.user', select: 'avatar' };
  // Chủ album luôn xem được; còn lại theo quyền riêng tư (như bài viết)
  const canSee = async (a, me) => String(a.owner) === me || (a.visibility || 'public') === 'public' || (a.visibility === 'friends' && !!(await areFriends(me, a.owner)));
  const mineAlbum = async (id, uid) => (isValidObjectId(id) ? Album.findOne({ _id: id, owner: uid }) : null);
  const recount = async (a) => {   // đếm lại từ DB (nhiều thao tác cùng lúc có thể đụng nhau) + sửa ảnh bìa nếu ảnh bìa không còn trong album
    a.photoNum = await Photo.countDocuments({ album: a._id });
    if (!a.cover || !(await Photo.exists({ album: a._id, url: a.cover }))) a.cover = (await Photo.findOne({ album: a._id }).sort({ _id: -1 }).select('url'))?.url || '';
    await a.save();
    return a;
  };
  // Tải ảnh + album của ảnh và kiểm tra quyền xem; trả về null nếu không có / không được xem
  const loadPhoto = async (id, me, populate) => {
    const p = isValidObjectId(id) ? await (populate ? Photo.findById(id).populate(PC) : Photo.findById(id)) : null;
    const a = p && (await Album.findById(p.album));
    return a && (await canSee(a, me)) ? { p, a } : null;
  };

  /* ---------- Album ---------- */
  router.get('/users/:id/albums', auth, wrap(async (req, res) => {
    const { relOf, canViewSection } = require('./vis');
    const odoc = await User.findById(req.params.id).select('privacy').lean();
    if (odoc && req.params.id !== req.uid && !canViewSection(odoc, 'album', await relOf(req.uid, req.params.id)))
      return res.json({ albums: [], total: 0, hidden: true });
    if (!isValidObjectId(req.params.id)) return bad(res);
    const me = req.uid, owner = req.params.id;
    const per = Math.min(MAX_ALBUMS, Math.max(1, parseInt(req.query.per, 10) || PER_ALBUMS)), page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = { owner };
    if (owner !== me) q.visibility = (await areFriends(me, owner)) ? { $ne: 'private' } : 'public';
    const [total, rows] = await Promise.all([Album.countDocuments(q), Album.find(q).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * per).limit(per)]);
    res.json({ albums: rows.map(aView), total, page, per });
  }));

  router.post('/albums', auth, wrap(async (req, res) => {
    const title = S(req.body.title).trim(), visibility = VIS.includes(S(req.body.visibility)) ? S(req.body.visibility) : 'public';
    if (!title || title.length > 50) return fail(res, 'Tên album cần từ 1 đến 50 ký tự.');
    if ((await Album.countDocuments({ owner: req.uid })) >= MAX_ALBUMS) return fail(res, `Mỗi người tối đa ${MAX_ALBUMS} album.`);
    res.status(201).json({ album: aView(await Album.create({ owner: req.uid, title, visibility })) });
  }));

  router.get('/albums/:id', auth, wrap(async (req, res) => {
    const a = isValidObjectId(req.params.id) ? await Album.findById(req.params.id) : null;
    if (!a || !(await canSee(a, req.uid))) return bad(res);   // album riêng tư -> báo "không tìm thấy" như bài viết
    const q = { album: a._id }, before = S(req.query.before);
    if (before) { if (!isValidObjectId(before)) return fail(res, 'Tham số không hợp lệ.'); q._id = { $lt: before }; }
    const rows = await Photo.find(q).sort({ _id: -1 }).limit(PER_PHOTOS + 1).select('-comments -reactions');
    res.json({ album: { ...aView(a), mine: String(a.owner) === req.uid }, photos: rows.slice(0, PER_PHOTOS).map(pView), more: rows.length > PER_PHOTOS });
  }));

  router.patch('/albums/:id', auth, wrap(async (req, res) => {
    const a = await mineAlbum(req.params.id, req.uid);
    if (!a) return bad(res);
    if (req.body.title !== undefined) {
      const t = S(req.body.title).trim();
      if (!t || t.length > 50) return fail(res, 'Tên album cần từ 1 đến 50 ký tự.');
      a.title = t;
    }
    if (req.body.visibility !== undefined) {
      if (!VIS.includes(S(req.body.visibility))) return fail(res, 'Quyền riêng tư không hợp lệ.');
      a.visibility = S(req.body.visibility);
    }
    if (req.body.cover !== undefined) {   // đặt ảnh bìa = chọn một ảnh trong chính album này
      const p = isValidObjectId(S(req.body.cover)) ? await Photo.findOne({ _id: S(req.body.cover), album: a._id }) : null;
      if (!p) return fail(res, 'Ảnh bìa không hợp lệ.');
      a.cover = p.url;
    }
    await a.save();
    res.json({ album: aView(a) });
  }));

  // ?moveTo=<id album của mình> -> chuyển toàn bộ ảnh sang album đó rồi mới xóa album (như UCHome); không có -> xóa luôn cả ảnh
  router.delete('/albums/:id', auth, wrap(async (req, res) => {
    const a = await mineAlbum(req.params.id, req.uid), moveTo = S(req.query.moveTo);
    if (!a) return bad(res);
    if (moveTo) {
      const t = moveTo === a.id ? null : await mineAlbum(moveTo, req.uid);
      if (!t) return fail(res, 'Album đích không hợp lệ.');
      if (t.photoNum + a.photoNum > await photoLimit(req.uid)) return fail(res, `Album đích sẽ vượt quá giới hạn ảnh.`);
      await Photo.updateMany({ album: a._id }, { album: t._id });
      await a.deleteOne();
      return res.json({ ok: true, album: aView(await recount(t)) });
    }
    const ps = await Photo.find({ album: a._id }).select('publicId');
    await Photo.deleteMany({ album: a._id });
    await a.deleteOne();
    await Promise.all(ps.map((p) => N.purge(['photo_comment', 'photo_react'], p._id)));   // ảnh đã xóa -> dọn thông báo
    await Promise.all(ps.map((p) => cloud.destroy(p.publicId)));   // dọn Cloudinary (lỗi chỉ ghi log); phải await vì serverless
    res.json({ ok: true });
  }));

  /* ---------- Ảnh ---------- */
  router.post('/albums/:id/photos', auth, wrap(async (req, res) => {
    const a = await mineAlbum(req.params.id, req.uid);
    if (!a) return bad(res);
    const url = S(req.body.url).trim(), publicId = cloud.photoPublicId(url, req.uid);
    if (!publicId) return fail(res, 'Ảnh không hợp lệ.');
    if (a.photoNum >= await photoLimit(req.uid)) return fail(res, `Album đã đạt giới hạn ảnh.`);
    const caption = S(req.body.caption).trim().slice(0, 100);
    let p;
    try { p = await Photo.create({ album: a._id, owner: req.uid, url, publicId, caption }); }
    catch (e) { if (e.code === 11000) return fail(res, 'Ảnh này đã được thêm rồi.', null, 409); throw e; }
    if (!a.cover) a.cover = url;
    await recount(a);
    res.status(201).json({ photo: pView(p), album: aView(a) });
  }));

  // Chuyển / xóa nhiều ảnh cùng lúc (ảnh phải thuộc album :id của chính mình)
  router.post('/albums/:id/move', auth, wrap(async (req, res) => {
    const a = await mineAlbum(req.params.id, req.uid), list = ids(req.body.ids), to = S(req.body.to);
    if (!a || !list.length) return fail(res, 'Chưa chọn ảnh nào.');
    const t = to === a.id ? null : await mineAlbum(to, req.uid);
    if (!t) return fail(res, 'Album đích không hợp lệ.');
    const mine = await Photo.find({ _id: { $in: list }, album: a._id, owner: req.uid }).select('_id');
    if (!mine.length) return fail(res, 'Không tìm thấy ảnh để chuyển.');
    if (t.photoNum + mine.length > await photoLimit(req.uid)) return fail(res, `Album đích sẽ vượt quá giới hạn ảnh.`);
    await Photo.updateMany({ _id: { $in: mine.map((x) => x._id) } }, { album: t._id });
    res.json({ moved: mine.map((x) => x.id), album: aView(await recount(a)), to: aView(await recount(t)) });
  }));

  router.post('/albums/:id/photos/delete', auth, wrap(async (req, res) => {
    const a = await mineAlbum(req.params.id, req.uid), list = ids(req.body.ids);
    if (!a || !list.length) return fail(res, 'Chưa chọn ảnh nào.');
    const ps = await Photo.find({ _id: { $in: list }, album: a._id, owner: req.uid }).select('publicId');
    await Photo.deleteMany({ _id: { $in: ps.map((x) => x._id) } });
    await Promise.all(ps.map((p) => N.purge(['photo_comment', 'photo_react'], p._id)));
    await Promise.all(ps.map((p) => cloud.destroy(p.publicId)));
    res.json({ deleted: ps.map((x) => x.id), album: aView(await recount(a)) });
  }));

  router.get('/photos/:id', auth, wrap(async (req, res) => {
    const r = await loadPhoto(req.params.id, req.uid, true);
    r ? res.json({ photo: pFull(r.p, req.uid) }) : bad(res);
  }));

  router.patch('/photos/:id', auth, wrap(async (req, res) => {
    const p = isValidObjectId(req.params.id) ? await Photo.findOneAndUpdate({ _id: req.params.id, owner: req.uid }, { caption: S(req.body.caption).trim().slice(0, 100) }, { new: true }).select('-comments -reactions') : null;
    p ? res.json({ photo: pView(p) }) : bad(res);
  }));

  router.delete('/photos/:id', auth, wrap(async (req, res) => {
    const p = isValidObjectId(req.params.id) ? await Photo.findOneAndDelete({ _id: req.params.id, owner: req.uid }) : null;
    if (!p) return bad(res);
    const a = await Album.findById(p.album);
    if (a) await recount(a);
    await N.purge(['photo_comment', 'photo_react'], p._id);
    await cloud.destroy(p.publicId);
    res.json({ ok: true, album: a ? aView(a) : null });
  }));

  /* ---------- Cảm xúc + bình luận ảnh ---------- */
  router.post('/photos/:id/reaction', auth, talkLimit, wrap(async (req, res) => {
    const e = S(req.body.emoji);
    if (!EMOJI.includes(e)) return fail(res, 'Cảm xúc không hợp lệ.');
    const r = await loadPhoto(req.params.id, req.uid, true);
    if (!r) return bad(res);
    if (await blockedBetween(r.p.owner, req.uid)) return fail(res, 'Bạn không thể bày tỏ cảm xúc ở đây.', null, 403);
    const { p } = r, i = p.reactions.findIndex((x) => String(x.user) === req.uid);
    let removed = false;
    if (i >= 0 && p.reactions[i].emoji === e) { p.reactions.splice(i, 1); removed = true; }       // bấm lại -> bỏ cảm xúc
    else if (i >= 0) p.reactions[i].emoji = e;
    else p.reactions.push({ user: req.uid, emoji: e });
    p.likeNum = p.reactions.length;
    await p.save();
    await N.swap('photo_react', p.id, String(p.owner), req.uid, removed ? null : e);
    res.json({ photo: pFull(p, req.uid) });
  }));

  router.post('/photos/:id/comments', auth, talkLimit, wrap(async (req, res) => {
    const text = S(req.body.text).trim();
    if (!text || text.length > 500) return fail(res, 'Bình luận cần 1–500 ký tự.');
    const [u, r] = await Promise.all([User.findById(req.uid), loadPhoto(req.params.id, req.uid, true)]);
    if (!u || !r) return bad(res);
    if (await blockedBetween(r.p.owner, req.uid)) return fail(res, 'Bạn không thể bình luận ảnh này.', null, 403);
    if (r.p.comments.length >= MAX_COMMENTS) return fail(res, `Mỗi ảnh tối đa ${MAX_COMMENTS} bình luận.`);
    r.p.comments.push({ user: u.id, name: u.name, text });
    r.p.commentNum = r.p.comments.length;
    await r.p.save();
    await N.add('photo_comment', r.p.id, String(r.p.owner), req.uid);
    await r.p.populate(PC);
    res.status(201).json({ photo: pFull(r.p, req.uid) });
  }));

  router.delete('/photos/:id/comments/:cid', auth, wrap(async (req, res) => {
    const r = await loadPhoto(req.params.id, req.uid, true);
    const c = r && isValidObjectId(req.params.cid) ? r.p.comments.id(req.params.cid) : null;
    if (!c) return bad(res);
    if (String(r.p.owner) !== req.uid && !(c.user && String(c.user._id || c.user) === req.uid)) return fail(res, 'Bạn không có quyền xóa bình luận này.', null, 403);
    const by = c.user && String(c.user._id || c.user);
    c.deleteOne();
    r.p.commentNum = r.p.comments.length;
    await r.p.save();
    if (by && !r.p.comments.some((x) => x.user && String(x.user._id || x.user) === by)) await N.removeByOwner('photo_comment', r.p.id, String(r.p.owner), by);   // xóa hết bình luận của người đó -> bỏ thông báo
    res.json({ photo: pFull(r.p, req.uid) });
  }));
};
