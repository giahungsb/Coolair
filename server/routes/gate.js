/* Cổng xác thực: SSO + router.use(auth) + needVerify + đánh dấu online */
const { User, social, S, wrap, fail, sign, auth, setCookie, pub } = require('./shared');

module.exports = (router) => {
/* ---------- Đăng nhập một lần giữa các domain: PHẢI đặt trước router.use(auth) bên dưới vì /sso/info và /sso/exchange gọi khi chưa đăng nhập ---------- */
require('../sso')(router, { wrap, fail, S, pub, sign, setCookie });
social.mountPublic(router, { wrap, fail, S });   // /invites/check (form đăng ký hỏi mã mời khi chưa đăng nhập)

// Tài khoản chưa xác thực email chỉ dùng được các API ở trên; các API bên dưới yêu cầu đã xác thực.
// /cron/cleanup do Vercel Cron gọi (không có phiên người dùng) -> tự kiểm CRON_SECRET trong routes/cron.js.
// Một số API phpFox parity + RSS mở cho khách vãng lai (form liên hệ, thông báo chung, trợ giúp, RSS).
const PUBLIC_API = /^\/(contact|announcements|faqs|rss\.xml|rss\/|links\/[^/]+\/go|site-config|themes|cron\/cleanup)/;
const needVerify = wrap(async (req, res, next) => {
  const u = await User.findById(req.uid).select('verified');
  if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  if (u.verified === false) return res.status(403).json({ error: 'Hãy xác thực email trong Cài đặt để dùng tính năng này.', needVerify: true });
  next();
});
router.use((req, res, next) => {
  if (PUBLIC_API.test(req.path)) return next();
  auth(req, res, (e) => {
    if (e) return next(e);
    // Online: mọi API đều tính là hoạt động, throttle 2 phút để "online 5 phút" đếm đủ (bỏ qua nếu đang tàng hình)
    (async () => {
      try {
        const me = await User.findById(req.uid).select('magicFx');
        const inv = me && me.magicFx && typeof me.magicFx.get === 'function' ? me.magicFx.get('invisible') : me.magicFx && me.magicFx.invisible;
        if (inv && inv.exp > Date.now()) return;
        await User.updateOne({ _id: req.uid, $or: [{ lastSeen: null }, { lastSeen: { $lt: new Date(Date.now() - 2 * 60 * 1000) } }] }, { lastSeen: new Date() });
      } catch (e) {}
    })();
    needVerify(req, res, next);
  });
});
};
