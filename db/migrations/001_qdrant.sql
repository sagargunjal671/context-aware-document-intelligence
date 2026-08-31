-- ============================================================
-- Migration 001 — Move chunk storage from MySQL to Qdrant
--
-- Run this against an existing rag_chatbot database. For a fresh
-- install, db/schema.sql already reflects the post-migration shape.
--
-- ORDER MATTERS. Adding raw_text and dropping documents are separate
-- steps on purpose: once `documents` is gone the embeddings are gone,
-- and rebuilding them costs OpenAI calls. Back up first:
--
--   mysqldump -u root rag_chatbot > backup_before_qdrant.sql
-- ============================================================

USE rag_chatbot;

-- ── Step 1: add raw_text ─────────────────────────────────────
--
-- Uploaded files are parsed in memory and never written to disk, so
-- before this column the only copy of a document's text was its chunk
-- rows. With chunks living in Qdrant instead, a deleted collection
-- (the free tier removes idle clusters after 4 weeks) would leave
-- nothing to rebuild from. Storing the extracted source text makes
-- `npm run reindex` possible, and lets chunking strategy change
-- without re-uploading anything.

ALTER TABLE doc_sessions
  ADD COLUMN raw_text LONGTEXT NULL AFTER title;

-- ── Step 1b: denormalised chunk count ────────────────────────
--
-- The sidebar shows a "N chunks" badge per document, which used to come
-- from a LEFT JOIN onto documents. Counting per-document in Qdrant would
-- mean one request per row on every sidebar load, so the number is stored
-- here at index time instead. It also keeps the document list rendering
-- when the vector store is unreachable.

ALTER TABLE doc_sessions
  ADD COLUMN chunk_count INT NOT NULL DEFAULT 0 AFTER raw_text;

-- ── Step 2: drop the chunk table ─────────────────────────────
--
-- Chunks, their embeddings, and chunk_index now live in Qdrant as
-- point payloads. Only run this once vectors are confirmed in the
-- collection — verify the count first.

DROP TABLE IF EXISTS documents;
