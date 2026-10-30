'use strict';
const multer      = require('multer');
const path        = require('path');
const crypto      = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb }   = require('../models/db');
const { body, query } = require('express-validator');
const validate    = require('../middleware/validate');
const mailer      = require('../services/mailer');
const audit       = require('../services/audit');
const bcrypt      = require('bcrypt');

/* ---------------------------------------------------------------
   Multer setup — secure file upload
--------------------------------------------------------------- */
const ALLOWED_MIME = ['application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg','image/png'];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, _file, cb) => cb(null, uuidv4() + path.extname(_file.originalname).toLowerCase()),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Invalid file type. Only PDF, DOCX, JPG, PNG allowed.'), { status: 400 }));
  },
}).array('documents', 5);

function handleUpload(req, res, next) {
  upload(req, res, err => {
    if (err) return next(Object.assign(err, { status: 400 }));
    next();
  });
}

/* ---------------------------------------------------------------
   Request number generator
--------------------------------------------------------------- */
function nextRequestNo(db) {
  const year = new Date().getFullYear();
  const row  = db.prepare(`SELECT MAX(CAST(SUBSTR(request_no,-5) AS INTEGER)) as last FROM club_requests WHERE request_no LIKE 'REQ-${year}-%'`).get();
  const seq  = ((row && row.last) || 0) + 1;
  return `REQ-${year}-${String(seq).padStart(5,'0')}`;
}

/* ---------------------------------------------------------------
   Validation chains
--------------------------------------------------------------- */
const createRequestValidation = [
  body('clubName').trim().notEmpty().withMessage('Club name is required.').isLength({ max: 120 }),
  body('description').trim().notEmpty().withMessage('Description is required.'),
  body('objective').trim().notEmpty().withMessage('Objective is required.'),
  body('category').isIn(['Technical','Cultural','Literary','Sports','Professional / Career','Social Service']).withMessage('Invalid category.'),
  body('proposedAdvisor').trim().notEmpty().withMessage('Proposed Faculty Advisor is required.'),
  body('requesterName').trim().notEmpty().withMessage('Your name is required.'),
  body('requesterEmail').isEmail().normalizeEmail().withMessage('Valid requester email required.'),
];

