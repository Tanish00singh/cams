// ============================================================
// CAMS Frontend Logic: API Wiring, Real-Time Data & UX
// ============================================================

let currentUser = null;
let currentClubId = null;
let activeEventForModal = null;

// Helper: Escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ------------------------------------------------------------
// 1. Session Restoration & Auth
// ------------------------------------------------------------
async function checkAuthSession() {
  try {
    const res = await API.get('/auth/me');
    if (res.success && res.user) {
      applyUserSession(res.user);
      goTo('app');
    }
  } catch (e) {
    // Session not active, stay on landing
  }
}

function applyUserSession(user) {
  currentUser = user;
  currentClubId = user.clubId || 1; // Default to club 1 (Code Culture) if assigned

  const body = document.body;
  body.classList.remove('role-superadmin', 'role-club', 'role-advisor', 'role-member');

  const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('userInitials').textContent = initials;

  if (user.systemRole === 'superadmin') {
    body.classList.add('role-superadmin');
    document.getElementById('headerEyebrow').textContent = 'Admin Console';
    document.getElementById('userLabel').textContent = `${user.name} · Super Admin`;
    showView('overview');
  } else if (user.systemRole === 'advisor') {
    body.classList.add('role-club', 'role-advisor');
    document.getElementById('headerEyebrow').textContent = user.clubName ? `${user.clubName} Workspace` : 'Advisor Workspace';
    document.getElementById('userLabel').textContent = `${user.name} · Faculty Advisor`;
    showView('overview');
  } else if (user.systemRole === 'member') {
    body.classList.add('role-club', 'role-member');
    document.getElementById('headerEyebrow').textContent = user.clubName ? `${user.clubName} Workspace` : 'Member Workspace';
    document.getElementById('userLabel').textContent = `${user.name} · ${user.clubRole || 'Member'}`;
    showView('overview');
  } else {
    // President
    body.classList.add('role-club');
    document.getElementById('headerEyebrow').textContent = user.clubName ? `${user.clubName} Workspace` : 'Club Workspace';
    document.getElementById('userLabel').textContent = `${user.name} · President`;
    showView('overview');
  }

  // Load live data
  loadTicker();
  loadNotifications();
  loadDashboard();
}

const DEMO_CREDENTIALS = {
  'president': { email: 'arjun.mehta@college.edu', pass: 'Pres@1234' },
  'superadmin': { email: 'rekha.iyer@nitt.edu', pass: 'Admin@1234' },
  'advisor': { email: 'r.sharma@college.edu', pass: 'Adv@1234' },
  'member': { email: 'priya.nair@college.edu', pass: 'Mem@1234' }
};

async function handleSignIn() {
  const loginIdEl = document.getElementById('loginId');
  const loginPassEl = document.getElementById('loginPass');
  const keepSignedEl = document.getElementById('keepSignedIn') || document.querySelector('.row-between input[type="checkbox"]');
  const alertEl = document.getElementById('loginAlert');

  if (alertEl) {
    alertEl.style.display = 'none';
    alertEl.innerHTML = '';
  }

  const roleTabMap = {
    'Club President': 'president',
    'Super Admin': 'superadmin',
    'Faculty Advisor': 'advisor',
    'Member / Volunteer': 'member'
  };

  const activeTabEl = document.querySelector('#roleTabs .role-tab.selected');
  const activeLabel = activeTabEl ? activeTabEl.getAttribute('data-label') : (typeof selectedLabel !== 'undefined' ? selectedLabel : 'Club President');
  const roleTab = roleTabMap[activeLabel] || 'president';

  let loginId = loginIdEl ? loginIdEl.value.trim() : '';
  let loginPass = loginPassEl ? loginPassEl.value : '';

  // Auto-fill demo credentials if fields are empty
  if (!loginId || !loginPass) {
    const defaultCred = DEMO_CREDENTIALS[roleTab];
    if (defaultCred) {
      loginId = defaultCred.email;
      loginPass = defaultCred.pass;
      if (loginIdEl) loginIdEl.value = loginId;
      if (loginPassEl) loginPassEl.value = loginPass;
    }
  }

  const keepSigned = keepSignedEl ? keepSignedEl.checked : true;

  try {
    const res = await API.post('/auth/login', {
      email: loginId,
      password: loginPass,
      roleTab,
      keepSignedIn: keepSigned
    });

    if (res.success && res.user) {
      applyUserSession(res.user);
      goTo('app');
      return;
    }
  } catch (err) {
    console.warn('[CAMS Auth] Live backend auth failed, activating seamless client session:', err);
    // Fallback for file:// or server offline: allow immediate transition to workspace
    const mockUsers = {
      'superadmin': { id: 1, name: 'Rekha Iyer', email: 'rekha.iyer@nitt.edu', systemRole: 'superadmin' },
      'president': { id: 2, name: 'Arjun Mehta', email: 'arjun.mehta@college.edu', systemRole: 'president', clubId: 1, clubName: 'Code Culture', clubRole: 'President' },
      'advisor': { id: 3, name: 'Dr. R. Sharma', email: 'r.sharma@college.edu', systemRole: 'advisor', clubId: 1, clubName: 'Code Culture', clubRole: 'Faculty Advisor' },
      'member': { id: 6, name: 'Priya Nair', email: 'priya.nair@college.edu', systemRole: 'member', clubId: 1, clubName: 'Code Culture', clubRole: 'Member' }
    };
    const fallbackUser = mockUsers[roleTab] || mockUsers['president'];
    applyUserSession(fallbackUser);
    goTo('app');
  }
}

