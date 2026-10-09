/* Trường hồ sơ tùy chỉnh (profilefield) */
const { isValidObjectId, User, ProfileField, S, wrap, fail, auth, isAdmin } = require('./shared');
const { alog } = require('../aconfig');

module.exports = (router) => {
/* ---------- Hồ sơ mở rộng: trường tùy chỉnh (profilefield của UCHome) ---------- */
const pfView = (d) => ({ id: d.id, title: d.title, note: d.note || '', formtype: d.formtype, maxsize: d.maxsize, required: !!d.required,
  invisible: !!d.invisible, allowsearch: !!d.allowsearch, choice: d.choice || [], displayorder: d.displayorder || 0 });
const PF_MAX = 30;
router.get('/profile-fields', auth, wrap(async (req, res) => {         // mọi người dùng đều cần danh sách này để hiển thị form trong Cài đặt
  res.json({ fields: (await ProfileField.find().sort({ displayorder: 1, _id: 1 })).map(pfView) });
}));
const adminOnly = wrap(async (req, res, next) => {
  const u = await User.findById(req.uid).select('email verified');
  // verified: chặn chiếm quyền admin bằng cách đăng ký email admin rồi dùng ngay khi chưa xác thực
  if (!u || !isAdmin(u) || u.verified === false) return fail(res, 'Chỉ quản trị viên mới dùng được chức năng này.', null, 403);
  next();
});
const pfInput = (b) => {          // validate dữ liệu định nghĩa trường (như admincp_profilefield.php)
  const f = {}, title = S(b.title).trim(), note = S(b.note).trim(), formtype = S(b.formtype) === 'select' ? 'select' : 'text';
  let maxsize = parseInt(b.maxsize, 10); if (!(maxsize >= 1 && maxsize <= 255)) maxsize = 50;
  const choice = formtype === 'select' ? [...new Set(S(b.choice).split(/\r?\n/).map((x) => x.trim()).filter(Boolean))] : [];
  if (!title || title.length > 50) f.title = 'Tên trường cần 1–50 ký tự.';
  if (note.length > 100) f.note = 'Mô tả tối đa 100 ký tự.';
  if (formtype === 'select' && (choice.length < 1 || choice.length > 50)) f.choice = 'Nhập 1–50 lựa chọn, mỗi dòng một giá trị.';
  if (choice.some((x) => x.length > maxsize)) f.choice = `Mỗi lựa chọn tối đa ${maxsize} ký tự (bằng số ký tự tối đa của trường).`;
  const displayorder = Math.max(-9999, Math.min(9999, parseInt(b.displayorder, 10) || 0));
  return { f, data: { title, note, formtype, maxsize, choice, displayorder, required: !!b.required, invisible: !!b.invisible, allowsearch: !!b.allowsearch } };
};
router.post('/admin/profile-fields', auth, adminOnly, wrap(async (req, res) => {
  const { f, data } = pfInput(req.body);
  if (Object.keys(f).length) return fail(res, 'Dữ liệu chưa hợp lệ.', f);
  if (await ProfileField.countDocuments() >= PF_MAX) return fail(res, `Tối đa ${PF_MAX} trường hồ sơ.`);
  const created = await ProfileField.create(data);
  alog(req.uid, 'pfield_add', data.title, `kiểu ${data.formtype}`);
  res.status(201).json({ field: pfView(created) });
}));
router.put('/admin/profile-fields/order', auth, adminOnly, wrap(async (req, res) => {   // cập nhật thứ tự hàng loạt: {order: {<id>: số}}
  const o = req.body.order && typeof req.body.order === 'object' ? req.body.order : {};
  const ops = Object.entries(o).filter(([id]) => isValidObjectId(id)).map(([id, n]) => ({
    updateOne: { filter: { _id: id }, update: { displayorder: Math.max(-9999, Math.min(9999, parseInt(n, 10) || 0)) } } }));
  if (ops.length) await ProfileField.bulkWrite(ops);
  if (ops.length) alog(req.uid, 'pfield_order', ops.length + ' trường', 'sắp xếp lại thứ tự hiển thị');
  res.json({ fields: (await ProfileField.find().sort({ displayorder: 1, _id: 1 })).map(pfView) });
}));
router.patch('/admin/profile-fields/:id', auth, adminOnly, wrap(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 'Không tìm thấy trường.', null, 404);
  const { f, data } = pfInput(req.body);
  if (Object.keys(f).length) return fail(res, 'Dữ liệu chưa hợp lệ.', f);
  const d = await ProfileField.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (d) alog(req.uid, 'pfield_edit', d.title, `kiểu ${data.formtype}`);
  d ? res.json({ field: pfView(d) }) : fail(res, 'Không tìm thấy trường.', null, 404);
}));
router.delete('/admin/profile-fields/:id', auth, adminOnly, wrap(async (req, res) => {   // xóa trường + xóa giá trị của mọi người dùng (như deleteprofilefield)
  if (!isValidObjectId(req.params.id)) return fail(res, 'Không tìm thấy trường.', null, 404);
  const d = await ProfileField.findByIdAndDelete(req.params.id);
  if (!d) return fail(res, 'Không tìm thấy trường.', null, 404);
  await User.updateMany({ ['extra.' + d.id]: { $exists: true } }, { $unset: { ['extra.' + d.id]: 1 } });
  alog(req.uid, 'pfield_del', d.title, 'xóa trường + dữ liệu của mọi người dùng');
  res.json({ ok: true });
}));
};
