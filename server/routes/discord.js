/* Đăng nhập / đăng ký / liên kết tài khoản bằng Discord (OAuth2 Authorization Code + PKCE).
   Luồng:
   1) GET  /auth/discord[?link=1]   -> tạo state + PKCE, lưu trong cookie HttpOnly (JWT ký, 10 phút), chuyển hướng sang Discord
   2) GET  /auth/discord/callback   -> kiểm tra state, đổi code lấy token (phía server), gọi /users/@me, rồi:
        - link=1 (đang đăng nhập): gắn Discord vào tài khoản hiện tại
        - đã có tài khoản gắn discordId: đăng nhập
        - email Discord ĐÃ XÁC THỰC trùng email có sẵn: tự liên kết rồi đăng nhập
        - còn lại: tạo tài khoản mới (cần email Discord đã xác thực)
      Kết quả quay về trang chủ: thành công = cookie phiên; cần 2FA / lỗi = đặt trong #hash (không bao giờ gửi tới server/log).
   3) POST /auth/discord/unlink     -> hủy liên kết (chỉ khi còn cách đăng nhập khác)
   Cấu hình .env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI (= https://<domain chính>/api/auth/discord/callback).
   Để trống = tắt. */
const { bcrypt, jwt, crypto, User, wrap, fail, auth, newLogin, setCookie, award, ADMINS, pub, limiter, revokeAllSessions } = require('./shared');
const { check, ipBanned } = require('../session');

