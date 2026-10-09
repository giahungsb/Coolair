/* Tìm kiếm toàn site (network của UCHome): người dùng, bài viết, nhật ký, sự kiện, bình chọn, nhóm, chủ đề nhóm,
   + chủ đề diễn đàn, bài hát, video, quiz, trang cộng đồng (mở rộng theo phpFox). */
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Post, Blog, Event, Poll, Group, GroupMember, Thread, ProfileField, Doing, Share, Topic,
  ForumThread, MusicSong, Video, Quiz, Page } = require('./models');
const { friendIds, visQ, esc } = require('./vis');

const TYPES = ['users', 'posts', 'blogs', 'events', 'polls', 'groups', 'threads', 'doings', 'shares', 'topics',
  'forum_threads', 'songs', 'videos', 'quizzes', 'pages'];
const PER = 10, PEEK = 5;
const searchLimit = rateLimit({ store: rlStore('search.searchLimit'), windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn tìm quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S }) => {
  const snip = (t, rx, n = 140) => {                        // đoạn trích quanh chỗ khớp
    t = String(t || '').replace(/\s+/g, ' ').trim();
    const m = rx.exec(t), at = m ? m.index : 0, from = Math.max(0, at - 30);
    return (from ? '…' : '') + t.slice(from, from + n) + (from + n < t.length ? '…' : '');
  };
  const who = (u) => (u ? { id: String(u._id), name: u.name, avatar: u.avatar || '' } : null);

  router.get('/search', auth, searchLimit, wrap(async (req, res) => {
    const q = S(req.query.q).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (q.length < 2) return fail(res, 'Nhập ít nhất 2 ký tự để tìm.');
    const type = TYPES.includes(S(req.query.type)) ? S(req.query.type) : 'all';
    const page = type === 'all' ? 1 : Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));
    const lim = type === 'all' ? PEEK : PER, skip = (page - 1) * lim;
    const me = req.uid, rx = new RegExp(esc(q), 'i'), rxs = new RegExp(esc(q), 'i');
    const fids = await friendIds(me), fset = new Set(fids.map(String));
    const want = (t) => type === 'all' || type === t;
    const run = async (model, filter, sort, sel, pop) => {                     // trả [tổng, các dòng]
      let c = model.find(filter).sort(sort).skip(skip).limit(lim).select(sel);
      if (pop) c = c.populate(pop[0], pop[1]);
      const [total, rows] = await Promise.all([model.countDocuments(filter), c.lean()]);
      return { total, rows };
    };
    const out = {};
    const jobs = [];
    if (want('users')) jobs.push((async () => {
      const sf = await ProfileField.find({ allowsearch: true, invisible: false }).select('_id').lean();
      const r = await run(User, { _id: { $ne: me }, banned: { $ne: true }, $or: [{ name: rx }, { username: rx }, ...sf.map((d) => ({ ['extra.' + d._id]: rx }))] }, { name: 1 }, 'name username avatar location');
      out.users = { total: r.total, items: r.rows.map((u) => ({ id: String(u._id), name: u.name, username: u.username, avatar: u.avatar || '', location: u.location || '', friend: fset.has(String(u._id)) })) };
    })());
    if (want('posts')) jobs.push((async () => {
      const r = await run(Post, { $and: [visQ(me, fids, 'author'), { text: rx }] }, { createdAt: -1 }, 'author text createdAt', ['author', 'name avatar']);
      out.posts = { total: r.total, items: r.rows.map((p) => ({ id: String(p._id), author: who(p.author), excerpt: snip(p.text, rxs), createdAt: p.createdAt })).filter((x) => x.author) };
    })());
    if (want('blogs')) jobs.push((async () => {
      const r = await run(Blog, { $and: [visQ(me, fids), { $or: [{ title: rx }, { text: rx }] }] }, { createdAt: -1 }, 'owner title text createdAt', ['owner', 'name avatar']);
      out.blogs = { total: r.total, items: r.rows.map((b) => ({ id: String(b._id), title: b.title, owner: who(b.owner), excerpt: snip(rx.test(b.text) ? b.text : b.title, rxs), createdAt: b.createdAt })).filter((x) => x.owner) };
    })());
    if (want('events')) jobs.push((async () => {
      const r = await run(Event, { $and: [visQ(me, fids), { $or: [{ title: rx }, { detail: rx }, { location: rx }] }] }, { start: -1 }, 'owner title location start endAt goingNum', ['owner', 'name avatar']);
      out.events = { total: r.total, items: r.rows.map((e) => ({ id: String(e._id), title: e.title, location: e.location, start: e.start, past: e.endAt < new Date(), goingNum: e.goingNum || 0, owner: who(e.owner) })) };
    })());
    if (want('polls')) jobs.push((async () => {
      const r = await run(Poll, { $and: [visQ(me, fids), { $or: [{ question: rx }, { 'options.text': rx }] }] }, { createdAt: -1 }, 'owner question voterNum expires createdAt', ['owner', 'name avatar']);
      out.polls = { total: r.total, items: r.rows.map((p) => ({ id: String(p._id), question: p.question, voterNum: p.voterNum || 0, expired: !!p.expires && p.expires < new Date(), owner: who(p.owner), createdAt: p.createdAt })) };
    })());
    if (want('groups')) jobs.push((async () => {
      const r = await run(Group, { closed: { $ne: true }, name: rx }, { memberNum: -1, _id: 1 }, 'name pic memberNum threadNum');
      out.groups = { total: r.total, items: r.rows.map((g) => ({ id: String(g._id), name: g.name, pic: g.pic || '', memberNum: g.memberNum || 0, threadNum: g.threadNum || 0 })) };
    })());
    if (want('threads')) jobs.push((async () => {
      const mine = new Set((await GroupMember.find({ user: me, grade: { $gte: 0 } }).select('group').lean()).map((m) => String(m.group)));
      const open = await Group.find({ closed: { $ne: true }, $or: [{ viewperm: { $ne: 1 } }, { memberNum: { $lt: 1 } }, { _id: { $in: [...mine] } }] }).select('_id').lean();   // nhóm xem được
      const r = await run(Thread, { subject: rx, group: { $in: open.map((g) => g._id) } }, { lastPost: -1 }, 'group author subject replyNum lastPost', ['author', 'name avatar']);
      const gs = new Map((await Group.find({ _id: { $in: r.rows.map((t) => t.group) } }).select('name').lean()).map((g) => [String(g._id), g.name]));
      out.threads = { total: r.total, items: r.rows.map((t) => ({ id: String(t._id), subject: t.subject, group: gs.get(String(t.group)) || '', replyNum: t.replyNum || 0, author: who(t.author), lastPost: t.lastPost })) };
    })());
    if (want('doings')) jobs.push((async () => {
      const r = await run(Doing, { $and: [visQ(me, fids, 'author'), { text: rx }] }, { createdAt: -1 }, 'author text mood createdAt', ['author', 'name avatar']);
      out.doings = { total: r.total, items: r.rows.map((d) => ({ id: String(d._id), text: d.text, mood: d.mood || '', author: who(d.author), createdAt: d.createdAt })).filter((x) => x.author) };
    })());
    if (want('shares')) jobs.push((async () => {
      const r = await run(Share, { $and: [visQ(me, fids, 'author'), { $or: [{ note: rx }, { targetTitle: rx }] }] }, { createdAt: -1 }, 'author note kind targetTitle createdAt', ['author', 'name avatar']);
      out.shares = { total: r.total, items: r.rows.map((s) => ({ id: String(s._id), kind: s.kind, note: s.note, targetTitle: s.targetTitle, author: who(s.author), createdAt: s.createdAt })).filter((x) => x.author) };
    })());
    if (want('topics')) jobs.push((async () => {
      const r = await run(Topic, { closed: { $ne: true }, $or: [{ title: rx }, { desc: rx }] }, { hot: -1, joinNum: -1 }, 'title desc joinNum postNum hot');
      out.topics = { total: r.total, items: r.rows.map((t) => ({ id: String(t._id), title: t.title, desc: t.desc, joinNum: t.joinNum || 0, postNum: t.postNum || 0, hot: !!t.hot })) };
    })());
    if (want('forum_threads')) jobs.push((async () => {   // chủ đề diễn đàn (mở cho mọi người)
      const r = await run(ForumThread, { $or: [{ title: rx }, { text: rx }] }, { lastAt: -1 }, 'forum author title replyNum lastAt createdAt', ['author', 'name avatar']);
      out.forum_threads = { total: r.total, items: r.rows.map((t) => ({ id: String(t._id), title: t.title, excerpt: snip(t.title, rxs), replyNum: t.replyNum || 0, author: who(t.author), lastAt: t.lastAt, createdAt: t.createdAt })).filter((x) => x.author) };
    })());
    if (want('songs')) jobs.push((async () => {
      const r = await run(MusicSong, { $or: [{ title: rx }, { artist: rx }] }, { createdAt: -1 }, 'owner title artist plays createdAt', ['owner', 'name avatar']);
      out.songs = { total: r.total, items: r.rows.map((s) => ({ id: String(s._id), title: s.title, artist: s.artist || '', plays: s.plays || 0, owner: who(s.owner), createdAt: s.createdAt })).filter((x) => x.owner) };
    })());
    if (want('videos')) jobs.push((async () => {
      const r = await run(Video, { $or: [{ title: rx }, { desc: rx }] }, { createdAt: -1 }, 'owner title views createdAt', ['owner', 'name avatar']);
      out.videos = { total: r.total, items: r.rows.map((v) => ({ id: String(v._id), title: v.title, views: v.views || 0, owner: who(v.owner), createdAt: v.createdAt })).filter((x) => x.owner) };
    })());
    if (want('quizzes')) jobs.push((async () => {
      const r = await run(Quiz, { $and: [visQ(me, fids), { $or: [{ title: rx }, { desc: rx }] }] }, { createdAt: -1 }, 'owner title takes createdAt', ['owner', 'name avatar']);
      out.quizzes = { total: r.total, items: r.rows.map((q) => ({ id: String(q._id), title: q.title, takes: q.takes || 0, owner: who(q.owner), createdAt: q.createdAt })).filter((x) => x.owner) };
    })());
    if (want('pages')) jobs.push((async () => {
      const r = await run(Page, { name: rx }, { likeNum: -1 }, 'name pic likeNum verified');
      out.pages = { total: r.total, items: r.rows.map((p) => ({ id: String(p._id), name: p.name, pic: p.pic || '', likeNum: p.likeNum || 0, verified: !!p.verified })) };
    })());
    await Promise.all(jobs);
    res.json({ q, type, page, per: lim, results: out });
  }));
};
