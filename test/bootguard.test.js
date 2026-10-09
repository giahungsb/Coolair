/* Test khung báo lỗi khởi động (static/theme-init.js): app không lên được thì phải hiện lỗi, app lên bình thường thì im lặng. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'theme-init.js'), 'utf8');

function boot(appState) {   // appState: { cloak, kids } mô phỏng #app
  const listeners = {}, appended = [], timers = [];
  const app = { hasAttribute: (n) => n === 'v-cloak' && appState.cloak, get firstElementChild() { return appState.kids ? {} : null; } };
  const el = () => ({ style: {}, kids: [], appendChild(x) { this.kids.push(x); }, remove() { const i = appended.indexOf(this); if (i >= 0) appended.splice(i, 1); } });
  const doc = {
    getElementById: (id) => (id === 'app' ? app : appended.find((x) => x.id === id) || null),
    createElement: () => el(), body: { appendChild: (x) => appended.push(x) }, documentElement: {},
    documentElement_dataset: {},
  };
  doc.documentElement = { dataset: {}, appendChild: (x) => appended.push(x) };
  const win = {
    document: doc, localStorage: { getItem: () => null }, location: { origin: 'https://x.app', reload() {} }, navigator: {},
    fetch: () => Promise.reject(new Error('offline')), URL,
    addEventListener: (t, fn) => { listeners[t] = fn; }, setTimeout: (fn, ms) => { if (!ms || ms < 1000) timers.push(fn); },   // bỏ qua timer 10 giây (kiểm tra riêng)
  };
  vm.runInNewContext(src, Object.assign(win, { window: win }));
  const flush = () => { while (timers.length) timers.shift()(); };
  const text = (n) => (n._pre ? n._pre.textContent : '') ;
  return { win, listeners, appended, flush, text };
}

test('lỗi JS khi #app còn trống -> hiện khung lỗi có nội dung lỗi', () => {
  const b = boot({ cloak: true, kids: false });
  b.listeners.error({ message: 'x is not defined', filename: '/assets/index.js', lineno: 3, colno: 9 });
  b.flush();
  assert.equal(b.appended.length, 1);
  assert.match(b.text(b.appended[0]), /x is not defined/);
});
test('script module 404 / sai MIME (sự kiện error từ thẻ script) -> hiện đường dẫn file hỏng', () => {
  const b = boot({ cloak: true, kids: false });
  b.listeners.error({ target: { src: 'https://x.vercel.app/assets/index-abc.js' } });
  b.flush();
  assert.match(b.text(b.appended[0]), /index-abc\.js/);
});
test('render crash (Vue gọi __bootErr, #app chỉ còn comment) -> hiện lỗi', () => {
  const b = boot({ cloak: false, kids: false });
  b.win.__bootErr('Vue [render function]: TypeError: a is undefined');
  b.flush();
  assert.match(b.text(b.appended[0]), /TypeError: a is undefined/);
});
test('app đã lên (có phần tử con) -> lỗi vặt về sau KHÔNG che màn hình', () => {
  const b = boot({ cloak: false, kids: true });
  b.listeners.error({ message: 'lỗi vặt' });
  b.flush();
  assert.equal(b.appended.length, 0);
});
test('mount.js nối errorHandler + __bootOk; theme-init.js vẫn giữ phần theme cũ', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'mount.js'), 'utf8');
  assert.ok(/app\.config\.errorHandler=/.test(m) && /__bootOk/.test(m));
  assert.ok(/coolair_mode/.test(src));
});

test('khung lỗi có nút "Gỡ service worker + xóa cache" và dòng trạng thái service worker', () => {
  const b = boot({ cloak: true, kids: false });
  b.listeners.error({ message: 'boom' });
  b.flush();
  const d = b.appended[0];
  assert.ok(d.kids.some((k) => /xóa cache/.test(k.textContent) && typeof k.onclick === 'function'));
  assert.match(b.text(d), /Service worker: không/);
});
test('file script hỏng -> tự gọi thử file đó (probe) để báo HTTP/MIME', async () => {
  const calls = [];
  const b = boot({ cloak: true, kids: false });
  b.win.fetch = (u) => { calls.push(u); return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '' }); };
  b.listeners.error({ target: { src: 'https://x.app/assets/index-abc.js' } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  b.flush();
  assert.deepEqual(calls, ['https://x.app/assets/index-abc.js']);
  assert.match(b.text(b.appended[0]), /HTTP 404, text\/html/);
});

test('file /assets/*.js hỏng: lần đầu tự xóa cache + tải lại (không hiện khung lỗi), lần hai mới hiện khung lỗi', async () => {
  const store = {}; let reloads = 0;
  const b = boot({ cloak: true, kids: false });
  b.win.sessionStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  b.win.location.reload = () => { reloads++; };
  b.listeners.error({ target: { src: 'https://x.app/assets/index-old.js' } });
  await new Promise((r) => setImmediate(r)); b.flush();
  assert.equal(reloads, 1); assert.equal(b.appended.length, 0);
  b.listeners.error({ target: { src: 'https://x.app/assets/index-old.js' } });   // sau khi tải lại vẫn hỏng -> báo lỗi thật, không lặp vô hạn
  await new Promise((r) => setImmediate(r)); b.flush();
  assert.equal(reloads, 1); assert.equal(b.appended.length, 1);
  assert.match(b.text(b.appended[0]), /index-old\.js/);
});
test('app lên bình thường -> xóa cờ tải-lại để lần deploy sau lại tự chữa được', () => {
  const store = { ca_boot_reload: '1' };
  const b = boot({ cloak: false, kids: true });
  b.win.sessionStorage = { getItem: (k) => store[k] || null, setItem() {}, removeItem: (k) => { delete store[k]; } };
  b.win.__bootOk();
  assert.equal(store.ca_boot_reload, undefined);
});
