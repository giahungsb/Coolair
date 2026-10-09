/* Test plugin biên dịch template Vue lúc build (scripts/vite-vue-precompile.mjs) -> cho phép bỏ 'unsafe-eval' khỏi CSP.
   Phần "giả compile" chạy ở mọi máy; phần "compile thật" tự chạy khi đã npm install (có gói vue) và là bước kiểm tra
   quan trọng nhất: mọi template của dự án phải biên dịch được bằng @vue/compiler-dom TRƯỚC khi deploy. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const mod = () => import('../scripts/vite-vue-precompile.mjs');
const fake = (src) => ({ code: 'return function render(_ctx,_cache){return ' + JSON.stringify(src) + '}' });   // giả compile: chỉ để thử phần ghép mã
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const run = (code) => { const ctx = { __vue_ns: {}, out: null }; vm.runInNewContext(code.replace("import * as __vue_ns from 'vue';", '') , ctx); return ctx; };

test('splitAppHtml: thẻ mở có > trong thuộc tính, div lồng nhau, comment chứa <div>', async () => {
  const { splitAppHtml } = await mod();
  const s = splitAppHtml('<body><div id="app" v-cloak :class="{a:x>1}"><div><!-- <div> --><p>hi</p></div><span/></div>\n<script src="/x.js"></script></body>');
  assert.equal(s.head, '<body><div id="app" v-cloak :class="{a:x>1}">');
  assert.equal(s.inner, '<div><!-- <div> --><p>hi</p></div><span/>');
  assert.ok(s.tail.startsWith('</div>\n<script'));
});
test('splitAppHtml trên index.html thật: lấy đúng nội dung #app, phần sau chỉ còn comment/script/đóng trang', async () => {
  const { splitAppHtml } = await mod();
  const s = splitAppHtml(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.ok(s.head.endsWith('>') && s.head.includes('id="app"'));
  assert.ok(s.inner.includes('v-if="booting"') && s.inner.length > 50000);
  const rest = s.tail.replace(/^<\/div>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*><\/script>/g, '').replace(/\s+/g, '');
  assert.equal(rest, '</body></html>');
});
test('rewriteTemplates: backtick + nháy đơn, giải mã escape, thành render, không còn template:', async () => {
  const { rewriteTemplates } = await mod();
  const src = "const A={data(){return{}},template:`<b>a\\nb \\`q\\`</b>`};\nconst B={props:['x'], template:'<i title=\"it\\'s\">{{x}}</i>'};export{A,B};";
  const seen = [];
  const r = rewriteTemplates(src, (s) => { seen.push(s); return fake(s); }, 't.js');
  assert.equal(r.count, 2);
  assert.deepEqual(seen, ['<b>a\nb `q`</b>', '<i title="it\'s">{{x}}</i>']);
  assert.ok(!/template\s*:/.test(r.code) && r.code.startsWith("import * as __vue_ns from 'vue';"));
  const ctx = run(r.code.replace(/export\{A,B\};/, 'out=[A,B];'));
  assert.equal(typeof ctx.out[0].render, 'function');
  assert.equal(ctx.out[1].render(), '<i title="it\'s">{{x}}</i>');
});
test('rewriteTemplates: template có ${...} bị từ chối (không biên dịch tĩnh được)', async () => {
  const { rewriteTemplates } = await mod();
  assert.throws(() => rewriteTemplates('const A={template:`<b>${x}</b>`};', fake, 'a.js'), /nội suy|\$\{/);
});
test('mọi file trong src/: không còn template literal nào chưa biên dịch được (và không có ${} trong template)', async () => {
  const { rewriteTemplates } = await mod();
  let total = 0;
  for (const f of walk(path.join(root, 'src'))) total += rewriteTemplates(fs.readFileSync(f, 'utf8'), fake, path.relative(root, f)).count;
  assert.ok(total >= 25, 'số template tìm thấy thấp bất thường: ' + total);
});
test('không dùng eval / new Function / Vue.compile trong src/ (sẽ bị CSP chặn)', () => {
  for (const f of walk(path.join(root, 'src'))) {
    const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(|\bVue\.compile\b|\bsetTimeout\s*\(\s*['"`]/.test(s), 'eval-like trong ' + path.relative(root, f));
  }
});
test('app.js dùng render đã biên dịch và vite.config không còn alias bản Vue có compiler', () => {
  assert.match(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), /createApp\(\{render:appRender,setup/);
  const v = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8');
  assert.ok(/vuePrecompile\(\)/.test(v));
  assert.ok(!/vue\/dist\/vue\.(esm-bundler|esm-browser|global|cjs)/.test(v), 'không được alias vue sang bản có compiler (cần unsafe-eval)');
  if (/alias/.test(v)) assert.ok(/vue\.runtime\.esm-bundler\.js/.test(v), 'alias vue chỉ được trỏ tới bản runtime-only');
});

let hasVue = true; try { require.resolve('vue/package.json'); } catch { hasVue = false; }
test('COMPILE THẬT bằng @vue/compiler-dom: #app + mọi template component đều biên dịch được và mã sinh ra hợp lệ', { skip: !hasVue && 'chưa npm install (không có gói vue)' }, async () => {
  const { loadCompiler, splitAppHtml, rewriteTemplates, compileToFnCode } = await mod();
  const compile = await loadCompiler();
  const body = compileToFnCode(compile, splitAppHtml(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).inner, 'index.html #app');
  assert.equal(typeof new Function('Vue', body), 'function');
  assert.ok(/return function render\(_ctx, _cache\)/.test(body) && !/\bwith\s*\(/.test(body), 'mã sinh ra phải chạy được trong module strict (không có with)');
  const checked = (src, o) => { const r = compile(src, o); new Function('Vue', r.code); return r; };   // mỗi template: biên dịch được + mã sinh ra hợp lệ
  let total = 0;
  for (const f of walk(path.join(root, 'src'))) total += rewriteTemplates(fs.readFileSync(f, 'utf8'), checked, path.relative(root, f)).count;
  assert.ok(total >= 25);
});
