require('dotenv').config();

const { generateEmbeddings } = require('../app/services/embedding.service');
const { cosineSimilarity }   = require('../app/services/similarity.service');
const { search, scrollAllVectors } = require('../app/services/vectorStore.service');
const pool = require('../app/config/db');

/**
 * Measures approximate (HNSW) search against exact search.
 *
 *   npm run benchmark
 *
 * WHY THIS SCRIPT EXISTS
 *
 * Qdrant's HNSW index does not look at every vector. It walks a navigable
 * graph and examines a small fraction of the collection, which is why it stays
 * fast as data grows — and why it can miss a true nearest neighbour. That is
 * the central trade of every vector database: a small, bounded loss of
 * accuracy in exchange for not doing O(n) work on every query.
 *
 * "Small" is doing a lot of work in that sentence, so this measures it.
 *
 * RECALL@5 is the fraction of the true top-5 that the approximate search also
 * returned. Exact search is correct by definition, so it serves as ground
 * truth. 1.00 means the fast path agreed completely.
 *
 * EF (hnsw_ef) is the size of the candidate list HNSW keeps while searching.
 * Larger ef explores more of the graph: better recall, slower queries. It is
 * a per-query knob, so it can be tuned without rebuilding the index. Sweeping
 * it shows the curve rather than a single number.
 *
 * QUERIES are sampled from the stored chunks themselves — a chunk's own text
 * is a realistic query with a known-relevant answer, and it avoids hand-writing
 * questions that happen to flatter the index.
 *
 * Note on timings: the exact path is timed for SCORING ONLY. Its vectors are
 * fetched once up front rather than per query, which is generous to it — the
 * real implementation had to load them every time. The comparison is therefore
 * conservative: ANN's true advantage is larger than what prints below.
 */

const TOP_N       = 5;
const EF_VALUES   = [16, 32, 64, 128, 256];
const NUM_QUERIES = 10;

// Chunks are ~500 chars; a query that long is unrealistic, so use the opening
// sentence-ish span, which is what a user would actually type.
const QUERY_CHARS = 160;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const benchmark = async () => {
  // Pick the user with the most indexed documents so the script needs no args.
  const [rows] = await pool.execute(`
    SELECT user_id, COUNT(*) AS n, SUM(chunk_count) AS chunks
    FROM doc_sessions
    GROUP BY user_id
    ORDER BY chunks DESC
    LIMIT 1
  `);

  if (rows.length === 0) {
    console.log('No documents indexed. Upload something first.');
    return;
  }

  const userId = rows[0].user_id;

  const [sessionRows] = await pool.execute(
    'SELECT id FROM doc_sessions WHERE user_id = ?',
    [userId]
  );
  const docSessionIds = sessionRows.map((r) => r.id);

  console.log(`user ${userId} · ${docSessionIds.length} document(s)\n`);
  console.log('Loading vectors for the exact baseline...');

  const allVectors = await scrollAllVectors(docSessionIds, userId);

  if (allVectors.length === 0) {
    console.log('Collection is empty for this user. Run `npm run reindex` or upload a document.');
    return;
  }

  console.log(`${allVectors.length} vectors in the collection\n`);

  // Below roughly this size HNSW has nothing to prune: the smallest ef in the
  // sweep already exceeds the number of vectors, so every search examines the
  // whole collection and recall is 1.000 by construction rather than by merit.
  const MEANINGFUL_SIZE = Math.max(EF_VALUES[0] * 4, 200);

  if (allVectors.length < MEANINGFUL_SIZE) {
    console.log(`Only ${allVectors.length} vectors. The smallest ef in the sweep (${EF_VALUES[0]}) is`);
    console.log('already comparable to the collection size, so every search sees everything');
    console.log('and recall will read 1.000 at every ef — that is the benchmark having');
    console.log(`nothing to measure, not perfect accuracy. Index ~${MEANINGFUL_SIZE}+ chunks`);
    console.log('(a few long PDFs) before reading anything into these numbers.\n');
  }

  // Sample chunks to use as queries.
  const step    = Math.max(1, Math.floor(allVectors.length / NUM_QUERIES));
  const sampled = [];
  for (let i = 0; i < allVectors.length && sampled.length < NUM_QUERIES; i += step) {
    sampled.push(allVectors[i]);
  }

  const queryTexts = sampled.map((c) => c.content.slice(0, QUERY_CHARS).trim());

  console.log(`Embedding ${queryTexts.length} queries...`);
  const queryEmbeddings = await generateEmbeddings(queryTexts);

  // ── Exact baseline — ground truth ──────────────────────────
  const exactResults = [];
  const exactTimes   = [];

  for (const qe of queryEmbeddings) {
    const t0 = performance.now();
    const top = allVectors
      .map((c) => ({ id: c.id, score: cosineSimilarity(qe, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
    exactTimes.push(performance.now() - t0);
    exactResults.push(new Set(top.map((r) => r.id)));
  }

  console.log(`\n${'ef'.padEnd(8)}${'recall@5'.padEnd(12)}${'median ms'.padEnd(12)}`);
  console.log('-'.repeat(32));
  console.log(
    `${'exact'.padEnd(8)}${'1.000'.padEnd(12)}${median(exactTimes).toFixed(1).padEnd(12)}`
  );

  // ── Approximate search at each ef ──────────────────────────
  for (const ef of EF_VALUES) {
    const recalls = [];
    const times   = [];

    for (let i = 0; i < queryEmbeddings.length; i++) {
      const t0   = performance.now();
      const hits = await search(queryEmbeddings[i], docSessionIds, userId, TOP_N, ef);
      times.push(performance.now() - t0);

      const truth   = exactResults[i];
      const matched = hits.filter((h) => truth.has(h.id)).length;
      recalls.push(matched / Math.min(TOP_N, truth.size));
    }

    const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;

    console.log(
      `${String(ef).padEnd(8)}${avgRecall.toFixed(3).padEnd(12)}${median(times).toFixed(1).padEnd(12)}`
    );
  }

  console.log(`\nANN timings include a network round-trip to Qdrant Cloud;`);
  console.log(`exact timings are local scoring only, with vectors already in memory.`);
  console.log(`On a collection this size exact search still wins on latency — the`);
  console.log(`crossover arrives as the corpus grows, because exact is O(n) and`);
  console.log(`HNSW is roughly O(log n).`);
};

benchmark()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nBenchmark failed:', err.message);
    await pool.end();
    process.exit(1);
  });
