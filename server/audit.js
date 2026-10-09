/* Nhật ký kiểm toán thao tác quản trị (admin audit log).
   Ghi: AI làm (adminId) — LÀM GÌ (action) — VỚI AI/CÁI GÌ (target) — CHI TIẾT (note) — LÚC NÀO (createdAt).
   NGUYÊN TẮC BẢO MẬT: không bao giờ ghi mật khẩu, mã 2FA/TOTP, mã dự phòng, token/session.
   Mọi note đi qua sanitizeNote() để cắt bỏ cặp key=value nhạy cảm trước khi lưu. */

// Từ khóa nhạy cảm: nếu note chứa các cặp này thì bị che đi
const SENSITIVE_KEYS = /(password|passwd|pwd|totp|otp|2fa|backup[-_ ]?code|secret|token|session|cookie)/i;
const MAX_TARGET = 120, MAX_NOTE = 300, MAX_ACTION = 40;

// Che mọi đoạn "key=giá_trị" / "key: giá_trị" / '"key":"giá_trị"' có key nhạy cảm
function sanitizeNote(note) {
  let s = String(note || '');
  // dạng "key": "value" hoặc 'key': 'value' (JSON)
  s = s.replace(/(["'])([^"']*?(?:password|passwd|pwd|totp|otp|2fa|backup|secret|token|session|cookie)[^"']*?)\1\s*:\s*(["'])[^"']*\3/gi, '$1$2$1: "***"');
  // dạng key=value hoặc key: value (query/log text)
  s = s.replace(/([a-zA-Z0-9_.-]*(?:password|passwd|pwd|totp|otp|2fa|backup|secret|token|session|cookie)[a-zA-Z0-9_.-]*)\s*[:=]\s*\S+/gi, '$1=***');
  return s;
}

function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }

/* Ghi 1 dòng log. Fire-and-forget: lỗi ghi log không được làm hỏng API quản trị. */
function writeAudit(AdminLog, adminId, action, target, note) {
  if (!AdminLog || !adminId || !action) return Promise.resolve();
  const doc = {
    admin: adminId,
    action: trunc(String(action), MAX_ACTION),
    target: trunc(String(target || ''), MAX_TARGET),
    note: trunc(sanitizeNote(note || ''), MAX_NOTE),
  };
  return AdminLog.create(doc).catch(() => {});
}

// Escape regex cho từ khóa tìm kiếm của người dùng
function escRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Dựng filter MongoDB cho API tra cứu /admin/logs.
   - action: lọc chính xác theo mã hành động (vd: 'ban')
   - q: tìm gần đúng trong target, note và tên admin (đã populate -> lọc sau ở bước map nếu cần;
     ở đây lọc target/note bằng regex, tên admin lọc bằng $lookup khi cần — giữ đơn giản: regex trên target/note) */
function buildLogFilter({ action, q } = {}) {
  const f = {};
  const a = String(action || '').trim().slice(0, MAX_ACTION);
  if (a) f.action = a;
  const kw = String(q || '').trim().slice(0, 60);
  if (kw) {
    const re = new RegExp(escRe(kw), 'i');
    f.$or = [{ target: re }, { note: re }];
  }
  return f;
}

module.exports = { writeAudit, sanitizeNote, buildLogFilter, escRe };