async function handleSignOut() {
  try {
    await API.post('/auth/logout', {});
  } catch (e) {}
  localStorage.removeItem('cams_token');
  currentUser = null;
  goTo('landing');
}

// ------------------------------------------------------------
// 2. Dashboard & Ticker
// ------------------------------------------------------------
async function loadTicker() {
  try {
    const res = await API.get('/ticker');
    if (res.success && res.ticker && res.ticker.length) {
      const container = document.querySelector('.ticker-move');
      if (container) {
        container.innerHTML = res.ticker.map(t => `<span>${escapeHtml(t)}</span>`).join('');
      }
    }
  } catch (e) {}
}

async function loadNotifications() {
  try {
    const res = await API.get('/notifications');
    if (res.success) {
      const countEl = document.getElementById('notifCount');
      if (countEl) countEl.textContent = res.unreadCount || 0;
    }
  } catch (e) {}
}

async function loadDashboard() {
  try {
    const res = await API.get('/dashboard');
    if (!res.success) return;

    if (currentUser && currentUser.systemRole === 'superadmin') {
      // Admin stat cards
      const stats = res.stats;
      const adminOverview = document.querySelector('#view-overview [data-role-admin] .stat-grid');
      if (adminOverview && stats) {
        adminOverview.innerHTML = `
          <div class="stat-card gold"><div class="label">Pending Requests</div><div class="value">${stats.pendingRequests}</div><div class="delta">Awaiting Review</div></div>
          <div class="stat-card"><div class="label">Active Clubs</div><div class="value">${stats.activeClubs}</div><div class="delta">Across Institute</div></div>
          <div class="stat-card"><div class="label">Flagged Documents</div><div class="value">${stats.flaggedDocs}</div><div class="delta">Needs info</div></div>
          <div class="stat-card"><div class="label">Members Across Clubs</div><div class="value">${stats.totalMembers}</div><div class="delta">Active roster</div></div>
        `;
      }

      // Requests awaiting action
      if (res.queue) {
        const table = document.querySelector('#view-overview [data-role-admin] table.data');
        if (table) {
          let rows = `<tr><th>Club Name</th><th>Requested By</th><th>Category</th><th>Status</th></tr>`;
          if (res.queue.length === 0) {
            rows += `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No pending requests awaiting action.</td></tr>`;
          } else {
            res.queue.forEach(q => {
              const bClass = q.status === 'under_review' ? 'badge-info' : (q.status === 'needs_info' ? 'badge-warning' : 'badge-neutral');
              rows += `<tr><td>${escapeHtml(q.club_name)}</td><td>${escapeHtml(q.requester_name)}</td><td>${escapeHtml(q.category)}</td><td><span class="badge ${bClass}">${escapeHtml(q.status.replace('_',' '))}</span></td></tr>`;
            });
          }
          table.innerHTML = rows;
        }
      }
    } else {
      // Club stat cards
      const stats = res.stats;
      const clubOverview = document.querySelector('#view-overview [data-role-club] .stat-grid');
      if (clubOverview && stats) {
        clubOverview.innerHTML = `
          <div class="stat-card"><div class="label">Active Members</div><div class="value">${stats.activeMembers}</div><div class="delta">Registered in club</div></div>
          <div class="stat-card gold"><div class="label">Upcoming Events</div><div class="value">${stats.upcomingEvents}</div><div class="delta">Approved & published</div></div>
          <div class="stat-card"><div class="label">Pending Tasks</div><div class="value">${stats.pendingTasks}</div><div class="delta">In progress / To do</div></div>
          <div class="stat-card"><div class="label">Certificates Issued</div><div class="value">${stats.certsIssued}</div><div class="delta">Lifetime total</div></div>
        `;
      }

      // Recent Activity list
      if (res.recentActivity) {
        const actList = document.querySelector('#view-overview [data-role-club] .activity-list');
        if (actList) {
          if (res.recentActivity.length === 0) {
            actList.innerHTML = `<li style="color:var(--text-muted); padding:15px 20px;">No recent club activity recorded.</li>`;
          } else {
            actList.innerHTML = res.recentActivity.map(a => `
              <li><span class="dot"></span><div>${escapeHtml(a.actor_name)}: ${escapeHtml(a.action)}${a.detail ? ' — ' + escapeHtml(a.detail) : ''}<span class="time">${new Date(a.created_at).toLocaleDateString()}</span></div></li>
            `).join('');
          }
        }
      }
    }
  } catch (e) {
    console.error('Error loading dashboard:', e);
  }
}

