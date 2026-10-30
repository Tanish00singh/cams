'use strict';
const express = require('express');
const router = express.Router();

const authCtrl = require('../controllers/authController');
const reqCtrl = require('../controllers/requestController');
const clubCtrl = require('../controllers/clubController');
const eventCtrl = require('../controllers/eventController');
const actCtrl = require('../controllers/activityController');
const repCtrl = require('../controllers/reportController');

const { requireAuth, requireRole, requireClubAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');

/* ---------------------------------------------------------------
   1. AUTH & ACCOUNT
--------------------------------------------------------------- */
router.post('/auth/login', authCtrl.loginValidation, validate, authCtrl.login);
router.post('/auth/logout', authCtrl.logout);
router.get('/auth/me', authCtrl.me);
router.post('/auth/forgot-password', authCtrl.forgotValidation, validate, authCtrl.forgotPassword);
router.post('/auth/reset-password', authCtrl.resetValidation, validate, authCtrl.resetPassword);
router.post('/auth/change-password', requireAuth, authCtrl.changeValidation, validate, authCtrl.changePassword);

/* ---------------------------------------------------------------
   2. PUBLIC & VERIFICATION REQUESTS
--------------------------------------------------------------- */
router.post('/requests', reqCtrl.handleUpload, reqCtrl.createRequestValidation, validate, reqCtrl.createRequest);
router.get('/requests', requireRole('superadmin'), reqCtrl.listRequests);
router.get('/requests/:id', requireRole('superadmin'), reqCtrl.getRequest);
router.patch('/requests/:id/checklist', requireRole('superadmin'), reqCtrl.updateChecklist);
router.post('/requests/:id/approve', requireRole('superadmin'), reqCtrl.approveRequest);
router.post('/requests/:id/reject', requireRole('superadmin'), reqCtrl.rejectRequest);
router.post('/requests/:id/ask-info', requireRole('superadmin'), reqCtrl.askInfo);

/* ---------------------------------------------------------------
   3. CLUBS & MEMBERS
--------------------------------------------------------------- */
router.get('/clubs', requireAuth, clubCtrl.listClubs);
router.patch('/clubs/:id/status', requireRole('superadmin'), clubCtrl.updateClubStatus);

router.get('/clubs/:clubId/members', requireAuth, requireClubAccess(), clubCtrl.listMembers);
router.post('/clubs/:clubId/members', requireAuth, requireClubAccess(['President']), clubCtrl.addMemberValidation, validate, clubCtrl.addMember);
router.patch('/clubs/:clubId/members/:userId', requireAuth, requireClubAccess(['President']), clubCtrl.updateMemberValidation, validate, clubCtrl.updateMember);

/* ---------------------------------------------------------------
   4. EVENTS & ATTENDANCE
--------------------------------------------------------------- */
router.get('/clubs/:clubId/events', requireAuth, requireClubAccess(), eventCtrl.listEvents);
router.post('/clubs/:clubId/events', requireAuth, requireClubAccess(['President']), eventCtrl.createEventValidation, validate, eventCtrl.createEvent);
router.post('/clubs/:clubId/events/:eventId/submit', requireAuth, requireClubAccess(['President']), eventCtrl.submitEvent);
router.post('/clubs/:clubId/events/:eventId/approve', requireAuth, requireClubAccess(['Faculty Advisor']), eventCtrl.approveEvent);
router.post('/clubs/:clubId/events/:eventId/reject', requireAuth, requireClubAccess(['Faculty Advisor']), eventCtrl.rejectEvent);
router.post('/clubs/:clubId/events/:eventId/publish', requireAuth, requireClubAccess(['President']), eventCtrl.publishEvent);
router.post('/clubs/:clubId/events/:eventId/complete', requireAuth, requireClubAccess(['President']), eventCtrl.completeEvent);

router.post('/events/:eventId/register', requireAuth, eventCtrl.registerForEvent);
router.get('/events/:eventId/qr', requireAuth, eventCtrl.getEventQr);
router.post('/events/:eventId/attendance', requireAuth, eventCtrl.markAttendance);
router.post('/events/:eventId/feedback', requireAuth, eventCtrl.submitFeedback);
router.get('/events/:eventId/feedback', requireAuth, eventCtrl.getFeedback);

router.get('/certificates/:id/download', requireAuth, eventCtrl.downloadCertificate);
router.get('/certificates/:code/verify', eventCtrl.verifyCertificate); // Public

/* ---------------------------------------------------------------
   5. TASKS, ANNOUNCEMENTS, NOTIFICATIONS & VOLUNTEERS
--------------------------------------------------------------- */
router.get('/clubs/:clubId/tasks', requireAuth, requireClubAccess(), actCtrl.listTasks);
router.post('/clubs/:clubId/tasks', requireAuth, requireClubAccess(['President']), actCtrl.createTaskValidation, validate, actCtrl.createTask);
router.patch('/clubs/:clubId/tasks/:taskId', requireAuth, actCtrl.updateTask);

router.get('/clubs/:clubId/announcements', requireAuth, requireClubAccess(), actCtrl.listAnnouncements);
router.post('/clubs/:clubId/announcements', requireAuth, requireClubAccess(['President', 'Faculty Advisor']), actCtrl.createAnnouncementValidation, validate, actCtrl.createAnnouncement);

router.get('/notifications', requireAuth, actCtrl.listNotifications);
router.patch('/notifications/:id/read', requireAuth, actCtrl.markNotificationRead);

router.post('/events/:eventId/volunteer', requireAuth, actCtrl.requestVolunteer);
router.patch('/volunteer/:id/decide', requireAuth, actCtrl.decideVolunteer);

/* ---------------------------------------------------------------
   6. DASHBOARDS, AUDIT & REPORTS
--------------------------------------------------------------- */
router.get('/dashboard', requireAuth, repCtrl.getDashboard);
router.get('/ticker', repCtrl.getTicker);
router.get('/audit', requireRole('superadmin'), repCtrl.listAudit);

// Reports
router.get('/reports/:type', requireAuth, (req, res, next) => {
  repCtrl.generateReport(req, res, req.params.type).catch(next);
});

module.exports = router;
