const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });

const User = model('User', new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 30 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },   // bcrypt hash
  phone: { type: String, trim: true, default: '' }, birthday: Date,
  location: { type: String, trim: true, maxlength: 50, default: '' }, bio: { type: String, trim: true, maxlength: 150, default: '' },
  theme: { type: String, default: '' }, themeBg: { type: String, default: '' }, themeAccent: { type: String, default: '' },   // giao diện trang cá nhân ('' = mặc định, t3..t14 = có sẵn, custom = tự chọn màu)
  extra: { type: Map, of: String, default: undefined },   // hồ sơ mở rộng: { <ProfileField._id>: giá trị } (port từ spacefield.field_N của UCHome)
  avatar: { type: String, default: '' },   // URL ảnh đại diện trên Cloudinary ('' = dùng chữ cái đầu)
  cover: { type: String, default: '', maxlength: 300 },   // URL ảnh bìa trên Cloudinary ('' = dùng gradient theo theme)
  coverPos: { type: String, default: '50% 50%', maxlength: 20 },   // vị trí ảnh bìa (object-position CSS)
  noTheme: { type: Boolean, default: false },                                                                                    // true = không áp giao diện của người khác khi xem trang họ (như "nocss" của UCHome)
  verified: { type: Boolean, default: true },   // tài khoản cũ (trước khi có xác thực email) mặc định đã xác thực; đăng ký mới đặt false
  siteAdmin: { type: Boolean, default: false },   // quản trị viên cấp trong trang quản trị (bổ sung cho ADMIN_EMAILS)
  blueTick: { type: Boolean, default: false },   // tick xanh xác thực (admin cấp, hiển thị ✓ cạnh tên)
  vCode: { type: String, select: false }, vExp: Date, vTries: { type: Number, default: 0 }, vSentAt: Date,
  rCode: { type: String, select: false }, rExp: Date, rTries: { type: Number, default: 0 }, rSentAt: Date,   // đặt lại mật khẩu
  totpSecret: { type: String, select: false }, totpEnabled: { type: Boolean, default: false }, totpEnabledAt: Date,   // 2FA TOTP (secret mã hóa AES-256-GCM)
  totpBackup: { type: [String], select: false, default: [] },   // mã dự phòng đã hash HMAC, mỗi mã dùng 1 lần
  banned: { type: Boolean, default: false, index: true }, banReason: { type: String, maxlength: 100, default: '' }, bannedAt: Date,   // quản trị khóa tài khoản (admincp user/ban)
  friendGroups: { type: [String], default: undefined },   // tên tự đặt cho 7 nhóm bạn bè 1..7 (chỉ số 0 = 'Khác' cố định); '' = dùng tên mặc định (groupname của UCHome)
  hideGroups: { type: [Number], default: undefined },      // nhóm bạn bị ẩn khỏi bảng tin (filter_gid của UCHome)
  inviteCode: { type: String, default: undefined },        // mã mời dùng lúc đăng ký; được xử lý (kết bạn tự động) khi xác thực email xong
  visitSeen: Date,                                         // lần cuối mở danh sách khách ghé thăm (để đếm khách mới)
  lastLogin: Date, lastSeen: Date,   // lần đăng nhập gần nhất / lần mở trang gần nhất (cập nhật tối đa 10 phút một lần)
  credit: { type: Number, default: 0 }, experience: { type: Number, default: 0 },   // điểm tín dụng + kinh nghiệm (port từ UCenter Home credit/experience)
  mood: { type: String, maxlength: 20, default: '' },                              // tâm trạng hiện tại (space_mood của UCHome)
  feedHidden: [{ type: Schema.Types.ObjectId, ref: 'User' }],                      // ẩn bài của những người này khỏi bảng tin (mở rộng từ hideGroups)
  userGroup: { type: Schema.Types.ObjectId, ref: 'UserGroup' },                     // nhóm quyền (port usergroup của UCHome, đơn giản)
  feedPrefs: { type: Map, of: Boolean, default: undefined },                        // hoạt động nào của mình hiện lên bảng tin bạn bè (port privacy feed của UCHome)
  privacy: { type: Map, of: String, default: undefined },                           // quyền xem từng phần hồ sơ: info/blog/album/doing/guestbook = public|friends|private (port cp_privacy của UCHome)
  magicFx: { type: Map, of: Schema.Types.Mixed, default: undefined },                 // hiệu ứng đạo cụ đang có: {mid: {exp}} hoặc {mid: {count}}
}, { timestamps: true }));

const postSchema = new Schema({
  author: { ...ref('User'), required: true },
  text: { type: String, maxlength: 2000, default: '', required: [function () { return !(this.photos && this.photos.length) && !(this.video && this.video.kind); }, 'Bài viết cần nội dung.'] },   // được để trống khi có ảnh / video
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  photos: { type: [{ type: String, maxlength: 300 }], default: undefined },                                   // URL ảnh Cloudinary (tối đa 10, kiểm tra ở server/media.js)
  video: { kind: { type: String, enum: ['embed', 'upload'] }, site: String, vid: String, url: { type: String, maxlength: 300 }, title: { type: String, maxlength: 100 }, thumb: { type: String, maxlength: 300 } },   // embed = link YouTube/Vimeo/...; upload = file trên Cloudinary
  editedAt: Date,   // bài cũ chưa có trường này -> coi như public
  location: { name: { type: String, trim: true, maxlength: 100, default: '' },   // tên địa điểm check-in (hiển thị kiểu Zalo: "tại ...")
    lat: { type: Number, min: -90, max: 90 }, lng: { type: Number, min: -180, max: 180 } },   // tọa độ GPS (để vẽ treasure map sau này)
  reactions: [{ _id: false, user: ref('User'), emoji: String }],
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, parent: { type: Schema.Types.ObjectId, default: null }, anon: Boolean,
    reactions: [{ _id: false, user: ref('User'), emoji: String }],   // cảm xúc cho bình luận (cùng bộ emoji với bài viết)
    createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });
