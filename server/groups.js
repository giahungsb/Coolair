/* Nhóm – port từ UCenter Home (mtag / thread / post / profield). Gắn vào router chính sau bước kiểm tra xác thực email. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Friendship, Category, Group, GroupMember, GroupInvite, Thread, GroupPost } = require('./models');

module.exports = (router, { S, wrap, fail, isAdmin, areFriends, N }) => {
  const oid = (v) => typeof v === 'string' && isValidObjectId(v);
  const clean = (v) => S(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();   // giữ xuống dòng, bỏ ký tự điều khiển
  const line = (v) => S(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const clamp = (v, lo, hi, d = 0) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : Math.max(lo, Math.min(hi, n)); };
  const fl = (res, msg, code = 400, fields) => fail(res, msg, fields, code);
  const writeLimiter = rateLimit({ store: rlStore('groups.writeLimiter'), windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Bạn đăng quá nhanh, vui lòng thử lại sau ít giây.' } });   // như interval_check('post') của UCHome
  const PAGE = 30;

  /* ===== Quyền: tính "grade" của người dùng trong một nhóm (getmtag của UCHome) ===== */
  // -9 không phải thành viên, -2 chờ duyệt, -1 bị cấm, 0 thường, 1 sao, 8 phó nhóm, 9 chủ nhóm (quản trị viên hệ thống luôn = 9)
  const access = async (req, g) => {
    const me = await User.findById(req.uid).select('email');
    const sysAdmin = !!me && isAdmin(me);
    const m = await GroupMember.findOne({ group: g._id, user: req.uid });
    let grade = m ? m.grade : -9;
    if (grade < 9 && sysAdmin) grade = 9;
    const joinperm = g.memberNum < 1 ? 0 : g.joinperm, viewperm = g.memberNum < 1 ? 0 : g.viewperm;   // nhóm trống thì bỏ giới hạn
    const a = { sysAdmin, grade, ismember: !!m };
    a.allowthread = grade >= 0 ? 1 : g.threadperm; a.allowpost = grade >= 0 ? 1 : g.postperm;
    a.allowview = viewperm && grade < -1 ? 0 : 1;
    a.allowinvite = grade >= 0 ? 1 : 0; if (joinperm && grade < 8) a.allowinvite = 0;
    if (g.closed || grade === -1) a.allowpost = a.allowthread = 0;
    return a;
  };
  const loadGroup = async (req, res) => {
    if (!oid(req.params.id)) { fl(res, 'Không tìm thấy nhóm.', 404); return null; }
    const g = await Group.findById(req.params.id).populate('category');
    if (!g || !g.category) { fl(res, 'Không tìm thấy nhóm.', 404); return null; }
    const a = await access(req, g);
    if (g.closed && !a.sysAdmin) { fl(res, 'Nhóm này đã bị đóng.', 403); return null; }
    return { g, a };
  };
  const catMin = (g) => g.category.mtagminnum || 0;
  const catView = (c) => ({ id: c.id, title: c.title, note: c.note || '', formtype: c.formtype, inputnum: c.inputnum || 0, choice: c.choice || [],
    mtagminnum: c.mtagminnum || 0, manualmoderator: !!c.manualmoderator, manualmember: !!c.manualmember, displayorder: c.displayorder || 0 });
  const gView = (g, a) => ({ id: g.id, name: g.name, category: g.category && g.category.title ? { id: String(g.category._id), title: g.category.title } : null,
    pic: g.pic || '', memberNum: g.memberNum, threadNum: g.threadNum, postNum: g.postNum, closed: g.closed, recommend: g.recommend,
    ...(a ? { grade: a.grade, ismember: a.ismember } : {}) });
  const gradeName = { '-2': 'Chờ duyệt', '-1': 'Bị cấm', 0: 'Thành viên', 1: 'Thành viên sao', 8: 'Phó nhóm', 9: 'Chủ nhóm' };

  const recount = async (g) => {          // cập nhật lại số thành viên; nhóm không còn ai thì xóa hẳn (mtag_out)
    const n = await GroupMember.countDocuments({ group: g._id, grade: { $gte: -1 } });
    const any = await GroupMember.countDocuments({ group: g._id });
    if (any > 0) { g.memberNum = n; await Group.updateOne({ _id: g._id }, { memberNum: n }); return; }
    await wipeGroup([g._id]);
  };
  const wipeGroup = async (ids) => {      // deletemtag
    await Promise.all([GroupMember.deleteMany({ group: { $in: ids } }), GroupInvite.deleteMany({ group: { $in: ids } }),
      Thread.deleteMany({ group: { $in: ids } }), GroupPost.deleteMany({ group: { $in: ids } }), Group.deleteMany({ _id: { $in: ids } })]);
  };
  const myCountIn = async (uid, cat) => {   // số nhóm user đang ở trong chuyên mục (kể cả chờ duyệt, như UCHome)
    const gs = await Group.find({ category: cat._id }).select('_id');
    return GroupMember.countDocuments({ user: uid, group: { $in: gs.map((x) => x._id) } });
  };
  const maxIn = (c) => (c.formtype === 'select' ? 1 : c.inputnum || 0);

  /* ===== Chuyên mục (profield) ===== */
  const adminOnly = wrap(async (req, res, next) => {
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fl(res, 'Chỉ quản trị viên mới dùng được chức năng này.', 403);
    next();
  });
  const catInput = (b) => {
    const f = {}, title = line(b.title), note = line(b.note), ft = ['text', 'select', 'multi'].includes(S(b.formtype)) ? S(b.formtype) : 'text';
    const choice = ft === 'text' ? [] : [...new Set(S(b.choice).split(/\r?\n/).map(line).filter(Boolean))];
    if (!title || title.length > 50) f.title = 'Tên chuyên mục cần 1–50 ký tự.';
    if (note.length > 100) f.note = 'Mô tả tối đa 100 ký tự.';
    if (ft !== 'text' && (choice.length < 1 || choice.length > 100)) f.choice = 'Nhập 1–100 lựa chọn, mỗi dòng một giá trị.';
    if (choice.some((x) => x.length < 2 || x.length > 40)) f.choice = 'Mỗi lựa chọn (tên nhóm) cần 2–40 ký tự.';
    return { f, data: { title, note, formtype: ft, choice, inputnum: clamp(b.inputnum, 0, 50), mtagminnum: clamp(b.mtagminnum, 0, 1000),
      manualmoderator: !!b.manualmoderator, manualmember: !!b.manualmember, displayorder: clamp(b.displayorder, -9999, 9999) } };
  };
  const allCats = async () => (await Category.find().sort({ displayorder: 1, _id: 1 })).map(catView);

  router.get('/group-categories', wrap(async (req, res) => res.json({ categories: await allCats() })));
  router.post('/admin/group-categories', adminOnly, wrap(async (req, res) => {
    const { f, data } = catInput(req.body);
    if (Object.keys(f).length) return fl(res, 'Dữ liệu chưa hợp lệ.', 400, f);
    if (await Category.countDocuments() >= 30) return fl(res, 'Tối đa 30 chuyên mục.');
    res.status(201).json({ category: catView(await Category.create(data)) });
  }));
  router.put('/admin/group-categories/order', adminOnly, wrap(async (req, res) => {
    const o = req.body.order && typeof req.body.order === 'object' ? req.body.order : {};
    const ops = Object.entries(o).filter(([id]) => oid(id)).map(([id, n]) => ({ updateOne: { filter: { _id: id }, update: { displayorder: clamp(n, -9999, 9999) } } }));
    if (ops.length) await Category.bulkWrite(ops);
    res.json({ categories: await allCats() });
  }));
  router.patch('/admin/group-categories/:id', adminOnly, wrap(async (req, res) => {
    if (!oid(req.params.id)) return fl(res, 'Không tìm thấy chuyên mục.', 404);
    const { f, data } = catInput(req.body);
    if (Object.keys(f).length) return fl(res, 'Dữ liệu chưa hợp lệ.', 400, f);
    const c = await Category.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    c ? res.json({ category: catView(c) }) : fl(res, 'Không tìm thấy chuyên mục.', 404);
  }));
  router.delete('/admin/group-categories/:id', adminOnly, wrap(async (req, res) => {   // xóa và chuyển các nhóm sang chuyên mục khác (deleteprofield)
    if (!oid(req.params.id)) return fl(res, 'Không tìm thấy chuyên mục.', 404);
    const to = S(req.body.to || req.query.to);
    if (await Category.countDocuments() < 2) return fl(res, 'Phải giữ lại ít nhất một chuyên mục.');
    if (!oid(to) || to === req.params.id || !(await Category.exists({ _id: to }))) return fl(res, 'Hãy chọn chuyên mục nhận các nhóm đang có.');
    const used = await Group.find({ category: req.params.id }), dest = await Group.find({ category: to }).select('name');
    const taken = new Set(dest.map((x) => x.name));
    for (const g of used) {   // tên nhóm trùng trong chuyên mục đích thì gộp thành viên / bài vào nhóm sẵn có
      const twin = taken.has(g.name) ? await Group.findOne({ category: to, name: g.name }) : null;
      if (!twin) { g.category = to; await g.save(); continue; }
      const mine = await GroupMember.find({ group: g._id }), have = new Set((await GroupMember.find({ group: twin._id }).select('user')).map((m) => String(m.user)));
      for (const m of mine) if (!have.has(String(m.user))) await GroupMember.updateOne({ _id: m._id }, { group: twin._id }); else await GroupMember.deleteOne({ _id: m._id });
      await Promise.all([Thread.updateMany({ group: g._id }, { group: twin._id }), GroupPost.updateMany({ group: g._id }, { group: twin._id }), GroupInvite.deleteMany({ group: g._id })]);
      twin.threadNum += g.threadNum; twin.postNum += g.postNum; await twin.save(); await Group.deleteOne({ _id: g._id }); await recount(twin);
    }
    await Category.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  }));

  /* ===== Danh sách / tìm nhóm ===== */
  // view: me (nhóm của mình) | manage (nhóm mình làm chủ) | hot | recommend ; orderby: threadNum | postNum | memberNum
  router.get('/groups', wrap(async (req, res) => {
    const view = ['me', 'manage', 'hot', 'recommend'].includes(req.query.view) ? req.query.view : 'hot';
    const orderby = ['threadNum', 'postNum', 'memberNum'].includes(req.query.orderby) ? req.query.orderby : 'threadNum';
    const page = clamp(req.query.page, 1, 1000, 1), per = 20, q = {};
    if (oid(S(req.query.category))) q.category = req.query.category;
    const key = line(req.query.q).slice(0, 40);
    if (key && view !== 'me' && view !== 'manage') q.name = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (view === 'recommend') q.recommend = true;
    q.closed = false;
    let grades = new Map();
    if (view === 'me' || view === 'manage') {
      const ms = await GroupMember.find({ user: req.uid, ...(view === 'manage' ? { grade: 9 } : {}) });
      ms.forEach((m) => grades.set(String(m.group), m.grade)); q._id = { $in: ms.map((m) => m.group) };
    }
    const [total, list] = await Promise.all([Group.countDocuments(q), Group.find(q).populate('category', 'title').sort({ [orderby]: -1, _id: 1 }).skip((page - 1) * per).limit(per)]);
    if (view !== 'me' && view !== 'manage' && list.length) {
      (await GroupMember.find({ user: req.uid, group: { $in: list.map((g) => g._id) } })).forEach((m) => grades.set(String(m.group), m.grade));
    }
    res.json({ total, page, per, groups: list.map((g) => ({ ...gView(g), ismember: grades.has(g.id), grade: grades.has(g.id) ? grades.get(g.id) : -9 })) });
  }));

  /* ===== Tham gia / tạo nhóm (mtag_join) ===== */
  // Cùng một API cho "tạo nhóm tự đặt tên" (chuyên mục text) và "chọn nhóm có sẵn" (select/multi)
  const joinGroup = async (uid, cat, name, joinById) => {
    let g = joinById || (await Group.findOne({ category: cat._id, name }));
    if (g && (await GroupMember.exists({ group: g._id, user: uid }))) return { g, already: true };
    const max = maxIn(cat);
    if (max && (await myCountIn(uid, cat)) >= max) return { err: `Bạn chỉ được vào tối đa ${max} nhóm trong chuyên mục "${cat.title}".` };
    if (g && g.closed) return { err: 'Nhóm này đã bị đóng.' };
    if (g && g.joinperm === 2 && g.memberNum > 0) return { err: 'Nhóm này chỉ nhận thành viên được mời.' };
    if (!g) g = await Group.create({ name, category: cat._id });
    const free = g.memberNum < 1 || !g.joinperm;
    let grade = -2;
    if (free) {
      const hasMod = await GroupMember.exists({ group: g._id, grade: { $gte: 8 } });
      grade = hasMod ? 0 : cat.manualmoderator ? 0 : 9;
    }
    try { await GroupMember.create({ group: g._id, user: uid, grade }); }
    catch (e) { if (e.code === 11000) return { g, already: true }; throw e; }
    if (grade >= -1) { g.memberNum = await GroupMember.countDocuments({ group: g._id, grade: { $gte: -1 } }); await Group.updateOne({ _id: g._id }, { memberNum: g.memberNum }); }
    return { g, grade, pending: grade === -2 };
  };

  router.post('/groups', writeLimiter, wrap(async (req, res) => {
    // body: {category, name} cho chuyên mục "text"; hoặc {category, names:[...]} cho select/multi
    if (!oid(S(req.body.category))) return fl(res, 'Hãy chọn chuyên mục.');
    const cat = await Category.findById(req.body.category);
    if (!cat) return fl(res, 'Chuyên mục không tồn tại.', 404);
    if (cat.formtype === 'text') {
      const name = line(req.body.name);
      if (name.length < 2 || name.length > 40) return fl(res, 'Tên nhóm cần 2–40 ký tự.', 400, { name: 'Tên nhóm cần 2–40 ký tự.' });
      const r = await joinGroup(req.uid, cat, name);
      if (r.err) return fl(res, r.err);
      return res.status(r.already ? 200 : 201).json({ group: gView(r.g), pending: !!r.pending, already: !!r.already });
    }
    let names = Array.isArray(req.body.names) ? req.body.names : [req.body.name];
    names = [...new Set(names.map(line))].filter((n) => cat.choice.includes(n));
    if (cat.formtype === 'select') names = names.slice(0, 1);
    if (!names.length) return fl(res, 'Hãy chọn ít nhất một nhóm trong danh sách.');
    const out = [], errs = [];
    for (const n of names) { const r = await joinGroup(req.uid, cat, n); r.err ? errs.push(r.err) : out.push({ ...gView(r.g), pending: !!r.pending }); }
    if (!out.length) return fl(res, errs[0] || 'Không tham gia được nhóm nào.');
    res.status(201).json({ groups: out, errors: errs });
  }));

  router.post('/groups/:id/join', writeLimiter, wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const r = await joinGroup(req.uid, L.g.category, L.g.name, L.g);
    if (r.err) return fl(res, r.err);
    res.json({ group: gView(r.g), pending: !!r.pending, already: !!r.already });
  }));

  router.post('/groups/:id/leave', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g } = L;
    const m = await GroupMember.findOne({ group: g._id, user: req.uid });
    if (!m) return res.json({ ok: true });
    if ((g.joinperm > 0 || g.viewperm > 0) && m.grade === 9 && (await GroupMember.countDocuments({ group: g._id, grade: 9 })) < 2)
      return fl(res, 'Bạn là chủ nhóm duy nhất của nhóm kín. Hãy chỉ định thêm một chủ nhóm khác trước khi rời.');
    await GroupMember.deleteOne({ _id: m._id }); await recount(g);
    res.json({ ok: true });
  }));

  /* ===== Trang nhóm ===== */
  router.get('/groups/:id', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    const mods = await GroupMember.find({ group: g._id, grade: { $gte: 8 } }).sort({ grade: -1 }).limit(12).populate('user', 'name username');
    const out = { ...gView(g, a), announcement: a.allowview ? g.announcement : '', joinperm: g.joinperm, viewperm: g.viewperm, threadperm: g.threadperm, postperm: g.postperm,
      closeapply: g.closeapply, minnum: catMin(g), canPost: !!a.allowpost && g.memberNum >= catMin(g), canThread: !!a.allowthread && g.memberNum >= catMin(g),
      allowview: !!a.allowview, allowinvite: !!a.allowinvite, manager: a.grade >= 8, owner: a.grade >= 9, canSetJoin: !!g.category.manualmember,
      category: { id: g.category.id, title: g.category.title, formtype: g.category.formtype, manualmember: g.category.manualmember },
      moderators: mods.filter((m) => m.user).map((m) => ({ id: m.user.id, name: m.user.name, grade: m.grade })) };
    if (a.allowview) {
      const stars = await GroupMember.find({ group: g._id, grade: 1 }).limit(24).populate('user', 'name');
      out.stars = stars.filter((m) => m.user).map((m) => ({ id: m.user.id, name: m.user.name }));
    }
    if (a.grade >= 8) out.pending = await GroupMember.countDocuments({ group: g._id, grade: -2 });
    res.json(out);
  }));

  /* ===== Thành viên ===== */
  router.get('/groups/:id/members', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    const page = clamp(req.query.page, 1, 1000, 1), per = 50, q = { group: g._id };
    const manager = a.grade >= 8;
    if (req.query.grade !== undefined && req.query.grade !== '') { if (!manager && Number(req.query.grade) < 0) return fl(res, 'Không có quyền.', 403); q.grade = clamp(req.query.grade, -9, 9); }
    else if (!manager) q.grade = { $gte: -1 };
    if (!a.allowview) return res.json({ total: 0, page, per, members: [] });
    const key = line(req.query.q).slice(0, 30);
    let uq = null;
    if (key) uq = (await User.find({ $or: [{ name: new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }).select('_id').limit(200)).map((x) => x._id);
    if (uq) q.user = { $in: uq };
    const [total, ms] = await Promise.all([GroupMember.countDocuments(q), GroupMember.find(q).sort({ grade: -1, _id: 1 }).skip((page - 1) * per).limit(per).populate('user', 'name username avatar')]);
    res.json({ total, page, per, members: ms.filter((m) => m.user).map((m) => ({ id: m.user.id, name: m.user.name, username: m.user.username, avatar: m.user.avatar || '', grade: m.grade, gradeName: gradeName[m.grade] })) });
  }));

  // Đổi cấp / duyệt / cấm / mời ra khỏi nhóm (mtag_managemember). grade: -9 = đuổi
  router.post('/groups/:id/members', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    if (a.grade < 8) return fl(res, 'Bạn không có quyền quản lý thành viên.', 403);
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]).filter(oid).slice(0, 50);
    const ng = parseInt(req.body.grade, 10);
    if (!ids.length || ![-9, -2, -1, 0, 1, 8, 9].includes(ng)) return fl(res, 'Dữ liệu chưa hợp lệ.');
    if (ng === -2) return fl(res, 'Không thể đưa thành viên về trạng thái chờ duyệt.');
    if (a.grade < 9 && ng >= 8) return fl(res, 'Chỉ chủ nhóm mới được bổ nhiệm phó nhóm / chủ nhóm.', 403);
    const ms = await GroupMember.find({ group: g._id, user: { $in: ids } });
    // phó nhóm chỉ đụng được thành viên dưới cấp 8; chủ nhóm đụng được người khác (không tự đổi cấp mình); quản trị viên hệ thống đụng được tất cả
    const ok = ms.filter((m) => m.grade < 8 || a.sysAdmin || (a.grade === 9 && String(m.user) !== req.uid));
    if (!ok.length) return fl(res, 'Không có thành viên nào bạn được phép thay đổi.', 403);
    if (ng === -9) await GroupMember.deleteMany({ _id: { $in: ok.map((m) => m._id) } });
    else await GroupMember.updateMany({ _id: { $in: ok.map((m) => m._id) } }, { grade: ng });
    await recount(g);
    res.json({ ok: true, changed: ok.length });
  }));

  /* ===== Cài đặt nhóm (cp_mtag manage / basesubmit) ===== */
  router.patch('/groups/:id', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    if (a.grade < 8) return fl(res, 'Bạn không có quyền quản lý nhóm.', 403);
    const set = {}, b = req.body;
    if (b.announcement !== undefined) { const t = clean(b.announcement); if (t.length > 2000) return fl(res, 'Thông báo tối đa 2000 ký tự.'); set.announcement = t; }
    if (b.pic !== undefined) {   // ảnh đại diện (picurl_get của UCHome): URL http(s) tối đa 150 ký tự, để trống = ảnh mặc định
      const u = line(b.pic);
      if (u && (u.length > 150 || !/^https?:\/\/[^\s<>"']+$/i.test(u))) return fl(res, 'Ảnh đại diện phải là đường dẫn http:// hoặc https:// (tối đa 150 ký tự).', 400, { pic: 'Đường dẫn ảnh không hợp lệ.' });
      set.pic = u;
    }
    if (a.grade === 9) {   // chỉ chủ nhóm đổi quyền
      if (b.joinperm !== undefined) set.joinperm = g.category.manualmember ? clamp(b.joinperm, 0, 2) : 0;
      for (const k of ['viewperm', 'threadperm', 'postperm']) if (b[k] !== undefined) set[k] = clamp(b[k], 0, 1);
      if (b.closeapply !== undefined) set.closeapply = !!b.closeapply;
    }
    if (a.sysAdmin) {   // quản trị viên hệ thống: đề cử / đóng nhóm (admincp_mtag)
      if (b.recommend !== undefined) set.recommend = !!b.recommend;
      if (b.closed !== undefined) set.closed = !!b.closed;
    }
    if (!Object.keys(set).length) return fl(res, 'Không có gì để cập nhật.');
    Object.assign(g, set); await g.save();
    res.json({ ok: true });
  }));

  router.delete('/groups/:id', adminOnly, wrap(async (req, res) => {   // quản trị viên xóa nhóm
    if (!oid(req.params.id)) return fl(res, 'Không tìm thấy nhóm.', 404);
    await wipeGroup([req.params.id]); res.json({ ok: true });
  }));

  /* ===== Xin tham gia nhóm kiểu duyệt: nhắn cho chủ nhóm — dùng lại luồng "chờ duyệt" (grade -2). Đơn xin = POST /groups/:id/join ===== */

  /* ===== Lời mời (mtaginvite) ===== */
  router.get('/groups/:id/invitable', wrap(async (req, res) => {   // bạn bè có thể mời (chưa vào / chưa được mời)
    const L = await loadGroup(req, res); if (!L) return;
    if (!L.a.allowinvite) return fl(res, 'Bạn không có quyền mời vào nhóm này.', 403);
    const fs = await Friendship.find({ status: 'accepted', $or: [{ from: req.uid }, { to: req.uid }] }).select('from to');
    const ids = fs.map((f) => (String(f.from) === req.uid ? f.to : f.from));
    const [mem, inv] = await Promise.all([GroupMember.find({ group: L.g._id, user: { $in: ids } }).select('user'), GroupInvite.find({ group: L.g._id, user: { $in: ids } }).select('user')]);
    const skip = new Set([...mem, ...inv].map((x) => String(x.user)));
    const key = line(req.query.q).slice(0, 30), rx = key ? new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    const us = await User.find({ _id: { $in: ids.filter((i) => !skip.has(String(i))) }, ...(rx ? { name: rx } : {}) }).select('name username avatar').limit(60);
    res.json({ friends: us.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || '' })) });
  }));

  router.post('/groups/:id/invite', writeLimiter, wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    if (!L.a.allowinvite) return fl(res, 'Bạn không có quyền mời vào nhóm này.', 403);
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(oid).slice(0, 30);
    if (!ids.length) return fl(res, 'Hãy chọn ít nhất một người bạn.');
    let n = 0;
    for (const id of ids) {
      if (!(await areFriends(req.uid, id))) continue;                      // chỉ mời được bạn bè (như UCHome)
      if (await GroupMember.exists({ group: L.g._id, user: id })) continue;
      try { const inv = await GroupInvite.create({ group: L.g._id, user: id, from: req.uid }); n++; await N.add('group_invite', inv.id, id, req.uid); } catch (e) { if (e.code !== 11000) throw e; }
    }
    res.json({ ok: true, invited: n });
  }));

  router.get('/group-invites', wrap(async (req, res) => {
    const list = await GroupInvite.find({ user: req.uid }).sort({ createdAt: -1 }).limit(100).populate({ path: 'group', populate: { path: 'category', select: 'title' } }).populate('from', 'name');
    res.json({ invites: list.filter((i) => i.group && i.group.category && !i.group.closed).map((i) => ({ group: gView(i.group), from: i.from ? { id: i.from.id, name: i.from.name } : null, at: i.createdAt })) });
  }));
  router.post('/group-invites/:id/accept', writeLimiter, wrap(async (req, res) => {   // :id = id nhóm
    if (!oid(req.params.id)) return fl(res, 'Không tìm thấy lời mời.', 404);
    const inv = await GroupInvite.findOne({ group: req.params.id, user: req.uid });
    if (!inv) return fl(res, 'Lời mời không còn hiệu lực.', 404);
    const g = await Group.findById(req.params.id).populate('category');
    if (!g || !g.category || g.closed) { await GroupInvite.deleteOne({ _id: inv._id }); await N.remove('group_invite', inv._id, req.uid); return fl(res, 'Nhóm không còn tồn tại hoặc đã đóng.', 404); }
    if (!(await GroupMember.exists({ group: g._id, user: req.uid }))) {
      const max = maxIn(g.category);
      if (max && (await myCountIn(req.uid, g.category)) >= max) return fl(res, `Bạn chỉ được vào tối đa ${max} nhóm trong chuyên mục "${g.category.title}".`);
      await GroupMember.create({ group: g._id, user: req.uid, grade: 0 });   // được mời thì vào thẳng, không cần duyệt
      g.memberNum = await GroupMember.countDocuments({ group: g._id, grade: { $gte: -1 } }); await Group.updateOne({ _id: g._id }, { memberNum: g.memberNum });
    }
    await GroupInvite.deleteOne({ _id: inv._id });
    await N.remove('group_invite', inv._id, req.uid);                      // đã trả lời lời mời -> bỏ thông báo
    res.json({ group: gView(g) });
  }));
  router.delete('/group-invites/:id', wrap(async (req, res) => {   // từ chối một lời mời, hoặc :id = "all" để xóa hết
    if (req.params.id === 'all') { await GroupInvite.deleteMany({ user: req.uid }); await N.removeType(req.uid, 'group_invite'); }
    else if (oid(req.params.id)) { const inv = await GroupInvite.findOneAndDelete({ group: req.params.id, user: req.uid }); if (inv) await N.remove('group_invite', inv._id, req.uid); }
    res.json({ ok: true });
  }));

  /* ===== Chủ đề (thread) ===== */
  const tView = (t, me) => ({ id: t.id, subject: t.subject, author: t.author && t.author.id ? { id: t.author.id, name: t.author.name, avatar: t.author.avatar || '' } : { id: '', name: 'Người dùng đã xóa' },
    mine: !!t.author && String(t.author._id || t.author) === me, top: t.top, digest: t.digest, viewNum: t.viewNum, replyNum: t.replyNum,
    createdAt: t.createdAt, lastPost: t.lastPost, lastAuthor: t.lastAuthorName || '' });

  router.get('/groups/:id/threads', wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    if (!a.allowview) return res.json({ total: 0, page: 1, per: PAGE, threads: [], locked: true });
    const page = clamp(req.query.page, 1, 1000, 1), q = { group: g._id };
    if (req.query.digest === '1') q.digest = true;
    const key = line(req.query.q).slice(0, 40);
    if (key) q.subject = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [total, ts] = await Promise.all([Thread.countDocuments(q), Thread.find(q).sort({ top: -1, lastPost: -1 }).skip((page - 1) * PAGE).limit(PAGE).populate('author', 'name avatar')]);
    res.json({ total, page, per: PAGE, threads: ts.map((t) => tView(t, req.uid)) });
  }));

  router.post('/groups/:id/threads', writeLimiter, wrap(async (req, res) => {
    const L = await loadGroup(req, res); if (!L) return;
    const { g, a } = L;
    if (!a.allowview) return fl(res, 'Nhóm này chỉ cho thành viên xem.', 403);
    if (!a.allowthread) return fl(res, g.closed ? 'Nhóm đã bị đóng.' : 'Bạn cần là thành viên để đăng chủ đề.', 403);
    if (g.memberNum < catMin(g)) return fl(res, `Nhóm cần tối thiểu ${catMin(g)} thành viên mới được đăng chủ đề.`, 403);
    const subject = line(req.body.subject), text = clean(req.body.text), f = {};
    if (subject.length < 2 || subject.length > 80) f.subject = 'Tiêu đề cần 2–80 ký tự.';
    if (text.length < 2 || text.length > 5000) f.text = 'Nội dung cần 2–5000 ký tự.';
    if (Object.keys(f).length) return fl(res, 'Dữ liệu chưa hợp lệ.', 400, f);
    const me = await User.findById(req.uid).select('name');
    const t = await Thread.create({ group: g._id, author: req.uid, subject, lastAuthor: req.uid, lastAuthorName: me.name });
    await GroupPost.create({ thread: t._id, group: g._id, author: req.uid, isThread: true, text });
    await Group.updateOne({ _id: g._id }, { $inc: { threadNum: 1 } });
    res.status(201).json({ id: t.id });
  }));

  const loadThread = async (req, res) => {
    if (!oid(req.params.tid)) { fl(res, 'Không tìm thấy chủ đề.', 404); return null; }
    const t = await Thread.findById(req.params.tid).populate('author', 'name avatar');
    if (!t) { fl(res, 'Không tìm thấy chủ đề.', 404); return null; }
    const g = await Group.findById(t.group).populate('category');
    if (!g || !g.category) { fl(res, 'Không tìm thấy nhóm.', 404); return null; }
    const a = await access(req, g);
    if (g.closed && !a.sysAdmin) { fl(res, 'Nhóm này đã bị đóng.', 403); return null; }
    return { t, g, a };
  };
  const pView = (p, me, a) => ({ id: p.id, isThread: p.isThread, text: p.text, createdAt: p.createdAt, editedAt: p.editedAt || null, editedBy: p.editedBy || '',
    author: p.author && p.author.id ? { id: p.author.id, name: p.author.name, avatar: p.author.avatar || '' } : { id: '', name: 'Người dùng đã xóa' },
    mine: !!p.author && String(p.author._id || p.author) === me, canManage: a.grade >= 8, quote: p.quote && p.quote.pid ? { name: p.quote.name, text: p.quote.text } : null });

  router.get('/threads/:tid', wrap(async (req, res) => {
    const L = await loadThread(req, res); if (!L) return;
    const { t, g, a } = L;
    if (!a.allowview) return fl(res, 'Nhóm này chỉ cho thành viên xem.', 403);
    const page = clamp(req.query.page, 1, 1000, 1);
    const first = await GroupPost.findOne({ thread: t._id, isThread: true }).populate('author', 'name avatar');
    const per = PAGE;
    const rq = { thread: t._id, isThread: { $ne: true } };
    const posts = await GroupPost.find(rq).sort({ createdAt: 1 }).skip((page - 1) * per).limit(per).populate('author', 'name avatar');
    if (String(t.author && t.author._id) !== req.uid && page === 1) Thread.updateOne({ _id: t._id }, { $inc: { viewNum: 1 } }).catch(() => {});
    res.json({ thread: { ...tView(t, req.uid), viewNum: t.viewNum + 1 }, group: { id: g.id, name: g.name, category: g.category.title, closed: g.closed },
      content: first ? pView(first, req.uid, a) : null, posts: posts.map((p) => pView(p, req.uid, a)), total: t.replyNum, page, per,
      perms: { reply: !!a.allowpost && g.memberNum >= catMin(g), manager: a.grade >= 8, edit: a.grade >= 8 || String(t.author && t.author._id) === req.uid } });
  }));

  router.post('/threads/:tid/posts', writeLimiter, wrap(async (req, res) => {
    const L = await loadThread(req, res); if (!L) return;
    const { t, g, a } = L;
    if (!a.allowview) return fl(res, 'Nhóm này chỉ cho thành viên xem.', 403);
    if (!a.allowpost) return fl(res, g.closed ? 'Nhóm đã bị đóng.' : 'Bạn cần là thành viên để trả lời.', 403);
    if (g.memberNum < catMin(g)) return fl(res, `Nhóm cần tối thiểu ${catMin(g)} thành viên mới được trả lời.`, 403);
    const text = clean(req.body.text);
    if (text.length < 2 || text.length > 5000) return fl(res, 'Nội dung cần 2–5000 ký tự.', 400, { text: 'Nội dung cần 2–5000 ký tự.' });
    let quote;
    if (oid(S(req.body.quoteId))) {   // trả lời có trích dẫn (như "引用回复")
      const qp = await GroupPost.findOne({ _id: req.body.quoteId, thread: t._id, isThread: { $ne: true } }).populate('author', 'name avatar');
      if (qp) quote = { pid: qp.id, name: qp.author ? qp.author.name : 'Người dùng đã xóa', text: qp.text.slice(0, 150) };
    }
    const me = await User.findById(req.uid).select('name');
    const p = await GroupPost.create({ thread: t._id, group: g._id, author: req.uid, text, ...(quote ? { quote } : {}) });
    await N.add('thread_reply', t.id, String(t.author._id || t.author), req.uid);   // báo cho người mở chủ đề
    await Promise.all([Thread.updateOne({ _id: t._id }, { $inc: { replyNum: 1 }, lastPost: new Date(), lastAuthor: req.uid, lastAuthorName: me.name }), Group.updateOne({ _id: g._id }, { $inc: { postNum: 1 } })]);
    res.status(201).json({ id: p.id });
  }));

  // Sửa bài (chủ bài hoặc phó nhóm/chủ nhóm). Sửa bài mở đầu có thể kèm đổi tiêu đề.
  router.patch('/group-posts/:pid', wrap(async (req, res) => {
    if (!oid(req.params.pid)) return fl(res, 'Không tìm thấy bài viết.', 404);
    const p = await GroupPost.findById(req.params.pid);
    if (!p) return fl(res, 'Không tìm thấy bài viết.', 404);
    const g = await Group.findById(p.group).populate('category');
    if (!g) return fl(res, 'Không tìm thấy nhóm.', 404);
    const a = await access(req, g);
    if (g.closed && !a.sysAdmin) return fl(res, 'Nhóm này đã bị đóng.', 403);
    if (!a.allowview) return fl(res, 'Bạn không còn quyền xem nhóm này.', 403);   // đã rời nhóm / bị cấm: không sửa bài cũ trong nhóm kín
    if (a.grade < 8 && String(p.author) !== req.uid) return fl(res, 'Bạn không có quyền sửa bài này.', 403);
    const text = clean(req.body.text);
    if (text.length < 2 || text.length > 5000) return fl(res, 'Nội dung cần 2–5000 ký tự.', 400, { text: 'Nội dung cần 2–5000 ký tự.' });
    if (p.isThread && req.body.subject !== undefined) {
      const sj = line(req.body.subject);
      if (sj.length < 2 || sj.length > 80) return fl(res, 'Tiêu đề cần 2–80 ký tự.', 400, { subject: 'Tiêu đề cần 2–80 ký tự.' });
      await Thread.updateOne({ _id: p.thread }, { subject: sj });
    }
    const me = await User.findById(req.uid).select('name');
    p.text = text; p.editedAt = new Date(); p.editedBy = me.name; await p.save();   // thread_edit_trail
    res.json({ ok: true });
  }));

  // Xóa bài: bài trả lời (deleteposts) hoặc cả chủ đề nếu là bài mở đầu (deletethreads)
  const delThreads = async (ts) => {
    for (const t of ts) {
      const n = await GroupPost.countDocuments({ thread: t._id, isThread: { $ne: true } });
      await Promise.all([GroupPost.deleteMany({ thread: t._id }), Thread.deleteOne({ _id: t._id }), Group.updateOne({ _id: t.group }, { $inc: { threadNum: -1, postNum: -n } })]);
    }
  };
  router.delete('/group-posts/:pid', wrap(async (req, res) => {
    if (!oid(req.params.pid)) return fl(res, 'Không tìm thấy bài viết.', 404);
    const p = await GroupPost.findById(req.params.pid);
    if (!p) return fl(res, 'Không tìm thấy bài viết.', 404);
    const g = await Group.findById(p.group);
    if (!g) return fl(res, 'Không tìm thấy nhóm.', 404);
    const a = await access(req, g);
    if (!a.allowview) return fl(res, 'Bạn không còn quyền xem nhóm này.', 403);   // đã rời nhóm / bị cấm: không xóa bài cũ trong nhóm kín
    if (a.grade < 8 && String(p.author) !== req.uid) return fl(res, 'Bạn không có quyền xóa bài này.', 403);
    if (p.isThread) { const t = await Thread.findById(p.thread); if (t) await delThreads([t]); return res.json({ ok: true, threadDeleted: true }); }
    await GroupPost.deleteOne({ _id: p._id });
    const last = await GroupPost.findOne({ thread: p.thread }).sort({ createdAt: -1 }).populate('author', 'name avatar');
    await Promise.all([Thread.updateOne({ _id: p.thread }, { $inc: { replyNum: -1 }, ...(last ? { lastPost: last.createdAt, lastAuthor: last.author && last.author._id, lastAuthorName: last.author ? last.author.name : '' } : {}) }),
      Group.updateOne({ _id: g._id }, { $inc: { postNum: -1 } })]);
    res.json({ ok: true });
  }));

  // Ghim / tinh hoa (chỉ phó nhóm trở lên) – body {top?: bool, digest?: bool}
  router.patch('/threads/:tid', wrap(async (req, res) => {
    const L = await loadThread(req, res); if (!L) return;
    if (L.a.grade < 8) return fl(res, 'Chỉ phó nhóm / chủ nhóm mới dùng được chức năng này.', 403);
    const set = {};
    if (req.body.top !== undefined) set.top = req.body.top === true;
    if (req.body.digest !== undefined) set.digest = req.body.digest === true;
    if (!Object.keys(set).length) return fl(res, 'Không có gì để cập nhật.');
    await Thread.updateOne({ _id: L.t._id }, set); res.json({ ok: true });
  }));
};
