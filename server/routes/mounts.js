/* Gắn các module con (album, blog, pf_*, admin...) */
const { N, social, media, S, wrap, fail, auth, isAdmin, pub, areFriends } = require('./shared');

module.exports = (router) => {
/* ---------- Nhóm (port từ mtag của UCenter Home) ---------- */
require('../upload')(router, { auth, wrap, fail, S, pub });
media(router, { auth, wrap, fail, S });   // /video/grab + /post-media/discard
N.routes(router, { auth, wrap, fail });
require('../album')(router, { auth, wrap, fail, S, areFriends, N });
require('../blog')(router, { auth, wrap, fail, S, areFriends, N });   // Nhật ký (blog) – port từ UCenter Home
require('../events')(router, { auth, wrap, fail, S, N });   // Sự kiện (event)
require('../polls')(router, { auth, wrap, fail, S });   // Bình chọn (poll)
require('../search')(router, { auth, wrap, fail, S });   // Tìm kiếm toàn site
require('../doing')(router, { auth, wrap, fail, S, N });   // Trạng thái ngắn + tâm trạng (port UCHome doing/mood)
require('../share')(router, { auth, wrap, fail, S, N });   // Chia sẻ nội dung (port UCHome share)
require('../credit')(router, { auth, wrap, fail });   // Điểm tín dụng + nhiệm vụ (port UCHome credit/task)
require('../topic')(router, { auth, wrap, fail, S, isAdmin });   // Chủ đề nóng (port UCHome topic)
require('../discover')(router, { auth, wrap, fail, S });   // Khám phá + bảng xếp hạng (port UCHome network/top)
require('../moderate')(router, { auth, wrap, fail, S, isAdmin, N });   // Chặn + tố cáo (port UCHome blacklist/report)
require('../rss')(router, { wrap });   // RSS (port UCHome rss.php)
require('../import')(router, { auth, wrap, fail, S });   // nhập nhật ký từ RSS (port cp_import của UCHome)
require('../magic')(router, { auth, wrap, fail, S, N });   // đạo cụ (port magic của UCHome)
const { alog } = require('../aconfig');
require('../aconfig')(router, { auth, wrap, fail, S, isAdmin });   // Quản trị hệ thống: điểm/NV/click/nổi bật/IP/log/cấu hình/nhóm quyền
require('../censor')(router, { auth, wrap, fail, S, isAdmin, alog });   // Bộ lọc từ cấm (port admincp_censor)
require('../amod')(router, { auth, wrap, fail, S, isAdmin, alog });   // Kiểm duyệt nội dung (port admincp_blog/doing/share/...)
require('../pf_forum')(router, { auth, wrap, fail, S, N, isAdmin, alog });   // Diễn đàn độc lập (port module forum của phpFox)
require('../pf_music')(router, { auth, wrap, fail, S, isAdmin, alog });   // Âm nhạc (port module music của phpFox)
require('../pf_video')(router, { auth, wrap, fail, S, N, isAdmin, alog });   // Video đầy đủ (port module video của phpFox)
require('../pf_quiz')(router, { auth, wrap, fail, S, N, isAdmin });   // Trắc nghiệm (port module quiz của phpFox)
require('../pf_pages')(router, { auth, wrap, fail, S, N, isAdmin, alog });   // Trang cộng đồng (port module pages của phpFox)
require('../pf_extra')(router, { auth, wrap, fail, S, N, isAdmin, alog });   // egift/announcement/bulletin/newsletter/favorite/rate/contact/faq/shoutbox/link/mail (phpFox)
social.mount(router, { auth, wrap, fail, S, areFriends });   // khách ghé thăm, nhóm bạn, gợi ý bạn, mã mời
require('../groups')(router, { S, wrap, fail, isAdmin, areFriends, N });
require('../admin')(router, { auth, wrap, fail, S, isAdmin });   // trang quản trị (admincp)
};
