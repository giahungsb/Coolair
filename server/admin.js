/* Trang quản trị – quản lý thành viên (port ý tưởng từ admincp: user/browse + user/ban của phpFox).
   Chỉ tài khoản có email trong ADMIN_EMAILS dùng được. Không khóa / xóa được quản trị viên khác hoặc chính mình. */
const { Event, EventMember, Poll, PollVote, User, Post, Guestbook, Friendship, Message, Poke, Notification, Album, Photo, Blog, Doing, Share, SsoCode, Group, GroupMember, GroupInvite, Thread, GroupPost, Visitor, Invite, ForumThread, ForumPost, ForumSub, MusicAlbum, MusicSong, MusicPlaylist, Video, Quiz, QuizAttempt, Page } = require('./models');
const social = require('./social'), N = require('./notify');
const { cloud } = require('./upload'), media = require('./media');

module.exports = (router, { auth, wrap, fail, S, isAdmin }) => {
  const ROOTS = (process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const isRoot = (u) => !!u && ROOTS.includes(String(u.email || '').toLowerCase());
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Chỉ quản trị viên mới dùng được chức năng này.', null, 403);
    next();
  });
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = (u, me) => ({
    id: u.id, name: u.name, username: u.username, email: u.email, avatar: u.avatar || '', verified: u.verified !== false, blueTick: !!u.blueTick,
    banned: !!u.banned, banReason: u.banReason || '', bannedAt: u.bannedAt || null, joined: u.createdAt,
    lastLogin: u.lastLogin || null, lastSeen: u.lastSeen || null, admin: isAdmin(u), siteAdmin: !!u.siteAdmin, root: isRoot(u), self: String(u._id) === String(me),
  });
  const day = () => new Date(Date.now() - 24 * 3600 * 1000);
  const FILTERS = { banned: { banned: true }, unverified: { verified: false }, recent: null };

  // Danh sách + thống kê nhanh
  router.get('/admin/users', auth, adminOnly, wrap(async (req, res) => {
    const q = S(req.query.q).trim().slice(0, 50), f = S(req.query.filter);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const cond = {};
    if (f === 'recent') cond.lastSeen = { $gt: day() }; else if (FILTERS[f]) Object.assign(cond, FILTERS[f]);
    if (q) { const rx = new RegExp(esc(q), 'i'); cond.$or = [{ name: rx }, { username: rx }, { email: rx }]; }
    const [total, items, all, banned, unverified, recent] = await Promise.all([
      User.countDocuments(cond), User.find(cond).sort({ createdAt: -1 }).skip((page - 1) * per).limit(per),
      User.estimatedDocumentCount(), User.countDocuments({ banned: true }), User.countDocuments({ verified: false }), User.countDocuments({ lastSeen: { $gt: day() } }),
    ]);
    res.json({ items: items.map((u) => row(u, req.uid)), total, page, pages: Math.max(1, Math.ceil(total / per)), stats: { total: all, banned, unverified, recent } });
  }));

  // Chi tiết một thành viên (kèm số lượng nội dung)
  router.get('/admin/users/:id', auth, adminOnly, wrap(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) return fail(res, 'Không tìm thấy thành viên.', null, 404);
    const id = u._id;
    const [posts, albums, photos, friends, groups, threads, guestbook] = await Promise.all([
      Post.countDocuments({ author: id }), Album.countDocuments({ owner: id }), Photo.countDocuments({ owner: id }),
      Friendship.countDocuments({ status: 'accepted', $or: [{ from: id }, { to: id }] }), GroupMember.countDocuments({ user: id, grade: { $gte: 0 } }),
      Thread.countDocuments({ author: id }), Guestbook.countDocuments({ from: id }),
    ]);
    res.json({ user: { ...row(u, req.uid), phone: u.phone || '', location: u.location || '', bio: u.bio || '', userGroup: u.userGroup ? String(u.userGroup) : '', counts: { posts, albums, photos, friends, groups, threads, guestbook } } });
  }));

  const target = async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) { fail(res, 'Không tìm thấy thành viên.', null, 404); return null; }
    return u;
  };
  const protectedUser = (req, res, u) => {
    if (String(u._id) === String(req.uid)) { fail(res, 'Không thể thao tác trên chính tài khoản của bạn.'); return true; }
    if (isAdmin(u)) { fail(res, 'Không thể thao tác trên tài khoản quản trị viên.'); return true; }
    return false;
  };

  router.post('/admin/users/:id/ban', auth, adminOnly, wrap(async (req, res) => {
    const u = await target(req, res); if (!u || protectedUser(req, res, u)) return;
    Object.assign(u, { banned: true, banReason: S(req.body.reason).trim().slice(0, 100), bannedAt: new Date() });
    await u.save();
    require('./session').bustBanCache(null, u._id);   // xóa cache ban để có hiệu lực ngay
    require('./aconfig').alog(req.uid, 'ban', u.username, u.banReason);
    res.json({ user: row(u, req.uid) });
  }));

  router.post('/admin/users/:id/unban', auth, adminOnly, wrap(async (req, res) => {
    const u = await target(req, res); if (!u) return;
    u.banned = false; u.banReason = ''; u.bannedAt = undefined;
    await u.save();
    require('./session').bustBanCache(null, u._id);   // xóa cache ban để có hiệu lực ngay
    require('./aconfig').alog(req.uid, 'unban', u.username);
    res.json({ user: row(u, req.uid) });
  }));

  // Xác thực email thủ công (khi người dùng không nhận được mail)
  router.post('/admin/users/:id/verify', auth, adminOnly, wrap(async (req, res) => {
    const u = await target(req, res); if (!u) return;
    Object.assign(u, { verified: true, vCode: undefined, vExp: undefined, vTries: 0 });
    await u.save();
    try { await social.applyInvite(u, N); } catch (e) { console.error('Invite:', e.message); }
    require('./aconfig').alog(req.uid, 'verify', u.username);
    res.json({ user: row(u, req.uid) });
  }));

  // Cấp / gỡ tick xanh (dấu xác thực cạnh tên thành viên)
  router.post('/admin/users/:id/tick', auth, adminOnly, wrap(async (req, res) => {
    const u = await target(req, res); if (!u || protectedUser(req, res, u)) return;
    u.blueTick = !u.blueTick;
    await u.save();
    require('./aconfig').alog(req.uid, u.blueTick ? 'tick_grant' : 'tick_revoke', u.username);
    res.json({ user: row(u, req.uid) });
  }));

  // Cấp / gỡ quyền Admin (lưu trong DB, không cần sửa ADMIN_EMAILS). Chỉ admin gốc (email trong ADMIN_EMAILS) được làm việc này.
  router.post('/admin/users/:id/admin', auth, adminOnly, wrap(async (req, res) => {
    const me = await User.findById(req.uid).select('email');
    if (!isRoot(me)) return fail(res, 'Chỉ quản trị viên gốc mới cấp / gỡ quyền Admin.', null, 403);
    const u = await target(req, res); if (!u) return;
    if (String(u._id) === String(req.uid) || isRoot(u)) return fail(res, 'Không thể thao tác trên tài khoản quản trị viên gốc / chính bạn.');
    if (!u.siteAdmin) {   // cấp: chỉ cho tài khoản đã xác thực email, chưa bị khóa
      if (u.verified === false) return fail(res, 'Tài khoản chưa xác thực email, không thể cấp quyền Admin.');
      if (u.banned) return fail(res, 'Tài khoản đang bị khóa, không thể cấp quyền Admin.');
    }
    u.siteAdmin = !u.siteAdmin;
    await u.save();
    require('./aconfig').alog(req.uid, u.siteAdmin ? 'admin_grant' : 'admin_revoke', u.username);
    res.json({ user: row(u, req.uid) });
  }));

  /* ---------- Xóa tài khoản + dọn toàn bộ dữ liệu liên quan ---------- */
  const chunk = async (arr, n, fn) => { for (let i = 0; i < arr.length; i += n) await Promise.all(arr.slice(i, i + n).map(fn)); };
  const wipeUser = async (u) => {
    const id = u._id, uid = String(id);
    // 1) Ảnh trên Cloudinary (album + avatar). Phải await vì serverless có thể dừng ngay sau khi trả lời.
    const ps = await Photo.find({ owner: id }).select('publicId');
    await chunk(ps, 15, (p) => cloud.destroy(p.publicId));
    if (u.avatar) await cloud.destroy(`${cloud.cfg().root}/avatars/${uid}`);
    await cloud.destroy(`${cloud.cfg().root}/covers/${uid}`);   // ảnh bìa (overwrite nên public_id cố định)
    await Promise.all([Photo.deleteMany({ owner: id }), Album.deleteMany({ owner: id }), Blog.deleteMany({ owner: id }), Doing.deleteMany({ author: id }), Share.deleteMany({ author: id })]);
    const evs = (await Event.find({ owner: id }).select('_id').lean()).map((e) => e._id), pls = (await Poll.find({ owner: id }).select('_id').lean()).map((x) => x._id);   // sự kiện / bình chọn của họ + lượt tham gia / bình chọn của họ ở nơi khác
    const myMems = await EventMember.find({ user: id }).select('event status').lean();   // trừ bộ đếm going/maybe ở sự kiện người khác
    for (const m of myMems) await Event.updateOne({ _id: m.event }, { $inc: m.status === 'going' ? { goingNum: -1 } : { maybeNum: -1 } });
    const myVotes = await PollVote.find({ user: id }).select('poll').lean();   // trừ bộ đếm voterNum ở bình chọn người khác
    for (const v of myVotes) await Poll.updateOne({ _id: v.poll }, { $inc: { voterNum: -1 } });
    await Promise.all([EventMember.deleteMany({ $or: [{ user: id }, { event: { $in: evs } }] }), Event.deleteMany({ owner: id }), PollVote.deleteMany({ $or: [{ user: id }, { poll: { $in: pls } }] }), Poll.deleteMany({ owner: id })]);
    // 2) Cảm xúc / bình luận của người này trên ảnh và bài của người khác (cập nhật lại bộ đếm)
    const others = await Photo.find({ $or: [{ 'reactions.user': id }, { 'comments.user': id }] }).select('reactions comments');
    await chunk(others, 15, (p) => {
      const r = p.reactions.filter((x) => String(x.user) !== uid).length, c = p.comments.filter((x) => String(x.user) !== uid).length;
      return Photo.updateOne({ _id: p._id }, { $pull: { reactions: { user: id }, comments: { user: id } }, $set: { likeNum: r, commentNum: c } });
    });
    await chunk(await Post.find({ author: id, $or: [{ 'photos.0': { $exists: true } }, { 'video.kind': 'upload' }] }).select('author photos video'), 10, (p) => media.destroyMedia(p, false));   // ảnh / video trong bài viết
    await Post.deleteMany({ author: id });
    await Post.updateMany({ $or: [{ 'reactions.user': id }, { 'comments.user': id }] }, { $pull: { reactions: { user: id }, comments: { user: id } } });
    // 3) Nhóm: xóa chủ đề của người này, các trả lời lẻ, tư cách thành viên; nhóm trống thì xóa hẳn (như tính năng rời nhóm)
    for (const t of await Thread.find({ author: id }).select('group')) {
      const n = await GroupPost.countDocuments({ thread: t._id, isThread: { $ne: true } });
      await Promise.all([GroupPost.deleteMany({ thread: t._id }), Thread.deleteOne({ _id: t._id }), Group.updateOne({ _id: t.group }, { $inc: { threadNum: -1, postNum: -n } })]);
    }
    const reps = await GroupPost.find({ author: id }).select('thread group');
    const by = new Map();
    for (const r of reps) { const k = r.thread + '|' + r.group; by.set(k, (by.get(k) || 0) + 1); }
    await GroupPost.deleteMany({ author: id });
    for (const [k, n] of by) { const [t, g] = k.split('|'); await Promise.all([Thread.updateOne({ _id: t }, { $inc: { replyNum: -n } }), Group.updateOne({ _id: g }, { $inc: { postNum: -n } })]); }
    const mem = await GroupMember.find({ user: id }).select('group grade');
    await GroupMember.deleteMany({ user: id });
    for (const m of mem) {
      const any = await GroupMember.countDocuments({ group: m.group });
      if (!any) { await Promise.all([GroupInvite.deleteMany({ group: m.group }), Thread.deleteMany({ group: m.group }), GroupPost.deleteMany({ group: m.group }), Group.deleteOne({ _id: m.group })]); continue; }
      await Group.updateOne({ _id: m.group }, { memberNum: await GroupMember.countDocuments({ group: m.group, grade: { $gte: -1 } }) });
      if (m.grade === 9 && !(await GroupMember.exists({ group: m.group, grade: 9 }))) {   // chủ nhóm đi rồi -> nâng người có cấp cao nhất / vào sớm nhất lên làm chủ nhóm
        const next = await GroupMember.findOne({ group: m.group, grade: { $gte: 0 } }).sort({ grade: -1, createdAt: 1 });
        if (next) { next.grade = 9; await next.save(); }
      }
    }
    // 3b) Diễn đàn / nhạc / video / quiz / trang của người này
    const fts = (await ForumThread.find({ author: id }).select('_id').lean()).map((t) => t._id);
    await Promise.all([ForumPost.deleteMany({ $or: [{ author: id }, { thread: { $in: fts } }] }), ForumSub.deleteMany({ $or: [{ user: id }, { thread: { $in: fts } }] }), ForumThread.deleteMany({ author: id })]);
    const songs = await MusicSong.find({ owner: id }).select('url').lean();
    await chunk(songs, 10, (sg) => cloud.destroy(cloud.mediaPublicId(sg.url, uid, 'post') || '').catch(() => {}));
    await Promise.all([MusicSong.deleteMany({ owner: id }), MusicAlbum.deleteMany({ owner: id }), MusicPlaylist.deleteMany({ owner: id })]);
    await Promise.all([Video.deleteMany({ owner: id }), QuizAttempt.deleteMany({ user: id })]);
    const qzs = (await Quiz.find({ owner: id }).select('_id').lean()).map((q) => q._id);
    await Promise.all([QuizAttempt.deleteMany({ quiz: { $in: qzs } }), Quiz.deleteMany({ owner: id }), Page.deleteMany({ owner: id })]);
    // 4) Phần còn lại
    await Promise.all([
      GroupInvite.deleteMany({ $or: [{ user: id }, { from: id }] }), Guestbook.deleteMany({ $or: [{ owner: id }, { from: id }] }),
      Friendship.deleteMany({ $or: [{ from: id }, { to: id }] }), Message.deleteMany({ $or: [{ from: id }, { to: id }] }),
      Poke.deleteMany({ $or: [{ from: id }, { to: id }] }), Notification.deleteMany({ $or: [{ user: id }, { owner: id }] }), SsoCode.deleteMany({ user: id }),
      Visitor.deleteMany({ $or: [{ owner: id }, { visitor: id }] }), Invite.deleteMany({ owner: id }),
    ]);
    await User.deleteOne({ _id: id });
  };

  // Phải gửi kèm username để xác nhận (tránh bấm nhầm / gọi API nhầm)
  router.delete('/admin/users/:id', auth, adminOnly, wrap(async (req, res) => {
    const u = await target(req, res); if (!u || protectedUser(req, res, u)) return;
    // Tài khoản lạ (không có username, vd. dữ liệu mẫu từ app khác dùng chung database) -> xác nhận bằng tên hiển thị, hoặc id nếu cũng không có tên
    const key = String(u.username || u.name || u._id).trim().toLowerCase();
    if (S(req.body && req.body.username).trim().toLowerCase() !== key) return fail(res, (u.username ? 'Tên đăng nhập' : 'Tên hiển thị') + ' xác nhận chưa đúng.');
    await wipeUser(u);
    require('./aconfig').alog(req.uid, 'delete_user', u.username || u.name || String(u._id));
    res.json({ ok: true });
  }));
  const uid2 = (u) => u.id + ' (' + u.username + ')';

  /* ---------- Thống kê (port ý tưởng từ admincp core/index + online-guest của phpFox) ---------- */
  const TZ = 'Asia/Ho_Chi_Minh', DAYS = 14;
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });          // YYYY-MM-DD theo giờ Việt Nam
  const dayKey = (t) => dayFmt.format(new Date(t));
  const series = async (M, since) => {                                        // số bản ghi mới theo từng ngày (điền 0 cho ngày trống)
    const rows = await M.aggregate([{ $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, n: { $sum: 1 } } }]);
    const m = new Map(rows.map((r) => [r._id, r.n]));
    const out = [];
    for (let i = DAYS - 1; i >= 0; i--) { const k = dayKey(Date.now() - i * 864e5); out.push({ d: k, n: m.get(k) || 0 }); }
    return out;
  };
  router.get('/admin/stats', auth, adminOnly, wrap(async (req, res) => {
    const now = Date.now(), since = new Date(now - (DAYS + 1) * 864e5), m30 = new Date(now - 30 * 864e5);
    const c = (M, q) => (q ? M.countDocuments(q) : M.estimatedDocumentCount());
    const sum = async (M, field) => { const r = await M.aggregate([{ $group: { _id: null, n: { $sum: field } } }]); return r.length ? r[0].n : 0; };
    const [users, unverified, banned, on5, on24, on7, today,
      posts, guestbook, messages, albums, photos, groups, threads, gposts, friends, pComments, phComments,
      sUsers, sPosts, sMsgs, topG, topP, latest] = await Promise.all([
      c(User), c(User, { verified: false }), c(User, { banned: true }),
      c(User, { lastSeen: { $gt: new Date(now - 5 * 60e3) } }), c(User, { lastSeen: { $gt: new Date(now - 864e5) } }), c(User, { lastSeen: { $gt: new Date(now - 7 * 864e5) } }),
      c(User, { createdAt: { $gte: new Date(dayKey(now) + 'T00:00:00+07:00') } }),
      c(Post), c(Guestbook), c(Message), c(Album), c(Photo), c(Group), c(Thread), c(GroupPost), c(Friendship, { status: 'accepted' }),
      sum(Post, { $size: { $ifNull: ['$comments', []] } }), sum(Photo, '$commentNum'),
      series(User, since), series(Post, since), series(Message, since),
      Group.find({ closed: { $ne: true } }).sort({ memberNum: -1, threadNum: -1 }).limit(5).select('name memberNum threadNum postNum'),
      Post.aggregate([{ $match: { createdAt: { $gte: m30 } } }, { $group: { _id: '$author', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
      User.find().sort({ createdAt: -1 }).limit(5),
    ]);
    const names = new Map((await User.find({ _id: { $in: topP.map((x) => x._id) } }).select('name username avatar')).map((u) => [String(u._id), u]));
    res.json({
      at: new Date(),
      totals: { users, verified: Math.max(0, users - unverified), unverified, banned, today, online: on5, active24: on24, active7: on7,
        posts, comments: pComments + phComments, guestbook, messages, albums, photos, groups, threads, replies: Math.max(0, gposts - threads), friends },
      series: { users: sUsers, posts: sPosts, messages: sMsgs },
      topGroups: topG.map((g) => ({ id: g.id, name: g.name, members: g.memberNum, threads: g.threadNum, posts: g.postNum })),
      topPosters: topP.map((x) => { const u = names.get(String(x._id)); return u ? { id: u.id, name: u.name, username: u.username, avatar: u.avatar || '', posts: x.n } : null; }).filter(Boolean),
      latest: latest.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || '', joined: u.createdAt, verified: u.verified !== false })),
    });
  }));

  /* Sao lưu dữ liệu (port admincp_backup của UCHome, dạng JSON): tải về toàn bộ collections đã lược bỏ trường nhạy cảm */
  router.get('/admin/backup', auth, adminOnly, wrap(async (req, res) => {
    const M = require('./models');
    const dump = {}, at = new Date();
    const jobs = {
      users: () => M.User.find().select('-password -vCode -vExp -rCode -rExp').lean(),   // loại cả hash mã reset
      posts: () => M.Post.find().lean(), blogs: () => M.Blog.find().lean(), blogCats: () => M.BlogCat.find().lean(),
      doings: () => M.Doing.find().lean(), shares: () => M.Share.find().lean(),
      albums: () => M.Album.find().lean(), photos: () => M.Photo.find().lean(),
      friendships: () => M.Friendship.find().lean(), guestbooks: () => M.Guestbook.find().lean(),
      pokes: () => M.Poke.find().lean(), events: () => M.Event.find().lean(),
      eventMembers: () => M.EventMember.find().lean(), polls: () => M.Poll.find().lean(), pollVotes: () => M.PollVote.find().lean(),
      groups: () => M.Group.find().lean(), groupMembers: () => M.GroupMember.find().lean(),
      groupInvites: () => M.GroupInvite.find().lean(), threads: () => M.Thread.find().lean(), groupPosts: () => M.GroupPost.find().lean(),
      invites: () => M.Invite.find().lean(), blacklists: () => M.Blacklist.find().lean(), reports: () => M.Report.find().lean(),
      creditLogs: () => M.CreditLog.find().lean(), userTasks: () => M.UserTask.find().lean(),
      topics: () => M.Topic.find().lean(), topicMembers: () => M.TopicMember.find().lean(), topicPosts: () => M.TopicPost.find().lean(),
      profileFields: () => M.ProfileField.find().lean(), categories: () => M.Category.find().lean(),
      censorWords: () => M.CensorWord.find().lean(), creditRules: () => M.CreditRule.find().lean(),
      taskDefs: () => M.TaskDef.find().lean(), hotUsers: () => M.HotUser.find().lean(), ipBans: () => M.IpBan.find().lean(),
      siteConfigs: () => M.SiteConfig.find().lean(), userGroups: () => M.UserGroup.find().lean(),
      visitors: () => M.Visitor.find().lean(), messages: () => M.Message.find().lean(),
      forumCats: () => M.ForumCat.find().lean(), forums: () => M.Forum.find().lean(),
      forumThreads: () => M.ForumThread.find().lean(), forumPosts: () => M.ForumPost.find().lean(), forumSubs: () => M.ForumSub.find().lean(),
      musicGenres: () => M.MusicGenre.find().lean(), musicAlbums: () => M.MusicAlbum.find().lean(),
      musicSongs: () => M.MusicSong.find().lean(), musicPlaylists: () => M.MusicPlaylist.find().lean(),
      videoCats: () => M.VideoCat.find().lean(), videos: () => M.Video.find().lean(),
      quizzes: () => M.Quiz.find().lean(), quizAttempts: () => M.QuizAttempt.find().lean(),
      pageCats: () => M.PageCat.find().lean(), pages: () => M.Page.find().lean(),
      giftCats: () => M.GiftCat.find().lean(), gifts: () => M.Gift.find().lean(), userGifts: () => M.UserGift.find().lean(),
      announcements: () => M.Announcement.find().lean(), bulletins: () => M.Bulletin.find().lean(),
      newsletters: () => M.Newsletter.find().lean(), favorites: () => M.Favorite.find().lean(),
      ratings: () => M.Rating.find().lean(), contactMsgs: () => M.ContactMsg.find().lean(), faqs: () => M.Faq.find().lean(),
      shouts: () => M.Shout.find().lean(), linkCats: () => M.LinkCat.find().lean(), links: () => M.Link.find().lean(),
      magicDefs: () => M.MagicDef.find().lean(), userMagics: () => M.UserMagic.find().lean(), magicLogs: () => M.MagicLog.find().lean(),
      eventCats: () => M.EventCat.find().lean(),
    };
    await Promise.all(Object.entries(jobs).map(async ([k, fn]) => { try { dump[k] = await fn(); } catch (e) { dump[k] = { error: e.message }; } }));
    require('./aconfig').alog(req.uid, 'backup', '', Object.keys(dump).length + ' collections');
    const body = JSON.stringify({ app: 'coolair', at, dump });
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) return fail(res, 'Dữ liệu quá lớn (>4MB), vượt giới hạn của Vercel. Hãy sao lưu trực tiếp từ MongoDB.', null, 413);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="coolair-backup-' + at.toISOString().slice(0, 10) + '.json"');
    res.send(body);
  }));
  /* ---- Bản đồ check-in nhóm (quản trị): xem MỌI check-in kể cả bài riêng tư, lọc, gỡ vị trí / xóa bài ---- */
  router.get('/admin/checkins', auth, adminOnly, wrap(async (req, res) => {
    const q = { 'location.name': { $nin: ['', null] } };
    const vis = String(req.query.vis || '');
    if (['public', 'friends', 'private'].includes(vis)) q.visibility = vis === 'public' ? { $in: ['public', null] } : vis;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 0, 0), 3650);
    if (days) q.createdAt = { $gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
    const kw = String(req.query.q || '').trim().slice(0, 60);
    if (kw) {
      const re = new RegExp(esc(kw), 'i');
      const uids = (await User.find({ $or: [{ name: re }, { username: re }] }).select('_id').limit(50).lean()).map((u) => u._id);
      q.$or = [{ 'location.name': re }, { text: re }, { author: { $in: uids } }];
    }
    const [total, list] = await Promise.all([
      Post.countDocuments(q),
      Post.find(q).select('author text location createdAt visibility').populate({ path: 'author', select: 'name username avatar' }).sort({ createdAt: -1 }).limit(1000).lean(),
    ]);
    res.json({
      total,
      items: list.filter((p) => p.location && Number.isFinite(p.location.lat) && Number.isFinite(p.location.lng)).map((p) => ({
        postId: String(p._id), authorId: p.author ? String(p.author._id) : '', name: p.author ? p.author.name : 'Người dùng đã xóa',
        username: p.author ? p.author.username || '' : '', visibility: p.visibility || 'public', text: (p.text || '').slice(0, 120),
        location: { name: p.location.name, lat: p.location.lat, lng: p.location.lng }, createdAt: p.createdAt,
      })),
    });
  }));

  // Gỡ vị trí check-in khỏi bài (giữ nguyên bài viết) — dùng khi check-in lộ nơi ở hoặc sai/độc hại
  router.post('/admin/checkins/:id/clear', auth, adminOnly, wrap(async (req, res) => {
    if (!require('mongoose').isValidObjectId(req.params.id)) return fail(res, 'Không tìm thấy bài viết.', null, 404);
    const p = await Post.findByIdAndUpdate(req.params.id, { $unset: { location: 1 } }, { new: false }).select('location author').lean();
    if (!p || !p.location || !p.location.name) return fail(res, 'Bài này không có check-in.', null, 404);
    require('./aconfig').alog(req.uid, 'checkin_clear', String(p._id), String(p.location.name).slice(0, 60));
    res.json({ ok: true });
  }));
};
