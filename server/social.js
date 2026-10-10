/* Khách ghé thăm + bạn bè nâng cao – port từ UCenter Home:
   - visitor / trace (space_friend view=visitor|trace, cron cleantrace)
   - nhóm bạn bè (getfriendgroup, cp_friend op=group|groupname|groupignore)
   - tìm / gợi ý bạn (cp_friend op=find|rand|getcfriend)
   - mã mời (cp_invite)
   Không chép mã PHP; viết lại bằng Node/Mongo. Không dùng IP để gợi ý "người gần bạn" (UCHome có, nhưng trên Vercel IP không đáng tin và là dữ liệu cá nhân). */
const { isValidObjectId, Types } = require('mongoose');
const { need } = require('./perms');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const crypto = require('crypto');
const { User, Friendship, Visitor, Invite } = require('./models');

const GROUPS = 8;                                            // UCHome: groupnum = 8 (0 = Khác, 1..7 đặt tên được)
const DEFAULT_NAMES = ['Khác', 'Bạn bè Online', 'Sự kiện gặp gỡ', 'Bạn bè của bạn', 'Người thân', 'Đồng nghiệp', 'Bạn cùng lớp', 'Người lạ'];
const PER_PAGE = 20, MAX_UNUSED_INVITES = 20, SUGGEST_MAX = 18, ACTIVE_MS = 24 * 3600 * 1000;
const CODE_RX = /^[a-f0-9]{12}$/;
const oid = (v) => new Types.ObjectId(String(v));

const namesOf = (u) => DEFAULT_NAMES.map((d, i) => (i > 0 && u && u.friendGroups && u.friendGroups[i - 1]) || d);
const cardOf = (u) => ({ id: u.id || String(u._id), name: u.name, username: u.username, avatar: u.avatar || '' });

// Id bạn bè (đã chấp nhận) của một người
const friendIdsOf = async (me) => (await Friendship.find({ status: 'accepted', $or: [{ from: me }, { to: me }] }).select('from to').lean())
  .map((f) => String(f.from) === String(me) ? String(f.to) : String(f.from));

// Bạn bè nằm trong các nhóm mà người dùng đã chọn ẩn khỏi bảng tin (groupignore). Dùng ở GET /posts.
const hiddenFriendIds = async (me) => {
  const u = await User.findById(me).select('hideGroups').lean();
  const hide = (u && u.hideGroups) || [];
  if (!hide.length) return new Set();
  const rows = await Friendship.find({ status: 'accepted', $or: [{ from: me, gFrom: { $in: hide } }, { to: me, gTo: { $in: hide } }] }).select('from to').lean();
  return new Set(rows.map((f) => String(f.from) === String(me) ? String(f.to) : String(f.from)));
};

// Gọi sau khi email được xác thực: nếu người này đăng ký bằng mã mời thì dùng mã (nguyên tử, một lần) và kết bạn với người mời
const applyInvite = async (u, N) => {
  if (!u || !u.inviteCode) return;
  const code = u.inviteCode;
  await User.updateOne({ _id: u._id }, { $unset: { inviteCode: 1 } });      // dù thành công hay không cũng chỉ thử một lần
  const inv = await Invite.findOneAndUpdate({ code, usedBy: null, owner: { $ne: u._id } }, { usedBy: u._id, usedAt: new Date() });
  if (!inv) return;
  const owner = await User.findById(inv.owner).select('banned').lean();
  if (!owner || owner.banned) return;
  let f = await Friendship.findOne({ $or: [{ from: inv.owner, to: u._id }, { from: u._id, to: inv.owner }] });
  if (!f) f = await Friendship.create({ from: inv.owner, to: u._id, status: 'accepted' });
  else if (f.status !== 'accepted') { f.status = 'accepted'; await f.save(); }
  if (N) { await N.remove('friend_request', f.id, String(inv.owner)); await N.add('friend_accept', f.id, String(inv.owner), String(u._id)); }
  try {   // thưởng người mời (credit + nhiệm vụ)
    const { award, completeTask } = require('./credit');
    award(String(inv.owner), 'invite', 'mời bạn thành công'); completeTask(String(inv.owner), 'invite');
  } catch (e) { console.error('invite reward:', e.message); }
};

