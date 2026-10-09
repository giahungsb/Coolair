/* Nhập nhật ký từ RSS/Atom (port ý tưởng cp_import của UCHome — bản gốc chỉ hỗ trợ
   các trang blog Trung Quốc cũ đã ngừng hoạt động, nên port thành nhập từ mọi nguồn RSS/Atom) */
const { User, Blog } = require('./models');
const { safeFetch } = require('./safefetch');   // chống SSRF: chặn IP nội bộ ở mọi bước redirect
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const rssLimiter = rateLimit({ store: rlStore('import.rssLimiter'), windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn đã nhập RSS quá nhiều lần, vui lòng thử lại sau 1 giờ.' } });

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m] || m)).replace(/\s+/g, ' ').trim();
const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
};
const pickCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

function parseFeed(xml) {
  const items = [];
  // RSS 2.0
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const it of rssItems) {
    const title = stripTags(pickCdata(pick(it, 'title'))).slice(0, 80);
    const desc = stripTags(pickCdata(pick(it, 'description'))).slice(0, 6000);
    if (title && desc) items.push({ title, text: desc });
    if (items.length >= 20) break;
  }
  // Atom
  if (!items.length) {
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const it of entries) {
      const title = stripTags(pickCdata(pick(it, 'title'))).slice(0, 80);
      let text = pick(it, 'content');
      if (!text) { const s = pick(it, 'summary'); text = s; }
      text = stripTags(pickCdata(text)).slice(0, 6000);
      if (title && text) items.push({ title, text });
      if (items.length >= 20) break;
    }
  }
  return items;
}

module.exports = (router, { auth, wrap, fail, S }) => {
  router.post('/import/rss', auth, rssLimiter, wrap(async (req, res) => {
    const url = S(req.body.url).trim().slice(0, 500);
    if (!/^https?:\/\//i.test(url)) return fail(res, 'URL RSS không hợp lệ (cần bắt đầu bằng http:// hoặc https://).');
    const visibility = ['public', 'friends', 'private'].includes(S(req.body.visibility)) ? S(req.body.visibility) : 'private';
    let xml;
    try {
      const r = await safeFetch(url, { timeoutMs: 15000, headers: { 'User-Agent': 'CoolAirRSS/1.0', Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!r.ok) return fail(res, 'Không tải được nguồn RSS. Kiểm tra lại URL.');
      xml = (await r.text()).slice(0, 2 * 1024 * 1024);
    } catch (e) { return fail(res, 'Không tải được nguồn RSS. Kiểm tra lại URL.'); }   // message chung cho mọi lỗi -> không tạo oracle dò mạng nội bộ
    const items = parseFeed(xml);
    if (!items.length) return fail(res, 'Không đọc được bài viết nào từ nguồn này.');
    const titles = items.map((i) => i.title);
    const existing = new Set((await Blog.find({ owner: req.uid, title: { $in: titles } }).select('title').lean()).map((b) => b.title));
    const fresh = items.filter((i) => !existing.has(i.title));
    if (!fresh.length) return fail(res, 'Mọi bài viết đã được nhập trước đó.');
    const current = await Blog.countDocuments({ owner: req.uid });
    const MAX_BLOGS = 500;
    const room = Math.max(0, MAX_BLOGS - current);
    const toAdd = fresh.slice(0, room);
    if (!toAdd.length) return fail(res, `Bạn đã đạt giới hạn ${MAX_BLOGS} nhật ký.`);
    await Blog.insertMany(toAdd.map((i) => ({ owner: req.uid, title: i.title, text: i.text, visibility, viewNum: 0, commentNum: 0 })));
    res.status(201).json({ ok: true, imported: toAdd.length, skipped: items.length - toAdd.length });
  }));
};
