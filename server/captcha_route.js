/* Route captcha (seccode của UCHome): GET /auth/captcha trả về {id, svg} để hiển thị */
const captcha = require('./captcha');

module.exports = (router, { wrap }) => {
  router.get('/auth/captcha', wrap(async (req, res) => {
    res.json(captcha.make());
  }));
};

// Kiểm tra captcha trong body; trả về chuỗi lỗi hoặc null
module.exports.checkBody = (body) => {
  const id = body && body.captchaId, input = body && body.captcha;
  if (!id || input === undefined || input === '') return 'Vui lòng nhập mã xác nhận.';
  if (!captcha.check(id, input)) return 'Mã xác nhận chưa đúng. Vui lòng thử mã mới.';
  return null;
};
