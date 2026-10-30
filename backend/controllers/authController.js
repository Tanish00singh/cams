'use strict';
const bcrypt      = require('bcrypt');
const crypto      = require('crypto');
const { getDb }   = require('../models/db');
const { body }    = require('express-validator');
const validate    = require('../middleware/validate');
const mailer      = require('../services/mailer');
const audit       = require('../services/audit');

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/* ---------------------------------------------------------------
   POST /api/v1/auth/login
--------------------------------------------------------------- */
const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
  body('roleTab').isIn(['superadmin','president','advisor','member']).withMessage('Invalid role tab.'),
];

async function login(req, res, next) {
  try {
    const { email, password, roleTab, keepSignedIn } = req.body;
    const db = getDb();

    const user = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).get(email);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.status === 'locked') {
      return res.status(403).json({ success: false, message: 'Account is locked. Contact the Super Admin.' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Account is inactive.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      audit.log(null, 'Unknown', 'Failed login attempt', 'Auth', `Email: ${email}`, req.ip);
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Role tab must match system_role
    if (user.system_role !== roleTab) {
      return res.status(401).json({
        success: false,
        message: `This account is not registered as a ${roleTab.replace('_',' ')}. Please select the correct role tab.`
      });
    }

    // Session
    req.session.userId     = user.id;
    req.session.systemRole = user.system_role;
    req.session.name       = user.name;
    if (keepSignedIn) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

    // Determine the club (if any) for club-role users
    let clubInfo = null;
    if (user.system_role !== 'superadmin') {
      const cm = db.prepare(`
        SELECT cm.club_id, cm.club_role, c.name as club_name
        FROM club_members cm JOIN clubs c ON c.id = cm.club_id
        WHERE cm.user_id = ? AND cm.status = 'active'
        LIMIT 1
      `).get(user.id);
      if (cm) {
        req.session.clubId   = cm.club_id;
        req.session.clubRole = cm.club_role;
        clubInfo = { clubId: cm.club_id, clubName: cm.club_name, clubRole: cm.club_role };
      }
    }

    audit.log(user.id, user.name, 'Signed in', 'Auth', null, req.ip);

    const token = Buffer.from(JSON.stringify({
      userId: user.id,
      systemRole: user.system_role,
      name: user.name,
      clubId: clubInfo ? clubInfo.clubId : null,
      exp: Date.now() + 24 * 60 * 60 * 1000
    })).toString('base64');

    res.json({
      success: true,
      token,
      user: {
        id:                user.id,
        name:              user.name,
        email:             user.email,
        systemRole:        user.system_role,
        mustChangePassword:!!user.must_change_password,
        ...clubInfo,
      }
    });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/auth/logout
--------------------------------------------------------------- */
function logout(req, res) {
  const name = req.session.name || 'Unknown';
  const uid  = req.session.userId;
  req.session.destroy(() => {
    res.clearCookie('cams.sid');
    if (uid) audit.log(uid, name, 'Signed out', 'Auth', null, req.ip);
    res.json({ success: true });
  });
}

/* ---------------------------------------------------------------
   GET /api/v1/auth/me
--------------------------------------------------------------- */
function me(req, res) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  const db   = getDb();
  const user = getUser(db, req.session.userId);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ success: false, message: 'Session invalid.' });
  }

  let clubInfo = null;
  if (user.system_role !== 'superadmin' && req.session.clubId) {
    const club = db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(req.session.clubId);
    clubInfo = { clubId: req.session.clubId, clubName: club ? club.name : null, clubRole: req.session.clubRole };
  }

  res.json({
    success: true,
    user: {
      id:                user.id,
      name:              user.name,
      email:             user.email,
      systemRole:        user.system_role,
      mustChangePassword:!!user.must_change_password,
      ...clubInfo,
    }
  });
}

/* ---------------------------------------------------------------
   POST /api/v1/auth/forgot-password
--------------------------------------------------------------- */
const forgotValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
];

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const db  = getDb();
    const user = db.prepare(`SELECT id, name, status FROM users WHERE email = ? COLLATE NOCASE`).get(email);

    // Always return success to prevent enumeration
    if (!user || user.status !== 'active') {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`).run(user.id, tokenHash, expiresAt);

    const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password.html?token=${token}`;
    await mailer.sendPasswordReset(email, user.name, resetUrl);

    audit.log(user.id, user.name, 'Requested password reset', 'Auth', null, req.ip);
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/auth/reset-password
--------------------------------------------------------------- */
const resetValidation = [
  body('token').notEmpty().withMessage('Token required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain a number.'),
];

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    const db   = getDb();
    const hash = hashToken(token);

    const row = db.prepare(`
      SELECT pr.*, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id
      WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > datetime('now')
    `).get(hash);

    if (!row) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset link.' });
    }

    const newHash = await bcrypt.hash(password, 12);
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`).run(newHash, row.user_id);
    db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(row.id);

    audit.log(row.user_id, row.name, 'Reset password via link', 'Auth', null, req.ip);
    res.json({ success: true, message: 'Password reset successfully. Please sign in.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/auth/change-password
--------------------------------------------------------------- */
const changeValidation = [
  body('currentPassword').notEmpty().withMessage('Current password required.'),
  body('newPassword').isLength({ min: 8 }).withMessage('Minimum 8 characters.')
    .matches(/[A-Z]/).withMessage('Must contain an uppercase letter.')
    .matches(/[0-9]/).withMessage('Must contain a number.'),
];

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const db   = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`).run(newHash, user.id);

    audit.log(user.id, user.name, 'Changed password', 'Auth', null, req.ip);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) { next(err); }
}

module.exports = {
  loginValidation, login,
  logout,
  me,
  forgotValidation, forgotPassword,
  resetValidation,  resetPassword,
  changeValidation, changePassword,
  validate,
};
