/* Store dùng chung cho express-rate-limit, lưu bộ đếm trong MongoDB (collection `ratelimits`).
   Vì sao: trên Vercel mỗi instance serverless có bộ nhớ riêng nên store mặc định (RAM) đếm riêng từng instance -> giới hạn
   đăng nhập / đăng bài gần như vô hiệu khi có nhiều instance. Dùng MongoDB sẵn có, không thêm dịch vụ hay package.
   - Mỗi limiter một tiền tố riêng (rlStore('file.tên')) để không dùng chung bộ đếm.
   - Tăng đếm bằng MỘT lệnh findOneAndUpdate (pipeline) nên an toàn khi nhiều instance cùng ghi.
   - Chỉ số TTL (resetAt) tự dọn bản ghi hết hạn.
   - Nếu MongoDB lỗi: đếm tạm trong RAM của instance (không chặn người dùng, không 500). */

const COLLECTION = 'ratelimits';
const EPOCH = new Date(0);
let indexReady = null;   // Promise tạo TTL index một lần cho mỗi instance
const seen = {};         // tên -> số lần tạo (limiter tạo từ hàm factory vẫn có tiền tố riêng, ổn định theo thứ tự nạp)

const unwrap = (r) => (r && typeof r === 'object' && 'ok' in r && 'value' in r ? r.value : r);   // driver cũ trả {value}, driver 6 trả thẳng document

class MongoStore {
  constructor(name, opts = {}) {
    this.name = name;
    this.localKeys = false;   // bộ đếm nằm ngoài tiến trình (express-rate-limit dùng cờ này để kiểm tra cấu hình)
    this.col = opts.collection || (() => require('mongoose').connection.collection(COLLECTION));   // require trễ: test chạy được khi chưa cài package
    this.mem = new Map();
  }
  init(options) { this.windowMs = options.windowMs; }
  _id(key) { return this.name + ':' + key; }
  _ensureIndex(col) {
    if (!indexReady) indexReady = Promise.resolve(col.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 })).catch(() => { indexReady = null; });
    return indexReady;
  }
  _memHit(id, now) {
    let e = this.mem.get(id);
    if (!e || e.resetAt <= now) { e = { hits: 0, resetAt: now + this.windowMs }; this.mem.set(id, e); }
    e.hits++;
    if (this.mem.size > 5000) for (const [k, v] of this.mem) if (v.resetAt <= now) this.mem.delete(k);
    return { totalHits: e.hits, resetTime: new Date(e.resetAt) };
  }
  async increment(key) {
    const id = this._id(key), now = new Date(), fresh = new Date(now.getTime() + this.windowMs);
    const expired = { $lte: [{ $ifNull: ['$resetAt', EPOCH] }, now] };
    const pipeline = [{ $set: {
      hits: { $cond: [expired, 1, { $add: [{ $ifNull: ['$hits', 0] }, 1] }] },
      resetAt: { $cond: [expired, fresh, '$resetAt'] },
    } }];
    try {
      const col = this.col();
      await this._ensureIndex(col);
      let doc;
      for (let i = 0; i < 2 && !doc; i++) {   // lần đầu hai request cùng upsert có thể đụng E11000 -> thử lại một lần
        try { doc = unwrap(await col.findOneAndUpdate({ _id: id }, pipeline, { upsert: true, returnDocument: 'after' })); }
        catch (e) { if (e && e.code === 11000 && i === 0) continue; throw e; }
      }
      if (!doc || typeof doc.hits !== 'number') throw new Error('ratestore: không đọc được bộ đếm');
      return { totalHits: doc.hits, resetTime: doc.resetAt instanceof Date ? doc.resetAt : new Date(doc.resetAt) };
    } catch (e) {
      console.error('[ratelimit] MongoDB lỗi, đếm tạm trong RAM:', e && e.message);
      return this._memHit(id, now.getTime());
    }
  }
  async decrement(key) {
    const id = this._id(key), e = this.mem.get(id);
    if (e && e.hits > 0) e.hits--;
    try { await this.col().updateOne({ _id: id, hits: { $gt: 0 } }, { $inc: { hits: -1 } }); } catch { /* bỏ qua */ }
  }
  async resetKey(key) {
    const id = this._id(key); this.mem.delete(id);
    try { await this.col().deleteOne({ _id: id }); } catch { /* bỏ qua */ }
  }
}

// rlStore('album.talkLimit') -> store riêng cho một limiter. Gọi lại cùng tên (factory) sẽ thêm hậu tố #2, #3...
const rlStore = (name) => new MongoStore(name + '#' + (seen[name] = (seen[name] || 0) + 1));

module.exports = { MongoStore, rlStore };
