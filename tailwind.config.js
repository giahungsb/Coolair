/* Cấu hình Tailwind v3 (thay cho tailwind-config.js + CDN). Build: npm run build (Vite + PostCSS) -> public/assets/*.css */
module.exports = {
  content: ['./index.html', './src/**/*.js', '!./src/lib/images.js'],   // lớp CSS nằm cả trong template (index.html) lẫn chuỗi template trong src/
  theme: { extend: { colors: { zb: 'var(--zb)', zb2: 'var(--zb2)', zg: 'var(--zg)', bg: 'var(--bg)', card: 'var(--card)', ink: 'var(--ink)', mute: 'var(--mute)', line: 'var(--line)' } } },
};
