require('dotenv').config();

const { chunkText }          = require('../app/services/chunking.service');
const { generateEmbeddings } = require('../app/services/embedding.service');
const {
  ensureCollection,
  upsertChunks,
  deleteByDocSession,
} = require('../app/services/vectorStore.service');
const {
  getAllSessionsWithText,
  updateChunkCount,
} = require('../app/models/document.model');
const pool = require('../app/config/db');

/**
 * Rebuilds the Qdrant collection from the source text held in MySQL.
 *
 *   npm run reindex
 *
 * Three reasons this exists:
 *
 * 1. Recovery. The Qdrant free tier suspends idle clusters after a week and
 *    deletes them after four. Losing the collection is not losing the data —
 *    doc_sessions.raw_text is the source of truth, and this rebuilds from it.
 *
 * 2. Experimentation. Changing CHUNK_SIZE or OVERLAP in chunking.service.js
 *    only affects documents indexed afterwards. Running this re-chunks
 *    everything so a change can actually be measured.
 *
 * 3. Model changes. Switching embedding model means every stored vector is in
 *    a different space and must be regenerated.
 *
 * Costs money: every chunk is re-embedded through OpenAI.
 */

const reindex = async () => {
  const created = await ensureCollection();
  if (created) console.log('Created collection document_chunks');

  const sessions = await getAllSessionsWithText();

  if (sessions.length === 0) {
    console.log('Nothing to re-index — no sessions have raw_text stored.');
    console.log('Documents uploaded before the Qdrant migration have no source text; re-upload them.');
    return;
  }

  console.log(`Re-indexing ${sessions.length} document(s)\n`);

  let totalChunks = 0;

  for (const session of sessions) {
    const chunks = chunkText(session.raw_text);

    // Delete first. Point ids are deterministic, so an upsert overwrites
    // chunks 0..n-1 in place — but if the new chunking produces FEWER chunks
    // than last time, the leftover high-index points would survive and keep
    // turning up in search results. Clearing the document first avoids that.
    await deleteByDocSession(session.id, session.user_id);

    const embeddings = await generateEmbeddings(chunks);
    await upsertChunks(session.id, session.user_id, chunks, embeddings);
    await updateChunkCount(session.id, chunks.length);

    totalChunks += chunks.length;
    console.log(`  [${session.id}] ${session.title} — ${chunks.length} chunks`);
  }

  console.log(`\nDone. ${totalChunks} chunks across ${sessions.length} document(s).`);
};

reindex()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nRe-index failed:', err.message);
    await pool.end();
    process.exit(1);
  });
