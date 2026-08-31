const { QdrantClient } = require('@qdrant/js-client-rest');

// Qdrant Cloud endpoints include the port (:6333 for REST), so we pass the
// whole URL rather than splitting host/port. checkCompatibility is disabled
// because the client otherwise pings the server on construction — we want
// connection errors to surface at query time, not at require() time.
const qdrant = new QdrantClient({
  url:    process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

// Collection holding every chunk of every user's documents.
// One shared collection + payload filtering beats one collection per user:
// Qdrant is built for a few large collections, not thousands of tiny ones.
const COLLECTION = 'document_chunks';

// text-embedding-3-small output size. Baked into the collection at creation —
// changing embedding model later means a NEW collection, not an ALTER.
const VECTOR_SIZE = 1536;

module.exports = { qdrant, COLLECTION, VECTOR_SIZE };