postSchema.index({ createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });   // bảng tin / trang cá nhân: lọc theo tác giả rồi sắp theo ngày
const Post = model('Post', postSchema);

const Guestbook = model('Guestbook', new Schema({
  owner: { ...ref('User'), index: true },
  from: ref('User'), fromName: String, gift: String,
  text: { type: String, required: true, maxlength: 500 },
}, { timestamps: true }));

const Friendship = model('Friendship', new Schema({
  from: { ...ref('User'), required: true }, to: { ...ref('User'), required: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  gFrom: { type: Number, min: 0, max: 7, default: 0 }, gTo: { type: Number, min: 0, max: 7, default: 0 },   // nhóm mà `from` xếp `to` vào / `to` xếp `from` vào (mỗi người tự phân loại bạn của mình)
}, { timestamps: true }).index({ from: 1, to: 1 }, { unique: true }).index({ to: 1, status: 1 }));

const Message = model('Message', new Schema({
  from: { ...ref('User'), required: true }, to: { ...ref('User'), required: true },
  text: { type: String, required: true, maxlength: 1000 }, read: { type: Boolean, default: false },
  delBy: [{ ...ref('User') }],   // ai đã xóa/xếp vào thùng rác (hộp thư kiểu phpFox: mỗi người tự quản lý bản của mình)
}, { timestamps: true }).index({ from: 1, to: 1, _id: -1 }).index({ to: 1, read: 1 }));

// Chọc (poke) – port từ UCenter Home: mỗi cặp (người chọc -> người nhận) chỉ có 1 bản ghi, chọc lại thì ghi đè
const Poke = model('Poke', new Schema({
  from: { ...ref('User'), required: true }, to: { ...ref('User'), required: true },
  icon: { type: Number, min: 0, max: 13, default: 0 },          // 0 = chỉ chào, 1..13 = hành động (nhãn/emoji nằm ở frontend)
  note: { type: String, maxlength: 25, default: '' },
}, { timestamps: true }).index({ from: 1, to: 1 }, { unique: true }).index({ to: 1, updatedAt: -1 }));

// Trường hồ sơ tùy chỉnh – port từ bảng `profilefield` của UCenter Home (do quản trị viên định nghĩa, người dùng tự điền trong Cài đặt)
const ProfileField = model('ProfileField', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 50 },
  note: { type: String, trim: true, maxlength: 100, default: '' },            // mô tả / gợi ý dưới ô nhập
  formtype: { type: String, enum: ['text', 'select'], default: 'text' },      // text = ô nhập, select = danh sách chọn một
  maxsize: { type: Number, min: 1, max: 255, default: 50 },                   // số ký tự tối đa (UCHome: 1–255)
  required: { type: Boolean, default: false },                                // bắt buộc điền
  invisible: { type: Boolean, default: false },                               // ẩn khỏi trang cá nhân (chỉ chủ tài khoản thấy)
  allowsearch: { type: Boolean, default: false },                             // cho phép tìm người theo giá trị trường này
  choice: { type: [String], default: [] },                                    // các lựa chọn khi formtype = select
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }));

/* ---------- Nhóm (mtag) – port từ UCenter Home ---------- */
// Chuyên mục nhóm (bảng `profield` của UCHome): do quản trị viên tạo, nhóm nằm trong một chuyên mục
const Category = model('Category', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 50 },
  note: { type: String, trim: true, maxlength: 100, default: '' },
  formtype: { type: String, enum: ['text', 'select', 'multi'], default: 'text' },   // text = tự đặt tên nhóm; select/multi = chọn từ danh sách có sẵn
  inputnum: { type: Number, min: 0, max: 50, default: 0 },                           // số nhóm tối đa một người được vào trong chuyên mục (text/multi; select luôn là 1; 0 = không giới hạn)
  choice: { type: [String], default: [] },
  mtagminnum: { type: Number, min: 0, max: 1000, default: 0 },                       // nhóm cần tối thiểu bấy nhiêu thành viên mới được đăng chủ đề/trả lời
  manualmoderator: { type: Boolean, default: false },                                // true = quản trị chỉ định chủ nhóm; false = người vào đầu tiên tự làm chủ nhóm
  manualmember: { type: Boolean, default: false },                                   // true = chủ nhóm được quyền đặt cách tham gia (duyệt / chỉ mời)
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }));

// Grade thành viên (như UCHome): -2 chờ duyệt, -1 bị cấm chat, 0 thường, 1 thành viên sao, 8 phó nhóm, 9 chủ nhóm
const Group = model('Group', new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
  category: { ...ref('Category'), required: true },
  memberNum: { type: Number, default: 0 }, threadNum: { type: Number, default: 0 }, postNum: { type: Number, default: 0 },
  closed: { type: Boolean, default: false },                    // quản trị đóng nhóm: không ai vào xem/đăng được
  announcement: { type: String, maxlength: 2000, default: '' },
  pic: { type: String, maxlength: 150, default: '' },           // ảnh đại diện nhóm (URL http/https, như mtag.pic của UCHome); rỗng = ảnh mặc định /img/nologo.jpg
  closeapply: { type: Boolean, default: false },                // true = không nhận đơn xin tham gia
  joinperm: { type: Number, enum: [0, 1, 2], default: 0 },      // 0 vào tự do, 1 cần duyệt, 2 chỉ được mời
  viewperm: { type: Number, enum: [0, 1], default: 0 },         // 1 = chỉ thành viên xem được nội dung
  threadperm: { type: Number, enum: [0, 1], default: 0 },       // 1 = người ngoài nhóm cũng được đăng chủ đề
  postperm: { type: Number, enum: [0, 1], default: 0 },         // 1 = người ngoài nhóm cũng được trả lời
  recommend: { type: Boolean, default: false },
}, { timestamps: true }).index({ category: 1, name: 1 }, { unique: true }).index({ threadNum: -1 }).index({ name: 1 }));

