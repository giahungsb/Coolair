// Tạo cặp khóa VAPID cho Web Push:  node server/genvapid.js   -> dán 2 dòng in ra vào .env / biến môi trường Vercel
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const j = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]);
console.log('VAPID_PUBLIC_KEY=' + pub.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + j.d);
console.log('VAPID_SUBJECT=mailto:you@example.com');
