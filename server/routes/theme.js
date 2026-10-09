/* Giao diện trang cá nhân */
const { User, S, wrap, fail, auth, pub } = require('./shared');

module.exports = (router) => {
/* ---------- Giao diện trang cá nhân (theme) – chuyển từ UCenter Home (cp_theme.php) ----------
   Giữ: chọn 1 trong các theme có sẵn (t3..t14), người xem có thể tắt giao diện của người khác (noTheme = "nocss" gốc).
   Không chép ô "tự viết CSS" của bản gốc (CSS do người dùng nhập có thể tải ảnh từ ngoài / chèn giao diện giả mạo); thay bằng "tự chọn màu"
   chỉ nhận mã #RRGGBB đã kiểm tra. Hình/ màu của từng theme có sẵn nằm ở frontend, server chỉ lưu mã. */
const THEMES = ['t3', 't4', 't5', 't10', 't11', 't12', 't13', 't14', 'custom'], HEX = /^#[0-9a-fA-F]{6}$/;
router.put('/theme', auth, wrap(async (req, res) => {
  const b = req.body, set = {};
  if (b.theme !== undefined) {
    const id = S(b.theme);
    if (id !== '' && !THEMES.includes(id)) return fail(res, 'Giao diện không tồn tại.');
    if (id === 'custom') {
      const bg = S(b.bg), accent = S(b.accent);
      if (!HEX.test(bg) || !HEX.test(accent)) return fail(res, 'Màu cần đúng dạng #RRGGBB.');
      Object.assign(set, { themeBg: bg.toLowerCase(), themeAccent: accent.toLowerCase() });
    } else Object.assign(set, { themeBg: '', themeAccent: '' });
    set.theme = id;
  }
  if (b.noTheme !== undefined) set.noTheme = b.noTheme === true;
  if (!Object.keys(set).length) return fail(res, 'Không có gì để cập nhật.');
  const u = await User.findByIdAndUpdate(req.uid, set, { new: true });
  u ? res.json({ user: pub(u) }) : res.status(401).json({ error: 'Tài khoản không tồn tại.' });
}));
};
