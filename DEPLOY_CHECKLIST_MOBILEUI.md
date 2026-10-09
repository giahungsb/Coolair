# Deploy Checklist - Mobile UI gọn (đã merge vào coolair mới nhất)

## Thay đổi
1. Bottom nav 5 nút có nhãn: Trang chủ, Bạn bè (badge lời mời), Thông báo, Tin nhắn, Cá nhân
2. Menu mobile gọn, mục ít dùng vào "⋯ Thêm"
3. Admin mobile: 15 tab -> dropdown (desktop vẫn là tab ngang)
4. Nút bài viết mobile chỉ hiện icon + số, touch target 44px
5. Chữ/spacing thoáng hơn

## File thay đổi
index.html, src/app.js, src/modules/post.js, src/css/app.css

## Giữ nguyên từ bản coolair mới (KHÔNG bị patch cũ ghi đè)
app.js (cache header), static/sw.js (v3), static/theme-init.js (tự gỡ SW khi chunk 404),
polling thông báo friend_post, test/friendpost-notif.test.js

## Deploy
1. Giải nén đè lên source -> npm install -> push GitHub -> Vercel tự deploy
2. Không cần env mới
