/* Đăng nhập một lần giữa domain chính và các domain phụ (cùng một backend + cùng MongoDB + cùng JWT_SECRET).
   Token nằm trong localStorage của từng domain nên domain phụ không tự thấy được phiên của domain chính. Luồng:
   1) Domain phụ chưa có token -> chuyển hướng sang  <chính>/?sso_req=<domain phụ>
   2) Trang domain chính: nếu đã đăng nhập thì POST /sso/issue -> nhận mã dùng 1 lần; chưa thì nhận "none"; rồi chuyển hướng về <phụ>/#sso=<mã|none>
   3) Domain phụ POST /sso/exchange {mã} -> nhận token của chính mình và vào luôn.
   Mã đặt ở phần #hash của URL nên không bao giờ gửi tới server/log/Referer. */
const crypto = require('crypto'), rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, SsoCode } = require('./models');
const { check } = require('./session');

const TTL = 60 * 1000;
// "coolair.vn" hoặc "https://coolair.vn/" -> "https://coolair.vn". Chỉ nhận https (http chỉ cho localhost để chạy thử).
const norm = (v) => {
  v = String(v || '').trim();
  if (!v) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.origin : '';
  } catch { return ''; }
};
const conf = () => {
  const main = norm(process.env.SSO_MAIN_ORIGIN);
  const allowed = new Set((process.env.SSO_ALLOWED_ORIGINS || '').split(',').map(norm).filter(Boolean));
  allowed.delete(main);
  return { main, allowed };
};
// Domain mà request này đang đi vào. Origin do trình duyệt đặt (JS không giả được); GET cùng domain không có Origin nên dùng Host.
const here = (req) => norm(req.headers.origin) || norm(`${req.protocol}://${req.get('host')}`);
const sha = (c) => crypto.createHash('sha256').update(c).digest('hex');

module.exports = (router, { wrap, fail, S, pub, sign, setCookie }) => {
  const lim = rateLimit({ store: rlStore('sso.lim'), windowMs: 5 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Thử quá nhiều lần, vui lòng đợi ít phút.' } });

  // Frontend hỏi: domain này có tham gia SSO không, và domain chính là gì
  router.get('/sso/info', wrap(async (req, res) => {
    const { main, allowed } = conf(), h = here(req);
    if (!main || (h !== main && !allowed.has(h))) return res.json({ enabled: false });
    res.json({ enabled: true, main, isMain: h === main });
  }));

  // Chạy trên domain chính: có đăng nhập -> cấp mã; không -> báo "none". Trả về URL để chuyển hướng về domain phụ.
  router.post('/sso/issue', lim, wrap(async (req, res) => {
    const { main, allowed } = conf(), target = norm(S(req.body.origin));
    if (!main) return fail(res, 'Chưa bật đăng nhập một lần.', null, 404);
    if (here(req) !== main) return fail(res, 'Chỉ domain chính mới cấp được mã.', null, 403);
    if (!target || !allowed.has(target)) return fail(res, 'Domain này không nằm trong danh sách được phép.');   // chặn chuyển hướng tới domain lạ
    const p = await check(req);   // token hỏng / hết hạn / phiên đã đăng xuất -> coi như chưa đăng nhập
    const uid = p && (await User.exists({ _id: p.id, banned: { $ne: true } })) ? p.id : null;
    if (!uid) return res.json({ url: target + '/#sso=none' });
    const code = crypto.randomBytes(32).toString('hex');
    await SsoCode.create({ hash: sha(code), user: uid, origin: target, sid: p.sid || undefined });
    res.json({ url: target + '/#sso=' + code });
  }));

  // Chạy trên domain phụ: đổi mã lấy token. Mã chỉ dùng được 1 lần, đúng domain, trong 60 giây.
  router.post('/sso/exchange', lim, wrap(async (req, res) => {
    const code = S(req.body.code), { main, allowed } = conf(), h = here(req);
    if (!main || !allowed.has(h)) return fail(res, 'Domain này không bật đăng nhập một lần.', null, 403);
    if (!/^[a-f0-9]{64}$/.test(code)) return fail(res, 'Mã đăng nhập không hợp lệ.');
    const row = await SsoCode.findOneAndDelete({ hash: sha(code), origin: h, createdAt: { $gt: new Date(Date.now() - TTL) } });
    const u = row && await User.findById(row.user);
    if (!u || u.banned) return fail(res, 'Mã đăng nhập không hợp lệ hoặc đã hết hạn.', null, 401);
    const token = sign(u, row.sid || undefined);   // cùng sid với phiên ở domain chính
    setCookie(res, token);   // domain phụ có cookie HttpOnly của chính nó
    res.json({ token, user: pub(u) });
  }));
};
