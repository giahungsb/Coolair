/* Web Push */
const { PushSub, push, S, wrap, fail, auth } = require('./shared');

module.exports = (router) => {
router.get('/push/key', auth, (req, res) => push.enabled() ? res.json({ key: push.publicKey() }) : fail(res, 'Máy chủ chưa bật thông báo đẩy (thiếu VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).', null, 503));
router.post('/push/subscribe', auth, wrap(async (req, res) => {          // trình duyệt đăng ký nhận thông báo đẩy (mỗi thiết bị một dòng, tối đa 10 / người)
  if (!push.enabled()) return fail(res, 'Máy chủ chưa bật thông báo đẩy.', null, 503);
  const sub = req.body && req.body.subscription, k = sub && sub.keys;
  let host = '';
  try { host = new URL(S(sub && sub.endpoint)).protocol === 'https:' ? new URL(sub.endpoint).host : ''; } catch (e) {}
  // Chặn blind SSRF: endpoint phải là dịch vụ push chuẩn của trình duyệt, không cho URL nội bộ tùy ý
  const pushHostOk = (h) => ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(h) || /\.notify\.windows\.com$/.test(h);
  if (!host || !pushHostOk(host) || !k || !S(k.p256dh) || !S(k.auth) || S(sub.endpoint).length > 800) return fail(res, 'Đăng ký thông báo không hợp lệ.');
  const n = await PushSub.countDocuments({ user: req.uid, endpoint: { $ne: sub.endpoint } });
  if (n >= 10) await PushSub.deleteOne({ _id: (await PushSub.findOne({ user: req.uid }).sort({ createdAt: 1 }).select('_id'))._id });
  await PushSub.findOneAndUpdate({ endpoint: sub.endpoint }, { user: req.uid, endpoint: sub.endpoint, p256dh: S(k.p256dh), auth: S(k.auth), ua: S(req.headers['user-agent']).slice(0, 120), createdAt: new Date() }, { upsert: true, setDefaultsOnInsert: true });
  res.status(201).json({ ok: true });
}));
router.post('/push/unsubscribe', auth, wrap(async (req, res) => {
  const ep = S(req.body && req.body.endpoint);
  if (ep) await PushSub.deleteOne({ endpoint: ep, user: req.uid }); else await PushSub.deleteMany({ user: req.uid });
  res.json({ ok: true });
}));
};