/* ---------- Route công khai (gọi khi chưa đăng nhập, phải mount TRƯỚC router.use(auth)) ---------- */
const mountPublic = (router, { wrap, fail, S }) => {
  const lim = rateLimit({ store: rlStore('social.lim'), windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút.' } });
  // Form đăng ký hỏi trước mã mời có dùng được không và ai mời (chỉ lộ tên + ảnh đại diện công khai của người mời)
  router.get('/invites/check', lim, wrap(async (req, res) => {
    const code = S(req.query.code).trim().toLowerCase();
    if (!CODE_RX.test(code)) return fail(res, 'Mã mời không hợp lệ.');
    const inv = await Invite.findOne({ code, usedBy: null }).populate('owner', 'name avatar banned').lean();
    if (!inv || !inv.owner || inv.owner.banned) return fail(res, 'Mã mời không hợp lệ hoặc đã được dùng.', null, 404);
    res.json({ ok: true, inviter: { name: inv.owner.name, avatar: inv.owner.avatar || '' } });
  }));
};

/* ---------- Route cần đăng nhập + đã xác thực email ---------- */
const mount = (router, { auth, wrap, fail, S, areFriends }) => {
  const rate = (limit, msg) => rateLimit({ store: rlStore('social.rate'), windowMs: 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: msg || 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });
  const writeLim = rate(30);
  const page = (req) => Math.max(parseInt(S(req.query.page), 10) || 1, 1);

  /* ----- Khách ghé thăm + dấu chân -----
     Việc ghi nhận nằm ở GET /users/:id (routes/friends.js) qua recordVisit(). Danh sách chỉ chủ trang xem được. */
  const listVisits = (field) => wrap(async (req, res) => {
    const me = req.uid, other = field === 'owner' ? 'visitor' : 'owner', pg = page(req);
    const q = { [field]: me };
    const [total, rows, u] = await Promise.all([
      Visitor.countDocuments(q),
      Visitor.find(q).sort({ at: -1 }).skip((pg - 1) * PER_PAGE).limit(PER_PAGE).populate(other, 'name username avatar banned').lean(),
      field === 'owner' ? User.findById(me).select('visitSeen').lean() : null,
    ]);
    const seen = u && u.visitSeen ? new Date(u.visitSeen).getTime() : 0;
    const ids = rows.map((r) => r[other] && r[other]._id).filter(Boolean);
    const rel = ids.length ? await Friendship.find({ $or: [{ from: me, to: { $in: ids } }, { from: { $in: ids }, to: me }] }).lean() : [];
    const items = rows.filter((r) => r[other] && !r[other].banned).map((r) => {
      const o = r[other], f = rel.find((x) => String(x.from) === String(o._id) || String(x.to) === String(o._id));
      return { ...cardOf(o), at: r.at, isNew: field === 'owner' && new Date(r.at).getTime() > seen,
        rel: !f ? 'none' : f.status === 'accepted' ? 'friends' : String(f.from) === me ? 'sent' : 'received' };
    });
    if (field === 'owner' && pg === 1) await User.updateOne({ _id: me }, { visitSeen: new Date() });      // mở danh sách = đã xem
    res.json({ total, page: pg, per: PER_PAGE, items });
  });
  router.get('/me/visitors', listVisits('owner'));     // ai đã xem trang của mình
  router.get('/me/trace', listVisits('visitor'));      // mình đã ghé trang của ai (dấu chân)

  /* ----- Nhóm bạn bè ----- */
  router.put('/me/friend-groups', writeLim, wrap(async (req, res) => {      // đổi tên nhóm 1..7 ('' = về tên mặc định)
    const raw = Array.isArray(req.body.names) ? req.body.names : [];
    const names = Array.from({ length: GROUPS - 1 }, (_, i) => S(raw[i]).replace(/\s+/g, ' ').trim().slice(0, 20));
    await User.updateOne({ _id: req.uid }, { friendGroups: names });
    res.json({ names: namesOf({ friendGroups: names }) });
  }));

  router.put('/me/friend-groups/hidden', writeLim, wrap(async (req, res) => {   // nhóm nào ẩn khỏi bảng tin
    const hide = [...new Set((Array.isArray(req.body.hidden) ? req.body.hidden : []).map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x < GROUPS))];
    await User.updateOne({ _id: req.uid }, { hideGroups: hide });
    res.json({ hidden: hide });
  }));

  // Xếp nhiều bạn vào một nhóm: { ids: [...], group: 0..7 }
  const setGroup = async (me, ids, group) => {
    const list = ids.map(oid);
    await Promise.all([
      Friendship.updateMany({ status: 'accepted', from: oid(me), to: { $in: list } }, { gFrom: group }),
      Friendship.updateMany({ status: 'accepted', to: oid(me), from: { $in: list } }, { gTo: group }),
    ]);
  };
  const groupOf = (v) => { const g = parseInt(v, 10); return Number.isInteger(g) && g >= 0 && g < GROUPS ? g : -1; };

  router.post('/friends/group', writeLim, wrap(async (req, res) => {
    const g = groupOf(req.body.group);
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(S).filter(isValidObjectId))].slice(0, 200);
    if (g < 0) return fail(res, 'Nhóm không hợp lệ.');
    if (!ids.length) return fail(res, 'Hãy chọn ít nhất một người bạn.');
    await setGroup(req.uid, ids, g);
    res.json({ ok: true });
  }));

  router.put('/friends/:id/group', writeLim, wrap(async (req, res) => {
    const g = groupOf(req.body.group);
    if (g < 0) return fail(res, 'Nhóm không hợp lệ.');
    if (!(await areFriends(req.uid, req.params.id))) return fail(res, 'Người này chưa phải bạn của bạn.', null, 404);
    await setGroup(req.uid, [req.params.id], g);
    res.json({ ok: true });
  }));

  /* ----- Gợi ý kết bạn / bạn chung / bạn ngẫu nhiên ----- */
  // Bạn của bạn bè (xếp theo số bạn chung), rồi tới người mới hoạt động gần đây. Loại: mình, bạn bè, người đang có lời mời hai chiều, tài khoản bị khóa / chưa xác thực.
  router.get('/friends/suggest', wrap(async (req, res) => {
    const me = req.uid;
    const [rel, mine] = await Promise.all([
      Friendship.find({ $or: [{ from: me }, { to: me }] }).select('from to status').lean(),
      friendIdsOf(me),
    ]);
    const skip = new Set([String(me)]);
    rel.forEach((f) => { skip.add(String(f.from)); skip.add(String(f.to)); });
    const count = new Map();
    if (mine.length) {
      const edges = await Friendship.find({ status: 'accepted', $or: [{ from: { $in: mine } }, { to: { $in: mine } }] }).select('from to').limit(5000).lean();
      const mineSet = new Set(mine);
      edges.forEach((e) => {
        const a = String(e.from), b = String(e.to), other = mineSet.has(a) ? b : a;
        if (!skip.has(other)) count.set(other, (count.get(other) || 0) + 1);
      });
    }
    const top = [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, SUGGEST_MAX);
    const ok = { banned: { $ne: true }, verified: { $ne: false } };
    const fofUsers = top.length ? await User.find({ _id: { $in: top.map((t) => t[0]) }, ...ok }).select('name username avatar').lean() : [];
    const byId = new Map(fofUsers.map((u) => [String(u._id), u]));
    const fof = top.filter((t) => byId.has(t[0])).map((t) => ({ ...cardOf(byId.get(t[0])), mutual: t[1] }));
    const used = new Set([...skip, ...fof.map((x) => x.id)]);
    const activeUsers = await User.find({ _id: { $nin: [...used].map(oid) }, lastSeen: { $gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) }, ...ok })
      .sort({ lastSeen: -1 }).limit(SUGGEST_MAX).select('name username avatar lastSeen').lean();
    const active = activeUsers.map((u) => ({ ...cardOf(u), mutual: 0, recent: Date.now() - new Date(u.lastSeen).getTime() < ACTIVE_MS }));
    res.json({ fof, active });
  }));

  // Chuyển tới trang một người bạn ngẫu nhiên (ít hơn 5 bạn thì lẫn thêm người mới hoạt động, như UCHome)
  router.get('/friends/random', wrap(async (req, res) => {
    const me = String(req.uid);
    let pool = await friendIdsOf(me);
    if (pool.length < 5) {
      const more = await User.find({ _id: { $ne: me }, banned: { $ne: true }, verified: { $ne: false } }).sort({ lastSeen: -1 }).limit(30).select('_id').lean();
      pool = [...new Set([...pool, ...more.map((u) => String(u._id))])];
    }
    if (!pool.length) return fail(res, 'Chưa có ai để chọn.', null, 404);
    res.json({ id: pool[crypto.randomInt(pool.length)] });
  }));

  // Bạn chung giữa mình và một người khác
  router.get('/users/:id/mutual', wrap(async (req, res) => {
    if (req.params.id === req.uid) return res.json({ count: 0, users: [] });
    const [a, b] = await Promise.all([friendIdsOf(req.uid), friendIdsOf(req.params.id)]);
    const bs = new Set(b), both = a.filter((x) => bs.has(x));
    const users = both.length ? await User.find({ _id: { $in: both.slice(0, 30) }, banned: { $ne: true } }).select('name username avatar').lean() : [];
    res.json({ count: both.length, users: users.map(cardOf) });
  }));

  /* ----- Mã mời ----- */
  const inviteView = (i, usedBy) => ({ id: i.id || String(i._id), code: i.code, createdAt: i.createdAt, usedAt: i.usedAt || null, usedBy: usedBy ? cardOf(usedBy) : null });

  router.get('/invites', wrap(async (req, res) => {
    const list = await Invite.find({ owner: req.uid }).sort({ createdAt: -1 }).limit(100).populate('usedBy', 'name username avatar').lean();
    res.json({ max: MAX_UNUSED_INVITES, invites: list.map((i) => inviteView(i, i.usedBy)) });
  }));

  router.post('/invites', rate(10, 'Bạn tạo mã quá nhanh, vui lòng thử lại sau.'), need('invite'), wrap(async (req, res) => {
    if ((await Invite.countDocuments({ owner: req.uid, usedBy: null })) >= MAX_UNUSED_INVITES) return fail(res, `Bạn đang có ${MAX_UNUSED_INVITES} mã chưa dùng. Hãy dùng hoặc xóa bớt rồi tạo thêm.`);
    const inv = await Invite.create({ owner: req.uid, code: crypto.randomBytes(6).toString('hex') });
    res.status(201).json({ invite: inviteView(inv, null) });
  }));

  router.delete('/invites/:id', wrap(async (req, res) => {              // chỉ xóa được mã chưa dùng của chính mình
    const r = await Invite.deleteOne({ _id: req.params.id, owner: req.uid, usedBy: null });
    if (!r.deletedCount) return fail(res, 'Không tìm thấy mã (hoặc mã đã được dùng).', null, 404);
    res.json({ ok: true });
  }));

  /* ----- Mời bạn qua email (port từ UCenter Home cp_invite) ----- */
  router.post('/invites/email', rate(10, 'Bạn gửi lời mời quá nhanh, vui lòng thử lại sau.'), need('invite'), wrap(async (req, res) => {
    const email = S(req.body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 'Email không hợp lệ.');
    if ((await Invite.countDocuments({ owner: req.uid, usedBy: null })) >= MAX_UNUSED_INVITES)
      return fail(res, `Bạn đang có ${MAX_UNUSED_INVITES} mã chưa dùng. Hãy dùng hoặc xóa bớt rồi tạo thêm.`);
    if (await User.exists({ email })) return fail(res, 'Email này đã có tài khoản.');
    const inv = await Invite.create({ owner: req.uid, code: crypto.randomBytes(6).toString('hex') });
    const me = await User.findById(req.uid).select('name').lean();
    try { await require('./mail').sendInviteMail(email, me.name, inv.code); }
    catch (e) { console.error('Invite mail:', e.message); return fail(res, 'Không gửi được email mời. Vui lòng thử lại sau.', null, 502); }
    res.status(201).json({ invite: inviteView(inv, null) });
  }));

  /* ----- Ẩn bài của người cụ thể khỏi bảng tin (mở rộng groupignore của UCHome) ----- */
  router.put('/me/feed-hidden', wrap(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(isValidObjectId).map(String)
      .filter((x) => x !== String(req.uid)).slice(0, 200);
    await User.findByIdAndUpdate(req.uid, { feedHidden: ids });
    res.json({ feedHidden: ids });
  }));
  router.get('/me/feed-hidden', wrap(async (req, res) => {
    const u = await User.findById(req.uid).select('feedHidden').populate('feedHidden', 'name avatar').lean();
    res.json({ feedHidden: (u.feedHidden || []).filter(Boolean).map((x) => ({ id: String(x._id), name: x.name, avatar: x.avatar || '' })) });
  }));

  /* Tùy chọn hoạt động nào của mình hiện lên bảng tin bạn bè (port privacy feed của UCHome) */
  const FEED_TYPES = ['post', 'doing', 'share'];
  const FEED_LABELS = { post: 'Bài viết', doing: 'Trạng thái', share: 'Chia sẻ' };
  router.get('/me/feed-prefs', wrap(async (req, res) => {
    const u = await User.findById(req.uid).select('feedPrefs').lean();
    const prefs = {};
    FEED_TYPES.forEach((t) => { prefs[t] = !(u.feedPrefs && u.feedPrefs.get(t) === false); });
    res.json({ prefs, labels: FEED_LABELS });
  }));
  router.put('/me/feed-prefs', wrap(async (req, res) => {
    const body = req.body && req.body.prefs ? req.body.prefs : {};
    const set = {};
    FEED_TYPES.forEach((t) => { if (body[t] !== undefined) set['feedPrefs.' + t] = !!body[t]; });
    if (!Object.keys(set).length) return fail(res, 'Không có gì để cập nhật.');
    await User.updateOne({ _id: req.uid }, { $set: set });
    res.json({ ok: true });
  }));

  /* Quyền xem từng phần hồ sơ (port cp_privacy của UCHome) */
  const { PRIV_SECTIONS, PRIV_LABELS, privGet } = require('./vis');
  const PRIV_VALUES = ['public', 'friends', 'private'];
  const PRIV_VLABELS = { public: 'Mọi người', friends: 'Bạn bè', private: 'Chỉ mình tôi' };
  router.get('/me/privacy', wrap(async (req, res) => {
    const u = await User.findById(req.uid).select('privacy').lean();
    const privacy = {};
    PRIV_SECTIONS.forEach((s) => { privacy[s] = privGet(u, s); });
    res.json({ privacy, sections: PRIV_LABELS, values: PRIV_VLABELS });
  }));
  router.put('/me/privacy', wrap(async (req, res) => {
    const body = req.body && req.body.privacy ? req.body.privacy : {};
    const set = {};
    PRIV_SECTIONS.forEach((s) => { if (PRIV_VALUES.includes(body[s])) set['privacy.' + s] = body[s]; });
    if (!Object.keys(set).length) return fail(res, 'Không có gì để cập nhật.');
    await User.updateOne({ _id: req.uid }, { $set: set });
    res.json({ ok: true });
  }));
};

// Ghi nhận lượt xem trang (gọi từ GET /users/:id). Lỗi ghi nhận không được làm hỏng việc xem trang.
const recordVisit = (owner, visitor) => {
  if (String(owner) === String(visitor)) return;
  Visitor.updateOne({ owner, visitor }, { $set: { at: new Date() } }, { upsert: true }).catch((e) => console.error('Visitor:', e.message));
};

// Số khách mới kể từ lần mở danh sách gần nhất (hiện chấm trên tab). Dùng trong GET /friends.
const newVisitorCount = (me, seen) => Visitor.countDocuments({ owner: me, at: { $gt: seen || new Date(0) } });

module.exports = { mount, mountPublic, applyInvite, recordVisit, newVisitorCount, hiddenFriendIds, namesOf, CODE_RX };
