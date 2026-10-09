/* Realtime (Ably), gọi thoại WebRTC, tin nhắn */
const { isValidObjectId, Types, rateLimit, rlStore, User, Friendship, Message, push, S, wrap, fail, auth, areFriends, msgLimiter, ably, chatCh } = require('./shared');

module.exports = (router) => {
/* ---------- Realtime (Ably) ----------
   Vercel không giữ WebSocket nên dùng Ably: server chỉ publish "có tin mới" + cấp token; nội dung tin luôn lấy từ MongoDB.
   Thiếu ABLY_API_KEY thì tắt realtime, client tự quay về hỏi lại định kỳ. */

router.get('/realtime/token', auth, wrap(async (req, res) => {
  if (!ably) return fail(res, 'Máy chủ chưa bật realtime.', null, 503);
  const fs = await Friendship.find({ status: 'accepted', $or: [{ from: req.uid }, { to: req.uid }] }).select('from to');
  const cap = { ['inbox:' + req.uid]: ['subscribe'], 'presence:all': ['subscribe', 'presence'] };   // chỉ nghe hộp thư của chính mình
  for (const f of fs) cap[chatCh(f.from, f.to)] = ['publish', 'subscribe'];                         // kênh "đang gõ" chỉ giữa hai bạn bè
  res.json(await ably.auth.createTokenRequest({ clientId: req.uid, capability: JSON.stringify(cap), ttl: 60 * 60 * 1000 }));
}));

const notify = async (to, from, id) => {
  if (!ably) return;
  try { await ably.channels.get('inbox:' + to).publish('msg', { from: String(from), id }); }
  catch (e) { console.error('Ably:', e.message); }                // lỗi realtime không được làm hỏng việc gửi tin
};

/* ---------- Gọi thoại (WebRTC) ----------
   Báo hiệu (invite/accept/offer/answer/ice/end) đi qua server rồi mới sang Ably -> chỉ bạn bè gửi được cho nhau, không giả mạo người gọi.
   Âm thanh đi thẳng giữa hai máy; khi không nối thẳng được thì qua TURN (Metered: METERED_APP + METERED_API_KEY, hoặc Cloudflare: CF_TURN_KEY_ID + CF_TURN_API_TOKEN). */
const callLimiter = rateLimit({ store: rlStore('routes.callLimiter'), windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });
const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];

router.get('/realtime/ice', auth, callLimiter, wrap(async (req, res) => {
  const { METERED_APP: app, METERED_API_KEY: mKey, METERED_REGION: region = 'asia', CF_TURN_KEY_ID: key, CF_TURN_API_TOKEN: token } = process.env;
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  try {
    if (app && mKey) {                                                     // Metered (Open Relay): 20GB/tháng miễn phí, không cần thẻ
      const r = await fetch(`https://${encodeURIComponent(app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(mKey)}&region=${encodeURIComponent(region)}`,
        { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('Metered TURN ' + r.status);
      const ice = list(await r.json());
      if (!ice.length) throw new Error('Metered TURN trả về rỗng');
      return res.json({ iceServers: ice });
    }
    if (key && token) {                                                    // Cloudflare Realtime TURN
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
      const ice = list((await r.json()).iceServers);
      if (!ice.length) throw new Error('Cloudflare TURN trả về rỗng');
      return res.json({ iceServers: ice });
    }
  } catch (e) { console.error('TURN:', e.message); }
  res.json({ iceServers: STUN_ONLY });                                     // chưa cấu hình / lỗi TURN: chỉ STUN (đa số cuộc gọi vẫn nối được)
}));

const SIG = ['invite', 'accept', 'reject', 'offer', 'answer', 'ice', 'end'];
router.post('/call/:id/signal', auth, callLimiter, wrap(async (req, res) => {
  if (!ably) return fail(res, 'Máy chủ chưa bật realtime.', null, 503);
  const type = S(req.body.type), data = req.body.data;
  if (!SIG.includes(type)) return fail(res, 'Tín hiệu không hợp lệ.');
  if (data !== undefined && (typeof data !== 'object' || data === null || JSON.stringify(data).length > 12000)) return fail(res, 'Dữ liệu cuộc gọi không hợp lệ.');
  if (req.params.id === req.uid || !(await areFriends(req.uid, req.params.id))) return fail(res, 'Hai bạn chưa là bạn bè.', null, 403);
  const msg = { from: req.uid, type, data };
  if (type === 'invite') msg.name = (await User.findById(req.uid).select('name'))?.name || 'Bạn bè';
  try { await ably.channels.get('inbox:' + req.params.id).publish('sig', msg); }
  catch (e) { console.error('Ably:', e.message); return fail(res, 'Không gửi được tín hiệu cuộc gọi.', null, 502); }
  res.json({ ok: true });
}));

/* ---------- Tin nhắn (có realtime; client vẫn hỏi lại thưa làm dự phòng) ---------- */
const mv = (m, me) => ({ id: m.id, mine: String(m.from) === me, text: m.text, createdAt: m.createdAt });

router.get('/messages/:id', auth, wrap(async (req, res) => {
  const other = req.params.id, after = S(req.query.after);
  if (!(await areFriends(req.uid, other))) return fail(res, 'Hai bạn chưa là bạn bè.', null, 403);
  if (after && !isValidObjectId(after)) return fail(res, 'Tham số after không hợp lệ.');
  const q = { $or: [{ from: req.uid, to: other }, { from: other, to: req.uid }], delBy: { $ne: req.uid } };
  const list = after
    ? await Message.find({ ...q, _id: { $gt: after } }).sort({ _id: 1 }).limit(100)
    : (await Message.find(q).sort({ _id: -1 }).limit(50)).reverse();
  await Message.updateMany({ from: other, to: req.uid, read: false }, { read: true });
  res.json(list.map((m) => mv(m, req.uid)));
}));

router.post('/messages/:id', auth, msgLimiter, wrap(async (req, res) => {
  const text = S(req.body.text).trim();
  if (!text || text.length > 1000) return fail(res, 'Tin nhắn cần 1–1000 ký tự.');
  if (!(await areFriends(req.uid, req.params.id))) return fail(res, 'Hai bạn chưa là bạn bè.', null, 403);
  if (await require('../vis').blockedBetween(req.uid, req.params.id)) return fail(res, 'Bạn không thể nhắn tin cho người này.', null, 403);
  const m = await Message.create({ from: req.uid, to: req.params.id, text });
  // Tin nhắn mới tự khôi phục hội thoại khỏi thùng rác của cả hai bên
  await Message.updateMany({ $or: [{ from: req.uid, to: req.params.id }, { from: req.params.id, to: req.uid }] },
    { $pull: { delBy: { $in: [new Types.ObjectId(req.uid), new Types.ObjectId(req.params.id)] } } });
  await notify(req.params.id, req.uid, m.id);
  if (push.enabled() && (await push.has(req.params.id))) {   // tin nhắn mới -> đẩy ra điện thoại người nhận
    const me = await User.findById(req.uid).select('name').lean();
    await push.sendTo(req.params.id, { title: me ? me.name : 'Tin nhắn mới', body: text.length > 90 ? text.slice(0, 90) + '…' : text, tag: 'msg:' + req.uid, url: '/?chat=' + req.uid });
  }
  res.status(201).json(mv(m, req.uid));
}));
};