const GroupMember = model('GroupMember', new Schema({
  group: { ...ref('Group'), required: true }, user: { ...ref('User'), required: true },
  grade: { type: Number, default: 0 },
}, { timestamps: true }).index({ group: 1, user: 1 }, { unique: true }).index({ user: 1, grade: 1 }).index({ group: 1, grade: -1 }));

const GroupInvite = model('GroupInvite', new Schema({
  group: { ...ref('Group'), required: true }, user: { ...ref('User'), required: true }, from: { ...ref('User'), required: true },
}, { timestamps: true }).index({ group: 1, user: 1 }, { unique: true }).index({ user: 1, createdAt: -1 }));

const Thread = model('Thread', new Schema({
  group: { ...ref('Group'), required: true }, author: { ...ref('User'), required: true },
  subject: { type: String, required: true, trim: true, maxlength: 80 },
  top: { type: Boolean, default: false }, digest: { type: Boolean, default: false },   // displayorder / digest của UCHome
  viewNum: { type: Number, default: 0 }, replyNum: { type: Number, default: 0 },
  lastPost: { type: Date, default: Date.now }, lastAuthor: ref('User'), lastAuthorName: { type: String, default: '' },
}, { timestamps: true }).index({ group: 1, top: -1, lastPost: -1 }).index({ author: 1, lastPost: -1 }).index({ lastPost: -1 }));

const GroupPost = model('GroupPost', new Schema({
  thread: { ...ref('Thread'), required: true }, group: { ...ref('Group'), required: true }, author: { ...ref('User'), required: true },
  isThread: { type: Boolean, default: false },                  // true = nội dung bài mở đầu của chủ đề
  text: { type: String, required: true, maxlength: 5000 },
  quote: { pid: String, name: String, text: String },           // trích dẫn khi "trả lời bài này"
  editedAt: Date, editedBy: String,
}, { timestamps: true }).index({ thread: 1, createdAt: 1 }));

// Album ảnh – port từ UCenter Home (album + pic). Ảnh nằm trên Cloudinary, ở đây chỉ lưu URL + public_id để xóa được.
const Album = model('Album', new Schema({
  owner: { ...ref('User'), required: true }, title: { type: String, required: true, trim: true, maxlength: 50 },
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  cover: { type: String, default: '' }, photoNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ owner: 1, updatedAt: -1 }));
const Photo = model('Photo', new Schema({
  album: { ...ref('Album'), required: true }, owner: { ...ref('User'), required: true },
  url: { type: String, required: true, maxlength: 300 }, publicId: { type: String, required: true, unique: true },   // unique: cùng một ảnh không đăng ký hai lần
  caption: { type: String, trim: true, maxlength: 100, default: '' },
  reactions: [{ _id: false, user: ref('User'), emoji: String }], likeNum: { type: Number, default: 0 },          // như bài viết; likeNum / commentNum để lưới ảnh không phải tải cả mảng
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, createdAt: { type: Date, default: Date.now } }], commentNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ album: 1, _id: -1 }));

// Mã đăng nhập một lần giữa các domain (SSO): chỉ lưu băm, dùng được 1 lần, hết hạn sau 60 giây, gắn với đúng domain nhận
const SsoCode = model('SsoCode', new Schema({
  hash: { type: String, required: true, unique: true }, user: { ...ref('User'), required: true }, origin: { type: String, required: true },
  sid: String,   // phiên đăng nhập của domain chính; token cấp cho domain phụ dùng chung sid này để đăng xuất đồng bộ
  createdAt: { type: Date, default: Date.now, expires: 120 },   // TTL của Mongo chạy chậm (~60s/lần) -> khi đổi mã vẫn kiểm tra lại 60 giây
}));

// Phiên đăng nhập đã bị thu hồi (đăng xuất). Token mang `sid`; sid nằm ở đây thì token vô hiệu trên MỌI domain.
// Token sống 7 ngày nên chỉ cần giữ sid 8 ngày rồi Mongo tự xóa.
const Revoked = model('Revoked', new Schema({
  sid: { type: String, required: true, unique: true }, createdAt: { type: Date, default: Date.now, expires: 8 * 24 * 3600 },
}));

// Thiết bị đăng nhập: một dòng cho mỗi lần đăng nhập (login / verify / reset). Dùng cho trang "quản lý thiết bị".
// Thu hồi một phiên = ghi sid vào Revoked + xóa dòng này. TTL 8 ngày theo tuổi token (7 ngày).
const Session = model('Session', new Schema({
  sid: { type: String, required: true, unique: true },
  user: { ...ref('User'), required: true },
  ip: { type: String, maxlength: 45 },
  ua: { type: String, maxlength: 200 },
  createdAt: { type: Date, default: Date.now, expires: 8 * 24 * 3600 },
}).index({ user: 1, createdAt: -1 }));

// Hạn mức tải file nặng (video/nhạc) theo ngày, chống đốt tiền Cloudinary: một dòng cho mỗi user/ngày, TTL 2 ngày
const UpQuota = model('UpQuota', new Schema({
  user: { ...ref('User'), required: true },
  day: { type: String, required: true },   // YYYY-MM-DD
  bytes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 2 * 24 * 3600 },
}).index({ user: 1, day: 1 }, { unique: true }));

