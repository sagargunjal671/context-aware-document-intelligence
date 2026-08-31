const openai = require('../config/openai');

const MODEL = 'text-embedding-3-small';

// How many chunks to embed per API call. The endpoint accepts an array of
// inputs, so 100 chunks cost one round-trip instead of 100 — the difference
// between a document indexing in seconds and in minutes.
const EMBED_BATCH = 100;

/**
 * Generates an embedding vector for the given text.
 *
 * What is an embedding?
 * A list of 1536 numbers that represents the meaning of the text.
 * Similar text produces similar vectors. This allows us to compare
 * meaning mathematically using cosine similarity.
 *
 * Model: text-embedding-3-small
 * - Latest OpenAI embedding model
 * - Output: 1536-dimensional float array
 * - Used for both document chunks and user questions
 */
const generateEmbedding = async (text) => {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text,
  });

  // The embedding vector is nested inside the response object
  return response.data[0].embedding;
};

/**
 * Embeds many texts at once, returning vectors in the SAME order as the input.
 *
 * Why the explicit reorder below?
 * Each item OpenAI returns carries an `index` field pointing back at its input.
 * Reading the response positionally would appear to work — the array is the
 * right length, every vector is valid — but if the order ever differed, chunk 7
 * would be stored with chunk 12's vector. Nothing would throw. Search would
 * simply return the wrong passages forever, and it would look like the model
 * had got worse rather than like a bug. Sorting by `index` costs nothing and
 * removes the possibility entirely.
 */
const generateEmbeddings = async (texts, onProgress = null) => {
  const out = new Array(texts.length);

  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH);

    const response = await openai.embeddings.create({
      model: MODEL,
      input: batch,
    });

    if (response.data.length !== batch.length) {
      throw new Error(
        `embedding: expected ${batch.length} vectors, got ${response.data.length}`
      );
    }

    // Map each vector back to its input by index — never by position.
    for (const item of response.data) {
      out[start + item.index] = item.embedding;
    }

    if (onProgress) onProgress(Math.min(start + batch.length, texts.length), texts.length);
  }

  // A hole here means some index never came back — fail loudly rather than
  // storing an undefined vector that Qdrant would reject with a vague error.
  const missing = out.findIndex((v) => !v);
  if (missing !== -1) {
    throw new Error(`embedding: no vector returned for chunk ${missing}`);
  }

  return out;
};

module.exports = { generateEmbedding, generateEmbeddings };
