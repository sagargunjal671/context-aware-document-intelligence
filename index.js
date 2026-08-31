require('dotenv').config();
const express    = require('express');
const path       = require('path');
const morgan     = require('morgan');
const aiRoutes   = require('./routes/ai.routes');
const authRoutes = require('./routes/auth.routes');
const { ensureCollection } = require('./app/services/vectorStore.service');

const app = express();

// Log every HTTP request: method, path, status code, response time
// 'dev' format → e.g.  POST /api/ai/ask 200 143ms
app.use(morgan('dev'));

// Parse incoming JSON request bodies
app.use(express.json());

// Serve frontend from /public folder
app.use(express.static(path.join(__dirname, 'public')));

// Public routes — no token required
app.use('/api/auth', authRoutes);

// Protected routes — verifyToken middleware applied inside ai.routes.js
app.use('/api/ai', aiRoutes);

const PORT = process.env.PORT || 3000;

// Create the Qdrant collection (with its payload indexes) if it isn't there
// yet, then start listening. Unlike MySQL there is no schema.sql to run for
// the vector store — the collection is defined in code, so this is what makes
// a fresh clone work without manual setup.
//
// Startup fails loudly on a bad URL or key rather than letting the server come
// up and return 500s on the first question.
ensureCollection()
  .then((created) => {
    if (created) console.log(`Qdrant collection created`);
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to reach Qdrant — check QDRANT_URL and QDRANT_API_KEY');
    console.error(err.message);
    process.exit(1);
  });
