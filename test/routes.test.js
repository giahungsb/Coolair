/* Bảo vệ cấu trúc server/routes/: thứ tự mount + cổng đăng nhập + cron của Vercel.
   Không cần MongoDB/express: giả router để ghi lại thứ tự đăng ký (mọi module ngoài routes/ bị thay bằng proxy rỗng). */
const test = require('node:test'), assert = require('node:assert'), Module = require('module'), path = require('path'), fs = require('fs');

const entry = path.join(__dirname, '..', 'server', 'routes', 'index.js');
const log = [];
const rec = new Proxy({}, { get: (_, m) => (...a) => { log.push(m + ' ' + (typeof a[0] === 'string' ? a[0] : '<fn>')); return rec; } });
const mk = (name) => new Proxy(function () {}, {
  get: (_, p) => (p === Symbol.toPrimitive ? () => name : p === 'then' ? undefined : mk(name + '.' + String(p))),
  apply: (_, __, a) => { if (a[0] === rec) log.push('MOUNT ' + name.replace(/^\.\.?\//, '')); return mk(name + '()'); },
  construct: () => mk('new ' + name),
});
const orig = Module._load;
Module._load = function (req, parent) {
  if (req === 'express') return { Router: () => rec };
  if (/^\.\.?\//.test(req)) {
    const abs = path.resolve(path.dirname(parent.filename), req);
    if (abs.startsWith(path.join(__dirname, '..', 'server', 'routes'))) return orig.apply(this, arguments);   // module trong routes/ -> nạp thật
    return mk(req);
  }
  if (req === entry) return orig.apply(this, arguments);
  return mk(req);
};
require(entry);
Module._load = orig;

const at = (s) => log.indexOf(s);
const gate = log.findIndex((l) => l === 'use <fn>');

test('có cổng router.use(auth) và đủ route', () => {
  assert.ok(gate > 0);
  assert.ok(log.length >= 85, 'số route/mount giảm bất thường: ' + log.length);
});
test('/sso/* và /invites/check phải đứng TRƯỚC cổng auth', () => {
  assert.ok(at('MOUNT sso') > -1 && at('MOUNT sso') < gate);
  assert.ok(at('MOUNT social.mountPublic') > -1 && at('MOUNT social.mountPublic') < gate);
});
test('đăng nhập / đăng ký / đăng xuất nằm trước cổng; API cần đăng nhập nằm sau', () => {
  for (const r of ['post /auth/login', 'post /auth/register', 'post /auth/logout']) assert.ok(at(r) > -1 && at(r) < gate, r);
  for (const r of ['get /posts', 'get /sessions', 'get /friends', 'MOUNT album', 'MOUNT admin']) assert.ok(at(r) > gate, r);
});
test('mọi module con vẫn được mount đúng một lần', () => {
  for (const m of ['upload', 'album', 'blog', 'events', 'polls', 'search', 'doing', 'share', 'credit', 'topic', 'discover', 'moderate', 'rss', 'import', 'magic', 'aconfig', 'censor', 'amod', 'pf_forum', 'pf_music', 'pf_video', 'pf_quiz', 'pf_pages', 'pf_extra', 'groups', 'admin'])
    assert.strictEqual(log.filter((l) => l === 'MOUNT ' + m).length, 1, m);
});
test('/cron/cleanup phải qua được cổng auth (Vercel Cron gọi bằng CRON_SECRET, không có phiên)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'gate.js'), 'utf8');
  const rx = eval(src.match(/const PUBLIC_API = (\/.*\/);/)[1]);
  assert.ok(rx.test('/cron/cleanup'));
  assert.ok(!rx.test('/posts') && !rx.test('/friends'));
});
