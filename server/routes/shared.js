/* Helper + import dùng chung cho các module trong server/routes/ (tách từ routes.js cũ) */
const { isValidObjectId, Types } = require('mongoose');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), rateLimit = require('express-rate-limit');
const { rlStore } = require('../ratestore');
const { User, Post, Guestbook, Friendship, Message, Poke, ProfileField, Invite, PushSub, Session } = require('../models');
const crypto = require('crypto'), { sendMail } = require('../mail');
const N = require('../notify');   // trung tâm thông báo (port từ phpFox)
const push = require('../push');   // Web Push (thông báo đẩy ra điện thoại / trình duyệt)
const mention = require('../mention');   // @nhắc tên trong bài viết / bình luận
const social = require('../social');   // khách ghé thăm, nhóm bạn, gợi ý bạn, mã mời (port từ UCenter Home)
const media = require('../media');   // ảnh + video trong bài viết (port ý tưởng từ phpFox feed/photo/video)

const RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMOJI = ['👍', '😍', '😂', '😮', '😢'], GIFTS = ['🎁', '🌹', '🍰', '🧸'];
const S = (v) => (typeof v === 'string' ? v : '');            // chỉ nhận chuỗi -> chặn NoSQL injection ({"$ne":...})
// bcrypt chỉ dùng 72 byte đầu của mật khẩu -> chặn mật khẩu dài hơn thay vì âm thầm cắt (và chặn chuỗi khổng lồ làm nặng server)
const pwErr = (pw) => (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Mật khẩu cần ít nhất 8 ký tự, có cả chữ và số.'
  : Buffer.byteLength(pw) > 72 ? 'Mật khẩu tối đa 72 byte (khoảng 72 ký tự không dấu).' : '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, msg, fields, code = 400) => res.status(code).json({ error: msg, fields });
const { sign, read: readToken, auth, revokeSession, revokeAllSessions, newLogin, setCookie, clearCookie } = require('../session');   // JWT mã hóa (JWE) + cookie HttpOnly + thu hồi phiên
const { award, completeTask } = require('../credit');   // điểm tín dụng + nhiệm vụ (dùng ở nhiều route)
const { filter: censorFilter } = require('../censor');   // bộ lọc từ cấm
const ageOf = (b) => { if (!b) return null; const n = new Date(); let a = n.getFullYear() - b.getUTCFullYear(); if (n < new Date(n.getFullYear(), b.getUTCMonth(), b.getUTCDate())) a--; return a; };
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);   // quản trị viên = email nằm trong ADMIN_EMAILS
const isRoot = (u) => !!u && ADMINS.includes(String(u.email || '').toLowerCase());   // admin gốc (ADMIN_EMAILS): được cấp/gỡ quyền admin cho người khác
const isAdmin = (u) => !!u && (isRoot(u) || u.siteAdmin === true);   // admin gốc hoặc admin được cấp trong DB
const extraOf = (u) => (u.extra ? Object.fromEntries(u.extra) : {});
const fxOf = (u) => {   // hiệu ứng đạo cụ đang có hiệu lực (để frontend hiển thị)
  const out = {}, now = Date.now();
  if (u && u.magicFx) for (const [k, v] of u.magicFx) {
    if (v && v.exp && new Date(v.exp).getTime() < now) continue;
    if (['color', 'icon', 'frame', 'bgimage', 'flicker', 'superstar'].includes(k)) out[k] = true;
  }
  return out;
};
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, verified: u.verified !== false, blueTick: !!u.blueTick,
  totpEnabled: !!u.totpEnabled,
  phone: u.phone || '', birthday: u.birthday ? u.birthday.toISOString().slice(0, 10) : '', age: ageOf(u.birthday),
  location: u.location || '', bio: u.bio || '', avatar: u.avatar || '', cover: u.cover || '', coverPos: u.coverPos || '50% 50%', joined: u.createdAt, mood: u.mood || '',
  theme: { id: u.theme || '', bg: u.themeBg || '', accent: u.themeAccent || '' }, noTheme: !!u.noTheme, admin: isAdmin(u), root: isRoot(u), extra: extraOf(u), fx: fxOf(u) });

const limiter = rateLimit({ store: rlStore('routes.limiter'), windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút.' } });
// Riêng bước nhập mã 2FA: mã TOTP chỉ 6 số nên giới hạn chặt hơn để chống brute-force (kết hợp token tạm chỉ sống 5 phút).
const totpLimiter = rateLimit({ store: rlStore('routes.totpLimiter'), windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Nhập sai mã quá nhiều lần, vui lòng đợi 15 phút.' } });
/* ---------- Xác thực email (mã 10 số, hết hạn 15 phút, sai tối đa 5 lần, gửi lại cách 60 giây) ---------- */
const hashCode = (u, c) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(u.id + ':' + c).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const issueCode = async (res, u) => {
  if (u.vSentAt && Date.now() - u.vSentAt < 60 * 1000) return fail(res, 'Vui lòng đợi ít giây rồi gửi lại mã.', null, 429);
  const code = String(crypto.randomInt(0, 1e10)).padStart(10, '0');
  Object.assign(u, { vCode: hashCode(u, code), vExp: new Date(Date.now() + 15 * 60 * 1000), vTries: 0, vSentAt: new Date() });
  await u.save();
  try { await sendMail(u.email, u.name, code); }
  catch (e) { console.error('Mail:', e.message); return fail(res, 'Không gửi được email xác thực. Vui lòng thử lại sau.', null, 502); }
  res.status(201).json({ needVerify: true, email: u.email });
};
/* --- dùng chéo giữa nhiều module --- */
const friendIds = async (me) => (await Friendship.find({ status: 'accepted', $or: [{ from: me }, { to: me }] }).select('from to'))
  .map((f) => (String(f.from) === me ? f.to : f.from));
const pair = (a, b) => ({ $or: [{ from: a, to: b }, { from: b, to: a }] });
const areFriends = (a, b) => Friendship.exists({ status: 'accepted', ...pair(a, b) });
const msgLimiter = rateLimit({ store: rlStore('routes.msgLimiter'), windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn nhắn quá nhanh, vui lòng thử lại sau ít giây.' } });
const Ably = require('ably');
const ably = process.env.ABLY_API_KEY ? new Ably.Rest({ key: process.env.ABLY_API_KEY }) : null;
const chatCh = (a, b) => 'chat:' + [String(a), String(b)].sort().join('_');

module.exports = {
  isValidObjectId, Types, bcrypt, jwt, rateLimit, rlStore, User, Post, Guestbook, Friendship, Message, Poke, ProfileField, Invite, PushSub, Session, crypto, sendMail, N, push, mention, social, media, RX, EMOJI, GIFTS, S, pwErr, wrap, fail, sign, readToken, auth, revokeSession, revokeAllSessions, newLogin, setCookie, clearCookie, award, completeTask, censorFilter, ageOf, ADMINS, isAdmin, fxOf, pub, limiter, totpLimiter, hashCode, same, issueCode, friendIds, pair, areFriends, msgLimiter, ably, chatCh,
};
