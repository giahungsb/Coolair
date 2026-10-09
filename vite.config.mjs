import { defineConfig } from 'vite';
import { vuePrecompile } from './scripts/vite-vue-precompile.mjs';
// Nguồn tĩnh (sw.js, manifest, icon, img, neo.css, theme-init.js) ở static/ -> copy nguyên vào public/.
// Build ra public/ để Express (express.static) và Vercel (serve public/) chạy y như trước, không cần đổi server.

// Chẩn đoán: báo module nào còn gọi `require(` trần trong bản build (trình duyệt không có require -> "require is not defined").
// Chỉ cảnh báo trong log build (Vercel > Deployments > Build Logs), không làm hỏng build.
function warnBareRequire() {
  const re = /(^|[^\w$.'"`])require\s*\(/;
  return {
    name: 'coolair:warn-bare-require',
    generateBundle(_o, bundle) {
      for (const [file, ch] of Object.entries(bundle)) {
        if (ch.type !== 'chunk') continue;
        for (const [id, m] of Object.entries(ch.modules || {})) {
          const code = m.code || '', i = code.search(re);
          if (i >= 0) this.warn(`[bare-require] ${file} <- ${id}\n  ...${code.slice(Math.max(0, i - 60), i + 100).replace(/\n/g, ' ')}...`);
        }
      }
    },
  };
}
export default defineConfig({
  publicDir: 'static',
  resolve: { alias: { vue: 'vue/dist/vue.runtime.esm-bundler.js' } },   // ghim bản runtime-only (không compiler) -> CSP không cần 'unsafe-eval'. KHÔNG đổi sang vue.esm-bundler.js (bản có compiler)
  // Template Vue (index.html #app + `template:` trong src/) được biên dịch lúc build -> dùng Vue runtime-only, CSP không cần 'unsafe-eval'.
  plugins: [vuePrecompile(), warnBareRequire()],
  optimizeDeps: { include: ['ably'] },   // import('ably') nạp động -> pre-bundle sẵn ở `npm run dev:web`
  define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false },
  build: {
    outDir: 'public', emptyOutDir: true, target: 'es2020',
    rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].mjs', chunkFileNames: 'assets/[name]-[hash].mjs', manualChunks: (id) => (/node_modules\/(@vue|vue)\//.test(id) ? 'vue' : undefined) } },   // Vue tách chunk riêng: ít đổi nên trình duyệt cache lâu
  },
  // `npm run dev` (Express :3000) + `npm run dev:web` (Vite :5173, tự proxy /api). Không bật changeOrigin: kiểm tra Origin chống CSRF ở app.js cần Host khớp Origin.
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