/* ---------- Trung tâm thông báo – port logic từ module `notification` của phpFox ----------
   Mỗi sự kiện = 1 dòng (như bảng `notification`): type = type_id, item = item_id, user = người nhận (user_id), owner = người gây ra (owner_user_id), seen = is_seen.
   Menu thả xuống gộp theo (type, item); trang "Tất cả thông báo" liệt kê từng dòng. Tự xóa sau 90 ngày để DB không phình (phpFox không có). */
const Notification = model('Notification', new Schema({
  type: { type: String, required: true, maxlength: 40 },
  item: { type: Schema.Types.ObjectId, required: true },
  user: { ...ref('User'), required: true }, owner: { ...ref('User'), required: true },
  seen: { type: Boolean, default: false },
  meta: { type: String, maxlength: 20, default: '' },                       // dữ liệu nhỏ kèm theo (emoji cảm xúc)
  createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 3600 },
}).index({ user: 1, createdAt: -1 }).index({ user: 1, seen: 1 }).index({ user: 1, type: 1, item: 1, owner: 1 }).index({ type: 1, item: 1 }));

// Khách ghé thăm / dấu chân (bảng `visitor` của UCHome): mỗi cặp (chủ trang, người xem) một dòng, xem lại thì cập nhật giờ. Tự xóa sau 90 ngày như cron cleantrace.
const Visitor = model('Visitor', new Schema({
  owner: { ...ref('User'), required: true }, visitor: { ...ref('User'), required: true },
  at: { type: Date, default: Date.now },
}).index({ owner: 1, visitor: 1 }, { unique: true }).index({ owner: 1, at: -1 }).index({ visitor: 1, at: -1 }).index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }));

// Mã mời (cp_invite của UCHome): mỗi mã dùng được một lần; người đăng ký bằng mã sẽ tự thành bạn của người mời sau khi xác thực email
const Invite = model('Invite', new Schema({
  owner: { ...ref('User'), required: true, index: true },
  code: { type: String, required: true, unique: true },
  usedBy: { ...ref('User'), default: null }, usedAt: Date,
}, { timestamps: true }));

// Nhật ký (blog của UCHome): bài dài có tiêu đề, quyền riêng tư, lượt xem, bình luận
const BlogCat = model('BlogCat', new Schema({
  owner: { ...ref('User'), required: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
}, { timestamps: true }).index({ owner: 1, name: 1 }, { unique: true }).index({ owner: 1 }));
const Blog = model('Blog', new Schema({
  owner: { ...ref('User'), required: true }, title: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, maxlength: 6000 },
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  viewNum: { type: Number, default: 0 }, commentNum: { type: Number, default: 0 },
  cat: { type: Schema.Types.ObjectId, ref: 'BlogCat' },   // chuyên mục nhật ký (class của UCHome)
  tags: [{ type: String, trim: true, maxlength: 20 }],   // từ khóa phân loại (tag của UCHome, tối đa 5)
  clicks: [{ _id: false, user: ref('User'), clickId: Number }],   // biểu lộ cảm xúc định sẵn (click của UCHome: 0..5)
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, parent: { type: Schema.Types.ObjectId, default: null }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true }).index({ owner: 1, createdAt: -1 }).index({ tags: 1 }).index({ cat: 1 }));

// Sự kiện (event của UCHome): thời gian, địa điểm, giới hạn người, tham gia (going / maybe), bình luận
const EventCat = model('EventCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 40, unique: true },
}, { timestamps: true }));
const Event = model('Event', new Schema({
  owner: { ...ref('User'), required: true }, title: { type: String, required: true, trim: true, maxlength: 80 },
  detail: { type: String, maxlength: 2000, default: '' }, location: { type: String, trim: true, maxlength: 80, default: '' },
  start: { type: Date, required: true }, end: Date, endAt: { type: Date, required: true },   // endAt = end || start (để lọc sắp diễn ra / đã qua)
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  cat: { type: Schema.Types.ObjectId, ref: 'EventCat' },                                       // phân loại sự kiện (eventclass của UCHome)
  limit: { type: Number, min: 0, max: 5000, default: 0 },                                     // 0 = không giới hạn người tham gia
  goingNum: { type: Number, default: 0 }, maybeNum: { type: Number, default: 0 }, commentNum: { type: Number, default: 0 },
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true }).index({ endAt: 1 }).index({ owner: 1, start: -1 }));
const EventMember = model('EventMember', new Schema({
  event: { ...ref('Event'), required: true }, user: { ...ref('User'), required: true },
  status: { type: String, enum: ['going', 'maybe'], required: true },
}, { timestamps: true }).index({ event: 1, user: 1 }, { unique: true }).index({ user: 1, status: 1 }).index({ event: 1, status: 1, createdAt: 1 }));

// Bình chọn (poll của UCHome): 2–10 lựa chọn, chọn một hoặc nhiều, hạn chót, mỗi người một lần
const Poll = model('Poll', new Schema({
  owner: { ...ref('User'), required: true }, question: { type: String, required: true, trim: true, maxlength: 100 },
  options: [{ _id: false, text: { type: String, required: true, maxlength: 60 }, voteNum: { type: Number, default: 0 } }],
  multiple: { type: Boolean, default: false }, maxChoice: { type: Number, default: 1 }, expires: Date,
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  voterNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ owner: 1, createdAt: -1 }).index({ createdAt: -1 }));
const PollVote = model('PollVote', new Schema({
  poll: { ...ref('Poll'), required: true }, user: { ...ref('User'), required: true }, choices: [Number],
}, { timestamps: true }).index({ poll: 1, user: 1 }, { unique: true }).index({ poll: 1, createdAt: -1 }));

