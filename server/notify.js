/* Trung tâm thông báo – port LOGIC của module `notification` (phpFox 3.0), viết lại bằng Node + MongoDB (không chép mã PHP).

   Giữ nguyên cách phpFox vận hành:
   - Mỗi sự kiện là 1 dòng {type, item, user = người nhận, owner = người gây ra, seen}. Người tự làm việc đó không nhận thông báo (process::add).
   - Menu thả xuống (get): lấy tối đa 5 nhóm theo (type, item), nhóm CHƯA XEM lên trước rồi mới nhất; mỗi nhóm có danh sách người cùng thực hiện
     ("An, Bình và 3 người khác"; nhóm chưa xem thì chỉ tính những người chưa xem); mở menu xong thì đánh dấu đã xem cả nhóm.
   - Mục gốc đã bị xóa (callback trả false) -> xóa thông báo luôn.
   - Trang "Tất cả thông báo" (getForBrowse): liệt kê từng dòng, 100 dòng/trang, đánh dấu đã xem các dòng của trang.
   - Số trên chuông = số dòng chưa xem (getUnseenTotal). Ẩn 1 thông báo / xóa tất cả (hide / deleteAll). Client hỏi lại định kỳ (notify_ajax_refresh).
   - Hủy mục gốc (bỏ cảm xúc, hủy kết bạn, từ chối mời...) -> xóa thông báo tương ứng (delete / deleteByOwner).
   Thêm loại thông báo mới = thêm 1 hàm vào bảng RESOLVERS (tương đương callback getNotification của từng module phpFox). */
const { Types, isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const Ably = require('ably');
const push = require('./push');
const { Notification, User, Post, Photo, Blog, Event, Friendship, Poke, Guestbook, GroupInvite, Thread, Doing, Share,
  ForumThread, Video, Quiz, UserGift, Page } = require('./models');

const DROP_LIMIT = 5;      // phpFox: ->limit(5) ở menu thả xuống
const PAGE_SIZE = 100;     // phpFox: $iPageTotal = 100 ở trang danh sách
const TITLE_LEN = 100;     // phpFox: setting total_notification_title_length
const ACTORS_MAX = 10;     // phpFox: ->limit(10) khi lấy "những người khác"

const ably = process.env.ABLY_API_KEY ? new Ably.Rest({ key: process.env.ABLY_API_KEY }) : null;
const oid = (v) => new Types.ObjectId(String(v));
const ping = async (to) => {            // báo realtime "có thông báo mới" để chuông cập nhật ngay; lỗi realtime không được làm hỏng việc chính
  if (!ably) return;
  try { await ably.channels.get('inbox:' + to).publish('notif', {}); } catch (e) { console.error('Ably:', e.message); }
};
const safe = async (fn) => { try { return await fn(); } catch (e) { console.error('Notification:', e.message); return false; } };   // thông báo lỗi không bao giờ làm hỏng thao tác chính

/* ---------- Ghi (process.class.php) ---------- */
// add(): người nhận = chính người làm -> bỏ qua
const add = (type, item, to, from, meta = '') => safe(async () => {
  if (!to || !from || String(to) === String(from)) return false;
  const row = await Notification.create({ type, item, user: to, owner: from, meta });
  await ping(String(to));
  await pushRow(row);   // PHẢI await: trên Vercel (serverless) hàm bị dừng ngay khi đã trả lời, lệnh không await sẽ bị bỏ dở -> chuông không nhảy số
  return true;
});
// addMany(): cùng một sự kiện báo cho nhiều người nhận (vd. bạn bè của người đăng bài). Bỏ người tự làm; tối đa 500 người (bằng giới hạn bạn bè).
// Ghi DB một lượt (insertMany), còn báo realtime thì chia từng đợt 50 để không mở quá nhiều kết nối cùng lúc trên serverless.
const addMany = (type, item, tos, from, meta = '') => safe(async () => {
  const list = [...new Set((tos || []).map(String))].filter((t) => t && t !== String(from)).slice(0, 500);
  if (!list.length) return false;
  await Notification.insertMany(list.map((user) => ({ type, item, user, owner: from, meta })), { ordered: false });
  for (let i = 0; i < list.length; i += 50) await Promise.all(list.slice(i, i + 50).map(ping));   // await: serverless dừng ngay sau khi trả lời
  return true;
});
const remove = (type, item, user) => safe(() => Notification.deleteMany({ type, item, user }));                       // delete()
const removeByOwner = (type, item, user, owner) => safe(() => Notification.deleteMany({ type, item, user, owner }));  // xóa dòng của đúng 1 người làm
const removeFrom = (type, owner, user) => safe(() => Notification.deleteMany({ type, owner, user }));                 // deleteByOwner() của phpFox
const removeType = (user, type) => safe(() => Notification.deleteMany({ user, type }));
const purge = (types, item) => safe(() => Notification.deleteMany({ type: { $in: types }, item }));                   // mục gốc bị xóa: dọn mọi người nhận
const removeBetween = (a, b) => safe(() => Notification.deleteMany({ type: { $in: ['friend_request', 'friend_accept'] },
  $or: [{ user: a, owner: b }, { user: b, owner: a }] }));
// đổi cảm xúc / chọc lại: bỏ dòng cũ của người đó rồi thêm dòng mới (meta = null -> chỉ bỏ, như khi bấm lại để hủy cảm xúc)
const swap = async (type, item, to, from, meta) => { await removeByOwner(type, item, to, from); if (meta !== null) await add(type, item, to, from, meta || ''); };
const purgeUser = (uid) => safe(() => Notification.deleteMany({ $or: [{ user: uid }, { owner: uid }] }));              // onDeleteUser()

/* ---------- Đọc (notification.class.php) ---------- */
const unseenTotal = (uid) => Notification.countDocuments({ user: uid, seen: false });                                  // getUnseenTotal()

const cut = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > TITLE_LEN ? s.slice(0, TITLE_LEN).trimEnd() + '…' : s; };
const whoOf = (names) => {                                                                                              // getUsers(): tối đa 2 tên rồi "và N người khác"
  if (names.length <= 1) return names[0] || 'Ai đó';
  if (names.length === 2) return names[0] + ' và ' + names[1];
  return names.slice(0, 2).join(', ') + ' và ' + (names.length - 2) + ' người khác';
};