/* ---------------------------------------------------------------
   POST /api/v1/requests   (public — no auth)
--------------------------------------------------------------- */
async function createRequest(req, res, next) {
  try {
    const db = getDb();
    const { clubName, description, objective, category, proposedAdvisor, otherDetails, requesterName, requesterEmail } = req.body;

    // Check club name uniqueness (existing clubs + pending non-rejected requests)
    const exists = db.prepare(`SELECT id FROM clubs WHERE name = ? COLLATE NOCASE`).get(clubName);
    if (exists) return res.status(409).json({ success: false, message: 'A club with that name already exists.' });

    const dupReq = db.prepare(`SELECT id FROM club_requests WHERE club_name = ? COLLATE NOCASE AND status NOT IN ('rejected')`).get(clubName);
    if (dupReq) return res.status(409).json({ success: false, message: 'A pending request for that club name already exists.' });

    const requestNo = nextRequestNo(db);

    const info = db.prepare(`
      INSERT INTO club_requests (request_no, club_name, description, objective, category, proposed_advisor, other_details, requester_name, requester_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestNo, clubName, description, objective, category, proposedAdvisor, otherDetails || null, requesterName, requesterEmail);

    const requestId = info.lastInsertRowid;

    // Save uploaded documents
    if (req.files && req.files.length) {
      const insertDoc = db.prepare(`INSERT INTO request_documents (request_id, filename, original_name, mime_type, size) VALUES (?,?,?,?,?)`);
      for (const f of req.files) {
        insertDoc.run(requestId, f.filename, f.originalname, f.mimetype, f.size);
      }
    }

    // Email confirmation
    await mailer.sendRequestStatus(requesterEmail, requesterName, requestNo, 'pending', null);

    // Notify super admins
    const admins = db.prepare(`SELECT id FROM users WHERE system_role = 'superadmin' AND status = 'active'`).all();
    const insertNotif = db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)`);
    for (const a of admins) {
      insertNotif.run(a.id, 'new_request', 'New Club Creation Request', `${clubName} — submitted by ${requesterName}`);
    }

    audit.log(null, requesterName, `Submitted club request ${requestNo}`, 'Requests', clubName, req.ip);

    res.status(201).json({ success: true, requestNo, message: 'Request submitted successfully.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/requests   (admin only)
--------------------------------------------------------------- */
function listRequests(req, res, next) {
  try {
    const db = getDb();
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];
    if (status) { where += ` AND r.status = ?`; params.push(status); }
    if (search) { where += ` AND (r.club_name LIKE ? OR r.requester_name LIKE ? OR r.request_no LIKE ?)`; const s = `%${search}%`; params.push(s, s, s); }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM club_requests r WHERE ${where}`).get(...params).cnt;
    const rows  = db.prepare(`
      SELECT r.*, COUNT(d.id) as doc_count,
        u.name as reviewer_name
      FROM club_requests r
      LEFT JOIN request_documents d ON d.request_id = r.id
      LEFT JOIN users u ON u.id = r.reviewed_by
      WHERE ${where}
      GROUP BY r.id
      ORDER BY r.submitted_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    res.json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/requests/:id
--------------------------------------------------------------- */
function getRequest(req, res, next) {
  try {
    const db  = getDb();
    const row = db.prepare(`
      SELECT r.*, u.name as reviewer_name
      FROM club_requests r LEFT JOIN users u ON u.id = r.reviewed_by
      WHERE r.id = ?
    `).get(req.params.id);

    if (!row) return res.status(404).json({ success: false, message: 'Request not found.' });

    const docs      = db.prepare(`SELECT * FROM request_documents WHERE request_id = ?`).all(row.id);
    const checklist = db.prepare(`SELECT * FROM request_checklist WHERE request_id = ?`).all(row.id);

    res.json({ success: true, data: { ...row, documents: docs, checklist } });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   PATCH /api/v1/requests/:id/checklist
--------------------------------------------------------------- */
function updateChecklist(req, res, next) {
  try {
    const db  = getDb();
    const { items } = req.body; // [{key, checked}]
    if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'items array required.' });

    const upsert = db.prepare(`
      INSERT INTO request_checklist (request_id, item_key, checked, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(request_id, item_key) DO UPDATE SET checked = excluded.checked, updated_at = excluded.updated_at
    `);
    for (const item of items) upsert.run(req.params.id, item.key, item.checked ? 1 : 0);

    // Move to under_review if still pending
    db.prepare(`UPDATE club_requests SET status = 'under_review' WHERE id = ? AND status = 'pending'`).run(req.params.id);

    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/requests/:id/approve
--------------------------------------------------------------- */
async function approveRequest(req, res, next) {
  try {
    const db  = getDb();
    const req_ = db.prepare(`SELECT * FROM club_requests WHERE id = ?`).get(req.params.id);
    if (!req_) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (req_.status === 'approved') return res.status(409).json({ success: false, message: 'Already approved.' });

    // Create club
    const clubInfo = db.prepare(`
      INSERT INTO clubs (name, description, objective, category, status, created_from_request_id)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(req_.club_name, req_.description, req_.objective, req_.category, req_.id);
    const clubId = clubInfo.lastInsertRowid;

    // Create/find president account
    const presEmail = req_.requester_email;
    let president = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).get(presEmail);
    const tempPres = !president;
    const presPass = tempPres ? crypto.randomBytes(6).toString('hex') + 'A1' : null;
    if (tempPres) {
      const hash = await bcrypt.hash(presPass, 12);
      const info = db.prepare(`INSERT INTO users (name, email, password_hash, system_role, must_change_password) VALUES (?,?,?,'president',1)`).run(req_.requester_name, presEmail, hash);
      president = { id: info.lastInsertRowid, name: req_.requester_name, email: presEmail };
    } else {
      db.prepare(`UPDATE users SET system_role = 'president', must_change_password = 1, updated_at = datetime('now') WHERE id = ?`).run(president.id);
    }
    db.prepare(`INSERT OR IGNORE INTO club_members (user_id, club_id, club_role, status) VALUES (?,?,'President','active')`).run(president.id, clubId);

    // Create/find advisor account
    const advisorName  = req_.proposed_advisor;
    const advisorEmail = req.body.advisorEmail || null; // optional override from admin

    if (advisorEmail) {
      let advisor = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).get(advisorEmail);
      const advPass = advisor ? null : crypto.randomBytes(6).toString('hex') + 'B2';
      if (!advisor) {
        const hash = await bcrypt.hash(advPass, 12);
        const info = db.prepare(`INSERT INTO users (name, email, password_hash, system_role, must_change_password) VALUES (?,?,?,'advisor',1)`).run(advisorName, advisorEmail, hash);
        advisor = { id: info.lastInsertRowid, name: advisorName, email: advisorEmail };
        if (advPass) await mailer.sendClubCredentials(advisorEmail, advisorName, advisorEmail, advPass, req_.club_name);
      }
      db.prepare(`INSERT OR IGNORE INTO club_members (user_id, club_id, club_role, status) VALUES (?,?,'Faculty Advisor','active')`).run(advisor.id, clubId);
    }

    // Update request
    db.prepare(`UPDATE club_requests SET status='approved', reviewed_at=datetime('now'), reviewed_by=?, remarks=? WHERE id=?`).run(req.session.userId, req.body.remarks || null, req_.id);

    // Send credentials email
    if (tempPres) await mailer.sendClubCredentials(presEmail, req_.requester_name, presEmail, presPass, req_.club_name);

    // Notify president
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)`).run(president.id, 'request_approved', 'Club Request Approved', `${req_.club_name} has been approved!`);

    audit.log(req.session.userId, req.session.name, `Approved club request ${req_.request_no}`, 'Verification', req_.club_name, req.ip);
    res.json({ success: true, message: 'Club approved and accounts created.', clubId });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/requests/:id/reject
--------------------------------------------------------------- */
async function rejectRequest(req, res, next) {
  try {
    const db   = getDb();
    const req_ = db.prepare(`SELECT * FROM club_requests WHERE id = ?`).get(req.params.id);
    if (!req_) return res.status(404).json({ success: false, message: 'Request not found.' });

    const { remarks } = req.body;
    db.prepare(`UPDATE club_requests SET status='rejected', reviewed_at=datetime('now'), reviewed_by=?, remarks=? WHERE id=?`).run(req.session.userId, remarks || null, req_.id);

    await mailer.sendRequestStatus(req_.requester_email, req_.requester_name, req_.request_no, 'rejected', remarks);
    audit.log(req.session.userId, req.session.name, `Rejected club request ${req_.request_no}`, 'Verification', remarks || null, req.ip);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/requests/:id/ask-info
--------------------------------------------------------------- */
async function askInfo(req, res, next) {
  try {
    const db   = getDb();
    const req_ = db.prepare(`SELECT * FROM club_requests WHERE id = ?`).get(req.params.id);
    if (!req_) return res.status(404).json({ success: false, message: 'Request not found.' });

    const { remarks } = req.body;
    if (!remarks) return res.status(400).json({ success: false, message: 'Remarks are required when asking for more info.' });

    db.prepare(`UPDATE club_requests SET status='needs_info', reviewed_at=datetime('now'), reviewed_by=?, remarks=? WHERE id=?`).run(req.session.userId, remarks, req_.id);

    await mailer.sendRequestStatus(req_.requester_email, req_.requester_name, req_.request_no, 'needs_info', remarks);
    audit.log(req.session.userId, req.session.name, `Requested more info on ${req_.request_no}`, 'Verification', remarks, req.ip);
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  handleUpload,
  createRequestValidation, validate, createRequest,
  listRequests, getRequest, updateChecklist,
  approveRequest, rejectRequest, askInfo,
};
