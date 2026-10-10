/* /me + cài đặt tài khoản */
const { bcrypt, User, ProfileField, S, pwErr, wrap, fail, auth, revokeAllSessions, newLogin, setCookie, completeTask, ageOf, pub, limiter, issueCode } = require('./shared');

module.exports = (router) => {
router.get('/me', auth, wrap(async (req, res) => {
  const u = await User.findById(req.uid);
  const invFx = u && u.magicFx && u.magicFx.get('invisible');
  if (u && !(invFx && invFx.exp > Date.now()))
    await User.updateOne({ _id: u._id, $or: [{ lastSeen: null }, { lastSeen: { $lt: new Date(Date.now() - 2 * 60 * 1000) } }] }, { lastSeen: new Date() });
  // Token cũ chưa có sid -> đổi sang token có sid để đăng xuất đồng bộ có hiệu lực
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  const fresh = req.sid ? null : await newLogin(req, u);
  if (fresh) setCookie(res, fresh);
  res.json({ user: pub(u), ...(fresh ? { token: fresh } : {}) });
}));

/* ---------- Cài đặt tài khoản (dùng được cả khi chưa xác thực email) ---------- */
router.post('/settings/password', auth, wrap(async (req, res) => {
  const cur = S(req.body.current), nw = S(req.body.new);
  const u = await User.findById(req.uid).select('+password');
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  if (u.noPassword) return fail(res, 'Tài khoản này tạo bằng Discord nên chưa có mật khẩu hiện tại. Hãy dùng "Đặt mật khẩu" (mã gửi qua email) trong Cài đặt.');
  if (!await bcrypt.compare(cur, u.password)) return fail(res, 'Mật khẩu hiện tại chưa đúng.', { current: 'Mật khẩu hiện tại chưa đúng.' });
  const e = pwErr(nw);
  if (e) return fail(res, e, { new: e });
  if (cur === nw) return fail(res, 'Mật khẩu mới phải khác mật khẩu hiện tại.', { new: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
  u.password = await bcrypt.hash(nw, 12);
  await u.save();
  await revokeAllSessions(req.uid);   // đổi mật khẩu -> đá MỌI phiên (kể cả thiết bị khác đang bị chiếm) ra, đăng nhập lại
  res.json({ ok: true });
}));

router.patch('/settings', auth, wrap(async (req, res) => {
  const name = S(req.body.name).trim(), phone = S(req.body.phone).replace(/[\s.-]/g, ''), bd = S(req.body.birthday).trim();
  const location = S(req.body.location).trim(), bio = S(req.body.bio).trim(), un = S(req.body.username).trim().toLowerCase();
  const f = {};
  if (un && !/^[a-z0-9._]{3,20}$/.test(un)) f.username = 'Tên đăng nhập 3–20 ký tự: chữ thường, số, dấu chấm hoặc gạch dưới.';
  if (name.length < 2 || name.length > 30) f.name = 'Tên hiển thị cần 2–30 ký tự.';
  if (phone && !/^\+?\d{9,13}$/.test(phone)) f.phone = 'Số điện thoại chưa đúng (9–13 chữ số).';
  if (location.length > 50) f.location = 'Nơi sống tối đa 50 ký tự.';
  if (bio.length > 150) f.bio = 'Giới thiệu tối đa 150 ký tự.';
  let birthday;
  if (bd) {
    birthday = /^\d{4}-\d{2}-\d{2}$/.test(bd) ? new Date(bd + 'T00:00:00Z') : null;
    const a = birthday && !isNaN(birthday) ? ageOf(birthday) : -1;
    if (a < 13 || a > 120) f.birthday = 'Ngày sinh không hợp lệ (cần từ 13 tuổi trở lên).';
  }
  const u = await User.findById(req.uid);
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  // Hồ sơ mở rộng: chỉ nhận giá trị cho các trường đã được quản trị viên định nghĩa; trường không gửi lên thì giữ nguyên
  const defs = await ProfileField.find().sort({ displayorder: 1, _id: 1 });
  const sent = req.body.extra && typeof req.body.extra === 'object' && !Array.isArray(req.body.extra) ? req.body.extra : {};
  const extra = {};
  for (const d of defs) {
    const key = String(d._id), old = u.extra ? u.extra.get(key) || '' : '';
    let v = Object.prototype.hasOwnProperty.call(sent, key) ? S(sent[key]).replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : old;
    if (v.length > d.maxsize) f['x_' + key] = `${d.title} tối đa ${d.maxsize} ký tự.`;
    else if (v && d.formtype === 'select' && !d.choice.includes(v)) f['x_' + key] = `Hãy chọn một giá trị hợp lệ cho "${d.title}".`;
    else if (!v && d.required) f['x_' + key] = `Vui lòng điền "${d.title}".`;
    if (v) extra[key] = v;
  }
  if (Object.keys(f).length) return fail(res, 'Dữ liệu chưa hợp lệ.', f);
  u.extra = Object.keys(extra).length ? new Map(Object.entries(extra)) : undefined;
  if (un && un !== u.username) {
    if (await User.exists({ username: un, _id: { $ne: u._id } })) return fail(res, 'Dữ liệu chưa hợp lệ.', { username: 'Tên đăng nhập này đã có người dùng.' }, 409);
    u.username = un;
  }
  Object.assign(u, { name, phone, location, bio, birthday: bd ? birthday : undefined });
  await u.save();
  if (bio || location) completeTask(req.uid, 'profile');   // nhiệm vụ hoàn thiện hồ sơ
  res.json({ user: pub(u) });
}));

// Gửi mã xác thực cho chính tài khoản đang đăng nhập
router.post('/settings/send-code', auth, limiter, wrap(async (req, res) => {
  const u = await User.findById(req.uid);
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  if (u.verified) return res.json({ ok: true, verified: true });
  await issueCode(res, u);
}));
};
