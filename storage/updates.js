/**
 * KITT Pending Updates Storage
 *
 * Handles pending update persistence in SQLite.
 * Replaces the JSON file-based storage.
 */

const { getDB } = require('./database');

/**
 * Generate a short unique ID for updates.
 * @returns {string} 6-character uppercase ID
 */
function generateUpdateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Create a new pending update.
 * @param {Object} data - Update data
 * @param {string} data.type - Update type (oem, pending, contact, ces, admin_correction, general)
 * @param {string} data.target - What is being updated
 * @param {string} data.value - The update content
 * @param {string} data.submittedBy - Slack user ID of submitter
 * @param {string} [data.source] - Source of update (dm, admin_dm)
 * @returns {Object} The created update with ID
 */
function createUpdate(data) {
  const db = getDB();
  const id = generateUpdateId();
  const submittedAt = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO pending_updates (id, type, target, value, submitted_by, submitted_at, status, source)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  insert.run(id, data.type, data.target, data.value, data.submittedBy, submittedAt, data.source || null);

  return {
    id,
    type: data.type,
    target: data.target,
    value: data.value,
    submittedBy: data.submittedBy,
    submittedAt,
    status: 'pending',
    source: data.source || null
  };
}

/**
 * Get a single update by ID.
 * @param {string} id - Update ID
 * @returns {Object|null} The update or null if not found
 */
function getUpdate(id) {
  const db = getDB();
  const select = db.prepare('SELECT * FROM pending_updates WHERE id = ?');
  const row = select.get(id);

  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    target: row.target,
    value: row.value,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    status: row.status,
    source: row.source,
    processedAt: row.processed_at,
    editedAt: row.edited_at,
    editedBy: row.edited_by,
    note: row.note
  };
}

/**
 * Get all pending updates.
 * @returns {Array} Array of pending updates
 */
function getPendingUpdates() {
  const db = getDB();
  const select = db.prepare(`
    SELECT * FROM pending_updates
    WHERE status = 'pending'
    ORDER BY submitted_at DESC
  `);

  return select.all().map(row => ({
    id: row.id,
    type: row.type,
    target: row.target,
    value: row.value,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    status: row.status,
    source: row.source,
    processedAt: row.processed_at,
    editedAt: row.edited_at,
    editedBy: row.edited_by,
    note: row.note
  }));
}

/**
 * Get all updates (including processed).
 * @param {Object} [options] - Query options
 * @param {string} [options.status] - Filter by status
 * @param {number} [options.limit] - Limit results
 * @returns {Array} Array of updates
 */
function getAllUpdates(options = {}) {
  const db = getDB();
  let sql = 'SELECT * FROM pending_updates';
  const params = [];

  if (options.status) {
    sql += ' WHERE status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY submitted_at DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params).map(row => ({
    id: row.id,
    type: row.type,
    target: row.target,
    value: row.value,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    status: row.status,
    source: row.source,
    processedAt: row.processed_at,
    editedAt: row.edited_at,
    editedBy: row.edited_by,
    note: row.note
  }));
}

/**
 * Update the status of an update (approve/reject).
 * @param {string} id - Update ID
 * @param {string} status - New status ('approved' or 'rejected')
 * @param {string} [note] - Optional note
 * @returns {boolean} True if updated, false if not found
 */
function updateStatus(id, status, note = null) {
  const db = getDB();
  const processedAt = new Date().toISOString();

  const update = db.prepare(`
    UPDATE pending_updates
    SET status = ?, processed_at = ?, note = COALESCE(?, note)
    WHERE id = ? AND status = 'pending'
  `);

  const result = update.run(status, processedAt, note, id);
  return result.changes > 0;
}

/**
 * Edit an update before approving.
 * @param {string} id - Update ID
 * @param {string} target - New target value
 * @param {string} value - New value
 * @param {string} editedBy - Slack user ID of editor
 * @returns {boolean} True if edited, false if not found
 */
function editUpdate(id, target, value, editedBy) {
  const db = getDB();
  const editedAt = new Date().toISOString();

  const update = db.prepare(`
    UPDATE pending_updates
    SET target = ?, value = ?, edited_at = ?, edited_by = ?
    WHERE id = ? AND status = 'pending'
  `);

  const result = update.run(target, value, editedAt, editedBy, id);
  return result.changes > 0;
}

/**
 * Delete an update (hard delete).
 * @param {string} id - Update ID
 * @returns {boolean} True if deleted
 */
function deleteUpdate(id) {
  const db = getDB();
  const result = db.prepare('DELETE FROM pending_updates WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get updates submitted by a specific user.
 * @param {string} userId - Slack user ID
 * @returns {Array} Array of updates
 */
function getUpdatesByUser(userId) {
  const db = getDB();
  const select = db.prepare(`
    SELECT * FROM pending_updates
    WHERE submitted_by = ?
    ORDER BY submitted_at DESC
  `);

  return select.all(userId).map(row => ({
    id: row.id,
    type: row.type,
    target: row.target,
    value: row.value,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    status: row.status,
    source: row.source,
    processedAt: row.processed_at,
    editedAt: row.edited_at,
    editedBy: row.edited_by,
    note: row.note
  }));
}

module.exports = {
  generateUpdateId,
  createUpdate,
  getUpdate,
  getPendingUpdates,
  getAllUpdates,
  updateStatus,
  editUpdate,
  deleteUpdate,
  getUpdatesByUser
};
