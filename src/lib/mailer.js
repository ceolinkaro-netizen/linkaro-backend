const nodemailer = require("nodemailer");
const env = require("../config/env");

const transporter = nodemailer.createTransport({
  host: env.email.host,
  port: env.email.port,
  secure: env.email.secure,
  auth: {
    user: env.email.user,
    pass: env.email.pass,
  },
});

async function sendEmail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: `"Linkaro" <${env.email.user}>`,
    to,
    subject,
    text: text || subject,
    html,
  });
}

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#FE5900;border-radius:12px 12px 0 0;padding:28px 36px;text-align:center;">
          <span style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Linkaro</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px;border-radius:0 0 12px 12px;border:1px solid #e8eaf0;border-top:none;">
          ${content}
          <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">This is an automated message from Linkaro. Please do not reply.</p>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function registrationVerifiedEmail(name) {
  return baseTemplate(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:56px;height:56px;background:#e8fdf3;border-radius:50%;line-height:56px;font-size:26px;">✓</div>
    </div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;text-align:center;">You're Verified!</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;text-align:center;line-height:1.6;">
      Hi <strong>${name}</strong>, your Linkaro provider account has been <strong style="color:#14CA74;">verified</strong> by our team.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#777;text-align:center;line-height:1.6;">
      You now have full access to all verified provider features on the platform.
    </p>
  `);
}

function registrationUnverifiedEmail(name) {
  return baseTemplate(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:56px;height:56px;background:#fff0f0;border-radius:50%;line-height:56px;font-size:26px;">✗</div>
    </div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;text-align:center;">Verification Revoked</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;text-align:center;line-height:1.6;">
      Hi <strong>${name}</strong>, your Linkaro provider account verification has been <strong style="color:#FF5A65;">revoked</strong>.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#777;text-align:center;line-height:1.6;">
      If you believe this is a mistake, please contact our support team for assistance.
    </p>
  `);
}

function subscriptionStatusEmail(name, status, subscriptionType) {
  const configs = {
    active: {
      icon: "✓",
      iconBg: "#e8fdf3",
      title: "Subscription Approved!",
      color: "#14CA74",
      body: `Your <strong>${subscriptionType || "subscription"}</strong> has been <strong style="color:#14CA74;">approved and activated</strong>. You can now enjoy all the benefits of your plan.`,
    },
    rejected: {
      icon: "✗",
      iconBg: "#fff0f0",
      title: "Subscription Rejected",
      color: "#FF5A65",
      body: `Unfortunately your <strong>${subscriptionType || "subscription"}</strong> request has been <strong style="color:#FF5A65;">rejected</strong>. Please contact support if you have any questions.`,
    },
    fraud: {
      icon: "!",
      iconBg: "#f5f0ff",
      title: "Subscription Flagged",
      color: "#9C27B0",
      body: `Your <strong>${subscriptionType || "subscription"}</strong> has been <strong style="color:#9C27B0;">flagged for review</strong>. Our team will investigate and contact you shortly.`,
    },
  };

  const cfg = configs[status] || configs.rejected;

  return baseTemplate(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:56px;height:56px;background:${cfg.iconBg};border-radius:50%;line-height:56px;font-size:26px;">${cfg.icon}</div>
    </div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;text-align:center;">${cfg.title}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;text-align:center;line-height:1.6;">
      Hi <strong>${name}</strong>, ${cfg.body}
    </p>
  `);
}

function otpEmail(code) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #000F2C; border-radius: 12px;">
      <h2 style="color: #ffffff; margin: 0 0 8px 0;">Verify your email</h2>
      <p style="color: rgba(255,255,255,0.7); margin: 0 0 32px 0;">Use the code below to complete your verification.</p>
      <div style="background: #FE5900; border-radius: 8px; padding: 20px; text-align: center;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #ffffff;">${code}</span>
      </div>
      <p style="color: rgba(255,255,255,0.5); font-size: 13px; margin: 24px 0 0 0;">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>
  `;
}

module.exports = {
  sendEmail,
  registrationVerifiedEmail,
  registrationUnverifiedEmail,
  subscriptionStatusEmail,
  otpEmail,
};