/* Mỗi loại thông báo = 1 hàm (tương đương callback getNotification): nhận các dòng cùng loại + id người nhận,
   trả Map<itemId, {msg, title, link, icon}>; mục nào KHÔNG có trong Map = mục gốc không còn -> thông báo bị xóa. */
// tiêu đề thông báo của một bài: nội dung chữ, hoặc [ảnh] / [video] nếu bài chỉ có ảnh / video
const postTitle = (d) => cut(d.text) || (d.photos && d.photos.length ? '[Ảnh]' : d.video && d.video.kind ? '[Video]' : '');
const mk = (docs, fn) => new Map(docs.filter(Boolean).map((d) => [String(d._id), fn(d)]));
const ids = (rows) => [...new Set(rows.map((r) => String(r.item)))];
const RESOLVERS = {
  friend_request: async (rows, uid) => mk(await Friendship.find({ _id: { $in: ids(rows) }, to: uid, status: 'pending' }).select('_id').lean(),
    () => ({ msg: 'đã gửi cho bạn lời mời kết bạn', link: { view: 'profile', tab: 'bb' }, icon: '👥' })),
  friend_accept: async (rows, uid) => mk(await Friendship.find({ _id: { $in: ids(rows) }, status: 'accepted' }).select('_id').lean(),
    () => ({ msg: 'đã chấp nhận lời mời kết bạn của bạn', link: { view: 'user', user: '@actor' }, icon: '🤝' })),
  post_comment: async (rows, uid) => mk(await Post.find({ _id: { $in: ids(rows) }, author: uid }).select('text photos video.kind').lean(),
    (d) => ({ msg: 'đã bình luận về bài viết của bạn', title: postTitle(d), link: { view: 'profile', tab: 'nk' }, icon: '💬' })),
  post_react: async (rows, uid) => mk(await Post.find({ _id: { $in: ids(rows) }, author: uid }).select('text photos video.kind').lean(),
    (d) => ({ msg: 'đã bày tỏ cảm xúc {emoji} về bài viết của bạn', title: postTitle(d), link: { view: 'profile', tab: 'nk' }, icon: '👍' })),
  mention: async (rows, uid) => {   // được @nhắc tên trong bài ('p') hoặc bình luận ('c'); chỉ hiện khi bài còn và người nhận còn xem được
    const kind = {}; rows.forEach((r) => { kind[String(r.item)] = r.meta; });
    const docs = await Post.find({ _id: { $in: ids(rows) }, $or: [{ visibility: { $ne: 'private' } }, { author: uid }] }).select('author text photos video.kind').lean();
    return mk(docs, (d) => ({ msg: kind[String(d._id)] === 'c' ? 'đã nhắc đến bạn trong một bình luận' : 'đã nhắc đến bạn trong một bài viết', title: postTitle(d),
      link: String(d.author) === String(uid) ? { view: 'profile', tab: 'nk' } : { view: 'user', user: String(d.author) }, icon: '📣' }));
  },
  comment_react: async (rows, uid) => {   // item = id bình luận (con của bài viết); chỉ báo cho người viết bình luận
    const want = new Set(ids(rows));
    const posts = await Post.find({ 'comments._id': { $in: [...want] } }).select('author comments._id comments.user comments.text').lean();
    const out = new Map();
    for (const p of posts) for (const c of p.comments || []) {
      if (!want.has(String(c._id)) || String(c.user) !== String(uid)) continue;
      out.set(String(c._id), { msg: 'đã bày tỏ cảm xúc {emoji} về bình luận của bạn', title: cut(c.text), icon: '💬',
        link: String(p.author) === String(uid) ? { view: 'profile', tab: 'nk' } : { view: 'user', user: String(p.author) } });
    }
    return out;
  },
  photo_comment: async (rows, uid) => mk(await Photo.find({ _id: { $in: ids(rows) }, owner: uid }).select('caption album').lean(),
    (d) => ({ msg: 'đã bình luận về ảnh của bạn', title: cut(d.caption), link: { view: 'profile', tab: 'al', album: String(d.album), photo: String(d._id) }, icon: '🖼️' })),
  blog_comment: async (rows, uid) => mk(await Blog.find({ _id: { $in: ids(rows) }, owner: uid }).select('title').lean(),
    (d) => ({ msg: 'đã bình luận về nhật ký của bạn', title: cut(d.title), link: { view: 'profile', tab: 'bl' }, icon: '📓' })),
  event_comment: async (rows, uid) => mk(await Event.find({ _id: { $in: ids(rows) }, owner: uid }).select('title').lean(),
    (d) => ({ msg: 'đã bình luận về sự kiện của bạn', title: cut(d.title), link: { view: 'events', event: String(d._id) }, icon: '📅' })),
  event_join: async (rows, uid) => mk(await Event.find({ _id: { $in: ids(rows) }, owner: uid }).select('title').lean(),
    (d) => ({ msg: 'đã tham gia sự kiện của bạn', title: cut(d.title), link: { view: 'events', event: String(d._id) }, icon: '🙋' })),
  photo_react: async (rows, uid) => mk(await Photo.find({ _id: { $in: ids(rows) }, owner: uid }).select('caption album').lean(),
    (d) => ({ msg: 'đã bày tỏ cảm xúc {emoji} về ảnh của bạn', title: cut(d.caption), link: { view: 'profile', tab: 'al', album: String(d.album), photo: String(d._id) }, icon: '🖼️' })),
  wall: async (rows, uid) => mk(await Guestbook.find({ _id: { $in: ids(rows) }, owner: uid }).select('text').lean(),
    (d) => ({ msg: 'đã viết lên tường của bạn', title: cut(d.text), link: { view: 'profile', tab: 'lb' }, icon: '✏️' })),
  poke: async (rows, uid) => mk(await Poke.find({ _id: { $in: ids(rows) }, to: uid }).select('note').lean(),
    (d) => ({ msg: 'đã chọc bạn', title: cut(d.note), link: { view: 'profile', tab: 'ch' }, icon: '👋' })),
  friend_post: async (rows, uid) => {
    const fs = await Friendship.find({ status: 'accepted', $or: [{ from: uid }, { to: uid }] }).select('from to').lean();
    const mine = new Set(fs.map((f) => (String(f.from) === String(uid) ? String(f.to) : String(f.from))));   // đã hủy kết bạn -> thông báo biến mất
    const docs = await Post.find({ _id: { $in: ids(rows) }, visibility: { $ne: 'private' } }).select('author text photos video.kind').lean();
    return mk(docs.filter((d) => mine.has(String(d.author))),
      (d) => ({ msg: 'đã đăng bài viết mới', title: postTitle(d), link: { view: 'user', user: '@actor' }, icon: '📝' }));
  },
  group_invite: async (rows, uid) => mk((await GroupInvite.find({ _id: { $in: ids(rows) }, user: uid }).populate('group', 'name closed').lean()).filter((d) => d.group && !d.group.closed),
    (d) => ({ msg: 'đã mời bạn tham gia nhóm', title: cut(d.group.name), link: { view: 'groups', group: String(d.group._id) }, icon: '🏷️' })),
  thread_reply: async (rows, uid) => mk(await Thread.find({ _id: { $in: ids(rows) }, author: uid }).select('subject').lean(),
    (d) => ({ msg: 'đã trả lời chủ đề của bạn', title: cut(d.subject), link: { view: 'groups', thread: String(d._id) }, icon: '💭' })),
  doing_reply: async (rows, uid) => mk(await Doing.find({ _id: { $in: ids(rows) }, author: uid }).select('text').lean(),
    (d) => ({ msg: 'đã trả lời trạng thái của bạn', title: cut(d.text), link: { view: 'doings' }, icon: '💬' })),
  share: async (rows, uid) => mk(await Share.find({ _id: { $in: ids(rows) } }).select('note targetTitle kind').lean(),
    (d) => ({ msg: 'đã chia sẻ nội dung của bạn', title: cut(d.note || d.targetTitle), link: { view: 'doings' }, icon: '🔁' })),
  share_comment: async (rows, uid) => mk(await Share.find({ _id: { $in: ids(rows) }, author: uid }).select('note targetTitle').lean(),
    (d) => ({ msg: 'đã bình luận về chia sẻ của bạn', title: cut(d.note || d.targetTitle), link: { view: 'doings' }, icon: '💬' })),
  forum_reply: async (rows, uid) => mk(await ForumThread.find({ _id: { $in: ids(rows) }, author: uid }).select('title').lean(),
    (d) => ({ msg: 'đã trả lời chủ đề diễn đàn của bạn', title: cut(d.title), link: { view: 'forum', thread: String(d._id) }, icon: '💭' })),
  forum_sub_reply: async (rows, uid) => mk(await ForumThread.find({ _id: { $in: ids(rows) } }).select('title').lean(),
    (d) => ({ msg: 'đã trả lời chủ đề bạn theo dõi', title: cut(d.title), link: { view: 'forum', thread: String(d._id) }, icon: '💭' })),
  video_comment: async (rows, uid) => mk(await Video.find({ _id: { $in: ids(rows) }, owner: uid }).select('title').lean(),
    (d) => ({ msg: 'đã bình luận về video của bạn', title: cut(d.title), link: { view: 'videos', video: String(d._id) }, icon: '🎬' })),
  quiz_taken: async (rows, uid) => {
    const docs = await Quiz.find({ _id: { $in: ids(rows) }, owner: uid }).select('title').lean();
    const meta = {}; rows.forEach((r) => { meta[String(r.item)] = r.meta; });
    return mk(docs, (d) => ({ msg: 'đã làm quiz của bạn' + (meta[String(d._id)] ? ' (' + meta[String(d._id)] + ' điểm)' : ''),
      title: cut(d.title), link: { view: 'quizzes', quiz: String(d._id) }, icon: '❓' }));
  },
  gift_recv: async (rows, uid) => mk((await UserGift.find({ _id: { $in: ids(rows) }, to: uid }).populate('gift', 'name icon').lean()).filter((d) => d.gift),
    (d) => ({ msg: 'đã tặng bạn quà ' + (d.gift.icon || '🎁'), title: cut(d.gift.name), link: { view: 'gifts' }, icon: '🎁' })),
  page_like: async (rows, uid) => mk(await Page.find({ _id: { $in: ids(rows) }, owner: uid }).select('name').lean(),
    (d) => ({ msg: 'đã thích trang của bạn', title: cut(d.name), link: { view: 'pages', page: String(d._id) }, icon: '📄' })),
};

