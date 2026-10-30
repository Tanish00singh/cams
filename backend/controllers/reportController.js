'use strict';
const { getDb } = require('../models/db');
const { createReportPdf, createReportExcel } = require('../services/documentService');
const audit = require('../services/audit');

/* ---------------------------------------------------------------
   GET /api/v1/dashboard
--------------------------------------------------------------- */
function getDashboard(req, res, next) {
  try {
    const db = getDb();
    const role = req.session.systemRole;
    const clubId = req.session.clubId;

    if (role === 'superadmin') {
      const pendingReqs = db.prepare(`SELECT COUNT(*) as count FROM club_requests WHERE status IN ('pending', 'under_review', 'needs_info')`).get().count;
      const activeClubs = db.prepare(`SELECT COUNT(*) as count FROM clubs WHERE status = 'active'`).get().count;
      const flaggedDocs = db.prepare(`SELECT COUNT(*) as count FROM club_requests WHERE status = 'needs_info'`).get().count;
      const totalMembers = db.prepare(`SELECT COUNT(*) as count FROM club_members WHERE status = 'active'`).get().count;

      const queueAwaiting = db.prepare(`
        SELECT request_no, club_name, requester_name, category, status
        FROM club_requests
        WHERE status IN ('pending', 'under_review', 'needs_info')
        ORDER BY submitted_at DESC
        LIMIT 5
      `).all();

      return res.json({
        success: true,
        stats: {
          pendingRequests: pendingReqs,
          activeClubs,
          flaggedDocs,
          totalMembers
        },
        queue: queueAwaiting
      });
    }

    // Club / Advisor / Member role
    const activeMembers = clubId ? db.prepare(`SELECT COUNT(*) as count FROM club_members WHERE club_id = ? AND status = 'active'`).get(clubId).count : 0;
    const upcomingEvents = clubId ? db.prepare(`SELECT COUNT(*) as count FROM events WHERE club_id = ? AND status IN ('approved', 'published')`).get(clubId).count : 0;
    const pendingTasks = clubId ? db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE club_id = ? AND status != 'done'`).get(clubId).count : 0;
    const certsIssued = clubId ? db.prepare(`
      SELECT COUNT(c.id) as count FROM certificates c 
      JOIN events e ON e.id = c.event_id 
      WHERE e.club_id = ?
    `).get(clubId).count : 0;

    // Recent activity list
    const recentActivity = clubId ? db.prepare(`
      SELECT * FROM audit_log 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all() : [];

    // Personal member stats if member
    let memberStats = null;
    if (role === 'member') {
      const myEvents = db.prepare(`SELECT COUNT(*) as count FROM event_registrations WHERE user_id = ?`).get(req.session.userId).count;
      const myTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status != 'done'`).get(req.session.userId).count;
      const myCerts = db.prepare(`SELECT COUNT(*) as count FROM certificates WHERE user_id = ?`).get(req.session.userId).count;
      memberStats = { myEvents, myTasks, myCerts };
    }

    res.json({
      success: true,
      stats: {
        activeMembers,
        upcomingEvents,
        pendingTasks,
        certsIssued
      },
      memberStats,
      recentActivity
    });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/ticker (Notice Board)
--------------------------------------------------------------- */
function getTicker(req, res, next) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.title, a.sent_at, c.name as club_name
      FROM announcements a
      JOIN clubs c ON c.id = a.club_id
      ORDER BY a.sent_at DESC
      LIMIT 8
    `).all();

    const tickerItems = rows.map(r => `${r.club_name} — ${r.title}`);
    // If empty or few, add default notices
    if (tickerItems.length === 0) {
      tickerItems.push(
        'Student Affairs — New club creation requests must include a signed advisor consent form',
        'Office of Student Affairs — All annual club reports are due by the end of this month'
      );
    }
    res.json({ success: true, ticker: tickerItems });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   GET /api/v1/audit (Admin only, paginated)
--------------------------------------------------------------- */
function listAudit(req, res, next) {
  try {
    const db = getDb();
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log`).get().count;
    const rows = db.prepare(`
      SELECT * FROM audit_log
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), offset);

    res.json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   REPORTS: Helper dispatcher
--------------------------------------------------------------- */
async function generateReport(req, res, type) {
  const db = getDb();
  const format = (req.query.format || 'pdf').toLowerCase();
  const clubId = req.session.systemRole === 'superadmin' ? null : req.session.clubId;

  let title = '';
  let subtitle = clubId ? 'Club-Specific Institutional Report' : 'Institute-Wide Report';
  let headers = [];
  let excelColumns = [];
  let rows = [];
  let excelData = [];

  switch (type) {
    case 'clubs': {
      title = 'Clubs Directory & Status Report';
      headers = ['Club Name', 'Category', 'Status', 'Members', 'Created Date'];
      excelColumns = [
        { header: 'Club Name', key: 'name', width: 25 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Members', key: 'members', width: 15 },
        { header: 'Created Date', key: 'created_at', width: 20 },
      ];
      const data = db.prepare(`
        SELECT c.name, c.category, c.status, c.created_at, COUNT(cm.id) as members
        FROM clubs c LEFT JOIN club_members cm ON cm.club_id = c.id
        GROUP BY c.id
      `).all();
      rows = data.map(d => [d.name, d.category, d.status, d.members, d.created_at]);
      excelData = data;
      break;
    }
    case 'events': {
      title = 'Events Activity & Outcomes Report';
      headers = ['Event Title', 'Club', 'Date', 'Venue', 'Status', 'Registrations'];
      excelColumns = [
        { header: 'Event Title', key: 'title', width: 28 },
        { header: 'Club', key: 'club_name', width: 20 },
        { header: 'Date', key: 'date_time', width: 20 },
        { header: 'Venue', key: 'venue', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Registrations', key: 'regs', width: 15 },
      ];
      let q = `
        SELECT e.title, c.name as club_name, e.date_time, e.venue, e.status, COUNT(er.id) as regs
        FROM events e
        JOIN clubs c ON c.id = e.club_id
        LEFT JOIN event_registrations er ON er.event_id = e.id
      `;
      if (clubId) q += ` WHERE e.club_id = ${clubId}`;
      q += ` GROUP BY e.id ORDER BY e.date_time DESC`;
      const data = db.prepare(q).all();
      rows = data.map(d => [d.title, d.club_name, d.date_time, d.venue, d.status, d.regs]);
      excelData = data;
      break;
    }
    case 'attendance': {
      title = 'Event Attendance Verification Report';
      headers = ['Student Name', 'Event Title', 'Method', 'Marked At'];
      excelColumns = [
        { header: 'Student Name', key: 'student_name', width: 25 },
        { header: 'Event Title', key: 'event_title', width: 25 },
        { header: 'Method', key: 'method', width: 15 },
        { header: 'Marked At', key: 'marked_at', width: 20 },
      ];
      let q = `
        SELECT u.name as student_name, e.title as event_title, a.method, a.marked_at
        FROM attendance a
        JOIN users u ON u.id = a.user_id
        JOIN events e ON e.id = a.event_id
      `;
      if (clubId) q += ` WHERE e.club_id = ${clubId}`;
      q += ` ORDER BY a.marked_at DESC`;
      const data = db.prepare(q).all();
      rows = data.map(d => [d.student_name, d.event_title, d.method, d.marked_at]);
      excelData = data;
      break;
    }
    case 'members': {
      title = 'Club Membership & Roles Roster';
      headers = ['Member Name', 'Email', 'Role', 'Status', 'Joined Date'];
      excelColumns = [
        { header: 'Member Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Role', key: 'club_role', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Joined Date', key: 'joined_at', width: 20 },
      ];
      let q = `
        SELECT u.name, u.email, cm.club_role, cm.status, cm.joined_at
        FROM club_members cm
        JOIN users u ON u.id = cm.user_id
      `;
      if (clubId) q += ` WHERE cm.club_id = ${clubId}`;
      q += ` ORDER BY u.name ASC`;
      const data = db.prepare(q).all();
      rows = data.map(d => [d.name, d.email, d.club_role, d.status, d.joined_at]);
      excelData = data;
      break;
    }
    case 'certificates': {
      title = 'Issued Certificates Registry';
      headers = ['Recipient', 'Event', 'Verify Code', 'Issued Date'];
      excelColumns = [
        { header: 'Recipient', key: 'name', width: 25 },
        { header: 'Event', key: 'event_title', width: 25 },
        { header: 'Verify Code', key: 'verify_code', width: 35 },
        { header: 'Issued Date', key: 'issued_at', width: 20 },
      ];
      let q = `
        SELECT u.name, e.title as event_title, c.verify_code, c.issued_at
        FROM certificates c
        JOIN users u ON u.id = c.user_id
        JOIN events e ON e.id = c.event_id
      `;
      if (clubId) q += ` WHERE e.club_id = ${clubId}`;
      q += ` ORDER BY c.issued_at DESC`;
      const data = db.prepare(q).all();
      rows = data.map(d => [d.name, d.event_title, d.verify_code, d.issued_at]);
      excelData = data;
      break;
    }
    case 'feedback': {
      title = 'Event Participant Feedback & Ratings Report';
      headers = ['Event Title', 'Participant', 'Rating', 'Comment', 'Submitted'];
      excelColumns = [
        { header: 'Event Title', key: 'event_title', width: 25 },
        { header: 'Participant', key: 'user_name', width: 20 },
        { header: 'Rating', key: 'rating', width: 10 },
        { header: 'Comment', key: 'comment', width: 35 },
        { header: 'Submitted', key: 'submitted_at', width: 20 },
      ];
      let q = `
        SELECT e.title as event_title, u.name as user_name, f.rating, f.comment, f.submitted_at
        FROM feedback f
        JOIN events e ON e.id = f.event_id
        JOIN users u ON u.id = f.user_id
      `;
      if (clubId) q += ` WHERE e.club_id = ${clubId}`;
      q += ` ORDER BY f.submitted_at DESC`;
      const data = db.prepare(q).all();
      rows = data.map(d => [d.event_title, d.user_name, `${d.rating}/5`, d.comment || '-', d.submitted_at]);
      excelData = data;
      break;
    }
    default:
      return res.status(400).send('Invalid report type');
  }

  audit.log(req.session.userId, req.session.name, `Exported ${type} report (${format.toUpperCase()})`, 'Reports', null, req.ip);

  if (format === 'excel') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=CAMS-Report-${type}.xlsx`);
    const workbook = await createReportExcel(title, excelColumns, excelData);
    return workbook.xlsx.write(res).then(() => res.end());
  } else {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=CAMS-Report-${type}.pdf`);
    const pdfDoc = createReportPdf(title, subtitle, headers, rows);
    pdfDoc.pipe(res);
    pdfDoc.end();
  }
}

module.exports = {
  getDashboard,
  getTicker,
  listAudit,
  generateReport
};
