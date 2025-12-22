/**
 * KITT Conversation Storage
 *
 * Handles conversation history persistence in SQLite.
 */

const { getDB } = require('./database');

// Configuration
const CONVERSATION_MAX_MESSAGES = 10; // Keep last N message pairs (20 messages total)
const CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Add a message to conversation history.
 * @param {string} userId - Slack user ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 */
function addMessage(userId, role, content) {
  const db = getDB();
  const now = Date.now();
  const expiresAt = now + CONVERSATION_TIMEOUT_MS;

  // Insert new message
  const insert = db.prepare(`
    INSERT INTO messages (user_id, role, content, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insert.run(userId, role, content, now, expiresAt);

  // Update expires_at for all messages from this user (extend timeout on activity)
  const updateExpiry = db.prepare(`
    UPDATE messages SET expires_at = ? WHERE user_id = ?
  `);
  updateExpiry.run(expiresAt, userId);

  // Trim old messages beyond the limit (keep most recent CONVERSATION_MAX_MESSAGES * 2)
  const deleteOld = db.prepare(`
    DELETE FROM messages WHERE user_id = ? AND id NOT IN (
      SELECT id FROM messages WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?
    )
  `);
  deleteOld.run(userId, userId, CONVERSATION_MAX_MESSAGES * 2);
}

/**
 * Get conversation history for a user.
 * @param {string} userId - Slack user ID
 * @returns {Array} Array of message objects {role, content, timestamp}
 */
function getHistory(userId) {
  const db = getDB();
  const now = Date.now();

  // First, clean up expired messages for this user
  const deleteExpired = db.prepare(`
    DELETE FROM messages WHERE user_id = ? AND expires_at < ?
  `);
  deleteExpired.run(userId, now);

  // Get remaining messages
  const select = db.prepare(`
    SELECT role, content, created_at as timestamp
    FROM messages
    WHERE user_id = ?
    ORDER BY created_at ASC
  `);

  return select.all(userId);
}

/**
 * Clear conversation history for a user.
 * @param {string} userId - Slack user ID
 */
function clearHistory(userId) {
  const db = getDB();
  const deleteAll = db.prepare('DELETE FROM messages WHERE user_id = ?');
  deleteAll.run(userId);
}

/**
 * Clean up all expired messages across all users.
 * Call this periodically to keep the database clean.
 * @returns {number} Number of messages deleted
 */
function cleanupExpired() {
  const db = getDB();
  const now = Date.now();

  const result = db.prepare('DELETE FROM messages WHERE expires_at < ?').run(now);
  return result.changes;
}

/**
 * Format conversation history for AI prompt.
 * @param {Array} history - Array of message objects from getHistory()
 * @returns {string} Formatted conversation string for prompt
 */
function formatForPrompt(history) {
  if (!history || history.length === 0) return '';

  const formatted = history.map(msg => {
    const role = msg.role === 'user' ? '用戶' : 'KITT';
    return `${role}: ${msg.content}`;
  }).join('\n');

  return `\n\n## 最近對話記錄:\n${formatted}\n`;
}

/**
 * Get conversation statistics for a user.
 * @param {string} userId - Slack user ID
 * @returns {Object} Stats about the user's conversation
 */
function getUserStats(userId) {
  const db = getDB();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as messageCount,
      MIN(created_at) as firstMessage,
      MAX(created_at) as lastMessage
    FROM messages WHERE user_id = ?
  `).get(userId);

  return {
    messageCount: stats.messageCount,
    firstMessage: stats.firstMessage ? new Date(stats.firstMessage) : null,
    lastMessage: stats.lastMessage ? new Date(stats.lastMessage) : null
  };
}

module.exports = {
  addMessage,
  getHistory,
  clearHistory,
  cleanupExpired,
  formatForPrompt,
  getUserStats,
  CONVERSATION_MAX_MESSAGES,
  CONVERSATION_TIMEOUT_MS
};
