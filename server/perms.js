/* Kiểm tra quyền theo nhóm quyền (UserGroup). Quy tắc:
   - Admin (email trong ADMIN_EMAILS hoặc siteAdmin) luôn có TẤT CẢ quyền, không phụ thuộc nhóm.
   - Thành viên chưa gán nhóm: giữ hành vi cũ (được phép).
   - Thành viên có nhóm: chỉ làm được việc mà nhóm bật quyền (post, comment, invite, group_create, event_create). */
const { User, UserGroup } = require('./models');
const ROOTS = (process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const can = async (uid, key) => {
  const u = await User.findById(uid).select('email siteAdmin userGroup').lean();
  if (!u) return false;
  if (u.siteAdmin === true || ROOTS.includes(String(u.email || '').toLowerCase())) return true;   // admin: toàn quyền
  if (!u.userGroup) return true;
  const g = await UserGroup.findById(u.userGroup).select('perms').lean();
  if (!g) return true;   // nhóm đã bị xóa -> coi như chưa có nhóm
  const p = g.perms instanceof Map ? Object.fromEntries(g.perms) : (g.perms || {});
  return p[key] !== false;
};
// Middleware: đặt sau auth / limiter
const need = (key) => async (req, res, next) => {
  try {
    if (await can(req.uid, key)) return next();
    return res.status(403).json({ error: 'Nhóm quyền của bạn không cho phép thao tác này.', fields: null });
  } catch (e) { next(e); }
};
module.exports = { can, need };
