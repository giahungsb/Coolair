/* Xác thực 2 bước (2FA) */
const { bcrypt, jwt, User, wrap, fail, auth, newLogin, setCookie, award, pub, totpLimiter, hashCode, same } = require('./shared');

module.exports = (router) => {
/* ---------- Xác thực 2 bước (2FA) kiểu Google Authenticator ---------- */
const totp = require('../totp');
// Đốt 1 mã dự phòng (dùng 1 lần): trả true nếu mã khớp và đã xóa khỏi DB
const useBackupCode = async (u, code) => {
  code = String(code || '').toLowerCase().replace(/[\s-]/g, '');
  if (!/^[0-9a-f]{8}$/.test(code) || !u.totpBackup || !u.totpBackup.length) return false;
  const h = hashCode(u, 'b' + code);
  if (!u.totpBackup.some((x) => same(x, h))) return false;
  await User.updateOne({ _id: u._id }, { $pull: { totpBackup: h } });   // xóa nguyên tử: 2 request song song không dùng chung 1 mã được
  return true;
};
// Bước 2 của đăng nhập: nhập mã 6 số từ app Authenticator (hoặc 1 mã dự phòng) + token tạm -> token đăng nhập thật
router.post('/auth/login/totp', totpLimiter, wrap(async (req, res) => {
  let p = null;
  try { p = jwt.verify(String(req.body.totpToken || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch {}
  if (!p || p.purpose !== 'totp' || !p.id) return fail(res, 'Phiên xác thực đã hết hạn. Hãy đăng nhập lại từ đầu.', null, 401);
  const u = await User.findById(p.id).select('+totpSecret +totpBackup');
  if (!u) return fail(res, 'Tài khoản không tồn tại.', null, 401);
  if (u.banned) return fail(res, 'Tài khoản của bạn đã bị khóa.', null, 403);
  if (!u.totpEnabled || !u.totpSecret) return fail(res, 'Tài khoản này chưa bật xác thực 2 bước.', null, 400);
  const code = String(req.body.code || '');
  let ok2 = false;
  try { ok2 = totp.verify(totp.dec(u.totpSecret), code); } catch { ok2 = false; }
  if (!ok2) ok2 = await useBackupCode(u, code);
  if (!ok2) return fail(res, 'Mã xác thực chưa đúng.', null, 401);
  await User.updateOne({ _id: u._id }, { lastLogin: new Date(), lastSeen: new Date() }); award(u._id, 'login');
  const token = await newLogin(req, u);
  setCookie(res, token);
  res.json({ token, user: pub(u) });
}));
// Bắt đầu bật 2FA: tạo secret mới, trả QR + mã bí mật để quét bằng app (chưa bật cho tới khi nhập mã xác nhận)
router.post('/auth/totp/setup', auth, wrap(async (req, res) => {
  const u = await User.findById(req.uid);
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  if (u.totpEnabled) return fail(res, 'Tài khoản đã bật xác thực 2 bước rồi.');
  const secret = totp.genSecret(), url = totp.otpauthUrl(secret, u.email);
  await User.updateOne({ _id: u._id }, { totpSecret: totp.enc(secret), totpEnabled: false });
  res.json({ qr: await totp.qrDataUrl(url), secret, otpauth: url });
}));
// Xác nhận bật: nhập đúng mã 6 số hiện tại trên app -> bật + cấp 8 mã dự phòng (chỉ hiện 1 lần duy nhất)
router.post('/auth/totp/enable', auth, totpLimiter, wrap(async (req, res) => {
  const u = await User.findById(req.uid).select('+totpSecret');
  if (!u || !u.totpSecret) return fail(res, 'Hãy bấm "Bật xác thực 2 bước" để lấy mã QR trước.');
  if (u.totpEnabled) return fail(res, 'Tài khoản đã bật xác thực 2 bước rồi.');
  let ok2 = false;
  try { ok2 = totp.verify(totp.dec(u.totpSecret), String(req.body.code || '')); } catch { ok2 = false; }
  if (!ok2) return fail(res, 'Mã chưa đúng. Kiểm tra giờ trên điện thoại có chính xác không.', null, 401);
  const codes = totp.genBackupCodes();
  await User.updateOne({ _id: u._id }, { totpEnabled: true, totpEnabledAt: new Date(), totpBackup: codes.map((c) => hashCode(u, 'b' + c)) });
  res.json({ ok: true, backupCodes: codes });
}));
// Tắt 2FA: cần mật khẩu + mã 2FA (hoặc 1 mã dự phòng) để kẻ chiếm phiên không tắt lén được
router.post('/auth/totp/disable', auth, totpLimiter, wrap(async (req, res) => {
  const u = await User.findById(req.uid).select('+password +totpSecret +totpBackup');
  if (!u || !u.totpEnabled) return fail(res, 'Tài khoản chưa bật xác thực 2 bước.');
  if (!await bcrypt.compare(String(req.body.password || ''), u.password)) return fail(res, 'Mật khẩu chưa đúng.', { password: 'Mật khẩu chưa đúng.' });
  const code = String(req.body.code || '');
  let ok2 = false;
  try { ok2 = totp.verify(totp.dec(u.totpSecret), code); } catch { ok2 = false; }
  if (!ok2) ok2 = await useBackupCode(u, code);
  if (!ok2) return fail(res, 'Mã xác thực chưa đúng.', null, 401);
  await User.updateOne({ _id: u._id }, { $unset: { totpSecret: 1, totpEnabledAt: 1 }, totpEnabled: false, totpBackup: [] });
  res.json({ ok: true });
}));
// Tạo lại 8 mã dự phòng mới (mã cũ hết hiệu lực): cần nhập mã 2FA hiện tại
router.post('/auth/totp/backup-codes', auth, totpLimiter, wrap(async (req, res) => {
  const u = await User.findById(req.uid).select('+totpSecret');
  if (!u || !u.totpEnabled || !u.totpSecret) return fail(res, 'Tài khoản chưa bật xác thực 2 bước.');
  let ok2 = false;
  try { ok2 = totp.verify(totp.dec(u.totpSecret), String(req.body.code || '')); } catch { ok2 = false; }
  if (!ok2) return fail(res, 'Mã xác thực chưa đúng.', null, 401);
  const codes = totp.genBackupCodes();
  await User.updateOne({ _id: u._id }, { totpBackup: codes.map((c) => hashCode(u, 'b' + c)) });
  res.json({ ok: true, backupCodes: codes });
}));
};
