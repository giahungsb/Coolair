/* Xem / sửa cờ "chưa có mật khẩu" của tài khoản tạo bằng Discord (dùng khi giao diện vẫn hiện ô "Mật khẩu hiện tại").
   Chạy trên máy của bạn:
     MONGODB_URI="mongodb+srv://..." node scripts/discord-pw.js <username|email>           (xem discordId, noPassword)
     MONGODB_URI="mongodb+srv://..." node scripts/discord-pw.js <username|email> --set     (đánh dấu: chưa có mật khẩu)
     MONGODB_URI="mongodb+srv://..." node scripts/discord-pw.js <username|email> --clear   (bỏ đánh dấu: đã có mật khẩu thật) */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../server/models');

(async () => {
  const id = String(process.argv[2] || '').trim().toLowerCase();
  if (!id || id.startsWith('--')) { console.error('Cách dùng: node scripts/discord-pw.js <username|email> [--set|--clear]'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('Thiếu biến môi trường MONGODB_URI.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const u = await User.findOne({ $or: [{ username: id }, { email: id }] });
  if (!u) { console.error('Không tìm thấy tài khoản: ' + id); await mongoose.disconnect(); process.exit(1); }
  if (process.argv.includes('--set')) { u.noPassword = true; await u.save(); }
  else if (process.argv.includes('--clear')) { u.noPassword = false; await u.save(); }
  console.log(JSON.stringify({ username: u.username, email: u.email, discordId: u.discordId || null, noPassword: !!u.noPassword, verified: u.verified }, null, 2));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
