/* Điểm tín dụng + nhiệm vụ tân thủ (port từ UCenter Home creditrule/task/usertask):
   thưởng điểm cho hoạt động hàng ngày, nhiệm vụ tân thủ nhận thưởng, cấp bậc theo kinh nghiệm.
   Quy tắc và nhiệm vụ cấu hình được từ trang quản trị (server/aconfig.js); ở đây đọc từ DB. */
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, CreditLog, UserTask } = require('./models');
const { getRules, getTasks } = require('./aconfig');

const LEVELS = [
  [0, 'Mới tham gia'], [100, 'Năng động'], [500, 'Tích cực'],
  [1500, 'Kỳ cựu'], [5000, 'Bậc thầy'], [15000, 'Huyền thoại'],
];
const levelOf = (exp = 0) => { let t = LEVELS[0][1]; for (const [min, name] of LEVELS) if (exp >= min) t = name; return t; };

/* Cộng điểm (tôn trọng giới hạn ngày). Trả về true nếu được cộng. */
const award = async (userId, action, note = '') => {
  if (!userId) return false;
  try {
    const rules = await getRules();
    const rule = rules.find((r) => r.action === action);
    if (!rule || rule.credit <= 0) return false;
    if (rule.cycle === 'daily' && rule.max > 0) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const n = await CreditLog.countDocuments({ user: userId, action, createdAt: { $gte: start } });
      if (n >= rule.max) return false;
    }
    let credit = rule.credit;
    const me = await User.findById(userId).select('magicFx').lean();   // đạo cụ Rộng đường: +50% điểm
    const fx = me && me.magicFx && me.magicFx.get('friendnum');
    if (fx && fx.exp > Date.now()) credit = Math.ceil(credit * 1.5);
    await CreditLog.create({ user: userId, action, credit, exp: rule.exp, note });
    await User.updateOne({ _id: userId }, { $inc: { credit, experience: rule.exp } });
    return true;
  } catch (e) { console.error('award:', e.message); return false; }
};

/* Trừ điểm (dùng cho mua đạo cụ...). Trả về true nếu đủ điểm và đã trừ.
   NGUYÊN TỬ: điều kiện credit >= amount nằm trong cùng một update -> 2 request song song không thể cùng trừ. */
const spend = async (userId, amount, note = '') => {
  if (!userId || amount <= 0) return true;
  try {
    const r = await User.updateOne({ _id: userId, credit: { $gte: amount } }, { $inc: { credit: -amount } });
    if (!r.modifiedCount) return false;
    await CreditLog.create({ user: userId, action: 'spend', credit: -amount, exp: 0, note });
    return true;
  } catch (e) { console.error('spend:', e.message); return false; }
};
/* Đánh dấu nhiệm vụ hoàn thành (gọi khi hành động xảy ra); thưởng khi người dùng bấm nhận */
const completeTask = async (userId, taskId) => {
  if (!userId || !taskId) return;
  try {
    const defs = await getTasks();
    if (!defs.some((t) => t.id === taskId)) return;
    await UserTask.updateOne({ user: userId, task: taskId }, { $set: { done: true } }, { upsert: true });
  } catch (e) { console.error('completeTask:', e.message); }
};

module.exports = (router, { auth, wrap, fail }) => {
  const lim = rateLimit({ store: rlStore('credit.lim'), windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

  router.get('/credit/me', auth, wrap(async (req, res) => {
    const u = await User.findById(req.uid).select('credit experience').lean();
    const rules = await getRules();
    res.json({ credit: u.credit || 0, experience: u.experience || 0, level: levelOf(u.experience || 0),
      rules: rules.map((r) => ({ action: r.action, credit: r.credit, exp: r.exp, cycle: r.cycle, max: r.max, label: r.label })) });
  }));

  router.get('/credit/log', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const [total, rows] = await Promise.all([
      CreditLog.countDocuments({ user: req.uid }),
      CreditLog.find({ user: req.uid }).sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).lean(),
    ]);
    res.json({ total, page, per, log: rows.map((l) => ({ id: l._id, action: l.action, credit: l.credit, exp: l.exp, note: l.note, createdAt: l.createdAt })) });
  }));

  router.get('/tasks', auth, wrap(async (req, res) => {
    const done = await UserTask.find({ user: req.uid }).lean();
    const defs = await getTasks();
    const map = new Map(done.map((d) => [d.task, d]));
    res.json({ tasks: defs.map((t) => ({ id: t.id, name: t.name, desc: t.desc, credit: t.credit, exp: t.exp, done: !!map.get(t.id)?.done, claimed: !!map.get(t.id)?.claimed })) });
  }));

  router.post('/tasks/:tid/claim', auth, lim, wrap(async (req, res) => {   // :tid (không phải :id) vì id nhiệm vụ là chữ ('avatar', 'post'...), còn router.param('id') ở routes.js bắt buộc ObjectId
    const defs = await getTasks();
    const t = defs.find((x) => x.id === req.params.tid);
    if (!t) return fail(res, 'Nhiệm vụ không tồn tại.', null, 404);
    // NGUYÊN TỬ: chỉ một request giành được claimed=true -> không nhận thưởng 2 lần
    const st = await UserTask.findOneAndUpdate({ user: req.uid, task: t.id, done: true, claimed: { $ne: true } }, { $set: { claimed: true } }, { new: true });
    if (!st) return fail(res, 'Bạn chưa hoàn thành nhiệm vụ này hoặc đã nhận thưởng rồi.');
    await CreditLog.create({ user: req.uid, action: 'task', credit: t.credit, exp: t.exp, note: t.name });
    const u = await User.findByIdAndUpdate(req.uid, { $inc: { credit: t.credit, experience: t.exp } }, { new: true }).select('credit experience').lean();
    res.json({ ok: true, credit: u.credit, experience: u.experience, level: levelOf(u.experience) });
  }));
};

module.exports.award = award;
module.exports.spend = spend;
module.exports.completeTask = completeTask;
module.exports.levelOf = levelOf;
