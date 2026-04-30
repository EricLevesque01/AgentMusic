import { describe, it, expect, vi } from 'vitest';
import { ReflectionAgent } from '../src/agents/reflection-agent.js';

// Mock callWithTools to prevent real API calls
vi.mock('../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn().mockResolvedValue({
    textReply: '["Prefers instrumental jazz over vocal jazz", "Gravitates toward post-2010 indie"]',
    functionCalls: [],
  }),
}));

// Mock DataStore with in-memory storage
const store = {};
vi.mock('../src/data/data-store.js', () => ({
  DataStore: {
    load: (key) => store[key] || null,
    save: (key, val) => { store[key] = val; },
    clear: (key) => { delete store[key]; },
    getExplicitPreferences: () => ({ agent_memories: [] }),
    getSessionSignals: () => ({ skippedGenres: [], lovedGenres: [], skippedArtists: [] }),
  },
}));

describe('ReflectionAgent', () => {
  const agent = new ReflectionAgent();

  const makeCandidate = (name, genres = [], source = 'hop-0') => ({
    track: { id: `t_${name}`, name: `Track by ${name}` },
    artistName: name,
    tags: genres,
    source,
  });

  const sessionData = {
    skipHistory: [
      { candidate: makeCandidate('Vocal Jazz Artist', ['vocal jazz']), listenMs: 5000, ts: Date.now() },
      { candidate: makeCandidate('Vocal Jazz Artist 2', ['vocal jazz']), listenMs: 3000, ts: Date.now() },
      { candidate: makeCandidate('Pop Artist', ['pop']), listenMs: 8000, ts: Date.now() },
    ],
    listenHistory: [
      { candidate: makeCandidate('Miles Davis', ['jazz', 'modal jazz']), ts: Date.now() },
      { candidate: makeCandidate('Bill Evans', ['jazz', 'cool jazz']), ts: Date.now() },
      { candidate: makeCandidate('Nils Frahm', ['ambient', 'neo-classical']), ts: Date.now() },
      { candidate: makeCandidate('Radiohead', ['alternative', 'art rock']), ts: Date.now() },
    ],
    adjustments: {
      boostedGenres: ['jazz'],
      penalizedGenres: ['vocal jazz'],
    },
  };

  const context = {
    sessionIntent: 'late night jazz',
    blackboard: { profiler: {}, scout: {}, curator: {}, narrator: {} },
  };

  it('builds a valid episodic summary', () => {
    const summary = agent._buildEpisodicSummary(sessionData, context);

    expect(summary.date).toBeTruthy();
    expect(summary.intent).toBe('late night jazz');
    expect(summary.stats.totalTracks).toBe(7);
    expect(summary.stats.skips).toBe(3);
    expect(summary.stats.listens).toBe(4);
    expect(summary.stats.skipRate).toBe(43); // 3/7 ≈ 43%
    expect(summary.lovedArtists).toContain('Miles Davis');
    expect(summary.topSkippedGenres).toContain('vocal jazz');
    expect(summary.topLovedGenres).toContain('jazz');
    expect(summary.summary).toContain('4 listens');
    expect(summary.summary).toContain('3 skips');
  });

  it('episodic summary handles empty session data', () => {
    const summary = agent._buildEpisodicSummary({}, {});
    expect(summary.stats.totalTracks).toBe(0);
    expect(summary.stats.skipRate).toBe(0);
    expect(summary.lovedArtists).toEqual([]);
  });

  it('extractNarrativeAnchors returns array of strings via LLM', async () => {
    const anchors = await agent._extractNarrativeAnchors(sessionData, context);
    expect(anchors).toBeInstanceOf(Array);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors[0]).toHaveProperty('text');
    expect(anchors[0]).toHaveProperty('source', 'agent_inferred');
  });

  it('extractNarrativeAnchors returns empty for sparse data', async () => {
    const sparseData = { skipHistory: [{ candidate: makeCandidate('A'), listenMs: 5000 }], listenHistory: [] };
    const anchors = await agent._extractNarrativeAnchors(sparseData, context);
    expect(anchors).toEqual([]);
  });

  it('updateDriftTrends detects genre momentum across sessions', () => {
    // Pre-populate episodic memory with sessions (most recent first)
    store['episodic_memory'] = {
      sessions: [
        { topLovedGenres: ['jazz'], topSkippedGenres: ['country'], stats: { skipRate: 15 } },
        { topLovedGenres: ['jazz', 'ambient'], topSkippedGenres: ['pop'], stats: { skipRate: 20 } },
        { topLovedGenres: ['jazz', 'indie'], topSkippedGenres: ['pop'], stats: { skipRate: 40 } },
        { topLovedGenres: ['rock'], topSkippedGenres: ['pop'], stats: { skipRate: 45 } },
      ],
    };

    agent._updateDriftTrends();

    const trends = store['drift_trends'];
    expect(trends).toBeTruthy();
    expect(trends.genreMomentum.length).toBeGreaterThan(0);
    expect(trends.genreMomentum[0].genre).toBe('jazz'); // Most momentum
    expect(trends.genreDecline.length).toBeGreaterThan(0);
    expect(trends.genreDecline[0].genre).toBe('pop'); // Most decline
    expect(trends.discoveryTrajectory).toBe('improving'); // skip rates decreasing (15,20 avg=17.5 vs 40,45 avg=42.5)
  });

  it('full reflect() pipeline returns structured results', async () => {
    // Reset episodic memory
    store['episodic_memory'] = { sessions: [
      { topLovedGenres: ['jazz'], topSkippedGenres: ['pop'], stats: { skipRate: 30 } },
      { topLovedGenres: ['jazz'], topSkippedGenres: ['pop'], stats: { skipRate: 25 } },
      { topLovedGenres: ['jazz'], topSkippedGenres: [], stats: { skipRate: 20 } },
    ]};

    const result = await agent.reflect(sessionData, context);

    expect(result.episodicSummary).toBeTruthy();
    expect(result.episodicSummary.intent).toBe('late night jazz');
    expect(result.newAnchors).toBeInstanceOf(Array);
    expect(result.driftUpdated).toBe(true);

    // Verify episodic memory was persisted (prepended)
    const mem = store['episodic_memory'];
    expect(mem.sessions[0].intent).toBe('late night jazz');
  });

  it('inferFunctionalProfile returns false with insufficient motivation data', () => {
    store['episodic_memory'] = { sessions: [
      { motivation: 'focus', stats: {} },
      { motivation: 'focus', stats: {} },
      // Only 2 motivated sessions — below threshold
    ]};

    const result = agent._inferFunctionalProfile();
    expect(result).toBe(false);
  });

  it('inferFunctionalProfile computes normalized weights from motivation data', () => {
    store['episodic_memory'] = { sessions: [
      { motivation: 'focus', stats: {} },
      { motivation: 'focus', stats: {} },
      { motivation: 'emotion_regulation', stats: {} },
      { motivation: 'focus', stats: {} },
      { motivation: 'nostalgia', stats: {} },
    ]};

    const result = agent._inferFunctionalProfile();
    expect(result).toBe(true);

    // Verify the Tier 1 model was updated
    const model = store['user_model'];
    expect(model).toBeTruthy();
    expect(model.functionalProfile.primaryFunctions.focusAid).toBe(0.6); // 3/5
    expect(model.functionalProfile.primaryFunctions.emotionRegulation).toBe(0.2); // 1/5
    expect(model.functionalProfile.primaryFunctions.nostalgia).toBe(0.2); // 1/5
    expect(model.functionalProfile._confidence).toBeGreaterThan(0);
  });

  it('inferFunctionalProfile ignores sessions without motivation', () => {
    store['episodic_memory'] = { sessions: [
      { motivation: 'focus', stats: {} },
      { motivation: null, stats: {} },         // No motivation
      { motivation: 'focus', stats: {} },
      { stats: {} },                            // No motivation field
      { motivation: 'social_bonding', stats: {} },
    ]};

    const result = agent._inferFunctionalProfile();
    expect(result).toBe(true);

    const model = store['user_model'];
    // Only 3 motivated sessions: 2 focus (67%), 1 social (33%)
    expect(model.functionalProfile.primaryFunctions.focusAid).toBe(0.67);
    expect(model.functionalProfile.primaryFunctions.socialBonding).toBe(0.33);
  });
});
