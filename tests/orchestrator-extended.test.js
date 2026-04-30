import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../src/agents/orchestrator.js';
import { ProfilerAgent } from '../src/agents/profiler-agent.js';
import { ScoutAgent } from '../src/agents/scout-agent.js';
import { CuratorAgent } from '../src/agents/curator-agent.js';
import { NarratorAgent } from '../src/agents/narrator-agent.js';

/**
 * Extended Orchestrator tests
 *
 * Covers:
 *  - _populateTasteProfile (anchored #1, settled anchors, genre ranking)
 *  - handleConciergeAction (all action types)
 *  - rerank (partial pipeline re-run)
 *  - Context threading (agents receive context param)
 */

// --- Fixtures ---

function makeEloRatings() {
  return {
    jb: {
      rating: 1780, name: 'Jeff Buckley', genres: ['folk rock', 'dream pop'],
      wins: 10, losses: 0, ties: 0, comparison_count: 10,
    },
    rh: {
      rating: 1650, name: 'Radiohead', genres: ['alternative rock', 'art rock'],
      wins: 6, losses: 2, ties: 0, comparison_count: 8,
    },
    np: {
      rating: 1400, name: 'New Prospect', genres: ['indie'],
      wins: 1, losses: 3, ties: 0, comparison_count: 4,
    },
    bad: {
      rating: 1200, name: 'Disliked Band', genres: ['pop'],
      wins: 0, losses: 7, ties: 0, comparison_count: 7,
    },
  };
}

const mockTasteState = {
  eloRatings: makeEloRatings(),
  topGenres: ['rock', 'indie'],
  audioProfile: { avgEnergy: 0.6 },
  artists: [{ id: 'jb', name: 'Jeff Buckley' }],
  topRankedArtists: [{ id: 'jb', name: 'Jeff Buckley' }],
  tracks: [],
};

const mockCandidate = [{
  track: { id: 't1', name: 'Hallelujah', popularity: 80 },
  artistId: 'jb',
  artistName: 'Jeff Buckley',
  hopDistance: 0,
  source: 'elo_top',
  tags: [{ name: 'folk rock' }],
  dominantFactor: 'elo',
  finalScore: 0.9,
  breakdown: { eloComponent: 0.9, graphComponent: 0.5, audioComponent: 0.6, sessionComponent: 0.5 },
}];

function setupMocks(orchestrator) {
  vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(mockTasteState);
  vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
  vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
  vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
    playlistSummary: 'A deeply introspective set',
    trackExplanations: new Map([['t1', 'Pure Buckley energy']]),
  });
}

// --- Tests ---

describe('Orchestrator — _populateTasteProfile', () => {
  it('should identify the anchored #1 when settled', async () => {
    const orch = new Orchestrator();
    setupMocks(orch);
    const ctx = await orch.generatePlaylist('user1', { discovery: 0.5 });

    expect(ctx.tasteProfile.anchoredTopArtist).toBe('Jeff Buckley');
    expect(ctx.settledAnchors).toContain('jb');
  });

  it('should collect ALL settled artists, not just #1', async () => {
    const orch = new Orchestrator();
    setupMocks(orch);
    const ctx = await orch.generatePlaylist('user1', {});

    // jb (10 comps, 100% WR) and bad (7 comps, 0% WR) are both settled
    expect(ctx.settledAnchors).toContain('jb');
    expect(ctx.settledAnchors).toContain('bad');
    // rh has exactly 75% WR (6/8) — the threshold is STRICTLY >0.75, so rh is NOT settled
    expect(ctx.settledAnchors).not.toContain('rh');
    // np is NOT settled: only 4 comps
    expect(ctx.settledAnchors).not.toContain('np');
  });

  it('should rank dominant genres by total comparison weight', async () => {
    const orch = new Orchestrator();
    setupMocks(orch);
    const ctx = await orch.generatePlaylist('user1', {});

    // folk rock: jb(10) = 10
    // dream pop: jb(10) = 10
    // alternative rock: rh(8) = 8
    // art rock: rh(8) = 8
    // pop: bad(7) = 7
    // indie: np(4) = 4
    expect(ctx.tasteProfile.dominantGenres[0]).toBe('folk rock');
    expect(ctx.tasteProfile.dominantGenres).toContain('dream pop');
    expect(ctx.tasteProfile.dominantGenres.length).toBeLessThanOrEqual(5);
  });

  it('should identify under-explored genres (fewest comparisons)', async () => {
    const orch = new Orchestrator();
    setupMocks(orch);
    const ctx = await orch.generatePlaylist('user1', {});

    // indie(4) is the least-compared genre
    expect(ctx.tasteProfile.underExploredGenres).toContain('indie');
    expect(ctx.tasteProfile.underExploredGenres.length).toBeLessThanOrEqual(3);
  });

  it('should not anchor #1 if they have fewer than 6 comparisons', async () => {
    const fewCompState = {
      ...mockTasteState,
      eloRatings: {
        jb: { ...makeEloRatings().jb, comparison_count: 3, wins: 3 },
      },
    };
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(fewCompState);
    const orch = new Orchestrator();
    vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
    vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
      playlistSummary: 'Test', trackExplanations: new Map(),
    });

    const ctx = await orch.generatePlaylist('user1', {});
    expect(ctx.tasteProfile.anchoredTopArtist).toBeNull();
    expect(ctx.settledAnchors).not.toContain('jb');
  });

  it('should handle empty eloRatings gracefully', async () => {
    const emptyState = { ...mockTasteState, eloRatings: {} };
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(emptyState);
    const orch = new Orchestrator();
    vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
    vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
      playlistSummary: 'Test', trackExplanations: new Map(),
    });

    const ctx = await orch.generatePlaylist('user1', {});
    expect(ctx.tasteProfile.anchoredTopArtist).toBeNull();
    expect(ctx.settledAnchors).toEqual([]);
    expect(ctx.tasteProfile.dominantGenres).toEqual([]);
  });
});

