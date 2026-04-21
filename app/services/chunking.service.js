const CHUNK_SIZE = 500;   // Max characters per chunk
const OVERLAP    = 100;   // Characters shared between consecutive chunks

/**
 * Splits a large text into smaller overlapping chunks.
 *
 * Why chunking?
 * A full document stored as one record produces one embedding that
 * averages out all topics — making retrieval imprecise. Smaller chunks
 * have focused embeddings that represent one specific idea.
 *
 * Why overlap?
 * A sentence cut at a chunk boundary would be incomplete in both chunks.
 * Overlap ensures the full sentence appears in at least one chunk.
 *
 * Example (CHUNK_SIZE=500, OVERLAP=100):
 *   Chunk 0 → characters 0   to 500
 *   Chunk 1 → characters 400 to 900
 *   Chunk 2 → characters 800 to 1300
 */
const chunkText = (text) => {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = start + CHUNK_SIZE;
    chunks.push(text.slice(start, end));
    start = end - OVERLAP; // Step forward but keep last OVERLAP chars
  }

  return chunks;
};

module.exports = { chunkText };
