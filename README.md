# Club Activity Management System (CAMS) — Full-Stack V2

An institutional portal built for NIT Trichy's Office of Student Affairs. CAMS streamlines registration of new clubs, tracking member activity, managing event lifecycles end-to-end, attendance recording via QR, certificate issuance, and institutional report generation.

---

## 1. Architecture & Tech Stack

```
Frontend (Vanilla HTML/CSS/JS)
         ↓ HTTP / REST API (JSON & Multipart)
Backend (Node.js + Express)
         ↓ Native sync connection
Database (SQLite / Node 24 native SQLite)
```

- **Backend:** Node.js + Express (Modular controllers, services, middleware)
- **Database:** SQLite (`/backend/data/cams.db`) with 17 normalized relational tables, WAL mode enabled, foreign keys enforced
- **Authentication & Security:** bcrypt password hashing (cost factor 10-12), HTTP-only cookies, Express sessions, Helmet security headers, Express Rate Limiting, input validation via `express-validator`
- **Document Generation:** `pdfkit` (Certificate & Report PDFs) + `exceljs` (Report spreadsheets)
- **Email Service:** `nodemailer` with built-in Ethereal preview fallback
- **Frontend:** Vanilla HTML5, CSS3, and JavaScript — preserved 100% pixel-matching existing look and feel with full backend wiring.

---

## 2. Project Directory Structure

```
cams/
├── frontend/
│   ├── index.html            # Reference UI wired with API client
│   └── assets/
│       ├── api.js            # Frontend REST API client
│       ├── app.js            # UI controller & dynamic data binding
│       ├── nitt-logo.png     # Logo asset
│       └── admin-block.JPG   # Hero background asset
├── backend/
│   ├── app.js                # Express application entrypoint
│   ├── schema.sql            # 17-table relational schema
│   ├── seed.js               # Database seed script matching demo data
│   ├── routes/
│   │   └── api.js            # REST API v1 routes
│   ├── controllers/
│   │   ├── authController.js     # Auth, session & password flows
│   │   ├── clubController.js     # Clubs directory & membership
│   │   ├── requestController.js  # Club creation requests & verification
│   │   ├── eventController.js    # Events lifecycle, QR & certificates
│   │   ├── activityController.js # Tasks, announcements & notifications
│   │   └── reportController.js   # Dashboards, audit log & 6 reports
│   ├── services/
│   │   ├── audit.js           # Institutional audit trail service
│   │   ├── mailer.js          # Email notifications service
│   │   └── documentService.js # PDF & Excel generator service
│   ├── middleware/
│   │   ├── auth.js            # requireAuth, requireRole, requireClubAccess
│   │   ├── errorHandler.js    # Centralized error handler
│   │   └── validate.js        # Input validation middleware
│   ├── tests/
│   │   └── api.test.js        # Integration & RBAC test suite
│   ├── uploads/               # Uploaded documents and certificates
│   └── data/                  # SQLite database location
├── .env.example
├── .gitignore
└── README.md
```

---

## 3. Quickstart & Local Setup

### Step 1: Install Dependencies
```bash
cd backend
npm install
```

### Step 2: Seed the Database
Populate all 17 tables with NIT Trichy institutional demo data:
```bash
node seed.js
```

### Step 3: Start the Application
```bash
node app.js
```
The portal is running at: **[http://localhost:3000](http://localhost:3000)**

---

## 4. Demo Login Credentials

| Role | Email | Password | Allowed Role Tab |
|---|---|---|---|
| **Super Admin** | `rekha.iyer@nitt.edu` | `Admin@1234` | Super Admin |
| **Club President** | `arjun.mehta@college.edu` | `Pres@1234` | Club President |
| **Faculty Advisor** | `r.sharma@college.edu` | `Adv@1234` | Faculty Advisor |
| **Member** | `priya.nair@college.edu` | `Mem@1234` | Member / Volunteer |

---

## 5. End-to-End Features Implemented

1. **Authentication & Role-Based Access Control:**
   - 4 role-tabs with server-side role validation. Mismatches are rejected.
   - Session restoration on page reload (`/api/v1/auth/me`).
   - Secure sign out, password change, and reset link generation.

2. **Public Club Creation Request & Admin Verification Queue:**
   - Public form with file attachment uploads (`/api/v1/requests`).
   - Automated running ID generation (e.g., `REQ-2026-00146`).
   - Super Admin verification checklist, Approve/Reject/Ask Info modal with automated credential emailing and account creation.

3. **Club Workspace & Role Permissions:**
   - **Members & Roles:** Live roster, add/invite members, role editing.
   - **Events Lifecycle:** Draft → Submitted → Approved (Faculty Advisor approval) → Published → Completed.
   - **Tasks Kanban:** Real To Do, In Progress, and Completed columns with status updates.
   - **Announcements:** Multi-channel dispatch (database, in-app notification & email).
   - **Notice Board Ticker:** Dynamic headlines populated from live database announcements.

4. **Attendance, QR Verification & Certificates:**
   - Real QR code generation for event attendance check-in.
   - Auto-generation of tamper-evident PDF certificates on event completion.
   - Public certificate verification endpoint (`/api/v1/certificates/:code/verify`).

5. **Institutional Reports (PDF & Excel):**
   - 6 full exportable reports: Club-wise, Event, Attendance, Member, Certificate, and Feedback.
   - Filtered by role (Super Admin sees institute-wide; President & Advisor see own club).

6. **Audit Trail:**
   - Every login, club verification, event approval, and report download is recorded with timestamp, user ID, module, and IP.

---

## 6. Running Automated Tests

Run the test suite verifying authentication, RBAC boundaries, validation, and document exports:
```bash
cd backend
node --test tests/api.test.js
```
All 9 test suites pass.
