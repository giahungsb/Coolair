# CHECKLIST DEPLOY — Tick xanh xác thực thành viên

## Tính năng
- Admin cấp/gỡ **tick xanh ✓** cho thành viên (giống Facebook).
- Tick hiện cạnh tên ở: bài viết, bình luận, trang cá nhân, danh sách admin.
- Mọi thao tác cấp/gỡ đều ghi **audit log** (`tick_grant` / `tick_revoke`).

## File thay đổi
| File | Thay đổi |
|---|---|
| `server/models.js` | User thêm field `blueTick` (mặc định false) |
| `server/admin.js` | API `POST /admin/users/:id/tick` (toggle) + audit log; `row()` thêm `blueTick` |
| `server/routes/posts.js` | Populate `blueTick` cho author + comment user; `view()` trả `tick` |
| `server/routes/friends.js` | API hồ sơ `/users/:id` trả `blueTick` |
| `server/routes/shared.js` | `pub()` (tài khoản mình) thêm `blueTick` |
| `src/lib/core.js` | `map()` giữ `tick` cho post + comment |
| `src/modules/post.js` | Component `CTick` mới; hiện tick ở tên tác giả + bình luận |
| `src/mount.js` | Đăng ký `CTick` |
| `src/app.js` | `acct` thêm `blueTick` |
| `index.html` | Tick ở trang cá nhân + danh sách admin; nút Cấp/Gỡ tick; filter audit log |
| `test/bluetick.test.js` | 6 test mới |

## Cách dùng (sau deploy)
1. Vào **Quản trị → Thành viên** → bấm **Quản lý** ở member muốn cấp tick.
2. Bấm **✓ Cấp tick xanh** (bấm lại để gỡ).
3. Tick xanh hiện ngay cạnh tên member ở bài viết/bình luận/trang cá nhân.

## Deploy
1. Giải nén đè lên source hiện tại (đã bao gồm fix v-else-if).
2. `npm test` (kỳ vọng 90/90 PASS), `npm run build`.
3. **Không** commit `public/` — để Vercel tự build.
4. Push → redeploy (bỏ tick "Use existing Build Cache" nếu nghi cache cũ).

## Lưu ý
- Không nhầm với `verified` (xác thực email) — đây là field riêng `blueTick`.
- Không thể cấp tick cho admin/chính mình (giống các thao tác admin khác).
