/* Giám sát lỗi production bằng Sentry.
   - Chỉ bật khi có SENTRY_DSN (production). Không có DSN -> không làm gì, app chạy bình thường.
   - KHÔNG gửi dữ liệu cá nhân: email, mật khẩu, token, cookie, header Authorization đều bị lọc.
   - Bỏ qua lỗi ồn ào: 401 (chưa đăng nhập), 404 (không tìm thấy). */
const SENSITIVE_RE = /password|passwd|pwd|totp|otp|2fa|backup|secret|token|session|cookie|authorization|set-cookie|email|phone/i;

function scrubObject(obj, depth = 0) {
  if (!obj || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    out[k] = SENSITIVE_RE.test(k) ? '***' : scrubObject(obj[k], depth + 1);
  }
  return out;
}

// true = bỏ qua event này, không gửi Sentry
function shouldIgnore(event) {
  const status = event?.contexts?.response?.status_code;
  if (status === 401 || status === 404) return true;
  const msg = String(event?.message || event?.exception?.values?.[0]?.value || '');
  // Lỗi do cố ý test / lỗi client ồn ào
  if (/sentry test|test error/i.test(msg) && /ignore/i.test(msg)) return true;
  return false;
}

function beforeSend(event) {
  if (shouldIgnore(event)) return null;
  if (event.request) {
    if (event.request.headers) event.request.headers = scrubObject(event.request.headers);
    if (event.request.cookies) event.request.cookies = Object.fromEntries(Object.keys(event.request.cookies).map((k) => [k, '***']));
    if (event.request.data) event.request.data = scrubObject(event.request.data);
  }
  if (event.user) {
    // chỉ giữ id, xóa email/username/tên
    event.user = { id: event.user.id ? String(event.user.id) : undefined };
    if (!event.user.id) delete event.user;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = (event.breadcrumbs.values || event.breadcrumbs).map?.((b) => {
      if (b.data) b.data = scrubObject(b.data);
      return b;
    }) ?? event.breadcrumbs;
  }
  return event;
}

let initialized = false;
function initSentry() {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;   // không có DSN -> tắt giám sát, app chạy bình thường
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      tracesSampleRate: 0,          // chỉ cần lỗi, không cần tracing (tiết kiệm quota)
      beforeSend,
      // Không gửi PII mặc định của SDK
      sendDefaultPii: false,
    });
  } catch (e) {
    console.error('[sentry] init failed:', e.message);
  }
}

/* Báo 1 lỗi server lên Sentry (kèm method + URL, không kèm PII). */
function reportError(err, req) {
  if (!initialized) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.withScope((scope) => {
      if (req) {
        scope.setTag('http.method', req.method);
        scope.setContext('http', { url: req.originalUrl || req.url, method: req.method });
        if (req.uid) scope.setUser({ id: String(req.uid) });   // chỉ id, không email/tên
      }
      Sentry.captureException(err);
    });
  } catch (_) { /* không để giám sát làm hỏng request */ }
}

module.exports = { initSentry, reportError, beforeSend, shouldIgnore, scrubObject };
