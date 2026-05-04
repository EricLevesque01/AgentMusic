import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';
import { runRealPipeline, TEST_INTENTS } from '../helpers/fixtures.js';

/**
 * Suite 6 — Artist Authenticity
 *
 * Are all recommended artists REAL musicians? No hallucinated or AI-farm names.
 * This is a critical safety check — hallucinated artists make the system untrustworthy.
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/06-authenticity.test.js
 */

const AUTHENTICITY_RUBRIC = `This is a list of artists selected by an AI music curator. Evaluate whether ALL artists are REAL.

Score 5: Every single artist is a real, verifiable musician with a real discography. Zero hallucinations.
Score 4: All artists appear real. 1 may be obscure but plausible.
Score 3: Most artists are real but 1-2 are suspicious (could be hallucinated or AI content farm names like "Relaxing Jazz Ensemble").
Score 2: 3+ artists seem hallucinated or are AI content farms.
Score 1: Multiple clearly fake artists. Pipeline is hallucinating.`;

describe.skipIf(SKIP_JUDGE)('Artist Authenticity', () => {

  it('all recommended artists are real musicians', async () => {
    const { context } = await runRealPipeline(TEST_INTENTS.JAZZ_STANDARDS);

    const artists = [...new Set((context.scoredPlaylist || []).map(t => t.artistName))];
    const artistList = artists.map(a => `- ${a}`).join('\n');

    console.log('\n=== Authenticity Test ===');
    console.log(`${artists.length} unique artists in playlist:`);
    console.log(artistList);

    await assertScore(`Artists in the generated playlist:\n${artistList}`, AUTHENTICITY_RUBRIC, 4, '✅ Authenticity', expect);
  }, 240000);
});
