/* Các module nhỏ port từ phpFox 3.0: quà tặng ảo (egift), thông báo chung (announcement), bản tin (bulletin),
   newsletter, yêu thích (favorite), đánh giá sao (rate), liên hệ (contact), trợ giúp (help/faq),
   shoutbox, liên kết (link), và hộp thư đầy đủ (mail: inbox/sent/trash). */
const { isValidObjectId, Types } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, GiftCat, Gift, UserGift, Announcement, Bulletin, Newsletter, Favorite, Rating,
  ContactMsg, Faq, Shout, LinkCat, Link, Message, Notification } = require('./models');
const { filter: censorFilter } = require('./censor');
const { sendRaw } = require('./mail');

const PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_extra.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });
const guestLimit = rateLimit({ store: rlStore('pf_extra.guestLimit'), windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn gửi quá nhiều, vui lòng thử lại sau.' } });

module.exports = (router, { auth, wrap, fail, S, N, isAdmin, alog }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email siteAdmin');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const who = (u) => (u ? { id: String(u._id), name: u.name, avatar: u.avatar || '' } : null);

  /* ================= QUÀ TẶNG ẢO (egift) ================= */
  router.get('/gifts', auth, wrap(async (req, res) => {
    const cats = await GiftCat.find({}).sort({ displayorder: 1 }).lean();
    const gifts = await Gift.find({ enabled: true }).sort({ name: 1 }).lean();
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name,
      gifts: gifts.filter((g) => String(g.cat) === String(c._id)).map((g) => ({ id: String(g._id), name: g.name, icon: g.icon, desc: g.desc || '' })) })) });
  }));
  router.post('/gifts/:id/send', auth, talkLimit, wrap(async (req, res) => {
    const g = oid(req.params.id) && await Gift.findOne({ _id: req.params.id, enabled: true });
    if (!g) return bad(res, 'Không tìm thấy quà tặng.');
    const to = oid(req.body.to);
    if (!to || !(await User.exists({ _id: to }))) return fail(res, 'Người nhận không hợp lệ.');
    if (to === req.uid) return fail(res, 'Không thể tự tặng quà cho mình.');
    const { blockedBetween } = require('./vis');
    if (await blockedBetween(req.uid, to)) return fail(res, 'Bạn không thể tặng quà cho người này.', null, 403);
    const ug = await UserGift.create({ gift: g._id, from: req.uid, to, message: S(req.body.message).trim().slice(0, 200) });
    await N.add('gift_recv', String(ug._id), to, req.uid);
    res.status(201).json({ ok: true });
  }));
  router.get('/gifts/received', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, rows] = await Promise.all([
      UserGift.countDocuments({ to: req.uid }),
      UserGift.find({ to: req.uid }).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('gift', 'name icon').populate('from', 'name avatar').lean(),
    ]);
    res.json({ total, page, per: PER, gifts: rows.filter((r) => r.gift && r.from).map((r) => ({
      id: String(r._id), gift: { name: r.gift.name, icon: r.gift.icon }, from: who(r.from), message: r.message || '', createdAt: r.createdAt })) });
  }));
  router.get('/gifts/sent', auth, wrap(async (req, res) => {
    const rows = await UserGift.find({ from: req.uid }).sort({ createdAt: -1 }).limit(PER).populate('gift', 'name icon').populate('to', 'name avatar').lean();
    res.json({ gifts: rows.filter((r) => r.gift && r.to).map((r) => ({
      id: String(r._id), gift: { name: r.gift.name, icon: r.gift.icon }, to: who(r.to), message: r.message || '', createdAt: r.createdAt })) });
  }));
  router.delete('/gifts/received/:id', auth, wrap(async (req, res) => {
    const ug = oid(req.params.id) && await UserGift.findOneAndDelete({ _id: req.params.id, to: req.uid });
    if (!ug) return bad(res, 'Không tìm thấy quà tặng.');
    await Notification.deleteMany({ item: String(ug._id) });
    res.json({ ok: true });
  }));
  // Admin: chuyên mục + catalog quà
  router.get('/admin/gift-cats', auth, adminOnly, wrap(async (req, res) => {
    const cs = await GiftCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name, displayorder: c.displayorder || 0 })) });
  }));
  router.post('/admin/gift-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 50) return fail(res, 'Tên chuyên mục cần 1–50 ký tự.');
    const c = await GiftCat.create({ name, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'giftcat_add', name); res.status(201).json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.delete('/admin/gift-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await GiftCat.findById(req.params.id);
    if (!c) return bad(res);
    await Promise.all([Gift.updateMany({ cat: c._id }, { $unset: { cat: 1 } }), c.deleteOne()]);
    alog(req.uid, 'giftcat_del', c.name); res.json({ ok: true });
  }));
  router.get('/admin/gifts', auth, adminOnly, wrap(async (req, res) => {
    const gs = await Gift.find({}).populate('cat', 'name').sort({ name: 1 }).lean();
    res.json({ gifts: gs.map((g) => ({ id: String(g._id), name: g.name, icon: g.icon, desc: g.desc || '', cat: g.cat ? g.cat.name : '', enabled: !!g.enabled })) });
  }));
  router.post('/admin/gifts', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 60) return fail(res, 'Tên quà cần 1–60 ký tự.');
    const cat = oid(req.body.cat);
    const g = await Gift.create({ name, cat: cat || undefined, icon: S(req.body.icon).trim().slice(0, 20) || '🎁',
      desc: S(req.body.desc).trim().slice(0, 200), enabled: req.body.enabled !== false });
    alog(req.uid, 'gift_add', name); res.status(201).json({ gift: { id: String(g._id), name: g.name } });
  }));
  router.patch('/admin/gifts/:id', auth, adminOnly, wrap(async (req, res) => {
    const g = oid(req.params.id) && await Gift.findById(req.params.id);
    if (!g) return bad(res);
    const name = S(req.body.name).trim();
    if (name) { if (name.length > 60) return fail(res, 'Tên tối đa 60 ký tự.'); g.name = name; }
    if (req.body.icon !== undefined) g.icon = S(req.body.icon).trim().slice(0, 20) || '🎁';
    if (req.body.desc !== undefined) g.desc = S(req.body.desc).trim().slice(0, 200);
    if (req.body.enabled !== undefined) g.enabled = req.body.enabled === true;
    if (req.body.cat !== undefined) g.cat = oid(req.body.cat) || undefined;
    await g.save(); alog(req.uid, 'gift_edit', g.name); res.json({ ok: true });
  }));
  router.delete('/admin/gifts/:id', auth, adminOnly, wrap(async (req, res) => {
    const g = oid(req.params.id) && await Gift.findById(req.params.id);
    if (!g) return bad(res);
    await Promise.all([UserGift.deleteMany({ gift: g._id }), g.deleteOne()]);
    alog(req.uid, 'gift_del', g.name); res.json({ ok: true });
  }));

  /* ================= THÔNG BÁO CHUNG (announcement) ================= */
  router.get('/announcements', auth, wrap(async (req, res) => {
    const now = new Date();
    const rows = await Announcement.find({ active: true,
      $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }] })
      .sort({ createdAt: -1 }).limit(5).lean();
    res.json({ announcements: rows.map((a) => ({ id: String(a._id), title: a.title, text: a.text, createdAt: a.createdAt })) });
  }));
  router.get('/admin/announcements', auth, adminOnly, wrap(async (req, res) => {
    const rows = await Announcement.find({}).sort({ createdAt: -1 }).lean();
    res.json({ announcements: rows.map((a) => ({ id: String(a._id), title: a.title, active: !!a.active, createdAt: a.createdAt })) });
  }));
  router.post('/admin/announcements', auth, adminOnly, wrap(async (req, res) => {
    const title = S(req.body.title).trim(), text = S(req.body.text).trim();
    if (!title || title.length > 120) return fail(res, 'Tiêu đề cần 1–120 ký tự.');
    if (!text || text.length > 2000) return fail(res, 'Nội dung cần 1–2000 ký tự.');
    const a = await Announcement.create({ title, text, active: req.body.active !== false });
    alog(req.uid, 'announce_add', title); res.status(201).json({ announcement: { id: String(a._id), title: a.title } });
  }));
  router.patch('/admin/announcements/:id', auth, adminOnly, wrap(async (req, res) => {
    const a = oid(req.params.id) && await Announcement.findById(req.params.id);
    if (!a) return bad(res);
    const title = S(req.body.title).trim(), text = S(req.body.text).trim();
    if (title) { if (title.length > 120) return fail(res, 'Tiêu đề tối đa 120 ký tự.'); a.title = title; }
    if (text) { if (text.length > 2000) return fail(res, 'Nội dung tối đa 2000 ký tự.'); a.text = text; }
    if (req.body.active !== undefined) a.active = req.body.active === true;
    await a.save(); alog(req.uid, 'announce_edit', a.title); res.json({ ok: true });
  }));
  router.delete('/admin/announcements/:id', auth, adminOnly, wrap(async (req, res) => {
    const a = oid(req.params.id) && await Announcement.findByIdAndDelete(req.params.id);
    if (!a) return bad(res);
    alog(req.uid, 'announce_del', a.title); res.json({ ok: true });
  }));

  /* ================= BẢN TIN (bulletin) ================= */
  router.get('/bulletins', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = oid(req.query.author) ? { author: req.query.author } : {};
    const [total, rows] = await Promise.all([
      Bulletin.countDocuments(q),
      Bulletin.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('author', 'name avatar').lean(),
    ]);
    res.json({ total, page, per: PER, bulletins: rows.filter((b) => b.author).map((b) => ({
      id: String(b._id), subject: b.subject, views: b.views || 0, createdAt: b.createdAt, author: who(b.author) })) });
  }));
  router.post('/bulletins', auth, talkLimit, wrap(async (req, res) => {
    const subject = S(req.body.subject).trim(), text = S(req.body.text).trim();
    if (!subject || subject.length > 120) return fail(res, 'Tiêu đề cần 1–120 ký tự.');
    if (!text || text.length > 5000) return fail(res, 'Nội dung cần 1–5000 ký tự.');
    const b = await Bulletin.create({ author: req.uid, subject: await censorFilter(subject), text: await censorFilter(text) });
    res.status(201).json({ bulletin: { id: String(b._id), subject: b.subject } });
  }));
  router.get('/bulletins/:id', auth, wrap(async (req, res) => {
    const b = oid(req.params.id) && await Bulletin.findById(req.params.id).populate('author', 'name avatar');
    if (!b || !b.author) return bad(res, 'Không tìm thấy bản tin.');
    b.views = (b.views || 0) + 1; await b.save();
    res.json({ bulletin: { id: String(b._id), subject: b.subject, text: b.text, views: b.views, createdAt: b.createdAt,
      author: who(b.author), mine: String(b.author._id) === req.uid } });
  }));
  router.delete('/bulletins/:id', auth, wrap(async (req, res) => {
    const b = oid(req.params.id) && await Bulletin.findById(req.params.id).select('_id author');
    if (!b) return bad(res, 'Không tìm thấy bản tin.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(b.author) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa.', null, 403);
    await b.deleteOne(); res.json({ ok: true });
  }));

  /* ================= NEWSLETTER (admin gửi email hàng loạt) ================= */
  router.get('/admin/newsletters', auth, adminOnly, wrap(async (req, res) => {
    const rows = await Newsletter.find({}).sort({ createdAt: -1 }).lean();
    res.json({ newsletters: rows.map((n) => ({ id: String(n._id), subject: n.subject, sentAt: n.sentAt || null, sentNum: n.sentNum || 0, createdAt: n.createdAt })) });
  }));
  router.post('/admin/newsletters', auth, adminOnly, wrap(async (req, res) => {
    const subject = S(req.body.subject).trim(), text = S(req.body.text).trim();
    if (!subject || subject.length > 150) return fail(res, 'Tiêu đề cần 1–150 ký tự.');
    if (!text || text.length > 10000) return fail(res, 'Nội dung cần 1–10000 ký tự.');
    const n = await Newsletter.create({ subject, text });
    alog(req.uid, 'newsletter_add', subject); res.status(201).json({ newsletter: { id: String(n._id), subject: n.subject } });
  }));
  router.delete('/admin/newsletters/:id', auth, adminOnly, wrap(async (req, res) => {
    const n = oid(req.params.id) && await Newsletter.findByIdAndDelete(req.params.id);
    if (!n) return bad(res);
    alog(req.uid, 'newsletter_del', n.subject); res.json({ ok: true });
  }));
  router.post('/admin/newsletters/:id/send', auth, adminOnly, wrap(async (req, res) => {
    const n = oid(req.params.id) && await Newsletter.findById(req.params.id);
    if (!n) return bad(res, 'Không tìm thấy newsletter.');
    if (n.sentAt) return fail(res, 'Newsletter này đã được gửi.', null, 409);
    const users = await User.find({ verified: { $ne: false }, banned: { $ne: true } }).select('email name').lean();
    let sent = 0;
    for (const u of users) {   // gửi tuần tự để không quá tải SMTP; mỗi lần gửi lỗi thì bỏ qua người đó
      try { await sendRaw(u.email, n.subject, n.text); sent++; }
      catch (e) { console.error('Newsletter:', u.email, e.message); }
    }
    n.sentAt = new Date(); n.sentNum = sent; await n.save();
    alog(req.uid, 'newsletter_send', n.subject + ' -> ' + sent + ' người');
    res.json({ ok: true, sent });
  }));

  /* ================= YÊU THÍCH (favorite) ================= */
  const FAV_KINDS = ['post', 'blog', 'photo', 'video', 'song', 'quiz', 'page', 'forum_thread', 'event', 'poll'];
  router.get('/favorites', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, rows] = await Promise.all([
      Favorite.countDocuments({ user: req.uid }),
      Favorite.find({ user: req.uid }).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).lean(),
    ]);
    res.json({ total, page, per: PER, favorites: rows.map((f) => ({ id: String(f._id), kind: f.kind, refId: f.refId, title: f.title || '', createdAt: f.createdAt })) });
  }));
  router.post('/favorites', auth, wrap(async (req, res) => {
    const kind = S(req.body.kind), refId = S(req.body.refId).trim();
    if (!FAV_KINDS.includes(kind) || !refId || refId.length > 40) return fail(res, 'Dữ liệu không hợp lệ.');
    let f;
    try { f = await Favorite.create({ user: req.uid, kind, refId, title: S(req.body.title).trim().slice(0, 150) }); }
    catch (e) { if (e.code !== 11000) throw e; f = await Favorite.findOne({ user: req.uid, kind, refId }).select('_id'); }   // đã lưu từ trước -> trả id hiện có
    res.status(201).json({ ok: true, favorite: { id: f ? String(f._id) : null } });
  }));
  router.get('/favorites/check', auth, wrap(async (req, res) => {
    const kind = S(req.query.kind), refId = S(req.query.refId).trim();
    const f = (FAV_KINDS.includes(kind) && refId) ? await Favorite.findOne({ user: req.uid, kind, refId }).select('_id').lean() : null;
    res.json({ saved: !!f, id: f ? String(f._id) : null });
  }));
  router.delete('/favorites/:id', auth, wrap(async (req, res) => {
    await Favorite.deleteOne({ _id: oid(req.params.id) || undefined, user: req.uid });
    res.json({ ok: true });
  }));

  /* ================= ĐÁNH GIÁ SAO (rate) ================= */
  const rateSummary = async (kind, refId, uid) => {
    const [agg, mine] = await Promise.all([
      Rating.aggregate([{ $match: { kind, refId } }, { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } }]),
      Rating.findOne({ user: uid, kind, refId }).select('stars').lean(),
    ]);
    return { avg: agg.length ? Math.round(agg[0].avg * 10) / 10 : 0, count: agg.length ? agg[0].count : 0, my: mine ? mine.stars : 0 };
  };
  router.post('/rate', auth, wrap(async (req, res) => {
    const kind = S(req.body.kind), refId = S(req.body.refId).trim();
    const stars = Math.floor(Number(req.body.stars));
    if (!FAV_KINDS.includes(kind) || !refId || refId.length > 40) return fail(res, 'Dữ liệu không hợp lệ.');
    if (!(stars >= 1 && stars <= 5)) return fail(res, 'Đánh giá 1–5 sao.');
    await Rating.findOneAndUpdate({ user: req.uid, kind, refId }, { $set: { stars } }, { upsert: true });
    res.json({ ok: true, ...(await rateSummary(kind, refId, req.uid)) });   // giao diện cập nhật ngay điểm trung bình + số lượt, không cần tải lại
  }));
  router.get('/rate/:kind/:refId', auth, wrap(async (req, res) => {
    const kind = S(req.params.kind), refId = S(req.params.refId).trim();
    if (!FAV_KINDS.includes(kind) || !refId) return fail(res, 'Dữ liệu không hợp lệ.');
    res.json(await rateSummary(kind, refId, req.uid));
  }));

  /* ================= LIÊN HỆ (contact) – mở cho khách vãng lai ================= */
  router.post('/contact', guestLimit, wrap(async (req, res) => {
    const name = S(req.body.name).trim(), email = S(req.body.email).trim().toLowerCase();
    const subject = S(req.body.subject).trim(), text = S(req.body.text).trim();
    if (!name || name.length > 60) return fail(res, 'Tên cần 1–60 ký tự.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 'Email chưa đúng định dạng.');
    if (!subject || subject.length > 150) return fail(res, 'Tiêu đề cần 1–150 ký tự.');
    if (!text || text.length > 3000) return fail(res, 'Nội dung cần 1–3000 ký tự.');
    await ContactMsg.create({ name, email, subject, text: await censorFilter(text) });
    res.status(201).json({ ok: true });
  }));
  router.get('/admin/contact', auth, adminOnly, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, rows] = await Promise.all([
      ContactMsg.countDocuments({}),
      ContactMsg.find({}).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).lean(),
    ]);
    res.json({ total, page, per: PER, items: rows.map((m) => ({ id: String(m._id), name: m.name, email: m.email, subject: m.subject, read: !!m.read, createdAt: m.createdAt })) });
  }));
  router.get('/admin/contact/:id', auth, adminOnly, wrap(async (req, res) => {
    const m = oid(req.params.id) && await ContactMsg.findById(req.params.id).lean();
    if (!m) return bad(res);
    await ContactMsg.updateOne({ _id: m._id }, { $set: { read: true } });
    res.json({ msg: { id: String(m._id), name: m.name, email: m.email, subject: m.subject, text: m.text, createdAt: m.createdAt } });
  }));
  router.delete('/admin/contact/:id', auth, adminOnly, wrap(async (req, res) => {
    const m = oid(req.params.id) && await ContactMsg.findByIdAndDelete(req.params.id);
    if (!m) return bad(res);
    res.json({ ok: true });
  }));

  /* ================= TRỢ GIÚP (help/faq) ================= */
  router.get('/faqs', auth, wrap(async (req, res) => {
    const rows = await Faq.find({}).sort({ displayorder: 1 }).lean();
    res.json({ faqs: rows.map((f) => ({ id: String(f._id), question: f.question, answer: f.answer })) });
  }));
  router.get('/admin/faqs', auth, adminOnly, wrap(async (req, res) => {
    const rows = await Faq.find({}).sort({ displayorder: 1 }).lean();
    res.json({ faqs: rows.map((f) => ({ id: String(f._id), question: f.question, displayorder: f.displayorder || 0 })) });
  }));
  router.post('/admin/faqs', auth, adminOnly, wrap(async (req, res) => {
    const question = S(req.body.question).trim(), answer = S(req.body.answer).trim();
    if (!question || question.length > 200) return fail(res, 'Câu hỏi cần 1–200 ký tự.');
    if (!answer || answer.length > 5000) return fail(res, 'Trả lời cần 1–5000 ký tự.');
    const f = await Faq.create({ question, answer, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'faq_add', question.slice(0, 60)); res.status(201).json({ faq: { id: String(f._id) } });
  }));
  router.patch('/admin/faqs/:id', auth, adminOnly, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Faq.findById(req.params.id);
    if (!f) return bad(res);
    const question = S(req.body.question).trim(), answer = S(req.body.answer).trim();
    if (question) { if (question.length > 200) return fail(res, 'Câu hỏi tối đa 200 ký tự.'); f.question = question; }
    if (answer) { if (answer.length > 5000) return fail(res, 'Trả lời tối đa 5000 ký tự.'); f.answer = answer; }
    if (req.body.displayorder !== undefined) f.displayorder = Number(req.body.displayorder) || 0;
    await f.save(); res.json({ ok: true });
  }));
  router.delete('/admin/faqs/:id', auth, adminOnly, wrap(async (req, res) => {
    const f = oid(req.params.id) && await Faq.findByIdAndDelete(req.params.id);
    if (!f) return bad(res);
    res.json({ ok: true });
  }));

  /* ================= SHOUTBOX ================= */
  const SHOUT_KEEP = 300;
  router.get('/shoutbox', auth, wrap(async (req, res) => {
    const rows = await Shout.find({}).sort({ createdAt: -1 }).limit(30).populate('user', 'name avatar').lean();
    res.json({ shouts: rows.filter((s) => s.user).reverse().map((s) => ({ id: String(s._id), text: s.text,
      user: who(s.user), mine: String(s.user._id) === req.uid, createdAt: s.createdAt })) });
  }));
  router.post('/shoutbox', auth, talkLimit, wrap(async (req, res) => {
    const text = S(req.body.text).trim();
    if (!text || text.length > 200) return fail(res, 'Tin nhắn cần 1–200 ký tự.');
    const s = await Shout.create({ user: req.uid, text: await censorFilter(text) });
    const n = await Shout.countDocuments({});
    if (n > SHOUT_KEEP) {   // chỉ giữ 300 tin mới nhất (như phpFox dọn shoutbox cũ)
      const cut = await Shout.find({}).sort({ createdAt: -1 }).skip(SHOUT_KEEP).select('_id').lean();
      if (cut.length) await Shout.deleteMany({ _id: { $in: cut.map((x) => x._id) } });
    }
    const u = await User.findById(req.uid).select('name avatar').lean();
    res.status(201).json({ shout: { id: String(s._id), text: s.text, user: who(u), mine: true, createdAt: s.createdAt } });
  }));
  router.delete('/shoutbox/:id', auth, wrap(async (req, res) => {
    const s = oid(req.params.id) && await Shout.findById(req.params.id).select('_id user');
    if (!s) return bad(res, 'Không tìm thấy tin nhắn.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(s.user) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa.', null, 403);
    await s.deleteOne(); res.json({ ok: true });
  }));

  /* ================= LIÊN KẾT (link) ================= */
  router.get('/link-cats', auth, wrap(async (req, res) => {
    const cs = await LinkCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name })) });
  }));
  router.get('/links', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = {}, qs = S(req.query.q).trim();
    if (oid(req.query.cat)) q.cat = req.query.cat;
    if (qs) q.$or = [{ title: new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { desc: new RegExp(qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const [total, rows] = await Promise.all([
      Link.countDocuments(q),
      Link.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('owner', 'name').populate('cat', 'name').lean(),
    ]);
    res.json({ total, page, per: PER, links: rows.map((l) => ({ id: String(l._id), title: l.title, url: l.url, desc: l.desc || '',
      clicks: l.clicks || 0, cat: l.cat ? l.cat.name : '', owner: l.owner ? l.owner.name : '', mine: l.owner && String(l.owner._id) === req.uid, createdAt: l.createdAt })) });
  }));
  router.post('/links', auth, talkLimit, wrap(async (req, res) => {
    const title = S(req.body.title).trim(), url = S(req.body.url).trim();
    if (!title || title.length > 120) return fail(res, 'Tên liên kết cần 1–120 ký tự.');
    if (!/^https?:\/\//.test(url) || url.length > 300) return fail(res, 'URL không hợp lệ.');
    const cat = oid(req.body.cat);
    const l = await Link.create({ owner: req.uid, title: await censorFilter(title), url, desc: await censorFilter(S(req.body.desc).trim().slice(0, 500)), cat: cat || undefined });
    res.status(201).json({ link: { id: String(l._id), title: l.title } });
  }));
  router.get('/links/:id/go', wrap(async (req, res) => {   // đếm click rồi chuyển hướng (như phpFox link/go); mở công khai để thẻ <a> trình duyệt dùng được
    const l = oid(req.params.id) && await Link.findById(req.params.id).select('url clicks title');
    if (!l) return bad(res, 'Không tìm thấy liên kết.');
    // Trang trung gian chống open-redirect/phishing: không nhảy thẳng sang site lạ từ domain CoolAir
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (req.query.go !== '1') {
      let back = '/';   // nút Quay lại: dùng Referer cùng host (không dùng javascript: vì CSP không cho script inline)
      try { const u = new URL(req.get('referer') || ''); if (u.host === req.get('host') && !u.pathname.startsWith('//')) back = u.pathname + u.search; } catch { /* không có Referer -> về trang chủ */ }
      return res.type('html').send(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rời khỏi CoolAir</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:8vh auto;padding:0 16px;color:#222}a.btn{display:inline-block;margin:8px 8px 0 0;padding:10px 18px;border-radius:8px;text-decoration:none}.go{background:#1877f2;color:#fff}.back{border:1px solid #ccc;color:#222}.url{word-break:break-all;background:#f4f4f4;padding:8px;border-radius:6px}</style></head><body><h2>Bạn sắp rời khỏi CoolAir</h2><p>Liên kết <b>${esc(l.title)}</b> dẫn tới địa chỉ ngoài:</p><p class="url">${esc(l.url)}</p><p>Hãy chắc chắn bạn tin tưởng địa chỉ này trước khi tiếp tục.</p><a class="btn go" href="/api/links/${l._id}/go?go=1" rel="noopener">Tiếp tục</a><a class="btn back" href="${esc(back)}">Quay lại</a></body></html>`);
    }
    l.clicks = (l.clicks || 0) + 1; await l.save();
    res.redirect(l.url);
  }));
  router.delete('/links/:id', auth, wrap(async (req, res) => {
    const l = oid(req.params.id) && await Link.findById(req.params.id).select('_id owner');
    if (!l) return bad(res, 'Không tìm thấy liên kết.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(l.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa.', null, 403);
    await l.deleteOne(); res.json({ ok: true });
  }));
  router.get('/admin/link-cats', auth, adminOnly, wrap(async (req, res) => {
    const cs = await LinkCat.find({}).sort({ displayorder: 1 }).lean();
    res.json({ cats: cs.map((c) => ({ id: String(c._id), name: c.name, displayorder: c.displayorder || 0 })) });
  }));
  router.post('/admin/link-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim();
    if (!name || name.length > 50) return fail(res, 'Tên chuyên mục cần 1–50 ký tự.');
    const c = await LinkCat.create({ name, displayorder: Number(req.body.displayorder) || 0 });
    alog(req.uid, 'linkcat_add', name); res.status(201).json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.delete('/admin/link-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = oid(req.params.id) && await LinkCat.findById(req.params.id);
    if (!c) return bad(res);
    await Promise.all([Link.updateMany({ cat: c._id }, { $unset: { cat: 1 } }), c.deleteOne()]);
    alog(req.uid, 'linkcat_del', c.name); res.json({ ok: true });
  }));

  /* ================= HỘP THƯ ĐẦY ĐỦ (mail: inbox / sent / trash) ================= */
  const meOid = (req) => new Types.ObjectId(String(req.uid));
  const convoQ = (req, trashed) => ({ $or: [{ from: meOid(req) }, { to: meOid(req) }],
    ...(trashed ? { delBy: meOid(req) } : { delBy: { $ne: meOid(req) } }) });
  router.get('/mail', auth, wrap(async (req, res) => {   // danh sách hội thoại (inbox gộp chung, như phpFox)
    const me = meOid(req);
    const rows = await Message.aggregate([
      { $match: convoQ(req, false) },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { $cond: [{ $eq: ['$from', me] }, '$to', '$from'] },
        last: { $first: '$$ROOT' },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$to', me] }, { $eq: ['$read', false] }] }, 1, 0] } } } },
      { $sort: { 'last.createdAt': -1 } }, { $limit: 30 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name avatar').lean();
    const um = new Map(users.map((u) => [String(u._id), u]));
    res.json({ convos: rows.map((r) => { const u = um.get(String(r._id)); return u ? {
      user: who(u), lastText: r.last.text, lastAt: r.last.createdAt, mine: String(r.last.from) === req.uid, unread: r.unread } : null; }).filter(Boolean) });
  }));
  router.get('/mail/trash', auth, wrap(async (req, res) => {
    const me = meOid(req);
    const rows = await Message.aggregate([
      { $match: convoQ(req, true) },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { $cond: [{ $eq: ['$from', me] }, '$to', '$from'] }, last: { $first: '$$ROOT' }, count: { $sum: 1 } } },
      { $sort: { 'last.createdAt': -1 } }, { $limit: 30 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name avatar').lean();
    const um = new Map(users.map((u) => [String(u._id), u]));
    res.json({ convos: rows.map((r) => { const u = um.get(String(r._id)); return u ? {
      user: who(u), lastText: r.last.text, lastAt: r.last.createdAt, count: r.count } : null; }).filter(Boolean) });
  }));
  router.post('/mail/:id/trash', auth, wrap(async (req, res) => {   // xếp hội thoại vào thùng rác (chỉ ẩn phía mình)
    const other = oid(req.params.id);
    if (!other) return fail(res, 'Người dùng không hợp lệ.');
    await Message.updateMany({ $or: [{ from: req.uid, to: other }, { from: other, to: req.uid }] }, { $addToSet: { delBy: meOid(req) } });
    res.json({ ok: true });
  }));
  router.post('/mail/:id/restore', auth, wrap(async (req, res) => {
    const other = oid(req.params.id);
    if (!other) return fail(res, 'Người dùng không hợp lệ.');
    await Message.updateMany({ $or: [{ from: req.uid, to: other }, { from: other, to: req.uid }] }, { $pull: { delBy: meOid(req) } });
    res.json({ ok: true });
  }));
  router.delete('/mail/:id', auth, wrap(async (req, res) => {   // xóa hẳn những tin cả 2 bên đều đã cho vào thùng rác
    const other = oid(req.params.id);
    if (!other) return fail(res, 'Người dùng không hợp lệ.');
    const r = await Message.deleteMany({ $or: [{ from: req.uid, to: other }, { from: other, to: req.uid }], delBy: { $all: [meOid(req), new Types.ObjectId(String(other))] } });
    res.json({ ok: true, deleted: r.deletedCount });
  }));
};
