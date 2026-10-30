'use strict';
const { getDb } = require('../models/db');

/**
 * Write to audit_log. Non-fatal — never throws.
 */
function log(actorId, actorName, action, module, detail = null, ip = null) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (actor_id, actor_name, action, module, detail, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actorId || null, actorName || 'System', action, module, detail, ip || null);
  } catch (err) {
    console.error('[Audit] Failed to write log:', err.message);
  }
}

module.exports = { log };
