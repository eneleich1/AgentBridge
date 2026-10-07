const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { DATA_DIR } = require("../utils/runtimeConfig");

let database;

function getDatabase() {
  if (!database) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    database = new Database(path.join(DATA_DIR, "auth-sessions.sqlite"));
    database.pragma("journal_mode = WAL");
    database.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      last_activity_at INTEGER NOT NULL
    )`);
  }
  return database;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function get(token) {
  return getDatabase().prepare("SELECT last_activity_at FROM auth_sessions WHERE token_hash = ?")
    .get(tokenHash(token))?.last_activity_at;
}

function set(token, lastActivityAt) {
  getDatabase().prepare(`INSERT INTO auth_sessions (token_hash, last_activity_at) VALUES (?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET last_activity_at = excluded.last_activity_at`)
    .run(tokenHash(token), lastActivityAt);
}

function remove(token) {
  getDatabase().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
}

function clear() {
  getDatabase().prepare("DELETE FROM auth_sessions").run();
}

function close() {
  database?.close();
  database = undefined;
}

module.exports = { get, set, delete: remove, clear, close };
