/* Chọc (poke) */
const { rateLimit, rlStore, User, Friendship, Poke, N, S, wrap, fail, auth, ably } = require('./shared');

module.exports = (router) => {
/* ---------- Chọc (poke) – chuyển từ UCenter Home (cp_poke.php) ----------
   Ai cũng chọc được ai (như bản gốc; người nhận có nút "Kết bạn"). Mỗi cặp chỉ giữ 1 lời chọc mới nhất.
   Chọc lại (reply) sẽ xóa lời chọc người kia đã gửi cho mình. "Bỏ qua" = xóa lời chọc. */
const POKE_MAX_ICON = 13, POKE_NOTE_MAX = 25;
const pokeLimiter = rateLimit({ store: rlStore('routes.pokeLimiter'), windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn chọc quá nhanh, vui lòng thử lại sau ít giây.' } });
const pingPoke = async (to, from) => {
  if (!ably) return;
  try { await ably.channels.get('inbox:' + to).publish('poke', { from: String(from) }); }
  catch (e) { console.error('Ably:', e.message); }                // lỗi realtime không được làm hỏng việc chọc
};

router.get('/pokes', auth, wrap(async (req, res) => {              // lời chọc mới của mình (mới nhất trước)
  const rows = (await Poke.find({ to: req.uid }).sort({ updatedAt: -1 }).limit(50).populate('from', 'name avatar')).filter((p) => p.from);
  const ids = rows.map((p) => p.from._id);
  const rel = ids.length ? await Friendship.find({ $or: [{ from: req.uid, to: { $in: ids } }, { from: { $in: ids }, to: req.uid }] }) : [];
  res.json(rows.map((p) => {
    const f = rel.find((r) => String(r.from) === p.from.id || String(r.to) === p.from.id);
    return { id: p.from.id, name: p.from.name, avatar: p.from.avatar || '', icon: p.icon, note: p.note, createdAt: p.updatedAt,
      rel: !f ? 'none' : f.status === 'accepted' ? 'friends' : String(f.from) === req.uid ? 'sent' : 'received' };
  }));
}));

router.post('/pokes/:id', auth, pokeLimiter, wrap(async (req, res) => {
  const to = req.params.id, icon = req.body.icon === undefined ? 0 : req.body.icon, note = S(req.body.note).trim();
  if (to === req.uid) return fail(res, 'Bạn không thể tự chọc chính mình.');
  if (!Number.isInteger(icon) || icon < 0 || icon > POKE_MAX_ICON) return fail(res, 'Hành động không hợp lệ.');
  if (note.length > POKE_NOTE_MAX) return fail(res, `Lời nhắn tối đa ${POKE_NOTE_MAX} ký tự.`);
  if (!(await User.exists({ _id: to }))) return fail(res, 'Không tìm thấy người dùng.', null, 404);
  if (await require('../vis').blockedBetween(req.uid, to)) return fail(res, 'Bạn không thể chọc người này.', null, 403);
  const pk = await Poke.findOneAndUpdate({ from: req.uid, to }, { icon, note }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (req.body.reply === true) {   // chọc lại -> xóa lời chọc của họ (và thông báo đi kèm)
    const old = await Poke.findOneAndDelete({ from: to, to: req.uid });
    if (old) await N.remove('poke', old.id, req.uid);
  }
  await N.swap('poke', pk.id, to, req.uid, '');                            // chọc lại cùng một người -> chỉ còn 1 thông báo mới nhất
  await pingPoke(to, req.uid);
  res.status(201).json({ ok: true });
}));

router.delete('/pokes', auth, wrap(async (req, res) => {           // bỏ qua tất cả
  await Poke.deleteMany({ to: req.uid });
  await N.removeType(req.uid, 'poke');
  res.json({ ok: true });
}));

router.delete('/pokes/:id', auth, wrap(async (req, res) => {       // bỏ qua lời chọc của một người
  const old = await Poke.findOneAndDelete({ from: req.params.id, to: req.uid });
  if (old) await N.remove('poke', old.id, req.uid);
  res.json({ ok: true });
}));
};
