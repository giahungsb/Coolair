/* Test cấu hình Vercel: gói Hobby chỉ cho cron chạy tối đa 1 lần/ngày, lịch dày hơn làm DEPLOY THẤT BẠI.
   Chạy: npm test (không cần MongoDB). Nếu nâng lên gói Pro và cần dày hơn, sửa test này cùng vercel.json. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vercel = require('../vercel.json');

test('mọi cron trong vercel.json chạy tối đa 1 lần/ngày (minute + hour là số cố định)', () => {
  assert.ok(Array.isArray(vercel.crons) && vercel.crons.length > 0);
  for (const c of vercel.crons) {
    const f = String(c.schedule).trim().split(/\s+/);
    assert.equal(f.length, 5, 'cron phải có 5 trường: ' + c.schedule);
    assert.match(f[0], /^\d{1,2}$/, `"${c.schedule}": phút phải là 1 số cố định (không dùng * , - /) -> Hobby từ chối deploy`);
    assert.match(f[1], /^\d{1,2}$/, `"${c.schedule}": giờ phải là 1 số cố định (không dùng * , - /) -> Hobby từ chối deploy`);
  }
});
test('cron của Vercel trỏ đúng endpoint dọn dẹp', () => {
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/cleanup'));
});