/* Doing – trạng thái ngắn kiểu Twitter (port từ UCenter Home cp_doing): tối đa 200 ký tự, kèm tâm trạng, trả lời đa cấp */
const Doing = model('Doing', new Schema({
  author: { ...ref('User'), required: true },
  text: { type: String, required: true, trim: true, maxlength: 200 },
  mood: { type: String, maxlength: 20, default: '' },
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  replyNum: { type: Number, default: 0 },
  replies: [{ user: ref('User'), name: String, text: { type: String, maxlength: 200 }, parent: { type: Schema.Types.ObjectId, default: null }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true }).index({ author: 1, createdAt: -1 }).index({ createdAt: -1 }));

/* Share – chia sẻ nội dung (port từ UCenter Home cp_share): share bài/blog/ảnh/sự kiện/bình chọn/doing/link lên tường mình kèm lời bình */
const Share = model('Share', new Schema({
  author: { ...ref('User'), required: true },
  note: { type: String, maxlength: 200, default: '' },
  kind: { type: String, enum: ['post', 'blog', 'photo', 'event', 'poll', 'doing', 'link'], required: true },
  target: { type: Schema.Types.ObjectId, default: null },          // id nội dung được share (null nếu link ngoài)
  targetTitle: { type: String, maxlength: 200, default: '' },      // snapshot để hiển thị khi nội dung gốc bị xóa
  targetOwner: { ...ref('User'), default: null },
  url: { type: String, maxlength: 500, default: '' },
  image: { type: String, maxlength: 500, default: '' },
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  commentNum: { type: Number, default: 0 },
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, parent: { type: Schema.Types.ObjectId, default: null }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true }).index({ author: 1, createdAt: -1 }).index({ createdAt: -1 }));

/* Blacklist – chặn người dùng (port từ UCenter Home): bị chặn thì không xem, không tương tác được */
const Blacklist = model('Blacklist', new Schema({
  owner: { ...ref('User'), required: true },
  blocked: { ...ref('User'), required: true },
}, { timestamps: true }).index({ owner: 1, blocked: 1 }, { unique: true }).index({ blocked: 1, owner: 1 }));

/* Report – tố cáo nội dung xấu (port từ UCenter Home admincp_report): admin duyệt và xử lý */
const Report = model('Report', new Schema({
  reporter: { ...ref('User'), required: true },
  kind: { type: String, enum: ['post', 'blog', 'photo', 'album', 'event', 'poll', 'doing', 'share', 'user', 'comment'], required: true },
  target: { type: Schema.Types.ObjectId, required: true },
  targetOwner: { ...ref('User'), default: null },
  reason: { type: String, maxlength: 300, required: true, trim: true },
  status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open', index: true },
  note: { type: String, maxlength: 300, default: '' },              // ghi chú xử lý của admin
  meta: { type: String, maxlength: 500, default: '' },              // JSON phụ: {parentKind, commentId} khi tố cáo bình luận
}, { timestamps: true }).index({ status: 1, createdAt: -1 }).index({ reporter: 1, kind: 1, target: 1 }, { unique: true }));

/* CreditLog – lịch sử cộng/trừ điểm (port từ UCenter Home creditrule/creditlog) */
const CreditLog = model('CreditLog', new Schema({
  user: { ...ref('User'), required: true },
  action: { type: String, required: true, maxlength: 30 },
  credit: { type: Number, required: true },
  exp: { type: Number, default: 0 },
  note: { type: String, maxlength: 200, default: '' },
}, { timestamps: true }).index({ user: 1, createdAt: -1 }).index({ user: 1, action: 1, createdAt: -1 }));

/* UserTask – tiến độ nhiệm vụ tân thủ (port từ UCenter Home usertask) */
const UserTask = model('UserTask', new Schema({
  user: { ...ref('User'), required: true },
  task: { type: String, required: true, maxlength: 30 },
  done: { type: Boolean, default: false },
  claimed: { type: Boolean, default: false },
}, { timestamps: true }).index({ user: 1, task: 1 }, { unique: true }));

/* Topic – chủ đề nóng (port từ UCenter Home cp_topic): admin tạo, người dùng tham gia và gắn nội dung */
const Topic = model('Topic', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 60 },
  desc: { type: String, maxlength: 300, default: '' },
  pic: { type: String, maxlength: 500, default: '' },
  hot: { type: Boolean, default: false },
  closed: { type: Boolean, default: false },
  joinNum: { type: Number, default: 0 },
  postNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ hot: -1, joinNum: -1 }).index({ createdAt: -1 }));
const TopicMember = model('TopicMember', new Schema({
  topic: { ...ref('Topic'), required: true }, user: { ...ref('User'), required: true },
}, { timestamps: true }).index({ topic: 1, user: 1 }, { unique: true }).index({ user: 1 }));
const TopicPost = model('TopicPost', new Schema({
  topic: { ...ref('Topic'), required: true },
  kind: { type: String, enum: ['post', 'blog', 'doing'], required: true },
  target: { type: Schema.Types.ObjectId, required: true },
  author: { ...ref('User'), required: true },
}, { timestamps: true }).index({ topic: 1, createdAt: -1 }).index({ kind: 1, target: 1, topic: 1 }, { unique: true }));

