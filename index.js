require('dotenv').config();
const express  = require('express');
const path     = require('path');
const morgan   = require('morgan');
const aiRoutes = require('./routes/ai.routes');

const app = express();

// Log every HTTP request: method, path, status code, response time
// 'dev' format → e.g.  POST /api/ai/ask 200 143ms
app.use(morgan('dev'));

// Parse incoming JSON request bodies
app.use(express.json());

// Serve frontend from /public folder
app.use(express.static(path.join(__dirname, 'public')));

// Mount AI routes under /api/ai
app.use('/api/ai', aiRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
