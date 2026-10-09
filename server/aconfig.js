/* Quản trị hệ thống (port admincp_config/credit/task/hotuser/ip/log/usergroup của UCHome):
   - Quy tắc điểm (thay RULES hardcode), định nghĩa nhiệm vụ, cảm xúc click
   - Thành viên nổi bật, chặn IP, nhật ký admin, cấu hình site, nhóm quyền */
const { User, CreditRule, TaskDef, HotUser, IpBan, AdminLog, SiteConfig, UserGroup, EventCat, Event, Blog, MagicDef } = require('./models');

const { writeAudit, buildLogFilter } = require('./audit');
const alog = (admin, action, target = '', note = '') => {
  writeAudit(AdminLog, admin, action, target, note);   // không bao giờ ghi password/2FA/token (sanitize trong audit.js)
};
// Cấu hình site: đọc kèm giá trị mặc định
const siteGet = async (key, def = '') => {
  const r = await SiteConfig.findOne({ key }).lean();
  return r ? r.value : def;
};
const siteGetAll = async () => {
  const rows = await SiteConfig.find().lean();
  const o = {};
  rows.forEach((r) => { o[r.key] = r.value; });
  return o;
};

const DEFAULT_RULES = [
  ['login', 2, 1, 'daily', 1, 'Đăng nhập mỗi ngày'],
  ['post', 3, 2, 'daily', 10, 'Đăng bài viết'],
  ['blog', 5, 3, 'daily', 5, 'Viết nhật ký'],
  ['doing', 1, 1, 'daily', 20, 'Đăng trạng thái'],
  ['share', 2, 1, 'daily', 10, 'Chia sẻ nội dung'],
  ['comment', 1, 1, 'daily', 30, 'Bình luận'],
  ['invite', 10, 5, 'once', 0, 'Mời bạn đăng ký thành công'],
];
const DEFAULT_TASKS = [
  ['avatar', 'Ảnh đại diện', 'Tải lên ảnh đại diện của bạn', 5, 3],
  ['profile', 'Hoàn thiện hồ sơ', 'Điền giới thiệu và nơi ở', 5, 3],
  ['doing', 'Trạng thái đầu tiên', 'Đăng một trạng thái ngắn', 3, 2],
  ['post', 'Bài viết đầu tiên', 'Đăng một bài viết lên tường', 5, 3],
  ['friend', 'Kết bạn đầu tiên', 'Kết bạn với một thành viên', 5, 3],
  ['invite', 'Mời bạn bè', 'Mời một người đăng ký thành công', 10, 5],
];
const ensureDefaults = async () => {
  if (!(await CreditRule.estimatedDocumentCount())) {
    await CreditRule.insertMany(DEFAULT_RULES.map((r, i) => ({ action: r[0], credit: r[1], exp: r[2], cycle: r[3], max: r[4], label: r[5] })));
  }
  if (!(await TaskDef.estimatedDocumentCount())) {
    await TaskDef.insertMany(DEFAULT_TASKS.map((t, i) => ({ id: t[0], name: t[1], desc: t[2], credit: t[3], exp: t[4], displayorder: i })));
  }
  if (!(await siteGet('clicks'))) {
    await SiteConfig.create({ key: 'clicks', value: JSON.stringify(['👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🔥']) });
  }
};
const getRules = async () => {
  await ensureDefaults();
  return CreditRule.find({ enabled: true }).lean();
};
const getTasks = async () => {
  await ensureDefaults();
  return TaskDef.find({ enabled: true }).sort({ displayorder: 1 }).lean();
};
const getClicks = async () => {
  try { const v = await siteGet('clicks'); const a = JSON.parse(v); if (Array.isArray(a) && a.length) return a; } catch (e) {}
  return ['👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🔥'];
};

