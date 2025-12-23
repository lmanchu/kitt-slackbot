/**
 * KITT Long-term Memory System
 *
 * Stores approved memories in a shared SQLite database (via Dropbox)
 * so that MAGI (Iris/Lucy) can also query KITT's memories.
 *
 * Flow:
 * 1. User says "@KITT 記住" in a thread
 * 2. KITT reads the thread, extracts key information
 * 3. Creates memory candidate, notifies admin
 * 4. Admin approves → writes to shared DB
 * 5. KITT (and MAGI) can query these memories
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Shared memory database path (via Dropbox)
const MEMORY_DB_PATH = path.join(
  process.env.HOME,
  'Dropbox/PKM-Vault/.ai-butler-system/kitt-memory/memory.db'
);

// Ensure directory exists
const memoryDir = path.dirname(MEMORY_DB_PATH);
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
}

// Initialize database
const db = new Database(MEMORY_DB_PATH);

// Create tables
db.exec(`
  -- Approved memories (long-term storage)
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- 'decision', 'preference', 'fact', 'action', 'context'
    content TEXT NOT NULL,        -- The actual memory content
    context TEXT,                 -- Additional context (e.g., meeting name)
    source TEXT,                  -- 'slack-thread', 'slack-dm'
    channel TEXT,                 -- Slack channel name
    thread_ts TEXT,               -- Slack thread timestamp
    submitted_by TEXT,            -- User who triggered the memory
    approved_by TEXT,             -- Admin who approved
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT,
    tags TEXT                     -- JSON array of tags for search
  );

  -- Pending memory candidates (waiting for approval)
  CREATE TABLE IF NOT EXISTS memory_candidates (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,         -- 'slack-thread', 'slack-dm'
    channel TEXT,
    channel_name TEXT,
    thread_ts TEXT,
    thread_url TEXT,              -- Slack permalink to thread
    raw_messages TEXT,            -- JSON array of original messages
    extracted_memories TEXT,      -- JSON array of extracted memory objects
    submitted_by TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    reviewed_by TEXT,
    reviewed_at TEXT,
    notes TEXT
  );

  -- Create indexes for search
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
  CREATE INDEX IF NOT EXISTS idx_candidates_status ON memory_candidates(status);
`);

/**
 * Generate unique ID for memory
 */
function generateId(prefix = 'MEM') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Create a memory candidate from thread analysis
 * @param {Object} data - Candidate data
 * @returns {Object} Created candidate
 */
