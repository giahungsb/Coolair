/* Quyền xem dùng chung cho sự kiện / bình chọn / tìm kiếm: công khai, bạn bè (chỉ khi là bạn của chủ), hoặc của chính mình. */
const { Friendship, Blacklist } = require('./models');
const friendIds = async (me) => {
  const fs = await Friendship.find({ status: 'accepted', $or: [{ from: me }, { to: me }] }).select('from to').lean();
  return fs.map((f) => (String(f.from) === String(me) ? f.to : f.from));
};
const visQ = (me, ids, field = 'owner') => ({ $or: [{ [field]: me }, { visibility: 'public' }, { visibility: 'friends', [field]: { $in: ids } }] });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Chặn (blacklist của UCHome): true nếu a chặn b hoặc b chặn a */
const blockedBetween = async (a, b) => {
  if (!a || !b || String(a) === String(b)) return false;
  return !!(await Blacklist.exists({ $or: [{ owner: a, blocked: b }, { owner: b, blocked: a }] }));
};
const blockedIds = async (me) => {   // mọi id liên quan đến chặn (cả 2 chiều) để loại khỏi bảng tin
  const rows = await Blacklist.find({ $or: [{ owner: me }, { blocked: me }] }).select('owner blocked').lean();
  return rows.map((r) => (String(r.owner) === String(me) ? r.blocked : r.owner));
};
// Loại những người đã tắt "hiện <type> của tôi lên bảng tin bạn bè" (port privacy feed của UCHome)
const feedOptOutIds = async (ids, type) => {
  if (!ids.length) return [];
  const { User } = require('./models');
  const rows = await User.find({ _id: { $in: ids }, ['feedPrefs.' + type]: false }).select('_id').lean();
  return rows.map((r) => String(r._id));
};
// Quyền xem từng phần hồ sơ (port cp_privacy của UCHome): public|friends|private, mặc định public
const PRIV_SECTIONS = ['info', 'blog', 'album', 'doing', 'guestbook'];
const PRIV_LABELS = { info: 'Thông tin hồ sơ', blog: 'Nhật ký', album: 'Album ảnh', doing: 'Trạng thái', guestbook: 'Lưu bút' };
const privGet = (userDoc, section) => {
  const v = userDoc && userDoc.privacy ? userDoc.privacy.get(section) : null;
  return ['public', 'friends', 'private'].includes(v) ? v : 'public';
};
const canViewSection = (ownerDoc, section, rel) => {
  if (rel === 'self') return true;
  const v = privGet(ownerDoc, section);
  if (v === 'public') return true;
  if (v === 'friends') return rel === 'friends';
  return false;
};
// Quan hệ self|friends|none giữa me và owner (dùng cho privacy từng phần)
const relOf = async (me, ownerId) => {
  if (String(me) === String(ownerId)) return 'self';
  const { Friendship } = require('./models');
  const f = await Friendship.findOne({ status: 'accepted', $or: [{ from: me, to: ownerId }, { from: ownerId, to: me }] }).select('_id').lean();
  return f ? 'friends' : 'none';
};
module.exports = { friendIds, visQ, esc, blockedBetween, blockedIds, feedOptOutIds, PRIV_SECTIONS, PRIV_LABELS, privGet, canViewSection, relOf };
