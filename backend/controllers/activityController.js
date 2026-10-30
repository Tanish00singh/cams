'use strict';
const { getDb } = require('../models/db');
const { body } = require('express-validator');
const mailer = require('../services/mailer');
const audit = require('../services/audit');

/* ---------------------------------------------------------------
   TASKS
--------------------------------------------------------------- */
function listTasks(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;

    const tasks = db.prepare(`
      SELECT t.*, u.name as assignee_name, e.title as event_title
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN events e ON e.id = t.event_id
      WHERE t.club_id = ?
      ORDER BY t.created_at DESC
    `).all(clubId);

    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
}

const createTaskValidation = [
  body('title').trim().notEmpty().withMessage('Task title is required.')
];

function createTask(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;
    const { title, assignedTo, dueDate, eventId } = req.body;

    const info = db.prepare(`
      INSERT INTO tasks (club_id, event_id, title, assigned_to, due_date, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'todo', ?)
    `).run(clubId, eventId || null, title, assignedTo || null, dueDate || null, req.session.userId);

    if (assignedTo) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (?, 'task_assigned', 'New Task Assigned', ?)
      `).run(assignedTo, `You were assigned: "${title}"`);
    }

    audit.log(req.session.userId, req.session.name, `Created task "${title}"`, 'Tasks', null, req.ip);
    res.status(201).json({ success: true, taskId: info.lastInsertRowid });
  } catch (err) { next(err); }
}

function updateTask(req, res, next) {
  try {
    const db = getDb();
    const { taskId } = req.params;
    const { status, assignedTo, dueDate, title } = req.body;

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    if (status) db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, taskId);
    if (assignedTo !== undefined) db.prepare(`UPDATE tasks SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?`).run(assignedTo || null, taskId);
    if (dueDate !== undefined) db.prepare(`UPDATE tasks SET due_date = ?, updated_at = datetime('now') WHERE id = ?`).run(dueDate || null, taskId);
    if (title) db.prepare(`UPDATE tasks SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(title, taskId);

    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   ANNOUNCEMENTS
--------------------------------------------------------------- */
function listAnnouncements(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;

    const rows = db.prepare(`
      SELECT a.*, u.name as author_name
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      WHERE a.club_id = ?
      ORDER BY a.sent_at DESC
      LIMIT 10
    `).all(clubId);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

const createAnnouncementValidation = [
  body('title').trim().notEmpty().withMessage('Title is required.'),
  body('message').trim().notEmpty().withMessage('Message is required.')
];

async function createAnnouncement(req, res, next) {
  try {
    const db = getDb();
    const clubId = req.params.clubId;
    const { title, message } = req.body;

    const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(clubId);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found.' });

    const info = db.prepare(`
      INSERT INTO announcements (club_id, title, message, created_by, sent_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(clubId, title, message, req.session.userId);

    // Fetch members to send email & in-app notification
    const members = db.prepare(`
      SELECT u.id, u.email, u.name
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.club_id = ? AND cm.status = 'active'
    `).all(clubId);

    const emails = members.map(m => m.email);
    await mailer.sendAnnouncement(emails, club.name, title, message);

    const insertNotif = db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`);
    for (const m of members) {
      insertNotif.run(m.id, 'announcement', `Announcement from ${club.name}`, title);
    }

    audit.log(req.session.userId, req.session.name, `Published announcement "${title}"`, 'Announcements', club.name, req.ip);
    res.status(201).json({ success: true, announcementId: info.lastInsertRowid });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   NOTIFICATIONS
--------------------------------------------------------------- */
function listNotifications(req, res, next) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 15
    `).all(req.session.userId);

    const unread = db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`).get(req.session.userId).count;

    res.json({ success: true, data: rows, unreadCount: unread });
  } catch (err) { next(err); }
}

function markNotificationRead(req, res, next) {
  try {
    const db = getDb();
    const nid = req.params.id;
    if (nid === 'all') {
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.session.userId);
    } else {
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(nid, req.session.userId);
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ---------------------------------------------------------------
   VOLUNTEER REQUESTS
--------------------------------------------------------------- */
function requestVolunteer(req, res, next) {
  try {
    const db = getDb();
    const eventId = req.params.eventId;
    const userId = req.session.userId;

    const info = db.prepare(`
      INSERT OR IGNORE INTO volunteer_requests (event_id, user_id, status)
      VALUES (?, ?, 'pending')
    `).run(eventId, userId);

    if (info.changes === 0) {
      return res.status(409).json({ success: false, message: 'Volunteer request already sent.' });
    }

    // Notify president
    const event = db.prepare('SELECT title, created_by FROM events WHERE id = ?').get(eventId);
    if (event) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (?, 'volunteer_request', 'Volunteer Request', ?)
      `).run(event.created_by, `${req.session.name} offered to volunteer for "${event.title}"`);
    }

    res.status(201).json({ success: true, message: 'Volunteer request submitted.' });
  } catch (err) { next(err); }
}

function decideVolunteer(req, res, next) {
  try {
    const db = getDb();
    const { id } = req.params;
    const { status } = req.body; // 'accepted' | 'declined'

    db.prepare(`
      UPDATE volunteer_requests 
      SET status = ?, decided_at = datetime('now'), decided_by = ? 
      WHERE id = ?
    `).run(status, req.session.userId, id);

    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  listTasks,
  createTaskValidation,
  createTask,
  updateTask,
  listAnnouncements,
  createAnnouncementValidation,
  createAnnouncement,
  listNotifications,
  markNotificationRead,
  requestVolunteer,
  decideVolunteer
};
