import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';
import { runRealPipeline, TEST_INTENTS } from '../helpers/fixtures.js';

/**
 * Suite 5 — Personalization Depth
 *
 * Does the Curator use SPECIFIC user context (anchor artist, explicit preferences,
 * dismissed artists) instead of generic filler like "based on your taste"?
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/05-personalization.test.js
 */

const PERSONALIZATION_RUBRIC = `This playlist output was generated for a user with this specific taste profile:
- #1 Artist: Jeff Buckley (Elo 1800, 12 wins / 2 losses — confirmed anchor)
- #2: Radiohead, #3: Miles Davis, #4: Björk, #5: Big Thief
- Core genres: alternative rock, art rock, jazz
- User stated: "I like melancholy but not defeatist music" and "Jeff Buckley is my north star artist"
- Actively dismissed: Ed Sheeran
- Discovery profile: Low mainstream (0.35), High specialist (0.6)

Evaluate how deeply PERSONALIZED the output is:
Score 5: References Jeff Buckley as anchor by name. Mentions specific user preferences. Tone matches a "specialist, non-mainstream" listener. No generic filler.
Score 4: References most user context — specific artist names, genres, preferences.
Score 3: Some personalization but could apply to many alternative rock fans.
Score 2: Generic personalization ("based on your taste", "curated for you").
Score 1: No personalization whatsoever.`;

describe.skipIf(SKIP_JUDGE)('Personalization Depth', () => {

  it('output reflects the specific user profile', async () => {
    const { context } = await runRealPipeline(TEST_INTENTS.ARTIST_DEEP_DIVE);

    // Build text for judging
    const parts = [];
    parts.push(`PLAYLIST TITLE: ${context.explanations?.playlistTitle || '(none)'}`);
    parts.push(`SUMMARY: ${context.explanations?.playlistSummary || '(none)'}`);
    parts.push(`CURATOR REFLECTION: ${context.curatorReflection || '(none)'}`);
    parts.push(`\nTRACKS:`);

    const expls = context.explanations?.trackExplanations;
    for (const t of context.scoredPlaylist || []) {
      const expl = expls instanceof Map ? expls.get(t.track.id) : expls?.[t.track.id];
      parts.push(`- ${t.artistName} — ${t.track.name}: ${expl || t.dominantFactor || '(no explanation)'}`);
    }

    const fullText = parts.join('\n');

    console.log('\n=== Personalization Test ===');
    console.log(fullText.slice(0, 2000));

    await assertScore(fullText, PERSONALIZATION_RUBRIC, 3, '👤 Personalization', expect);
  }, 240000);
});
