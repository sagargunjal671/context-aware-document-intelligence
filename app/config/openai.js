const OpenAI = require('openai');

// Initialize OpenAI client once and reuse across all services
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = openai;
