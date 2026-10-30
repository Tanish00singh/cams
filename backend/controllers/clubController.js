'use strict';
const { getDb }   = require('../models/db');
const { body }    = require('express-validator');
const validate    = require('../middleware/validate');
const audit       = require('../services/audit');

/* ---------------------------------------------------------------
   GET /api/v1/clubs   (admin only)
--------------------------------------------------------------- */
function listClubs(req, res, next) {
  try {
    const db = getDb();
    const { search, status } = req.query;
    let where = '1=1';
    const params = [];
    if (status) { where += ` AND c.status = ?`; params.push(status); }
    if (search) { where += ` AND c.name LIKE ?`; params.push(`%${search}%`); }

    const rows = db.prepare(`
      SELECT c.*,
        pres.name  as president_name,
        adv.name   as advisor_name,
        COUNT(DISTINCT CASE WHEN cm.status='active' THEN cm.id END) as member_count
      FROM clubs c
      LEFT JOIN club_members cm   ON cm.club_id = c.id
      LEFT JOIN club_members cm_p ON cm_p.club_id = c.id AND cm_p.club_role = 'President'   AND cm_p.status='active'
      LEFT JOIN users pres         ON pres.id = cm_p.user_id
      LEFT JOIN club_members cm_a ON cm_a.club_id = c.id AND cm_a.club_role = 'Faculty Advisor' AND cm_a.status='active'
      LEFT JOIN users adv          ON adv.id = cm_a.user_id
      WHERE ${where}
      GROUP BY c.id
      ORDER BY c.name
    `).all(...params);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   PATCH /api/v1/clubs/:id/status   (admin only)
--------------------------------------------------------------- */
function updateClubStatus(req, res, next) {
  try {
    const db     = getDb();
    const { status } = req.body;
    if (!['active','inactive'].includes(status)) return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });

    const club = db.prepare(`SELECT * FROM clubs WHERE id = ?`).get(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found.' });

    db.prepare(`UPDATE clubs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, club.id);
    audit.log(req.session.userId, req.session.name, `Set club ${club.name} to ${status}`, 'Clubs', null, req.ip);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/clubs/:clubId/members
--------------------------------------------------------------- */
function listMembers(req, res, next) {
  try {
    const db = getDb();
    const { search } = req.query;
    let where = `cm.club_id = ?`;
    const params = [req.params.clubId];
    if (search) { where += ` AND (u.name LIKE ? OR u.email LIKE ?)`; const s = `%${search}%`; params.push(s, s); }

    const rows = db.prepare(`
      SELECT cm.id, cm.user_id, cm.club_role, cm.status, cm.joined_at,
             u.name, u.email, u.system_role
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE ${where}
      ORDER BY
        CASE cm.club_role
          WHEN 'Faculty Advisor' THEN 1
          WHEN 'President' THEN 2
          WHEN 'Vice President' THEN 3
          WHEN 'Coordinator' THEN 4
          WHEN 'Core Member' THEN 5
          WHEN 'Volunteer' THEN 6
          ELSE 7
        END, u.name
    `).all(...params);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/members  (invite / add)
--------------------------------------------------------------- */
const addMemberValidation = [
  body('name').trim().notEmpty().withMessage('Name required.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('clubRole').isIn(['Vice President','Coordinator','Core Member','Volunteer','General Member']).withMessage('Invalid club role.'),
];

async function addMember(req, res, next) {
  try {
    const db      = getDb();
    const clubId  = req.params.clubId;
    const { name, email, clubRole } = req.body;
    const bcrypt  = require('bcrypt');
    const crypto  = require('crypto');
    const mailer  = require('../services/mailer');

    // Check club exists
    const club = db.prepare(`SELECT * FROM clubs WHERE id = ? AND status = 'active'`).get(clubId);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found.' });

    let user = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).get(email);
    let tempPassword = null;
    if (!user) {
      tempPassword = crypto.randomBytes(6).toString('hex') + 'A1';
      const hash   = await bcrypt.hash(tempPassword, 12);
      const info   = db.prepare(`INSERT INTO users (name, email, password_hash, system_role, must_change_password) VALUES (?,?,?,'member',1)`).run(name, email, hash);
      user = { id: info.lastInsertRowid, name, email };
    }

    const existing = db.prepare(`SELECT * FROM club_members WHERE user_id = ? AND club_id = ?`).get(user.id, clubId);
    if (existing) {
      if (existing.status === 'active') return res.status(409).json({ success: false, message: 'User is already a member.' });
      db.prepare(`UPDATE club_members SET club_role = ?, status = 'active', joined_at = datetime('now') WHERE id = ?`).run(clubRole, existing.id);
    } else {
      db.prepare(`INSERT INTO club_members (user_id, club_id, club_role) VALUES (?,?,?)`).run(user.id, clubId, clubRole);
    }

    if (tempPassword) await mailer.sendMemberInvitation(email, name, club.name, tempPassword);

    // In-app notification
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)`).run(user.id, 'member_added', `Added to ${club.name}`, `You have been added as ${clubRole} in ${club.name}.`);

    audit.log(req.session.userId, req.session.name, `Added member ${name} as ${clubRole}`, 'Members', club.name, req.ip);
    res.status(201).json({ success: true, userId: user.id });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   PATCH /api/v1/clubs/:clubId/members/:userId
--------------------------------------------------------------- */
const updateMemberValidation = [
  body('clubRole').optional().isIn(['Vice President','Coordinator','Core Member','Volunteer','General Member']).withMessage('Invalid club role.'),
  body('status').optional().isIn(['active','inactive']).withMessage('Invalid status.'),
];

function updateMember(req, res, next) {
  try {
    const db     = getDb();
    const { clubId, userId } = req.params;
    const { clubRole, status } = req.body;

    const cm = db.prepare(`SELECT * FROM club_members WHERE user_id = ? AND club_id = ?`).get(userId, clubId);
    if (!cm) return res.status(404).json({ success: false, message: 'Member not found.' });

    // Protect Faculty Advisor and President roles
    if (['Faculty Advisor','President'].includes(cm.club_role) && req.session.systemRole !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Cannot modify Faculty Advisor or President role.' });
    }

    if (clubRole) db.prepare(`UPDATE club_members SET club_role = ? WHERE user_id = ? AND club_id = ?`).run(clubRole, userId, clubId);
    if (status)   db.prepare(`UPDATE club_members SET status = ? WHERE user_id = ? AND club_id = ?`).run(status, userId, clubId);

    const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId);
    audit.log(req.session.userId, req.session.name, `Updated member ${u.name}`, 'Members', `role=${clubRole||cm.club_role} status=${status||cm.status}`, req.ip);
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  listClubs, updateClubStatus,
  listMembers,
  addMemberValidation, validate, addMember,
  updateMemberValidation, updateMember,
};
