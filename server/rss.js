/* RSS – xuất nội dung công khai (port từ UCenter Home rss.php):
   /api/rss.xml = nhật ký công khai mới nhất toàn site,
   /api/rss/user/:id.xml = nhật ký công khai của một người. */
const { User, Blog } = require('./models');

const escXml = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const feed = (title, link, items) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escXml(title)}</title><link>${escXml(link)}</link>` +
  `<description>${escXml(title)}</description><language>vi</language>` +
  items.map((b) => `<item><title>${escXml(b.title)}</title><link>${escXml(link)}/#blog-${b._id}</link>` +
    `<guid>${escXml(link)}/#blog-${b._id}</guid><pubDate>${new Date(b.createdAt).toUTCString()}</pubDate>` +
    `<description>${escXml(String(b.text || '').slice(0, 500))}</description></item>`).join('') +
  `</channel></rss>`;

module.exports = (router, { wrap }) => {
  const base = () => (process.env.SITE_URL || '').replace(/\/$/, '');

  router.get('/rss.xml', wrap(async (req, res) => {
    const blogs = await Blog.find({ visibility: 'public' }).sort({ createdAt: -1 }).limit(20).select('title text createdAt').lean();
    res.type('application/rss+xml').send(feed('CoolAir – Nhật ký mới', base(), blogs));
  }));

  router.get('/rss/user/:id.xml', wrap(async (req, res) => {
    const u = await User.findById(req.params.id).select('name').lean();
    if (!u) return res.status(404).type('text/plain').send('Không tìm thấy.');
    const blogs = await Blog.find({ owner: u._id, visibility: 'public' }).sort({ createdAt: -1 }).limit(20).select('title text createdAt').lean();
    res.type('application/rss+xml').send(feed(`CoolAir – Nhật ký của ${u.name}`, base(), blogs));
  }));
};
