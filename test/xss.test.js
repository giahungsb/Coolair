/* Test chống XSS: escH + mentH (dùng cho v-html ở CTx và innerHTML ở gợi ý @mention).
   Copy nguyên logic từ src/lib/core.js (dòng escH/emoh/mentH). Chạy: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// --- copy từ src/lib/core.js ---
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emoh = (s) => escH(s); // bản test bỏ twemoji (chỉ thêm <img> emoji, không ảnh hưởng XSS)
const mentH = (h) => h.replace(/(^|[^a-z0-9._@\/])@([a-z0-9._]{3,20})/gi, (m, pre, u) => {
  const t = u.replace(/\.+$/, '');
  return t.length < 3 ? m : pre + '<a href="#" class="mt" data-mu="' + t.toLowerCase() + '">@' + t + '</a>' + u.slice(t.length);
});
const mh = (s) => mentH(emoh(s));
// Chỉ cho phép đúng mẫu <a> do mentH sinh ra, còn lại không được có thẻ HTML thô nào
const GOOD_A = /<a href="#" class="mt" data-mu="[a-z0-9._]+">@[A-Za-z0-9._]+<\/a>/g;
const hasRawHtml = (out) => /[<>]/.test(out.replace(GOOD_A, ''));
// --- hết copy ---

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "<img src=x onerror='alert(1)'>",
  '<iframe src=javascript:alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  '<svg onload=alert(1)>',
  '<div style="x:expression(alert(1))">',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '@evil"><svg onload=alert(1)>',
  "@evil' onmouseover='alert(1)",
  '&#x3c;script&#x3e;alert(1)',
  '<marquee loop=1 behavior=slide width=0>',
];

test('escH escape đủ 5 ký tự nguy hiểm', () => {
  assert.equal(escH('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escH(null), '');
  assert.equal(escH(123), '123');
});
test('mentH(emoh()) vô hiệu hóa mọi payload XSS', () => {
  for (const p of PAYLOADS) {
    const out = mh(p);
    assert.equal(hasRawHtml(out), false, `lọt XSS: ${p} -> ${out.slice(0, 120)}`);
  }
});
test('mentH vẫn linkify @mention hợp lệ', () => {
  const out = mh('chào @nguoidung123 nhé');
  assert.match(out, /<a href="#" class="mt" data-mu="nguoidung123">@nguoidung123<\/a>/);
});
test('mentH không linkify mention quá ngắn / email', () => {
  assert.ok(!mh('hi @ab nhé').includes('<a'), 'mention 2 ký tự phải bỏ qua');
  assert.ok(!mh('mail test@example.com').includes('<a'), 'email phải bỏ qua');
});
test('username trong data-mu không thoát được attribute (charset bị khóa)', () => {
  // Mọi giá trị data-mu sinh ra phải thuộc [a-z0-9._] -> không bao giờ chứa " để thoát attribute
  for (const p of ['@evil"x', '@ev"il', '@a"b"cdef', '@user" onmouseover="alert(1)']) {
    const out = mh(p);
    for (const m of out.matchAll(/data-mu="([^"]*)"/g)) {
      assert.match(m[1], /^[a-z0-9._]+$/, `data-mu lọt ký tự lạ: ${p}`);
    }
    assert.equal(hasRawHtml(out), false, `lọt HTML thô: ${p}`);
  }
});
