/* Ảnh + video trong bài viết – port ý tưởng từ phpFox 3 (module feed + photo + video).
   phpFox: bài đăng trạng thái đính kèm ảnh (feed "shared N photos") hoặc video; video thêm bằng LINK (chỉ nhận các site trong danh sách, lấy tiêu đề + ảnh
   thumbnail qua oEmbed, xem ở service `video.grab`) hoặc TẢI FILE LÊN. Ở đây:
   - Ảnh: tối đa 10 / bài, tải thẳng lên Cloudinary (kind=post), bài chỉ lưu URL.
   - Video: MỘT video / bài, hoặc link (YouTube, Vimeo, TikTok, Dailymotion – server tự tách id, người dùng không gửi được iframe/HTML tùy ý),
     hoặc file tải lên Cloudinary (kind=postvideo, tối đa 50MB).
   - Mỗi bài chỉ có ảnh HOẶC video (như một mục trong feed của phpFox).
   Đường đi: trình duyệt tải lên Cloudinary -> POST /posts {text?, photos:[url], video:{kind,url}} -> server kiểm tra URL thuộc đúng người rồi lưu. */
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { Post } = require('./models');
const { cloud } = require('./upload');

const MAX_PHOTOS = 10;
const lim = (limit, error) => rateLimit({ store: rlStore('media.lim'), windowMs: 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
const grabLimit = lim(20, 'Bạn kiểm tra link video quá nhanh, vui lòng thử lại sau ít giây.');
const discardLimit = lim(60, 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.');

/* ---------- Link video: chỉ nhận site trong danh sách; trả { site, vid, canon } hoặc null ---------- */
const hostOf = (u) => u.hostname.toLowerCase().replace(/^(www|m)\./, '');
const SITES = {
  youtube: (u) => {
    const h = hostOf(u);
    let id = '';
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?]|$)/);
      id = u.pathname === '/watch' ? u.searchParams.get('v') || '' : m ? m[1] : '';
    } else return null;
    return /^[\w-]{11}$/.test(id) ? { vid: id, canon: `https://www.youtube.com/watch?v=${id}` } : null;
  },
  vimeo: (u) => {
    const h = hostOf(u);
    if (h !== 'vimeo.com' && h !== 'player.vimeo.com') return null;
    const m = u.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/);
    return m ? { vid: m[1], canon: `https://vimeo.com/${m[1]}` } : null;
  },
  dailymotion: (u) => {
    const h = hostOf(u);
    const id = h === 'dai.ly' ? u.pathname.slice(1).split('/')[0] : h === 'dailymotion.com' ? (u.pathname.match(/^\/(?:embed\/)?video\/([a-z0-9]+)/i) || [])[1] || '' : '';
    return /^[a-z0-9]{5,12}$/i.test(id) ? { vid: id, canon: `https://www.dailymotion.com/video/${id}` } : null;
  },
  tiktok: (u) => {
    if (hostOf(u) !== 'tiktok.com') return null;
    const m = u.pathname.match(/^\/@([\w.]{0,40})\/video\/(\d{15,22})/);   // link rút gọn (vt./vm.tiktok.com, tiktok.com/t/...) được xử lý riêng ở resolveTikTok
    if (m) return { vid: m[2], canon: `https://www.tiktok.com/@${m[1]}/video/${m[2]}` };
    const o = u.pathname.match(/^\/v\/(\d{15,22})(?:\.html)?$/);   // dạng cũ m.tiktok.com/v/<id>.html
    return o ? { vid: o[1], canon: `https://www.tiktok.com/@/video/${o[1]}` } : null;
  },
};
const OEMBED = {
  youtube: (c) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(c)}`,
  vimeo: (c) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(c)}`,
  dailymotion: (c) => `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(c)}`,
  tiktok: (c) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(c)}`,
};
const SITE_NAMES = 'YouTube, Vimeo, TikTok, Dailymotion';

const parseVideoUrl = (raw) => {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  for (const site of Object.keys(SITES)) {
    const r = SITES[site](u);
    if (r) return { site, ...r };
  }
  return null;
};

/* Link rút gọn của TikTok (vt.tiktok.com/xxx, vm.tiktok.com/xxx, tiktok.com/t/xxx): đi theo chuyển hướng để lấy link đầy đủ.
   An toàn: chỉ bắt đầu từ đúng các host của TikTok, KHÔNG tự động theo redirect (mỗi bước kiểm tra lại host phải thuộc tiktok.com), tối đa 4 bước, 4 giây / bước. */
const isTikTokHost = (h) => h === 'tiktok.com' || h.endsWith('.tiktok.com');
const resolveTikTok = async (raw) => {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase();
  const short = h === 'vt.tiktok.com' || h === 'vm.tiktok.com' ||
    ((h === 'tiktok.com' || h === 'www.tiktok.com' || h === 'm.tiktok.com') && /^\/t\/[\w-]{4,24}\/?$/.test(u.pathname));
  if (!short) return null;
  let cur = new URL(u.href);
  cur.protocol = 'https:';
  for (let i = 0; i < 4; i++) {
    let r;
    try {
      r = await fetch(cur.href, {
        redirect: 'manual', signal: AbortSignal.timeout(4000),
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', 'accept-language': 'en-US,en;q=0.8' },
      });
    } catch { return null; }
    const loc = r.headers.get('location');
    if (!(r.status >= 300 && r.status < 400 && loc)) return null;
    let nx;
    try { nx = new URL(loc, cur); } catch { return null; }
    if ((nx.protocol !== 'https:' && nx.protocol !== 'http:') || !isTikTokHost(nx.hostname.toLowerCase())) return null;
    const hit = SITES.tiktok(nx);
    if (hit) return { site: 'tiktok', ...hit };
    cur = nx;
  }
  return null;
};

// Hỏi oEmbed lấy tiêu đề + ảnh thumbnail (như video.grab của phpFox). 404/401/403 = video không có / riêng tư / cấm nhúng -> từ chối.
// Lỗi mạng hay site chậm thì KHÔNG chặn: vẫn cho đăng, chỉ thiếu tiêu đề / ảnh. Có nhớ tạm 10 phút để lần đăng bài không phải hỏi lại.
const cache = new Map();
const lookup = async (v) => {
  const key = `${v.site}:${v.vid}`, hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.d;
  let d = { title: '', thumb: v.site === 'youtube' ? `https://i.ytimg.com/vi/${v.vid}/hqdefault.jpg` : '', gone: false };
  try {
    const r = await fetch(OEMBED[v.site](v.canon), { signal: AbortSignal.timeout(4000), headers: { 'user-agent': 'CoolAir/1.0' } });
    if ([401, 403, 404].includes(r.status)) d = { ...d, gone: true };
    else if (r.ok) {
      const j = await r.json();
      const title = typeof j.title === 'string' ? j.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
      const t = typeof j.thumbnail_url === 'string' ? j.thumbnail_url : '';
      d = { title, thumb: /^https:\/\/[^\s"'<>]{4,290}$/.test(t) ? t : d.thumb, gone: false };
    }
  } catch (e) { /* hết giờ / mạng lỗi: dùng giá trị mặc định */ }
  if (cache.size > 500) cache.clear();
  cache.set(key, { t: Date.now(), d });
  return d;
};
const grab = async (url) => {
  const v = parseVideoUrl(url) || (await resolveTikTok(url));
  if (!v) return { error: `Link video không hợp lệ. Hiện hỗ trợ: ${SITE_NAMES}. Với TikTok, nếu link rút gọn không nhận, hãy mở link trong trình duyệt rồi dán link đầy đủ (dạng tiktok.com/@tên/video/số).` };
  const d = await lookup(v);
  if (d.gone) return { error: 'Video không tồn tại, ở chế độ riêng tư hoặc không cho phép nhúng.' };
  return { video: { kind: 'embed', site: v.site, vid: v.vid, url: v.canon, title: d.title, thumb: d.thumb } };
};

/* ---------- Kiểm tra phần đính kèm của một bài: trả { photos, video } hoặc { error } ---------- */
const build = async (body, uid) => {
  const rawPh = Array.isArray(body.photos) ? body.photos : [];
  if (rawPh.length > MAX_PHOTOS) return { error: `Mỗi bài tối đa ${MAX_PHOTOS} ảnh.` };
  const photos = [...new Set(rawPh.filter((x) => typeof x === 'string'))];
  for (const u of photos) if (!cloud.mediaPublicId(u, uid, 'post')) return { error: 'Có ảnh không hợp lệ, hãy tải lại ảnh đó.' };
  const rv = body.video && typeof body.video === 'object' ? body.video : null;
  if (!rv) return { photos, video: null };
  if (photos.length) return { error: 'Mỗi bài chỉ đăng ảnh hoặc video, không đăng cả hai.' };
  if (rv.kind === 'upload') {
    if (!cloud.mediaPublicId(rv.url, uid, 'postvideo')) return { error: 'Video tải lên không hợp lệ, hãy tải lại.' };
    return { photos: [], video: { kind: 'upload', url: rv.url } };
  }
  if (rv.kind === 'embed') {
    const g = await grab(rv.url);   // luôn tự phân tích lại từ link: không tin site / id / thumb do trình duyệt gửi
    return g.error ? { error: g.error } : { photos: [], video: g.video };
  }
  return { error: 'Loại video không hợp lệ.' };
};

/* ---------- Dọn file trên Cloudinary khi xóa bài. checkShared: bỏ qua file mà bài khác vẫn đang dùng (cùng người đăng lại một ảnh). ---------- */
const destroyMedia = async (post, checkShared = true) => {
  const uid = String(post.author && post.author._id ? post.author._id : post.author);
  const jobs = [];
  for (const u of post.photos || []) jobs.push([u, 'post', 'image', { photos: u }]);
  if (post.video && post.video.kind === 'upload') jobs.push([post.video.url, 'postvideo', 'video', { 'video.url': post.video.url }]);
  for (const [url, kind, res, q] of jobs) {
    const pid = cloud.mediaPublicId(url, uid, kind);
    if (!pid) continue;
    if (checkShared && (await Post.exists({ _id: { $ne: post._id }, ...q }))) continue;
    await cloud.destroy(pid, res);   // phải await: serverless có thể dừng ngay sau khi trả lời
  }
};

module.exports = (router, { auth, wrap, fail, S }) => {
  // Xem trước link video (tiêu đề + ảnh) trước khi đăng – như bước "grab" khi thêm video ở phpFox
  router.get('/video/grab', auth, grabLimit, wrap(async (req, res) => {
    const g = await grab(S(req.query.url));
    g.error ? fail(res, g.error) : res.json({ video: g.video });
  }));

  // Người dùng bỏ ảnh / video đã tải lên mà chưa đăng -> xóa khỏi Cloudinary (chỉ file của chính mình và chưa gắn vào bài nào)
  router.post('/post-media/discard', auth, discardLimit, wrap(async (req, res) => {
    const url = S(req.body.url), isVid = url.includes('/video/upload/');
    const kind = isVid ? 'postvideo' : 'post', pid = cloud.mediaPublicId(url, req.uid, kind);
    if (!pid) return fail(res, 'Tệp không hợp lệ.');
    if (!(await Post.exists(isVid ? { 'video.url': url } : { photos: url }))) await cloud.destroy(pid, isVid ? 'video' : 'image');
    res.json({ ok: true });
  }));
};
module.exports.build = build;
module.exports.destroyMedia = destroyMedia;
module.exports.parseVideoUrl = parseVideoUrl;
module.exports.grab = grab;
module.exports.MAX_PHOTOS = MAX_PHOTOS;
