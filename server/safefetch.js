/* Fetch chống SSRF: chặn mọi địa chỉ IP nội bộ / loopback / link-local ở từng bước,
   kể cả khi server đổi hướng (redirect) sang host khác. Dùng cho mọi chỗ server tự
   fetch URL do người dùng nhập (import RSS, ...).
   Chống DNS rebinding: resolve DNS MỘT lần, kiểm tra TẤT CẢ IP, rồi ghim (pin) IP
   khi kết nối — không tra DNS lại, kẻ tấn công không thể tráo IP giữa lúc kiểm tra
   và lúc kết nối (TOCTOU). */
const dns = require('dns').promises, net = require('net');
const http = require('http'), https = require('https');

const ipBlocked = (ip) => {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const b = ip.split('.').map(Number);
    if (b.length !== 4 || b.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, o2, o3, o4] = b;
    if (a === 0 || a === 10 || a === 127) return true;                       // 0/8, 10/8, 127/8
    if (a === 100 && o2 >= 64 && o2 <= 127) return true;                    // 100.64/10 CGNAT
    if (a === 169 && o2 === 254) return true;                               // 169.254/16 link-local
    if (a === 172 && o2 >= 16 && o2 <= 31) return true;                     // 172.16/12
    if (a === 192 && o2 === 168) return true;                               // 192.168/16
    if (a === 192 && o2 === 0 && o3 === 0) return true;                     // 192.0.0.0/24 IETF
    if (a === 192 && o2 === 0 && o3 === 2) return true;                     // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && o2 === 88 && o3 === 99) return true;                   // 192.88.99.0/24 6to4 relay
    if (a === 198 && o2 >= 18 && o2 <= 19) return true;                     // 198.18.0.0/15 benchmarking
    if (a === 198 && o2 === 51 && o3 === 100) return true;                  // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && o2 === 0 && o3 === 113) return true;                   // 203.0.113.0/24 TEST-NET-3
    return false;
  }
  if (fam === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;                            // loopback, unspecified
    if (/^fe[89ab][0-9a-f]:/.test(l)) return true;                         // fe80::/10 link-local
    if (/^f[c-d]/.test(l)) return true;                                    // fc00::/7 unique-local
    if (/^2001:db8:/.test(l)) return true;                                 // 2001:db8::/32 documentation
    if (/^64:ff9b:/.test(l)) return true;                                  // 64:ff9b::/96 NAT64
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);                     // IPv4-mapped
    if (m) return ipBlocked(m[1]);
    return false;
  }
  return true;   // không parse được -> chặn cho chắc
};

/* Resolve hostname -> TẤT CẢ IP, chặn nếu BẤT KỲ IP nào không an toàn
   (chống round-robin DNS: IP thứ 2..n cũng phải sạch). Trả về IP đầu tiên đã kiểm tra. */
const resolveSafeIp = async (hostname) => {
  if (net.isIP(hostname)) {
    if (ipBlocked(hostname)) throw new Error('blocked');
    return hostname;
  }
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); }
  catch { throw new Error('blocked'); }
  if (!addrs.length) throw new Error('blocked');
  for (const a of addrs) if (ipBlocked(a.address)) throw new Error('blocked');
  return addrs[0].address;
};

/* Request với DNS đã ghim: custom lookup luôn trả IP đã kiểm tra, SNI + Host header
   giữ hostname gốc để TLS verify đúng certificate. Trả về object tối giản giống fetch
   Response (ok/status/headers.get/text) đủ cho các caller hiện tại. */
const pinnedRequest = (url, ip, { timeoutMs = 8000, headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  const req = mod.request({
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method,
    headers: { ...headers, Host: u.hostname },
    servername: u.hostname,                        // SNI: TLS dùng hostname gốc để verify cert
    lookup: (_host, _opts, cb) => cb(null, ip, net.isIP(ip)),   // ghim DNS: không tra lại
    timeout: timeoutMs,
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks);
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null },
        text: async () => body.toString('utf8'),
      });
    });
    res.on('error', reject);
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end();
});

/* Fetch an toàn: redirect manual, resolve + ghim DNS ở MỖI bước (chống redirect sang IP
   nội bộ lẫn DNS rebinding), tối đa maxRedirects bước. Ném Error với message chung chung
   để không tạo oracle dò port. */
const safeFetch = async (url, { timeoutMs = 8000, maxRedirects = 5, headers = {} } = {}) => {
  let cur = String(url || '');
  for (let i = 0; i <= maxRedirects; i++) {
    let u;
    try { u = new URL(cur); } catch { throw new Error('bad-url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad-url');
    const ip = await resolveSafeIp(u.hostname);   // ném 'blocked' nếu IP không an toàn
    const r = await pinnedRequest(cur, ip, { timeoutMs, headers });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
    return r;
  }
  throw new Error('too-many-redirects');
};

module.exports = { safeFetch, ipBlocked, resolveSafeIp };
