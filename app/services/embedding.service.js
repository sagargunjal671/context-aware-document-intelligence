const openai = require('../config/openai');

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
    model: 'text-embedding-3-small',
    input: text,
  });

  // The embedding vector is nested inside the response object
  return response.data[0].embedding;
};

module.exports = { generateEmbedding };
