/* Mã xác nhận chống bot (seccode của UCHome): captcha phép tính đơn giản dạng SVG,
   dùng cho đăng ký / đăng nhập. Lưu đáp án trong bộ nhớ 5 phút, mỗi mã dùng một lần. */
const crypto = require('crypto');
const store = new Map();   // id -> { answer, exp }
const TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
}, 60 * 1000).unref?.();

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function make() {
  const a = rnd(1, 20), b = rnd(1, 20), op = pick(['+', '-', '×']);
  let answer, text;
  if (op === '+') { answer = a + b; text = `${a} + ${b}`; }
  else if (op === '-') { const x = Math.max(a, b), y = Math.min(a, b); answer = x - y; text = `${x} − ${y}`; }
  else { const x = rnd(2, 9), y = rnd(2, 9); answer = x * y; text = `${x} × ${y}`; }
  const id = crypto.randomBytes(8).toString('hex');
  // nhiễu nhẹ: xoay từng ký tự, thêm chấm nhiễu
  const chars = [...text].map((ch, i) => {
    const r = rnd(-12, 12), dy = rnd(-4, 4), fs = rnd(22, 30);
    const fill = `hsl(${rnd(0, 360)},${rnd(30, 70)}%,${rnd(25, 45)}%)`;
    return `<text x="${18 + i * 22}" y="${34 + dy}" font-size="${fs}" font-family="monospace" font-weight="bold" fill="${fill}" transform="rotate(${r} ${18 + i * 22} 34)">${ch}</text>`;
  }).join('');
  const dots = Array.from({ length: 24 }, () =>
    `<circle cx="${rnd(4, 196)}" cy="${rnd(4, 46)}" r="${rnd(1, 2)}" fill="hsl(${rnd(0, 360)},60%,70%)"/>`).join('');
  const lines = Array.from({ length: 3 }, () =>
    `<line x1="${rnd(0, 200)}" y1="${rnd(0, 50)}" x2="${rnd(0, 200)}" y2="${rnd(0, 50)}" stroke="hsl(${rnd(0, 360)},60%,75%)" stroke-width="1"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50" viewBox="0 0 200 50"><rect width="200" height="50" fill="#f7f7f2"/>${lines}${dots}${chars}</svg>`;
  store.set(id, { answer: String(answer), exp: Date.now() + TTL });
  return { id, svg: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) };
}

function check(id, input) {
  if (!id || input === undefined || input === null) return false;
  const v = store.get(String(id));
  store.delete(String(id));   // mỗi mã chỉ dùng một lần
  if (!v || v.exp < Date.now()) return false;
  return String(input).trim() === v.answer;
}

module.exports = { make, check };
