/* Lưu bút */
const { User, Guestbook, Friendship, N, GIFTS, S, wrap, fail, auth } = require('./shared');

module.exports = (router) => {
/* ---------- Lưu bút ---------- */
router.get('/guestbook/:id', auth, wrap(async (req, res) => {
  const { canViewSection } = require('../vis');
  const owner = await User.findById(req.params.id).select('privacy').lean();
  if (owner && req.params.id !== req.uid) {
    const rel = await Friendship.exists({ status: 'accepted', $or: [{ from: req.uid, to: req.params.id }, { from: req.params.id, to: req.uid }] }) ? 'friends' : 'none';
    if (!canViewSection(owner, 'guestbook', rel)) return fail(res, 'Chủ trang đã ẩn lưu bút với bạn.', null, 403);
  }
  const list = await Guestbook.find({ owner: req.params.id }).sort({ createdAt: -1 }).limit(50);
  const av = Object.fromEntries((await User.find({ _id: { $in: list.map((g) => g.from).filter(Boolean) } }).select('avatar')).map((x) => [x.id, x.avatar || '']));
  res.json(list.map((g) => ({ name: g.fromName, gift: g.gift, text: g.text, av: av[String(g.from)] || '' })));
}));

router.post('/guestbook/:id', auth, wrap(async (req, res) => {
  const text = S(req.body.text).trim(), gift = GIFTS.includes(req.body.gift) ? req.body.gift : '🎁';
  if (!text || text.length > 500) return fail(res, 'Lời nhắn cần 1–500 ký tự.');
  const [owner, u] = await Promise.all([User.exists({ _id: req.params.id }), User.findById(req.uid)]);
  if (!owner || !u) return fail(res, 'Không tìm thấy người dùng.', null, 404);
  if (await require('../vis').blockedBetween(req.uid, req.params.id)) return fail(res, 'Bạn không thể viết lưu bút cho người này.', null, 403);
  const g = await Guestbook.create({ owner: req.params.id, from: u.id, fromName: u.name, gift, text });
  await N.add('wall', g.id, req.params.id, req.uid);
  res.status(201).json({ name: g.fromName, gift: g.gift, text: g.text, av: u.avatar || '' });
}));
};
