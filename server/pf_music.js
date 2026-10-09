/* Âm nhạc (music) – port module `music` của phpFox 3.0: bài hát, album nhạc, playlist, thể loại,
   lượt nghe, thích. File nhạc tải lên Cloudinary qua /upload/sign có sẵn (không cần biến .env mới). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, MusicGenre, MusicAlbum, MusicSong, MusicPlaylist, Notification } = require('./models');
const { award } = require('./credit');
const { cloud } = require('./upload');

const PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_music.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, isAdmin, alog }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const sView = (s) => ({ id: String(s._id), title: s.title, artist: s.artist || '',
    album: s.album ? { id: String(s.album._id || s.album), title: s.album.title || '' } : null,
    genre: s.genre ? { id: String(s.genre._id || s.genre), name: s.genre.name || '' } : null,
    url: s.url, duration: s.duration || 0, plays: s.plays || 0, likes: (s.likes || []).length,
    liked: s._liked || false, desc: s.desc || '',
    owner: s.owner && s.owner.name ? { id: String(s.owner._id || s.owner), name: s.owner.name, avatar: s.owner.avatar || '' } : null,
    createdAt: s.createdAt });

  router.get('/music/genres', auth, wrap(async (req, res) => {
    const gs = await MusicGenre.find({}).sort({ displayorder: 1 }).lean();
    res.json({ genres: gs.map((g) => ({ id: String(g._id), name: g.name })) });
  }));

  router.get('/music', auth, wrap(async (req, res) => {   // duyệt bài hát
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = {}, qs = S(req.query.q).trim();
    if (oid(req.query.genre)) q.genre = req.query.genre;
    if (oid(req.query.album)) q.album = req.query.album;
    if (oid(req.query.owner)) q.owner = req.query.owner;
    if (qs) q.$or = [{ title: new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { artist: new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const sort = req.query.sort === 'plays' ? { plays: -1 } : { createdAt: -1 };
    const [total, rows] = await Promise.all([
      MusicSong.countDocuments(q),
      MusicSong.find(q).sort(sort).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar').populate('genre', 'name').populate('album', 'title').lean(),
    ]);
    rows.forEach((s) => { s._liked = (s.likes || []).some((u) => String(u) === req.uid); });
    res.json({ total, page, per: PER, songs: rows.map(sView) });
  }));

  router.post('/music', auth, talkLimit, wrap(async (req, res) => {
    const title = S(req.body.title).trim(), url = S(req.body.url).trim();
    if (!title || title.length > 100) return fail(res, 'Tên bài hát cần 1–100 ký tự.');
    // Cho phép dán URL ngoài (tính năng có chủ đích): chỉ nhận https, phát phía trình duyệt nên không SSRF được
    if (!/^https:\/\//.test(url) || url.length > 300) return fail(res, 'URL file nhạc không hợp lệ (dùng /upload/sign để tải lên).');
    const artist = S(req.body.artist).trim().slice(0, 80);
    const genre = oid(req.body.genre), album = oid(req.body.album);
    if (req.body.genre && !genre) return fail(res, 'Thể loại không hợp lệ.');
    if (genre && !(await MusicGenre.exists({ _id: genre }))) return fail(res, 'Thể loại không tồn tại.');
    if (album) { const a = await MusicAlbum.findOne({ _id: album, owner: req.uid }).select('_id'); if (!a) return fail(res, 'Album không tồn tại.'); }
    const duration = Math.max(0, Math.min(36000, Math.floor(Number(req.body.duration) || 0)));
    const s = await MusicSong.create({ owner: req.uid, title, artist, genre: genre || undefined, album: album || undefined,
      url, duration, desc: S(req.body.desc).trim().slice(0, 500) });
    if (album) await MusicAlbum.updateOne({ _id: album }, { $inc: { songNum: 1 } });
    await award(req.uid, 'music_upload', 'Đăng bài hát');
    res.status(201).json({ song: { id: String(s._id), title: s.title } });
  }));

  router.get('/music/albums', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = oid(req.query.owner) ? { owner: req.query.owner } : {};
    const [total, rows] = await Promise.all([
      MusicAlbum.countDocuments(q),
      MusicAlbum.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar').lean(),
    ]);
    res.json({ total, page, per: PER, albums: rows.map((a) => ({ id: String(a._id), title: a.title, desc: a.desc || '', year: a.year || null,
      cover: a.cover || '', songNum: a.songNum || 0, owner: a.owner ? { id: String(a.owner._id), name: a.owner.name, avatar: a.owner.avatar || '' } : null, createdAt: a.createdAt })) });
  }));
  router.post('/music/albums', auth, talkLimit, wrap(async (req, res) => {
    const title = S(req.body.title).trim();
    if (!title || title.length > 80) return fail(res, 'Tên album cần 1–80 ký tự.');
    const year = Math.floor(Number(req.body.year) || 0);
    const a = await MusicAlbum.create({ owner: req.uid, title, desc: S(req.body.desc).trim().slice(0, 500),
      year: year >= 1900 && year <= 2100 ? year : undefined, cover: S(req.body.cover).trim().slice(0, 300) });
    res.status(201).json({ album: { id: String(a._id), title: a.title } });
  }));
  router.get('/music/albums/:id', auth, wrap(async (req, res) => {
    const a = oid(req.params.id) && await MusicAlbum.findById(req.params.id).populate('owner', 'name avatar').lean();
    if (!a) return bad(res, 'Không tìm thấy album.');
    const songs = await MusicSong.find({ album: a._id }).sort({ createdAt: 1 }).populate('genre', 'name').lean();
    songs.forEach((s) => { s._liked = (s.likes || []).some((u) => String(u) === req.uid); });
    res.json({ album: { id: String(a._id), title: a.title, desc: a.desc || '', year: a.year || null, cover: a.cover || '',
      owner: { id: String(a.owner._id), name: a.owner.name, avatar: a.owner.avatar || '' }, mine: String(a.owner._id) === req.uid },
      songs: songs.map(sView) });
  }));
  router.delete('/music/albums/:id', auth, wrap(async (req, res) => {
    const a = oid(req.params.id) && await MusicAlbum.findOne({ _id: req.params.id, owner: req.uid });
    if (!a) return bad(res, 'Không tìm thấy album.');
    await MusicSong.updateMany({ album: a._id }, { $unset: { album: 1 } });
    await a.deleteOne(); res.json({ ok: true });
  }));

  router.get('/music/playlists', auth, wrap(async (req, res) => {
    const rows = await MusicPlaylist.find({ owner: req.uid }).sort({ createdAt: -1 }).lean();
    res.json({ playlists: rows.map((p) => ({ id: String(p._id), title: p.title, songNum: (p.songs || []).length })) });
  }));
  router.post('/music/playlists', auth, talkLimit, wrap(async (req, res) => {
    const title = S(req.body.title).trim();
    if (!title || title.length > 80) return fail(res, 'Tên playlist cần 1–80 ký tự.');
    const p = await MusicPlaylist.create({ owner: req.uid, title });
    res.status(201).json({ playlist: { id: String(p._id), title: p.title } });
  }));
  router.get('/music/playlists/:id', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await MusicPlaylist.findOne({ _id: req.params.id, owner: req.uid }).populate({ path: 'songs', populate: [{ path: 'owner', select: 'name avatar' }, { path: 'genre', select: 'name' }] }).lean();
    if (!p) return bad(res, 'Không tìm thấy playlist.');
    (p.songs || []).forEach((s) => { if (s) s._liked = (s.likes || []).some((u) => String(u) === req.uid); });
    res.json({ playlist: { id: String(p._id), title: p.title, songs: (p.songs || []).filter(Boolean).map(sView) } });
  }));
  router.post('/music/playlists/:id/songs', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await MusicPlaylist.findOne({ _id: req.params.id, owner: req.uid });
    if (!p) return bad(res, 'Không tìm thấy playlist.');
    const sid = oid(req.body.song);
    if (!sid || !(await MusicSong.exists({ _id: sid }))) return fail(res, 'Bài hát không hợp lệ.');
    await MusicPlaylist.updateOne({ _id: p._id }, { $addToSet: { songs: sid } });
    res.json({ ok: true });
  }));
  router.delete('/music/playlists/:id/songs/:sid', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await MusicPlaylist.findOne({ _id: req.params.id, owner: req.uid });
    if (!p) return bad(res, 'Không tìm thấy playlist.');
    await MusicPlaylist.updateOne({ _id: p._id }, { $pull: { songs: oid(req.params.sid) || undefined } });
    res.json({ ok: true });
  }));
  router.delete('/music/playlists/:id', auth, wrap(async (req, res) => {
    const p = oid(req.params.id) && await MusicPlaylist.findOneAndDelete({ _id: req.params.id, owner: req.uid });
    if (!p) return bad(res, 'Không tìm thấy playlist.');
    res.json({ ok: true });
  }));

  router.get('/music/:id', auth, wrap(async (req, res) => {
    const s = oid(req.params.id) && await MusicSong.findById(req.params.id).populate('owner', 'name avatar').populate('genre', 'name').populate('album', 'title');
    if (!s) return bad(res, 'Không tìm thấy bài hát.');
    s.plays = (s.plays || 0) + 1; await s.save();
    const o = s.toObject(); o._liked = (o.likes || []).some((u) => String(u) === req.uid);
    res.json({ song: { ...sView(o), mine: String(s.owner._id) === req.uid } });
  }));
  router.post('/music/:id/like', auth, wrap(async (req, res) => {
    const s = oid(req.params.id) && await MusicSong.findById(req.params.id).select('_id likes');
    if (!s) return bad(res, 'Không tìm thấy bài hát.');
    await MusicSong.updateOne({ _id: s._id }, { $addToSet: { likes: req.uid } });
    res.json({ ok: true, liked: true });
  }));
  router.delete('/music/:id/like', auth, wrap(async (req, res) => {
    const s = oid(req.params.id) && await MusicSong.findById(req.params.id).select('_id');
    if (!s) return bad(res, 'Không tìm thấy bài hát.');
    await MusicSong.updateOne({ _id: s._id }, { $pull: { likes: req.uid } });
    res.json({ ok: true, liked: false });
  }));
  router.delete('/music/:id', auth, wrap(async (req, res) => {
    const s = oid(req.params.id) && await MusicSong.findById(req.params.id).select('_id owner album url');
    if (!s) return bad(res, 'Không tìm thấy bài hát.');
    const me = await User.findById(req.uid).select('email');
    if (String(s.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa bài hát này.', null, 403);
    await Promise.all([
      MusicSong.deleteOne({ _id: s._id }),
      MusicPlaylist.updateMany({}, { $pull: { songs: s._id } }),
      Notification.deleteMany({ item: String(s._id) }),
    ]);
    if (s.album) await MusicAlbum.updateOne({ _id: s.album }, { $inc: { songNum: -1 } });
    const pid = cloud.mediaPublicId(s.url, String(s.owner), 'music'); if (pid) await cloud.destroy(pid, 'video');   // chỉ xóa file do chính chủ tải lên Cloudinary (URL dán ngoài thì bỏ qua)
    res.json({ ok: true });
  }));

  /* ---------- Quản trị thể loại (admincp_music của phpFox) ---------- */
  router.get('/admin/music-genres', auth, adminOnly, wrap(async (req, res) => {
    const gs = await MusicGenre.find({}).sort({ displayorder: 1 }).lean();
    res.json({ genres: gs.map((g) => ({ id: String(g._id), name: g.name, displayorder: g.displayorder || 0 })) });
  }));
  router.post('/admin/music-genres', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 40) return fail(res, 'Tên thể loại cần 1–40 ký tự.');
    const g = await MusicGenre.create({ name, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'musicgenre_add', name); res.status(201).json({ genre: { id: String(g._id), name: g.name } });
  }));
  router.patch('/admin/music-genres/:id', auth, adminOnly, wrap(async (req, res) => {
    const g = oid(req.params.id) && await MusicGenre.findById(req.params.id);
    if (!g) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 40) return fail(res, 'Tên tối đa 40 ký tự.'); g.name = name; }
    if (req.body.displayorder !== undefined) g.displayorder = Number(req.body.displayorder) || 0;
    await g.save(); alog(req.uid, 'musicgenre_edit', g.name); res.json({ ok: true });
  }));
  router.delete('/admin/music-genres/:id', auth, adminOnly, wrap(async (req, res) => {
    const g = oid(req.params.id) && await MusicGenre.findById(req.params.id);
    if (!g) return bad(res);
    await Promise.all([MusicSong.updateMany({ genre: g._id }, { $unset: { genre: 1 } }), g.deleteOne()]);
    alog(req.uid, 'musicgenre_del', g.name); res.json({ ok: true });
  }));
};
