import { describe, it, expect } from 'vitest';
import '../helpers/setup.js';
import { SKIP_JUDGE } from '../helpers/setup.js';
import { runRealPipeline, buildTasteState, TEST_INTENTS } from '../helpers/fixtures.js';

/**
 * Suite 1 — Pipeline Smoke Test
 *
 * Verifies the full Scout → Curator pipeline runs without crashing
 * and populates all required structural fields.
 * NO LLM judge needed — pure structural assertions.
 *
 * Run with: RUN_JUDGE=1 npx vitest run tests/judge/01-pipeline-smoke.test.js
 */

describe.skipIf(SKIP_JUDGE)('Pipeline Smoke — Full Pipeline Runs', () => {
  let result;

  it('runs the full pipeline without crashing', async () => {
    result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const { context, thoughts, durationMs } = result;

    expect(context.scoredPlaylist.length).toBeGreaterThan(0);
    expect(context.candidatePool.length).toBeGreaterThan(0);
    expect(thoughts.length).toBeGreaterThan(5); // Expect at least a handful of agent thoughts
    expect(durationMs).toBeLessThan(300000); // 5 min max
  }, 180000);

  it('Scout populates blackboard.scout with real data', async () => {
    if (!result) result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const scout = result.context.blackboard.scout;

    console.log('\n=== Scout Blackboard ===');
    console.log('Strategy:', scout.searchStrategy);
    console.log('Total candidates:', scout.totalCandidates);
    console.log('Sources:', JSON.stringify(scout.sourceBreakdown));
    console.log('High confidence:', scout.highConfidence);
    console.log('Risky bets:', scout.riskyBets);

    expect(scout.searchStrategy).toBeTruthy();
    expect(scout.totalCandidates).toBeGreaterThan(0);
  }, 180000);

  it('Curator produces reflection and playlist name', async () => {
    if (!result) result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const { context } = result;

    console.log('\n=== Curator Output ===');
    console.log('Reflection:', context.curatorReflection);
    console.log('Playlist name:', context.playlistName);
    console.log('Track count:', context.scoredPlaylist.length);
    console.log('Artists:', [...new Set(context.scoredPlaylist.map(t => t.artistName))].join(', '));

    expect(context.scoredPlaylist.length).toBeGreaterThan(0);
    expect(context.curatorReflection).toBeTruthy();
  }, 180000);

  it('Curator produces per-track explanations for every track', async () => {
    if (!result) result = await runRealPipeline(TEST_INTENTS.MELANCHOLIC_INDIE);
    const { explanations, scoredPlaylist } = result.context;

    console.log('\n=== Curator Explanations ===');
    console.log('Title:', explanations.playlistTitle);
    console.log('Summary:', explanations.playlistSummary);
    console.log('Track explanations count:', explanations.trackExplanations?.size || Object.keys(explanations.trackExplanations || {}).length);

    expect(explanations.playlistTitle).toBeTruthy();
    expect(explanations.playlistSummary).toBeTruthy();

    const explCount = explanations.trackExplanations instanceof Map
      ? explanations.trackExplanations.size
      : Object.keys(explanations.trackExplanations || {}).length;
    expect(explCount).toBe(scoredPlaylist.length);
  }, 180000);
});
