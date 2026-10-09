# Deploy Checklist - Mobile UI Cải Tiến

## Thay đổi
1. **Bottom navigation bar** - 5 nút: 🏠 Trang chủ, 👥 Bạn bè, 🔔 Thông báo, 💬 Tin nhắn, 👤 Cá nhân (chỉ mobile)
2. **Menu gọn** - Mục ít dùng vào "⋯ Thêm" expandable
3. **Admin mobile** - 15 tabs thành dropdown select
4. **Nút bài viết** - Mobile chỉ hiện icon (ẩn chữ), touch target 44px
5. **Spacing/font** - Thoáng hơn trên mobile

## File thay đổi (full file trong patch)
- index.html
- src/app.js
- src/modules/post.js
- src/css/app.css

## Deploy
1. Giải nén đè lên source
2. npm install
3. Push lên GitHub → Vercel tự deploy
4. KHÔNG cần thêm env mới

## Test
- npm test: 3 test fail sẵn từ bản gốc (ban log, tick default, location) - không liên quan thay đổi này
- npm run build: PASS