// Gọi callback theo từng loại. Trả { found: Map("type:item" -> info), known: Set(type) }
const resolveAll = async (rows, uid) => {
  const byType = {};
  rows.forEach((r) => (byType[r.type] = byType[r.type] || []).push(r));
  const found = new Map(), known = new Set();
  await Promise.all(Object.entries(byType).map(async ([type, rs]) => {
    if (!RESOLVERS[type]) return;                       // loại lạ (vd. bản cũ hơn): không đụng tới
    known.add(type);
    for (const [item, info] of await RESOLVERS[type](rs, uid)) found.set(type + ':' + item, info);
  }));
  return { found, known };
};
const finish = (info, actor, emoji) => {                // thay chỗ giữ chỗ {emoji} và @actor
  const link = { ...info.link };
  if (link.user === '@actor') link.user = actor.id;
  return { msg: info.msg.replace('{emoji}', emoji || '').replace(/\s{2,}/g, ' '), title: info.title || '', link, icon: info.icon };
};
// Đẩy thông báo ra điện thoại / trình duyệt (Web Push) cho các thiết bị đã bật. Dùng lại đúng câu chữ của trung tâm thông báo trong app.
// Chỉ gọi cho add() (1 người nhận). addMany() (bài mới của bạn bè, tới 500 người) cố ý KHÔNG đẩy để tránh làm phiền và nghẽn serverless.
const pushRow = async (row) => {
  try {
    if (!push.enabled() || !(await push.has(row.user))) return;
    const [actor, found] = await Promise.all([User.findById(row.owner).select('name').lean(), RESOLVERS[row.type] ? RESOLVERS[row.type]([row], row.user) : null]);
    const info = found && found.get(String(row.item));
    if (!actor || !info) return;
    const f = finish(info, { id: String(row.owner) }, row.meta);
    await push.sendTo(row.user, { title: actor.name, body: f.msg + (f.title ? ': ' + f.title : ''), tag: row.type + ':' + row.item, url: '/?n=' + row._id });
  } catch (e) { console.error('[push]', e.message); }
};
const person = (u) => ({ id: String(u._id), name: u.name, avatar: u.avatar || '' });
const usersOf = async (idList) => new Map((await User.find({ _id: { $in: [...new Set(idList.map(String))] } }).select('name avatar').lean()).map((u) => [String(u._id), person(u)]));