/* ---------- Quản trị mở rộng (port admincp của UCHome) ---------- */
// Từ cấm (censor): tìm thấy thì thay bằng replacement (mặc định ***)
const CensorWord = model('CensorWord', new Schema({
  word: { type: String, required: true, trim: true, maxlength: 60 },
  replacement: { type: String, default: '***', maxlength: 60 },
}, { timestamps: true }).index({ word: 1 }, { unique: true }));
// Quy tắc cộng điểm (admin cấu hình được, thay cho RULES hardcode)
const CreditRule = model('CreditRule', new Schema({
  action: { type: String, required: true, trim: true, maxlength: 40 },
  credit: { type: Number, default: 0 }, exp: { type: Number, default: 0 },
  cycle: { type: String, enum: ['once', 'daily'], default: 'daily' },
  max: { type: Number, default: 0 },   // 0 = không giới hạn / 1 lần duy nhất
  label: { type: String, default: '', maxlength: 80 },
  enabled: { type: Boolean, default: true },
}, { timestamps: true }).index({ action: 1 }, { unique: true }));
// Định nghĩa nhiệm vụ (admin cấu hình được)
const TaskDef = model('TaskDef', new Schema({
  id: { type: String, required: true, trim: true, maxlength: 40 },
  name: { type: String, required: true, maxlength: 80 },
  desc: { type: String, default: '', maxlength: 300 },
  credit: { type: Number, default: 0 }, exp: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ id: 1 }, { unique: true }).index({ displayorder: 1 }));
// Thành viên nổi bật (hotuser)
const HotUser = model('HotUser', new Schema({
  user: { ...ref('User'), required: true },
  note: { type: String, default: '', maxlength: 120 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ user: 1 }, { unique: true }).index({ displayorder: 1 }));
// Chặn IP
const IpBan = model('IpBan', new Schema({
  ip: { type: String, required: true, trim: true, maxlength: 45 },
  reason: { type: String, default: '', maxlength: 200 },
}, { timestamps: true }).index({ ip: 1 }, { unique: true }));
// Nhật ký hành động của quản trị viên
const AdminLog = model('AdminLog', new Schema({
  admin: { ...ref('User'), required: true },
  action: { type: String, required: true, maxlength: 40 },
  target: { type: String, default: '', maxlength: 120 },
  note: { type: String, default: '', maxlength: 300 },
}, { timestamps: true }).index({ createdAt: -1 }).index({ admin: 1, createdAt: -1 }));
// Cấu hình site (key-value)
const SiteConfig = model('SiteConfig', new Schema({
  key: { type: String, required: true, trim: true, maxlength: 60 },
  value: { type: String, default: '' },
}, { timestamps: true }).index({ key: 1 }, { unique: true }));
// Nhóm quyền (usergroup đơn giản): tên + các quyền bật/tắt
const UserGroup = model('UserGroup', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  perms: { type: Map, of: Boolean, default: {} },   // vd: {post: true, comment: true, invite: false}
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));

/* Đạo cụ (magic của UCHome): định nghĩa, túi đồ người dùng, nhật ký sử dụng */
const MagicDef = model('MagicDef', new Schema({
  mid: { type: String, required: true, unique: true, maxlength: 30 },
  name: { type: String, required: true, maxlength: 40 }, desc: { type: String, maxlength: 300, default: '' },
  charge: { type: Number, required: true, min: 0 }, icon: { type: String, default: '🪄', maxlength: 10 },
  enabled: { type: Boolean, default: true },
}, { timestamps: true }));
const UserMagic = model('UserMagic', new Schema({
  user: { ...ref('User'), required: true }, mid: { type: String, required: true, maxlength: 30 },
  count: { type: Number, default: 0, min: 0 },
}, { timestamps: true }).index({ user: 1, mid: 1 }, { unique: true }));
const MagicLog = model('MagicLog', new Schema({
  user: { ...ref('User'), required: true }, mid: { type: String, required: true, maxlength: 30 },
  action: { type: String, enum: ['buy', 'use', 'gift', 'recv'], required: true },
  target: { type: String, maxlength: 120, default: '' }, detail: { type: String, maxlength: 300, default: '' },
}, { timestamps: true }).index({ user: 1, createdAt: -1 }));