describe('Orchestrator — handleConciergeAction', () => {
  let orch;

  beforeEach(async () => {
    orch = new Orchestrator();
    setupMocks(orch);
    await orch.generatePlaylist('user1', { discovery: 0.5 });
  });

  it('should treat legacy adjust_sliders as unknown action', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await orch.handleConciergeAction({
      type: 'adjust_sliders',
      sliders: { discovery: 0.9 },
    });
    expect(warnSpy).toHaveBeenCalledWith('Orchestrator: unknown Concierge action type', 'adjust_sliders');
    expect(result).toBeDefined(); // Returns last context unchanged
    warnSpy.mockRestore();
  });

  it('should handle create_playlist action', async () => {
    const result = await orch.handleConciergeAction({
      type: 'create_playlist',
      theme: 'a chill mix',
    });
    expect(result.sessionIntent).toBe('a chill mix');
  });

  it('should handle boost_genre action', async () => {
    const result = await orch.handleConciergeAction({
      type: 'boost_genre',
      genre: 'jazz',
    });
    expect(result.sessionAdjustments.boostedGenres).toContain('jazz');
  });

  it('should handle penalize_genre action', async () => {
    const result = await orch.handleConciergeAction({
      type: 'penalize_genre',
      genre: 'pop',
    });
    expect(result.sessionAdjustments.penalizedGenres).toContain('pop');
  });

  it('should handle regenerate action', async () => {
    const result = await orch.handleConciergeAction({
      type: 'regenerate',
    });
    expect(result).toBeDefined();
    expect(result.userId).toBe('user1');
  });

  it('should handle unknown action gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await orch.handleConciergeAction({
      type: 'totally_fake_action',
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(result).toBeDefined();
    warnSpy.mockRestore();
  });

  it('should accumulate multiple boosted genres', async () => {
    await orch.handleConciergeAction({ type: 'boost_genre', genre: 'jazz' });
    const result = await orch.handleConciergeAction({ type: 'boost_genre', genre: 'blues' });
    expect(result.sessionAdjustments.boostedGenres).toContain('jazz');
    expect(result.sessionAdjustments.boostedGenres).toContain('blues');
  });
});

describe('Orchestrator — rerank', () => {
  it('should throw if no previous context exists', async () => {
    const orch = new Orchestrator();
    await expect(orch.rerank()).rejects.toThrow('No previous pipeline context');
  });

  it('should merge session adjustments on rerank', async () => {
    const orch = new Orchestrator();
    setupMocks(orch);
    await orch.generatePlaylist('user1', {});

    const result = await orch.rerank({
      penalizedGenres: ['hip hop'],
      intentOverride: { energy: 0.3 },
    });

    expect(result.sessionAdjustments.penalizedGenres).toContain('hip hop');
    expect(result.sessionAdjustments.intentOverride.energy).toBe(0.3);
  });
});

describe('Orchestrator — context threading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass context as final argument to Scout', async () => {
    const orch = new Orchestrator();
    const scoutSpy = vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(mockTasteState);
    vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
    vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
      playlistSummary: 'Test', trackExplanations: new Map(),
    });

    await orch.generatePlaylist('user1', {});

    // Scout should have been called with 4 args: tasteState, sliders, context, onThought
    expect(scoutSpy).toHaveBeenCalledTimes(1);
    const callArgs = scoutSpy.mock.calls[0];
    expect(callArgs.length).toBe(4);
    expect(callArgs[2]).toHaveProperty('tasteProfile');
    expect(callArgs[2]).toHaveProperty('settledAnchors');
  });

  it('should pass context as final argument to Curator', async () => {
    const orch = new Orchestrator();
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(mockTasteState);
    vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    const curatorSpy = vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
    vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
      playlistSummary: 'Test', trackExplanations: new Map(),
    });

    await orch.generatePlaylist('user1', {});

    // Curator: tasteState, candidatePool, sliders, sessionAdjustments, context
    expect(curatorSpy).toHaveBeenCalledTimes(1);
    const callArgs = curatorSpy.mock.calls[0];
    expect(callArgs.length).toBe(6);
    expect(callArgs[4]).toHaveProperty('coverageGaps');
  });

  it('should pass context as final argument to Narrator', async () => {
    const orch = new Orchestrator();
    vi.spyOn(ProfilerAgent.prototype, 'buildTasteState').mockResolvedValue(mockTasteState);
    vi.spyOn(ScoutAgent.prototype, 'findCandidates').mockResolvedValue(mockCandidate);
    vi.spyOn(CuratorAgent.prototype, 'rankAndSelect').mockResolvedValue(mockCandidate);
    const narratorSpy = vi.spyOn(NarratorAgent.prototype, 'generate').mockResolvedValue({
      playlistSummary: 'Test', trackExplanations: new Map(),
    });

    await orch.generatePlaylist('user1', {});

    // Narrator: scoredPlaylist, tasteState, sliders, context, onThought
    expect(narratorSpy).toHaveBeenCalledTimes(1);
    const callArgs = narratorSpy.mock.calls[0];
    expect(callArgs.length).toBe(5);
    expect(callArgs[3]).toHaveProperty('sessionSignals');
  });
});
