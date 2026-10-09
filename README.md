# CoolAir – Vue 3 + Node.js + MongoDB

## Chạy thử
1. Cài Node.js >= 18.11 và MongoDB (hoặc tạo cluster miễn phí trên MongoDB Atlas).
2. `npm install`
3. `cp .env.example .env` rồi điền `MONGODB_URI` và `JWT_SECRET`
   (tạo secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. `npm install && npm run build && npm start` → mở http://localhost:3000 (frontend build từ `src/` ra `public/`; xem mục Cấu trúc front-end).

## Giới hạn tần suất (rate limit)

Mọi `rateLimit({...})` trong `server/` dùng `store: rlStore('tên')` (`server/ratestore.js`): bộ đếm lưu trong MongoDB (collection `ratelimits`, TTL tự dọn) nên **dùng chung giữa các instance serverless của Vercel** (store RAM mặc định thì mỗi instance đếm riêng, gần như vô hiệu). Mỗi request có giới hạn tốn thêm 1 lượt ghi MongoDB. Nếu MongoDB lỗi thì tạm đếm trong RAM, không chặn người dùng. Thêm limiter mới: nhớ gắn `store: rlStore('file.tên')` (có test kiểm tra).

## Cấu trúc front-end (Vite)

- Mã nguồn: `index.html` (gốc dự án) + `src/`. Entry `src/main.js` import các module theo đúng thứ tự nạp cũ (`mount.js` cuối cùng). `src/lib/` = dữ liệu ảnh + tiện ích lõi (`images.js`, `core.js`), `src/modules/` = từng mục (post, album, blog, forum, ...), `src/app.js` = ứng dụng Vue chính. Mỗi file giờ là ES module: dùng gì thì `import`, chia sẻ gì thì `export` (không còn biến toàn cục chung).
- CSS: `src/css/{app,emoji,tailwind}.css` + `static/neo.css`. Thứ tự link trong `<head>` quyết định cascade (Tailwind phải cuối). Tailwind chạy qua PostCSS của Vite (`tailwind.config.js`, `postcss.config.js`); thêm class mới không cần bước build riêng.
- `static/` = file tĩnh chép nguyên (sw.js, manifest, icons, img, neo.css, theme-init.js). **`public/` là KẾT QUẢ build (gitignore)**, Express/Vercel vẫn phục vụ từ đó như trước.
- Vue, twemoji và Ably lấy từ npm và bundle bằng Vite. Vue dùng bản runtime-only vì template được biên dịch lúc build (xem mục "Template Vue biên dịch lúc build"), nên CSP không cần `unsafe-eval`.
- Chạy: `npm run build` (ra `public/`, tên file có hash nên không cần `?v=`) rồi `npm start`; hoặc dev: `npm run dev` (Express :3000) + `npm run dev:web` (Vite :5173, proxy /api, hot reload). Vercel tự chạy `npm run build` (`buildCommand` trong vercel.json).
- CSP `script-src` không có `unsafe-inline`: đừng thêm `<script>…</script>`, `onclick="…"` hay link `javascript:` vào trang (server/csp.js).

## MongoDB Atlas (free M0)
Tạo cluster M0 → Database Access: tạo user → Network Access: thêm IP của bạn → Connect → Drivers: copy chuỗi
`mongodb+srv://...` vào `MONGODB_URI` (thêm tên database, ví dụ `/coolair`, trước dấu `?`).

## Email xác thực
Đăng ký xong, người dùng nhận mã 10 số (hiệu lực 15 phút, sai tối đa 5 lần) và phải nhập mã trước khi đăng nhập. Tài khoản chưa xác thực vẫn đăng nhập được nhưng chỉ vào được trang Cài đặt (sửa thông tin, gửi mã xác thực); các API khác trả 403 cho tới khi xác thực. Tài khoản tạo trước khi có tính năng này vẫn dùng bình thường.
Cần thêm `nodemailer` (`npm install`) và 5 biến môi trường: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (mẫu trong `.env.example`).
Trên production, thiếu `SMTP_HOST` thì đăng ký báo lỗi (không bỏ qua xác thực). Chạy local không có SMTP thì mã được in ra console.

## API (tiền tố /api, trừ auth đều cần header `Authorization: Bearer <token>`)
| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | /auth/register | username, email, password (name tùy chọn, mặc định = username) → gửi mã 10 số qua email (chưa trả token) |
| POST | /auth/verify, /auth/resend | {email, code} → trả token / {email} gửi lại mã (cách 60 giây) |
| POST | /auth/forgot, /auth/reset | {email} gửi mã 10 số đặt lại mật khẩu (luôn trả ok, cách 60 giây) / {email, code, password} đặt mật khẩu mới (đồng thời xác thực email) |
| POST | /auth/login | id (email hoặc username), password |
| GET | /me | thông tin người dùng hiện tại (kèm verified, phone, birthday, age). Nếu token cũ chưa có `sid` thì trả thêm `token` mới để thay |
| PATCH | /settings | {name, username?, phone, birthday:'YYYY-MM-DD', location, bio, extra?: {<fieldId>: giá trị}} – dùng được cả khi chưa xác thực email |
| POST | /settings/send-code | gửi mã xác thực email cho tài khoản đang đăng nhập |
| GET | /upload/sign?kind=avatar | cấp chữ ký để trình duyệt tải ảnh thẳng lên Cloudinary (giới hạn 30 lần / 10 phút); 503 nếu chưa đặt biến `CLOUDINARY_*` |
| PUT / DELETE | /me/avatar | `{url}` lưu ảnh đại diện (chỉ nhận URL Cloudinary đúng cloud + đúng id của chính mình) / gỡ ảnh và xóa trên Cloudinary |
| GET / POST | /users/:id/albums · /albums | danh sách album của một người, lọc theo quyền riêng tư, phân trang `?page=&per=` (12/trang, tối đa 50) · tạo album `{title, visibility}` (tối đa 50 album / người) |
| GET / PATCH / DELETE | /albums/:id | xem album + ảnh (24 ảnh/lượt, `?before=<id ảnh>` để xem thêm) · đổi `title` / `visibility` / `cover` · xóa album; `?moveTo=<id album của mình>` = chuyển hết ảnh sang album đó rồi mới xóa (không có = xóa luôn ảnh trên Cloudinary) |
| POST | /albums/:id/photos | `{url, caption?}` đăng ký ảnh vừa tải lên (chỉ nhận URL Cloudinary đúng cloud + `albums/<id của mình>/...`; tối đa 200 ảnh / album) |
| POST | /albums/:id/move · /albums/:id/photos/delete | `{ids, to}` chuyển nhiều ảnh (tối đa 100) sang album khác của mình · `{ids}` xóa nhiều ảnh |
| GET / PATCH / DELETE | /photos/:id | ảnh kèm cảm xúc + bình luận · sửa chú thích · xóa ảnh |
| POST / DELETE | /photos/:id/reaction · /photos/:id/comments[/:cid] | thả / bỏ cảm xúc `{emoji}` (bấm lại = bỏ) · bình luận 1–500 ký tự (tối đa 200 / ảnh) · xóa bình luận (người viết hoặc chủ ảnh). Cùng quyền xem với album; giới hạn 30 lần / phút |
| GET / POST | /posts | bảng tin = bài của mình + bạn bè (không gồm bài 'private'); POST nhận `{text?, visibility, photos?:[url], video?:{kind,url}}` (text được trống nếu có ảnh / video; `visibility`: public / friends / private (mặc định 20 bài mới nhất; `?limit=1..50`, `?before=ISO_DATE` để tải trang cũ hơn, `?mine=1` chỉ bài của mình, `?author=<id>` bài của một người) / đăng bài; giới hạn 40 bài / 10 phút) |
| PATCH | /posts/:id | {text?, visibility?} – tác giả sửa nội dung / quyền riêng tư bài của mình (có dấu "đã chỉnh sửa") |
| PATCH | /posts/:id/visibility | {visibility} – tác giả đổi quyền riêng tư của bài |
| DELETE | /posts/:id | xóa bài của chính mình (dọn luôn ảnh / video của bài trên Cloudinary) |
| GET | /video/grab?url= | xem trước link video: `{video:{kind:'embed', site, vid, url, title, thumb}}`; 400 nếu site không được hỗ trợ / video không tồn tại, riêng tư hoặc cấm nhúng (20 lần / phút) |
| POST | /post-media/discard | `{url}` xóa ảnh / video đã tải lên nhưng chưa gắn vào bài nào (chỉ file của chính mình) |
| POST | /posts/:id/react | {emoji} – bấm lại cùng emoji để bỏ |
| POST | /posts/:id/comments | {text} |
| GET / POST | /guestbook/:userId | lưu bút {text, gift} |
| GET | /users/:id | hồ sơ công khai (name, username, rel, friendCount; ngày sinh chỉ bạn bè thấy; không lộ email/sđt) |
| GET | /users?q= | tìm người theo tên / username (kèm `rel`: none, sent, received, friends) |
| GET | /friends | {friends (kèm unread), incoming, sent} |
| POST | /friends/:id/request, /friends/:id/accept | gửi lời mời / chấp nhận |
| DELETE | /friends/:id | hủy kết bạn, từ chối hoặc hủy lời mời |
| GET | /friends | (mở rộng) mỗi bạn kèm `g` (nhóm 0–7 do mình xếp), thêm `groups` (tên 8 nhóm), `hidden` (nhóm ẩn khỏi bảng tin), `visitorNew` (số khách mới) |
| POST / PUT | /friends/group · /friends/:id/group | `{ids, group}` xếp nhiều bạn (tối đa 200) / `{group}` xếp một bạn vào nhóm 0–7 (chỉ ảnh hưởng cách mình phân loại, người kia không thấy) |
| PUT | /me/friend-groups · /me/friend-groups/hidden | `{names:[7 tên]}` đổi tên nhóm 1–7 (≤ 20 ký tự, để trống = mặc định) · `{hidden:[số nhóm]}` ẩn bài của các nhóm đó khỏi bảng tin |
| GET | /friends/suggest | `{fof, active}`: bạn của bạn bè (kèm `mutual`, xếp theo số bạn chung) + thành viên hoạt động trong 7 ngày; loại mình, bạn bè, người đã có lời mời, tài khoản khóa / chưa xác thực |
| GET | /friends/random | `{id}` một người bạn ngẫu nhiên (dưới 5 bạn thì lẫn thêm người mới hoạt động) |
| GET | /users/:id/mutual | `{count, users}` bạn chung với một người (tối đa 30 người) |
| GET | /me/visitors · /me/trace | ai đã ghé trang mình (kèm `isNew`; mở trang 1 = đánh dấu đã xem) · mình đã ghé trang của ai; `?page=` 20/trang. Chỉ chủ tài khoản xem được |
| GET | /invites/check?code= | (không cần đăng nhập) mã mời còn dùng được không, người mời là ai (chỉ tên + ảnh đại diện) |
| GET / POST / DELETE | /invites · /invites/:id | mã mời của mình (tối đa 20 mã chưa dùng; dùng một lần) · tạo mã · xóa mã chưa dùng |
| POST | /auth/register | (mở rộng) nhận thêm `invite` – mã 12 ký tự hex, tùy chọn |
| POST | /auth/logout | thu hồi phiên đăng nhập hiện tại: mọi domain dùng chung phiên này đều bị đăng xuất; thiết bị / lần đăng nhập khác không ảnh hưởng. Token hỏng hoặc hết hạn cũng trả ok |
| GET | /sessions | danh sách thiết bị đang đăng nhập của mình: `{sessions:[{sid, device, ip, createdAt, current}]}` |
| DELETE | /sessions/:sid | thu hồi một phiên của mình (kể cả phiên hiện tại → client tự đăng xuất) |
| DELETE | /sessions | đăng xuất mọi thiết bị khác, giữ lại phiên hiện tại |
| GET | /sso/info | domain hiện tại có tham gia đăng nhập một lần không, domain chính là gì (không cần đăng nhập) |
| POST | /sso/issue | (chỉ chạy trên domain chính) `{origin}` – có đăng nhập thì cấp mã dùng 1 lần, chưa thì báo "none"; trả `{url}` để chuyển hướng về domain phụ |
| POST | /sso/exchange | (domain phụ) `{code}` – đổi mã lấy `{token, user}`; mã dùng 1 lần, hết hạn sau 60 giây, đúng domain nhận |
| GET | /realtime/token | cấp token Ably (chỉ nghe hộp thư của mình + kênh "đang gõ" với bạn bè); 503 nếu chưa đặt `ABLY_API_KEY` |
| GET | /realtime/ice | danh sách STUN/TURN cho cuộc gọi (TURN Cloudflare nếu đã cấu hình, không thì chỉ STUN) |
| POST | /call/:id/signal | {type: invite/accept/reject/offer/answer/ice/end, data} – chuyển tín hiệu gọi tới một người bạn qua Ably |
| GET | /profile-fields | danh sách trường hồ sơ mở rộng (title, note, formtype text/select, maxsize, required, invisible, allowsearch, choice, displayorder) |
| POST / PATCH / DELETE | /admin/profile-fields[/:id] | (quản trị viên) thêm / sửa / xóa trường; xóa trường sẽ xóa luôn giá trị của mọi người dùng |
| PUT | /admin/profile-fields/order | (quản trị viên) `{order: {<id>: số}}` cập nhật thứ tự hiển thị hàng loạt |
| GET | /admin/stats | (quản trị viên) tổng số thành viên / online 5 phút / hoạt động 24 giờ & 7 ngày / bài / bình luận / ảnh / tin nhắn / nhóm…, biểu đồ 14 ngày (thành viên, bài viết, tin nhắn mới – theo giờ Việt Nam), top 5 nhóm, top 5 người đăng bài 30 ngày, 5 thành viên mới nhất |
| GET | /admin/users | (quản trị viên) `?q=&filter=all\|recent\|unverified\|banned&page=` danh sách thành viên (20/trang) kèm thống kê `{total, recent, unverified, banned}` |
| GET | /admin/users/:id | (quản trị viên) chi tiết + số bài viết / album / ảnh / bạn bè / nhóm / chủ đề |
| POST | /admin/users/:id/ban · /unban · /verify | (quản trị viên) khóa `{reason?}` / mở khóa / xác thực email thủ công. Không áp dụng cho quản trị viên và chính mình |
| DELETE | /admin/users/:id | (quản trị viên) xóa vĩnh viễn, body `{username}` phải đúng tên đăng nhập của người bị xóa. Dọn luôn bài, ảnh (cả trên Cloudinary), tin nhắn, bạn bè, chọc, lưu bút, thông báo, chủ đề / trả lời và tư cách thành viên nhóm (nhóm trống bị xóa, chủ nhóm đi thì nâng người kế tiếp) |
| GET | /group-categories | danh sách chuyên mục nhóm |
| POST / PATCH / DELETE | /admin/group-categories[/:id] | (quản trị viên) thêm / sửa / xóa chuyên mục; xóa phải chọn chuyên mục nhận các nhóm (`?to=<id>`). `PUT /admin/group-categories/order` đổi thứ tự |
| GET | /groups | `?view=hot\|recommend\|me\|manage&category=&q=&orderby=threadNum\|postNum\|memberNum&page=` |
| POST | /groups | tạo / vào nhóm: `{category, name}` (chuyên mục tự đặt tên) hoặc `{category, names:[...]}` (chọn từ danh sách) |
| GET / PATCH / DELETE | /groups/:id | trang nhóm / phó nhóm trở lên đổi thông báo + ảnh đại diện `pic` (URL http/https ≤150 ký tự, để trống = `/img/nologo.jpg`), chủ nhóm đổi quyền (quản trị viên: đề cử, đóng) / quản trị viên xóa nhóm |
| POST | /groups/:id/join, /groups/:id/leave | vào (hoặc xin vào nếu nhóm cần duyệt) / rời nhóm |
| GET / POST | /groups/:id/members | danh sách thành viên / `{ids, grade}` duyệt, đổi cấp, cấm (-1), đuổi (-9) |
| GET / POST | /groups/:id/invitable, /groups/:id/invite | bạn bè có thể mời / `{ids}` gửi lời mời |
| GET / POST / DELETE | /group-invites, /group-invites/:groupId/accept, /group-invites/:groupId (hoặc `all`) | lời mời của mình |
| GET / POST | /groups/:id/threads | chủ đề (`?digest=1&q=&page=`) / đăng chủ đề `{subject, text}` |
| GET / PATCH | /threads/:tid | xem chủ đề (`?page=`) / phó nhóm trở lên ghim `{top}` hoặc đánh dấu tinh hoa `{digest}` |
| POST | /threads/:tid/posts | trả lời `{text, quoteId?}` |
| PATCH / DELETE | /group-posts/:pid | sửa / xóa bài (tác giả hoặc phó nhóm trở lên; xóa bài mở đầu = xóa cả chủ đề) |
| PUT | /theme | {theme: ''/t3/t4/t5/t10/t11/t12/t13/t14/custom, bg, accent (chỉ khi custom, dạng #RRGGBB), noTheme?} – đổi giao diện trang cá nhân / bật tắt việc xem giao diện của người khác; `/me` và `/users/:id` trả kèm `theme` |
| GET | /pokes | lời chọc mới gửi cho mình (kèm `rel` với người chọc: none, sent, received, friends) |
| POST | /pokes/:id | {icon: 0–13, note ≤ 25 ký tự, reply?: true} – chọc một người (chọc lại ghi đè; `reply` xóa lời chọc của họ gửi mình) |
| DELETE | /pokes, /pokes/:id | bỏ qua tất cả / bỏ qua lời chọc của một người |
| GET / POST | /messages/:id | hội thoại với bạn bè (`?after=<id tin cuối>` để lấy tin mới) / gửi {text} |
| GET / POST | /events | `?view=upcoming\|past\|mine\|going&page=` (10/trang, lọc theo quyền xem) · tạo sự kiện `{title, detail?, location?, start, end?, limit?, visibility}` (tối đa 100 / người; người tạo tự được tính là tham gia) |
| GET / PATCH / DELETE | /events/:id | xem (kèm trạng thái của mình `my`, người tham gia, bình luận) · chủ sự kiện sửa · xóa (dọn luôn người tham gia + thông báo) |
| POST / DELETE | /events/:id/join | `{status:'going'\|'maybe'}` tham gia / quan tâm (409 nếu đủ `limit`; sự kiện đã kết thúc thì từ chối) · rút lui (chủ sự kiện không rút được) |
| GET | /events/:id/members | `?status=going\|maybe&page=` danh sách người tham gia (30/trang) |
| POST / DELETE | /events/:id/comments[/:cid] | bình luận 1–500 ký tự (tối đa 200) · xóa (người viết hoặc chủ sự kiện). Thông báo `event_comment`, `event_join` cho chủ sự kiện |
| GET / POST | /polls | `?view=all\|friends\|mine&page=` · tạo `{question, options:[2–10], multiple?, maxChoice?, days: 0–90 (0 = không hạn), visibility}` (tối đa 100 / người) |
| GET / DELETE | /polls/:id | xem (kèm `options[{voteNum,pct}]`, `my`, `canVote`, 20 người chọn gần nhất) · chủ bình chọn xóa (xóa luôn phiếu) |
| POST | /polls/:id/vote | `{choices:[chỉ số]}` – mỗi người một lần, không đổi được (409 nếu đã chọn; từ chối khi hết hạn) |
| GET | /search | `?q=&type=all\|users\|posts\|blogs\|events\|polls\|groups\|threads\|doings\|shares\|topics&page=` (q 2–40 ký tự; `all` = 5 kết quả đầu mỗi loại, từng loại = 10/trang, tối đa 50 trang; 40 lần / phút) |
| GET / POST | /doings | trạng thái ngắn `?view=feed\|mine\|user&id=&page=` (15/trang, kèm `moods`) · đăng `{text ≤200, mood?, visibility}` |
| DELETE | /doings/:id | xóa trạng thái của mình |
| POST / DELETE | /doings/:id/replies[/:rid] | trả lời `{text ≤200, parent?}` (trả lời lồng nhau 1 cấp) · xóa (người viết hoặc chủ trạng thái; xóa cả trả lời con). Thông báo `doing_reply` |
| PUT | /me/mood | `{mood}` đặt tâm trạng hiện tại (trong danh sách `moods`, để trống = xóa) |
| GET | /shares | `?view=feed\|mine\|user&id=&page=` danh sách chia sẻ (15/trang) |
| POST | /shares | chia sẻ `{kind: post\|blog\|photo\|event\|poll\|doing\|link, target?, url?+title? (cho link), note? ≤200, visibility}` – kiểm tra quyền xem nội dung gốc, không tự share của mình |
| DELETE | /shares/:id | xóa chia sẻ của mình |
| POST / DELETE | /shares/:id/comments[/:cid] | bình luận `{text ≤500, parent?}` (đa cấp) · xóa |
| GET | /credit/me | điểm, kinh nghiệm, cấp bậc của mình + bảng quy tắc cộng điểm |
| GET | /credit/log | lịch sử cộng điểm `?page=` (20/trang) |
| GET / POST | /tasks · /tasks/:id/claim | nhiệm vụ tân thủ (kèm `done`, `claimed`) · nhận thưởng khi đã hoàn thành |
| GET / POST | /topics | `?page=` danh sách chủ đề nóng (20/trang) · (quản trị viên) tạo `{title, desc?, pic?, hot?}` |
| GET / PATCH / DELETE | /topics/:id | xem (kèm `joined`, nội dung đã gắn) · (quản trị viên) sửa / xóa |
| POST / DELETE | /topics/:id/join | tham gia / rời chủ đề |
| POST / DELETE | /topics/:id/attach[/:aid] | gắn nội dung của mình `{kind: post\|blog\|doing, target}` vào chủ đề · gỡ |
| GET | /discover | `?type=posts\|blogs\|doings&page=` nội dung công khai mới nhất từ người lạ (15/trang, tối đa 20 trang) |
| GET | /discover/top | `?by=credit\|experience\|friends` bảng xếp hạng thành viên (20 người) |
| GET | /rss.xml · /rss/user/:id.xml | (không cần đăng nhập) RSS nhật ký công khai toàn site / của một người |
| GET / POST / DELETE | /blacklist · /blacklist/:id | danh sách chặn · chặn `{user}` · bỏ chặn. Bị chặn (2 chiều) thì không xem trang, không nhắn tin/chọc/kết bạn/lưu bút/bình luận được; bài của họ bị loại khỏi bảng tin |
| PUT / GET | /me/feed-hidden | `{ids ≤200}` ẩn bài của những người cụ thể khỏi bảng tin · xem danh sách đang ẩn |
| POST | /reports | tố cáo `{kind: post\|blog\|photo\|album\|event\|poll\|doing\|share\|user\|comment, target, reason ≤300, parentKind?+commentId? (cho comment)}` – mỗi người chỉ tố cáo 1 nội dung 1 lần |
| GET / PATCH | /admin/reports · /admin/reports/:id | (quản trị viên) `?status=open\|reviewing\|resolved\|dismissed&page=` duyệt tố cáo · `{action: dismiss\|delete\|ban, note?}` xử lý |
| POST | /invites/email | gửi email mời `{email}` (tạo mã mời mới và gửi link đăng ký) |
| GET | /blogs/clicks | danh sách biểu lộ cảm xúc định sẵn |
| POST | /blogs/:id/click | `{clickId}` bày tỏ cảm xúc (bấm lại = bỏ, bấm khác = đổi); mỗi người một cảm xúc |
| GET | /blogs | `?tag=&page=` nhật ký công khai theo tag (10/trang) |
| POST / PATCH | /blogs[/:id] | (mở rộng) nhận thêm `tags` – tối đa 5 tag, mỗi tag ≤20 ký tự, không trùng |
| POST | /posts/:id/comments · /blogs/:id/comments | (mở rộng) nhận thêm `parent` – id bình luận cha để trả lời lồng nhau |
| GET | /users/:id | (mở rộng) trả thêm `mood`, `credit`, `level`; 403 nếu hai bên đã chặn nhau |
| GET | /posts | (mở rộng) bảng tin loại bài của người đã chặn / bị chặn và người tự ẩn |
| GET / DELETE | /admin/mod/posts · /admin/mod/blogs · /admin/mod/doings · /admin/mod/shares · /admin/mod/photos · /admin/mod/albums · /admin/mod/events · /admin/mod/polls · /admin/mod/threads | (quản trị viên) kiểm duyệt nội dung `?q=&page=` · xóa vĩnh viễn từng mục (xóa album dọn ảnh bên trong; xóa sự kiện dọn người tham gia; xóa bình chọn dọn phiếu; xóa chủ đề nhóm dọn bài trả lời) |
| GET / DELETE | /admin/mod/:kind/:id/comments[/:cid] | (quản trị viên) xem / xóa bình luận của bài viết, nhật ký, trạng thái, chia sẻ, sự kiện, ảnh |
| GET | /shares/:id/comments | xem bình luận của một chia sẻ (kiểm tra quyền xem) |
| GET / POST / PATCH / DELETE | /topics[/:id] | chủ đề nóng: `?all=1` (admin xem cả chủ đề đã đóng) · admin tạo/sửa/xóa |
| POST | /invites/email | gửi lời mời đăng ký qua email `{email}` (tạo mã mời + gửi mail) |
| POST | /auth/login/totp | bước 2 đăng nhập 2FA: `{totpToken, code}` (mã 6 số hoặc mã dự phòng) -> `{token, user}` |
| POST | /auth/totp/setup | (đã đăng nhập) tạo secret mới, trả `{qr, secret, otpauth}` để quét bằng app | |
| POST | /auth/totp/enable | (đã đăng nhập) xác nhận mã 6 số -> bật 2FA + trả 8 mã dự phòng (hiện 1 lần) | |
| POST | /auth/totp/disable | (đã đăng nhập) `{password, code}` -> tắt 2FA | |
| POST | /auth/totp/backup-codes | (đã đăng nhập) `{code}` -> tạo lại 8 mã dự phòng | |
| GET / PUT | /me/privacy | quyền xem từng phần hồ sơ (info/blog/album/doing/guestbook = public/friends/private) |
| GET | /blogs/suggest-tags | gợi ý tag từ tiêu đề + nội dung (thay relatekw — dịch vụ Discuz gốc đã chết) |
| POST | /import/rss | nhập nhật ký từ URL RSS/Atom `{url, visibility}` (tối đa 20 bài, bỏ trùng) |
| GET / POST | /admin/cron, /admin/cron/run | tác vụ dọn dẹp định kỳ: xóa tài khoản chưa xác thực 7 ngày, dọn nhật ký admin 1 năm, gỡ mã xác thực hết hạn |
| GET / PUT | /admin/themes, /themes | quản lý giao diện: bật/tắt theme, đặt theme mặc định |
| GET | /magics, /magics/mine, /magics/log, /magics/visitors | cửa hàng đạo cụ, túi của tôi, nhật ký, khách ghé thăm |
| POST | /magics/:mid/buy, /magics/:mid/gift, /magics/:mid/use, /magics/reveal/check | mua / tặng (cần Giấy phép) / sử dụng 21 loại đạo cụ / chiếu yêu |
| GET / PATCH | /admin/magics[/:mid] | (quản trị viên) bật/tắt đạo cụ, đổi giá |
| POST | /settings/password | đổi mật khẩu (cần mật khẩu hiện tại; xong thì đăng nhập lại) |
| GET | /tags/:tag | duyệt nhật ký theo tag `?page=` |
| GET | /admin/magiclog | (quản trị viên) nhật ký mua/dùng/tặng đạo cụ `?page=` |
| PUT / DELETE | /me/cover | tải lên / gỡ ảnh bìa trang cá nhân (qua Cloudinary, 1200x400) |
| DELETE | /admin/mod/posts/:id/comments/:cid · /admin/mod/blogs/:id/comments/:cid | (quản trị viên) xóa bình luận |
| GET / POST / DELETE | /admin/censor · /admin/censor/:id | (quản trị viên) danh sách từ cấm · thêm `{word, replacement?}` · xóa. Tự áp dụng khi đăng bài/blog/trạng thái/chia sẻ/bình luận |
| GET / PATCH | /admin/credit-rules · /admin/credit-rules/:id | (quản trị viên) xem / sửa quy tắc cộng điểm `{credit, exp, max, cycle, label, enabled}` |
| GET / PATCH | /admin/tasks · /admin/tasks/:id | (quản trị viên) xem / sửa định nghĩa nhiệm vụ |
| GET / PUT | /admin/clicks | (quản trị viên) xem / đặt lại danh sách cảm xúc click (tối đa 12) |
| GET / POST / DELETE | /admin/hotusers · /admin/hotusers/:id | (quản trị viên) thành viên nổi bật · thêm `{user, note?}` · gỡ |
| GET | /hotusers | danh sách thành viên nổi bật (20 người) |
| GET / POST / DELETE | /admin/ipbans · /admin/ipbans/:id | (quản trị viên) chặn IP · thêm `{ip, reason?}` · gỡ. IP bị chặn không đăng nhập/đăng ký/dùng được |
| GET | /admin/logs | (quản trị viên) nhật ký hành động admin `?page=` |
| GET / PUT | /admin/site-config | (quản trị viên) xem / sửa cấu hình: tên site, mở đăng ký, chỉ mời, thông báo chung |
| GET | /site-config | (không cần đăng nhập) tên site, thông báo chung, trạng thái mở đăng ký |
| GET / POST / PATCH / DELETE | /admin/user-groups[/:id] | (quản trị viên) nhóm quyền: tên + các quyền (đăng bài, bình luận, tạo mã mời, tạo nhóm, tạo sự kiện) |
| POST | /admin/users/:id/group | (quản trị viên) gán `{group}` (hoặc rỗng để gỡ) nhóm quyền cho thành viên |
| GET / POST / PATCH / DELETE | /blog-cats[/:id] | chuyên mục nhật ký của mình `?user=&mine=` · tạo `{name}` · đổi tên · xóa (bài về "Chưa phân loại") |
| POST / PATCH | /blogs[/:id] | (mở rộng) nhận thêm `cat` – id chuyên mục (để trống = gỡ) |
| GET | /users/:id/blogs | (mở rộng) `?cat=` lọc theo chuyên mục |
| GET / PUT | /me/feed-prefs | xem / sửa hoạt động nào của mình hiện lên bảng tin bạn bè (`post`, `doing`, `share`) |
| GET | /event-cats | danh sách phân loại sự kiện (kèm số sự kiện mỗi loại) |
| GET / POST / PATCH / DELETE | /admin/event-cats[/:id] | (quản trị viên) quản lý phân loại sự kiện dùng chung toàn site |
| GET / POST / PATCH | /events[/:id] | (mở rộng) nhận thêm `cat` – id phân loại; `?cat=` lọc theo phân loại |
| GET | /admin/tags | (quản trị viên) liệt kê tag nhật ký kèm số bài |
| POST | /admin/tags/merge | (quản trị viên) gộp/đổi tên tag `{from, to}` trên toàn site |
| DELETE | /admin/tags/:tag | (quản trị viên) xóa tag khỏi mọi nhật ký |
| GET | /admin/backup | (quản trị viên) tải về bản sao lưu toàn bộ dữ liệu dạng JSON (đã lược mật khẩu/mã xác thực) |

## Đã làm / chưa làm
- Có: bcrypt (cost 12), JWT 7 ngày, rate-limit đăng nhập/đăng ký, validate phía server, chỉ nhận chuỗi (chống NoSQL injection), helmet.
- Chưa: game (đã gỡ phần dữ liệu mẫu, sẽ làm lại khi có tính năng thật), refresh token.

## Nhật ký vá bảo mật (đợt pentest 2026-10-07)
- **Chiếm quyền admin (critical)**: `adminOnly` giờ yêu cầu email đã xác thực; chặn đăng ký bằng email trong `ADMIN_EMAILS`.
- **Chiếm tài khoản qua đăng ký lại (M1)**: email chưa xác thực đăng ký lại không còn ghi đè mật khẩu/tên đăng nhập, chỉ gửi lại mã.
- **SSRF**: `POST /import/rss` dùng `server/safefetch.js` (chặn IP nội bộ/loopback/link-local ở mọi bước redirect, message lỗi chung) + rate-limit 20/giờ.
- **SSRF qua push**: `/push/subscribe` chỉ nhận endpoint của dịch vụ push chuẩn (FCM/Mozilla/Apple/Windows).
- **Open redirect**: `/links/:id/go` hiện trang cảnh báo trung gian (escape đầy đủ) trước khi chuyển.
- **X-Forwarded-For giả mạo**: `clientIp()` dùng `req.ip` (tôn trọng `trust proxy`); `TRUST_PROXY` cấu hình được qua env.
- **Session**: đổi/quên mật khẩu thu hồi **mọi** phiên (trước đây quên mật khẩu không thu hồi, đổi mật khẩu chỉ thu hồi phiên hiện tại).
- **JWT**: verify giới hạn `algorithms: ['HS256']`.
- **Timing oracle login**: user không tồn tại vẫn chạy bcrypt với hash giả để thời gian hằng định; log LOGIN không ghi id/found.
- **2FA (thay captcha)**: đăng nhập 2 bước kiểu Google Authenticator (TOTP 6 số/30s, tự cài bằng `crypto` theo RFC 6238 — không dùng `otplib` vì v13 kéo theo `@scure/base` ESM-only gây sập `require()` trên Node cũ; đã kiểm chứng với test vector RFC). Secret mã hóa AES-256-GCM trong DB; token tạm `purpose:'totp'` sống 5 phút và bị `session.check` từ chối ở mọi API khác; brute-force mã 6 số bị chặn bởi rate-limit 15 lần/15 phút; tắt 2FA đòi mật khẩu + mã; 8 mã dự phòng hash HMAC, mỗi mã dùng 1 lần.
- **Token mã hóa (JWE)**: payload `{id, sid}` được mã hóa AES-256-GCM (khóa dẫn xuất từ `JWT_SECRET`, tự cài bằng `crypto` của Node theo chuẩn RFC 7516 — không dùng thư viện `jose` vì bản mới ESM-only gây sập `require()` trên Node cũ), không còn base64-decode là đọc được như JWT thường. Token cũ (JWS) vẫn dùng được tới khi hết hạn để không đá mọi người ra cùng lúc.
- **Cookie HttpOnly**: token nằm trong cookie `ca_tk` (`HttpOnly`, `SameSite=Lax`, `Secure` khi HTTPS) thay vì `localStorage` — JavaScript không đọc được nên XSS cũng không cắp được token. Vẫn nhận token qua header `Authorization` cho client cũ. Đăng xuất xóa cookie + thu hồi phiên.
- **NoSQL injection**: `GET /shares`, `/doings` với `view=user` validate `id` bằng `isValidObjectId`.
- **Quiz**: `/quizzes/:id/take` và `/results` kiểm tra `visibility` (private/friends) như route xem.
- **Race condition**: `spend()` trừ điểm nguyên tử (`$gte` trong cùng update); claim thưởng nhiệm vụ nguyên tử (`findOneAndUpdate`); `reveal/check` trừ lượt nguyên tử; join sự kiện chiếm chỗ nguyên tử (`goingNum < limit`).
- **Duyệt tố cáo**: không cho khóa chính mình / tài khoản admin qua `PATCH /admin/reports/:id`.
- **Riêng tư**: `GET /blog-cats` của người khác chỉ đếm blog được phép xem; `GET /topics/:id` ẩn chủ đề đã đóng với non-admin; boosted posts áp dụng exclusion bạn bè/blocked; ex-member không sửa/xóa bài trong nhóm kín; thêm `blockedBetween` cho reaction/comment ảnh, join/comment sự kiện, vote.
- **Upload**: hạn mức 2GB/ngày/người cho video/nhạc (`UpQuota`); check định dạng uid trong `avatarUrlOk`/`coverUrlOk`.
- **Backup admin**: loại thêm `rCode`/`rExp` khỏi dump.
- **Rate-limit**: thêm cho `/magics/*/buy|gift|use`, `/magics/reveal/check`, `/auth/login/totp` + `/auth/totp/*` (15 lần/15 phút), `/import/rss`.
- **Còn lại (khuyến nghị)**: rate-limit in-memory vô hiệu gần hết trên serverless → dùng Redis/Upstash store khi lên production đông; đăng ký/đăng nhập không còn captcha → nếu bị spam bot đăng ký, cân nhắc Turnstile/hCaptcha; SSO đa domain vẫn chạy: mỗi domain có cookie HttpOnly của riêng mình, đổi mã 1 lần qua URL fragment như cũ.

## Ảnh và video trong bài viết (port ý tưởng từ phpFox 3: feed + photo + video)
Ở khung đăng bài (trang chủ và tab Nhật ký) có 3 nút: **📷 Ảnh**, **🎬 Video**, **🔗 Link video**. Mã nằm ở `server/media.js` (+ `kind=post` / `postvideo` trong `server/upload.js`).
- **Ảnh**: tối đa 10 ảnh / bài, mỗi ảnh ≤ 20MB (ảnh > 8MB, trừ GIF, được thu nhỏ ngay trên máy trước khi tải), tải thẳng lên Cloudinary (`<CLOUDINARY_FOLDER>/posts/<id người dùng>/<16 hex>`, thu về tối đa 1600px). Trong bài hiển thị dạng lưới (1 / 2 / 3 / 4+ ảnh, ảnh thứ 4 có “+N”), bấm vào mở khung xem lớn (← → Esc).
- **Video tải lên**: 1 video / bài, MP4 / MOV / WEBM ≤ 500MB, có thanh tiến độ; tệp > 90MB tự tải **theo từng khúc 20MB** (Cloudinary giới hạn 100MB mỗi request), khúc lỗi mạng tự thử lại 3 lần. Lưu ở `<CLOUDINARY_FOLDER>/postvideos/<id>/...`. MP4 phát nguyên bản; MOV / WEBM được Cloudinary đổi sang MP4 khi xem (lần xem đầu có thể chậm vài giây). Ảnh bìa lấy từ giây đầu tiên. **Giới hạn cứng còn tùy gói Cloudinary** (xem Settings → Account → Usage limits): gói miễn phí chỉ nhận video ≤ 100MB và ảnh ≤ 10MB, nên muốn dùng đủ 500MB / 20MB phải nâng gói hoặc nhờ Cloudinary tăng giới hạn upload; vượt giới hạn thì báo lỗi rõ ràng. Video lớn cũng tốn dung lượng lưu trữ và băng thông (credits) rất nhanh. Cloudinary có thể không chuyển mã MOV / WEBM kịp thời cho video lớn; khi đó trình duyệt tự phát bản gốc (MP4 H.264 luôn phát tốt nhất).
- **Video bằng link** (như `video.grab` của phpFox): **YouTube, Vimeo, TikTok, Dailymotion**. Server tự tách id từ link và hỏi oEmbed lấy tiêu đề + ảnh bìa; trình duyệt chỉ gửi link, **không gửi được iframe / HTML**, và server phân tích lại khi đăng nên không tin dữ liệu từ máy khách. Video bị xóa / riêng tư / cấm nhúng thì từ chối; site chậm hoặc lỗi mạng thì vẫn cho đăng (thiếu tiêu đề / ảnh bìa). Người xem thấy ảnh bìa + nút ▶, **bấm mới tải trình phát** (YouTube dùng `youtube-nocookie.com`).
- Mỗi bài chỉ có **ảnh hoặc video**, không cả hai (như mỗi mục trong feed của phpFox). Bài có thể không có chữ nếu có ảnh / video.
- Bảo mật: URL ảnh / video phải đúng cloud + đúng thư mục + **đúng id của chính người đăng**, nên không dùng được ảnh của người khác. Xóa bài (hoặc admin xóa tài khoản) sẽ xóa file trên Cloudinary, trừ file mà bài khác của cùng người vẫn đang dùng. Bỏ ảnh / video khỏi khung soạn (chưa đăng) cũng xóa file đã tải lên.
- Chưa có: sửa / bỏ ảnh của bài đã đăng (xóa bài rồi đăng lại), thêm ảnh bài viết vào album tự động, bình luận / cảm xúc riêng từng ảnh trong bài, link rút gọn TikTok (`vm.tiktok.com`) và Facebook video, kiểm tra thời lượng video ở server (chỉ giới hạn dung lượng).
- Không cần biến môi trường mới; dùng chung `CLOUDINARY_*`. Chưa cấu hình Cloudinary thì nút tải ảnh / video báo lỗi, còn đăng video bằng link vẫn dùng được.

## Hồ sơ mở rộng (trường tùy chỉnh – port từ `profilefield` của UCenter Home)
Quản trị viên tự định nghĩa thêm trường cho hồ sơ (Sở thích, Nghề nghiệp, Facebook…); người dùng điền trong **Cài đặt → Hồ sơ mở rộng**.
- Đặt `ADMIN_EMAILS=email1@x.com,email2@x.com` (Vercel: Environment Variables rồi deploy lại). Tài khoản có email đó sẽ thấy khung **🛠️ Quản lý trường hồ sơ mở rộng** trong Cài đặt.
- Mỗi trường: tên, mô tả, kiểu (ô nhập / danh sách chọn một), số ký tự tối đa (1–255), bắt buộc, ẩn khỏi trang cá nhân, cho phép tìm, thứ tự. Tối đa 30 trường.
- Giá trị lưu ở `User.extra` (khóa = id trường). Trường "ẩn" chỉ chủ tài khoản thấy và không dùng để tìm kiếm; trường "cho phép tìm" được tính khi tìm người ở ô tìm kiếm.


## Nhóm (port từ `mtag` / `thread` / `post` / `profield` của UCenter Home)
Mở từ menu **👥 Nhóm** (thanh trên, sidebar, hoặc thẻ "Nhóm" ở trang chủ trên điện thoại).
- **Chuyên mục** (`profield`): quản trị viên (xem `ADMIN_EMAILS`) tạo ở **Nhóm → 🛠️ Chuyên mục**. Mỗi chuyên mục chọn cách lập nhóm: *tự đặt tên* (ai nhập tên chưa có thì tạo nhóm mới, đã có thì vào nhóm đó), *chọn một* hoặc *chọn nhiều* trong danh sách có sẵn; giới hạn số nhóm mỗi người trong chuyên mục; số thành viên tối thiểu để nhóm đăng bài được; chỉ định chủ nhóm thủ công hay tự động (người vào đầu tiên); có cho chủ nhóm đặt cách tham gia hay không.
- **Cấp thành viên** như UCHome: chờ duyệt (-2), bị cấm (-1), thành viên (0), thành viên sao (1), phó nhóm (8), chủ nhóm (9). Quản trị viên hệ thống luôn có quyền chủ nhóm ở mọi nhóm.
- **Chủ nhóm** đặt: cách tham gia (tự do / duyệt / chỉ mời – nếu chuyên mục cho phép), ai xem được nội dung, ai được đăng chủ đề / trả lời, thông báo nhóm. **Phó nhóm** duyệt / cấm / đuổi thành viên, ghim, đánh dấu tinh hoa, sửa-xóa bài của người khác.
- **Chủ đề & trả lời** có trích dẫn, sửa (có dấu "đã sửa"), xóa; chủ đề ghim 📌 lên đầu, tinh hoa 💎 có tab riêng.
- **Mời bạn**: thành viên (hoặc phó nhóm trở lên với nhóm cần duyệt) mời được bạn bè; người được mời vào thẳng không cần duyệt.
- Nhóm không còn thành viên nào thì tự bị xóa cùng chủ đề/bài viết; chủ nhóm duy nhất của nhóm kín không rời được.
- **Chưa port** (UCHome có nhưng coolair chưa có nền tảng): ảnh đại diện nhóm, hoạt động (event) của nhóm, thông báo / email khi có trả lời, báo cáo vi phạm, tích điểm, chủ đề "hot", đánh giá cảm xúc chủ đề, chủ đề từ ảnh/album, BBCode.
- Dữ liệu ở 6 collection: `categories`, `groups`, `groupmembers`, `groupinvites`, `threads`, `groupposts`.

## Bạn bè nâng cao + khách ghé thăm (port từ UCenter Home: `visitor`, `getfriendgroup`, `cp_friend`, `cp_invite`)
Mã nằm ở `server/social.js`; giao diện ở **trang cá nhân → Bạn bè** (5 mục con: Danh sách / Gợi ý / Khách ghé thăm / Dấu chân / Mời bạn) và trang cá nhân của người khác.
- **Khách ghé thăm + dấu chân**: mở `GET /users/:id` của người khác thì ghi một dòng `Visitor {owner, visitor, at}` (mỗi cặp một dòng, xem lại thì cập nhật giờ), **tự xóa sau 90 ngày** bằng TTL index (như cron `cleantrace`). Chủ tài khoản xem ai đã ghé (kèm nhãn "Mới" và chấm đỏ trên tab) và mình đã ghé ai. **Người ngoài không xem được danh sách này** (UCHome cho mọi người xem; Coolair siết lại vì đây là dữ liệu hành vi). Người được ghé có thể thấy tên bạn trong danh sách của họ, giao diện có ghi chú nói rõ điều này.
- **Nhóm bạn bè**: 8 nhóm như UCHome (`Khác`, `Bạn bè Online`, `Sự kiện gặp gỡ`, `Bạn bè của bạn`, `Người thân`, `Đồng nghiệp`, `Bạn cùng lớp`, `Người lạ`); nhóm 1–7 đổi tên được. Mỗi người tự phân loại bạn của mình (`Friendship.gFrom/gTo`, người kia không thấy). Lọc theo nhóm, chọn nhiều người để chuyển nhóm (nút "Sắp xếp"), chọn từng nhóm **ẩn khỏi bảng tin** (`User.hideGroups`, như `groupignore`; bài vẫn xem được ở trang cá nhân người đó). Dùng chữ "nhóm" trong UI ở đây là *phân loại bạn bè*, khác hẳn mục **Nhóm** (mtag) ở trên.
- **Gợi ý + bạn chung + ngẫu nhiên**: gợi ý theo "bạn của bạn bè" xếp theo số bạn chung, rồi thành viên hoạt động gần đây. Trang người khác hiện danh sách bạn chung. Nút 🎲 nhảy tới một người bạn ngẫu nhiên. **Không port** gợi ý "người cùng IP" của UCHome: IP trên Vercel không đáng tin và là dữ liệu cá nhân.
- **Mã mời**: tạo ở Bạn bè → Mời bạn, gửi liên kết `https://<domain>/?invite=<mã>` (tự điền vào form đăng ký, hiện tên người mời). Mã dùng một lần. Người được mời chỉ **tự thành bạn sau khi xác thực email xong** (không phải lúc bấm đăng ký) để mã không bị đốt bởi tài khoản ảo; người mời nhận thông báo "đã chấp nhận lời mời kết bạn". Nếu hai người cùng đăng ký bằng một mã trước khi ai xác thực, người xác thực sau không được tự kết bạn (mã đã dùng) nhưng tài khoản vẫn bình thường.
- Admin xóa tài khoản sẽ dọn luôn `Visitor` và mã mời của người đó; mã đã dùng giữ nguyên là đã dùng.
- Cột / collection mới: `visitors`, `invites`; `users.friendGroups / hideGroups / inviteCode / visitSeen`; `friendships.gFrom / gTo`. Dữ liệu cũ không cần migrate (thiếu trường = nhóm 0, không ẩn gì).
- Chưa làm (UCHome có): tìm bạn nâng cao (giới tính, tuổi, quê quán…), ghi chú riêng cho từng bạn, độ thân thiết (`num`), mời qua email, chặn người (blacklist), tùy chọn "ghé thăm ẩn danh" (magic `invisible`).

## Trung tâm thông báo (port logic từ module `notification` của phpFox 3)
Mã nằm ở `server/notify.js` (viết lại bằng Node/Mongo, không chép mã PHP); bộ sưu tập `notifications`, tự xóa sau 90 ngày.
- **Mô hình**: mỗi sự kiện = 1 dòng `{type, item, user (người nhận), owner (người gây ra), seen}`. Người tự làm việc đó không nhận thông báo.
- **Loại có sẵn**: `friend_request`, `friend_accept`, `post_comment`, `post_react`, `photo_comment`, `photo_react`, `wall` (lưu bút), `poke`, `group_invite`, `thread_reply`.
- **Chuông trên header**: số = số dòng chưa xem. Mở menu → lấy tối đa 5 nhóm theo (loại, mục), nhóm chưa xem lên trước, hiện "An, Bình và 3 người khác", rồi đánh dấu đã xem. Có "Xem tất cả thông báo".
- **Trang Thông báo**: từng dòng, 100 dòng/trang, nhóm theo ngày (Hôm nay / Hôm qua / ngày), ẩn từng thông báo, "Xóa tất cả", "Đặt lại số đếm".
- **Tự dọn**: mục gốc bị xóa (bài, ảnh, lời mời, lời chọc…) thì thông báo biến mất; bỏ cảm xúc / hủy kết bạn / từ chối mời cũng xóa thông báo tương ứng.
- **Cập nhật**: Ably gửi sự kiện `notif` để chuông đổi ngay; không có Ably thì hỏi lại mỗi 2 phút. Tiêu đề tab có dạng `(3) CoolAir – Kết nối bạn bè`.
- **Thêm loại mới**: thêm 1 hàm vào bảng `RESOLVERS` trong `notify.js` (trả `Map<itemId,{msg,title,link,icon}>`; mục nào thiếu trong Map = đã bị xóa) rồi gọi `N.add(type, itemId, nguoiNhan, nguoiGay)` ở route tương ứng.
- **API** (đều cần đăng nhập): `GET /notifications/count`, `POST /notifications/recent`, `GET /notifications?page=`, `POST /notifications/seen {ids}`, `DELETE /notifications/:id`, `DELETE /notifications`.
- Thông báo cũ trước bản này không được tạo bù; chỉ sự kiện mới phát sinh mới có thông báo.

## Đăng nhập một lần giữa domain chính và domain phụ
Đã đăng nhập ở domain chính thì mở domain phụ sẽ vào luôn, không cần đăng nhập lại. Token nằm trong `localStorage` của từng domain nên domain phụ phải hỏi domain chính:
1. Domain phụ chưa có token -> chuyển sang `<chính>/?sso_req=<domain phụ>`.
2. Trang domain chính: đã đăng nhập thì xin mã dùng 1 lần (`/sso/issue`), chưa thì nhận "none"; rồi chuyển về `<phụ>/#sso=<mã|none>` (mã ở phần `#` nên không bao giờ tới server hay log).
3. Domain phụ đổi mã lấy token của chính nó (`/sso/exchange`) và vào luôn. Nếu là "none" thì hiện form đăng nhập bình thường (mỗi tab chỉ hỏi một lần).
Cài đặt:
- Cả hai domain phải trỏ về **cùng một backend** (Vercel: thêm các domain vào cùng một project) với cùng `MONGODB_URI` và `JWT_SECRET`.
- Đặt `SSO_MAIN_ORIGIN=https://domain-chinh.vn` và `SSO_ALLOWED_ORIGINS=https://phu1.vn,https://phu2.vn`, rồi deploy lại. Để trống `SSO_MAIN_ORIGIN` = tắt. Domain không nằm trong danh sách (kể cả `*.vercel.app`) thì không tham gia, và domain chính từ chối chuyển hướng tới domain lạ.
- Đăng xuất đồng bộ: xem mục bên dưới. Chạy thử local dùng được `http://localhost:PORT` trong hai biến trên (chỉ localhost mới được dùng http).
- `/sso/*` phải nằm **trước** `router.use(auth, ...)` trong `server/routes/gate.js` (mount sau `routes/auth.js`, trước các module còn lại — thứ tự khai báo ở `server/routes/index.js`) vì được gọi khi chưa đăng nhập.

## Đăng xuất đồng bộ giữa các domain
Bấm **Đăng xuất** ở domain nào cũng đăng xuất luôn ở các domain còn lại (cùng một lần đăng nhập), nhưng không đụng tới thiết bị / lần đăng nhập khác.
- JWT mang `{id, sid}`. Mỗi lần đăng nhập có một `sid` mới; domain phụ vào bằng SSO nhận token **cùng sid** với domain chính (`server/session.js`).
- Đăng xuất gọi `POST /auth/logout` -> ghi `sid` vào collection `revoked` (tự xóa sau 8 ngày, token chỉ sống 7 ngày). Mọi request có token mang sid đó đều bị 401 trên mọi domain, và `/sso/issue` coi như chưa đăng nhập nên không cho SSO vào lại.
- Domain còn lại biết ngay khi người dùng quay lại tab (kiểm tra `/me`), hoặc trong tối đa ~30 giây nếu tab đang mở (lần gọi API kế tiếp, ví dụ thăm dò lời chọc), rồi hiện form đăng nhập kèm thông báo.
- Lỗi MongoDB tạm thời trả 500 chứ không trả 401, nên không ai bị đăng xuất nhầm vì sự cố mạng.
- Token cấp trước khi có tính năng này không có `sid`: vẫn dùng được, và được tự đổi sang token có sid ở lần mở trang kế tiếp. Trong lúc chưa đổi, chúng chưa đăng xuất đồng bộ được.
- Tăng mỗi request một truy vấn Mongo nhỏ (tra `sid` đã thu hồi, có chỉ mục).

## Quản lý thiết bị đăng nhập
Mỗi lần đăng nhập (login / verify / reset) tạo một dòng trong collection `sessions`: `{sid, user, ip, ua, createdAt}` (TTL 8 ngày theo tuổi token).
Trang **Cài đặt → Bảo mật → Thiết bị đăng nhập** liệt kê các phiên (tên thiết bị suy từ user-agent, IP, thời gian), cho phép thu hồi từng phiên hoặc "đăng xuất mọi thiết bị khác". Thu hồi = ghi `sid` vào `revoked` + xóa dòng `sessions`.

## Bảo mật trình duyệt (CSP)
`app.js` bật Content Security Policy: chỉ cho phép script từ `'self'` (twemoji và Ably đều bundle bằng Vite, không còn script CDN nào; **không có `'unsafe-eval'`** vì template Vue được biên dịch lúc build), `connect-src` mở cho domain Ably (WebSocket), frame chỉ từ các trang nhúng video được hỗ trợ, `frame-ancestors 'self'` chống clickjacking.
`script-src` đã bỏ cả `'unsafe-inline'` (không còn script inline) lẫn `'unsafe-eval'` (Vue chạy bản runtime-only); chỉ `style-src` còn giữ `'unsafe-inline'` vì template dùng `style="…"`. CSP là lưới an toàn cuối cùng nếu lọt XSS, chứ không thay thế việc escape output (Vue tự escape `{{ }}`, chỗ duy nhất dùng `v-html` đã qua hàm escape `mh()`).

## Chat realtime (Ably)
Vercel không giữ WebSocket nên dùng Ably: tin nhắn vẫn lưu ở MongoDB; khi có tin mới server báo qua Ably, trình duyệt nhận được liền rồi lấy nội dung từ `/messages`. Có thêm "đang soạn tin…" và chấm online.
1. ably.com → tạo tài khoản miễn phí → tạo App → API Keys → copy key (dạng `xxxx.yyyy:zzzz`).
2. Đặt biến môi trường `ABLY_API_KEY` (file `.env` khi chạy local/VPS; Vercel: Settings → Environment Variables rồi deploy lại). `npm install` để cài thêm `ably`.
3. Không đặt key thì mọi thứ vẫn chạy, chỉ quay về hỏi lại mỗi 4 giây. Key chỉ ở server; trình duyệt chỉ nhận token 1 giờ.
Lưu ý: trạng thái online dùng một kênh presence chung (hợp quy mô nhỏ, vài trăm người online cùng lúc); các ID đang online là thông tin mà người dùng đã đăng nhập có thể thấy.

## Gọi thoại và video (WebRTC + TURN)
Bấm 📞 trong khung chat khi bạn bè đang online (cần đã bật Ably ở mục trên). Âm thanh đi thẳng giữa hai máy; báo hiệu đi qua `/call/:id/signal` -> Ably nên chỉ bạn bè mới gọi được cho nhau.
1. **Metered Open Relay** (20GB TURN/tháng miễn phí, không cần thẻ): metered.ca/tools/openrelay -> đăng ký -> Dashboard: lấy tên app (phần trước `.metered.live`) và API Key -> đặt `METERED_APP`, `METERED_API_KEY` (tùy chọn `METERED_REGION`: asia / europe / us_east, mặc định asia).
   Hoặc **Cloudflare TURN** (1.000GB/tháng, nhưng yêu cầu thẻ): dash.cloudflare.com -> Realtime -> TURN Server -> Create -> đặt `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`. Nếu đặt cả hai thì dùng Metered.
2. Không đặt gì thì chỉ dùng STUN của Google: đa số cuộc gọi vẫn nối được, nhưng một số mạng (wifi công ty, vài mạng 4G) sẽ không có tiếng. Lỗi lấy TURN sẽ được ghi log (`TURN: ...`) và tự quay về STUN.
3. Cần HTTPS (Vercel có sẵn) để trình duyệt cho dùng micro.
Có cả gọi video 1-1 (nút 🎥): hình 640x480, tối đa ~0,8 Mbps, có tắt/bật camera và đổi camera trước/sau. Video tốn dữ liệu TURN gấp 15–30 lần gọi thoại (chỉ khi không nối thẳng được). Chưa có gọi nhóm (cần SFU) và chưa lưu lịch sử cuộc gọi nhỡ.

## Upload ảnh (Cloudinary)
Hiện dùng cho **ảnh đại diện** (Cài đặt → Hồ sơ → Ảnh đại diện) và **album ảnh** (trang cá nhân → Album); hiện trên bài đăng, bình luận, bạn bè, lưu bút, nhóm. Không dùng SDK: server chỉ ký tham số (`server/upload.js`), trình duyệt tải thẳng lên Cloudinary nên không dính giới hạn 4,5MB của Vercel và chạy y hệt trên server riêng.
1. cloudinary.com → tạo tài khoản miễn phí → Console → Dashboard → copy `Cloud name`, `API Key`, `API Secret`.
2. Điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (mẫu đầy đủ ở file `.env`; Vercel thì nhập ở Environment Variables rồi deploy lại).
3. Ảnh được cắt vuông 512×512 quanh khuôn mặt ngay khi tải lên, lưu ở `<CLOUDINARY_FOLDER>/avatars/<id người dùng>` (ghi đè khi đổi ảnh); chỉ lưu URL trong `User.avatar`. Ở giao diện, ảnh được yêu cầu đúng cỡ cần hiển thị.
4. Chuyển sang server riêng không cần đổi gì ở phần này: chỉ cần copy `.env`. Muốn bỏ Cloudinary thì thay `server/upload.js` (giữ hai route `/upload/sign` và `/me/avatar`) và `AVU()` trong `index.html`.
5. Album: mỗi ảnh có id ngẫu nhiên do server chọn (`<CLOUDINARY_FOLDER>/albums/<id người dùng>/<16 ký tự hex>`), không ghi đè; thu về tối đa 1600px; model `Album` / `Photo` (`server/models.js`), route ở `server/album.js`. Chưa có: mật khẩu / chọn bạn được xem album, album của bạn bè + ảnh nổi bật, thông báo khi có ảnh / bình luận mới, quản trị album. Thêm loại ảnh mới (ảnh bài viết...): thêm một dòng vào `KINDS` trong `server/upload.js` **và** một route đăng ký URL tương tự `album.js` (id ngẫu nhiên + kiểm tra URL bằng `photoPublicId`-kiểu regex theo uid).

## Deploy lên Vercel
1. **Atlas**: Network Access → Add IP Address → `0.0.0.0/0` (IP của Vercel thay đổi liên tục), dùng mật khẩu DB mạnh.
2. Đẩy thư mục này lên GitHub (file `.env` đã được `.gitignore`, đừng commit).
3. vercel.com/new → Import repo → để mặc định (Vercel tự nhận Express nhờ `app.js`, không cần build command).
4. Environment Variables: thêm `MONGODB_URI`, `JWT_SECRET`, `SITE_URL` (= domain vercel.app của bạn, ví dụ `https://coolair.vercel.app` — dùng cho link RSS và email mời) và 5 biến SMTP ở mục Email xác thực (Production + Preview) → Deploy.
5. Mở link `*.vercel.app` → đăng ký → đăng bài → kiểm tra collection `users`, `posts` trong Atlas.

CLI: `npm i -g vercel` → `vercel` → `vercel env add MONGODB_URI` → `vercel env add JWT_SECRET` → `vercel --prod`.
Thêm/sửa biến môi trường xong phải deploy lại thì mới có hiệu lực.
**Cron trên gói Hobby**: Vercel Hobby chỉ cho cron chạy **tối đa 1 lần/ngày** (biểu thức dày hơn như `0 * * * *` hay `*/30 * * * *` làm deploy thất bại), và giờ chạy có thể lệch tới ~1 giờ. Lịch hiện tại trong `vercel.json` là `0 3 * * *` (03:00 UTC, dọn tài khoản chưa xác thực / nhật ký admin / mã xác thực hết hạn — việc này chạy mỗi ngày là đủ). Muốn dày hơn thì cần gói Pro. Nhớ thêm biến `CRON_SECRET` (>= 16 ký tự) để endpoint `/api/cron/cleanup` nhận lệnh từ Vercel. Có test `test/vercel.test.js` chặn lỡ tay đặt lịch dày hơn 1 lần/ngày.

## Trang Quản trị (port ý tưởng từ AdminCP của phpFox 3: `user/browse`, `user/ban`)
Tài khoản có email trong `ADMIN_EMAILS` thấy mục **Quản trị** ở menu bên trái (trên điện thoại: Cài đặt → Quản lý trường → nút "Mở trang Quản trị").
- **Thành viên**: thẻ thống kê (tất cả / hoạt động 24 giờ / chưa xác thực / bị khóa) bấm để lọc, tìm theo tên – tên đăng nhập – email, phân trang.
- **Khóa / mở khóa**: người bị khóa không đăng nhập được, token đang dùng bị từ chối ở mọi route (kiểm tra trong middleware `auth`) và bị đăng xuất kèm lý do. SSO cũng không cấp mã cho tài khoản bị khóa.
- **Xác thực email thủ công** khi người dùng không nhận được mã.
- **Xóa vĩnh viễn** phải gõ lại tên đăng nhập để xác nhận. Không khóa / xóa được quản trị viên khác hoặc chính mình.
- Cột mới của `users`: `banned`, `banReason`, `bannedAt`, `lastLogin`, `lastSeen` (cập nhật khi đăng nhập, và khi mở trang tối đa 10 phút một lần). Tài khoản cũ chưa có các cột này vẫn hoạt động bình thường (coi như chưa khóa).
- Lưu ý: middleware `auth` giờ tra thêm 1 truy vấn nhẹ (`banned`) cho mỗi request.
- **Thống kê** (tab đầu của trang Quản trị): thẻ số liệu tổng, biểu đồ cột 14 ngày, thành viên mới nhất, người đăng bài nhiều nhất, nhóm đông nhất; nút Làm mới. "Đang online" = có mở trang trong 5 phút qua (dựa vào lastSeen, cập nhật tối đa 10 phút một lần nên con số này là ước lượng thấp; muốn chính xác hơn có thể hạ ngưỡng cập nhật trong GET /me).

## Giao diện mobile (≤ 767px, theo theme mobile của phpFox)
`src/css/app.css` + `index.html` có thêm lớp giao diện mobile: thanh `#mobile_header` (Trang chủ · tiêu đề trang · ☰ Menu · 🔔 Thông báo kèm số đỏ), ô tìm kiếm bạn bè, lưới menu chính 3 cột (có huy hiệu số mới) và nút “‹ Trang trước”. Màn hình rộng giữ nguyên giao diện desktop.

## Nhật ký / blog (port từ `space_blog` + `cp_blog` của UCenter Home)
- Bài dài có tiêu đề (≤ 80 ký tự), nội dung văn bản thuần (≤ 6000 ký tự), quyền riêng tư công khai / bạn bè / chỉ mình tôi, lượt xem (chủ bài xem không tính), bình luận (≤ 500 ký tự, tối đa 200 / bài). Bài ngắn trên bảng tin giờ gọi là **Bài viết** (tương ứng "Ghi nhanh" của UCHome).
- API (cần đăng nhập): `GET /users/:id/blogs?page=` (10 / trang, lọc theo quyền riêng tư) · `POST /blogs` · `GET / PATCH / DELETE /blogs/:id` · `POST /blogs/:id/comments` · `DELETE /blogs/:id/comments/:cid` (người viết hoặc chủ nhật ký).
- Thông báo `blog_comment` cho chủ nhật ký; xóa thành viên (admin) cũng xóa nhật ký.

## So với UCenter Home: còn thiếu
Đã có: bảng tin / ghi nhanh, nhật ký, sự kiện, bình chọn, tìm kiếm toàn site, album, nhóm (mtag + thread), bạn bè + nhóm bạn + gợi ý + khách ghé thăm + mã mời, chọc, lưu bút, tin nhắn + gọi, thông báo, giao diện (theme), hồ sơ mở rộng, quản trị cơ bản.
Chưa có (xếp theo mức đáng làm): **chia sẻ** (share) · **xếp hạng** (top: thành viên / nhật ký / ảnh hot) · **tâm trạng** (mood) · **tag / chuyên đề** (topic) · **danh mục + thẻ cho nhật ký** (cp_class) · **điểm thưởng / đạo cụ / nhiệm vụ** (credit, magic, task) · **hoạt động bạn bè dạng feed riêng** (space_feed) · **quyền riêng tư chi tiết** (cp_privacy) · **video / videophoto**.

## Sự kiện, bình chọn, tìm kiếm
- Mã: `server/events.js`, `server/polls.js`, `server/search.js` (+ `server/vis.js` = quyền xem dùng chung: công khai / bạn bè / của mình). Model `Event`, `EventMember`, `Poll`, `PollVote` trong `server/models.js`. Giao diện: menu **Sự kiện**, **Bình chọn**, **Tìm kiếm** + ô tìm kiếm ở thanh bên trái (trên điện thoại nằm trong menu ☰).
- **Sự kiện**: tên, thời gian bắt đầu / kết thúc, địa điểm, mô tả, giới hạn người, quyền xem. Mỗi người chọn *Tham gia* hoặc *Có thể*. Tab: sắp diễn ra / tôi tham gia / của tôi / đã qua. Sự kiện kết thúc thì không đăng ký thêm được.
- **Bình chọn**: 2–10 lựa chọn, chọn một hoặc nhiều (tối đa `maxChoice`), hạn chót tùy chọn. Kết quả hiện sau khi bình chọn hoặc khi hết hạn; đã chọn thì không đổi được.
- **Tìm kiếm**: so khớp chuỗi con, không phân biệt hoa thường (regex đã escape), nên tìm được tiếng Việt có dấu. Chỉ trả nội dung người tìm được phép xem; nhóm đóng và nhóm "chỉ thành viên" (khi chưa vào) bị loại. Dữ liệu lớn nên thêm text index hoặc Atlas Search.
- Xóa thành viên (admin) cũng xóa sự kiện, bình chọn, lượt tham gia, phiếu của người đó.

## PWA + thông báo đẩy (Web Push), @nhắc tên, cảm xúc cho bình luận (v85)
**PWA**: `public/manifest.json`, `public/sw.js`, `public/icons/*`. Cài lên màn hình chính được (Android: menu → "Cài đặt ứng dụng"; iPhone: Chia sẻ → "Thêm vào Màn hình chính"). Service worker chỉ cache vỏ ứng dụng (CSS, ảnh tĩnh, trang chủ để hiện khi mất mạng), **không cache `/api`**. Đổi hằng `V` trong `sw.js` khi cần buộc mọi máy tải lại tài nguyên tĩnh.

**Thông báo đẩy** (không cần gói ngoài, tự mã hóa bằng `crypto` của Node – RFC 8291/8292):
1. `node server/genvapid.js` → được 3 dòng `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
2. Dán vào `.env` (hoặc Vercel → Settings → Environment Variables) rồi **deploy lại**. Giữ nguyên cặp khóa này: đổi khóa thì mọi thiết bị đã đăng ký phải bật lại.
3. Người dùng vào **Cài đặt → Bảo mật → Thông báo đẩy → Bật**. Thiếu khóa thì nút báo "Máy chủ chưa bật thông báo đẩy", phần còn lại của app vẫn chạy.
Đẩy cho: mọi thông báo gửi cho **một** người (bình luận, cảm xúc, nhắc tên, chọc, lời mời…) và **tin nhắn mới**. Cố ý **không** đẩy "bạn bè đăng bài mới" (tới 500 người một lúc, dễ gây phiền). Đang mở CoolAir (cửa sổ hiện, có tiêu điểm) thì không bật thông báo. Đăng xuất sẽ tự gỡ thuê bao của thiết bị đó. iPhone chỉ nhận đẩy khi đã cài ra màn hình chính (iOS 16.4+).

**@nhắc tên**: gõ `@tên_đăng_nhập` trong bài viết hoặc bình luận (3–20 ký tự `a-z 0-9 . _`). Gõ `@` sẽ hiện gợi ý trong danh sách **bạn bè**. Người được nhắc nhận thông báo loại `mention` (tối đa 5 người / lần; bỏ qua người đã chặn nhau hoặc không xem được bài; không áp dụng cho bình luận ẩn danh để không lộ danh tính; sửa bài chỉ báo cho người **mới** được nhắc). Bấm vào `@tên` mở hồ sơ.

**Cảm xúc cho bình luận** (bài viết): 👍 😍 😂 😮 😢, bấm lại cùng emoji để bỏ; chủ bình luận nhận thông báo `comment_react`.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | /posts/:id/comments/:cid/react | `{emoji}` – thả / đổi / bỏ cảm xúc cho bình luận; trả về bài viết đã cập nhật (mỗi bình luận có thêm `likes` – số người khác, `reaction` – cảm xúc của mình, `emojis` – tối đa 3 emoji phổ biến) |
| GET | /mention/suggest?q= | gợi ý bạn bè khi gõ `@` (tối đa 6: `id, name, username, avatar`) |
| GET | /users/by-username/:u | `{id, name, avatar}` để mở hồ sơ từ `@tên` (404 nếu không có / bị chặn) |
| GET | /push/key | khóa công khai VAPID (503 nếu máy chủ chưa cấu hình) |
| POST | /push/subscribe | `{subscription}` (kết quả `PushSubscription.toJSON()`); tối đa 10 thiết bị / người |
| POST | /push/unsubscribe | `{endpoint?}` – bỏ thiết bị này (không có `endpoint` = bỏ tất cả thiết bị của mình) |

Còn thiếu: cảm xúc cho bình luận ở ảnh / nhật ký / video / chia sẻ (hiện chỉ có ở bài viết), @nhắc tên ngoài bài viết (nhật ký, diễn đàn…), đẩy cho "bạn bè đăng bài mới".


## Cấu trúc `server/routes/` (tách từ `routes.js` cũ)
`index.js` tạo router + mount theo thứ tự cố định; `shared.js` chứa import/helper dùng chung (`S`, `wrap`, `fail`, `auth`, `pub`, `areFriends`, `ably`...).
Mỗi file là `module.exports = (router) => {...}`: `auth`, `totp`, `account`, `profile_fields`, `gate` (SSO + `router.use(auth)`), `sessions`, `posts`, `friends`, `push`, `chat`, `pokes`, `theme`, `guestbook`, `mounts` (các module con album/blog/pf_*/admin…), `cron`.
`app.js` vẫn `require('./server/routes')` như cũ (Node tự nạp `routes/index.js`).

## Template Vue biên dịch lúc build (không cần `unsafe-eval`)
`scripts/vite-vue-precompile.mjs` (plugin trong `vite.config.mjs`) biên dịch trước: (1) nội dung `#app` trong `index.html` -> module ảo `virtual:app-template`, HTML xuất ra chỉ còn thẻ `#app` rỗng; (2) mọi `template:` trong `src/` -> `render:`. Dùng Vue runtime-only.
Quy ước: **không nội suy `${...}` trong template**, không dùng `eval` / `new Function` / `Vue.compile` ở client. Tag HTML phải đóng đủ (trình biên dịch của Vue chặt hơn trình duyệt: thiếu thẻ đóng sẽ báo lỗi lúc build, không còn bị trình duyệt tự sửa).
Sau `npm install`, `npm test` tự chạy thêm bài "COMPILE THẬT" kiểm tra mọi template biên dịch được trước khi deploy.
