/**
 * KITT SQLite Database Management
 *
 * Handles database initialization and connection management.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'kitt.db');

let db = null;

/**
 * Initialize the database and create tables if they don't exist.
 * @returns {Database} The database instance
 */
function initDB() {
  if (db) return db;

  db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create messages table for conversation history
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
  `);

  // Create pending_updates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_updates (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target TEXT,
      value TEXT,
      submitted_by TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT,
      processed_at TEXT,
      edited_at TEXT,
      edited_by TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_updates_status ON pending_updates(status, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_updates_submitter ON pending_updates(submitted_by);
  `);

  console.log(`[DB] SQLite initialized: ${DB_PATH}`);
  return db;
}

/**
 * Get the database instance (initializes if needed).
 * @returns {Database} The database instance
 */
function getDB() {
  if (!db) {
    return initDB();
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
function closeDB() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database connection closed');
  }
}

/**
 * Get database statistics.
 * @returns {Object} Statistics about the database
 */
function getStats() {
  const database = getDB();

  const messageCount = database.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const activeUsers = database.prepare('SELECT COUNT(DISTINCT user_id) as count FROM messages').get().count;
  const updateCount = database.prepare('SELECT COUNT(*) as count FROM pending_updates').get().count;
  const pendingCount = database.prepare("SELECT COUNT(*) as count FROM pending_updates WHERE status = 'pending'").get().count;

  return {
    messages: messageCount,
    activeUsers: activeUsers,
    totalUpdates: updateCount,
    pendingUpdates: pendingCount,
    dbPath: DB_PATH
  };
}

module.exports = {
  initDB,
  getDB,
  closeDB,
  getStats
};
