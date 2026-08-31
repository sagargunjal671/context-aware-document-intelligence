const { chunkText }          = require('../services/chunking.service');
const { generateEmbeddings } = require('../services/embedding.service');
const { generateAnswer, generateAnswerStream } = require('../services/ai.service');
const { extractText }        = require('../services/fileParser.service');
const {
  upsertChunks,
  deleteByDocSession,
  countByUser,
} = require('../services/vectorStore.service');
const {
  createSession,
  getAllSessions,
  deleteSession,
  getSessionCount,
} = require('../models/document.model');

/**
 * Chunk → embed → store, shared by the text and file upload routes.
 *
 * The doc session is created first because its id seeds the deterministic
 * Qdrant point ids. If embedding or upserting then fails, the session row is
 * removed again — otherwise a failed upload would leave a document listed in
 * the sidebar with no chunks behind it, which looks like the AI has forgotten
 * its contents rather than like an error.
 *
 * MySQL and Qdrant cannot share a transaction, so this rollback is the
 * closest equivalent: one store is only left written if the other succeeded.
 */
const indexDocument = async (title, text, userId) => {
  // Chunking is synchronous and cheap, so it happens before the insert —
  // that way the session row carries its final chunk_count from the start.
  const chunks    = chunkText(text);
  const sessionId = await createSession(title, userId, text, chunks.length);

  try {
    const embeddings = await generateEmbeddings(chunks);
    await upsertChunks(sessionId, userId, chunks, embeddings);
    return { sessionId, chunksStored: chunks.length };
  } catch (err) {
    // Best-effort cleanup of both stores before rethrowing.
    await deleteByDocSession(sessionId, userId).catch(() => {});
    await deleteSession(sessionId, userId).catch(() => {});
    throw err;
  }
};

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
    const { sessionId, chunksStored } = await indexDocument(sessionTitle, content, userId);

    return res.status(201).json({
      success:        true,
      message:        'Document stored successfully',
      doc_session_id: sessionId,
      chunks_stored:  chunksStored,
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

    const { sessionId, chunksStored } = await indexDocument(
      req.file.originalname,
      text,
      userId
    );

    return res.status(201).json({
      success:        true,
      message:        `File "${req.file.originalname}" processed successfully`,
      doc_session_id: sessionId,
      chunks_stored:  chunksStored,
    });
  } catch (err) {
    console.error('[uploadFile]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/ai/ask
 * Scoped to req.user.id — the Qdrant payload filter in vectorStore.search
 * ensures a user can never retrieve another user's chunks even if they pass
 * foreign doc_session_ids.
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
 *
 * Qdrant first, MySQL second. There is no ON DELETE CASCADE across stores, so
 * if this ran the other way round and the Qdrant call failed, the vectors
 * would survive with no document row pointing at them — invisible in the UI
 * but still returned as answer sources. Deleting vectors first means a failure
 * leaves the document fully intact instead.
 */
const deleteDocument = async (req, res) => {
  try {
    const { id }  = req.params;
    const userId  = req.user.id;

    await deleteByDocSession(id, userId);
    const affected = await deleteSession(id, userId);

    if (affected === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (err) {
    console.error('[deleteDocument]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai/stats
 * Returns doc and chunk counts scoped to the logged-in user.
 * Documents come from MySQL, chunks from Qdrant — there is no chunk
 * table left to COUNT.
 */
const getKnowledgeStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const [doc_count, chunk_count] = await Promise.all([
      getSessionCount(userId),
      countByUser(userId),
    ]);
    return res.status(200).json({ doc_count, chunk_count });
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
