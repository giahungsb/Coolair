/* Tác vụ dọn dẹp định kỳ (port admincp_cron của UCHome): chạy trong tiến trình Node,
   mỗi giờ một lần + chạy ngay khi khởi động. Ghi lại lần chạy cuối để admin theo dõi.
   (Các collection đã có TTL index — Revoked, Notification, Visitor, SsoCode — thì Mongo tự xóa.) */
const { User, AdminLog, SiteConfig } = require('./models');

const JOBS = [
  {
    id: 'unverified',
    name: 'Xóa tài khoản chưa xác thực quá 7 ngày',
    run: async () => {
      const r = await User.deleteMany({ verified: false, createdAt: { $lt: new Date(Date.now() - 7 * 864e5) } });
      return (r.deletedCount || 0) + ' tài khoản';
    },
  },
  {
    id: 'adminlog',
    name: 'Dọn nhật ký admin quá 1 năm',
    run: async () => {
      const r = await AdminLog.deleteMany({ createdAt: { $lt: new Date(Date.now() - 365 * 864e5) } });
      return (r.deletedCount || 0) + ' dòng';
    },
  },
  {
    id: 'stale_vcode',
    name: 'Gỡ mã xác thực hết hạn của tài khoản chưa xác thực',
    run: async () => {
      const r = await User.updateMany(
        { verified: false, vExp: { $lt: new Date() } },
        { $unset: { vCode: 1, vExp: 1 }, $set: { vTries: 0 } }
      );
      return (r.modifiedCount || 0) + ' tài khoản';
    },
  },
];

const lastRun = {};   // id -> { at, result, ok }

async function runAll(manual = false) {
  const results = [];
  for (const j of JOBS) {
    try {
      const result = await j.run();
      lastRun[j.id] = { at: new Date(), result, ok: true };
      results.push({ id: j.id, name: j.name, ok: true, result });
    } catch (e) {
      lastRun[j.id] = { at: new Date(), result: e.message, ok: false };
      results.push({ id: j.id, name: j.name, ok: false, result: e.message });
    }
  }
  await SiteConfig.updateOne({ key: 'cron_last' }, { $set: { value: new Date().toISOString() } }, { upsert: true });
  if (!manual) console.log('[cron] dọn dẹp xong:', results.map((r) => `${r.id}: ${r.result}`).join(' | '));
  return results;
}

let _t1 = null, _t2 = null;
function start() {
  // chạy một lần sau khi khởi động 30 giây (đợi DB sẵn sàng), rồi mỗi giờ
  // Lưu ý: trên serverless (Vercel) tiến trình không chạy liên tục nên cron nội bộ không đáng tin cậy;
  // hãy dùng Vercel Cron Jobs gọi POST /admin/cron/run (cần quyền admin) hoặc bấm "Chạy ngay" trong trang quản trị.
  _t1 = setTimeout(() => runAll(false).catch((e) => console.error('[cron]', e.message)), 30 * 1000);
  _t2 = setInterval(() => runAll(false).catch((e) => console.error('[cron]', e.message)), 3600 * 1000);
  if (_t1.unref) _t1.unref();
  if (_t2.unref) _t2.unref();
  if (typeof process !== 'undefined' && process.on) {
    const bye = () => { if (_t1) clearTimeout(_t1); if (_t2) clearInterval(_t2); };
    process.on('SIGTERM', () => { bye(); process.exit(0); });
    process.on('SIGINT', () => { bye(); process.exit(0); });
  }
}

async function status() {
  const row = await SiteConfig.findOne({ key: 'cron_last' }).lean();
  return { jobs: JOBS.map((j) => ({ id: j.id, name: j.name, last: lastRun[j.id] || null })), lastAll: row ? row.value : null };
}

module.exports = { start, runAll, status, JOBS };
