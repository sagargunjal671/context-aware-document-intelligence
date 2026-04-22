const pool = require('../config/db');

// ── Doc Sessions ─────────────────────────────────────────────

// Create a new document session linked to a user
const createSession = async (title, userId) => {
  const [result] = await pool.execute(
    'INSERT INTO doc_sessions (title, user_id) VALUES (?, ?)',
    [title, userId]
  );
  return result.insertId;
};

// Fetch all sessions belonging to a specific user
const getAllSessions = async (userId) => {
  const [rows] = await pool.execute(`
    SELECT
      ds.id,
      ds.title,
      ds.created_at,
      COUNT(d.id) AS chunk_count
    FROM doc_sessions ds
    LEFT JOIN documents d ON d.doc_session_id = ds.id
    WHERE ds.user_id = ?
    GROUP BY ds.id, ds.title, ds.created_at
    ORDER BY ds.created_at DESC
  `, [userId]);
  return rows;
};

// Delete a session — only if it belongs to the requesting user
const deleteSession = async (sessionId, userId) => {
  await pool.execute(
    'DELETE FROM doc_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );
};

// ── Documents (Chunks) ───────────────────────────────────────

// Insert a single chunk linked to a specific session
const insertChunk = async (docSessionId, content, embedding, chunkIndex) => {
  const sql = `
    INSERT INTO documents (doc_session_id, content, embedding, chunk_index)
    VALUES (?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    docSessionId,
    content,
    JSON.stringify(embedding),
    chunkIndex,
  ]);
  return result;
};

// Stats scoped to a specific user
const getStats = async (userId) => {
  const [[{ doc_count }]]   = await pool.execute(
    'SELECT COUNT(*) AS doc_count FROM doc_sessions WHERE user_id = ?', [userId]
  );
  const [[{ chunk_count }]] = await pool.execute(
    `SELECT COUNT(*) AS chunk_count FROM documents d
     INNER JOIN doc_sessions ds ON ds.id = d.doc_session_id
     WHERE ds.user_id = ?`, [userId]
  );
  return { doc_count, chunk_count };
};

// Fetch chunks across one OR many sessions — scoped to the user.
// The user_id check via JOIN ensures users can never query another user's chunks,
// even if they manually pass a foreign doc_session_id.
const fetchChunksBySessions = async (docSessionIds, userId) => {
  if (!docSessionIds || docSessionIds.length === 0) return [];
  const placeholders = docSessionIds.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT d.id, d.content, d.embedding, d.chunk_index, d.doc_session_id
     FROM documents d
     INNER JOIN doc_sessions ds ON ds.id = d.doc_session_id
     WHERE d.doc_session_id IN (${placeholders})
       AND ds.user_id = ?`,
    [...docSessionIds, userId]
  );
  return rows.map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding),
  }));
};

module.exports = {
  createSession,
  getAllSessions,
  deleteSession,
  insertChunk,
  fetchChunksBySessions,
  getStats,
};
