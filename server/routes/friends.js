/* Tìm người, nhắc tên, hồ sơ công khai, bạn bè */
const { Types, User, Friendship, Message, ProfileField, N, social, S, wrap, fail, auth, completeTask, fxOf, friendIds, pair } = require('./shared');

module.exports = (router) => {
/* ---------- Bạn bè ---------- */

router.get('/users', auth, wrap(async (req, res) => {          // tìm người để kết bạn
  const q = S(req.query.q).trim().slice(0, 30);
  if (q.length < 2) return res.json([]);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // Trường hồ sơ có bật "cho phép tìm" (và không ẩn) cũng được dùng để tìm người
  const sf = await ProfileField.find({ allowsearch: true, invisible: false }).select('_id');
  const users = await User.find({ _id: { $ne: req.uid }, $or: [{ name: rx }, { username: rx }, ...sf.map((d) => ({ ['extra.' + d.id]: rx }))] }).limit(10);
  const ids = users.map((u) => u._id);
  const rel = await Friendship.find({ $or: [{ from: req.uid, to: { $in: ids } }, { from: { $in: ids }, to: req.uid }] });
  res.json(users.map((u) => {
    const f = rel.find((r) => String(r.from) === u.id || String(r.to) === u.id);
    return { id: u.id, name: u.name, username: u.username, avatar: u.avatar || '',
      rel: !f ? 'none' : f.status === 'accepted' ? 'friends' : String(f.from) === req.uid ? 'sent' : 'received' };
  }));
}));

router.get('/mention/suggest', auth, wrap(async (req, res) => {   // gợi ý khi gõ @ : chỉ trong danh sách BẠN BÈ của mình (không lộ người lạ), khớp đầu tên đăng nhập hoặc đầu một từ của tên
  const q = S(req.query.q).trim().toLowerCase().slice(0, 20);
  const ids = await friendIds(req.uid);
  if (!ids.length) return res.json([]);
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = { _id: { $in: ids }, username: { $exists: true, $ne: '' } };
  if (q) filter.$or = [{ username: new RegExp('^' + esc, 'i') }, { name: new RegExp('(^|\\s)' + esc, 'i') }];
  const list = await User.find(filter).select('name username avatar').sort({ name: 1 }).limit(6).lean();
  res.json(list.map((u) => ({ id: String(u._id), name: u.name, username: u.username, avatar: u.avatar || '' })));
}));

router.get('/users/by-username/:u', auth, wrap(async (req, res) => {   // bấm vào @tên_đăng_nhập -> lấy id để mở hồ sơ
  const u = S(req.params.u).toLowerCase();
  const found = /^[a-z0-9._]{3,20}$/.test(u) ? await User.findOne({ username: u }).select('name avatar') : null;
  if (!found || (await require('../vis').blockedBetween(req.uid, found.id))) return fail(res, 'Không tìm thấy người dùng.', null, 404);
  res.json({ id: found.id, name: found.name, avatar: found.avatar || '' });
}));

router.get('/users/:id', auth, wrap(async (req, res) => {      // hồ sơ công khai của một người
  const u = await User.findById(req.params.id);
  if (!u) return fail(res, 'Không tìm thấy người dùng.', null, 404);
  const { blockedBetween } = require('../vis');
  const isBlocked = u.id !== req.uid && await blockedBetween(u._id, req.uid);
  if (isBlocked) return fail(res, 'Bạn không thể xem trang của người này.', null, 403);
  social.recordVisit(u._id, req.uid);   // khách ghé thăm / dấu chân (không chờ, lỗi cũng không ảnh hưởng)
  const f = u.id === req.uid ? null : await Friendship.findOne(pair(req.uid, u.id));
  const rel = u.id === req.uid ? 'self' : !f ? 'none' : f.status === 'accepted' ? 'friends' : String(f.from) === req.uid ? 'sent' : 'received';
  const friendCount = await Friendship.countDocuments({ status: 'accepted', $or: [{ from: u._id }, { to: u._id }] });
  // Quyền xem từng phần hồ sơ (port cp_privacy của UCHome)
  const { canViewSection } = require('../vis');
  const showInfo = canViewSection(u, 'info', rel);
  // Email, số điện thoại không bao giờ lộ ra; ngày sinh chỉ bạn bè mới thấy
  const online = !!(u.lastSeen && Date.now() - new Date(u.lastSeen).getTime() < 10 * 60 * 1000);
  res.json({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || '', cover: u.cover || '', coverPos: u.coverPos || '50% 50%', online, joined: u.createdAt, rel, friendCount, blueTick: !!u.blueTick, location: showInfo ? (u.location || '') : '', bio: showInfo ? (u.bio || '') : '',
    mood: u.mood || '', credit: u.credit || 0, level: require('../credit').levelOf(u.experience || 0),
    birthday: rel === 'friends' && u.birthday ? u.birthday.toISOString().slice(0, 10) : '',
    extra: showInfo ? (await ProfileField.find({ invisible: false }).sort({ displayorder: 1, _id: 1 })).map((d) => ({ id: d.id, title: d.title, value: (u.extra && u.extra.get(d.id)) || '' })).filter((x) => x.value) : [],
    theme: { id: u.theme || '', bg: u.themeBg || '', accent: u.themeAccent || '' }, fx: fxOf(u) });
}));

router.get('/friends', auth, wrap(async (req, res) => {
  const [list, un, meDoc] = await Promise.all([
    Friendship.find({ $or: [{ from: req.uid }, { to: req.uid }] }).populate('from', 'name avatar').populate('to', 'name avatar'),
    Message.aggregate([{ $match: { to: new Types.ObjectId(req.uid), read: false } }, { $group: { _id: '$from', n: { $sum: 1 } } }]),
    User.findById(req.uid).select('friendGroups hideGroups visitSeen').lean(),
  ]);
  const visitorNew = await social.newVisitorCount(req.uid, meDoc && meDoc.visitSeen);
  const unread = Object.fromEntries(un.map((x) => [String(x._id), x.n]));
  const out = { friends: [], incoming: [], sent: [] };
  list.forEach((f) => {
    if (!f.from || !f.to) return;
    const mine = String(f.from._id) === req.uid, o = mine ? f.to : f.from, u = { id: o.id, name: o.name, avatar: o.avatar || '' };
    if (f.status === 'accepted') out.friends.push({ ...u, unread: unread[o.id] || 0, g: (mine ? f.gFrom : f.gTo) || 0 });
    else (mine ? out.sent : out.incoming).push(u);
  });
  out.friends.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  out.groups = social.namesOf(meDoc); out.hidden = (meDoc && meDoc.hideGroups) || []; out.visitorNew = visitorNew;   // tên 8 nhóm bạn, nhóm đang ẩn khỏi bảng tin, số khách mới
  res.json(out);
}));

router.post('/friends/:id/request', auth, wrap(async (req, res) => {
  const id = req.params.id;
  if (id === req.uid) return fail(res, 'Không thể kết bạn với chính mình.');
  if (!(await User.exists({ _id: id }))) return fail(res, 'Không tìm thấy người dùng.', null, 404);
  if (await require('../vis').blockedBetween(req.uid, id)) return fail(res, 'Bạn không thể kết bạn với người này.', null, 403);
  const f = await Friendship.findOne(pair(req.uid, id));
  if (!f) { const nf = await Friendship.create({ from: req.uid, to: id }); await N.add('friend_request', nf.id, id, req.uid); return res.status(201).json({ status: 'sent' }); }
  if (f.status === 'pending' && String(f.to) === req.uid) {   // hai bên cùng gửi -> tự thành bạn
    f.status = 'accepted'; await f.save();
    await N.remove('friend_request', f.id, req.uid); await N.add('friend_accept', f.id, String(f.from), req.uid);
  }
  res.json({ status: f.status === 'accepted' ? 'friends' : 'sent' });
}));

router.post('/friends/:id/accept', auth, wrap(async (req, res) => {
  const f = await Friendship.findOneAndUpdate({ from: req.params.id, to: req.uid, status: 'pending' }, { status: 'accepted' });
  if (!f) return fail(res, 'Không có lời mời nào từ người này.', null, 404);
  await N.remove('friend_request', f.id, req.uid);                       // đã trả lời lời mời -> bỏ thông báo lời mời
  await N.add('friend_accept', f.id, req.params.id, req.uid);            // báo cho người gửi lời mời
  completeTask(req.uid, 'friend'); completeTask(req.params.id, 'friend');   // nhiệm vụ kết bạn đầu tiên
  res.json({ ok: true });
}));

router.delete('/friends/:id', auth, wrap(async (req, res) => {   // hủy kết bạn / từ chối / hủy lời mời
  await Friendship.deleteMany(pair(req.uid, req.params.id));
  await N.removeBetween(req.uid, req.params.id);
  res.json({ ok: true });
}));
};
