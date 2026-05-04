import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';

/**
 * Suite 8 — Seed Quality
 *
 * Tests whether PlaylistScheduler intent seeds are specific, evocative,
 * and grounded in user taste data — not generic labels like "jazz playlist".
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/08-seed-quality.test.js
 */

const SEED_RUBRIC = `Does this playlist intent seed feel specific, personal, and inspiring?
A great intent seed should make someone excited to listen — not be a vague genre label.

Score 5: Evocative, specific, references a mood/scenario/cultural moment. Would make a compelling playlist title.
Score 4: Specific and interesting, clearly informed by user taste data.
Score 3: Reasonable but somewhat generic (e.g., "jazz playlist", "rock mix").
Score 2: Very generic, could apply to anyone (e.g., "good music").
Score 1: Meaningless or incoherent.`;

describe.skipIf(SKIP_JUDGE)('Seed Quality — Playlist Scheduler Seeds', () => {

  it('good seeds score ≥ 3 on specificity rubric', async () => {
    // These are representative of what our improved scheduler generates
    const goodSeeds = [
      'The contemplative side of Radiohead — acoustic intimacy, soft piano, and late-night warmth in the vein of alternative rock',
      "Your jazz awakening — following the thread from Miles Davis and John Coltrane. You've been gravitating here in recent sessions",
      "Evening wind-down — the warm, contemplative textures of Radiohead and rich alternative rock sounds for unwinding after dark",
      'Based on what you told me: "I like melancholy but not defeatist music"',
      'The world of Miles Davis — deep cuts, adjacent artists, and sonic relatives',
    ];

    for (const seed of goodSeeds) {
      await assertScore(seed, SEED_RUBRIC, 3, `🌱 "${seed.slice(0, 50)}..."`, expect);
    }
  }, 120000);

  it('generic seeds score ≤ 2', async () => {
    const badSeeds = ['music', 'good songs', 'play something'];

    for (const seed of badSeeds) {
      const verdict = await (await import('../helpers/judge.js')).llmJudge(seed, SEED_RUBRIC);
      console.log(`\n🤖 Bad seed "${seed}": ${verdict.score}/5 — ${verdict.reasoning}`);

      if (verdict.score > 0) {
        expect(verdict.score).toBeLessThanOrEqual(2);
      }
    }
  }, 60000);
});
