import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { llmJudge, assertScore } from '../helpers/judge.js';
import { runRealPipeline, TEST_INTENTS } from '../helpers/fixtures.js';

/**
 * Suite 2 — Curator Internal Coherence
 *
 * The Curator now produces BOTH a high-level reflection AND per-track reasons
 * in a single LLM call. This suite verifies they are internally consistent:
 * the reflection's strategy should be echoed in each track's reason.
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/02-curator-coherence.test.js
 */

const COHERENCE_RUBRIC = `A single AI Curator agent produced BOTH a high-level reflection AND per-track reasons for a playlist.
The reflection describes the overall curation strategy. The per-track reasons explain why each individual track was selected.

Evaluate INTERNAL COHERENCE:
Score 5: Per-track reasons explicitly echo the reflection's priorities. If the reflection says "I focused on melancholy", every track reason mentions emotional weight.
Score 4: Consistent themes, no contradictions. Reflection and reasons share vocabulary and priorities.
Score 3: No contradictions but reasons feel generic — could have been written without the reflection's strategy.
Score 2: Minor contradictions (reflection excludes a genre, but a track reason praises it).
Score 1: Direct contradiction between reflection and track reasons.`;

describe.skipIf(SKIP_JUDGE)('Curator Internal Coherence', () => {

  it('Curator reflection is coherent with per-track reasons', async () => {
    const { context } = await runRealPipeline(TEST_INTENTS.LATE_NIGHT_JAZZ);

    // Build the text for the judge
    const trackReasonTexts = [];
    for (const t of context.scoredPlaylist || []) {
      trackReasonTexts.push(`- "${t.track?.name || '?'}" by ${t.artistName || '?'}: ${t.dominantFactor || '(no reason)'}`);
    }

    const combined = `CURATOR'S REFLECTION:\n${context.curatorReflection || '(none)'}\n\nCURATOR'S PER-TRACK REASONS:\n${trackReasonTexts.join('\n') || '(none)'}`;

    console.log('\n=== Coherence Test ===');
    console.log(combined.slice(0, 1500));

    await assertScore(combined, COHERENCE_RUBRIC, 3, '🏛️ Coherence', expect);
  }, 240000);
});
