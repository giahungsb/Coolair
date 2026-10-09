const nodemailer = require('nodemailer');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tx;
const transport = () => {
  if (tx) return tx;
  const port = Number(process.env.SMTP_PORT) || 465;
  return (tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 8000, socketTimeout: 8000 }));
};

// Gửi email mời bạn bè tham gia (dùng chung SMTP đã cấu hình)
exports.sendInviteMail = async (to, inviterName, code) => {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const link = site ? `${site}/?invite=${code}` : `Mã mời: ${code}`;
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('Chưa cấu hình SMTP_HOST');
    return console.log(`[DEV] Email mời tới ${to}: ${link}`);
  }
  await transport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to,
    subject: `${inviterName} mời bạn tham gia CoolAir`,
    text: `Chào bạn,\n\n${inviterName} mời bạn tham gia CoolAir – mạng xã hội dành cho người Việt.\nĐăng ký tại: ${link}\n\nNếu bạn không quan tâm, hãy bỏ qua email này.`,
    html: `<p>Chào bạn,</p><p><b>${esc(inviterName)}</b> mời bạn tham gia <b>CoolAir</b> – mạng xã hội dành cho người Việt.</p><p><a href="${esc(link)}">Bấm vào đây để đăng ký</a>${site ? '' : ` (mã mời: <b>${esc(code)}</b>)`}.</p><p>Nếu bạn không quan tâm, hãy bỏ qua email này.</p>` });
};
// Gửi email nội dung tự do (newsletter của phpFox) – dùng chung SMTP đã cấu hình
exports.sendRaw = async (to, subject, text) => {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('Chưa cấu hình SMTP_HOST');
    return console.log(`[DEV] Email tới ${to}: ${subject}`);
  }
  await transport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text,
    html: `<div style="font-family:sans-serif;white-space:pre-wrap">${esc(text)}</div>` });
};
exports.sendMail = async (to, name, code, reset = false) => {
  const what = reset ? 'đặt lại mật khẩu' : 'xác thực email';
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('Chưa cấu hình SMTP_HOST');
    return console.log(`[DEV] Mã ${what} của ${to}: ${code}`);
  }
  await transport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to,
    subject: `${code} là mã ${what} CoolAir của bạn`,
    text: `Chào ${name},\n\nMã ${what} CoolAir của bạn là: ${code}\nMã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    html: `<p>Chào ${esc(name)},</p><p>Mã ${what} CoolAir của bạn là:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Mã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>` });
};
