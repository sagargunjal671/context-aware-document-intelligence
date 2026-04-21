const { chunkText }         = require('../services/chunking.service');
const { generateEmbedding } = require('../services/embedding.service');
const { generateAnswer }    = require('../services/ai.service');
const { extractText }       = require('../services/fileParser.service');
const {
  createSession,
  getAllSessions,
  deleteSession,
  insertChunk,
  getStats,
} = require('../models/document.model');

/**
 * POST /api/ai/add
 * Accepts raw text + a title, creates a doc session,
 * chunks the text, embeds each chunk, stores all under that session.
 */
const addDocument = async (req, res) => {
  try {
    const { content, title } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Use provided title or fall back to a timestamp-based name
    const sessionTitle = title?.trim() || `Document – ${new Date().toLocaleString()}`;

    // Create an isolated session for this document
    const sessionId = await createSession(sessionTitle);

    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await insertChunk(sessionId, chunks[i], embedding, i);
    }

    return res.status(201).json({
      success:        true,
      message:        'Document stored successfully',
      doc_session_id: sessionId,
      chunks_stored:  chunks.length,
    });
  } catch (err) {
    console.error('[addDocument]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/ai/upload
 * Accepts a PDF, DOCX, or TXT file, extracts text,
 * creates a doc session using the filename as title,
 * then runs the same chunking → embedding → storage pipeline.
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const text = await extractText(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Could not extract text from the file' });
    }

    // Use the original filename as the session title
    const sessionId = await createSession(req.file.originalname);

    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await insertChunk(sessionId, chunks[i], embedding, i);
    }

    return res.status(201).json({
      success:        true,
      message:        `File "${req.file.originalname}" processed successfully`,
      doc_session_id: sessionId,
      chunks_stored:  chunks.length,
    });
  } catch (err) {
    console.error('[uploadFile]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/ai/ask
 * Requires doc_session_id in the body so the search is scoped
 * to one specific document — no cross-document contamination.
 */
const askQuestion = async (req, res) => {
  try {
    const { question, doc_session_ids } = req.body;

    if (!question || question.trim() === '') {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!Array.isArray(doc_session_ids) || doc_session_ids.length === 0) {
      return res.status(400).json({ error: 'doc_session_ids is required. Select at least one document.' });
    }

    const result = await generateAnswer(question, doc_session_ids);

    return res.status(200).json({
      question,
      answer:  result.answer,
      sources: result.sources,
    });
  } catch (err) {
    console.error('[askQuestion]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai/documents
 * Returns all uploaded document sessions for the document list in UI.
 */
const getDocuments = async (_req, res) => {
  try {
    const sessions = await getAllSessions();
    return res.status(200).json({ documents: sessions });
  } catch (err) {
    console.error('[getDocuments]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/ai/documents/:id
 * Deletes a session and all its chunks (via CASCADE).
 */
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteSession(id);
    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (err) {
    console.error('[deleteDocument]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai/stats
 * Returns total document count and total chunk count for the stats bar in UI.
 */
const getKnowledgeStats = async (_req, res) => {
  try {
    const stats = await getStats();
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[getKnowledgeStats]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { addDocument, uploadFile, askQuestion, getDocuments, deleteDocument, getKnowledgeStats };
