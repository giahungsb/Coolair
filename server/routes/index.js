const router = require('express').Router();
const { isValidObjectId } = require('mongoose');
const { fail } = require('./shared');

router.param('id', (req, res, next, id) => (isValidObjectId(id) ? next() : fail(res, 'ID không hợp lệ.')));

// THỨ TỰ MOUNT QUAN TRỌNG: auth -> ... -> gate (router.use(auth)) -> các route cần đăng nhập.
// /sso/* và /invites/check nằm trong gate.js, phải ở TRƯỚC router.use(auth) đó.
// Dùng require TĨNH (không require('./' + tên)) để Vercel/nft theo dấu được và đóng gói đủ file.
require('./auth')(router);
require('./totp')(router);
require('./account')(router);
require('./profile_fields')(router);
require('./gate')(router);
require('./sessions')(router);
require('./posts')(router);
require('./friends')(router);
require('./push')(router);
require('./chat')(router);
require('./pokes')(router);
require('./theme')(router);
require('./guestbook')(router);
require('./mounts')(router);
require('./cron')(router);

module.exports = router;
