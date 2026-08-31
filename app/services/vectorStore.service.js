const crypto = require('crypto');
const { qdrant, COLLECTION, VECTOR_SIZE } = require('../config/qdrant');

/**
 * The ONLY module that talks to Qdrant.
 *
 * Everything else in the app goes through these functions. That is deliberate:
 * MySQL used to enforce per-user isolation structurally — the INNER JOIN on
 * doc_sessions.user_id meant a forged doc_session_id simply returned no rows.
 * A vector database has no joins and no foreign keys, so that guarantee is now
 * application code. Keeping every query in one file means the user_id filter
 * exists in exactly one place instead of being re-derived at each call site.
 */

// How many points to push per upsert request. Qdrant handles large batches
// fine, but smaller ones keep individual requests well under HTTP timeouts
// and give clearer progress during a full re-index.
const UPSERT_BATCH = 100;

// Scroll page size when pulling vectors back out for the exact-search baseline.
const SCROLL_PAGE = 256;

// ── Point IDs ────────────────────────────────────────────────

// Qdrant point IDs must be unsigned integers or UUIDs — MySQL's auto-increment
// ids don't carry over. We derive a UUIDv5 from (doc_session_id, chunk_index)
// so the id is *deterministic*: re-indexing the same document overwrites each
// point in place instead of inserting a second copy. Without this, running
// reindex twice would silently double every chunk and fill the model's context
// with duplicate passages.
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const buildPointId = (docSessionId, chunkIndex) => {
  const name  = `${docSessionId}:${chunkIndex}`;
  const nsHex = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash  = crypto
    .createHash('sha1')
    .update(Buffer.concat([nsHex, Buffer.from(name, 'utf8')]))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

// ── Filters ──────────────────────────────────────────────────

/**
 * Builds the payload filter for a search or delete.
 *
 * user_id is NON-OPTIONAL on purpose — every read and every delete is scoped
 * to its owner. This function throws rather than defaulting, because a missing
 * user id must never silently widen a query to the whole collection.
 */
const ownerFilter = (userId, docSessionIds = null) => {
  if (userId === undefined || userId === null) {
    throw new Error('vectorStore: userId is required — refusing to run an unscoped query');
  }

  const must = [{ key: 'user_id', match: { value: userId } }];

  if (docSessionIds && docSessionIds.length > 0) {
    // `any` is Qdrant's IN operator — matches chunks from any selected document.
    must.push({ key: 'doc_session_id', match: { any: docSessionIds.map(Number) } });
  }

  return { must };
};

// ── Collection setup ─────────────────────────────────────────

/**
 * Creates the collection if it does not exist. Safe to call on every boot.
 *
 * Distance is Cosine to match the hand-written similarity in
 * similarity.service.js — we compare direction (meaning), not magnitude
 * (how verbose the passage happens to be). Picking Dot or Euclid here would
 * not error; it would just rank slightly wrong, forever.
 *
 * The payload indexes are not optional. Filtering works without them, but
 * Qdrant then cannot plan the filtered search efficiently — it degrades to
 * scanning, and with a restrictive filter can also return fewer good results
 * than it should. Both symptoms are silent.
 */
const ensureCollection = async () => {
  const { collections } = await qdrant.getCollections();

  if (collections.some((c) => c.name === COLLECTION)) return false;

  await qdrant.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });

  await qdrant.createPayloadIndex(COLLECTION, {
    field_name:   'user_id',
    field_schema: 'integer',
    wait:         true,
  });

  await qdrant.createPayloadIndex(COLLECTION, {
    field_name:   'doc_session_id',
    field_schema: 'integer',
    wait:         true,
  });

  return true; // created
};

// ── Writes ───────────────────────────────────────────────────

/**
 * Stores chunks + their embeddings for one document session.
 *
 * chunks[i] must correspond to embeddings[i]. The caller is responsible for
 * that pairing — see embedding.service.generateEmbeddings, which reorders by
 * the index OpenAI returns rather than trusting array position.
 */
