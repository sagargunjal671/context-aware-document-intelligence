const express   = require('express');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const router    = express.Router();
const { addDocument, askQuestion, uploadFile, getDocuments, deleteDocument, getKnowledgeStats } = require('../app/controllers/ai.controller');
const { verifyToken } = require('../app/middleware/auth.middleware');

// Store uploaded files in memory as Buffer (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ── Rate Limiters ─────────────────────────────────────────────
//
// Why rate limit?
// The /ask route calls OpenAI on every request. Without a limit,
// a single user could spam it and run up the API bill quickly.
// The /add and /upload routes embed text — also a paid operation.
//
// windowMs: the rolling time window
// max:      max requests allowed per IP in that window
// message:  the JSON response sent when the limit is hit

const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  message:  { error: 'Too many questions. Please wait 15 minutes and try again.' },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      10,
  message:  { error: 'Too many uploads. Please wait 15 minutes and try again.' },
});

// All routes below require a valid JWT — verifyToken populates req.user
router.use(verifyToken);

// POST /api/ai/add     → Store raw text document
router.post('/add', uploadLimiter, addDocument);

// POST /api/ai/upload  → Upload PDF / DOCX / TXT file
router.post('/upload', uploadLimiter, upload.single('file'), uploadFile);

// POST /api/ai/ask          → Ask a question against stored documents
router.post('/ask', askLimiter, askQuestion);

// GET  /api/ai/stats         → Total document + chunk counts for UI stats bar
router.get('/stats', getKnowledgeStats);

// GET  /api/ai/documents     → List all uploaded document sessions
router.get('/documents', getDocuments);

// DELETE /api/ai/documents/:id → Delete a session and all its chunks
router.delete('/documents/:id', deleteDocument);

module.exports = router;
