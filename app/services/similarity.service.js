const { fetchChunksBySessions } = require('../models/document.model');

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
 */
const cosineSimilarity = (A, B) => {
  const dotProduct = A.reduce((sum, val, i) => sum + val * B[i], 0);
  const magnitudeA = Math.sqrt(A.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(B.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
};

// Minimum similarity score a chunk must reach to be included in context.
// Chunks below this threshold are too unrelated to the question and are
// filtered out before being sent to GPT — preventing hallucination from
// irrelevant context.
//
// Why 0.1 and not higher?
// OpenAI embeddings for broad/meta questions ("what is this doc about?")
// score lower against specific content chunks than targeted questions do.
// 0.1 still excludes truly unrelated noise while allowing general queries
// to retrieve context. The top-N cap (5 chunks) keeps the context tight.
const MIN_SCORE = 0.1;

/**
 * Finds the top N most relevant chunks for a given question embedding.
 *
 * Steps:
 * 1. Load all stored chunks scoped to this document session
 * 2. Compute cosine similarity between question and each chunk
 * 3. Filter out chunks below the MIN_SCORE threshold
 * 4. Sort by score descending
 * 5. Return top N results with their similarity scores
 *
 * If no chunks pass the threshold, an empty array is returned.
 * The caller (ai.service) handles this by telling GPT there is no context.
 */
const findTopChunks = async (questionEmbedding, docSessionIds, topN = 5, userId) => {
  const allChunks = await fetchChunksBySessions(docSessionIds, userId);

  const scored = allChunks.map((chunk) => ({
    id:          chunk.id,
    content:     chunk.content,
    chunk_index: chunk.chunk_index,
    score:       cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  // Filter, sort highest score first, return top N
  return scored
    .filter((chunk) => chunk.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
};

module.exports = { findTopChunks };
