/* Chặn lỗi "file che thư mục": Node ưu tiên server/routes.js hơn server/routes/index.js khi viết require('./server/routes').
   Nếu file cũ bị chép lại vào, API mới (/checkins, tick xanh, lưu location...) âm thầm biến mất. */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

test('không có server/routes.js che mất thư mục server/routes/', () => {
  assert.ok(!fs.existsSync(path.join(root, 'server', 'routes.js')), 'Xóa server/routes.js (bản cũ) — nó che server/routes/index.js');
  assert.ok(fs.existsSync(path.join(root, 'server', 'routes', 'index.js')));
});

test('app.js nạp đường dẫn tường minh server/routes/index.js', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /require\('\.\/server\/routes\/index\.js'\)/);
});
