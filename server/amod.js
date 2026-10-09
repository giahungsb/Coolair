/* Kiểm duyệt nội dung (port admincp_blog/doing/share/album/pic/comment/thread/post/event/poll của UCHome):
   liệt kê + xóa bài viết, nhật ký, trạng thái, chia sẻ, ảnh, album, sự kiện, bình chọn, chủ đề nhóm, bình luận. */
const { isValidObjectId } = require('mongoose');
const { User, Post, Blog, Doing, Share, Photo, Album, Event, EventMember, Poll, PollVote, Thread, GroupPost, Group, Notification,
  ForumThread, ForumPost, ForumSub, MusicSong, Video, Quiz, QuizAttempt, Page, Bulletin, Link } = require('./models');
const { cloud } = require('./upload');
const { destroyMedia } = require('./media');

module.exports = (router, { auth, wrap, fail, S, isAdmin, alog }) => {
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const pg = (req) => ({ page: Math.max(1, parseInt(req.query.page, 10) || 1), per: 20 });
  const who = (u) => (u ? { id: String(u._id), name: u.name } : null);
  const escRx = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lister = (Model, mapFn, sort) => wrap(async (req, res) => {
    const { page, per } = pg(req);
    const q = S(req.query.q).trim();
    const rx = new RegExp(escRx(q), 'i');
    const filter = q ? { $or: [{ text: rx }, { title: rx }, { subject: rx }, { question: rx }, { detail: rx }, { caption: rx }, { note: rx }, { name: rx }] } : {};
    const total = await Model.countDocuments(filter);
    const rows = await Model.find(filter)
      .populate({ path: 'author', select: 'name', strictPopulate: false })
      .populate({ path: 'owner', select: 'name', strictPopulate: false })
      .sort(sort || { createdAt: -1 }).skip((page - 1) * per).limit(per).lean();
    res.json({ total, page, per, items: rows.map(mapFn) });
  });

  router.get('/admin/mod/posts', auth, adminOnly, lister(Post, (p) => ({
    id: String(p._id), text: (p.text || '').slice(0, 120), author: who(p.author), createdAt: p.createdAt,
    comments: (p.comments || []).length, photos: (p.photos || []).length,
  })));
  router.get('/admin/mod/blogs', auth, adminOnly, lister(Blog, (b) => ({
    id: String(b._id), text: b.title, author: who(b.owner), createdAt: b.createdAt, comments: b.commentNum || 0,
  })));
  router.get('/admin/mod/doings', auth, adminOnly, lister(Doing, (d) => ({
    id: String(d._id), text: (d.text || '').slice(0, 120), author: who(d.author), createdAt: d.createdAt, comments: d.replyNum || 0,
  })));
  router.get('/admin/mod/shares', auth, adminOnly, lister(Share, (s) => ({
    id: String(s._id), text: (s.note || s.targetTitle || '').slice(0, 120), author: who(s.author), createdAt: s.createdAt, comments: s.commentNum || 0,
  })));
  router.get('/admin/mod/photos', auth, adminOnly, lister(Photo, (p) => ({
    id: String(p._id), text: (p.caption || '').slice(0, 120), author: who(p.owner), createdAt: p.createdAt, url: p.url || '', comments: p.commentNum || 0,
  })));
  router.get('/admin/mod/albums', auth, adminOnly, lister(Album, (a) => ({
    id: String(a._id), text: a.title, author: who(a.owner), createdAt: a.createdAt, photos: a.photoNum || 0,
  })));
  router.get('/admin/mod/events', auth, adminOnly, lister(Event, (e) => ({
    id: String(e._id), text: e.title, author: who(e.owner), createdAt: e.createdAt, comments: e.commentNum || 0,
  })));
  router.get('/admin/mod/polls', auth, adminOnly, lister(Poll, (p) => ({
    id: String(p._id), text: p.question, author: who(p.owner), createdAt: p.createdAt, voters: p.voterNum || 0,
  })));
  router.get('/admin/mod/threads', auth, adminOnly, lister(Thread, (t) => ({
    id: String(t._id), text: t.subject, author: who(t.author), createdAt: t.createdAt, replies: t.replyNum || 0,
  })));
  // Kiểm duyệt nội dung phpFox parity: chủ đề diễn đàn, bài hát, video, quiz, trang, bản tin, liên kết
  router.get('/admin/mod/forum_threads', auth, adminOnly, lister(ForumThread, (t) => ({
    id: String(t._id), text: t.title, author: who(t.author), createdAt: t.createdAt, replies: t.replyNum || 0,
  })));
  router.get('/admin/mod/songs', auth, adminOnly, lister(MusicSong, (s) => ({
    id: String(s._id), text: s.title + (s.artist ? ' – ' + s.artist : ''), author: who(s.owner), createdAt: s.createdAt, replies: (s.likes || []).length,
  })));
  router.get('/admin/mod/videos', auth, adminOnly, lister(Video, (v) => ({
    id: String(v._id), text: v.title, author: who(v.owner), createdAt: v.createdAt, replies: v.commentNum || 0,
  })));
  router.get('/admin/mod/quizzes', auth, adminOnly, lister(Quiz, (q) => ({
    id: String(q._id), text: q.title, author: who(q.owner), createdAt: q.createdAt, replies: q.takes || 0,
  })));
  router.get('/admin/mod/pages', auth, adminOnly, lister(Page, (p) => ({
    id: String(p._id), text: p.name, author: who(p.owner), createdAt: p.createdAt, replies: p.likeNum || 0,
  })));
  router.get('/admin/mod/bulletins', auth, adminOnly, lister(Bulletin, (b) => ({
    id: String(b._id), text: b.subject, author: who(b.author), createdAt: b.createdAt, replies: b.views || 0,
  })));
  router.get('/admin/mod/links', auth, adminOnly, lister(Link, (l) => ({
    id: String(l._id), text: l.title, author: who(l.owner), createdAt: l.createdAt, replies: l.clicks || 0,
  })));

  const delOne = (Model, kind, clean) => wrap(async (req, res) => {
    const d = await Model.findByIdAndDelete(req.params.id);
    if (!d) return fail(res, 'Không tìm thấy.', null, 404);
    await Notification.deleteMany({ item: String(d._id) });
    if (clean) await clean(d);
    alog(req.uid, 'mod_delete', kind + ':' + req.params.id, (d.text || d.title || d.subject || d.question || '').slice(0, 60));
    res.json({ ok: true });
  });
  router.delete('/admin/mod/posts/:id', auth, adminOnly, delOne(Post, 'post', async (p) => {
    await destroyMedia(p);
  }));
  router.delete('/admin/mod/blogs/:id', auth, adminOnly, delOne(Blog, 'blog'));
  router.delete('/admin/mod/doings/:id', auth, adminOnly, delOne(Doing, 'doing'));
  router.delete('/admin/mod/shares/:id', auth, adminOnly, delOne(Share, 'share'));
  router.delete('/admin/mod/photos/:id', auth, adminOnly, delOne(Photo, 'photo', async (p) => {
    if (p.album) await Album.updateOne({ _id: p.album }, { $inc: { photoNum: -1 } });
    if (p.publicId) await cloud.destroy(p.publicId);
  }));
  router.delete('/admin/mod/albums/:id', auth, adminOnly, delOne(Album, 'album', async (a) => {
    const ph = await Photo.find({ album: a._id }).select('_id publicId').lean();
    await Promise.all([Photo.deleteMany({ album: a._id }), Notification.deleteMany({ item: { $in: ph.map((x) => String(x._id)) } })]);
    await Promise.all(ph.filter((p) => p.publicId).map((p) => cloud.destroy(p.publicId)));
  }));
  router.delete('/admin/mod/events/:id', auth, adminOnly, delOne(Event, 'event', async (e) => {
    await EventMember.deleteMany({ event: e._id });
  }));
  router.delete('/admin/mod/polls/:id', auth, adminOnly, delOne(Poll, 'poll', async (p) => {
    await PollVote.deleteMany({ poll: p._id });
  }));
  router.delete('/admin/mod/threads/:id', auth, adminOnly, delOne(Thread, 'thread', async (t) => {
    const n = await GroupPost.countDocuments({ thread: t._id, isThread: { $ne: true } });
    await GroupPost.deleteMany({ thread: t._id });
    await Group.updateOne({ _id: t.group }, { $inc: { threadNum: -1, postNum: -n } });
  }));
  router.delete('/admin/mod/forum_threads/:id', auth, adminOnly, delOne(ForumThread, 'forum_thread', async (t) => {
    const ps = await ForumPost.find({ thread: t._id }).select('_id').lean();
    await Promise.all([
      ForumPost.deleteMany({ thread: t._id }),
      ForumSub.deleteMany({ thread: t._id }),
      Notification.deleteMany({ item: { $in: ps.map((p) => String(p._id)) } }),
    ]);
  }));
  router.delete('/admin/mod/songs/:id', auth, adminOnly, delOne(MusicSong, 'song', async (s) => {
    const pid = cloud.mediaPublicId(s.url, String(s.owner), 'music'); if (pid) await cloud.destroy(pid, 'video');
  }));
  router.delete('/admin/mod/videos/:id', auth, adminOnly, delOne(Video, 'video', async (v) => {
    if (v.kind === 'upload') { const pid = cloud.mediaPublicId(v.url, String(v.owner), 'video'); if (pid) await cloud.destroy(pid, 'video'); }
  }));
  router.delete('/admin/mod/quizzes/:id', auth, adminOnly, delOne(Quiz, 'quiz', async (q) => {
    await QuizAttempt.deleteMany({ quiz: q._id });
  }));
  router.delete('/admin/mod/pages/:id', auth, adminOnly, delOne(Page, 'page'));
  router.delete('/admin/mod/bulletins/:id', auth, adminOnly, delOne(Bulletin, 'bulletin'));
  router.delete('/admin/mod/links/:id', auth, adminOnly, delOne(Link, 'link'));

  // Bình luận của chủ đề diễn đàn nằm ở collection riêng (ForumPost) -> route riêng, đặt TRƯỚC route generic :kind
  router.get('/admin/mod/forum_threads/:id/comments', auth, adminOnly, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await ForumThread.findById(req.params.id).select('_id') : null;
    if (!t) return fail(res, 'Không tìm thấy.', null, 404);
    const rows = await ForumPost.find({ thread: t._id }).sort({ createdAt: 1 }).populate('author', 'name').lean();
    res.json({ comments: rows.filter((p) => p.author).map((p) => ({ id: String(p._id), name: p.author.name, text: (p.text || '').slice(0, 300), createdAt: p.createdAt })) });
  }));
  router.delete('/admin/mod/forum_threads/:id/comments/:cid', auth, adminOnly, wrap(async (req, res) => {
    const t = isValidObjectId(req.params.id) ? await ForumThread.findById(req.params.id).select('_id') : null;
    if (!t) return fail(res, 'Không tìm thấy.', null, 404);
    const p = isValidObjectId(req.params.cid) ? await ForumPost.findOneAndDelete({ _id: req.params.cid, thread: t._id }) : null;
    if (!p) return fail(res, 'Không tìm thấy bình luận.', null, 404);
    await Promise.all([
      ForumThread.updateOne({ _id: t._id }, { $inc: { replyNum: -1 } }),
      Notification.deleteMany({ item: String(p._id) }),
    ]);
    alog(req.uid, 'mod_delete', 'forum_post:' + req.params.cid, 'xóa 1 trả lời');
    res.json({ ok: true, removed: 1 });
  }));

  // Xóa bình luận của bài viết / nhật ký
  router.delete('/admin/mod/posts/:id/comments/:cid', auth, adminOnly, wrap(async (req, res) => {
    const p = await Post.findById(req.params.id);
    if (!p) return fail(res, 'Không tìm thấy bài viết.', null, 404);
    const n0 = p.comments.length, cid = req.params.cid;
    p.comments = p.comments.filter((c) => String(c._id) !== cid && !(c.parent && String(c.parent) === cid));
    await p.save();
    alog(req.uid, 'mod_delete', 'post_comment:' + cid, 'xóa ' + (n0 - p.comments.length) + ' bình luận');
    res.json({ ok: true, removed: n0 - p.comments.length });
  }));
  router.delete('/admin/mod/blogs/:id/comments/:cid', auth, adminOnly, wrap(async (req, res) => {
    const b = await Blog.findById(req.params.id);
    if (!b) return fail(res, 'Không tìm thấy nhật ký.', null, 404);
    const n0 = b.comments.length, cid = req.params.cid;
    b.comments = b.comments.filter((c) => String(c._id) !== cid && !(c.parent && String(c.parent) === cid));
    b.commentNum = Math.max(0, b.comments.length);
    await b.save();
    alog(req.uid, 'mod_delete', 'blog_comment:' + cid, 'xóa ' + (n0 - b.comments.length) + ' bình luận');
    res.json({ ok: true, removed: n0 - b.comments.length });
  }));

  /* Quản lý bình luận trong kiểm duyệt (mở rộng): xem + xóa bình luận của mọi loại nội dung */
  const CMODELS = { posts: Post, blogs: Blog, doings: Doing, shares: Share, events: Event, photos: Photo, videos: Video };
  const CNUM = { posts: null, blogs: 'commentNum', doings: 'replyNum', shares: 'commentNum', events: 'commentNum', photos: 'commentNum', videos: 'commentNum' };
  const CFIELD = { doings: 'replies' };   // doing lưu bình luận ở 'replies', các loại khác ở 'comments'
  router.get('/admin/mod/:kind/:id/comments', auth, adminOnly, wrap(async (req, res) => {
    const Model = CMODELS[req.params.kind];
    if (!Model) return fail(res, 'Loại nội dung không hợp lệ.', null, 400);
    const cf = CFIELD[req.params.kind] || 'comments';
    const d = isValidObjectId(req.params.id) ? await Model.findById(req.params.id).select(cf).lean() : null;
    if (!d) return fail(res, 'Không tìm thấy.', null, 404);
    res.json({ comments: (d[cf] || []).map((c) => ({ id: String(c._id), name: c.name || '', text: (c.text || '').slice(0, 300), createdAt: c.createdAt })) });
  }));
  router.delete('/admin/mod/:kind/:id/comments/:cid', auth, adminOnly, wrap(async (req, res) => {
    const Model = CMODELS[req.params.kind], numField = CNUM[req.params.kind];
    if (!Model) return fail(res, 'Loại nội dung không hợp lệ.', null, 400);
    const d = isValidObjectId(req.params.id) ? await Model.findById(req.params.id) : null;
    if (!d) return fail(res, 'Không tìm thấy.', null, 404);
    const cf = CFIELD[req.params.kind] || 'comments';
    const cid = req.params.cid, n0 = (d[cf] || []).length;
    d[cf] = (d[cf] || []).filter((c) => String(c._id) !== cid && !(c.parent && String(c.parent) === cid));
    if (numField) d[numField] = Math.max(0, d[cf].length);
    await d.save();
    alog(req.uid, 'mod_delete', req.params.kind + '_comment:' + cid, 'xóa ' + (n0 - d[cf].length) + ' bình luận');
    res.json({ ok: true, removed: n0 - d[cf].length });
  }));
};
