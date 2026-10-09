/* Web Push (RFC 8030 + VAPID RFC 8292 + mã hóa nội dung aes128gcm RFC 8188/8291) – chỉ dùng module `crypto` có sẵn của Node, không cần gói ngoài.
   Cần 3 biến môi trường: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:... hoặc https://...). Tạo khóa: `node server/genvapid.js`.
   Thiếu khóa -> enabled() = false, mọi hàm gửi im lặng bỏ qua (thông báo trong app vẫn chạy bình thường). */
const crypto = require('crypto');
const { PushSub } = require('./models');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const PUB = () => (process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIV = () => (process.env.VAPID_PRIVATE_KEY || '').trim();
const SUBJECT = () => (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const enabled = () => PUB().length > 40 && PRIV().length > 20;

// khóa VAPID -> KeyObject để ký ES256
const vapidKey = () => {
  const pub = unb64u(PUB());                                   // 65 byte: 0x04 | x | y
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(unb64u(PRIV())), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
};
const vapidHeader = (endpoint) => {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT() }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: vapidKey(), dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + PUB();
};

// RFC 8291: mã hóa payload cho 1 thuê bao (p256dh = khóa công khai của trình duyệt, auth = bí mật 16 byte)
const encrypt = (payload, p256dh, auth) => {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);   // 0x02 = bản ghi cuối
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, data]);
};

const sendOne = async (sub, json) => {
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: vapidHeader(sub.endpoint) },
      body: encrypt(json, sub.p256dh, sub.auth),
    });
    if (r.status === 404 || r.status === 410) await PushSub.deleteOne({ _id: sub._id });   // thuê bao đã hết hạn / bị gỡ
    else if (!r.ok) console.error('[push]', r.status, new URL(sub.endpoint).host);
    return r.ok;
  } catch (e) { console.error('[push]', e.message); return false; }
};

// Gửi tới mọi thiết bị của 1 người. payload: { title, body, url, tag }. Không bao giờ ném lỗi (lỗi push không được làm hỏng thao tác chính).
const sendTo = async (userId, payload) => {
  if (!enabled()) return 0;
  try {
    const subs = await PushSub.find({ user: userId }).limit(10).lean();
    if (!subs.length) return 0;
    const json = JSON.stringify({ icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', url: '/', ...payload });
    return (await Promise.all(subs.map((s) => sendOne(s, json)))).filter(Boolean).length;
  } catch (e) { console.error('[push]', e.message); return 0; }
};
const has = (userId) => enabled() ? PushSub.exists({ user: userId }) : Promise.resolve(null);

module.exports = { enabled, sendTo, has, encrypt, vapidHeader, publicKey: PUB };
