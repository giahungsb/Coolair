/* Khám phá – trang nội dung công khai của cộng đồng (port ý tưởng từ UCenter Home network.php):
   xem bài viết / nhật ký / trạng thái công khai mới nhất từ những người không phải bạn bè. */
const { User, Post, Blog, Doing } = require('./models');
const { friendIds, blockedIds } = require('./vis');

const PER = 15;
module.exports = (router, { auth, wrap, fail, S }) => {
  const who = (u) => (u ? { id: String(u._id), name: u.name, avatar: u.avatar || '' } : null);

  router.get('/discover', auth, wrap(async (req, res) => {
    const me = req.uid;
    const type = ['posts', 'blogs', 'doings'].includes(S(req.query.type)) ? S(req.query.type) : 'posts';
    const page = Math.max(1, Math.min(20, parseInt(req.query.page, 10) || 1));
    const ids = await friendIds(me), blk = await blockedIds(me);
    const exclude = [me, ...ids, ...blk].map(String);
    let items = [], total = 0;
    if (type === 'posts') {
      const q = { visibility: 'public', author: { $nin: exclude } };
      [total, items] = await Promise.all([Post.countDocuments(q),
        Post.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar').lean()]);
      items = items.filter((p) => p.author).map((p) => ({ id: p._id, kind: 'post', text: String(p.text || '').slice(0, 200),
        photos: (p.photos || []).slice(0, 1), author: who(p.author), createdAt: p.createdAt }));
    } else if (type === 'blogs') {
      const q = { visibility: 'public', owner: { $nin: exclude } };
      [total, items] = await Promise.all([Blog.countDocuments(q),
        Blog.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar').lean()]);
      items = items.filter((b) => b.owner).map((b) => ({ id: b._id, kind: 'blog', title: b.title,
        excerpt: String(b.text || '').replace(/\s+/g, ' ').slice(0, 160), tags: b.tags || [], author: who(b.owner), createdAt: b.createdAt }));
    } else {
      const q = { visibility: 'public', author: { $nin: exclude } };
      [total, items] = await Promise.all([Doing.countDocuments(q),
        Doing.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar').lean()]);
      items = items.filter((d) => d.author).map((d) => ({ id: d._id, kind: 'doing', text: d.text, mood: d.mood || '', author: who(d.author), createdAt: d.createdAt }));
    }
    // Đạo cụ Siêu sao: thành viên đang có hiệu lực; Đèn sân khấu: bài viết được đẩy
    let featured = [], boosted = [];
    if (type === 'posts' && page === 1) {
      const now = new Date();
      const stars = await User.find({ 'magicFx.superstar.exp': { $gt: now } }).select('name avatar').limit(8).lean();
      featured = stars.map((u) => ({ id: String(u._id), name: u.name, avatar: u.avatar || '' }));
      const boosts = await User.find({ 'magicFx.hotpost.exp': { $gt: now } }).select('magicFx').lean();
      const pids = boosts.map((u) => u.magicFx.get('hotpost')?.post).filter(Boolean);
      if (pids.length) {
        const bps = await Post.find({ _id: { $in: pids }, visibility: 'public', author: { $nin: exclude } }).populate('author', 'name avatar').lean();
        boosted = bps.filter((p) => p.author).map((p) => ({ id: p._id, kind: 'post', text: String(p.text || '').slice(0, 200),
          photos: (p.photos || []).slice(0, 1), author: who(p.author), createdAt: p.createdAt, boosted: true }));
      }
    }
    res.json({ type, page, per: PER, total, items, featured, boosted });
  }));

  /* Bảng xếp hạng thành viên (space_top của UCHome): theo điểm, kinh nghiệm, bạn bè */
  router.get('/discover/top', auth, wrap(async (req, res) => {
    const by = ['credit', 'experience', 'friends'].includes(S(req.query.by)) ? S(req.query.by) : 'credit';
    const blk = new Set((await blockedIds(req.uid)).map(String));
    let users;
    if (by === 'friends') {
      const agg = await User.aggregate([
        { $match: { banned: { $ne: true } } },
        { $project: { name: 1, avatar: 1 } }, { $limit: 200 },
      ]);
      const { Friendship } = require('./models');
      const counts = await Friendship.aggregate([{ $match: { status: 'accepted' } },
        { $group: { _id: null, docs: { $push: ['$$ROOT.from', '$$ROOT.to'] } } }]);
      const map = new Map();
      if (counts[0]) counts[0].docs.flat().forEach((id) => map.set(String(id), (map.get(String(id)) || 0) + 1));
      users = agg.map((u) => ({ id: String(u._id), name: u.name, avatar: u.avatar || '', score: map.get(String(u._id)) || 0 }))
        .filter((u) => u.id !== req.uid && !blk.has(u.id)).sort((a, b) => b.score - a.score).slice(0, 20);
    } else {
      users = (await User.find({ banned: { $ne: true } }).select('name avatar credit experience').sort({ [by]: -1 }).limit(30).lean())
        .filter((u) => String(u._id) !== req.uid && !blk.has(String(u._id))).slice(0, 20)
        .map((u) => ({ id: String(u._id), name: u.name, avatar: u.avatar || '', score: u[by] || 0 }));
    }
    res.json({ by, users });
  }));
};
