import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';
import { runRealPipeline, buildTasteState, TEST_INTENTS } from '../helpers/fixtures.js';

/**
 * Suite 3 — Intent Fidelity
 *
 * Same taste profile, dramatically different intents → playlists MUST differ.
 * The Curator should respect the intent even when it conflicts with the user's
 * habitual taste (e.g., a jazz fan requesting a workout mix).
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/03-intent-fidelity.test.js
 */

const INTENT_FIDELITY_RUBRIC = `Three playlists were generated from the SAME user taste profile but with different intents.
The user's profile: alternative rock, jazz, electronic, indie (Jeff Buckley #1, Radiohead #2, Miles Davis #3).

CRITICAL: Each playlist must AUTHENTICALLY serve its intent. The user's taste should inform artist selection
but must NOT override the intent's genre/mood/energy requirements.

For each playlist, evaluate:
Score 5: Every track fits the intent. Taste informs choices without overriding them. The 3 playlists are dramatically different.
Score 4: Mostly on-intent with 1-2 stretches. Playlists are clearly different from each other.
Score 3: Partially on-intent but user favorites dominate 3+ slots regardless of intent.
Score 2: Intent is partially ignored — playlists look too similar to each other.
Score 1: All three playlists are essentially the same regardless of intent.`;

describe.skipIf(SKIP_JUDGE)('Intent Fidelity — Different Intents, Same Profile', () => {

  it('different intents produce different playlists from same profile', async () => {
    const tasteState = buildTasteState();

    const intents = [
      TEST_INTENTS.JAZZ_DEEP_DIVE,
      TEST_INTENTS.HIGH_ENERGY,
      TEST_INTENTS.AMBIENT_STUDY,
    ];

    // Run all 3 pipelines in parallel — they are independent
    console.log('\n🎵 Running 3 intent-differentiated pipelines in parallel...');
    const results = await Promise.all(
      intents.map(intent => runRealPipeline(intent, tasteState))
    );

    const playlists = results.map((r, i) => {
      const trackList = (r.context.scoredPlaylist || []).map(t => `${t.artistName} - ${t.track.name}`);
      return { intent: intents[i], tracks: trackList, title: r.context.explanations?.playlistTitle || '(none)' };
    });

    for (const p of playlists) {
      console.log(`\n   → "${p.intent}": ${p.tracks.length} tracks — ${p.title}`);
      console.log(`     Artists: ${p.tracks.map(t => t.split(' - ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
    }

    const combined = playlists.map((p, i) =>
      `PLAYLIST ${i + 1} — Intent: "${p.intent}"\nTitle: ${p.title}\nTracks:\n${p.tracks.map(t => `  - ${t}`).join('\n')}`
    ).join('\n\n');

    console.log('\n=== Intent Fidelity Test ===');
    console.log(combined.slice(0, 3000));

    await assertScore(combined, INTENT_FIDELITY_RUBRIC, 3, '🎯 Intent Fidelity', expect);
  }, 600000); // 10 min — three pipeline runs + judge
});
