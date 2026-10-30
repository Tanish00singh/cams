'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'cams.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

let _db;

/**
 * Adapter wrapping DatabaseSync to provide seamless .prepare().all(), .get(), .run()
 * compatible with standard better-sqlite3 API used across our code.
 */
class DbWrapper {
  constructor(filePath) {
    this.rawDb = new DatabaseSync(filePath);
  }

  exec(sql) {
    return this.rawDb.exec(sql);
  }

  pragma(cmd) {
    try {
      return this.rawDb.exec(`PRAGMA ${cmd};`);
    } catch (e) {
      // Ignored if unsupported
    }
  }

  close() {
    return this.rawDb.close();
  }

  prepare(sql) {
    // If SQL uses @name parameters, replace with :name or ? for DatabaseSync if needed,
    // or adapt params
    const stmt = this.rawDb.prepare(sql);

    return {
      all: (...args) => {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = [args[0]];
        }
        return stmt.all(...params);
      },
      get: (...args) => {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = [args[0]];
        }
        return stmt.get(...params);
      },
      run: (...args) => {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = [args[0]];
        }
        const res = stmt.run(...params);
        return {
          changes: res.changes,
          lastInsertRowid: res.lastInsertRowid
        };
      }
    };
  }
}

function getDb() {
  if (!_db) {
    const fresh = !fs.existsSync(DB_PATH);
    _db = new DbWrapper(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    if (fresh) {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      _db.exec(schema);
    }
  }
  return _db;
}

module.exports = { getDb, DbWrapper };
