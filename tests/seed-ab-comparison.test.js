import { describe, it, expect } from 'vitest';

/**
 * Seed Quality A/B — v1 (old) vs v2 (improved)
 *
 * Run with: RUN_OLLAMA_JUDGE=1 npx vitest run tests/seed-ab-comparison.test.js
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const SKIP = !process.env.RUN_OLLAMA_JUDGE;

async function ollamaJudge(text, rubric) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: 'You are a strict evaluator for a music discovery AI. Respond with ONLY valid JSON, no markdown.' },
        { role: 'user', content: `RUBRIC:\n${rubric}\n\nTEXT:\n"""\n${text}\n"""\n\nScore 1-5. Return ONLY: {"score": <1-5>, "reasoning": "<brief>"}` },
      ],
      stream: false,
      options: { temperature: 0.1, num_predict: 200 },
    }),
  });
  const data = await res.json();
  const reply = (data.message?.content || '').replace(/```json|```/g, '').trim();
  try {
    const match = reply.match(/\{[^}]+\}/);
    return match ? JSON.parse(match[0]) : { score: 0, reasoning: 'parse error' };
  } catch { return { score: 0, reasoning: 'parse error' }; }
}

const RUBRIC = `Does this playlist intent seed feel specific, personal, and inspiring?
Score 5: Evocative, references specific artists/genres from user's taste, paints a scene. Would make a compelling Spotify playlist title.
Score 4: Specific and interesting, clearly informed by user taste data (mentions real artist names or genres).
Score 3: Reasonable but somewhat generic. Could apply to many users.
Score 2: Very generic, no user-specific data (e.g., "good music", "explore jazz").
Score 1: Meaningless or incoherent.`;

describe.skipIf(SKIP)('Seed A/B Comparison — v1 vs v2', () => {
  it('v2 seeds score meaningfully higher than v1', async () => {
    const pairs = [
      {
        label: 'dimension',
        v1: 'Smooth, atmospheric, and emotionally warm — acoustic intimacy',
        v2: 'The contemplative side of Radiohead — acoustic intimacy, soft piano, and late-night warmth in the vein of alternative rock',
      },
      {
        label: 'drift',
        v1: "Deep dive into jazz — you've been gravitating here",
        v2: "Your jazz awakening — following the thread from Miles Davis and John Coltrane. You've been gravitating here in recent sessions — let's go deeper into the subgenres and scenes you haven't found yet",
      },
      {
        label: 'coverage_gap',
        v1: "Explore electronic — a genre you haven't fully explored yet",
        v2: "Your alternative rock ear might love the electronic world — artists who share the DNA of Radiohead but operate in electronic. Think cross-pollination, not genre tourism",
      },
      {
        label: 'temporal',
        v1: 'Evening unwind — warm, contemplative, rich textures',
        v2: 'Evening wind-down — the warm, contemplative textures of Radiohead and rich alternative rock sounds for unwinding after dark',
      },
      {
        label: 'artist_dive',
        v1: 'The world of Miles Davis — deep cuts, adjacent artists, and sonic relatives',
        v2: 'Deep inside the world of Miles Davis — the collaborators, side projects, influences, and sonic descendants that make jazz and modal jazz what it is. Deep cuts welcome',
      },
      {
        label: 'memory',
        v1: 'Based on what you told me: "I like melancholy but not defeatist music"',
        v2: 'You told me: "I like melancholy but not defeatist music" Given your love of Radiohead and Miles Davis, — here\'s what that sounds like as a playlist',
      },
    ];

    console.log('\n═══ SEED A/B COMPARISON ═══\n');
    console.log(`${'Type'.padEnd(14)} | ${'v1 Score'.padEnd(9)} | ${'v2 Score'.padEnd(9)} | Delta`);
    console.log('─'.repeat(55));

    let v1Total = 0, v2Total = 0;

    for (const { label, v1, v2 } of pairs) {
      const [r1, r2] = await Promise.all([
        ollamaJudge(v1, RUBRIC),
        ollamaJudge(v2, RUBRIC),
      ]);

      v1Total += r1.score;
      v2Total += r2.score;
      const delta = r2.score - r1.score;
      const arrow = delta > 0 ? `✅ +${delta}` : delta < 0 ? `❌ ${delta}` : '➡️  0';

      console.log(`${label.padEnd(14)} | ${String(r1.score + '/5').padEnd(9)} | ${String(r2.score + '/5').padEnd(9)} | ${arrow}`);
      if (delta > 0) console.log(`  v2 why: ${r2.reasoning}`);
      if (delta < 0) console.log(`  v1 why: ${r1.reasoning}`);
    }

    const v1Avg = v1Total / pairs.length;
    const v2Avg = v2Total / pairs.length;

    console.log('─'.repeat(55));
    console.log(`${'AVERAGE'.padEnd(14)} | ${(v1Avg.toFixed(1) + '/5').padEnd(9)} | ${(v2Avg.toFixed(1) + '/5').padEnd(9)} | ${v2Avg > v1Avg ? '✅' : '❌'} Δ${(v2Avg - v1Avg).toFixed(1)}`);
    console.log(`\n📈 Improvement: ${((v2Avg - v1Avg) / v1Avg * 100).toFixed(0)}%`);

    expect(v2Avg).toBeGreaterThan(v1Avg);
  }, 120000);
});
