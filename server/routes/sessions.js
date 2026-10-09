/* Thiết bị đăng nhập */
const { Session, S, wrap, fail, revokeSession, revokeAllSessions } = require('./shared');

module.exports = (router) => {
/* ---------- Thiết bị đăng nhập ---------- */
// Tên thiết bị gọn từ user-agent, ví dụ "Chrome · Windows", "Safari · iPhone"
const deviceOf = (ua = '') => {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS\//.test(ua) ? 'Chrome (iOS)' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt lạ';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
};
router.get('/sessions', wrap(async (req, res) => {
  const list = await Session.find({ user: req.uid }).sort({ createdAt: -1 }).lean();
  res.json({ sessions: list.map((s) => ({ sid: s.sid, device: deviceOf(s.ua), ip: s.ip || '', createdAt: s.createdAt, current: s.sid === req.sid })) });
}));
// Thu hồi một phiên của chính mình (kể cả phiên hiện tại -> client tự đăng xuất)
router.delete('/sessions/:sid', wrap(async (req, res) => {
  const s = await Session.findOne({ sid: S(req.params.sid), user: req.uid });
  if (!s) return fail(res, 'Không tìm thấy phiên này.');
  await revokeSession(s.sid);
  res.json({ ok: true, current: s.sid === req.sid });
}));
// Đăng xuất mọi thiết bị khác, giữ lại phiên hiện tại
router.delete('/sessions', wrap(async (req, res) => {
  const revoked = await revokeAllSessions(req.uid, req.sid);
  res.json({ ok: true, revoked });
}));
};
