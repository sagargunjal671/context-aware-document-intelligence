# 🧠 Context-Aware Document Intelligence System

![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.x-4479A1?logo=mysql&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

A production-ready **RAG (Retrieval-Augmented Generation)** system that lets you upload documents and ask questions about them. Built from scratch using Node.js and MySQL — **no vector database required**. Custom cosine similarity search, document session isolation, and a polished chat UI included.

---

## ✨ Features

- **Multi-document management** — Upload multiple documents; each is isolated in its own session
- **Document-scoped Q&A** — Questions only search the selected document, preventing cross-document contamination
- **Custom vector search** — Cosine similarity implemented in pure JavaScript (no Pinecone, no FAISS)
- **Similarity threshold** — Chunks below 0.3 score are filtered before GPT sees them (prevents hallucination)
- **File upload support** — PDF, DOCX, and TXT files processed in-memory via Multer
- **Markdown rendering** — AI answers render bullet points, bold text, and code blocks properly
- **Rate limiting** — Protects OpenAI API key from abuse (20 req/15 min on `/ask`, 10 on uploads)
- **Request logging** — Morgan HTTP logger for every request
- **Knowledge base stats** — Live document and chunk counts in the UI
- **Dark / light theme** — Fully themed chat interface

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          UPLOAD PIPELINE                         │
│                                                                  │
│  File / Text  →  Extract Text  →  Chunk (500c, 100 overlap)     │
│                                       ↓                          │
│                               Embed each chunk                   │
│                          (text-embedding-3-small)                │
│                                       ↓                          │
│                    Store in MySQL  ←  doc_session_id             │
│                  (content + JSON embedding)                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          QUERY PIPELINE                          │
│                                                                  │
│  Question  →  Embed question  →  Load chunks for session        │
│                                       ↓                          │
│                       Cosine Similarity score each chunk        │
│                                       ↓                          │
│                    Filter  score < 0.3  →  discard             │
│                                       ↓                          │
│                       Top 3 chunks  →  Build context            │
│                                       ↓                          │
│                        GPT-4o-mini  →  Answer + Sources         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer          | Technology                          | Purpose                              |
|----------------|--------------------------------------|--------------------------------------|
| Runtime        | Node.js 22                           | JavaScript server runtime            |
| Framework      | Express 5                            | REST API routing                     |
| Database       | MySQL 8 + mysql2                     | Chunk and session storage            |
| Embeddings     | OpenAI text-embedding-3-small        | 1536-dim vector generation           |
| Chat Model     | OpenAI gpt-4o-mini                   | Constrained answer generation        |
| File Parsing   | pdf-parse, mammoth                   | PDF and DOCX text extraction         |
| File Upload    | Multer (memory storage)              | In-memory file buffer — no disk I/O  |
| Rate Limiting  | express-rate-limit                   | API abuse prevention                 |
| Logging        | Morgan                               | HTTP request logging                 |
| Markdown       | marked (CDN)                         | Renders AI answers in the browser    |

---

## 📁 Project Structure

```
├── app/
│   ├── config/
│   │   ├── db.js                    # MySQL connection pool (limit: 10)
│   │   └── openai.js                # Singleton OpenAI client
│   ├── models/
│   │   └── document.model.js        # All DB queries (sessions + chunks + stats)
│   ├── services/
│   │   ├── chunking.service.js      # Split text: 500 chars, 100 overlap
│   │   ├── embedding.service.js     # OpenAI embeddings call
│   │   ├── similarity.service.js    # Cosine similarity + threshold filter
│   │   ├── ai.service.js            # Prompt engineering + GPT call
│   │   └── fileParser.service.js    # PDF / DOCX / TXT text extraction
│   └── controllers/
│       └── ai.controller.js         # Request handlers for all routes
├── routes/
│   └── ai.routes.js                 # Routes + rate limiter middleware
├── public/
│   └── index.html                   # Full-stack chat UI (vanilla JS)
├── db/
│   └── schema.sql                   # MySQL schema (doc_sessions + documents)
├── index.js                         # Express entry point + Morgan
└── .env.example                     # Environment variable template
```

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/context-aware-document-intelligence.git
cd context-aware-document-intelligence
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
PORT=3000
OPENAI_API_KEY=sk-...your-openai-key...
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=rag_chatbot
```

### 4. Set up the database

Run the schema in phpMyAdmin or MySQL CLI:

```bash
mysql -u root -p < db/schema.sql
```

### 5. Start the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Open `http://localhost:3000` in your browser.

---

## 📡 API Reference

### `POST /api/ai/add`
Upload a plain text document.

**Request:**
```json
{ "content": "Your document text...", "title": "Optional title" }
```
**Response:**
```json
{ "success": true, "doc_session_id": 3, "chunks_stored": 6 }
```

---

### `POST /api/ai/upload`
Upload a PDF, DOCX, or TXT file (multipart/form-data, field name: `file`, max 10MB).

**Response:**
```json
{ "success": true, "doc_session_id": 4, "chunks_stored": 11 }
```

---

### `POST /api/ai/ask`
Ask a question scoped to one document session. Rate limited: 20 req / 15 min.

**Request:**
```json
{ "question": "What is the annual leave policy?", "doc_session_id": 3 }
```
**Response:**
```json
{
  "question": "What is the annual leave policy?",
  "answer": "According to the document, employees are entitled to 20 days...",
  "sources": [
    { "chunk_index": 1, "score": 0.8742, "content": "Annual Leave: All full-time employees..." }
  ]
}
```

---

### `GET /api/ai/documents`
List all uploaded document sessions.

**Response:**
```json
{ "documents": [{ "id": 3, "title": "HR Policy 2024", "created_at": "2024-01-15T10:30:00Z" }] }
```

---

### `DELETE /api/ai/documents/:id`
Delete a document session and all its chunks (CASCADE).

**Response:**
```json
{ "success": true, "message": "Document deleted" }
```

---

### `GET /api/ai/stats`
Get total document and chunk counts for the knowledge base.

**Response:**
```json
{ "doc_count": 3, "chunk_count": 27 }
```

---

## 🧩 Key Concepts

**Why no vector database?**
This project uses MySQL's `JSON` column to store embedding arrays and computes cosine similarity in Node.js at query time. For a portfolio project this demonstrates deep understanding of the math — production systems with millions of chunks would add FAISS or Pinecone for scale.

**Document Session Isolation**
Every uploaded document gets a `doc_session_id`. All similarity searches use `WHERE doc_session_id = ?`, so questions are always answered from one specific document. Two users uploading different files never get mixed results.

**Cosine Similarity vs Euclidean Distance**
We use cosine similarity because we care about the *direction* of a vector (what the text means), not its *magnitude* (how long the text is). Two chunks about the same topic produce vectors pointing in the same direction regardless of length.

**Similarity Threshold (0.3)**
Chunks scoring below 0.3 are dropped before GPT sees them. If no chunks pass, the system returns "I don't know" immediately — skipping the GPT call entirely and saving API cost.

**Chunking with Overlap**
Documents are split into 500-character chunks with a 100-character overlap between adjacent chunks. The overlap prevents important information from being cut at a boundary and lost from both chunks.

**Prompt Engineering**
Seven rules constrain the LLM: answer only from context, say "I don't know" if the answer isn't there, no filler phrases, respond in the user's language, etc. `temperature: 0.2` keeps answers focused and consistent.

---

## 🔮 Future Enhancements

- **User authentication** — JWT auth + `user_id` FK on `doc_sessions`; all queries scoped to `WHERE doc_session_id IN (?) AND user_id = ?` so users can only access their own documents. Currently single-user/demo only — doc IDs are not access-controlled.
- **Redis caching** — Cache embeddings for repeated questions to cut API costs
- **Streaming responses** — OpenAI streaming API for real-time token output in the UI
- **FAISS / Pinecone** — Replace MySQL similarity search for large-scale deployments
- **Re-ranking** — Add a cross-encoder pass after cosine retrieval for higher accuracy
- **Chunk metadata** — Store page numbers and headings for richer source attribution

---

## 📄 License

MIT