/* get(): nội dung menu thả xuống. Đánh dấu đã xem các nhóm vừa hiện (phpFox làm ngay trong get()). */
const recent = async (uid) => {
  const u = oid(uid);
  const groups = await Notification.aggregate([
    { $match: { user: u } }, { $sort: { createdAt: -1 } },
    { $group: { _id: { t: '$type', i: '$item' }, head: { $first: '$$ROOT' }, total: { $sum: 1 }, unseen: { $sum: { $cond: ['$seen', 0, 1] } } } },
    { $addFields: { fresh: { $cond: [{ $gt: ['$unseen', 0] }, 1, 0] } } },
    { $sort: { fresh: -1, 'head.createdAt': -1 } }, { $limit: DROP_LIMIT },
  ]);
  if (!groups.length) return { items: [], unseen: 0 };
  const heads = groups.map((g) => g.head);
  const { found, known } = await resolveAll(heads, uid);
  // "những người khác" của các nhóm có nhiều dòng
  const multi = groups.filter((g) => g.total > 1);
  const acts = multi.length ? await Notification.aggregate([
    { $match: { user: u, $or: multi.map((g) => ({ type: g._id.t, item: g._id.i })) } }, { $sort: { createdAt: -1 } },
    { $group: { _id: { t: '$type', i: '$item', o: '$owner' }, at: { $first: '$createdAt' }, unseen: { $sum: { $cond: ['$seen', 0, 1] } } } },
    { $sort: { at: -1 } },
  ]) : [];
  const people = await usersOf([...heads.map((h) => h.owner), ...acts.map((a) => a._id.o)]);
  const items = [], dead = [], shown = [];
  for (const g of groups) {
    const key = { type: g._id.t, item: g._id.i }, h = g.head, info = found.get(g._id.t + ':' + g._id.i);
    if (known.has(g._id.t) && !info) { dead.push(key); continue; }                       // callback trả false -> xóa thông báo
    shown.push(key);
    if (!info) continue;
    const head = people.get(String(h.owner));
    if (!head) continue;                                                                   // người gây ra đã bị xóa tài khoản
    let who = [head];
    if (g.total > 1) {
      const mine = acts.filter((a) => a._id.t === g._id.t && String(a._id.i) === String(g._id.i) && (g.unseen === 0 || a.unseen > 0));
      const list = mine.map((a) => people.get(String(a._id.o))).filter(Boolean);
      who = [head, ...list.filter((x) => x.id !== head.id)].slice(0, ACTORS_MAX);
    }
    const f = finish(info, head, who.length === 1 ? h.meta : '');
    items.push({ id: String(h._id), type: g._id.t, isNew: g.unseen > 0, at: h.createdAt, actor: head, who: whoOf(who.map((x) => x.name)), more: who.length - 1,
      total: g.total, ...f });
  }
  if (dead.length) await Notification.deleteMany({ user: u, $or: dead.map((k) => ({ type: k.type, item: k.item })) });
  if (shown.length) await Notification.updateMany({ user: u, seen: false, $or: shown.map((k) => ({ type: k.type, item: k.item })) }, { seen: true });
  items.sort((a, b) => new Date(b.at) - new Date(a.at));                                  // phpFox: arsort theo id -> mới nhất lên đầu
  return { items, unseen: await unseenTotal(uid) };
};