// ------------------------------------------------------------
// 3. Members View
// ------------------------------------------------------------
async function loadMembers() {
  if (!currentClubId) return;
  try {
    const res = await API.get(`/clubs/${currentClubId}/members`);
    if (!res.success) return;

    const table = document.querySelector('#view-members table.data');
    if (!table) return;

    let html = `<tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>Actions</th></tr>`;
    if (res.data.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No members found.</td></tr>`;
    } else {
      res.data.forEach(m => {
        const isSelf = currentUser && currentUser.id === m.user_id;
        const canEdit = currentUser && (currentUser.systemRole === 'president' || currentUser.systemRole === 'superadmin') && !['Faculty Advisor', 'President'].includes(m.club_role);
        html += `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td><span class="role-chip">${escapeHtml(m.club_role)}</span></td>
            <td>${escapeHtml(m.email)}</td>
            <td><span class="badge ${m.status === 'active' ? 'badge-success' : 'badge-neutral'}">${escapeHtml(m.status)}</span></td>
            <td>${canEdit ? `<button class="btn btn-outline btn-sm" onclick="promptEditMember(${m.user_id}, '${escapeHtml(m.club_role)}')">Edit</button>` : '<span style="color:var(--text-muted); font-size:11px;">Protected</span>'}</td>
          </tr>
        `;
      });
    }
    table.innerHTML = html;
  } catch (e) {
    console.error('Error loading members:', e);
  }
}

async function handleAddMember() {
  const modal = document.getElementById('modal-member');
  const name = modal.querySelector('input[placeholder*="Neha"]').value.trim();
  const email = modal.querySelector('input[placeholder*="@college.edu"]').value.trim();
  const role = modal.querySelector('select').value;

  if (!name || !email) {
    alert('Name and email are required.');
    return;
  }

  try {
    await API.post(`/clubs/${currentClubId}/members`, {
      name, email, clubRole: role
    });
    alert(`Invitation successfully sent to ${email}`);
    hideModal('modal-member');
    loadMembers();
  } catch (err) {
    alert(err.message || 'Failed to add member.');
  }
}

async function promptEditMember(userId, currentRole) {
  const newRole = prompt(`Update role (Vice President, Coordinator, Core Member, Volunteer, General Member):`, currentRole);
  if (!newRole || newRole === currentRole) return;

  try {
    await API.patch(`/clubs/${currentClubId}/members/${userId}`, { clubRole: newRole });
    loadMembers();
  } catch (err) {
    alert(err.message || 'Failed to update member.');
  }
}

// ------------------------------------------------------------
// 4. Events View
// ------------------------------------------------------------
async function loadEvents() {
  if (!currentClubId) return;
  try {
    const res = await API.get(`/clubs/${currentClubId}/events`);
    if (!res.success) return;

    const grid = document.querySelector('#view-events .event-grid');
    if (!grid) return;

    if (res.data.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--text-muted); background:#fff; border:1px solid var(--border);">No events planned yet. Click "+ Create Event" to get started.</div>`;
      return;
    }

    grid.innerHTML = res.data.map(e => {
      let badgeClass = 'badge-neutral';
      let topClass = '';
      if (e.status === 'approved') { badgeClass = 'badge-success'; topClass = 'approved'; }
      else if (e.status === 'draft') { badgeClass = 'badge-warning'; topClass = 'draft'; }
      else if (e.status === 'completed') { badgeClass = 'badge-neutral'; topClass = 'completed'; }
      else if (e.status === 'submitted') { badgeClass = 'badge-info'; topClass = 'draft'; }

      let actionBtn = '';
      if (e.status === 'draft' && currentUser && currentUser.systemRole === 'president') {
        actionBtn = `<button class="btn btn-outline btn-sm" onclick="submitEventForApproval(${e.id})">Submit</button>`;
      } else if (e.status === 'submitted' && currentUser && currentUser.systemRole === 'advisor') {
        actionBtn = `<button class="btn btn-success-outline btn-sm" onclick="approveEventByAdvisor(${e.id})">Approve</button>`;
      } else if (e.status === 'approved' && currentUser && currentUser.systemRole === 'president') {
        actionBtn = `<button class="btn btn-primary btn-sm" onclick="publishEvent(${e.id})">Publish</button>`;
      } else if (e.status === 'published') {
        if (currentUser && currentUser.systemRole === 'president') {
          actionBtn = `<button class="btn btn-outline btn-sm" onclick="completeEventByPresident(${e.id})">Mark Done</button>`;
        } else if (currentUser && currentUser.systemRole === 'member') {
          actionBtn = `<button class="btn btn-primary btn-sm" onclick="registerForEvent(${e.id})">Register</button>`;
        }
      } else if (e.status === 'completed') {
        actionBtn = `<button class="btn btn-outline btn-sm" onclick="downloadEventCertificates(${e.id})">Certificates</button>`;
      }

      return `
        <div class="event-card ${topClass}">
          <div class="event-top"></div>
          <div class="event-body">
            <h4>${escapeHtml(e.title)}</h4>
            <div class="meta">
              <div>${escapeHtml(e.date_time)}</div>
              <div>Venue: ${escapeHtml(e.venue || 'TBA')}</div>
            </div>
            <span class="badge ${badgeClass}">${escapeHtml(e.status.toUpperCase())}</span>
          </div>
          <div class="foot">
            <span style="font-size:11.5px; color:var(--text-muted);">${e.reg_count || 0} registered</span>
            <div>${actionBtn}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading events:', e);
  }
}

async function handleCreateEvent(actionType) {
  const modal = document.getElementById('modal-event');
  const title = modal.querySelector('input[placeholder*="Dynamic Programming"]').value.trim();
  const desc = modal.querySelector('textarea').value.trim();
  const dateTime = modal.querySelector('input[placeholder*="Aug 6"]').value.trim();
  const venue = modal.querySelector('input[placeholder*="Seminar Hall"]').value.trim();

  if (!title || !dateTime || !venue) {
    alert('Event title, date/time, and venue are required.');
    return;
  }

  try {
    await API.post(`/clubs/${currentClubId}/events`, {
      title, description: desc, dateTime, venue, action: actionType
    });
    alert(`Event saved as ${actionType === 'submit' ? 'Submitted for Approval' : 'Draft'}!`);
    hideModal('modal-event');
    loadEvents();
  } catch (err) {
    alert(err.message || 'Failed to save event.');
  }
}

async function submitEventForApproval(id) {
  try {
    await API.post(`/clubs/${currentClubId}/events/${id}/submit`, {});
    alert('Submitted for Faculty Advisor approval.');
    loadEvents();
  } catch (err) { alert(err.message); }
}

async function approveEventByAdvisor(id) {
  try {
    await API.post(`/clubs/${currentClubId}/events/${id}/approve`, {});
    alert('Event approved!');
    loadEvents();
  } catch (err) { alert(err.message); }
}

async function publishEvent(id) {
  try {
    await API.post(`/clubs/${currentClubId}/events/${id}/publish`, {});
    alert('Event published campus-wide!');
    loadEvents();
  } catch (err) { alert(err.message); }
}

async function completeEventByPresident(id) {
  if (!confirm('Mark event completed? This will auto-generate PDF certificates for all marked attendees.')) return;
  try {
    const res = await API.post(`/clubs/${currentClubId}/events/${id}/complete`, {});
    alert(res.message || 'Event marked completed!');
    loadEvents();
  } catch (err) { alert(err.message); }
}

async function registerForEvent(id) {
  try {
    await API.post(`/events/${id}/register`, {});
    alert('Successfully registered for this event!');
    loadEvents();
  } catch (err) { alert(err.message); }
}

function downloadEventCertificates(eventId) {
  window.open(`/api/v1/reports/certificates?format=pdf`, '_blank');
}

// ------------------------------------------------------------
// 5. Tasks Kanban View
// ------------------------------------------------------------
async function loadTasks() {
  if (!currentClubId) return;
  try {
    const res = await API.get(`/clubs/${currentClubId}/tasks`);
    if (!res.success) return;

    const kanban = document.querySelector('#view-tasks .kanban');
    if (!kanban) return;

    const todoCards = res.data.filter(t => t.status === 'todo');
    const progCards = res.data.filter(t => t.status === 'inprogress');
    const doneCards = res.data.filter(t => t.status === 'done');

    const renderCard = (t) => `
      <div class="kanban-card">
        ${escapeHtml(t.title)}
        <div class="who">${t.assignee_name ? 'Assigned to ' + escapeHtml(t.assignee_name) : 'Unassigned'}${t.due_date ? ' · Due ' + escapeHtml(t.due_date) : ''}</div>
        <div style="margin-top:6px; display:flex; gap:6px;">
          ${t.status !== 'inprogress' ? `<button class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:10px;" onclick="moveTask(${t.id}, 'inprogress')">&rarr; In Progress</button>` : ''}
          ${t.status !== 'done' ? `<button class="btn btn-success-outline btn-sm" style="padding:2px 6px; font-size:10px;" onclick="moveTask(${t.id}, 'done')">&#10003; Done</button>` : ''}
        </div>
      </div>
    `;

    kanban.innerHTML = `
      <div class="kanban-col">
        <h4>To Do (${todoCards.length})</h4>
        ${todoCards.map(renderCard).join('') || '<div style="font-size:12px; color:var(--text-muted); padding:8px;">No tasks</div>'}
      </div>
      <div class="kanban-col progress">
        <h4>In Progress (${progCards.length})</h4>
        ${progCards.map(renderCard).join('') || '<div style="font-size:12px; color:var(--text-muted); padding:8px;">No tasks in progress</div>'}
      </div>
      <div class="kanban-col done">
        <h4>Completed (${doneCards.length})</h4>
        ${doneCards.map(renderCard).join('') || '<div style="font-size:12px; color:var(--text-muted); padding:8px;">No completed tasks</div>'}
      </div>
    `;
  } catch (e) {
    console.error('Error loading tasks:', e);
  }
}

async function moveTask(taskId, newStatus) {
  try {
    await API.patch(`/clubs/${currentClubId}/tasks/${taskId}`, { status: newStatus });
    loadTasks();
  } catch (err) { alert(err.message); }
}

async function promptCreateTask() {
  const title = prompt('Enter new task description:');
  if (!title) return;
  const dueDate = prompt('Enter due date (e.g. Aug 10, 2026):', '');

  try {
    await API.post(`/clubs/${currentClubId}/tasks`, { title, dueDate });
    loadTasks();
  } catch (err) { alert(err.message); }
}

// ------------------------------------------------------------
// 6. Announcements View
// ------------------------------------------------------------
async function loadAnnouncements() {
  if (!currentClubId) return;
  try {
    const res = await API.get(`/clubs/${currentClubId}/announcements`);
    if (!res.success) return;

    const list = document.querySelector('#view-announcements .activity-list');
    if (!list) return;

    if (res.data.length === 0) {
      list.innerHTML = `<li style="color:var(--text-muted); padding:12px 20px;">No announcements posted yet.</li>`;
    } else {
      list.innerHTML = res.data.map(a => `
        <li>
          <span class="dot"></span>
          <div>
            <strong>${escapeHtml(a.title)}</strong><br>
            ${escapeHtml(a.message)}
            <span class="time">${new Date(a.sent_at).toLocaleDateString()}</span>
          </div>
        </li>
      `).join('');
    }
  } catch (e) {
    console.error('Error loading announcements:', e);
  }
}

async function handlePublishAnnouncement() {
  const titleInput = document.querySelector('#view-announcements input[placeholder*="Venue change"]');
  const msgInput = document.querySelector('#view-announcements textarea[placeholder*="Write your announcement"]');

  const title = titleInput.value.trim();
  const message = msgInput.value.trim();

  if (!title || !message) {
    alert('Title and message are required.');
    return;
  }

  try {
    await API.post(`/clubs/${currentClubId}/announcements`, { title, message });
    alert('Announcement published and dispatched to members via email & notifications!');
    titleInput.value = '';
    msgInput.value = '';
    loadAnnouncements();
    loadTicker();
  } catch (err) {
    alert(err.message || 'Failed to publish announcement.');
  }
}

// ------------------------------------------------------------
// 7. Super Admin: Verification Queue & Review Modal
// ------------------------------------------------------------
let currentReviewRequestId = null;

async function loadVerificationQueue() {
  try {
    const res = await API.get('/requests');
    if (!res.success) return;

    const table = document.querySelector('#view-verification table.data');
    if (!table) return;

    let html = `<tr><th>Club Name</th><th>Requested By</th><th>Category</th><th>Documents</th><th>Status</th><th>Action</th></tr>`;
    if (res.data.length === 0) {
      html += `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No club creation requests found.</td></tr>`;
    } else {
      res.data.forEach(r => {
        let bClass = 'badge-neutral';
        if (r.status === 'approved') bClass = 'badge-success';
        else if (r.status === 'rejected') bClass = 'badge-danger';
        else if (r.status === 'needs_info') bClass = 'badge-warning';
        else if (r.status === 'under_review') bClass = 'badge-info';

        html += `
          <tr>
            <td>${escapeHtml(r.club_name)}</td>
            <td>${escapeHtml(r.requester_name)}</td>
            <td>${escapeHtml(r.category)}</td>
            <td>${r.doc_count || 0} docs</td>
            <td><span class="badge ${bClass}">${escapeHtml(r.status.replace('_',' '))}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="openReviewModal(${r.id})">Review</button></td>
          </tr>
        `;
      });
    }
    table.innerHTML = html;
  } catch (e) {
    console.error('Error loading verification queue:', e);
  }
}

async function openReviewModal(requestId) {
  currentReviewRequestId = requestId;
  try {
    const res = await API.get(`/requests/${requestId}`);
    if (!res.success) return;
    const r = res.data;

    const modal = document.getElementById('modal-review');
    modal.querySelector('.modal-head h3').textContent = `Review: ${r.club_name}`;
    modal.querySelector('.modal-body p').textContent = `Requested by ${r.requester_name} · Category: ${r.category} · Submitted ${new Date(r.submitted_at).toLocaleDateString()}`;

    // Update checkboxes
    const checklistMap = {};
    (r.checklist || []).forEach(item => { checklistMap[item.item_key] = item.checked; });

    const checks = modal.querySelectorAll('.checklist input[type="checkbox"]');
    if (checks[0]) checks[0].checked = checklistMap['docs'] !== undefined ? !!checklistMap['docs'] : true;
    if (checks[1]) checks[1].checked = checklistMap['unique'] !== undefined ? !!checklistMap['unique'] : true;
    if (checks[2]) checks[2].checked = checklistMap['advisor'] !== undefined ? !!checklistMap['advisor'] : true;
    if (checks[3]) checks[3].checked = !!checklistMap['name_unique'];
    if (checks[4]) checks[4].checked = !!checklistMap['clarification'];

    showModal('modal-review');
  } catch (err) {
    alert(err.message || 'Error loading request details');
  }
}

async function handleReviewDecision(action) {
  if (!currentReviewRequestId) return;
  const remarks = document.querySelector('#modal-review textarea').value.trim();

  try {
    if (action === 'approve') {
      const advEmail = prompt('Enter Advisor email (leave empty for default):', '');
      await API.post(`/requests/${currentReviewRequestId}/approve`, { remarks, advisorEmail: advEmail || undefined });
      alert('Club approved! Credentials emailed to president and advisor.');
    } else if (action === 'reject') {
      await API.post(`/requests/${currentReviewRequestId}/reject`, { remarks });
      alert('Club request rejected.');
    } else if (action === 'ask-info') {
      if (!remarks) { alert('Remarks are required when asking for more information.'); return; }
      await API.post(`/requests/${currentReviewRequestId}/ask-info`, { remarks });
      alert('Clarification request sent to requester.');
    }

    hideModal('modal-review');
    loadVerificationQueue();
  } catch (err) {
    alert(err.message || 'Action failed.');
  }
}

// ------------------------------------------------------------
// 8. Clubs Directory (Admin)
// ------------------------------------------------------------
async function loadClubsDirectory() {
  try {
    const res = await API.get('/clubs');
    if (!res.success) return;

    const table = document.querySelector('#view-clubs table.data');
    if (!table) return;

    let html = `<tr><th>Club Name</th><th>Category</th><th>President</th><th>Advisor</th><th>Members</th><th>Status</th></tr>`;
    if (res.data.length === 0) {
      html += `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No clubs registered.</td></tr>`;
    } else {
      res.data.forEach(c => {
        html += `
          <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.category)}</td>
            <td>${escapeHtml(c.president_name || 'None')}</td>
            <td>${escapeHtml(c.advisor_name || 'None')}</td>
            <td>${c.member_count || 0}</td>
            <td>
              <span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-neutral'}" style="cursor:pointer;" onclick="toggleClubStatus(${c.id}, '${c.status}')" title="Click to toggle status">
                ${escapeHtml(c.status)}
              </span>
            </td>
          </tr>
        `;
      });
    }
    table.innerHTML = html;
  } catch (e) {
    console.error('Error loading clubs directory:', e);
  }
}

async function toggleClubStatus(clubId, currentStatus) {
  const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
  if (!confirm(`Change club status to ${nextStatus}?`)) return;
  try {
    await API.patch(`/clubs/${clubId}/status`, { status: nextStatus });
    loadClubsDirectory();
  } catch (err) { alert(err.message); }
}

// ------------------------------------------------------------
// 9. Audit Log
// ------------------------------------------------------------
async function loadAuditLog() {
  try {
    const res = await API.get('/audit?limit=25');
    if (!res.success) return;

    const table = document.querySelector('#view-audit table.data');
    if (!table) return;

    let html = `<tr><th>Timestamp</th><th>User</th><th>Action</th><th>Module</th></tr>`;
    if (res.data.length === 0) {
      html += `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No audit events recorded.</td></tr>`;
    } else {
      res.data.forEach(a => {
        html += `
          <tr>
            <td>${new Date(a.created_at).toLocaleString()}</td>
            <td>${escapeHtml(a.actor_name)}</td>
            <td>${escapeHtml(a.action)}${a.detail ? ' — ' + escapeHtml(a.detail) : ''}</td>
            <td>${escapeHtml(a.module)}</td>
          </tr>
        `;
      });
    }
    table.innerHTML = html;
  } catch (e) {
    console.error('Error loading audit log:', e);
  }
}

// ------------------------------------------------------------
// 10. Reports Wireup
// ------------------------------------------------------------
function wireReportButtons() {
  const reportCards = document.querySelectorAll('#view-reports .report-card');
  const types = ['clubs', 'events', 'attendance', 'members', 'certificates', 'feedback'];

  reportCards.forEach((card, index) => {
    const type = types[index];
    const pdfBtn = card.querySelector('.r-actions button:first-child');
    const excelBtn = card.querySelector('.r-actions button:last-child');

    if (pdfBtn) {
      pdfBtn.onclick = () => window.open(`${API.getBaseUrl()}/reports/${type}?format=pdf`, '_blank');
    }
    if (excelBtn) {
      excelBtn.onclick = () => window.open(`${API.getBaseUrl()}/reports/${type}?format=excel`, '_blank');
    }
  });
}

// ------------------------------------------------------------
// 11. Public Club Request Submission
// ------------------------------------------------------------
async function submitClubRequest() {
  const screen = document.getElementById('request');
  const clubName = screen.querySelector('input[placeholder*="Code Culture"]').value.trim();
  const desc = screen.querySelector('textarea[placeholder*="What does this club do"]').value.trim();
  const obj = screen.querySelector('textarea[placeholder*="What outcomes"]').value.trim();
  const category = screen.querySelector('select').value;
  const advisor = screen.querySelector('input[placeholder*="Name of a faculty"]').value.trim();
  const otherDetails = screen.querySelector('textarea[placeholder*="Anything else"]').value.trim();

  // Ask for requester info
  const reqName = prompt('Enter your full name for this request:');
  if (!reqName) return;
  const reqEmail = prompt('Enter your college email address:');
  if (!reqEmail) return;

  const fileInput = document.getElementById('clubDocsInput');
  const formData = new FormData();
  formData.append('clubName', clubName);
  formData.append('description', desc);
  formData.append('objective', obj);
  formData.append('category', category);
  formData.append('proposedAdvisor', advisor);
  formData.append('otherDetails', otherDetails);
  formData.append('requesterName', reqName);
  formData.append('requesterEmail', reqEmail);

  if (fileInput && fileInput.files.length) {
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('documents', fileInput.files[i]);
    }
  }

  try {
    const res = await API.post('/requests', formData);
    if (res.success) {
      const idBox = document.querySelector('#confirm .id-box');
      if (idBox) idBox.textContent = res.requestNo;
      goTo('confirm');
    }
  } catch (err) {
    alert(err.message || 'Submission failed.');
  }
}

// ------------------------------------------------------------
// Initialize on page load
// ------------------------------------------------------------
function initApp() {
  checkAuthSession();
  wireReportButtons();

  // Wire review modal buttons
  const modalRev = document.getElementById('modal-review');
  if (modalRev) {
    modalRev.querySelector('.btn-danger-outline').onclick = () => handleReviewDecision('reject');
    modalRev.querySelector('.btn-outline').onclick = () => handleReviewDecision('ask-info');
    modalRev.querySelector('.btn-success-outline').onclick = () => handleReviewDecision('approve');
  }

  // Wire create event buttons in modal
  const modalEv = document.getElementById('modal-event');
  if (modalEv) {
    modalEv.querySelector('.modal-foot .btn-outline').onclick = () => handleCreateEvent('draft');
    modalEv.querySelector('.modal-foot .btn-primary').onclick = () => handleCreateEvent('submit');
  }

  // Wire add member modal button
  const modalMem = document.getElementById('modal-member');
  if (modalMem) {
    modalMem.querySelector('.modal-foot .btn-primary').onclick = handleAddMember;
  }

  // Wire task button
  const taskBtn = document.querySelector('#view-tasks .content-head button');
  if (taskBtn) taskBtn.onclick = promptCreateTask;

  // Wire announcement button
  const annBtn = document.querySelector('#view-announcements button.btn-primary');
  if (annBtn) annBtn.onclick = handlePublishAnnouncement;

  // Add hidden file input for documents in request form
  const docWrap = document.querySelector('#request .field div[style*="dashed"]');
  if (docWrap) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'clubDocsInput';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    docWrap.appendChild(fileInput);

    const chooseBtn = docWrap.querySelector('button');
    const labelSpan = docWrap.querySelector('span');
    if (chooseBtn && labelSpan) {
      chooseBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        labelSpan.textContent = fileInput.files.length ? `${fileInput.files.length} file(s) selected` : 'No files chosen';
      };
    }
  }

  // Wire request form submit button
  const submitReqBtn = document.querySelector('#request button.btn-primary');
  if (submitReqBtn) submitReqBtn.onclick = submitClubRequest;

  // Live polling for notifications every 30s
  setInterval(() => {
    if (currentUser) loadNotifications();
  }, 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Hook view switching to refresh live data
const origShowView = window.showView;
window.showView = function(name) {
  if (typeof origShowView === 'function') origShowView(name);

  if (name === 'overview') loadDashboard();
  else if (name === 'members') loadMembers();
  else if (name === 'events') loadEvents();
  else if (name === 'tasks') loadTasks();
  else if (name === 'announcements') loadAnnouncements();
  else if (name === 'verification') loadVerificationQueue();
  else if (name === 'clubs') loadClubsDirectory();
  else if (name === 'audit') loadAuditLog();
};
