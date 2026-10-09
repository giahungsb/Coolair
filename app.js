require('dotenv').config();
require('./server/sentry').initSentry();   // giám sát lỗi production (chỉ chạy khi có SENTRY_DSN)
const path = require('path'), express = require('express'), helmet = require('helmet'), mongoose = require('mongoose'), cookieParser = require('cookie-parser');
const { MONGODB_URI, JWT_SECRET, PORT = 3000 } = process.env;

const app = express();
// Số proxy đáng tin trước app (Vercel = 1). Sai số này thì X-Forwarded-For giả mạo được -> vượt rate-limit / ban IP.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 1);
app.disable('x-powered-by');
// CSP: nguồn duy nhất ở server/csp.js (chạy `npm run csp:sync` để đồng bộ vào vercel.json).
// script-src không có 'unsafe-inline' lẫn 'unsafe-eval' (template Vue biên dịch lúc build, dùng Vue runtime-only). style-src giữ 'unsafe-inline' vì template dùng style="…".
const { directives: cspDirectives } = require('./server/csp');
app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false,   // Ably realtime + video nhúng cần cross-origin
}));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());   // đọc cookie HttpOnly `ca_tk` chứa token đăng nhập (session.js)

// Kết nối MongoDB và cache lại giữa các request (bắt buộc với serverless)
let conn;
const connect = () => conn || (conn = mongoose
  .connect(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
  .catch((e) => { conn = null; throw e; }));

app.use('/api', async (req, res, next) => {
  if (!MONGODB_URI || !JWT_SECRET || JWT_SECRET.length < 16)
    return res.status(500).json({ error: 'Máy chủ thiếu biến môi trường MONGODB_URI / JWT_SECRET (>= 16 ký tự).' });
  try { await connect(); next(); }
  catch (e) { console.error('MongoDB:', e.message); res.status(503).json({ error: 'Không kết nối được cơ sở dữ liệu.' }); }
});
// Chống CSRF cho request ghi: nếu trình duyệt gửi Origin/Referer thì phải trùng host (kẻ tấn công từ site khác không giả mạo được header này).
// Request không có Origin (curl, app mobile...) vẫn cho qua vì đã có auth token/cookie + SameSite=Lax.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const o = req.get('origin') || req.get('referer');
    if (o) {
      let ok = false;
      try {
        const u = new URL(o);
        const host = (req.get('host') || '').split(':')[0].toLowerCase();
        const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        ok = u.host.toLowerCase() === host || extra.includes(u.host.toLowerCase());
      } catch { /* URL parse lỗi -> ok=false */ }
      if (!ok) return res.status(403).json({ error: 'Origin không hợp lệ.' });
    }
  }
  next();
});
app.use('/api', require('./server/routes/index.js'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

// Chỉ có tác dụng khi chạy local. Trên Vercel cũng chính Express này phục vụ public/ (log type=function). JS build đặt đuôi .mjs để Vercel không đổi ESM->CommonJS.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => {
  if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  // file /assets/ có hash trong tên -> cache vĩnh viễn; html / sw.js / theme-init.js / manifest luôn hỏi lại máy chủ (tránh giữ bản cũ sau deploy gây trắng màn)
  if (/[\\/]assets[\\/]/.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.(html|js)$/.test(p) || /manifest\.json$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
} }));

app.use((err, req, res, next) => {
  if (err.code === 11000) return res.status(409).json({ error: 'Dữ liệu đã tồn tại.' });
  const client = err.status && err.status < 500;
  if (!client) { console.error(err); try { require('./server/sentry').reportError(err, req); } catch (_) {} }
  res.status(client ? err.status : 500).json({ error: client ? 'Yêu cầu không hợp lệ.' : 'Lỗi máy chủ.' });
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`CoolAir chạy tại http://localhost:${PORT}`);
  try { require('./server/cron').start(); } catch (e) { console.error('[cron]', e.message); }   // dọn dẹp định kỳ (chỉ khi chạy tiến trình thường, không áp dụng trên serverless)
});
module.exports = app;
