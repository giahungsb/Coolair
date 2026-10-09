/* Đạo cụ (magic của UCHome): cửa hàng, túi đồ, tặng bạn bè, sử dụng với hiệu ứng.
   UCHome có 23 loại; port 21 loại có ý nghĩa với CoolAir (bỏ doodle/egg là game vẽ không có tương đương). */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, MagicDef, UserMagic, MagicLog, Post, Notification } = require('./models');
const { friendIds } = require('./vis');
const { spend } = require('./credit');
// Chống spam đạo cụ (kết hợp race condition có thể nhân bản hiệu ứng / gửi notif hàng loạt)
const magicLimit = rateLimit({ store: rlStore('magic.magicLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác đạo cụ quá nhanh, vui lòng thử lại sau ít giây.' } });

const DAY = 864e5;
const MAGICS = [
  { mid: 'invisible', name: 'Ẩn thân', icon: '👻', charge: 100, dur: 1, desc: 'Ẩn trạng thái online của bạn trong 24 giờ.' },
  { mid: 'anonymous', name: 'Ẩn danh', icon: '🎭', charge: 80, uses: 5, desc: '5 lượt bình luận ẩn danh (bài viết, nhật ký, chia sẻ).' },
  { mid: 'reveal', name: 'Chiếu yêu', icon: '🔍', charge: 60, uses: 3, desc: '3 lượt xem danh tính người bình luận ẩn danh.' },
  { mid: 'thunder', name: 'Sấm truyền', icon: '⚡', charge: 150, uses: 1, desc: 'Gửi một thông báo đến tất cả bạn bè.' },
  { mid: 'gift', name: 'Lì xì', icon: '🧧', charge: 30, uses: 1, desc: 'Tặng điểm cho một người bạn (chọn số điểm khi dùng).' },
  { mid: 'coupon', name: 'Phiếu giảm giá', icon: '🎟️', charge: 40, dur: 7, desc: 'Giảm 30% cho lần mua đạo cụ tiếp theo (7 ngày).' },
  { mid: 'call', name: 'Gọi hồn', icon: '📣', charge: 50, uses: 1, desc: 'Gửi lời gọi đặc biệt, mời bạn ghé thăm trang của bạn.' },
  { mid: 'visit', name: 'Viếng thăm', icon: '👣', charge: 60, uses: 1, desc: 'Tự động ghé thăm trang của tất cả bạn bè.' },
  { mid: 'detector', name: 'Ra đa', icon: '📡', charge: 70, uses: 1, desc: 'Xem 20 khách ghé thăm gần nhất.' },
  { mid: 'updateline', name: 'Đào mộ', icon: '⛏️', charge: 90, uses: 1, desc: 'Đưa một bài viết của bạn lên đầu bảng tin bạn bè.' },
  { mid: 'downdateline', name: 'Lặn sâu', icon: '🌊', charge: 60, dur: 1, desc: 'Ẩn một bài viết khỏi bảng tin của bạn trong 24 giờ.' },
  { mid: 'friendnum', name: 'Rộng đường', icon: '🤝', charge: 120, dur: 3, desc: '+50% điểm thưởng mọi hoạt động trong 3 ngày.' },
  { mid: 'attachsize', name: 'Kho ảnh', icon: '🖼️', charge: 120, perm: true, desc: 'Vĩnh viễn +100 ảnh cho mỗi album (cộng dồn).' },
  { mid: 'hot', name: 'Đèn sân khấu', icon: '💡', charge: 150, uses: 1, desc: 'Đẩy một bài viết của bạn lên trang Khám phá.' },
  { mid: 'color', name: 'Tên màu', icon: '🌈', charge: 50, dur: 7, desc: 'Tên hiển thị 7 màu trong 7 ngày.' },
  { mid: 'icon', name: 'Huy hiệu', icon: '⭐', charge: 50, dur: 7, desc: 'Huy hiệu ⭐ trước tên trong 7 ngày.' },
  { mid: 'frame', name: 'Khung vàng', icon: '🖼️', charge: 80, dur: 7, desc: 'Viền vàng quanh avatar trong 7 ngày.' },
  { mid: 'bgimage', name: 'Nền hoa', icon: '🌸', charge: 80, dur: 7, desc: 'Ảnh nền trang cá nhân trong 7 ngày.' },
  { mid: 'flicker', name: 'Chữ nháy', icon: '✨', charge: 60, dur: 7, desc: 'Tên hiển thị nhấp nháy trong 7 ngày.' },
  { mid: 'superstar', name: 'Siêu sao', icon: '🌟', charge: 200, dur: 7, desc: 'Xuất hiện trong mục Nổi bật ở Khám phá 7 ngày.' },
  { mid: 'license', name: 'Giấy phép', icon: '📜', charge: 100, uses: 1, desc: 'Cho phép tặng đạo cụ cho bạn bè (tiêu hao khi tặng).' },
];
const byMid = Object.fromEntries(MAGICS.map((m) => [m.mid, m]));

