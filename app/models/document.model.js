const pool = require('../config/db');

// ── Doc Sessions ─────────────────────────────────────────────

// Create a new document session and return its generated ID
const createSession = async (title) => {
  const [result] = await pool.execute(
    'INSERT INTO doc_sessions (title) VALUES (?)',
    [title]
  );
  return result.insertId;
};

// Fetch all sessions (for document list in UI)
const getAllSessions = async () => {
  const [rows] = await pool.execute(`
    SELECT
      ds.id,
      ds.title,
      ds.created_at,
      COUNT(d.id) AS chunk_count
    FROM doc_sessions ds
    LEFT JOIN documents d ON d.doc_session_id = ds.id
    GROUP BY ds.id, ds.title, ds.created_at
    ORDER BY ds.created_at DESC
  `);
  return rows;
};

// Delete a session — CASCADE deletes all its chunks automatically
const deleteSession = async (sessionId) => {
  await pool.execute('DELETE FROM doc_sessions WHERE id = ?', [sessionId]);
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

// Total document sessions and chunks — used by the stats endpoint
const getStats = async () => {
  const [[{ doc_count }]]   = await pool.execute('SELECT COUNT(*) AS doc_count FROM doc_sessions');
  const [[{ chunk_count }]] = await pool.execute('SELECT COUNT(*) AS chunk_count FROM documents');
  return { doc_count, chunk_count };
};

// Fetch chunks across one OR many sessions.
// Uses IN (?, ?, ...) so a single query handles both single and multi-doc search.
// This is the core of multi-document Q&A — chunks from all selected docs
// compete on cosine similarity and the best ones win regardless of source.
const fetchChunksBySessions = async (docSessionIds) => {
  if (!docSessionIds || docSessionIds.length === 0) return [];
  const placeholders = docSessionIds.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, content, embedding, chunk_index, doc_session_id FROM documents WHERE doc_session_id IN (${placeholders})`,
    docSessionIds
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