/* ---------- Diễn đàn độc lập (forum) – port module `forum` của phpFox ---------- */
// Chuyên mục diễn đàn (nhóm các box lại, như forum category của phpFox)
const ForumCat = model('ForumCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  desc: { type: String, default: '', maxlength: 300 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
// Box diễn đàn (phpfox_forum): nơi chứa các chủ đề
const Forum = model('Forum', new Schema({
  cat: { ...ref('ForumCat'), required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  desc: { type: String, default: '', maxlength: 500 },
  displayorder: { type: Number, default: 0 },
  moderators: [{ ...ref('User') }],                       // mod riêng từng box (như forum moderator của phpFox)
  threadNum: { type: Number, default: 0 }, postNum: { type: Number, default: 0 },
  lastThread: { ...ref('ForumThread') }, lastAt: Date, lastBy: String,
  closed: { type: Boolean, default: false },              // đóng box: không đăng mới được
}, { timestamps: true }).index({ cat: 1, displayorder: 1 }));
// Chủ đề trong box (phpfox_forum_thread)
const ForumThread = model('ForumThread', new Schema({
  forum: { ...ref('Forum'), required: true },
  author: { ...ref('User'), required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  text: { type: String, required: true, maxlength: 10000 },
  views: { type: Number, default: 0 }, replyNum: { type: Number, default: 0 },
  sticky: { type: Boolean, default: false },              // ghim lên đầu box
  locked: { type: Boolean, default: false },              // khóa: không trả lời thêm được
  digest: { type: Boolean, default: false },              // tinh hoa
  lastAt: { type: Date, default: Date.now }, lastBy: String,
}, { timestamps: true }).index({ forum: 1, sticky: -1, lastAt: -1 }).index({ author: 1, createdAt: -1 }));
// Bài trả lời trong chủ đề (phpfox_forum_post)
const ForumPost = model('ForumPost', new Schema({
  thread: { ...ref('ForumThread'), required: true },
  author: { ...ref('User'), required: true },
  text: { type: String, required: true, maxlength: 10000 },
}, { timestamps: true }).index({ thread: 1, createdAt: 1 }));
// Theo dõi: chủ đề hoặc cả box (phpfox_forum_subscribe)
const ForumSub = model('ForumSub', new Schema({
  user: { ...ref('User'), required: true },
  thread: { ...ref('ForumThread') }, forum: { ...ref('Forum') },
}, { timestamps: true }).index({ user: 1, thread: 1, forum: 1 }, { unique: true }).index({ thread: 1 }));

/* ---------- Âm nhạc (music) – port module `music` của phpFox ---------- */
const MusicGenre = model('MusicGenre', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const MusicAlbum = model('MusicAlbum', new Schema({
  owner: { ...ref('User'), required: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  desc: { type: String, default: '', maxlength: 500 },
  year: { type: Number, min: 1900, max: 2100 },
  cover: { type: String, default: '', maxlength: 300 },   // ảnh bìa trên Cloudinary
  songNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ owner: 1, createdAt: -1 }));
const MusicSong = model('MusicSong', new Schema({
  owner: { ...ref('User'), required: true },
  album: { ...ref('MusicAlbum') },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  artist: { type: String, default: '', trim: true, maxlength: 80 },
  genre: { ...ref('MusicGenre') },
  url: { type: String, required: true, maxlength: 300 },  // file mp3 trên Cloudinary
  duration: { type: Number, default: 0 },                // giây
  plays: { type: Number, default: 0 },
  likes: [{ ...ref('User') }],
  desc: { type: String, default: '', maxlength: 500 },
}, { timestamps: true }).index({ createdAt: -1 }).index({ genre: 1, createdAt: -1 }).index({ album: 1 }));
const MusicPlaylist = model('MusicPlaylist', new Schema({
  owner: { ...ref('User'), required: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  songs: [{ ...ref('MusicSong') }],
}, { timestamps: true }).index({ owner: 1, createdAt: -1 }));

/* ---------- Video – port module `video` của phpFox (đầy đủ, thay cho /video/grab đơn lẻ) ---------- */
const VideoCat = model('VideoCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const Video = model('Video', new Schema({
  owner: { ...ref('User'), required: true },
  cat: { ...ref('VideoCat') },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  desc: { type: String, default: '', maxlength: 2000 },
  kind: { type: String, enum: ['upload', 'embed'], required: true },
  url: { type: String, default: '', maxlength: 300 },    // upload: file trên Cloudinary
  site: String, vid: String,                             // embed: nguồn (youtube/vimeo/...) + id (tái dùng logic media.js)
  thumb: { type: String, default: '', maxlength: 300 },
  duration: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  likes: [{ ...ref('User') }],
  featured: { type: Boolean, default: false },           // video nổi bật (admin đặt)
  comments: [{ user: ref('User'), name: String, text: { type: String, maxlength: 500 }, createdAt: { type: Date, default: Date.now } }],
  commentNum: { type: Number, default: 0 },
}, { timestamps: true }).index({ createdAt: -1 }).index({ cat: 1, createdAt: -1 }).index({ featured: -1, createdAt: -1 }));

/* ---------- Trắc nghiệm (quiz) – port module `quiz` của phpFox ---------- */
const Quiz = model('Quiz', new Schema({
  owner: { ...ref('User'), required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  desc: { type: String, default: '', maxlength: 1000 },
  questions: [{                                          // câu hỏi + đáp án đúng (chỉ chủ quiz xem được đáp án)
    text: { type: String, required: true, maxlength: 300 },
    options: { type: [String], validate: [(v) => v.length >= 2 && v.length <= 6] },
    answer: { type: Number, min: 0 },
  }],
  takes: { type: Number, default: 0 },                   // lượt làm bài
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
}, { timestamps: true }).index({ createdAt: -1 }).index({ owner: 1, createdAt: -1 }));
const QuizAttempt = model('QuizAttempt', new Schema({
  quiz: { ...ref('Quiz'), required: true },
  user: { ...ref('User'), required: true },
  choices: { type: [Number], required: true },           // đáp án đã chọn theo từng câu
  score: { type: Number, required: true },               // số câu đúng
  total: { type: Number, required: true },
}, { timestamps: true }).index({ quiz: 1, user: 1 }, { unique: true }).index({ quiz: 1, score: -1 }));

/* ---------- Trang cộng đồng (pages) – port module `pages` của phpFox (khác với nhóm: theo dõi 1 chiều) ---------- */
const PageCat = model('PageCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const Page = model('Page', new Schema({
  owner: { ...ref('User'), required: true },             // người tạo (quản trị đầu tiên)
  cat: { ...ref('PageCat') },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  desc: { type: String, default: '', maxlength: 2000 },
  pic: { type: String, default: '', maxlength: 300 },   // ảnh đại diện trang
  cover: { type: String, default: '', maxlength: 300 },  // ảnh bìa
  admins: [{ ...ref('User') }],                          // quản trị trang (ngoài chủ)
  likes: [{ ...ref('User') }],                           // người theo dõi (like trang)
  likeNum: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },          // trang xác thực (admin duyệt)
}, { timestamps: true }).index({ name: 1 }).index({ cat: 1, likeNum: -1 }));

/* ---------- Quà tặng ảo (egift) – port module `egift` của phpFox (quà lưu niệm tặng bạn bè; khác đạo cụ hiệu ứng) ---------- */
const GiftCat = model('GiftCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const Gift = model('Gift', new Schema({
  cat: { ...ref('GiftCat') },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  icon: { type: String, default: '🎁', maxlength: 20 },  // emoji hoặc URL ảnh
  desc: { type: String, default: '', maxlength: 200 },
  enabled: { type: Boolean, default: true },
}, { timestamps: true }).index({ cat: 1, name: 1 }));
const UserGift = model('UserGift', new Schema({
  gift: { ...ref('Gift'), required: true },
  from: { ...ref('User'), required: true },
  to: { ...ref('User'), required: true },
  message: { type: String, default: '', maxlength: 200 },
}, { timestamps: true }).index({ to: 1, createdAt: -1 }).index({ from: 1, createdAt: -1 }));

