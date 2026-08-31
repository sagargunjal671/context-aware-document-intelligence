const pool = require('../config/db');

// ── Doc Sessions ─────────────────────────────────────────────

// Create a new document session linked to a user.
// rawText is the extracted source text — the only durable copy, since
// uploads are parsed in memory and never written to disk. scripts/reindex.js
// rebuilds the Qdrant collection from it.
const createSession = async (title, userId, rawText = null, chunkCount = 0) => {
  const [result] = await pool.execute(
    'INSERT INTO doc_sessions (title, user_id, raw_text, chunk_count) VALUES (?, ?, ?, ?)',
    [title, userId, rawText, chunkCount]
  );
  return result.insertId;
};

// Fetch all sessions belonging to a specific user.
//
// raw_text is excluded — it can be megabytes per row and the sidebar only
// needs titles, dates and the chunk badge. chunk_count is stored here rather
// than counted in Qdrant so rendering the list is a single query and does not
// depend on the vector store being reachable.
const getAllSessions = async (userId) => {
  const [rows] = await pool.execute(`
    SELECT id, title, chunk_count, created_at
    FROM doc_sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId]);
  return rows;
};

// Delete a session — only if it belongs to the requesting user.
// Returns affectedRows so the caller can tell "deleted" from "not yours".
const deleteSession = async (sessionId, userId) => {
  const [result] = await pool.execute(
    'DELETE FROM doc_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );
  return result.affectedRows;
};

// Every session with its source text — used only by the re-index script.
// Not exposed through any route: raw_text is large and there is no reason
// to ship it to the browser.
const getAllSessionsWithText = async () => {
  const [rows] = await pool.execute(`
    SELECT id, user_id, title, raw_text
    FROM doc_sessions
    WHERE raw_text IS NOT NULL AND raw_text <> ''
    ORDER BY id
  `);
  return rows;
};

// Keeps the sidebar badge in step after a re-index — changing CHUNK_SIZE
// produces a different number of chunks for the same source text.
const updateChunkCount = async (sessionId, chunkCount) => {
  await pool.execute(
    'UPDATE doc_sessions SET chunk_count = ? WHERE id = ?',
    [chunkCount, sessionId]
  );
};

// Document count for the stats bar. The chunk count now comes from Qdrant
// (vectorStore.countByUser) — there is no chunk table left to COUNT.
const getSessionCount = async (userId) => {
  const [[{ doc_count }]] = await pool.execute(
    'SELECT COUNT(*) AS doc_count FROM doc_sessions WHERE user_id = ?',
    [userId]
  );
  return doc_count;
};

module.exports = {
  createSession,
  getAllSessions,
  deleteSession,
  getAllSessionsWithText,
  updateChunkCount,
  getSessionCount,
};