const upsertChunks = async (docSessionId, userId, chunks, embeddings) => {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `vectorStore: chunk/embedding count mismatch (${chunks.length} vs ${embeddings.length})`
    );
  }

  const points = chunks.map((content, i) => ({
    id:     buildPointId(docSessionId, i),
    vector: embeddings[i],
    payload: {
      user_id:        Number(userId),
      doc_session_id: Number(docSessionId),
      chunk_index:    i,
      content,
    },
  }));

  for (let i = 0; i < points.length; i += UPSERT_BATCH) {
    await qdrant.upsert(COLLECTION, {
      wait:   true,
      points: points.slice(i, i + UPSERT_BATCH),
    });
  }

  return points.length;
};

/**
 * Removes every chunk of one document session.
 *
 * Scoped by user_id as well as doc_session_id so a forged id cannot delete
 * another user's document. There is no ON DELETE CASCADE here — this must be
 * called explicitly, and the controller calls it BEFORE deleting the MySQL row
 * so a failure leaves the document intact rather than orphaning its vectors.
 */
const deleteByDocSession = async (docSessionId, userId) => {
  await qdrant.delete(COLLECTION, {
    wait:   true,
    filter: ownerFilter(userId, [docSessionId]),
  });
};

// ── Reads ────────────────────────────────────────────────────

/**
 * Approximate nearest-neighbour search — the normal query path.
 *
 * `ef` (hnsw_ef) controls how much of the HNSW graph is explored: higher means
 * better recall and slower queries. Left null, Qdrant uses the collection
 * default. scripts/benchmark.js sweeps it against the exact-search baseline so
 * the trade-off is measurable rather than theoretical.
 */
const search = async (embedding, docSessionIds, userId, topN = 5, ef = null) => {
  // query() is the current query_points API — the older search() was removed
  // from the client. It returns { points: [...] } rather than a bare array.
  const { points } = await qdrant.query(COLLECTION, {
    query:        embedding,
    filter:       ownerFilter(userId, docSessionIds),
    limit:        topN,
    with_payload: true,
    ...(ef ? { params: { hnsw_ef: ef } } : {}),
  });

  return points.map((r) => ({
    id:          r.id,
    score:       r.score,
    content:     r.payload.content,
    chunk_index: r.payload.chunk_index,
    doc_session_id: r.payload.doc_session_id,
  }));
};

/**
 * Pulls every matching chunk WITH its vector, paging through the collection.
 *
 * Only used by the exact-search baseline and the benchmark — this is the O(n)
 * path the vector database exists to replace, kept so its results can serve as
 * ground truth for measuring ANN recall.
 */
const scrollAllVectors = async (docSessionIds, userId) => {
  const filter = ownerFilter(userId, docSessionIds);
  const out    = [];
  let offset   = undefined;

  do {
    const page = await qdrant.scroll(COLLECTION, {
      filter,
      limit:        SCROLL_PAGE,
      with_payload: true,
      with_vector:  true,
      offset,
    });

    for (const p of page.points) {
      out.push({
        id:          p.id,
        embedding:   p.vector,
        content:     p.payload.content,
        chunk_index: p.payload.chunk_index,
        doc_session_id: p.payload.doc_session_id,
      });
    }

    offset = page.next_page_offset;
  } while (offset !== null && offset !== undefined);

  return out;
};

/**
 * Exact chunk count for a user — replaces the SQL COUNT the stats endpoint
 * used to run against the documents table.
 */
const countByUser = async (userId) => {
  const { count } = await qdrant.count(COLLECTION, {
    filter: ownerFilter(userId),
    exact:  true,
  });
  return count;
};

module.exports = {
  ensureCollection,
  upsertChunks,
  deleteByDocSession,
  search,
  scrollAllVectors,
  countByUser,
  buildPointId,
};
