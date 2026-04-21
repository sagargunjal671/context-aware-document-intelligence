-- ============================================================
-- Context-Aware Document Intelligence System
-- Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS rag_chatbot;
USE rag_chatbot;

-- ============================================================
-- Table: doc_sessions
--
-- Each upload (text or file) creates one session record.
-- All chunks of that upload are linked to this session.
-- This isolates documents from each other so questions are
-- always answered from one specific document only.
--
-- Future extension: add user_id here for multi-user support.
-- ============================================================

CREATE TABLE IF NOT EXISTS doc_sessions (
  id         INT           AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(255)  NOT NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table: documents
--
-- Stores individual text chunks and their embedding vectors.
-- Each chunk belongs to exactly one doc_session via foreign key.
-- Similarity search is always scoped to a single doc_session_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id             INT     AUTO_INCREMENT PRIMARY KEY,
  doc_session_id INT     NOT NULL,
  content        TEXT    NOT NULL,
  embedding      JSON    NOT NULL,
  chunk_index    INT     DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (doc_session_id) REFERENCES doc_sessions(id) ON DELETE CASCADE
);
