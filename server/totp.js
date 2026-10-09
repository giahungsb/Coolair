/* Xác thực 2 bước (2FA) kiểu Google Authenticator: TOTP 6 số, mỗi 30 giây đổi một lần (RFC 6238, tự cài bằng crypto của Node).
   KHÔNG dùng thư viện otplib vì v13 kéo theo @scure/base ESM-only -> require() sập trên Node cũ (Vercel).
   Tương thích chuẩn: secret base32 (RFC 4648) như Google Authenticator/Authy, mã 6 số HMAC-SHA1.
   - Secret TOTP được MÃ HÓA (AES-256-GCM, khóa dẫn xuất từ JWT_SECRET) trước khi lưu DB: lộ DB cũng không đọc được secret.
   - Mã dự phòng (backup codes): 8 mã, hash HMAC-SHA256, mỗi mã dùng đúng 1 lần (phòng mất điện thoại).
   - Chấp nhận lệch giờ ±1 bước (30s) để điện thoại lệch giờ nhẹ vẫn đăng nhập được. */
const crypto = require('crypto');
const QRCode = require('qrcode');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => {
  s = String(s || '').toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad secret');
    val = (val << 5) | v; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
};
const b32enc = (buf) => {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
};
// HOTP: HMAC-SHA1(secret, counter 8-byte big-endian) -> dynamic truncation -> 6 số
const hotp = (key, counter) => {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest(), o = h[h.length - 1] & 0x0f;
  const v = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 1e6).padStart(6, '0');
};
const totpAt = (secret, epochSec) => hotp(b32dec(secret), Math.floor(epochSec / 30));

const encKey = () => crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '') + ':totp-enc').digest();
// Mã hóa secret trước khi lưu DB
const enc = (plain) => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const d = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'gcm$' + iv.toString('hex') + '$' + c.getAuthTag().toString('hex') + '$' + d.toString('hex');
};
const dec = (s) => {
  const parts = String(s || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'gcm') throw new Error('bad totp secret');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(parts[1], 'hex'));
  d.setAuthTag(Buffer.from(parts[2], 'hex'));
  return Buffer.concat([d.update(Buffer.from(parts[3], 'hex')), d.final()]).toString('utf8');
};

const genSecret = () => b32enc(crypto.randomBytes(20));   // 160-bit, chuẩn Google Authenticator
const otpauthUrl = (secret, email) =>
  'otpauth://totp/' + encodeURIComponent('CoolAir') + ':' + encodeURIComponent(email) +
  '?secret=' + secret + '&issuer=' + encodeURIComponent('CoolAir');
const qrDataUrl = (text) => QRCode.toDataURL(text, { width: 220, margin: 1 });   // PNG data URL để <img> hiện QR
const verify = (secret, code) => {
  code = String(code || '').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000);
  try { return [-1, 0, 1].some((d) => totpAt(secret, now + d * 30) === code); }
  catch { return false; }
};
// 8 mã dự phòng, mỗi mã 8 ký tự hex (dễ gõ). Hash do routes/totp.js thực hiện bằng hashCode(u, 'b'+code).
const genBackupCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'));

module.exports = { enc, dec, genSecret, otpauthUrl, qrDataUrl, verify, genBackupCodes, totpAt, b32dec, b32enc };