/* ---------- Thông báo chung (announcement) / Bản tin (bulletin) / Newsletter – port các module cùng tên của phpFox ---------- */
const Announcement = model('Announcement', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  text: { type: String, required: true, maxlength: 2000 },
  active: { type: Boolean, default: true },              // chỉ hiện những cái đang bật
  startsAt: Date, endsAt: Date,
}, { timestamps: true }).index({ active: 1, createdAt: -1 }));
const Bulletin = model('Bulletin', new Schema({
  author: { ...ref('User'), required: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  text: { type: String, required: true, maxlength: 5000 },
  views: { type: Number, default: 0 },
}, { timestamps: true }).index({ createdAt: -1 }).index({ author: 1, createdAt: -1 }));
const Newsletter = model('Newsletter', new Schema({
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  text: { type: String, required: true, maxlength: 10000 },
  sentAt: Date, sentNum: { type: Number, default: 0 },   // null = nháp
}, { timestamps: true }).index({ createdAt: -1 }));

/* ---------- Tiện ích nhỏ: yêu thích (favorite), đánh giá sao (rate), liên hệ (contact), trợ giúp (help), shoutbox, liên kết (link) ---------- */
const Favorite = model('Favorite', new Schema({
  user: { ...ref('User'), required: true },
  kind: { type: String, required: true, maxlength: 30 }, // post|blog|photo|video|song|quiz|page|forum_thread|event|poll
  refId: { type: String, required: true, maxlength: 40 },
  title: { type: String, default: '', maxlength: 150 },  // tiêu đề lúc lưu (để hiện danh sách không cần join)
}, { timestamps: true }).index({ user: 1, kind: 1, refId: 1 }, { unique: true }).index({ user: 1, createdAt: -1 }));
const Rating = model('Rating', new Schema({
  user: { ...ref('User'), required: true },
  kind: { type: String, required: true, maxlength: 30 },
  refId: { type: String, required: true, maxlength: 40 },
  stars: { type: Number, required: true, min: 1, max: 5 },
}, { timestamps: true }).index({ user: 1, kind: 1, refId: 1 }, { unique: true }).index({ kind: 1, refId: 1 }));
const ContactMsg = model('ContactMsg', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, trim: true, maxlength: 120 },
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  text: { type: String, required: true, maxlength: 3000 },
  read: { type: Boolean, default: false },
}, { timestamps: true }).index({ createdAt: -1 }));
const Faq = model('Faq', new Schema({
  question: { type: String, required: true, trim: true, maxlength: 200 },
  answer: { type: String, required: true, maxlength: 5000 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const Shout = model('Shout', new Schema({
  user: { ...ref('User'), required: true },
  text: { type: String, required: true, trim: true, maxlength: 200 },
}, { timestamps: true }).index({ createdAt: -1 }));
const LinkCat = model('LinkCat', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  displayorder: { type: Number, default: 0 },
}, { timestamps: true }).index({ displayorder: 1 }));
const Link = model('Link', new Schema({
  owner: { ...ref('User'), required: true },
  cat: { ...ref('LinkCat') },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  url: { type: String, required: true, trim: true, maxlength: 300 },
  desc: { type: String, default: '', maxlength: 500 },
  clicks: { type: Number, default: 0 },
}, { timestamps: true }).index({ cat: 1, createdAt: -1 }).index({ createdAt: -1 }));

// Thuê bao Web Push: mỗi trình duyệt / thiết bị một dòng (endpoint duy nhất). Tự xóa sau 180 ngày không làm mới.
const PushSub = model('PushSub', new Schema({
  user: { ...ref('User'), required: true, index: true },
  endpoint: { type: String, required: true, unique: true, maxlength: 800 },
  p256dh: { type: String, required: true, maxlength: 200 }, auth: { type: String, required: true, maxlength: 100 },
  ua: { type: String, maxlength: 120, default: '' },
  createdAt: { type: Date, default: Date.now, expires: 180 * 24 * 3600 },
}));

module.exports = { PushSub, Event, EventMember, Poll, PollVote, Blog, Visitor, Invite, Notification, Album, Photo, Revoked, Session, UpQuota, SsoCode, User, Post, Guestbook, Friendship, Message, Poke, ProfileField, Category, Group, GroupMember, GroupInvite, Thread, GroupPost, Doing, Share, Blacklist, Report, CreditLog, UserTask, Topic, TopicMember, TopicPost, CensorWord, CreditRule, TaskDef, HotUser, IpBan, AdminLog, SiteConfig, UserGroup, BlogCat, EventCat, MagicDef, UserMagic, MagicLog, ForumCat, Forum, ForumThread, ForumPost, ForumSub, MusicGenre, MusicAlbum, MusicSong, MusicPlaylist, VideoCat, Video, Quiz, QuizAttempt, PageCat, Page, GiftCat, Gift, UserGift, Announcement, Bulletin, Newsletter, Favorite, Rating, ContactMsg, Faq, Shout, LinkCat, Link };
