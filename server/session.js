/* Phiên đăng nhập.
   - Token là JWE (mã hóa AES-256-GCM, khóa dẫn xuất từ JWT_SECRET): payload { id, sid } KHÔNG đọc được
     nếu không có key (JWT thường chỉ base64 là đọc được). Token cũ (JWS ký HMAC, chưa mã hóa) vẫn được
     chấp nhận tới khi hết hạn để không đá mọi người ra cùng lúc.
   - Token được gửi qua cookie HttpOnly `ca_tk` (JS không đọc được -> XSS cũng không cắp được),
     vẫn dự phòng nhận qua header Authorization cho client cũ. SameSite=Lax chống CSRF.
   - Mỗi lần đăng nhập tạo một sid mới; các domain phụ đăng nhập qua SSO dùng CHUNG sid của domain chính.
   - Đăng xuất = ghi sid vào bộ sưu tập Revoked -> mọi token mang sid đó (ở mọi domain) bị từ chối.
   - Token tạm (purpose: 'totp' ở bước 2 của đăng nhập 2FA) KHÔNG dùng được làm phiên đăng nhập. */
const crypto = require('crypto'), jwt = require('jsonwebtoken');
const { Revoked, Session, User, IpBan } = require('./models');

const COOKIE = 'ca_tk';   // tên cookie HttpOnly chứa token đăng nhập

// IP của request. DÙNG req.ip (đã tôn trọng `trust proxy`), KHÔNG đọc trực tiếp header X-Forwarded-For
// vì client tự đặt header đó tùy ý -> giả IP để vượt lệnh cấm IP / rate-limit.
const clientIp = (req) => String(req.ip || '').slice(0, 45);

/* Cache RAM ngắn cho kiểm tra ban (giảm tải DB mỗi request).
   Trên serverless mỗi instance giữ cache riêng, TTL 60s — đủ giảm đáng kể số query.
   Khi admin đổi trạng thái ban/unban, gọi bustBanCache() để có hiệu lực ngay thay vì đợi hết TTL. */
const BAN_TTL = 60 * 1000, CACHE_MAX = 5000;
const ipBanCache = new Map(), userBanCache = new Map();   // ip/userId -> { ..., at }
const fresh = (e) => e && Date.now() - e.at < BAN_TTL;
const trimCache = (m) => { if (m.size > CACHE_MAX) m.delete(m.keys().next().value); };   // chống phình RAM

const ipBanned = async (req) => {
  const ip = clientIp(req);
  const c = ipBanCache.get(ip);
  if (fresh(c)) return c.banned;
  try {
    const banned = !!(await IpBan.exists({ ip }));
    ipBanCache.set(ip, { banned, at: Date.now() }); trimCache(ipBanCache);
    return banned;
  } catch { return false; }
};
const getUserBan = async (id) => {
  const k = String(id);
  const c = userBanCache.get(k);
  if (fresh(c)) return c;
  const u = await User.findById(id).select('banned banReason').lean();
  const v = { exists: !!u, banned: !!u?.banned, banReason: u?.banReason || '', at: Date.now() };
  userBanCache.set(k, v); trimCache(userBanCache);
  return v;
};
// Xóa cache ban (gọi ngay khi admin ban/unban user hoặc thêm/xóa IP ban)
const bustBanCache = (ip, userId) => {
  if (ip) ipBanCache.delete(String(ip));
  if (userId) userBanCache.delete(String(userId));
};

// Khóa mã hóa token: dẫn xuất từ JWT_SECRET (đổi JWT_SECRET là mọi token cũ mất hiệu lực, như trước)
const jwtKey = () => crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '') + ':jwt-enc').digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
/* JWE tự cài (chuẩn RFC 7516, alg=dir/enc=A256GCM): header_b64..iv_b64.cipher_b64.tag_b64.
   Không dùng thư viện jose vì bản mới ESM-only -> require() sập trên Node cũ (Vercel). AES-256-GCM của Node đủ dùng. */
