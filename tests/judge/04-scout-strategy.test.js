import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { assertScore } from '../helpers/judge.js';
import { buildTasteState, TEST_INTENTS } from '../helpers/fixtures.js';
import { ScoutAgent } from '../../src/agents/scout-agent.js';
import { PipelineContext } from '../../src/agents/pipeline-context.js';

/**
 * Suite 4 — Scout Strategy Differentiation
 *
 * Different intents should cause the Scout to adopt different retrieval strategies.
 * A "classical piano" request should not explore the same graph paths as "90s grunge".
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/04-scout-strategy.test.js
 */

const SCOUT_DIFFERENTIATION_RUBRIC = `Two Scout agent outputs were generated from different session intents
for the same user. Evaluate whether the Scout's retrieval strategies are MEANINGFULLY different.

Score 5: Completely different strategies — different artists searched, different sources used, different hop depths.
Score 4: Clearly different in most aspects. Some shared artists are justified (they appear in the user's core taste).
Score 3: Some differentiation but significant overlap in approach.
Score 2: Strategies are mostly similar with minor wording differences.
Score 1: Essentially identical regardless of intent.`;

describe.skipIf(SKIP_JUDGE)('Scout Strategy Differentiation', () => {

  it('Scout adapts its strategy to different intents', async () => {
    const tasteState = buildTasteState();

    function createThoughtCollector() {
      const thoughts = [];
      return { record: (msg) => thoughts.push(msg), thoughts };
    }

    const run = async (intent) => {
      const ctx = PipelineContext.create('test_user', intent);
      ctx.tasteState = tasteState;
      ctx.tasteProfile = { dominantGenres: tasteState.topGenres.slice(0, 3), underExploredGenres: [], anchoredTopArtist: 'Jeff Buckley', driftSummary: '' };
      ctx.blackboard.profiler = { musicDimensions: tasteState.musicDimensions, discoveryProfile: tasteState.discoveryProfile, genreDistribution: tasteState.genreDistribution, driftPatterns: [] };
      const collector = createThoughtCollector();
      const scout = new ScoutAgent();
      await scout.findCandidates(tasteState, intent, ctx, collector.record);
      return { thoughts: collector.thoughts, blackboard: ctx.blackboard.scout, poolSize: ctx.candidatePool?.length || 0 };
    };

    console.log('\n🔍 Running Scout with intent A: "explore classical piano"...');
    const a = await run(TEST_INTENTS.CLASSICAL_PIANO);

    console.log('🔍 Running Scout with intent B: "90s grunge deep cuts"...');
    const b = await run(TEST_INTENTS.GRUNGE);

    const combined = `SCOUT RUN A — Intent: "${TEST_INTENTS.CLASSICAL_PIANO}"
Strategy: ${a.blackboard.searchStrategy}
Sources: ${JSON.stringify(a.blackboard.sourceBreakdown)}
Agent thoughts:
${a.thoughts.slice(0, 8).map(t => `  - ${t}`).join('\n')}

SCOUT RUN B — Intent: "${TEST_INTENTS.GRUNGE}"
Strategy: ${b.blackboard.searchStrategy}
Sources: ${JSON.stringify(b.blackboard.sourceBreakdown)}
Agent thoughts:
${b.thoughts.slice(0, 8).map(t => `  - ${t}`).join('\n')}`;

    console.log('\n=== Scout Differentiation ===');
    console.log(combined);

    await assertScore(combined, SCOUT_DIFFERENTIATION_RUBRIC, 3, '🔎 Scout Differentiation', expect);
  }, 300000);
});
