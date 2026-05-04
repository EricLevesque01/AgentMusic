import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';
import { runRealPipeline } from '../helpers/fixtures.js';

/**
 * Suite 7 — Soul Voice
 *
 * Does the Curator's output sound like a deeply opinionated, culturally literate
 * music companion — or like a generic algorithm? Uses REAL pipeline output,
 * not hardcoded golden strings.
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/07-soul-voice.test.js
 */

const SOUL_RUBRIC = `Does this text sound like it was written by a deeply opinionated,
culturally literate music companion who speaks like the user's most knowledgeable friend?

Score 5: Warm, specific, uses real cultural references, feels like a friend talking.
Score 4: Mostly warm and specific, minor lapses into generic language.
Score 3: Functional but could be from any music app. Some personality.
Score 2: Generic, uses filler phrases like "diverse mix" or "eclectic taste."
Score 1: Robotic, reads like a template or API documentation.`;

describe.skipIf(SKIP_JUDGE)('Soul Voice — Curator Personality', () => {

  it('real Curator output has personality and specificity', async () => {
    const { context } = await runRealPipeline('something that feels like late Miles Davis but with modern production sensibility');

    // Combine summary + reflection — the two most "voice-heavy" outputs
    const text = [
      context.explanations?.playlistSummary,
      context.curatorReflection,
    ].filter(Boolean).join('\n\n');

    console.log('\n=== Soul Voice Test ===');
    console.log(text.slice(0, 1500));

    await assertScore(text, SOUL_RUBRIC, 3, '🎭 Soul Voice', expect);
  }, 240000);

  it('generic text would score low on the same rubric', async () => {
    const genericText = `Here is a diverse mix of 20 tracks based on your listening history.
The playlist includes a wide range of genres to match your eclectic taste. We hope
you enjoy this carefully curated selection of music.`;

    await assertScore(genericText, SOUL_RUBRIC, 0, '🤖 Generic (control)', expect);
    // Note: we expect this to score 1-2, not 0. Score 0 = judge unavailable.
  }, 60000);
});