const CK = 'dc_oauth', CK_PATH = '/api/auth/discord', API = 'https://discord.com/api';
const cfg = () => ({ id: process.env.DISCORD_CLIENT_ID || '', secret: process.env.DISCORD_CLIENT_SECRET || '', redirect: process.env.DISCORD_REDIRECT_URI || '' });
const enabled = () => { const c = cfg(); return !!(c.id && c.secret && /^https?:\/\//.test(c.redirect)); };
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const https = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
const ckOpts = (req) => ({ httpOnly: true, sameSite: 'lax', secure: https(req), path: CK_PATH });   // dùng CHUNG cho set và xóa cookie (xóa phải khớp thuộc tính lúc tạo)
const back = (res, code) => res.redirect('/#discord=err.' + code);   // frontend đọc #discord=err.<mã> rồi hiện thông báo

// Username từ tên Discord: chỉ a-z 0-9 . _ (3–20 ký tự), trùng thì thêm số
const makeUsername = async (d) => {
  let base = String(d.username || '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 14);
  if (base.length < 3) base = 'user' + base;
  for (let i = 0; i < 8; i++) {
    const cand = i === 0 ? base : base + String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!(await User.exists({ username: cand }))) return cand;
  }
  return 'dc' + rnd(6).toLowerCase().replace(/[^a-z0-9]/g, 'x');
};

// Ảnh đại diện Discord (CDN công khai, đã cho phép trong CSP img-src). Hash chỉ gồm hex (thêm tiền tố a_ nếu ảnh động) -> kiểm tra chặt, lấy khung tĩnh PNG 256px.
const avatarUrl = (d) => /^(a_)?[a-f0-9]{32}$/.test(String(d.avatar || '')) ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=256` : '';
// Chỉ điền khi người dùng CHƯA có ảnh (không ghi đè ảnh họ đã tự tải lên)
const setAvatarIfEmpty = (uid, d) => { const a = avatarUrl(d); return a ? User.updateOne({ _id: uid, $or: [{ avatar: '' }, { avatar: { $exists: false } }] }, { avatar: a }) : null; };

// Hoàn tất đăng nhập cho tài khoản u: 2FA -> chuyển #hash chứa token tạm; không 2FA -> cấp cookie phiên
const finish = async (req, res, u, isNew) => {
  if (u.banned) return back(res, 'banned');
  if (u.totpEnabled) {   // giống /auth/login: CHƯA cấp phiên thật, chỉ cấp token tạm 5 phút (purpose:'totp') để nhập mã 2FA
    const t = jwt.sign({ id: u.id, purpose: 'totp' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    return res.redirect('/#discord=totp.' + t);
  }
  await User.updateOne({ _id: u._id }, { lastLogin: new Date(), lastSeen: new Date() }); award(u._id, 'login');
  setCookie(res, await newLogin(req, u));
  res.redirect(isNew ? '/#discord=welcome' : '/');   // tài khoản mới: frontend nhắc đặt mật khẩu
};

module.exports = (router) => {
  // Frontend hỏi: có bật đăng nhập Discord không (để ẩn/hiện nút)
  router.get('/auth/discord/info', (req, res) => res.json({ enabled: enabled() }));

  router.get('/auth/discord', limiter, wrap(async (req, res) => {
    if (!enabled()) return back(res, 'off');
    let link = null;
    if (req.query.link === '1') {   // liên kết từ Cài đặt: phải đang đăng nhập
      const p = await check(req);
      if (!p) return back(res, 'login');
      link = p.id;
    }
    const state = rnd(24), verifier = rnd(48);
    const ck = jwt.sign({ purpose: 'discord', s: state, v: verifier, l: link }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
    res.cookie(CK, ck, { ...ckOpts(req), maxAge: 10 * 60 * 1000 });   // Lax: vẫn gửi kèm khi Discord chuyển hướng về
    const c = cfg(), u = new URL('https://discord.com/oauth2/authorize');
    u.search = new URLSearchParams({ client_id: c.id, response_type: 'code', redirect_uri: c.redirect, scope: 'identify email', state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    res.redirect(u.toString());
  }));

  router.get('/auth/discord/callback', limiter, wrap(async (req, res) => {
    const raw = req.cookies && req.cookies[CK];
    res.clearCookie(CK, ckOpts(req));   // state dùng 1 lần
    if (!enabled()) return back(res, 'off');
    let p = null;
    try { p = jwt.verify(String(raw || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch {}
    if (!p || p.purpose !== 'discord' || !eq(String(req.query.state || ''), p.s)) return back(res, 'state');
    if (req.query.error) return back(res, 'denied');   // người dùng bấm "Hủy" bên Discord
    const code = String(req.query.code || '');
    if (!code || code.length > 200) return back(res, 'fail');
    if (await ipBanned(req)) return back(res, 'ip');

    // Đổi code -> access token -> thông tin người dùng (gọi tới host cố định discord.com, không có URL do người dùng nhập)
    let d;
    try {
      const c = cfg();
      const tr = await fetch(API + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', code, redirect_uri: c.redirect, code_verifier: p.v }) });
      if (!tr.ok) return back(res, 'fail');
      const { access_token } = await tr.json();
      const ur = await fetch(API + '/users/@me', { headers: { Authorization: 'Bearer ' + access_token }, signal: AbortSignal.timeout(8000) });
      if (!ur.ok) return back(res, 'fail');
      d = await ur.json();
    } catch { return back(res, 'fail'); }
    if (!d || !/^\d{15,25}$/.test(String(d.id))) return back(res, 'fail');
    d.id = String(d.id);
    const email = d.verified === true && typeof d.email === 'string' ? d.email.trim().toLowerCase() : '';   // chỉ tin email Discord đã xác thực

    /* --- Chế độ liên kết (đang đăng nhập) --- */
    if (p.l) {
      // Phiên lúc quay về PHẢI vẫn là người đã bấm liên kết (chống: A bấm liên kết -> đăng xuất -> B đăng nhập cùng trình duyệt -> Discord bị gắn nhầm vào A)
      const cur = await check(req);
      if (!cur || String(cur.id) !== String(p.l)) return back(res, 'login');
      const me = await User.findById(p.l);
      if (!me || me.banned) return back(res, 'login');
      const other = await User.findOne({ discordId: d.id }).select('_id');
      if (other && String(other._id) !== String(me._id)) return back(res, 'taken');
      try { await User.updateOne({ _id: me._id }, { discordId: d.id }); } catch { return back(res, 'taken'); }
      await setAvatarIfEmpty(me._id, d);
      return res.redirect('/#discord=linked');
    }

    /* --- Chế độ đăng nhập / đăng ký --- */
    let u = await User.findOne({ discordId: d.id });
    if (!u && email) {
      u = await User.findOne({ email });
      if (u) {
        if (u.banned) return back(res, 'banned');
        // Chủ email đã chứng minh bằng Discord. Nếu tài khoản này CHƯA xác thực email (có thể do người khác đăng ký trước bằng email này)
        // thì vô hiệu mật khẩu cũ + đá mọi phiên, chống chiếm tài khoản (pre-hijacking).
        const upd = { discordId: d.id };
        if (u.verified === false) Object.assign(upd, { verified: true, password: await bcrypt.hash(rnd(32), 12), noPassword: true, vCode: undefined, vExp: undefined });
        try { await User.updateOne({ _id: u._id }, upd); } catch { return back(res, 'taken'); }
        if (u.verified === false) await revokeAllSessions(u._id);
        await setAvatarIfEmpty(u._id, d);
      }
    }
    let isNew = false;
    if (!u) {   // tạo tài khoản mới
      if (!email) return back(res, 'noemail');   // schema cần email duy nhất; Discord chưa xác thực email thì không tạo được
      if (ADMINS.includes(email)) return back(res, 'fail');   // giống /auth/register: email quản trị chỉ vào được qua tài khoản có sẵn
      const { siteGet } = require('../aconfig');
      if ((await siteGet('register_open', '1')) !== '1') return back(res, 'closed');
      if ((await siteGet('invite_only', '0')) === '1') return back(res, 'invite');
      const username = await makeUsername(d);
      let name = String(d.global_name || d.username || '').trim().slice(0, 30);
      if (name.length < 2) name = username;
      try {
        u = await User.create({ name, email, username, discordId: d.id, avatar: avatarUrl(d), verified: true, noPassword: true, password: await bcrypt.hash(rnd(32), 12) });
        isNew = true;
      } catch { return back(res, 'fail'); }   // trùng khóa do 2 request song song
    }
    await finish(req, res, u, isNew);
  }));

  // Hủy liên kết: tài khoản tạo bằng Discord (chưa đặt mật khẩu) phải đặt mật khẩu qua "Quên mật khẩu" trước, kẻo mất đường vào
  router.post('/auth/discord/unlink', auth, wrap(async (req, res) => {
    const u = await User.findById(req.uid);
    if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    if (!u.discordId) return fail(res, 'Tài khoản chưa liên kết Discord.');
    if (u.noPassword) return fail(res, 'Bạn chưa đặt mật khẩu cho tài khoản này. Hãy vào Cài đặt > "Đặt mật khẩu" (mã gửi qua email) trước khi hủy liên kết.');
    await User.updateOne({ _id: u._id }, { $unset: { discordId: 1 } });
    res.json({ ok: true });
  }));
};