// Khởi tạo định nghĩa đạo cụ trong DB (gọi lười)
const ensureDefs = async () => {
  const n = await MagicDef.countDocuments();
  if (n >= MAGICS.length) return;
  for (const m of MAGICS) await MagicDef.updateOne({ mid: m.mid }, { $set: m }, { upsert: true });
};

const myCount = async (uid, mid) => (await UserMagic.findOne({ user: uid, mid }).lean())?.count || 0;
const addMagic = async (uid, mid, n = 1) => {
  await UserMagic.updateOne({ user: uid, mid }, { $inc: { count: n } }, { upsert: true });
};
const takeMagic = async (uid, mid, n = 1) => {
  const r = await UserMagic.updateOne({ user: uid, mid, count: { $gte: n } }, { $inc: { count: -n } });
  return (r.modifiedCount || 0) > 0;
};
// Hiệu ứng đang có (còn hạn). Trả về object {mid: data}
const activeFx = (u) => {
  const out = {}, now = Date.now();
  if (u && u.magicFx) for (const [k, v] of u.magicFx) {
    if (v && v.exp && v.exp < now) continue;
    out[k] = v || {};
  }
  return out;
};

module.exports = (router, { auth, wrap, fail, S, N }) => {
  /* Cửa hàng đạo cụ */
  router.get('/magics', auth, wrap(async (req, res) => {
    await ensureDefs();
    const defs = await MagicDef.find({ enabled: { $ne: false } }).sort({ charge: 1 }).lean();
    const mine = await UserMagic.find({ user: req.uid }).lean();
    const cm = Object.fromEntries(mine.map((m) => [m.mid, m.count]));
    const me = await User.findById(req.uid).select('credit').lean();
    res.json({ magics: defs.map((d) => ({ mid: d.mid, name: d.name, desc: d.desc, charge: d.charge, icon: d.icon, mine: cm[d.mid] || 0 })), credit: me.credit || 0 });
  }));
  router.get('/magics/mine', auth, wrap(async (req, res) => {
    await ensureDefs();
    const mine = await UserMagic.find({ user: req.uid, count: { $gt: 0 } }).lean();
    const defs = await MagicDef.find({ mid: { $in: mine.map((m) => m.mid) } }).lean();
    const dm = Object.fromEntries(defs.map((d) => [d.mid, d]));
    res.json({ items: mine.map((m) => ({ mid: m.mid, name: dm[m.mid]?.name || m.mid, desc: dm[m.mid]?.desc || '', icon: dm[m.mid]?.icon || '🪄', count: m.count })) });
  }));
  router.get('/magics/log', auth, wrap(async (req, res) => {
    const rows = await MagicLog.find({ user: req.uid }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ logs: rows.map((l) => ({ mid: l.mid, action: l.action, target: l.target, detail: l.detail, at: l.createdAt })) });
  }));

  /* Mua đạo cụ (coupon giảm 30% nếu còn hiệu lực) */
  router.post('/magics/:mid/buy', auth, magicLimit, wrap(async (req, res) => {
    await ensureDefs();
    const def = byMid[S(req.params.mid)];
    if (!def) return fail(res, 'Đạo cụ không tồn tại.', null, 404);
    const n = Math.min(Math.max(parseInt(req.body.n, 10) || 1, 1), 99);
    const me = await User.findById(req.uid).select('credit magicFx');
    const fx = activeFx(me);
    let charge = def.charge * n;
    let usedCoupon = false;
    if (fx.coupon && def.mid !== 'coupon') { charge = Math.ceil(charge * 0.7); usedCoupon = true; }
    if (!await spend(req.uid, charge, 'mua đạo cụ ' + def.name + ' x' + n)) return fail(res, 'Bạn không đủ điểm.', null, 402);
    if (usedCoupon) await User.updateOne({ _id: req.uid }, { $unset: { 'magicFx.coupon': 1 } });
    await addMagic(req.uid, def.mid, n);
    await MagicLog.create({ user: req.uid, mid: def.mid, action: 'buy', detail: `mua x${n}, -${charge} điểm` });
    res.json({ ok: true, charge });
  }));

  /* Tặng đạo cụ cho bạn bè (cần giấy phép) */
  router.post('/magics/:mid/gift', auth, magicLimit, wrap(async (req, res) => {
    const def = byMid[S(req.params.mid)];
    if (!def) return fail(res, 'Đạo cụ không tồn tại.', null, 404);
    if (def.mid === 'license') return fail(res, 'Giấy phép không thể tặng.');
    const target = await User.findById(req.body.userId).select('name');
    if (!target) return fail(res, 'Không tìm thấy người nhận.', null, 404);
    const ids = await friendIds(req.uid);
    if (!ids.some((x) => String(x) === String(target._id))) return fail(res, 'Chỉ tặng được cho bạn bè.');
    if (!await takeMagic(req.uid, 'license')) return fail(res, 'Bạn cần Giấy phép để tặng đạo cụ.');
    if (!await takeMagic(req.uid, def.mid)) { await addMagic(req.uid, 'license', 1); return fail(res, 'Bạn không còn đạo cụ này.'); }
    await addMagic(target._id, def.mid, 1);
    await MagicLog.create({ user: req.uid, mid: def.mid, action: 'gift', target: target.name, detail: 'tặng cho ' + target.name });
    await MagicLog.create({ user: target._id, mid: def.mid, action: 'recv', target: '', detail: 'được tặng' });
    await N.add('magic_gift', def.mid, String(target._id), req.uid, def.name);
    res.json({ ok: true });
  }));

  /* Sử dụng đạo cụ */
  router.post('/magics/:mid/use', auth, magicLimit, wrap(async (req, res) => {
    const def = byMid[S(req.params.mid)];
    if (!def) return fail(res, 'Đạo cụ không tồn tại.', null, 404);
    if (!await takeMagic(req.uid, def.mid)) return fail(res, 'Bạn không còn đạo cụ này.');
    const done = async (detail = '') => {
      await MagicLog.create({ user: req.uid, mid: def.mid, action: 'use', target: S(req.body.target).slice(0, 60), detail });
      res.json({ ok: true, detail });
    };
    const refund = async () => { await addMagic(req.uid, def.mid, 1); };
    const me = await User.findById(req.uid);
    try {
      switch (def.mid) {
        case 'invisible': case 'color': case 'icon': case 'frame': case 'bgimage': case 'flicker': case 'superstar': {
          await User.updateOne({ _id: req.uid }, { $set: { [`magicFx.${def.mid}`]: { exp: Date.now() + def.dur * DAY } } });
          return done('hiệu lực ' + def.dur + ' ngày');
        }
        case 'coupon': {
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.coupon': { exp: Date.now() + 7 * DAY } } });
          return done('giảm 30% lần mua tiếp theo');
        }
        case 'friendnum': {
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.friendnum': { exp: Date.now() + 3 * DAY } } });
          return done('+50% điểm thưởng 3 ngày');
        }
        case 'attachsize': {
          const cur = (me.magicFx && me.magicFx.get('attachsize')?.extra) || 0;
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.attachsize': { extra: cur + 100 } } });
          return done('+' + (cur + 100) + ' ảnh mỗi album');
        }
        case 'anonymous': {
          const cur = (me.magicFx && me.magicFx.get('anonymous')?.count) || 0;
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.anonymous': { count: cur + 5 } } });
          return done('còn ' + (cur + 5) + ' lượt ẩn danh');
        }
        case 'reveal': {
          const cur = (me.magicFx && me.magicFx.get('reveal')?.count) || 0;
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.reveal': { count: cur + 3 } } });
          return done('còn ' + (cur + 3) + ' lượt chiếu yêu');
        }
        case 'thunder': {
          const text = S(req.body.text).trim().slice(0, 200) || (await User.findById(req.uid).select('name').lean()).name + ' gửi lời chào đến mọi người!';
          const ids = await friendIds(req.uid);
          await Promise.all(ids.map((id) => N.add('magic_thunder', 'thunder', String(id), req.uid, text.slice(0, 60))));
          return done('đã gửi đến ' + ids.length + ' bạn bè');
        }
        case 'gift': {
          const target = await User.findById(req.body.target).select('name');
          if (!target) { await refund(); return fail(res, 'Không tìm thấy người nhận.', null, 404); }
          const amount = Math.min(Math.max(parseInt(req.body.amount, 10) || 10, 1), 500);
          if (!await spend(req.uid, amount, 'lì xì cho ' + target.name)) { await refund(); return fail(res, 'Bạn không đủ điểm để lì xì.', null, 402); }
          await User.updateOne({ _id: target._id }, { $inc: { credit: amount } });
          const { CreditLog } = require('./models');
          await CreditLog.create({ user: target._id, action: 'gift_recv', credit: amount, exp: 0, note: 'lì xì' });
          await N.add('magic_gift_credit', 'gift', String(target._id), req.uid, amount + ' điểm');
          return done('đã tặng ' + amount + ' điểm cho ' + target.name);
        }
        case 'call': {
          const target = await User.findById(req.body.target).select('name');
          if (!target) { await refund(); return fail(res, 'Không tìm thấy người nhận.', null, 404); }
          await N.add('magic_call', 'call', String(target._id), req.uid, S(req.body.text).trim().slice(0, 60) || 'hãy ghé thăm trang của mình nhé!');
          return done('đã gọi ' + target.name);
        }
        case 'visit': {
          const ids = await friendIds(req.uid);
          const { Visitor } = require('./models');
          await Promise.all(ids.slice(0, 500).map((id) =>
            Visitor.updateOne({ owner: id, visitor: req.uid }, { $set: { at: new Date() } }, { upsert: true }).catch(() => {})));
          return done('đã ghé thăm ' + Math.min(ids.length, 500) + ' bạn bè');
        }
        case 'detector': {
          const { Visitor } = require('./models');
          const rows = await Visitor.find({ owner: req.uid }).sort({ at: -1 }).limit(20).populate('visitor', 'name avatar').lean();
          return done('xem bên dưới');
        }
        case 'updateline': {
          const p = await Post.findOne({ _id: req.body.target, author: req.uid });
          if (!p) { await refund(); return fail(res, 'Không tìm thấy bài viết của bạn.', null, 404); }
          p.createdAt = new Date(); await p.save();
          return done('bài viết đã lên đầu bảng tin');
        }
        case 'downdateline': {
          const cur = (me.magicFx && me.magicFx.get('downdateline')?.ids) || [];
          cur.push(String(req.body.target));
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.downdateline': { exp: Date.now() + DAY, ids: cur.slice(-50) } } });
          return done('đã ẩn bài viết khỏi bảng tin của bạn 24h');
        }
        case 'hot': {
          const p = await Post.findOne({ _id: req.body.target, author: req.uid });
          if (!p) { await refund(); return fail(res, 'Không tìm thấy bài viết của bạn.', null, 404); }
          await User.updateOne({ _id: req.uid }, { $set: { 'magicFx.hotpost': { exp: Date.now() + 7 * DAY, post: String(p._id) } } });
          return done('bài viết sẽ hiện ở Khám phá 7 ngày');
        }
        default: await refund(); return fail(res, 'Đạo cụ chưa hỗ trợ.');
      }
    } catch (e) { await refund(); throw e; }
  }));

  /* Xem khách ghé thăm (dùng với Ra đa / mặc định) */
  router.get('/magics/visitors', auth, wrap(async (req, res) => {
    const { Visitor } = require('./models');
    const rows = await Visitor.find({ owner: req.uid }).sort({ at: -1 }).limit(20).populate('visitor', 'name avatar').lean();
    res.json({ visitors: rows.filter((v) => v.visitor).map((v) => ({ id: String(v.visitor._id), name: v.visitor.name, avatar: v.visitor.avatar || '', at: v.at })) });
  }));

  /* Chiếu yêu: xem danh tính người bình luận ẩn danh (tiêu hao 1 lượt) */
  router.post('/magics/reveal/check', auth, magicLimit, wrap(async (req, res) => {
    const me = await User.findById(req.uid).select('magicFx');
    const fx = me && me.magicFx && me.magicFx.get('reveal');
    if (!fx || (fx.count || 0) <= 0) return fail(res, 'Bạn không còn lượt Chiếu yêu.');
    const p = isValidObjectId(S(req.body.postId)) ? await Post.findById(req.body.postId).populate('comments.user', 'name') : null;
    if (!p) return fail(res, 'Không tìm thấy bài viết.', null, 404);
    const c = (p.comments || []).find((x) => String(x._id) === S(req.body.commentId) && x.anon);
    if (!c) return fail(res, 'Bình luận này không ẩn danh.');
    // Trừ lượt NGUYÊN TỬ: điều kiện count > 0 trong cùng update -> không race về âm
    const dec = await User.updateOne({ _id: req.uid, 'magicFx.reveal.count': { $gt: 0 } }, { $inc: { 'magicFx.reveal.count': -1 } });
    if (!dec.modifiedCount) return fail(res, 'Bạn không còn lượt Chiếu yêu.');
    res.json({ name: (c.user && c.user.name) || 'Không rõ' });
  }));
};

module.exports.MAGICS = MAGICS;
module.exports.activeFx = activeFx;
module.exports.ensureDefs = ensureDefs;
