/* Test front-end sau khi chuyển sang Vite: index.html ở gốc trỏ tới entry/CSS có thật, không có <script> inline
   (điều kiện để CSP không cần 'unsafe-inline'), mọi import tương đối trong src/ đều trỏ tới file tồn tại. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('index.html có đúng 1 entry module /src/main.js và file đó tồn tại', () => {
  const mods = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mods, ['/src/main.js']);
  assert.ok(fs.existsSync(path.join(root, 'src/main.js')));
});
test('không có <script> inline và không nạp Tailwind/Vue từ CDN', () => {
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]) && m[2].trim());
  assert.equal(inline.length, 0);
  assert.ok(!/cdn\.tailwindcss\.com/.test(html) && !/vue(\.global)?[^"]*\.js/.test(html.replace(/\/src\/[\w./-]+/g, '')));
});
test('CSS nguồn tồn tại, Tailwind nằm cuối <head>', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  const css = [...head.matchAll(/<link rel="stylesheet" href="(\/[^"?]+)/g)].map((m) => m[1]);
  for (const c of css) assert.ok(fs.existsSync(path.join(root, c.startsWith('/src/') ? c : 'static' + c)), 'thiếu ' + c);
  assert.equal(css[css.length - 1], '/src/css/tailwind.css');
});
test('mọi import tương đối trong src/ trỏ tới file có thật; mount.js được nạp cuối cùng', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(root, 'src')))
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:^|\n)import[^'"\n]*['"](\.[^'"]+)['"]/g))
      assert.ok(fs.existsSync(path.resolve(path.dirname(f), m[1])), `${path.relative(root, f)} import thiếu ${m[1]}`);
  const lines = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8').trim().split('\n');
  assert.match(lines[lines.length - 1], /mount\.js/);
});

test('Ably được bundle qua Vite (import động), không nạp từ CDN / window.Ably', () => {
  const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.ok(!/ably/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html không được nhắc tới Ably CDN');
  assert.match(app, /import\('ably'\)/);
  assert.ok(!/window\.Ably/.test(app));
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies.ably, 'ably phải nằm trong dependencies để Vite bundle');
});
