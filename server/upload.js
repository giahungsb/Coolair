/* Upload ảnh qua Cloudinary – trình duyệt tải THẲNG lên Cloudinary bằng chữ ký do server cấp.
   Lý do: Vercel giới hạn body ~4.5MB; cách này không cần multer/SDK và chạy y hệt trên server riêng.
   Luồng: GET /upload/sign?kind=avatar -> trình duyệt POST file lên Cloudinary -> PUT /me/avatar {url} -> server kiểm tra URL rồi lưu. */
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, UpQuota } = require('./models');
// Hạn mức tải file nặng mỗi ngày để chống đốt tiền Cloudinary (1 user không thể ký vượt quá mức này/ngày)
const DAILY_HEAVY_QUOTA = 2 * 1024 * 1024 * 1024, HEAVY_KINDS = ['video', 'postvideo', 'music'];
const signLimit = rateLimit({ store: rlStore('upload.signLimit'), windowMs: 10 * 60 * 1000, limit: (req) => Number(({ album: 80, post: 80, postvideo: 10, video: 10, music: 20 })[req.query.kind]) || 30,   // album / ảnh bài viết tải nhiều ảnh một lượt nên được nới hơn avatar; video ít hơn vì nặng
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn tải ảnh quá nhiều lần, vui lòng đợi ít phút.' } });

const cfg = () => ({
  cloud: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
  key: (process.env.CLOUDINARY_API_KEY || '').trim(),
  secret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
  root: (process.env.CLOUDINARY_FOLDER || 'coolair').trim().replace(/^\/+|\/+$/g, ''),
});
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Cloudinary: chữ ký = sha1( "k1=v1&k2=v2" (sắp theo tên khóa, bỏ file/api_key/resource_type) + api_secret )
const signParams = (params, secret) => sha1(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret);

// Mỗi loại ảnh = một thư mục + giới hạn riêng. Thêm loại mới (album, ảnh bài viết...) chỉ cần thêm một dòng ở đây.
const KINDS = {
  avatar: (uid, root) => ({
    public_id: `${root}/avatars/${uid}`, overwrite: 'true', invalidate: 'true',   // public_id đầy đủ (không dùng `folder`) -> URL giống nhau ở cả chế độ thư mục cố định lẫn động
    transformation: 'c_fill,g_face,w_512,h_512,q_auto',      // cắt vuông 512x512 ngay khi nhận -> ảnh gốc không bao giờ lớn
    allowed_formats: 'jpg,jpeg,png,webp,gif',
  }),
  cover: (uid, root) => ({
    public_id: `${root}/covers/${uid}`, overwrite: 'true', invalidate: 'true',
    transformation: 'c_limit,w_1600,h_900,q_auto',   // giữ nguyên tỷ lệ ảnh gốc, chỉ giới hạn 1600x900
    allowed_formats: 'jpg,jpeg,png,webp,gif',
  }),
  // Ảnh album: mỗi ảnh một id ngẫu nhiên do SERVER chọn (nằm trong phần được ký) và KHÔNG overwrite -> không ghi đè được ảnh cũ.
  // Khác avatar ở chỗ này nên không chỉ là "thêm một dòng": còn cần model Album/Photo + route lưu/xóa (server/album.js).
  album: (uid, root) => ({
    public_id: `${root}/albums/${uid}/${crypto.randomBytes(8).toString('hex')}`,
    transformation: 'c_limit,w_1600,h_1600,q_auto',   // thu về tối đa 1600px ngay khi nhận
    allowed_formats: 'jpg,jpeg,png,webp,gif',
  }),
  // Ảnh / video trong bài viết (port ý tưởng từ phpFox: feed + photo + video). Cũng id ngẫu nhiên do server chọn, không overwrite.
  // Video không biến đổi lúc tải lên (tránh chờ mã hóa lâu); URL phát được biến đổi khi xem (xem VU / VP trong src/post.js).
  post: (uid, root) => ({
    public_id: `${root}/posts/${uid}/${crypto.randomBytes(8).toString('hex')}`,
    transformation: 'c_limit,w_1600,h_1600,q_auto',
    allowed_formats: 'jpg,jpeg,png,webp,gif',
  }),
  postvideo: (uid, root) => ({
    public_id: `${root}/postvideos/${uid}/${crypto.randomBytes(8).toString('hex')}`,
    allowed_formats: 'mp4,mov,webm,m4v',
  }),
  // Module Video (trang Video) và Âm nhạc: trước đây giao diện gọi kind=video / kind=music nhưng server không có -> báo lỗi "Chỉ nhận ảnh...".
  // Cloudinary lưu cả file nhạc dưới resource_type `video`.
  video: (uid, root) => ({
    public_id: `${root}/videos/${uid}/${crypto.randomBytes(8).toString('hex')}`,
    allowed_formats: 'mp4,mov,webm,m4v',
  }),
  music: (uid, root) => ({
    public_id: `${root}/music/${uid}/${crypto.randomBytes(8).toString('hex')}`,
    allowed_formats: 'mp3,m4a,wav,ogg,aac,flac,opus',
  }),
};
const RESOURCE = { postvideo: 'video', video: 'video', music: 'video' };                         // loại còn lại là image
const MB = 1024 * 1024;
const MAX_BY_KIND = { cover: 10 * MB, album: 20 * MB, post: 20 * MB, postvideo: 500 * MB, video: 500 * MB, music: 50 * MB };   // ảnh album / bài viết ≤ 20MB, video ≤ 500MB (avatar: 5MB). Trình duyệt kiểm tra; giới hạn cứng còn tùy gói Cloudinary (Settings -> Account -> Usage limits)
// Xóa một ảnh trên Cloudinary; không bao giờ ném lỗi (chỉ ghi log) để không chặn việc xóa trong DB
const destroy = async (publicId, resource = 'image') => {
  const c = cfg();
  if (!c.cloud || !c.key || !c.secret) return;
  const p = { invalidate: 'true', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const body = new URLSearchParams({ ...p, api_key: c.key, signature: signParams(p, c.secret) });
  try { await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/${resource}/destroy`, { method: 'POST', body, signal: AbortSignal.timeout(5000) }); }
  catch (e) { console.error('Cloudinary destroy:', e.message); }
};
// URL ảnh album hợp lệ = đúng cloud + đúng thư mục + đúng id của chính người gọi -> trả về public_id (hoặc '')
const photoPublicId = (url, uid) => {
  const c = cfg();
  if (!c.cloud || typeof url !== 'string' || url.length > 300) return '';
  const base = `^https://res\\.cloudinary\\.com/${c.cloud.replace(/[^\w-]/g, '')}/image/upload/v\\d+/`;
  const m = url.match(new RegExp(`${base}(${c.root.replace(/[^\w/-]/g, '')}/albums/${uid}/[a-f0-9]{16})\\.(jpg|jpeg|png|webp|gif)$`));
  return m ? m[1] : '';
};
// URL ảnh / video / nhạc hợp lệ = đúng cloud + đúng thư mục + id của chính người gọi. kind: 'post' (ảnh bài viết) | 'postvideo' (video bài viết) | 'video' (trang Video) | 'music' (nhạc) -> public_id hoặc ''
const MEDIA_DIRS = {
  post: ['posts', 'image', 'jpg|jpeg|png|webp|gif'],
  postvideo: ['postvideos', 'video', 'mp4|mov|webm|m4v'],
  video: ['videos', 'video', 'mp4|mov|webm|m4v'],
  music: ['music', 'video', 'mp3|m4a|wav|ogg|aac|flac|opus'],
};
const mediaPublicId = (url, uid, kind) => {
  const c = cfg();
  if (!c.cloud || typeof url !== 'string' || url.length > 300 || !/^[a-f0-9]{24}$/.test(String(uid)) || !Object.hasOwn(MEDIA_DIRS, kind)) return '';
  const [dir, res, ext] = MEDIA_DIRS[kind];
  const base = `^https://res\\.cloudinary\\.com/${c.cloud.replace(/[^\w-]/g, '')}/${res}/upload/v\\d+/`;
  const m = url.match(new RegExp(`${base}(${c.root.replace(/[^\w/-]/g, '')}/${dir}/${uid}/[a-f0-9]{16})\\.(${ext})$`));
  return m ? m[1] : '';
};
const MAX_BYTES = 5 * 1024 * 1024;   // kiểm tra phía trình duyệt; giới hạn cứng nằm ở gói Cloudinary (10MB ảnh)

module.exports = (router, { auth, wrap, fail, S, pub }) => {
  router.get('/upload/sign', auth, signLimit, wrap(async (req, res) => {
    const c = cfg();
    if (!c.cloud || !c.key || !c.secret) return fail(res, 'Chưa cấu hình Cloudinary trên máy chủ.', null, 503);
    const make = Object.hasOwn(KINDS, S(req.query.kind)) ? KINDS[S(req.query.kind)] : null;   // hasOwn: chặn kind=constructor / __proto__
    if (!make) return fail(res, 'Loại ảnh không hợp lệ.');
    const kind = S(req.query.kind);
    const maxBytes = Object.hasOwn(MAX_BY_KIND, kind) ? MAX_BY_KIND[kind] : MAX_BYTES;
    if (HEAVY_KINDS.includes(kind)) {   // video/nhạc: trừ vào hạn mức 2GB/ngày (tính theo mức tối đa mỗi lần ký cho chắc)
      const day = new Date().toISOString().slice(0, 10);
      const q = await UpQuota.findOneAndUpdate({ user: req.uid, day }, { $setOnInsert: { user: req.uid, day } }, { upsert: true, new: true });
      if (q.bytes + maxBytes > DAILY_HEAVY_QUOTA) return fail(res, 'Bạn đã dùng hết hạn mức tải video/nhạc hôm nay (2GB). Thử lại ngày mai.', null, 429);
      q.bytes += maxBytes; await q.save();
    }
    const p = { ...make(req.uid, c.root), timestamp: Math.floor(Date.now() / 1000) };
    // public_id (chứa uid của người gọi) nằm trong phần được ký -> không ai ghi đè được ảnh của người khác
    res.json({ url: `https://api.cloudinary.com/v1_1/${c.cloud}/${Object.hasOwn(RESOURCE, kind) ? RESOURCE[kind] : 'image'}/upload`, apiKey: c.key, params: p,
      signature: signParams(p, c.secret), maxBytes });
  }));

  // Chỉ nhận URL đúng cloud + đúng thư mục + đúng id của chính người gọi
  const avatarUrlOk = (url, uid) => {
    const c = cfg();
    if (!/^[a-f0-9]{24}$/.test(String(uid))) return false;   // uid luôn là ObjectId hex 24 ký tự
    const re = new RegExp(`^https://res\\.cloudinary\\.com/${c.cloud.replace(/[^\w-]/g, '')}/image/upload/v\\d+/${c.root.replace(/[^\w/-]/g, '')}/avatars/${uid}\\.(jpg|jpeg|png|webp|gif)$`);
    return !!c.cloud && url.length <= 300 && re.test(url);
  };
  const coverUrlOk = (url, uid) => {
    const c = cfg();
    if (!/^[a-f0-9]{24}$/.test(String(uid))) return false;
    const re = new RegExp(`^https://res\\.cloudinary\\.com/${c.cloud.replace(/[^\w-]/g, '')}/image/upload/v\\d+/${c.root.replace(/[^\w/-]/g, '')}/covers/${uid}\\.(jpg|jpeg|png|webp|gif)$`);
    return !!c.cloud && url.length <= 300 && re.test(url);
  };

  router.put('/me/avatar', auth, wrap(async (req, res) => {
    const url = S(req.body.url).trim();
    if (!avatarUrlOk(url, req.uid)) return fail(res, 'Ảnh đại diện không hợp lệ.');
    const u = await User.findByIdAndUpdate(req.uid, { avatar: url }, { new: true });
    if (u && url) { try { require('./credit').completeTask(req.uid, 'avatar'); } catch (e) {} }   // nhiệm vụ ảnh đại diện
    u ? res.json({ user: pub(u) }) : res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  }));

  router.put('/me/cover', auth, wrap(async (req, res) => {
    const url = S(req.body.url).trim();
    if (!coverUrlOk(url, req.uid)) return fail(res, 'Ảnh bìa không hợp lệ.');
    const u = await User.findByIdAndUpdate(req.uid, { cover: url }, { new: true });
    u ? res.json({ user: pub(u) }) : res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  }));

  router.patch('/me/cover/pos', auth, wrap(async (req, res) => {
    const pos = S(req.body.pos).trim();
    const m = pos.match(/^(\d{1,3})% (\d{1,3})%$/);
    if (!m || +m[1] > 100 || +m[2] > 100) return fail(res, 'Vị trí ảnh bìa không hợp lệ.');
    const u = await User.findByIdAndUpdate(req.uid, { coverPos: pos }, { new: true });
    u ? res.json({ user: pub(u) }) : res.status(401).json({ error: 'Tài khoản không tồn tại.' });
  }));

  router.delete('/me/cover', auth, wrap(async (req, res) => {
    const u = await User.findByIdAndUpdate(req.uid, { cover: '' }, { new: true });
    if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    try { const c = cfg(); await destroy(`${c.root}/covers/${req.uid}`); } catch (e) {}
    res.json({ user: pub(u) });
  }));

  router.delete('/me/avatar', auth, wrap(async (req, res) => {
    const c = cfg(), old = (await User.findById(req.uid).select('avatar'))?.avatar;
    const u = await User.findByIdAndUpdate(req.uid, { avatar: '' }, { new: true });
    if (!u) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    // Dọn ảnh trên Cloudinary (không bắt buộc: lỗi chỉ ghi log, avatar đã gỡ khỏi hồ sơ)
    if (old) await destroy(`${c.root}/avatars/${req.uid}`);   // phải await: serverless có thể dừng ngay sau khi trả lời
    res.json({ user: pub(u) });
  }));
};
module.exports.cloud = { destroy, photoPublicId, mediaPublicId, cfg };
