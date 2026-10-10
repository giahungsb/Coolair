/* Cấp / gỡ quyền Admin trực tiếp trong database (dùng khi chưa có admin nào vào được trang quản trị).
   Chạy trên máy của bạn:
     MONGODB_URI="mongodb+srv://..." node scripts/make-admin.js email@cua-ban.com          (cấp)
     MONGODB_URI="mongodb+srv://..." node scripts/make-admin.js email@cua-ban.com --revoke  (gỡ)
   Cấp admin cũng đánh dấu email đã xác thực (vì tài khoản chưa xác thực bị chặn mọi API). */
require('dotenv').config();   // đọc MONGODB_URI từ .env nếu có
const mongoose = require('mongoose');
const { User } = require('../server/models');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const revoke = process.argv.includes('--revoke');
  if (!email || email.startsWith('--')) { console.error('Cách dùng: node scripts/make-admin.js <email> [--revoke]'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('Thiếu biến môi trường MONGODB_URI.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const u = await User.findOne({ email });
  if (!u) { console.error('Không tìm thấy tài khoản có email: ' + email); await mongoose.disconnect(); process.exit(1); }
  if (revoke) { u.siteAdmin = false; } else { u.siteAdmin = true; u.verified = true; u.banned = false; }
  await u.save();
  console.log((revoke ? 'Đã gỡ quyền Admin: ' : 'Đã cấp quyền Admin: ') + u.username + ' <' + u.email + '>');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
