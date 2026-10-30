'use strict';
const nodemailer = require('nodemailer');

let _transporter;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    // Ethereal fallback — prints preview URL to console
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('[Mailer] Using Ethereal. Preview emails at https://ethereal.email');
  }
  return _transporter;
}

async function send(to, subject, html) {
  try {
    const t    = await getTransporter();
    const from = process.env.SMTP_FROM || '"CAMS — NIT Trichy" <noreply@nitt.edu>';
    const info = await t.sendMail({ from, to, subject, html });
    if (nodemailer.getTestMessageUrl(info)) {
      console.log(`[Mailer] Preview: ${nodemailer.getTestMessageUrl(info)}`);
    }
  } catch (err) {
    console.error('[Mailer] Send failed:', err.message);
    // Non-fatal: log but don't crash the request
  }
}

async function sendPasswordReset(to, name, resetUrl) {
  await send(to, 'Reset your CAMS password', `
    <p>Hi ${name},</p>
    <p>Click below to reset your password (link expires in 1 hour):</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If you did not request this, ignore this email.</p>
    <p>— CAMS, Office of Student Affairs, NIT Trichy</p>
  `);
}

async function sendClubCredentials(to, name, email, tempPassword, clubName) {
  await send(to, `Your CAMS account for ${clubName}`, `
    <p>Hi ${name},</p>
    <p>Your club creation request for <strong>${clubName}</strong> has been approved.</p>
    <p>Your login credentials:</p>
    <ul>
      <li><strong>Email:</strong> ${email}</li>
      <li><strong>Temporary Password:</strong> ${tempPassword}</li>
    </ul>
    <p>Please change your password on first login.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:3000'}">Sign in to CAMS</a></p>
    <p>— Office of Student Affairs, NIT Trichy</p>
  `);
}

async function sendRequestStatus(to, name, requestNo, status, remarks) {
  const subject = status === 'needs_info'
    ? `CAMS: More information needed — ${requestNo}`
    : `CAMS: Club request ${requestNo} ${status}`;
  await send(to, subject, `
    <p>Hi ${name},</p>
    <p>Your club creation request <strong>${requestNo}</strong> status: <strong>${status.toUpperCase()}</strong>.</p>
    ${remarks ? `<p>Note from Super Admin: ${remarks}</p>` : ''}
    <p>— Office of Student Affairs, NIT Trichy</p>
  `);
}

async function sendMemberInvitation(to, name, clubName, tempPassword) {
  await send(to, `You've been added to ${clubName} on CAMS`, `
    <p>Hi ${name},</p>
    <p>You have been added to <strong>${clubName}</strong> on the Club Activity Management System.</p>
    <p><strong>Temporary Password:</strong> ${tempPassword}</p>
    <p>Please sign in and change your password.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:3000'}">Sign in to CAMS</a></p>
    <p>— Office of Student Affairs, NIT Trichy</p>
  `);
}

async function sendAnnouncement(toList, clubName, title, message) {
  for (const to of toList) {
    await send(to, `${clubName}: ${title}`, `
      <p><strong>${title}</strong></p>
      <p>${message}</p>
      <p>— ${clubName}, CAMS</p>
    `);
  }
}

module.exports = { sendPasswordReset, sendClubCredentials, sendRequestStatus, sendMemberInvitation, sendAnnouncement };