function createCandidate(data) {
  const id = generateId('CAND');
  const stmt = db.prepare(`
    INSERT INTO memory_candidates
    (id, source, channel, channel_name, thread_ts, thread_url, raw_messages, extracted_memories, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.source || 'slack-thread',
    data.channel,
    data.channelName,
    data.threadTs,
    data.threadUrl,
    JSON.stringify(data.rawMessages || []),
    JSON.stringify(data.extractedMemories || []),
    data.submittedBy
  );

  return getCandidate(id);
}

/**
 * Get a memory candidate by ID
 */
function getCandidate(id) {
  const stmt = db.prepare('SELECT * FROM memory_candidates WHERE id = ?');
  const row = stmt.get(id);
  if (row) {
    row.rawMessages = JSON.parse(row.raw_messages || '[]');
    row.extractedMemories = JSON.parse(row.extracted_memories || '[]');
  }
  return row;
}

/**
 * Get all pending candidates
 */
function getPendingCandidates() {
  const stmt = db.prepare('SELECT * FROM memory_candidates WHERE status = ? ORDER BY submitted_at DESC');
  const rows = stmt.all('pending');
  return rows.map(row => {
    row.rawMessages = JSON.parse(row.raw_messages || '[]');
    row.extractedMemories = JSON.parse(row.extracted_memories || '[]');
    return row;
  });
}

/**
 * Approve a memory candidate - writes extracted memories to permanent storage
 * @param {string} candidateId - Candidate ID
 * @param {string} approvedBy - User ID who approved
 * @param {Array} selectedMemories - Optional: specific memories to approve (if not all)
 * @returns {Array} Created memory IDs
 */
function approveCandidate(candidateId, approvedBy, selectedMemories = null) {
  const candidate = getCandidate(candidateId);
  if (!candidate || candidate.status !== 'pending') {
    return null;
  }

  const memoriesToApprove = selectedMemories || candidate.extractedMemories;
  const createdIds = [];

  const insertStmt = db.prepare(`
    INSERT INTO memories
    (id, type, content, context, source, channel, thread_ts, submitted_by, approved_by, approved_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  for (const mem of memoriesToApprove) {
    const memId = generateId('MEM');
    insertStmt.run(
      memId,
      mem.type || 'fact',
      mem.content,
      mem.context || null,
      candidate.source,
      candidate.channel_name || candidate.channel,
      candidate.thread_ts,
      candidate.submitted_by,
      approvedBy,
      JSON.stringify(mem.tags || [])
    );
    createdIds.push(memId);
  }

  // Update candidate status
  const updateStmt = db.prepare(`
    UPDATE memory_candidates
    SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `);
  updateStmt.run(approvedBy, candidateId);

  return createdIds;
}

/**
 * Reject a memory candidate
 */
function rejectCandidate(candidateId, rejectedBy, notes = null) {
  const stmt = db.prepare(`
    UPDATE memory_candidates
    SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), notes = ?
    WHERE id = ?
  `);
  stmt.run(rejectedBy, notes, candidateId);
  return getCandidate(candidateId);
}

/**
 * Edit extracted memories in a candidate before approving
 */
function editCandidateMemories(candidateId, newMemories) {
  const stmt = db.prepare(`
    UPDATE memory_candidates
    SET extracted_memories = ?
    WHERE id = ? AND status = 'pending'
  `);
  stmt.run(JSON.stringify(newMemories), candidateId);
  return getCandidate(candidateId);
}

/**
 * Search memories by keyword
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Matching memories
 */
function searchMemories(query, options = {}) {
  const { type, limit = 20, channel } = options;

  let sql = `
    SELECT * FROM memories
    WHERE content LIKE ?
  `;
  const params = [`%${query}%`];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  if (channel) {
    sql += ' AND channel LIKE ?';
    params.push(`%${channel}%`);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  return rows.map(row => {
    row.tags = JSON.parse(row.tags || '[]');
    return row;
  });
}

/**
 * Get all memories (for export/review)
 */
function getAllMemories(limit = 100) {
  const stmt = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?');
  const rows = stmt.all(limit);
  return rows.map(row => {
    row.tags = JSON.parse(row.tags || '[]');
    return row;
  });
}

/**
 * Get memory by ID
 */
function getMemory(id) {
  const stmt = db.prepare('SELECT * FROM memories WHERE id = ?');
  const row = stmt.get(id);
  if (row) {
    row.tags = JSON.parse(row.tags || '[]');
  }
  return row;
}

/**
 * Delete a memory
 */
function deleteMemory(id) {
  const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
  return stmt.run(id);
}

/**
 * Get memory statistics
 */
function getStats() {
  const stats = {};

  stats.totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
  stats.pendingCandidates = db.prepare('SELECT COUNT(*) as count FROM memory_candidates WHERE status = ?').get('pending').count;
  stats.approvedCandidates = db.prepare('SELECT COUNT(*) as count FROM memory_candidates WHERE status = ?').get('approved').count;
  stats.rejectedCandidates = db.prepare('SELECT COUNT(*) as count FROM memory_candidates WHERE status = ?').get('rejected').count;

  // Count by type
  const typeRows = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all();
  stats.byType = {};
  for (const row of typeRows) {
    stats.byType[row.type] = row.count;
  }

  return stats;
}

module.exports = {
  createCandidate,
  getCandidate,
  getPendingCandidates,
  approveCandidate,
  rejectCandidate,
  editCandidateMemories,
  searchMemories,
  getAllMemories,
  getMemory,
  deleteMemory,
  getStats,
  MEMORY_DB_PATH
};
