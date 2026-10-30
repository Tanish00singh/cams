-- ================================================================
-- CAMS Database Schema
-- Club Activity Management System — NIT Trichy
-- ================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT    NOT NULL,
  system_role          TEXT    NOT NULL CHECK(system_role IN ('superadmin','president','advisor','member')),
  status               TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','locked')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ----------------------------------------------------------------
-- 2. CLUBS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clubs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT    NOT NULL UNIQUE,
  description            TEXT,
  objective              TEXT,
  category               TEXT    NOT NULL CHECK(category IN ('Technical','Cultural','Literary','Sports','Professional / Career','Social Service')),
  status                 TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_from_request_id INTEGER REFERENCES club_requests(id),
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- 3. CLUB MEMBERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS club_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  club_id    INTEGER NOT NULL REFERENCES clubs(id),
  club_role  TEXT    NOT NULL CHECK(club_role IN ('Faculty Advisor','President','Vice President','Coordinator','Core Member','Volunteer','General Member')),
  status     TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  joined_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, club_id)
);
CREATE INDEX IF NOT EXISTS idx_club_members_club ON club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id);

-- ----------------------------------------------------------------
-- 4. CLUB REQUESTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS club_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no        TEXT    NOT NULL UNIQUE,
  club_name         TEXT    NOT NULL,
  description       TEXT,
  objective         TEXT,
  category          TEXT    NOT NULL,
  proposed_advisor  TEXT,
  other_details     TEXT,
  requester_name    TEXT    NOT NULL,
  requester_email   TEXT    NOT NULL COLLATE NOCASE,
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','under_review','needs_info','approved','rejected')),
  remarks           TEXT,
  submitted_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at       TEXT,
  reviewed_by       INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON club_requests(status);

-- ----------------------------------------------------------------
-- 5. REQUEST DOCUMENTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES club_requests(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- 6. REQUEST CHECKLIST
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_checklist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES club_requests(id) ON DELETE CASCADE,
  item_key   TEXT    NOT NULL,
  checked    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_id, item_key)
);

-- ----------------------------------------------------------------
-- 7. EVENTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id      INTEGER NOT NULL REFERENCES clubs(id),
  title        TEXT    NOT NULL,
  description  TEXT,
  date_time    TEXT    NOT NULL,
  venue        TEXT,
  capacity     INTEGER,
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','published','completed','rejected')),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  approved_by  INTEGER REFERENCES users(id),
  approved_at  TEXT,
  reject_reason TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_club ON events(club_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- ----------------------------------------------------------------
-- 8. EVENT REGISTRATIONS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  registered_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

-- ----------------------------------------------------------------
-- 9. ATTENDANCE
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  INTEGER NOT NULL REFERENCES events(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  method    TEXT    NOT NULL DEFAULT 'manual' CHECK(method IN ('qr','manual')),
  marked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);

-- ----------------------------------------------------------------
-- 10. TASKS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER NOT NULL REFERENCES clubs(id),
  event_id    INTEGER REFERENCES events(id),
  title       TEXT    NOT NULL,
  assigned_to INTEGER REFERENCES users(id),
  due_date    TEXT,
  status      TEXT    NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','inprogress','done')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_club ON tasks(club_id);

-- ----------------------------------------------------------------
-- 11. VOLUNTEER REQUESTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volunteer_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  requested_at TEXT   NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT,
  decided_by  INTEGER REFERENCES users(id),
  UNIQUE(event_id, user_id)
);

-- ----------------------------------------------------------------
-- 12. ANNOUNCEMENTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id    INTEGER NOT NULL REFERENCES clubs(id),
  title      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  sent_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_club ON announcements(club_id);

-- ----------------------------------------------------------------
-- 13. NOTIFICATIONS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ----------------------------------------------------------------
-- 14. CERTIFICATES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  verify_code TEXT    NOT NULL UNIQUE,
  issued_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  pdf_path    TEXT,
  UNIQUE(event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id);

-- ----------------------------------------------------------------
-- 15. FEEDBACK
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  rating       INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment      TEXT,
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

-- ----------------------------------------------------------------
-- 16. AUDIT LOG
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id),
  actor_name TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  module     TEXT    NOT NULL,
  detail     TEXT,
  ip_address TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ----------------------------------------------------------------
-- 17. PASSWORD RESETS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
