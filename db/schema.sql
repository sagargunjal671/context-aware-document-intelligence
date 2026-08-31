-- ============================================================
-- Context-Aware Document Intelligence System
-- Database Schema
--
-- MySQL stores relational data: who the user is and what they
-- uploaded. Chunk text and embedding vectors live in Qdrant —
-- see app/services/vectorStore.service.js.
--
-- Why the split?
-- Embeddings are 1536 floats per chunk. Stored as MySQL JSON they
-- had to be pulled into Node and scored in a JS loop on every
-- question — O(n) over the whole corpus. A vector database indexes
-- them (HNSW) and filters by owner server-side. Users, passwords
-- and document metadata stay here, where foreign keys, cascades
-- and ACID transactions are worth having.
-- ============================================================

CREATE DATABASE IF NOT EXISTS rag_chatbot;
USE rag_chatbot;

-- ============================================================
-- Table: users
--
-- Stores registered users. Passwords are hashed with bcrypt.
-- Each user owns their own doc_sessions — no cross-user access.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INT           AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: doc_sessions
--
-- Each upload (text or file) creates one session record.
-- user_id scopes every session to its owner.
--
-- raw_text holds the extracted source text of the document.
-- Uploads are parsed in memory and never written to disk, so this
-- is the only durable copy — it is what scripts/reindex.js rebuilds
-- the Qdrant collection from after a chunking change or a lost
-- cluster. The chunks themselves are NOT stored here.
-- ============================================================

CREATE TABLE IF NOT EXISTS doc_sessions (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  user_id     INT           NOT NULL,
  title       VARCHAR(255)  NOT NULL,
  raw_text    LONGTEXT      NULL,
  chunk_count INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- Chunks and embeddings: Qdrant collection `document_chunks`
--
--   vector   1536 dims, Cosine distance
--   payload  { user_id, doc_session_id, chunk_index, content }
--   indexes  payload indexes on user_id and doc_session_id
--
-- Note there is no cascade from doc_sessions into Qdrant. Deleting
-- a document must remove its points explicitly — the controller
-- deletes from Qdrant FIRST, so a failure leaves the document whole
-- rather than leaving orphaned vectors that still answer questions.
-- ============================================================
