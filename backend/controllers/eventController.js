'use strict';
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/db');
const { body } = require('express-validator');
const audit = require('../services/audit');
const { generateCertificatePdf } = require('../services/documentService');

/* ---------------------------------------------------------------
   GET /api/v1/clubs/:clubId/events
--------------------------------------------------------------- */
function listEvents(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;
    const { status } = req.query;

    let query = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) as reg_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) as att_count,
        u.name as creator_name,
        appr.name as approver_name
      FROM events e
      LEFT JOIN users u ON u.id = e.created_by
      LEFT JOIN users appr ON appr.id = e.approved_by
      WHERE e.club_id = ?
    `;
    const params = [clubId];

    if (status) {
      query += ` AND e.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY e.date_time DESC`;

    const events = db.prepare(query).all(...params);
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events
--------------------------------------------------------------- */
const createEventValidation = [
  body('title').trim().notEmpty().withMessage('Event title is required.'),
  body('dateTime').trim().notEmpty().withMessage('Date and time is required.'),
  body('venue').trim().notEmpty().withMessage('Venue is required.'),
];

function createEvent(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;
    const { title, description, dateTime, venue, capacity, action } = req.body;
    
    // Status depends on action: draft or submitted
    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? new Date().toISOString() : null;

    const info = db.prepare(`
      INSERT INTO events (club_id, title, description, date_time, venue, capacity, status, created_by, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clubId, title, description || null, dateTime, venue, capacity || null, status, req.session.userId, submittedAt);

    const eventId = info.lastInsertRowid;
    audit.log(req.session.userId, req.session.name, `Created event "${title}" as ${status}`, 'Events', `Club ID: ${clubId}`, req.ip);

    // Notify Advisor if submitted
    if (status === 'submitted') {
      const advisor = db.prepare(`
        SELECT u.id FROM club_members cm JOIN users u ON u.id = cm.user_id 
        WHERE cm.club_id = ? AND cm.club_role = 'Faculty Advisor' AND cm.status = 'active'
      `).get(clubId);
      if (advisor) {
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, body)
          VALUES (?, 'event_submitted', 'Event Awaiting Approval', ?)
        `).run(advisor.id, `"${title}" has been submitted for your review.`);
      }
    }

    res.status(201).json({ success: true, eventId, status, message: `Event created as ${status}` });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events/:eventId/submit
--------------------------------------------------------------- */
function submitEvent(req, res, next) {
  try {
    const db = getDb();
    const { clubId, eventId } = req.params;

    const event = db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(eventId, clubId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    db.prepare(`UPDATE events SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(eventId);

    // Notify Faculty Advisor
    const advisor = db.prepare(`
      SELECT u.id FROM club_members cm JOIN users u ON u.id = cm.user_id 
      WHERE cm.club_id = ? AND cm.club_role = 'Faculty Advisor' AND cm.status = 'active'
    `).get(clubId);
    if (advisor) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (?, 'event_submitted', 'Event Awaiting Approval', ?)
      `).run(advisor.id, `"${event.title}" has been submitted for approval.`);
    }

    audit.log(req.session.userId, req.session.name, `Submitted event "${event.title}" for approval`, 'Events', null, req.ip);
    res.json({ success: true, message: 'Event submitted for approval.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events/:eventId/approve
--------------------------------------------------------------- */
function approveEvent(req, res, next) {
  try {
    const db = getDb();
    const { clubId, eventId } = req.params;

    const event = db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(eventId, clubId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    db.prepare(`
      UPDATE events SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') 
      WHERE id = ?
    `).run(req.session.userId, eventId);

    // Notify President & Creator
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (?, 'event_approved', 'Event Approved', ?)
    `).run(event.created_by, `Your event "${event.title}" was approved by Faculty Advisor.`);

    audit.log(req.session.userId, req.session.name, `Approved event "${event.title}"`, 'Events', null, req.ip);
    res.json({ success: true, message: 'Event approved successfully.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events/:eventId/reject
--------------------------------------------------------------- */
function rejectEvent(req, res, next) {
  try {
    const db = getDb();
    const { clubId, eventId } = req.params;
    const { reason } = req.body;

    const event = db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(eventId, clubId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    db.prepare(`
      UPDATE events SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') 
      WHERE id = ?
    `).run(reason || null, eventId);

    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (?, 'event_rejected', 'Event Rejected', ?)
    `).run(event.created_by, `Event "${event.title}" was rejected: ${reason || 'No remarks provided'}`);

    audit.log(req.session.userId, req.session.name, `Rejected event "${event.title}"`, 'Events', reason, req.ip);
    res.json({ success: true, message: 'Event rejected.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events/:eventId/publish
--------------------------------------------------------------- */
function publishEvent(req, res, next) {
  try {
    const db = getDb();
    const { clubId, eventId } = req.params;

    const event = db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(eventId, clubId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });
    if (event.status !== 'approved' && event.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only approved or draft events can be published.' });
    }

    db.prepare(`UPDATE events SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(eventId);

    audit.log(req.session.userId, req.session.name, `Published event "${event.title}"`, 'Events', null, req.ip);
    res.json({ success: true, message: 'Event published!' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/clubs/:clubId/events/:eventId/complete
--------------------------------------------------------------- */
async function completeEvent(req, res, next) {
  try {
    const db = getDb();
    const { clubId, eventId } = req.params;

    const event = db.prepare(`SELECT e.*, c.name as club_name FROM events e JOIN clubs c ON c.id = e.club_id WHERE e.id = ? AND e.club_id = ?`).get(eventId, clubId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    db.prepare(`UPDATE events SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(eventId);

    // Auto-generate certificates for all attendees
    const attendees = db.prepare(`
      SELECT a.user_id, u.name, u.email
      FROM attendance a
      JOIN users u ON u.id = a.user_id
      WHERE a.event_id = ?
    `).all(eventId);

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const insertCert = db.prepare(`
      INSERT OR IGNORE INTO certificates (event_id, user_id, verify_code, pdf_path, issued_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    for (const att of attendees) {
      const verifyCode = uuidv4();
      const pdfFileName = `cert-${eventId}-${att.user_id}-${Date.now()}.pdf`;
      const pdfPath = path.join(uploadsDir, pdfFileName);

      await generateCertificatePdf({
        studentName: att.name,
        clubName: event.club_name,
        eventTitle: event.title,
        eventDate: event.date_time,
        verifyCode,
        outputPath: pdfPath
      });

      insertCert.run(eventId, att.user_id, verifyCode, pdfFileName);

      // Notification to student
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (?, 'certificate_issued', 'Certificate Issued', ?)
      `).run(att.user_id, `Your certificate for "${event.title}" is ready to download.`);
    }

    audit.log(req.session.userId, req.session.name, `Completed event "${event.title}" and generated certificates`, 'Events', `Count: ${attendees.length}`, req.ip);
    res.json({ success: true, message: `Event marked completed. ${attendees.length} certificates generated.` });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/events/:eventId/register
--------------------------------------------------------------- */
function registerForEvent(req, res, next) {
  try {
    const db = getDb();
    const eventId = req.params.eventId;
    const userId = req.session.userId;

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    if (event.capacity) {
      const current = db.prepare('SELECT COUNT(*) as count FROM event_registrations WHERE event_id = ?').get(eventId).count;
      if (current >= event.capacity) {
        return res.status(400).json({ success: false, message: 'Event is full to capacity.' });
      }
    }

    const reg = db.prepare('INSERT OR IGNORE INTO event_registrations (event_id, user_id) VALUES (?, ?)').run(eventId, userId);
    if (reg.changes === 0) {
      return res.status(409).json({ success: false, message: 'Already registered for this event.' });
    }

    audit.log(userId, req.session.name, `Registered for event "${event.title}"`, 'Events', null, req.ip);
    res.json({ success: true, message: 'Registration successful!' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/events/:eventId/qr
--------------------------------------------------------------- */
async function getEventQr(req, res, next) {
  try {
    const eventId = req.params.eventId;
    const payload = JSON.stringify({ eventId: Number(eventId), secret: `CAMS-EVENT-${eventId}` });
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 300 });
    res.json({ success: true, qr: qrDataUrl, payload });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/events/:eventId/attendance
--------------------------------------------------------------- */
function markAttendance(req, res, next) {
  try {
    const db = getDb();
    const eventId = req.params.eventId;
    const { userId, method = 'manual' } = req.body;
    const targetUserId = userId || req.session.userId;

    const info = db.prepare(`
      INSERT OR IGNORE INTO attendance (event_id, user_id, method, marked_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(eventId, targetUserId, method);

    if (info.changes === 0) {
      return res.status(409).json({ success: false, message: 'Attendance already marked.' });
    }

    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(targetUserId);
    audit.log(req.session.userId, req.session.name, `Marked attendance for ${u ? u.name : targetUserId}`, 'Attendance', `Event ID: ${eventId}`, req.ip);

    res.json({ success: true, message: 'Attendance recorded successfully.' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   POST /api/v1/events/:eventId/feedback
--------------------------------------------------------------- */
function submitFeedback(req, res, next) {
  try {
    const db = getDb();
    const eventId = req.params.eventId;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO feedback (event_id, user_id, rating, comment, submitted_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(eventId, req.session.userId, rating, comment || null);

    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/events/:eventId/feedback
--------------------------------------------------------------- */
function getFeedback(req, res, next) {
  try {
    const db = getDb();
    const eventId = req.params.eventId;

    const rows = db.prepare(`
      SELECT f.*, u.name as user_name
      FROM feedback f
      JOIN users u ON u.id = f.user_id
      WHERE f.event_id = ?
      ORDER BY f.submitted_at DESC
    `).all(eventId);

    const stats = db.prepare(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as count
      FROM feedback
      WHERE event_id = ?
    `).get(eventId);

    res.json({ success: true, data: rows, stats });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/certificates/:id/download
--------------------------------------------------------------- */
function downloadCertificate(req, res, next) {
  try {
    const db = getDb();
    const cert = db.prepare(`SELECT * FROM certificates WHERE id = ? OR verify_code = ?`).get(req.params.id, req.params.id);
    if (!cert || !cert.pdf_path) {
      return res.status(404).json({ success: false, message: 'Certificate file not found.' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', cert.pdf_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File missing on server.' });
    }

    res.download(filePath, `Certificate-${cert.verify_code.slice(0,8)}.pdf`);
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/certificates/:code/verify (Public)
--------------------------------------------------------------- */
function verifyCertificate(req, res, next) {
  try {
    const db = getDb();
    const cert = db.prepare(`
      SELECT c.*, u.name as student_name, e.title as event_title, e.date_time as event_date, cl.name as club_name
      FROM certificates c
      JOIN users u ON u.id = c.user_id
      JOIN events e ON e.id = c.event_id
      JOIN clubs cl ON cl.id = e.club_id
      WHERE c.verify_code = ?
    `).get(req.params.code);

    if (!cert) {
      return res.status(404).json({ success: false, message: 'Certificate verification failed. Code not found.' });
    }

    res.json({ success: true, certificate: cert });
  } catch (err) { next(err); }
}

module.exports = {
  listEvents,
  createEventValidation,
  createEvent,
  submitEvent,
  approveEvent,
  rejectEvent,
  publishEvent,
  completeEvent,
  registerForEvent,
  getEventQr,
  markAttendance,
  submitFeedback,
  getFeedback,
  downloadCertificate,
  verifyCertificate
};
