# Deploy Checklist - Fix Thông Báo Bạn Bè Đăng Bài

## Vấn đề
Thông báo "bạn bè đăng bài" không hiện. Nguyên nhân: frontend chỉ cập nhật
thông báo qua realtime (Ably). Nếu Ably rớt/không kết nối, phải refresh tay
mới thấy.

## Fix
- src/app.js: thêm polling dự phòng mỗi 30s — khi realtime rớt (rtOn=false)
  thì tự gọi ntCount() + refresh trang thông báo (nếu đang xem)
- test/friendpost-notif.test.js: 6 test mới cho logic friend_post

## File thay đổi (full file trong patch)
- src/app.js
- test/friendpost-notif.test.js (mới)

## Deploy
1. Giải nén đè lên source
2. npm install
3. Push lên GitHub → Vercel tự deploy

## Test
- npm test: 107/107 PASS
- npm run build: PASS