const jweEncrypt = (payload, key) => {
  const header = b64u(JSON.stringify({ alg: 'dir', enc: 'A256GCM' }));
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(header, 'ascii'));
  const ct = Buffer.concat([c.update(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, ...payload }), 'utf8'), c.final()]);
  return [header, '', b64u(iv), b64u(ct), b64u(c.getAuthTag())].join('.');
};
const jweDecrypt = (tok, key) => {
  const parts = String(tok || '').split('.');
  if (parts.length !== 5 || parts[1] !== '') throw new Error('bad token');
  const [header, , iv, ct, tag] = parts;
  let h;
  try { h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')); } catch { throw new Error('bad token'); }
  if (!h || h.alg !== 'dir' || h.enc !== 'A256GCM') throw new Error('bad token');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(header, 'ascii'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  const pt = JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
  if (!pt || typeof pt.exp !== 'number' || pt.exp * 1000 < Date.now()) throw new Error('expired');
  return pt;
};
// Ký + MÃ HÓA token mới (JWE): payload { id, sid } không đọc được nếu không có key.
const sign = (u, sid = crypto.randomBytes(16).toString('hex')) => jweEncrypt({ id: u.id, sid }, jwtKey());
// Token thô từ request: ưu tiên cookie HttpOnly, dự phòng header Authorization
const rawToken = (req) => (req.cookies && req.cookies[COOKIE]) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const read = async (req) => {
  const tok = rawToken(req);
  if (!tok) return null;
  try { return jweDecrypt(tok, jwtKey()); }
  catch {
    // TODO(2026-10-14): bỏ nhánh token cũ (JWS chưa mã hóa, không có sid) — sau ngày này mọi token cũ đã hết hạn 7 ngày
    try { return jwt.verify(tok, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }   // token cũ chưa mã hóa
    catch { return null; }
  }
};
// Payload nếu token hợp lệ và phiên chưa bị thu hồi, ngược lại null. Lỗi DB được ném ra (KHÔNG biến thành 401, kẻo lỗi mạng làm mọi người bị văng ra).
const check = async (req) => {
  const p = await read(req);
  if (!p || p.purpose) return null;
  return p.sid && (await Revoked.exists({ sid: p.sid })) ? null : p;
};
const auth = async (req, res, next) => {
  let p;
  try { p = await check(req); } catch (e) { return next(e); }
  if (!p) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.' });
  try {   // tài khoản đã bị xóa hoặc bị khóa -> token coi như vô hiệu (401 để trình duyệt tự đăng xuất)
    const b = await getUserBan(p.id);
    if (!b.exists) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    if (b.banned) return res.status(401).json({ banned: true, error: 'Tài khoản của bạn đã bị khóa.' + (b.banReason ? ' Lý do: ' + b.banReason : '') });
  } catch (e) { return next(e); }
  if (await ipBanned(req)) return res.status(403).json({ error: 'Địa chỉ IP của bạn đã bị chặn.' });
  req.uid = p.id; req.sid = p.sid || '';
  next();
};
// Cookie đăng nhập: HttpOnly (JS không đọc được), SameSite=Lax (chống CSRF), Secure khi chạy HTTPS.
const cookieOpts = () => ({
  httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 * 1000,
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production',
});
const setCookie = (res, token) => res.cookie(COOKIE, token, cookieOpts());
const clearCookie = (res) => res.clearCookie(COOKIE, { path: '/' });
const revoke = (sid) => Revoked.updateOne({ sid }, { $setOnInsert: { sid } }, { upsert: true });
// Thu hồi một phiên đăng nhập: ghi sid vào Revoked (token mất hiệu lực ngay) + xóa dòng Session (không còn hiện trong "thiết bị")
const revokeSession = async (sid) => { if (!sid) return; await revoke(sid); try { await Session.deleteOne({ sid }); } catch (e) { console.error('[session] drop:', e.message); } };
// Cấp token cho một lần đăng nhập mới, đồng thời ghi nhận thiết bị (IP + user-agent) để quản lý sau này.
// Ghi Session lỗi cũng không chặn đăng nhập.
const newLogin = async (req, u) => {
  const sid = crypto.randomBytes(16).toString('hex');
  const token = sign(u, sid);
  try { await Session.create({ sid, user: u._id, ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 200) }); }
  catch (e) { console.error('[session] record:', e.message); }
  return token;
};

// Thu hồi TẤT CẢ phiên của một user (đổi/quên mật khẩu, nghi bị chiếm tài khoản)
const revokeAllSessions = async (uid, exceptSid) => {
  const q = { user: uid };
  if (exceptSid) q.sid = { $ne: exceptSid };
  const ss = await Session.find(q).select('sid').lean();
  for (const s of ss) await revoke(s.sid);
  if (ss.length) await Session.deleteMany(q);
  return ss.length;
};

module.exports = { sign, read, check, auth, revoke, revokeSession, revokeAllSessions, newLogin, ipBanned, clientIp, setCookie, clearCookie, COOKIE, bustBanCache };