/* getForBrowse(): trang đầy đủ, từng dòng, 100/trang; đánh dấu đã xem các dòng của trang */
const browse = async (uid, page) => {
  const q = { user: uid }, pg = Math.max(1, Math.min(10000, parseInt(page, 10) || 1));
  const [total, rows] = await Promise.all([Notification.countDocuments(q),
    Notification.find(q).sort({ createdAt: -1 }).skip((pg - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean()]);
  const { found, known } = await resolveAll(rows, uid);
  const people = await usersOf(rows.map((r) => r.owner));
  const items = [], dead = [];
  for (const r of rows) {
    const info = found.get(r.type + ':' + r.item), actor = people.get(String(r.owner));
    if ((known.has(r.type) && !info) || !actor) { dead.push(r._id); continue; }
    if (!info) continue;
    items.push({ id: String(r._id), type: r.type, seen: r.seen, at: r.createdAt, actor, who: actor.name, ...finish(info, actor, r.meta) });
  }
  if (dead.length) await Notification.deleteMany({ _id: { $in: dead }, user: uid });
  if (rows.length) await Notification.updateMany({ _id: { $in: rows.map((r) => r._id) }, seen: false }, { seen: true });
  return { total: total - dead.length, page: pg, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), per: PAGE_SIZE, items };
};

/* ---------- API ---------- */
const routes = (router, { auth, wrap, fail }) => {
  const lim = rateLimit({ store: rlStore('notify.lim'), windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false, message: { error: 'Thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });
  router.get('/notifications/count', auth, lim, wrap(async (req, res) => res.json({ unseen: await unseenTotal(req.uid) })));             // getNewCount
  router.post('/notifications/recent', auth, lim, wrap(async (req, res) => res.json(await recent(req.uid))));                            // mở menu thả xuống
  router.get('/notifications', auth, lim, wrap(async (req, res) => res.json(await browse(req.uid, req.query.page))));                    // trang danh sách
  router.post('/notifications/seen', auth, lim, wrap(async (req, res) => {                                                               // updateSeen
    const list = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((x) => typeof x === 'string' && isValidObjectId(x)).slice(0, 100);
    if (list.length) await Notification.updateMany({ _id: { $in: list }, user: req.uid }, { seen: true });
    res.json({ unseen: await unseenTotal(req.uid) });
  }));
  router.delete('/notifications', auth, lim, wrap(async (req, res) => {                                                                  // deleteAll / removeAll
    await Notification.deleteMany({ user: req.uid });
    res.json({ ok: true, unseen: 0 });
  }));
  router.delete('/notifications/:id', auth, lim, wrap(async (req, res) => {                                                              // hide / deleteById (chỉ của chính mình)
    const r = await Notification.deleteOne({ _id: req.params.id, user: req.uid });
    r.deletedCount ? res.json({ ok: true, unseen: await unseenTotal(req.uid) }) : fail(res, 'Không tìm thấy thông báo.', null, 404);
  }));
};

module.exports = { add, addMany, remove, removeByOwner, removeFrom, removeType, removeBetween, purge, swap, purgeUser, unseenTotal, recent, browse, routes, whoOf, RESOLVERS };
