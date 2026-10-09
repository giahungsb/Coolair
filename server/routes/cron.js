/* Cron cho Vercel */
const { crypto, wrap, fail } = require('./shared');

module.exports = (router) => {
/* ---------- Cron cho Vercel (serverless không chạy được setInterval) ----------
   Vercel Cron Jobs gọi GET /api/cron/cleanup theo lịch trong vercel.json,
   kèm header Authorization: Bearer <CRON_SECRET> (Vercel KHÔNG tự tạo: phải thêm biến CRON_SECRET, tối thiểu 16 ký tự, ở Settings -> Environment Variables; có rồi Vercel mới tự gửi header).
   Không yêu cầu đăng nhập (Vercel gọi, không phải user), chỉ kiểm secret bằng timingSafeEqual. */
router.get('/cron/cleanup', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = secret.length >= 16 && got.length === secret.length
    && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!ok) return fail(res, 'Không có quyền.', null, 401);
  const results = await require('../cron').runAll(false);
  res.json({ ok: true, at: new Date().toISOString(), results });
}));
};
