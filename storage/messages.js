/**
 * Messages Storage for KITT Relay Feature
 *
 * Stores messages that team members want to relay to Lman.
 * Part of the "Personal PM" feature set.
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Use shared Dropbox path for MAGI access
const DB_PATH = path.join(
  process.env.HOME,
  'Dropbox/PKM-Vault/.ai-butler-system/kitt-memory/memory.db'
);

let db = null;

/**
 * Initialize database and create messages table
 */
function initDB() {
  if (db) return db;

  db = new Database(DB_PATH);

  // Create messages table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_messages (
      id TEXT PRIMARY KEY,
      from_user TEXT NOT NULL,
      from_user_name TEXT,
      message TEXT NOT NULL,
      channel TEXT,
      channel_name TEXT,
      thread_ts TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME,
      replied_at DATETIME,
      reply_text TEXT
    )
  `);

  console.log('[Messages] Database initialized');
  return db;
}

/**
 * Generate a unique message ID
 */
function generateId() {
  return 'MSG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Create a new relay message
 */
function createMessage({ fromUser, fromUserName, message, channel, channelName, threadTs }) {
  const db = initDB();
  const id = generateId();

  const stmt = db.prepare(`
    INSERT INTO relay_messages (id, from_user, from_user_name, message, channel, channel_name, thread_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, fromUser, fromUserName, message, channel, channelName, threadTs);
  console.log(`[Messages] Created relay message ${id} from ${fromUserName}`);

  return { id, fromUser, fromUserName, message, channel, channelName, threadTs };
}

/**
 * Get a message by ID
 */
function getMessage(id) {
  const db = initDB();
  const stmt = db.prepare('SELECT * FROM relay_messages WHERE id = ?');
  return stmt.get(id);
}

/**
 * Mark message as read
 */
function markAsRead(id) {
  const db = initDB();
  const stmt = db.prepare(`
    UPDATE relay_messages
    SET status = 'read', read_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(id);
  console.log(`[Messages] Marked ${id} as read`);
}

/**
 * Mark message as replied
 */
function markAsReplied(id, replyText) {
  const db = initDB();
  const stmt = db.prepare(`
    UPDATE relay_messages
    SET status = 'replied', replied_at = CURRENT_TIMESTAMP, reply_text = ?
    WHERE id = ?
  `);
  stmt.run(replyText, id);
  console.log(`[Messages] Marked ${id} as replied`);
}

/**
 * Get pending messages (not yet read)
 */
function getPendingMessages() {
  const db = initDB();
  const stmt = db.prepare(`
    SELECT * FROM relay_messages
    WHERE status = 'pending'
    ORDER BY created_at DESC
  `);
  return stmt.all();
}

/**
 * Get recent messages (last 7 days)
 */
function getRecentMessages(limit = 20) {
  const db = initDB();
  const stmt = db.prepare(`
    SELECT * FROM relay_messages
    WHERE created_at > datetime('now', '-7 days')
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

/**
 * Get message statistics
 */
function getStats() {
  const db = initDB();

  const total = db.prepare('SELECT COUNT(*) as count FROM relay_messages').get().count;
  const pending = db.prepare("SELECT COUNT(*) as count FROM relay_messages WHERE status = 'pending'").get().count;
  const read = db.prepare("SELECT COUNT(*) as count FROM relay_messages WHERE status = 'read'").get().count;
  const replied = db.prepare("SELECT COUNT(*) as count FROM relay_messages WHERE status = 'replied'").get().count;

  return { total, pending, read, replied };
}

module.exports = {
  initDB,
  createMessage,
  getMessage,
  markAsRead,
  markAsReplied,
  getPendingMessages,
  getRecentMessages,
  getStats
};
