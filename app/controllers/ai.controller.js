const { chunkText }         = require('../services/chunking.service');
const { generateEmbedding } = require('../services/embedding.service');
const { generateAnswer, generateAnswerStream } = require('../services/ai.service');
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
 * Scoped to req.user.id so documents are private per user.
 */
const addDocument = async (req, res) => {
  try {
    const { content, title } = req.body;
    const userId = req.user.id;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required' });
    }

    const sessionTitle = title?.trim() || `Document – ${new Date().toLocaleString()}`;
    const sessionId = await createSession(sessionTitle, userId);

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
    const userId = req.user.id;

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

    const sessionId = await createSession(req.file.originalname, userId);

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
 * Scoped to req.user.id — the JOIN in fetchChunksBySessions
 * ensures a user can never retrieve another user's chunks
 * even if they pass foreign doc_session_ids.
 */
const askQuestion = async (req, res) => {
  try {
    const { question, doc_session_ids, history = [] } = req.body;
    const userId = req.user.id;

    if (!question || question.trim() === '') {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!Array.isArray(doc_session_ids) || doc_session_ids.length === 0) {
      return res.status(400).json({ error: 'doc_session_ids is required. Select at least one document.' });
    }

    const result = await generateAnswer(question, doc_session_ids, userId, history);

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
 * Returns only the sessions belonging to the logged-in user.
 */
const getDocuments = async (req, res) => {
  try {
    const sessions = await getAllSessions(req.user.id);
    return res.status(200).json({ documents: sessions });
  } catch (err) {
    console.error('[getDocuments]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/ai/documents/:id
 * Deletes a session only if it belongs to the logged-in user.
 */
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteSession(id, req.user.id);
    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (err) {
    console.error('[deleteDocument]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai/stats
 * Returns doc and chunk counts scoped to the logged-in user.
 */
const getKnowledgeStats = async (req, res) => {
  try {
    const stats = await getStats(req.user.id);
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[getKnowledgeStats]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/ai/ask-stream
 * Same as askQuestion but streams tokens back via Server-Sent Events.
 * The client reads the stream and appends tokens to the UI as they arrive.
 */
const askQuestionStream = async (req, res) => {
  const { question, doc_session_ids, history = [] } = req.body;
  const userId = req.user.id;

  if (!question || question.trim() === '') {
    return res.status(400).json({ error: 'Question is required' });
  }

  if (!Array.isArray(doc_session_ids) || doc_session_ids.length === 0) {
    return res.status(400).json({ error: 'doc_session_ids is required. Select at least one document.' });
  }

  // Set SSE headers — keep connection open, disable buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const { stream, sources } = await generateAnswerStream(question, doc_session_ids, userId, history);

    // No matching chunks — send the fallback message as a single token then done
    if (!stream) {
      res.write(`data: ${JSON.stringify({ token: "I don't know based on the provided documents." })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, sources: [] })}\n\n`);
      return res.end();
    }

    // Stream each token to the client as it arrives from OpenAI
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // Signal end of stream + send sources
    res.write(`data: ${JSON.stringify({ done: true, sources })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[askQuestionStream]', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
};

module.exports = { addDocument, uploadFile, askQuestion, askQuestionStream, getDocuments, deleteDocument, getKnowledgeStats };
