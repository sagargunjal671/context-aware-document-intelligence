const openai = require('../config/openai');
const { generateEmbedding } = require('./embedding.service');
const { findTopChunks } = require('./similarity.service');

/**
 * Generates an AI answer based only on retrieved document chunks.
 *
 * Steps:
 * 1. Embed the user's question
 * 2. Find the top 3 most relevant chunks via cosine similarity
 * 3. Build a prompt that injects those chunks as context
 * 4. Call GPT — strictly constrained to answer from context only
 * 5. Return the answer + the source chunks used
 *
 * Why constrain the LLM to context only?
 * Without constraints, GPT uses its training data and may return
 * plausible-sounding but incorrect answers (hallucination).
 * The system prompt forces it to only use what we provide.
 */
const generateAnswer = async (question, docSessionIds, userId, history = []) => {
  // Step 1: Convert question to embedding vector
  const questionEmbedding = await generateEmbedding(question);

  // Step 2: Find top chunks across ALL selected document sessions.
  // Chunks from every selected doc compete on cosine similarity — the
  // best ones win regardless of which document they came from.
  // userId ensures only chunks owned by this user are searched.
  const topChunks = await findTopChunks(questionEmbedding, docSessionIds, 5, userId);

  // Step 3: If no chunks passed the similarity threshold, skip GPT entirely.
  // Sending an empty context would cause hallucination or a confusing answer.
  if (topChunks.length === 0) {
    return {
      answer:  "I don't know based on the provided documents.",
      sources: [],
    };
  }

  // Step 4: Build context string from retrieved chunks
  const context = topChunks
    .map((chunk, i) => `[Source ${i + 1}]:\n${chunk.content}`)
    .join('\n\n');

  // Step 5: Build conversation history — cap at last 6 messages (3 exchanges)
  // to keep token usage bounded regardless of how long the chat gets.
  const recentHistory = history.slice(-6);

  // Step 6: Call GPT with context + conversation history
  // Message order: system → past turns → current user question (with context injected)
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional document assistant. Your job is to answer questions accurately based strictly on the provided document context.

RULES:
1. Answer ONLY using the context provided. Do not use any external knowledge or training data.
2. If the answer is not in the context, say exactly: "I don't know based on the provided documents."
3. If the context partially answers the question, share what you found and clearly state what is missing.
4. Be concise and professional. Avoid filler phrases like "Certainly!" or "Great question!".
5. Use bullet points for lists or multi-part answers. Use plain paragraphs for single-topic answers.
6. When your answer comes from a specific part of the document, reference it naturally (e.g. "According to the document...").
7. You have access to the conversation history below — use it to understand follow-up questions and references like "it", "that", "the previous answer", etc.
8. Respond in the same language the user asked in.`,
      },
      ...recentHistory,
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.2, // Low temperature = more focused, less creative answers
  });

  const answer = response.choices[0].message.content;

  // Step 5: Return answer along with the source chunks used
  return {
    answer,
    sources: topChunks.map((chunk) => ({
      chunk_index: chunk.chunk_index,
      score:       parseFloat(chunk.score.toFixed(4)),
      content:     chunk.content,
    })),
  };
};

module.exports = { generateAnswer };
