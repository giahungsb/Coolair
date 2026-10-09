/* Plugin Vite: biên dịch TRƯỚC (lúc build) mọi template Vue thành render function -> dùng được bản Vue runtime-only,
   CSP không cần 'unsafe-eval' (trình biên dịch template của Vue chạy bằng new Function).
   Hai nguồn template của dự án:
   1) template gốc của #app nằm trong index.html  -> module ảo `virtual:app-template` (export default render) + bỏ khỏi HTML xuất ra
   2) `template:` (chuỗi/backtick) trong các component ở src/ -> đổi thành `render:` ngay trong mã nguồn khi bundle
   Sinh mã ở dạng "function" + prefixIdentifiers (đúng cách trình biên dịch lúc chạy của Vue làm, nhưng không dùng `with`, hợp module strict).
   QUY ƯỚC cho người viết template: không nội suy ${...} trong template: literal (không biên dịch tĩnh được -> build báo lỗi). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const VIRTUAL_ID = 'virtual:app-template';

/** Tách <div id="app" ...>NỘI DUNG</div> khỏi index.html. Trả { head, inner, tail }: head = thẻ mở, tail bắt đầu từ </div> đóng. */
export function splitAppHtml(html) {
  const start = html.indexOf('<div id="app"');
  if (start < 0) throw new Error('index.html: không thấy <div id="app">');
  let i = start, q = '';
  for (; i < html.length; i++) {   // hết thẻ mở: bỏ qua '>' nằm trong giá trị thuộc tính có nháy
    const c = html[i];
    if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
  }
  const bodyStart = i + 1;
  const re = /<!--[\s\S]*?-->|<div\b|<\/div\s*>/gi;
  re.lastIndex = bodyStart;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[0][1] === '/') { if (--depth === 0) break; } else depth++;
  }
  if (depth !== 0 || !m) throw new Error('index.html: <div id="app"> không có thẻ đóng </div> tương ứng');
  return { head: html.slice(0, bodyStart), inner: html.slice(bodyStart, m.index), tail: html.slice(m.index) };
}

/** Lấy hàm compile của @vue/compiler-dom đúng phiên bản đi kèm gói vue (kể cả pnpm). */
export async function loadCompiler() {
  let vuePkg;
  try { vuePkg = createRequire(import.meta.url).resolve('vue/package.json'); }
  catch { throw new Error('Không tìm thấy gói "vue" — chạy npm install trước khi build.'); }
  return createRequire(vuePkg)('@vue/compiler-dom').compile;
}

/** Template -> thân hàm JS (có `return function render(_ctx,_cache){...}`), tham chiếu biến `Vue`. */
export function compileToFnCode(compile, source, where) {
  const { code } = compile(source, {
    mode: 'function', prefixIdentifiers: true, hoistStatic: true, cacheHandlers: true,
    onError: (e) => { throw new Error(`[vue-precompile] ${where}: ${e.message}` + (e.loc ? ` (dòng ${e.loc.start.line} của template)` : '')); },
    onWarn: () => {},
  });
  return code;
}
const wrapRender = (code) => `((Vue) => {\n${code}\n})(__vue_ns)`;

const TPL_RE = /\btemplate\s*:\s*(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/g;
/** Đổi mọi `template: <literal>` trong một file JS thành `render: <render function đã biên dịch>`. */
export function rewriteTemplates(code, compile, where = 'module') {
  let count = 0;
  const out = code.replace(TPL_RE, (all, lit) => {
    if (lit[0] === '`' && lit.includes('${')) throw new Error(`[vue-precompile] ${where}: template có \${...} — viết thẳng nội dung vào template (không nội suy) để biên dịch được lúc build.`);
    const source = new Function('return ' + lit)();   // lấy giá trị thật của literal (xử lý \n, \', \` ...) — chạy ở Node lúc build, không phải trình duyệt
    count++;
    return 'render:' + wrapRender(compileToFnCode(compile, source, `${where} (template #${count})`));
  });
  if (/\btemplate\s*:\s*[`'"]/.test(out)) throw new Error(`[vue-precompile] ${where}: còn template chưa biên dịch được`);
  return { code: count ? "import * as __vue_ns from 'vue';\n" + out : out, count };
}

export function vuePrecompile(opts = {}) {
  const indexName = opts.index || 'index.html';
  const RESOLVED = '\0' + VIRTUAL_ID;
  let root = process.cwd(), compile = opts.compile || null;
  const getCompile = async () => compile || (compile = await loadCompiler());
  const indexPath = () => path.join(root, indexName);
  return {
    name: 'coolair:vue-precompile',
    enforce: 'pre',
    configResolved(cfg) { root = cfg.root; },
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED : null; },
    async load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(indexPath());
      const { inner } = splitAppHtml(fs.readFileSync(indexPath(), 'utf8'));
      const body = compileToFnCode(await getCompile(), inner, `${indexName} #app`);
      return `import * as __vue_ns from 'vue';\nexport default ${wrapRender(body)};\n`;
    },
    // HTML xuất ra chỉ còn thẻ #app rỗng (+ v-cloak): bớt ~150KB, và không còn template thô nằm trong trang
    transformIndexHtml: { order: 'pre', handler(html) { if (!html.includes('<div id="app"')) return html; const s = splitAppHtml(html); return s.head + s.tail; } },
    async transform(code, id) {
      const file = id.split('?')[0];
      if (file.startsWith('\0') || file.includes('/node_modules/') || !file.endsWith('.js') || !file.includes('/src/')) return null;
      if (!/\btemplate\s*:/.test(code)) return null;
      const r = rewriteTemplates(code, await getCompile(), path.relative(root, file));
      return r.count ? { code: r.code, map: null } : null;
    },
    handleHotUpdate({ file, server }) {
      if (path.resolve(file) === path.resolve(indexPath())) {
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
      }
    },
  };
}