module.exports = (router, { auth, wrap, fail, S, isAdmin }) => {
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });
  const pg = (req, per) => ({ page: Math.max(1, parseInt(req.query.page, 10) || 1), per });

  /* ---- Quy tắc điểm ---- */
  router.get('/admin/credit-rules', auth, adminOnly, wrap(async (req, res) => {
    await ensureDefaults();
    const rules = await CreditRule.find().sort({ action: 1 }).lean();
    res.json({ rules: rules.map((r) => ({ id: String(r._id), action: r.action, credit: r.credit, exp: r.exp, cycle: r.cycle, max: r.max, label: r.label, enabled: r.enabled })) });
  }));
  router.patch('/admin/credit-rules/:id', auth, adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const r = await CreditRule.findByIdAndUpdate(req.params.id, {
      ...(b.credit !== undefined && { credit: Math.max(0, Math.min(10000, parseInt(b.credit, 10) || 0)) }),
      ...(b.exp !== undefined && { exp: Math.max(0, Math.min(10000, parseInt(b.exp, 10) || 0)) }),
      ...(b.max !== undefined && { max: Math.max(0, Math.min(10000, parseInt(b.max, 10) || 0)) }),
      ...(b.cycle && ['once', 'daily'].includes(b.cycle) && { cycle: b.cycle }),
      ...(b.label !== undefined && { label: S(b.label).slice(0, 80) }),
      ...(b.enabled !== undefined && { enabled: !!b.enabled }),
    }, { new: true });
    if (!r) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'credit_rule', r.action, `credit=${r.credit} exp=${r.exp}`);
    res.json({ ok: true });
  }));

  /* ---- Nhiệm vụ ---- */
  router.get('/admin/tasks', auth, adminOnly, wrap(async (req, res) => {
    await ensureDefaults();
    const tasks = await TaskDef.find().sort({ displayorder: 1 }).lean();
    res.json({ tasks: tasks.map((t) => ({ id: t.id, name: t.name, desc: t.desc, credit: t.credit, exp: t.exp, enabled: t.enabled, displayorder: t.displayorder })) });
  }));
  router.patch('/admin/tasks/:tid', auth, adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const t = await TaskDef.findOneAndUpdate({ id: req.params.tid }, {
      ...(b.name !== undefined && { name: S(b.name).slice(0, 80) }),
      ...(b.desc !== undefined && { desc: S(b.desc).slice(0, 300) }),
      ...(b.credit !== undefined && { credit: Math.max(0, Math.min(10000, parseInt(b.credit, 10) || 0)) }),
      ...(b.exp !== undefined && { exp: Math.max(0, Math.min(10000, parseInt(b.exp, 10) || 0)) }),
      ...(b.enabled !== undefined && { enabled: !!b.enabled }),
    }, { new: true });
    if (!t) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'task_def', t.id, t.name);
    res.json({ ok: true });
  }));

  /* ---- Cảm xúc click ---- */
  router.get('/admin/clicks', auth, adminOnly, wrap(async (req, res) => {
    res.json({ clicks: await getClicks() });
  }));
  router.put('/admin/clicks', auth, adminOnly, wrap(async (req, res) => {
    const arr = Array.isArray(req.body.clicks) ? req.body.clicks.map((c) => S(c).trim()).filter(Boolean).slice(0, 12) : [];
    if (!arr.length) return fail(res, 'Cần ít nhất 1 cảm xúc.');
    await SiteConfig.updateOne({ key: 'clicks' }, { $set: { value: JSON.stringify(arr) } }, { upsert: true });
    alog(req.uid, 'clicks', '', arr.join(' '));
    res.json({ clicks: arr });
  }));

  /* ---- Thành viên nổi bật ---- */
  router.get('/admin/hotusers', auth, adminOnly, wrap(async (req, res) => {
    const rows = await HotUser.find().populate('user', 'name avatar').sort({ displayorder: 1 }).lean();
    res.json({ hotusers: rows.map((r) => ({ id: String(r._id), user: r.user ? { id: String(r.user._id), name: r.user.name, avatar: r.user.avatar || '' } : null, note: r.note, displayorder: r.displayorder })).filter((r) => r.user) });
  }));
  router.post('/admin/hotusers', auth, adminOnly, wrap(async (req, res) => {
    const uid = S(req.body.user).trim();
    if (!/^[0-9a-fA-F]{24}$/.test(uid)) return fail(res, 'ID người dùng không hợp lệ.');
    const u = await User.findById(uid).select('name').lean();
    if (!u) return fail(res, 'Không tìm thấy người dùng.', null, 404);
    try {
      const h = await HotUser.create({ user: uid, note: S(req.body.note).slice(0, 120), displayorder: parseInt(req.body.displayorder, 10) || 0 });
      alog(req.uid, 'hotuser_add', u.name);
      res.status(201).json({ hotuser: { id: String(h._id) } });
    } catch (e) { if (e.code === 11000) return fail(res, 'Người này đã nổi bật rồi.', null, 409); throw e; }
  }));
  router.delete('/admin/hotusers/:id', auth, adminOnly, wrap(async (req, res) => {
    const h = await HotUser.findByIdAndDelete(req.params.id);
    if (!h) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'hotuser_del', String(h.user));
    res.json({ ok: true });
  }));
  // Public: danh sách nổi bật cho trang khám phá
  router.get('/hotusers', auth, wrap(async (req, res) => {
    const rows = await HotUser.find().populate('user', 'name avatar').sort({ displayorder: 1 }).limit(20).lean();
    res.json({ hotusers: rows.filter((r) => r.user).map((r) => ({ id: String(r.user._id), name: r.user.name, avatar: r.user.avatar || '', note: r.note || '' })) });
  }));

  /* ---- Chặn IP ---- */
  router.get('/admin/ipbans', auth, adminOnly, wrap(async (req, res) => {
    const rows = await IpBan.find().sort({ createdAt: -1 }).lean();
    res.json({ ipbans: rows.map((r) => ({ id: String(r._id), ip: r.ip, reason: r.reason, createdAt: r.createdAt })) });
  }));
  router.post('/admin/ipbans', auth, adminOnly, wrap(async (req, res) => {
    const ip = S(req.body.ip).trim().slice(0, 45);
    if (!/^[\d.:a-fA-F]+$/.test(ip) || ip.length < 3) return fail(res, 'IP không hợp lệ.');
    const { clientIp } = require('./session');
    if (ip === clientIp(req)) return fail(res, 'Không thể chặn chính IP bạn đang dùng (sẽ tự khóa mình).', null, 400);
    try {
      await IpBan.create({ ip, reason: S(req.body.reason).slice(0, 200) });
      require('./session').bustBanCache(ip, null);   // xóa cache IP ban để có hiệu lực ngay
      alog(req.uid, 'ipban_add', ip);
      res.status(201).json({ ok: true });
    } catch (e) { if (e.code === 11000) return fail(res, 'IP này đã bị chặn.', null, 409); throw e; }
  }));
  router.delete('/admin/ipbans/:id', auth, adminOnly, wrap(async (req, res) => {
    const r = await IpBan.findByIdAndDelete(req.params.id);
    if (!r) return fail(res, 'Không tìm thấy.', null, 404);
    require('./session').bustBanCache(r.ip, null);   // xóa cache IP ban để có hiệu lực ngay
    alog(req.uid, 'ipban_del', r.ip);
    res.json({ ok: true });
  }));

  /* ---- Nhật ký admin ---- */
  router.get('/admin/logs', auth, adminOnly, wrap(async (req, res) => {
    const { page, per } = pg(req, 20);
    const filter = buildLogFilter({ action: req.query.action, q: req.query.q });
    const total = await AdminLog.countDocuments(filter);
    const rows = await AdminLog.find(filter).populate('admin', 'name').sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).lean();
    res.json({ total, page, per, logs: rows.map((l) => ({ id: String(l._id), admin: l.admin ? l.admin.name : '?', action: l.action, target: l.target, note: l.note, createdAt: l.createdAt })) });
  }));

  /* ---- Cấu hình site ---- */
  const SITE_KEYS = [
    ['site_name', 'Tên website', 'CoolAir'],
    ['register_open', 'Mở đăng ký (1=mở, 0=đóng)', '1'],
    ['invite_only', 'Chỉ đăng ký bằng mã mời (1/0)', '0'],
    ['announcement', 'Thông báo chung hiển thị đầu trang', ''],
  ];
  router.get('/admin/site-config', auth, adminOnly, wrap(async (req, res) => {
    const cur = await siteGetAll();
    res.json({ keys: SITE_KEYS.map(([key, label, def]) => ({ key, label, value: cur[key] !== undefined ? cur[key] : def })) });
  }));
  const BOOL_KEYS = new Set(['register_open', 'invite_only']);
  const normBool = (v) => /^(1|true|yes|on)$/i.test(String(v).trim()) ? '1' : '0';
  router.put('/admin/site-config', auth, adminOnly, wrap(async (req, res) => {
    const body = req.body || {};
    for (const [key] of SITE_KEYS) {
      if (body[key] !== undefined) {
        const val = BOOL_KEYS.has(key) ? normBool(body[key]) : S(body[key]).slice(0, 500);
        await SiteConfig.updateOne({ key }, { $set: { value: val } }, { upsert: true });
      }
    }
    alog(req.uid, 'site_config', '', 'cập nhật cấu hình');
    res.json({ ok: true });
  }));
  // Public: đọc vài cấu hình cho frontend
  router.get('/site-config', wrap(async (req, res) => {
    res.json({ site_name: await siteGet('site_name', 'CoolAir'), announcement: await siteGet('announcement', ''), register_open: (await siteGet('register_open', '1')) === '1' });
  }));

  /* ---- Nhóm quyền ---- */
  const PERM_KEYS = [['post', 'Đăng bài'], ['comment', 'Bình luận'], ['invite', 'Tạo mã mời'], ['group_create', 'Tạo nhóm'], ['event_create', 'Tạo sự kiện']];
  router.get('/admin/user-groups', auth, adminOnly, wrap(async (req, res) => {
    const rows = await UserGroup.find().sort({ displayorder: 1 }).lean();
    res.json({ permKeys: PERM_KEYS, groups: rows.map((g) => ({ id: String(g._id), name: g.name, perms: Object.fromEntries(g.perms || new Map()), displayorder: g.displayorder })) });
  }));
  router.post('/admin/user-groups', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim().slice(0, 60);
    if (!name) return fail(res, 'Cần tên nhóm.');
    const perms = {};
    for (const [k] of PERM_KEYS) perms[k] = !!(req.body.perms && req.body.perms[k]);
    const g = await UserGroup.create({ name, perms, displayorder: parseInt(req.body.displayorder, 10) || 0 });
    alog(req.uid, 'usergroup_add', name);
    res.status(201).json({ group: { id: String(g._id) } });
  }));
  router.patch('/admin/user-groups/:id', auth, adminOnly, wrap(async (req, res) => {
    const b = req.body || {}, upd = {};
    if (b.name !== undefined) upd.name = S(b.name).trim().slice(0, 60);
    if (b.perms) { const perms = {}; for (const [k] of PERM_KEYS) perms[k] = !!b.perms[k]; upd.perms = perms; }
    if (b.displayorder !== undefined) upd.displayorder = parseInt(b.displayorder, 10) || 0;
    const g = await UserGroup.findByIdAndUpdate(req.params.id, upd, { new: true });
    if (!g) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'usergroup_edit', g.name);
    res.json({ ok: true });
  }));
  router.delete('/admin/user-groups/:id', auth, adminOnly, wrap(async (req, res) => {
    const g = await UserGroup.findByIdAndDelete(req.params.id);
    if (!g) return fail(res, 'Không tìm thấy.', null, 404);
    await User.updateMany({ userGroup: g._id }, { $unset: { userGroup: 1 } });
    alog(req.uid, 'usergroup_del', g.name);
    res.json({ ok: true });
  }));
  // Gán nhóm cho user (từ trang quản lý thành viên)
  router.post('/admin/users/:id/group', auth, adminOnly, wrap(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) return fail(res, 'Không tìm thấy.', null, 404);
    const gid = S(req.body.group).trim();
    if (gid && !/^[0-9a-fA-F]{24}$/.test(gid)) return fail(res, 'Nhóm không hợp lệ.');
    if (gid && !(await UserGroup.exists({ _id: gid }))) return fail(res, 'Nhóm không tồn tại.', null, 404);
    u.userGroup = gid || undefined;
    await u.save();
    alog(req.uid, 'user_set_group', u.username, gid || '(gỡ)');
    res.json({ ok: true });
  }));

  /* Phân loại sự kiện (eventclass của UCHome): do quản trị định nghĩa, dùng chung toàn site */
  router.get('/admin/event-cats', auth, adminOnly, wrap(async (req, res) => {
    const cats = await EventCat.find().sort({ name: 1 }).lean();
    const counts = await Event.aggregate([{ $group: { _id: '$cat', n: { $sum: 1 } } }]);
    const cm = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ cats: cats.map((c) => ({ id: String(c._id), name: c.name, count: cm.get(String(c._id)) || 0 })) });
  }));
  router.post('/admin/event-cats', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim().slice(0, 40);
    if (name.length < 2) return fail(res, 'Tên phân loại cần ít nhất 2 ký tự.');
    try {
      const c = await EventCat.create({ name });
      alog(req.uid, 'eventcat_add', name);
      res.status(201).json({ cat: { id: String(c._id), name: c.name, count: 0 } });
    } catch (e) { if (e.code === 11000) return fail(res, 'Phân loại này đã có.', null, 409); throw e; }
  }));
  router.patch('/admin/event-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const name = S(req.body.name).trim().slice(0, 40);
    if (name.length < 2) return fail(res, 'Tên phân loại cần ít nhất 2 ký tự.');
    const c = await EventCat.findByIdAndUpdate(req.params.id, { name }, { new: true });
    if (!c) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'eventcat_edit', c.id, name);
    res.json({ cat: { id: String(c._id), name: c.name } });
  }));
  router.delete('/admin/event-cats/:id', auth, adminOnly, wrap(async (req, res) => {
    const c = await EventCat.findByIdAndDelete(req.params.id);
    if (!c) return fail(res, 'Không tìm thấy.', null, 404);
    await Event.updateMany({ cat: c._id }, { $unset: { cat: 1 } });
    alog(req.uid, 'eventcat_del', c.name);
    res.json({ ok: true });
  }));

  /* Quản lý tag (port admincp_tag của UCHome): liệt kê, gộp/đổi tên, xóa tag trên toàn site */
  router.get('/admin/tags', auth, adminOnly, wrap(async (req, res) => {
    const rows = await Blog.aggregate([
      { $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 300 },
    ]);
    res.json({ tags: rows.map((r) => ({ name: r._id, count: r.n })) });
  }));
  router.post('/admin/tags/merge', auth, adminOnly, wrap(async (req, res) => {
    const from = S(req.body.from).trim().slice(0, 20), to = S(req.body.to).trim().slice(0, 20);
    if (!from) return fail(res, 'Thiếu tag nguồn.');
    if (!to || to === from) return fail(res, 'Tag đích không hợp lệ.');
    const blogs = await Blog.find({ tags: from }).select('tags');
    const ops = blogs.map((b) => ({
      updateOne: { filter: { _id: b._id }, update: { $set: { tags: [...new Set(b.tags.map((t) => (t === from ? to : t)))].filter(Boolean).slice(0, 10) } } },
    }));
    if (ops.length) await Blog.bulkWrite(ops);
    alog(req.uid, 'tag_merge', from, '→ ' + to + ' (' + ops.length + ' bài)');
    res.json({ ok: true, updated: ops.length });
  }));
  router.delete('/admin/tags/:tag', auth, adminOnly, wrap(async (req, res) => {
    const tag = S(req.params.tag).trim().slice(0, 20);
    if (!tag) return fail(res, 'Tag không hợp lệ.');
    const r = await Blog.updateMany({ tags: tag }, { $pull: { tags: tag } });
    alog(req.uid, 'tag_del', tag, (r.modifiedCount || 0) + ' bài');
    res.json({ ok: true, updated: r.modifiedCount || 0 });
  }));

  /* Tác vụ dọn dẹp định kỳ (port admincp_cron của UCHome) */
  router.get('/admin/cron', auth, adminOnly, wrap(async (req, res) => {
    res.json(await require('./cron').status());
  }));
  router.post('/admin/cron/run', auth, adminOnly, wrap(async (req, res) => {
    const results = await require('./cron').runAll(true);
    alog(req.uid, 'cron_run', '', results.map((r) => r.id + ': ' + r.result).join(' | ').slice(0, 300));
    res.json({ ok: true, results });
  }));

  /* Quản lý giao diện (port admincp_template của UCHome): bật/tắt theme, đặt theme mặc định */
  router.get('/admin/themes', auth, adminOnly, wrap(async (req, res) => {
    const cfg = await siteGetAll();
    let disabled = [];
    try { disabled = JSON.parse(cfg.themes_disabled || '[]'); } catch (e) {}
    res.json({ disabled, def: cfg.theme_default || '' });
  }));
  router.put('/admin/themes', auth, adminOnly, wrap(async (req, res) => {
    const disabled = (Array.isArray(req.body.disabled) ? req.body.disabled : []).map(String).slice(0, 50);
    const def = S(req.body.default).trim().slice(0, 20);
    await SiteConfig.updateOne({ key: 'themes_disabled' }, { $set: { value: JSON.stringify(disabled) } }, { upsert: true });
    await SiteConfig.updateOne({ key: 'theme_default' }, { $set: { value: def } }, { upsert: true });
    alog(req.uid, 'theme_config', '', 'tắt ' + disabled.length + ' theme, mặc định: ' + (def || '(mặc định)'));
    res.json({ ok: true });
  }));
  router.get('/themes', wrap(async (req, res) => {
    const cfg = await siteGetAll();
    let disabled = [];
    try { disabled = JSON.parse(cfg.themes_disabled || '[]'); } catch (e) {}
    res.json({ disabled, def: cfg.theme_default || '' });
  }));

  /* Quản lý đạo cụ (port admincp_magic của UCHome): bật/tắt, đổi giá */
  router.get('/admin/magics', auth, adminOnly, wrap(async (req, res) => {
    await require('./magic').ensureDefs();
    const defs = await MagicDef.find().sort({ charge: 1 }).lean();
    res.json({ magics: defs.map((d) => ({ mid: d.mid, name: d.name, desc: d.desc, charge: d.charge, icon: d.icon, enabled: d.enabled !== false })) });
  }));
  router.get('/admin/magiclog', auth, adminOnly, wrap(async (req, res) => {
    const { MagicLog } = require('./models');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 20;
    const [total, rows] = await Promise.all([
      MagicLog.countDocuments(),
      MagicLog.find().sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).populate('user', 'name').lean(),
    ]);
    res.json({ total, page, per, logs: rows.map((l) => ({
      mid: l.mid, action: l.action, target: l.target, detail: l.detail, at: l.createdAt,
      user: l.user ? { id: String(l.user._id), name: l.user.name } : null })) });
  }));
  router.patch('/admin/magics/:mid', auth, adminOnly, wrap(async (req, res) => {
    const set = {};
    if (req.body.charge !== undefined) { const c = Math.max(0, Math.floor(Number(req.body.charge) || 0)); set.charge = c; }
    if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
    if (!Object.keys(set).length) return fail(res, 'Không có gì để cập nhật.');
    const d = await MagicDef.findOneAndUpdate({ mid: req.params.mid }, { $set: set }, { new: true });
    if (!d) return fail(res, 'Không tìm thấy.', null, 404);
    alog(req.uid, 'magic_edit', d.mid, JSON.stringify(set));
    res.json({ ok: true });
  }));
};

module.exports.alog = alog;
module.exports.siteGet = siteGet;
module.exports.getRules = getRules;
module.exports.getTasks = getTasks;
module.exports.getClicks = getClicks;
module.exports.ensureDefaults = ensureDefaults;
