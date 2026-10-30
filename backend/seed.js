'use strict';
const { DbWrapper } = require('./models/db');
const bcrypt   = require('bcrypt');
const path     = require('path');
const fs       = require('fs');

const DB_PATH     = path.join(__dirname, 'data', 'cams.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Wipe and recreate for clean seed
if (fs.existsSync(DB_PATH)) {
  try { fs.unlinkSync(DB_PATH); } catch(e){}
}

const db = new DbWrapper(DB_PATH);
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

const SALT_ROUNDS = 10;

async function seed() {
  const users = [
    { name: 'Rekha Iyer',      email: 'rekha.iyer@nitt.edu',          password: 'Admin@1234',  system_role: 'superadmin' },
    { name: 'Arjun Mehta',     email: 'arjun.mehta@college.edu',       password: 'Pres@1234',   system_role: 'president'  },
    { name: 'Dr. R. Sharma',   email: 'r.sharma@college.edu',          password: 'Adv@1234',    system_role: 'advisor'    },
    { name: 'Sneha Kulkarni',  email: 'sneha.k@college.edu',           password: 'Mem@1234',    system_role: 'member'     },
    { name: 'Rohan Gupta',     email: 'rohan.g@college.edu',           password: 'Mem@1234',    system_role: 'member'     },
    { name: 'Priya Nair',      email: 'priya.nair@college.edu',        password: 'Mem@1234',    system_role: 'member'     },
    { name: 'Karthik S',       email: 'karthik.s@college.edu',         password: 'Mem@1234',    system_role: 'member'     },
    { name: 'Fatima Sheikh',   email: 'fatima.sheikh@college.edu',     password: 'Mem@1234',    system_role: 'member'     },
    { name: 'Dr. M. Iyer',    email: 'm.iyer@college.edu',            password: 'Adv@1234',    system_role: 'advisor'    },
    { name: 'Dr. N. Menon',   email: 'n.menon@college.edu',           password: 'Adv@1234',    system_role: 'advisor'    },
    { name: 'Dr. P. Verma',   email: 'p.verma@college.edu',           password: 'Adv@1234',    system_role: 'advisor'    },
    { name: 'Karthik S',      email: 'karthik.robotics@college.edu',  password: 'Pres@1234',   system_role: 'president'  },
    { name: 'Rohan Gupta',    email: 'rohan.finance@college.edu',     password: 'Pres@1234',   system_role: 'president'  },
    { name: 'Ananya Das',     email: 'ananya.drama@college.edu',      password: 'Pres@1234',   system_role: 'president'  },
    { name: 'Divya Rao',      email: 'divya.rao@college.edu',         password: 'Mem@1234',    system_role: 'member'     },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, system_role, status)
    VALUES (?, ?, ?, ?, 'active')
  `);

  const userIds = {};
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
    const info = insertUser.run(u.name, u.email, hash, u.system_role);
    userIds[u.email] = info.lastInsertRowid;
  }

  // Clubs
  const insertClub = db.prepare(`
    INSERT INTO clubs (name, description, objective, category, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const clubs = [
    { name: 'Code Culture',                description: 'Competitive programming and software development club', objective: 'Foster algorithmic thinking and competitive coding culture', category: 'Technical',            status: 'active'   },
    { name: 'Robotics & Automation Club',  description: 'Building and programming autonomous robots',           objective: 'Develop hands-on robotics and automation skills',          category: 'Technical',            status: 'active'   },
    { name: 'Finance & Investment Cell',   description: 'Financial literacy and investment strategies',          objective: 'Build financial acumen among students',                    category: 'Professional / Career', status: 'active'   },
    { name: 'Drama Circle',                description: 'Theatre, acting and performing arts club',              objective: 'Promote performing arts on campus',                        category: 'Cultural',             status: 'inactive' },
  ];

  const clubIds = {};
  for (const c of clubs) {
    const info = insertClub.run(c.name, c.description, c.objective, c.category, c.status);
    clubIds[c.name] = info.lastInsertRowid;
  }

  // Members
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO club_members (user_id, club_id, club_role, status)
    VALUES (?, ?, ?, ?)
  `);

  const ccId = clubIds['Code Culture'];
  const members = [
    { user_id: userIds['r.sharma@college.edu'],       club_id: ccId, club_role: 'Faculty Advisor', status: 'active'   },
    { user_id: userIds['arjun.mehta@college.edu'],    club_id: ccId, club_role: 'President',        status: 'active'   },
    { user_id: userIds['sneha.k@college.edu'],         club_id: ccId, club_role: 'Vice President',   status: 'active'   },
    { user_id: userIds['rohan.g@college.edu'],         club_id: ccId, club_role: 'Coordinator',      status: 'active'   },
    { user_id: userIds['priya.nair@college.edu'],      club_id: ccId, club_role: 'Core Member',      status: 'active'   },
    { user_id: userIds['karthik.s@college.edu'],       club_id: ccId, club_role: 'Volunteer',        status: 'inactive' },
    { user_id: userIds['fatima.sheikh@college.edu'],   club_id: ccId, club_role: 'General Member',   status: 'active'   },
    { user_id: userIds['divya.rao@college.edu'],       club_id: ccId, club_role: 'Core Member',      status: 'active'   },
  ];

  for (const m of members) insertMember.run(m.user_id, m.club_id, m.club_role, m.status);

  // Robotics
  const robId = clubIds['Robotics & Automation Club'];
  insertMember.run(userIds['m.iyer@college.edu'], robId, 'Faculty Advisor', 'active');
  insertMember.run(userIds['karthik.robotics@college.edu'], robId, 'President', 'active');

  // Finance
  const finId = clubIds['Finance & Investment Cell'];
  insertMember.run(userIds['n.menon@college.edu'], finId, 'Faculty Advisor', 'active');
  insertMember.run(userIds['rohan.finance@college.edu'], finId, 'President', 'active');

  // Requests
  const insertRequest = db.prepare(`
    INSERT INTO club_requests
      (request_no, club_name, description, category, proposed_advisor, requester_name, requester_email, status, submitted_at, remarks)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const requests = [
    { request_no: 'REQ-2026-00141', club_name: 'Code Culture',                description: 'Competitive programming', category: 'Technical',            proposed_advisor: 'Dr. R. Sharma', requester_name: 'Arjun Mehta',   requester_email: 'arjun.mehta@college.edu',     status: 'under_review', submitted_at: '2026-07-26T10:00:00', remarks: null },
    { request_no: 'REQ-2026-00142', club_name: 'Wildlife Photography Society', description: 'Nature photography',     category: 'Cultural',             proposed_advisor: 'Dr. K. Pillai', requester_name: 'Divya Rao',     requester_email: 'divya.rao@college.edu',        status: 'needs_info',   submitted_at: '2026-07-24T14:30:00', remarks: 'Please attach signed advisor consent form.' },
    { request_no: 'REQ-2026-00143', club_name: 'Robotics & Automation Club',   description: 'Robotics and automation',category: 'Technical',            proposed_advisor: 'Dr. M. Iyer',   requester_name: 'Karthik S',     requester_email: 'karthik.robotics@college.edu', status: 'pending',      submitted_at: '2026-07-22T09:00:00', remarks: null },
    { request_no: 'REQ-2026-00144', club_name: 'Debate & Literary Forum',      description: 'Literary and debates',  category: 'Literary',             proposed_advisor: 'Dr. J. Nair',   requester_name: 'Fatima Sheikh', requester_email: 'fatima.sheikh@college.edu',    status: 'rejected',     submitted_at: '2026-07-15T11:00:00', remarks: 'Duplicate — Literary Society already active.' },
    { request_no: 'REQ-2026-00145', club_name: 'Finance & Investment Cell',    description: 'Finance & investing',   category: 'Professional / Career', proposed_advisor: 'Dr. N. Menon', requester_name: 'Rohan Gupta',   requester_email: 'rohan.finance@college.edu',    status: 'approved',     submitted_at: '2026-07-10T08:00:00', remarks: null },
  ];

  for (const r of requests) {
    insertRequest.run(r.request_no, r.club_name, r.description, r.category, r.proposed_advisor, r.requester_name, r.requester_email, r.status, r.submitted_at, r.remarks);
  }

  // Events
  const presidentId = userIds['arjun.mehta@college.edu'];
  const advisorId   = userIds['r.sharma@college.edu'];

  const insertEvent = db.prepare(`
    INSERT INTO events (club_id, title, description, date_time, venue, capacity, status, created_by, submitted_at, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const eventsData = [
    { club_id: ccId, title: 'Weekly Contest #42',    description: 'Competitive programming contest', date_time: '2026-08-01T18:00:00', venue: 'Lab Complex, Room 204', capacity: 60,  status: 'draft',      created_by: presidentId, submitted_at: null,                approved_by: null,       approved_at: null               },
    { club_id: ccId, title: 'Intro to DSA Workshop', description: 'Data Structures and Algorithms workshop for beginners', date_time: '2026-08-03T16:00:00', venue: 'Seminar Hall B', capacity: 80,  status: 'approved',   created_by: presidentId, submitted_at: '2026-07-20T10:00:00', approved_by: advisorId, approved_at: '2026-07-22T09:00:00' },
    { club_id: ccId, title: 'Annual Hackathon 2026', description: '24-hour hackathon open to all departments', date_time: '2026-08-15T09:00:00', venue: 'Main Auditorium',   capacity: 200, status: 'approved',   created_by: presidentId, submitted_at: '2026-07-18T10:00:00', approved_by: advisorId, approved_at: '2026-07-25T14:00:00' },
    { club_id: ccId, title: 'Git & GitHub Bootcamp', description: 'Hands-on session on version control using Git and GitHub', date_time: '2026-07-27T10:00:00', venue: 'Lab Complex, Room 108', capacity: 50, status: 'completed',  created_by: presidentId, submitted_at: '2026-07-10T10:00:00', approved_by: advisorId, approved_at: '2026-07-12T09:00:00' },
  ];

  const eventIds = {};
  for (const e of eventsData) {
    const info = insertEvent.run(e.club_id, e.title, e.description, e.date_time, e.venue, e.capacity, e.status, e.created_by, e.submitted_at, e.approved_by, e.approved_at);
    eventIds[e.title] = info.lastInsertRowid;
  }

  // Registrations & Attendance
  const insertReg = db.prepare(`INSERT OR IGNORE INTO event_registrations (event_id, user_id) VALUES (?, ?)`);
  const allMemberIds = [
    userIds['arjun.mehta@college.edu'], userIds['sneha.k@college.edu'],
    userIds['rohan.g@college.edu'], userIds['priya.nair@college.edu'],
    userIds['fatima.sheikh@college.edu'], userIds['divya.rao@college.edu'],
  ];

  allMemberIds.forEach(uid => {
    insertReg.run(eventIds['Intro to DSA Workshop'], uid);
    insertReg.run(eventIds['Annual Hackathon 2026'], uid);
    insertReg.run(eventIds['Git & GitHub Bootcamp'], uid);
  });

  const insertAtt = db.prepare(`INSERT OR IGNORE INTO attendance (event_id, user_id, method) VALUES (?, ?, 'manual')`);
  allMemberIds.forEach(uid => insertAtt.run(eventIds['Git & GitHub Bootcamp'], uid));

  // Tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (club_id, event_id, title, assigned_to, due_date, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tasks = [
    { club_id: ccId, event_id: eventIds['Annual Hackathon 2026'], title: 'Book auditorium for Hackathon 2026', assigned_to: userIds['rohan.g@college.edu'],       due_date: '2026-08-05', status: 'todo',       created_by: presidentId },
    { club_id: ccId, event_id: eventIds['Annual Hackathon 2026'], title: 'Design certificate template',         assigned_to: userIds['priya.nair@college.edu'],     due_date: '2026-08-08', status: 'todo',       created_by: presidentId },
    { club_id: ccId, event_id: eventIds['Annual Hackathon 2026'], title: 'Send sponsor outreach emails',         assigned_to: userIds['sneha.k@college.edu'],        due_date: '2026-08-02', status: 'inprogress', created_by: presidentId },
    { club_id: ccId, event_id: eventIds['Intro to DSA Workshop'], title: 'Set up QR attendance for workshop',   assigned_to: userIds['karthik.s@college.edu'],      due_date: '2026-07-31', status: 'inprogress', created_by: presidentId },
    { club_id: ccId, event_id: eventIds['Intro to DSA Workshop'], title: 'Finalize workshop speaker list',      assigned_to: userIds['arjun.mehta@college.edu'],    due_date: '2026-07-20', status: 'done',       created_by: presidentId },
    { club_id: ccId, event_id: eventIds['Intro to DSA Workshop'], title: 'Publish event on portal',             assigned_to: userIds['fatima.sheikh@college.edu'],  due_date: '2026-07-21', status: 'done',       created_by: presidentId },
  ];

  for (const t of tasks) insertTask.run(t.club_id, t.event_id, t.title, t.assigned_to, t.due_date, t.status, t.created_by);

  // Announcements
  const insertAnn = db.prepare(`
    INSERT INTO announcements (club_id, title, message, created_by, sent_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertAnn.run(ccId, 'Weekly Contest #42 rescheduled', 'The contest has been rescheduled to 6:00 PM on Aug 1.', presidentId, '2026-07-28T14:00:00');
  insertAnn.run(ccId, 'Hackathon 2026 registrations open', 'Register now for Annual Hackathon 2026 at Main Auditorium.', presidentId, '2026-07-24T10:00:00');
  insertAnn.run(ccId, 'Bootcamp feedback reminder', 'Please submit your feedback for Git & GitHub Bootcamp.', presidentId, '2026-07-27T18:00:00');

  // Notifications
  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertNotif.run(presidentId, 'event_approved', 'Event Approved', 'Intro to DSA Workshop has been approved by Dr. R. Sharma.', 0, '2026-07-22T09:05:00');
  insertNotif.run(presidentId, 'event_approved', 'Event Approved', 'Annual Hackathon 2026 has been approved by Dr. R. Sharma.', 0, '2026-07-25T14:05:00');
  insertNotif.run(presidentId, 'volunteer_request', 'New Volunteer Request', 'Priya Nair requested to volunteer for Annual Hackathon 2026.', 0, '2026-07-29T18:40:00');

  // Audit Log
  const insertAudit = db.prepare(`
    INSERT INTO audit_log (actor_id, actor_name, action, module, detail, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const superAdminId = userIds['rekha.iyer@nitt.edu'];
  insertAudit.run(superAdminId, 'Rekha Iyer', 'Approved club request REQ-2026-00145', 'Verification', 'Finance & Investment Cell approved and onboarded', '127.0.0.1', '2026-07-29T09:12:00');
  insertAudit.run(presidentId, 'Arjun Mehta', 'Created event "Weekly Contest #42"', 'Events', 'Event saved as draft', '127.0.0.1', '2026-07-28T18:40:00');
  insertAudit.run(superAdminId, 'Rekha Iyer', 'Requested more info on REQ-0142', 'Verification', 'Asked for signed advisor consent form', '127.0.0.1', '2026-07-28T14:02:00');
  insertAudit.run(userIds['divya.rao@college.edu'], 'Divya Rao', 'Marked attendance (34 present)', 'Attendance', 'Git & GitHub Bootcamp — manual marking', '127.0.0.1', '2026-07-27T11:15:00');

  db.close();
  console.log('\n======================================================');
  console.log('  CAMS Database Initialized and Seeded Successfully!');
  console.log('======================================================');
  console.log('Demo Accounts:');
  console.log('1. Super Admin:     rekha.iyer@nitt.edu     / Admin@1234');
  console.log('2. Club President:  arjun.mehta@college.edu / Pres@1234');
  console.log('3. Faculty Advisor: r.sharma@college.edu    / Adv@1234');
  console.log('4. Member:          priya.nair@college.edu  / Mem@1234');
  console.log('======================================================\n');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
