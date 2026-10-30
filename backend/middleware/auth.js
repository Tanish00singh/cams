'use strict';

/**
 * requireAuth — session must exist
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  next();
}

/**
 * requireRole(...roles) — system_role must be in the list
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!roles.includes(req.session.systemRole)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient role.' });
    }
    next();
  };
}

/**
 * requireClubAccess(allowedClubRoles)
 * Checks that the logged-in user is a member of req.params.clubId
 * with one of the allowed club roles.
 * Pass [] to allow any club member.
 */
function requireClubAccess(allowedClubRoles = []) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    // Super admin bypasses club checks
    if (req.session.systemRole === 'superadmin') return next();

    const { getDb } = require('../models/db');
    const db = getDb();
    const clubId = req.params.clubId || req.params.id;

    const membership = db.prepare(
      `SELECT club_role, status FROM club_members WHERE user_id = ? AND club_id = ? AND status = 'active'`
    ).get(req.session.userId, clubId);

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You are not a member of this club.' });
    }

    if (allowedClubRoles.length > 0 && !allowedClubRoles.includes(membership.club_role)) {
      return res.status(403).json({ success: false, message: `Requires one of: ${allowedClubRoles.join(', ')}.` });
    }

    req.clubRole = membership.club_role;
    next();
  };
}

module.exports = { requireAuth, requireRole, requireClubAccess };
