/* Đăng ký / đăng nhập / xác thực email / quên mật khẩu / đăng xuất */
const { bcrypt, jwt, User, Invite, crypto, sendMail, N, social, RX, S, pwErr, wrap, fail, readToken, revokeSession, revokeAllSessions, newLogin, setCookie, clearCookie, award, ADMINS, pub, limiter, hashCode, same, issueCode } = require('./shared');

module.exports = (router) => {
/* ---------- Auth ---------- */
/* Đăng ký không còn ô tên hiển thị: name mặc định = tên đăng nhập (giữ hoa/thường), đổi sau trong Cài đặt */
router.post('/auth/register', limiter, wrap(async (req, res) => {
  const { siteGet } = require('../aconfig');
  if ((await siteGet('register_open', '1')) !== '1') return fail(res, 'Hiện tại website tạm đóng đăng ký.');
  if (await require('../session').ipBanned(req)) return fail(res, 'Địa chỉ IP của bạn đã bị chặn.', null, 403);
  if ((await siteGet('invite_only', '0')) === '1' && !S(req.body.invite).trim()) return fail(res, 'Hiện tại chỉ đăng ký được bằng mã mời.', { invite: 'Cần mã mời để đăng ký.' });
  const name = S(req.body.name).trim() || S(req.body.username).trim(), email = S(req.body.email).trim().toLowerCase(), pw = S(req.body.password), username = S(req.body.username).trim().toLowerCase();
  const f = {};
  if (name.length < 2 || name.length > 30) f.name = 'Tên hiển thị cần 2–30 ký tự.';
  if (!/^[a-z0-9._]{3,20}$/.test(username)) f.username = 'Tên đăng nhập 3–20 ký tự: chữ, số, dấu chấm hoặc gạch dưới.';
  if (!RX.test(email) || email.length > 254) f.email = 'Email chưa đúng định dạng.';
  if (pwErr(pw)) f.password = pwErr(pw);
  const invite = S(req.body.invite).trim().toLowerCase();   // mã mời (tùy chọn): kết bạn tự động với người mời sau khi xác thực email
  if (invite && (!social.CODE_RX.test(invite) || !(await Invite.exists({ code: invite, usedBy: null })))) f.invite = 'Mã mời không hợp lệ hoặc đã được dùng.';
  if (Object.keys(f).length) return fail(res, 'Dữ liệu chưa hợp lệ.', f);
  let u = await User.findOne({ email });
  if (u && u.verified) return fail(res, 'Email này đã được đăng ký.', { email: 'Email này đã được đăng ký.' }, 409);
  if (ADMINS.includes(email)) return fail(res, 'Email này không được dùng để đăng ký.', { email: 'Email này không được dùng để đăng ký.' }, 403);
  if (!u) {
    if (await User.exists({ username })) return fail(res, 'Dữ liệu chưa hợp lệ.', { username: 'Tên đăng nhập này đã có người dùng.' }, 409);
    u = await User.create({ name, email, username, password: await bcrypt.hash(pw, 12), verified: false, inviteCode: invite || undefined });
  }
  // Email đã tồn tại nhưng chưa xác thực: KHÔNG ghi đè mật khẩu / tên đăng nhập (chống chiếm tài khoản),
  // chỉ gửi lại mã xác thực. Muốn đổi thông tin thì xác thực email trước, rồi sửa trong Cài đặt.
  await issueCode(res, u);
}));

router.post('/auth/login', limiter, wrap(async (req, res) => {
  if (await require('../session').ipBanned(req)) return fail(res, 'Địa chỉ IP của bạn đã bị chặn.', null, 403);
  const id = S(req.body.id).trim().toLowerCase(), pw = S(req.body.password);
  if (!id || !pw) return fail(res, 'Vui lòng nhập tên đăng nhập và mật khẩu.');
  let u = await User.findOne({ $or: [{ email: id }, { username: id }] }).select('+password +totpSecret'), by = u ? (u.email === id ? 'email' : 'tên đăng nhập') : '', many = false;
  if (!u && !id.includes('@')) {                                  // tài khoản cũ có thể lưu username còn chữ hoa/khoảng trắng (trước khi schema có lowercase+trim) -> so khớp không phân biệt hoa thường
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const legacy = await User.find({ username: new RegExp('^\\s*' + esc + '\\s*$', 'i') }).select('+password').limit(2);
    if (legacy.length === 1) { u = legacy[0]; by = 'tên đăng nhập'; }
  }
  if (!u && !id.includes('@')) {                                  // cho phép gõ tên hiển thị, nhưng chỉ khi đúng một tài khoản mang tên đó (không đoán mò)
    const byName = await User.find({ name: new RegExp('^' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).select('+password').limit(2);
    if (byName.length === 1) { u = byName[0]; by = 'tên hiển thị'; } else many = byName.length > 1;
  }
  const ok = u ? await bcrypt.compare(pw, u.password)
    : await bcrypt.compare(pw, '$2a$12$XVJcOY5ENHbUlnlxSwtLa.vhSM8ZONHeUQHNe3iWsuAbM.0bDlQlS').then(() => false);
  // user không tồn tại vẫn chạy bcrypt với hash giả -> thời gian response hằng định, không đoán được tài khoản nào tồn tại qua timing
  if (process.env.LOGIN_DEBUG !== '1') console.log('LOGIN', JSON.stringify({ ok }));   // không ghi id/found: ai đọc log là enumerate được tài khoản
  else console.log('LOGIN', JSON.stringify({ id, found: !!u, by, many, ok }));
  if (ok && u.banned) return fail(res, 'Tài khoản của bạn đã bị khóa.' + (u.banReason ? ' Lý do: ' + u.banReason : ''), null, 403);
  if (ok) {
    if (u.totpEnabled && u.totpSecret) {
      // Tài khoản đã bật 2FA: CHƯA cấp token đăng nhập thật. Trả token TẠM sống 5 phút để hoàn tất bước nhập mã 2FA.
      // Token tạm mang purpose:'totp' nên không dùng được cho bất kỳ API nào khác (session.check từ chối).
      const totpToken = jwt.sign({ id: u.id, purpose: 'totp' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      return res.json({ needTotp: true, totpToken });
    }
    await User.updateOne({ _id: u._id }, { lastLogin: new Date(), lastSeen: new Date() }); award(u._id, 'login');
    const token = await newLogin(req, u);
    setCookie(res, token);   // token vào cookie HttpOnly (JS không đọc được); vẫn trả trong body cho client cũ
    return res.json({ token, user: pub(u) });
  }
  // LOGIN_DEBUG=1 (chỉ bật khi cần chẩn đoán): báo rõ sai ở tên hay ở mật khẩu. Tắt đi sau khi xong vì cách này lộ việc tên nào đã tồn tại.
  if (process.env.LOGIN_DEBUG === '1') {
    if (many) return fail(res, `[Tên] Có nhiều tài khoản trùng tên hiển thị "${id}". Hãy đăng nhập bằng email hoặc tên đăng nhập.`, null, 401);
    if (!u) return fail(res, `[Tên] Không tìm thấy tài khoản nào có email / tên đăng nhập / tên hiển thị là "${id}".`, null, 401);
    return fail(res, `[Mật khẩu] Tìm thấy tài khoản (khớp theo ${by}, tên đăng nhập: ${u.username}) nhưng mật khẩu không khớp.`, null, 401);
  }
  // Tên hiển thị không duy nhất: nếu trùng nhiều tài khoản thì nói rõ để người dùng biết dùng tên đăng nhập / email (tên hiển thị vốn công khai nên không lộ thêm gì)
  if (many) return fail(res, 'Có nhiều tài khoản trùng tên hiển thị này. Hãy đăng nhập bằng tên đăng nhập hoặc email.', null, 401);
  fail(res, 'Sai tên đăng nhập / email hoặc mật khẩu.', null, 401);
}));

router.post('/auth/verify', limiter, wrap(async (req, res) => {
  const email = S(req.body.email).trim().toLowerCase(), code = S(req.body.code).trim();
  const bad = () => fail(res, 'Mã không đúng hoặc đã hết hạn.');
  const u = await User.findOne({ email }).select('+vCode');
  if (!u || u.verified || !u.vCode || !u.vExp || u.vExp < new Date()) return bad();
  if (u.vTries >= 5) return fail(res, 'Bạn đã nhập sai quá nhiều lần. Hãy gửi lại mã mới.', null, 429);
  if (!/^\d{10}$/.test(code) || !same(u.vCode, hashCode(u, code))) { u.vTries += 1; await u.save(); return bad(); }
  Object.assign(u, { verified: true, vCode: undefined, vExp: undefined, vTries: 0 });
  await u.save();
  try { await social.applyInvite(u, N); } catch (e) { console.error('Invite:', e.message); }   // không để lỗi mã mời chặn việc đăng nhập
  const token = await newLogin(req, u);
  setCookie(res, token);
  res.json({ token, user: pub(u) });
}));

/* ---------- Quên mật khẩu: gửi mã 10 số qua email -> nhập mã + mật khẩu mới ---------- */
router.post('/auth/forgot', limiter, wrap(async (req, res) => {
  const email = S(req.body.email).trim().toLowerCase();
  if (!RX.test(email)) return fail(res, 'Email chưa đúng định dạng.', { email: 'Email chưa đúng định dạng.' });
  const u = await User.findOne({ email });
  // Luôn trả ok để không lộ email nào đã đăng ký
  if (u && !(u.rSentAt && Date.now() - u.rSentAt < 60 * 1000)) {
    const code = String(crypto.randomInt(0, 1e10)).padStart(10, '0');
    Object.assign(u, { rCode: hashCode(u, 'r' + code), rExp: new Date(Date.now() + 15 * 60 * 1000), rTries: 0, rSentAt: new Date() });
    await u.save();
    try { await sendMail(u.email, u.name, code, true); } catch (e) { console.error('Mail:', e.message); }
  }
  res.json({ ok: true });
}));

router.post('/auth/reset', limiter, wrap(async (req, res) => {
  const email = S(req.body.email).trim().toLowerCase(), code = S(req.body.code).trim(), pw = S(req.body.password);
  if (pwErr(pw)) return fail(res, 'Dữ liệu chưa hợp lệ.', { password: pwErr(pw) });
  const bad = () => fail(res, 'Mã không đúng hoặc đã hết hạn.');
  const u = await User.findOne({ email }).select('+rCode +password');
  if (!u || !u.rCode || !u.rExp || u.rExp < new Date()) return bad();
  if (u.rTries >= 5) return fail(res, 'Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.', null, 429);
  if (!/^\d{10}$/.test(code) || !same(u.rCode, hashCode(u, 'r' + code))) { u.rTries += 1; await u.save(); return bad(); }
  // Nhận được mã qua email nghĩa là chủ email -> đồng thời coi như đã xác thực email
  Object.assign(u, { password: await bcrypt.hash(pw, 12), verified: true, noPassword: false, rCode: undefined, rExp: undefined, rTries: 0 });
  await u.save();
  await revokeAllSessions(u._id);   // quên mật khẩu = có thể tài khoản đã bị chiếm -> đá mọi phiên cũ ra
  try { await social.applyInvite(u, N); } catch (e) { console.error('Invite:', e.message); }
  res.json({ ok: true });
}));

router.post('/auth/resend', limiter, wrap(async (req, res) => {
  const u = await User.findOne({ email: S(req.body.email).trim().toLowerCase() });
  if (!u || u.verified) return res.json({ ok: true });          // không tiết lộ email nào đã đăng ký
  await issueCode(res, u);
}));

/* ---------- Đăng xuất: thu hồi cả phiên (mọi domain dùng chung sid). Idempotent: token hỏng/hết hạn cũng trả ok ---------- */
router.post('/auth/logout', wrap(async (req, res) => {
  const p = await readToken(req);
  if (p && p.sid) await revokeSession(p.sid);
  clearCookie(res);
  res.json({ ok: true });
}));
};
