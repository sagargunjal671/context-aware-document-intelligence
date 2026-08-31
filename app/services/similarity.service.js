const { scrollAllVectors } = require('./vectorStore.service');

/**
 * Exact (brute-force) vector search.
 *
 * This was the app's only search path before Qdrant. It is kept — not as dead
 * code, but as the ground truth the approximate index is measured against.
 *
 * Qdrant's HNSW index is APPROXIMATE: it walks a navigable graph and looks at
 * a small fraction of the collection, so it can miss a true nearest neighbour.
 * The code below looks at every single vector, so its top-N is correct by
 * definition. scripts/benchmark.js runs both over the same queries and reports
 * recall@5 — how often the fast path agrees with this one — alongside latency.
 *
 * That comparison is the whole reason a vector database exists: exact search
 * is O(n) and gets slower with every document; HNSW is roughly O(log n) and
 * trades a small, MEASURABLE amount of accuracy for it.
 */

/**
 * Calculates cosine similarity between two vectors.
 *
 * Formula: (A · B) / (|A| × |B|)
 *
 * - A · B   = dot product (multiply each pair of numbers, then sum)
 * - |A|, |B| = magnitude (square root of sum of squares)
 *
 * Result is always between 0 and 1:
 *   1.0 → identical meaning
 *   0.0 → completely unrelated
 *
 * Why cosine and not Euclidean distance?
 * We care about the direction of the vector (what it means),
 * not its length. Two chunks about the same topic point in the
 * same direction regardless of how long the text is.
 *
 * The Qdrant collection is created with Distance.Cosine for exactly this
 * reason — the two paths must agree on the metric or the recall numbers
 * would be meaningless.
 */
const cosineSimilarity = (A, B) => {
  const dotProduct = A.reduce((sum, val, i) => sum + val * B[i], 0);
  const magnitudeA = Math.sqrt(A.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(B.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
};

// Minimum similarity score a chunk must reach to be included in context.
//
// Why 0.1 and not higher?
// OpenAI embeddings for broad/meta questions ("what is this doc about?")
// score lower against specific content chunks than targeted questions do.
// 0.1 still excludes truly unrelated noise while allowing general queries
// to retrieve context. The top-N cap (5 chunks) keeps the context tight.
const MIN_SCORE = 0.1;

/**
 * Finds the top N chunks by scoring EVERY vector in the collection.
 *
 * Pulls all matching points out of Qdrant (scoped to the user) and scores them
 * in Node. This is deliberately the slow path — it is what the app used to do
 * on every question, and it is now used only by the benchmark.
 */
const findTopChunksExact = async (questionEmbedding, docSessionIds, topN = 5, userId) => {
  const allChunks = await scrollAllVectors(docSessionIds, userId);

  const scored = allChunks.map((chunk) => ({
    id:          chunk.id,
    content:     chunk.content,
    chunk_index: chunk.chunk_index,
    doc_session_id: chunk.doc_session_id,
    score:       cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  return scored
    .filter((chunk) => chunk.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
};

module.exports = { cosineSimilarity, findTopChunksExact, MIN_SCORE };
