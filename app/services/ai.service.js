const openai = require('../config/openai');
const { generateEmbedding } = require('./embedding.service');
const { search } = require('./vectorStore.service');

/**
 * Generates an AI answer based only on retrieved document chunks.
 *
 * Steps:
 * 1. Embed the user's question
 * 2. Ask Qdrant for the nearest chunks, filtered to this user's documents
 * 3. Build a prompt that injects those chunks as context
 * 4. Call GPT — strictly constrained to answer from context only
 * 5. Return the answer + the source chunks used
 *
 * Why constrain the LLM to context only?
 * Without constraints, GPT uses its training data and may return
 * plausible-sounding but incorrect answers (hallucination).
 * The system prompt forces it to only use what we provide.
 */

// Single definition, shared by the streaming and non-streaming paths.
// These were previously two identical copies — editing one and forgetting
// the other would have silently given /ask and /ask-stream different rules.
const SYSTEM_PROMPT = `You are a professional document assistant. Your job is to answer questions accurately based strictly on the provided document context.

RULES:
1. Answer ONLY using the context provided. Do not use any external knowledge or training data.
2. If the answer is not in the context, say exactly: "I don't know based on the provided documents."
3. If the context partially answers the question, share what you found and clearly state what is missing.
4. Be concise and professional. Avoid filler phrases like "Certainly!" or "Great question!".
5. Use bullet points for lists or multi-part answers. Use plain paragraphs for single-topic answers.
6. When your answer comes from a specific part of the document, reference it naturally (e.g. "According to the document...").
7. You have access to the conversation history below — use it to understand follow-up questions and references like "it", "that", "the previous answer", etc.
8. Respond in the same language the user asked in.`;

const TOP_N = 5;

// Cap history at last 6 messages (3 exchanges) to keep token usage bounded.
const HISTORY_LIMIT = 6;

/**
 * Retrieval + prompt assembly, shared by both answer paths.
 *
 * Chunks from every selected doc compete on similarity — the best ones win
 * regardless of which document they came from. userId is passed down into the
 * Qdrant payload filter so only this user's chunks are searchable; unlike the
 * old SQL JOIN this is not enforced by the database, so it lives in exactly
 * one place (vectorStore.search) and every caller goes through it.
 */
const buildMessages = async (question, docSessionIds, userId, history) => {
  const questionEmbedding = await generateEmbedding(question);
  const topChunks = await search(questionEmbedding, docSessionIds, userId, TOP_N);

  // If nothing came back, skip GPT entirely. Sending an empty context
  // would cause hallucination or a confusing answer.
  if (topChunks.length === 0) return { messages: null, sources: [] };

  const context = topChunks
    .map((chunk, i) => `[Source ${i + 1}]:\n${chunk.content}`)
    .join('\n\n');

  const recentHistory = history.slice(-HISTORY_LIMIT);

  // Message order: system → past turns → current user question (with context injected)
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recentHistory,
    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
  ];

  const sources = topChunks.map((chunk) => ({
    chunk_index: chunk.chunk_index,
    score:       parseFloat(chunk.score.toFixed(4)),
    content:     chunk.content,
  }));

  return { messages, sources };
};

const generateAnswer = async (question, docSessionIds, userId, history = []) => {
  const { messages, sources } = await buildMessages(question, docSessionIds, userId, history);

  if (!messages) {
    return {
      answer:  "I don't know based on the provided documents.",
      sources: [],
    };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.2, // Low temperature = more focused, less creative answers
  });

  return { answer: response.choices[0].message.content, sources };
};

/**
 * Streaming version of generateAnswer.
 * Returns the OpenAI stream + sources so the controller can
 * pipe tokens to the client as they arrive.
 */
const generateAnswerStream = async (question, docSessionIds, userId, history = []) => {
  const { messages, sources } = await buildMessages(question, docSessionIds, userId, history);

  if (!messages) return { stream: null, sources: [] };

  const stream = await openai.chat.completions.create({
    model:  'gpt-4o-mini',
    stream: true,
    messages,
    temperature: 0.2,
  });

  return { stream, sources };
};

module.exports = { generateAnswer, generateAnswerStream };
