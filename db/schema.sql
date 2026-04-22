-- ============================================================
-- Context-Aware Document Intelligence System
-- Database Schema
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
-- All chunks of that upload are linked to this session.
-- user_id scopes every session to its owner — users cannot
-- access each other's documents.
-- ============================================================

CREATE TABLE IF NOT EXISTS doc_sessions (
  id         INT           AUTO_INCREMENT PRIMARY KEY,
  user_id    INT           NOT NULL,
  title      VARCHAR(255)  NOT NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- Table: documents
--
-- Stores individual text chunks and their embedding vectors.
-- Each chunk belongs to exactly one doc_session via foreign key.
-- Similarity search is always scoped to doc_session_id(s)
-- that belong to the authenticated user.
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
