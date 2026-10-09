/* Đồng bộ CSP từ server/csp.js vào vercel.json. Chạy: npm run csp:sync
   (Vercel đọc vercel.json tĩnh lúc deploy, nên không require() trực tiếp được.) */
const fs = require('fs'), path = require('path');
const { directives, toHeaderString } = require('../server/csp');

const vercelPath = path.join(__dirname, '..', 'vercel.json');
const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const csp = toHeaderString(directives);

let updated = false;
for (const entry of vercel.headers || []) {
  for (const hdr of entry.headers || []) {
    if (String(hdr.key || '').toLowerCase() === 'content-security-policy' && hdr.value !== csp) {
      hdr.value = csp;
      updated = true;
    }
  }
}
if (updated) {
  fs.writeFileSync(vercelPath, JSON.stringify(vercel));
  console.log('[csp:sync] vercel.json CSP đã cập nhật.');
} else {
  console.log('[csp:sync] vercel.json CSP đã đồng bộ, không cần đổi.');
}
