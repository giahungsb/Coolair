/* Bộ lọc từ ngữ (port admincp_censor của UCHome): danh sách từ cấm -> thay bằng replacement.
   Áp dụng khi đăng bài/blog/doing/share/bình luận. */
const { CensorWord } = require('./models');

let cache = null, cacheAt = 0;
const load = async (force) => {
  if (!force && cache && Date.now() - cacheAt < 60000) return cache;
  const words = await CensorWord.find().select('word replacement').lean();
  cache = words.map((w) => ({ rx: new RegExp(escapeRx(w.word), 'gi'), rep: w.replacement || '***' }));
  cacheAt = Date.now();
  return cache;
};
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const filter = async (text) => {
  if (!text) return text;
  const ws = await load();
  let out = String(text);
  for (const w of ws) out = out.replace(w.rx, w.rep);
  return out;
};
const bust = () => { cache = null; };

module.exports = (router, { auth, wrap, fail, S, isAdmin, alog }) => {
  const adminOnly = wrap(async (req, res, next) => {
    const { User } = require('./models');
    const u = await User.findById(req.uid).select('email');
    if (!u || !isAdmin(u)) return fail(res, 'Bạn không có quyền quản trị.', null, 403);
    next();
  });

  router.get('/admin/censor', auth, adminOnly, wrap(async (req, res) => {
    const words = await CensorWord.find().sort({ word: 1 }).lean();
    res.json({ words: words.map((w) => ({ id: String(w._id), word: w.word, replacement: w.replacement })) });
  }));
  router.post('/admin/censor', auth, adminOnly, wrap(async (req, res) => {
    const word = S(req.body.word).trim().slice(0, 60);
    if (word.length < 2) return fail(res, 'Từ cấm cần ít nhất 2 ký tự.');
    const replacement = S(req.body.replacement).trim().slice(0, 60) || '***';
    try {
      const w = await CensorWord.create({ word, replacement });
      bust(); alog(req.uid, 'censor_add', word, '-> ' + replacement);
      res.status(201).json({ word: { id: String(w._id), word: w.word, replacement: w.replacement } });
    } catch (e) { if (e.code === 11000) return fail(res, 'Từ này đã có trong danh sách.', null, 409); throw e; }
  }));
  router.delete('/admin/censor/:id', auth, adminOnly, wrap(async (req, res) => {
    const w = await CensorWord.findByIdAndDelete(req.params.id);
    if (!w) return fail(res, 'Không tìm thấy.', null, 404);
    bust(); alog(req.uid, 'censor_del', w.word);
    res.json({ ok: true });
  }));
};

module.exports.filter = filter;
module.exports.bust = bust;
