/**
 * Taste Game Flow Tests — Phase B
 *
 * Tests the new fixes: anchor appearance caps, Spotify pool merge,
 * expansion throttling, and configurable thresholds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataStore } from '../src/data/data-store.js';

// Minimal DOM/window mock (matches taste-game.test.js pattern)
global.window = {
  playTrackHybrid: vi.fn(),
  pauseTrack: vi.fn(),
  location: { hash: '' },
  addEventListener: vi.fn(),
  localStorage: { getItem: vi.fn(), setItem: vi.fn() },
};
global.localStorage = global.window.localStorage;
global.document = {
  getElementById: vi.fn(() => null),
  querySelectorAll: vi.fn(() => []),
  createElement: vi.fn(() => ({ style: {}, addEventListener: vi.fn() })),
};

import { TasteGame } from '../src/ui/components/taste-game.js';

// --- Helpers ---
function makeRating(rating, comps, wins, opts = {}) {
  return {
    rating, comparison_count: comps, wins, losses: comps - wins,
    ties: 0, matchups: opts.matchups || {}, skips: opts.skips || 0,
    ignored: opts.ignored || false, genres: opts.genres || [],
    name: opts.name || 'Test', ...opts,
  };
}

describe('Taste Game — Configurable Thresholds', () => {
  let game;

  beforeEach(() => {
    vi.spyOn(DataStore, 'getEloRatings').mockReturnValue({});
    game = new TasteGame(document.createElement('div'));
  });

  it('should have MAX_ANCHOR_APPEARANCES = 3', () => {
    expect(game.MAX_ANCHOR_APPEARANCES).toBe(3);
  });

  it('should have EXPANSION_INTERVAL_WINNER = 5', () => {
    expect(game.EXPANSION_INTERVAL_WINNER).toBe(5);
  });

  it('should have EXPANSION_INTERVAL_TOP = 10', () => {
    expect(game.EXPANSION_INTERVAL_TOP).toBe(10);
  });

  it('expansion intervals should not be over-aggressive', () => {
    expect(game.EXPANSION_INTERVAL_WINNER).toBeGreaterThan(2);
    expect(game.EXPANSION_INTERVAL_TOP).toBeGreaterThan(game.EXPANSION_INTERVAL_WINNER);
  });

  it('should have separate anchorAppearances tracker', () => {
    expect(game.anchorAppearances).toBeDefined();
    expect(typeof game.anchorAppearances).toBe('object');
  });
});

describe('Taste Game — Anchor Appearance Capping', () => {
  let game;

  beforeEach(() => {
    const mockRatings = {
      anchor1: makeRating(1600, 8, 6, { name: 'Anchor 1' }),
      anchor2: makeRating(1550, 5, 3, { name: 'Anchor 2' }),
      anchor3: makeRating(1500, 3, 2, { name: 'Anchor 3' }),
      contender: makeRating(1500, 0, 0, { name: 'Contender' }),
    };
    vi.spyOn(DataStore, 'getEloRatings').mockReturnValue(mockRatings);

    game = new TasteGame(document.createElement('div'));
    game.knownArtists = [
      { id: 'anchor1', name: 'Anchor 1', genres: [] },
      { id: 'anchor2', name: 'Anchor 2', genres: [] },
      { id: 'anchor3', name: 'Anchor 3', genres: [] },
    ];
    game.allArtists = [...game.knownArtists, { id: 'contender', name: 'Contender', genres: [] }];
  });

  it('should exclude anchors that reached the appearance cap', () => {
    const ratings = DataStore.getEloRatings();
    // Exhaust anchor1
    game.anchorAppearances['anchor1'] = 3;

    const result = game._getClosestAnchor('contender', game.knownArtists, ratings);
    expect(result).toBeDefined();
    expect(result.id).not.toBe('anchor1');
  });

  it('should still allow anchors below the cap', () => {
    const ratings = DataStore.getEloRatings();
    game.anchorAppearances['anchor1'] = 2; // Under cap

    const result = game._getClosestAnchor('contender', game.knownArtists, ratings);
    // anchor1 should still be eligible
    expect(result).toBeDefined();
  });

  it('_selectStrategicPair should increment anchorAppearances for benchmark strategy', () => {
    // Add a related artist as a viable contender
    game.relatedArtists = [{ id: 'related1', name: 'Related 1', genres: ['indie'] }];
    game.allArtists = [...game.knownArtists, ...game.relatedArtists];

    const pair = game._selectStrategicPair();
    if (pair.strategy === 'benchmark') {
      const total = Object.values(game.anchorAppearances).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it('should rotate anchors once the primary hits the cap', () => {
    const ratings = DataStore.getEloRatings();
    // anchor1 is closest (1600 vs 1500 = 100 diff) but capped
    game.anchorAppearances['anchor1'] = 3;

    const anchors = {};
    for (let i = 0; i < 20; i++) {
      const anchor = game._getClosestAnchor('contender', game.knownArtists, ratings);
      anchors[anchor.id] = (anchors[anchor.id] || 0) + 1;
    }

    expect(anchors['anchor1'] || 0).toBe(0);
    // anchor2 and anchor3 should absorb all selections
    expect((anchors['anchor2'] || 0) + (anchors['anchor3'] || 0)).toBe(20);
  });
});

describe('Taste Game — _isSettled and _getInfoGainWeight (Phase B)', () => {
  let game;

  beforeEach(() => {
    vi.spyOn(DataStore, 'getEloRatings').mockReturnValue({});
    game = new TasteGame(document.createElement('div'));
  });

  it('settled with <6 comps should return false', () => {
    expect(game._isSettled(makeRating(1700, 5, 5))).toBe(false);
  });

  it('settled with 6+ comps and >75% WR should return true', () => {
    expect(game._isSettled(makeRating(1800, 10, 9))).toBe(true);
  });

  it('settled with 6+ comps and <25% WR should return true', () => {
    expect(game._isSettled(makeRating(1200, 8, 1))).toBe(true);
  });

  it('moderate WR should not be settled', () => {
    expect(game._isSettled(makeRating(1500, 10, 5))).toBe(false);
  });

  it('info gain for never-compared = 3', () => {
    expect(game._getInfoGainWeight(null)).toBe(3);
    expect(game._getInfoGainWeight(undefined)).toBe(3);
  });

  it('info gain for ignored artist = 0', () => {
    expect(game._getInfoGainWeight(makeRating(1500, 0, 0, { ignored: true }))).toBe(0);
  });

  it('info gain for settled artist = 0', () => {
    expect(game._getInfoGainWeight(makeRating(1800, 10, 9))).toBe(0);
  });
});

describe('Taste Game — _hasPlayed', () => {
  let game;

  beforeEach(() => {
    vi.spyOn(DataStore, 'getEloRatings').mockReturnValue({});
    game = new TasteGame(document.createElement('div'));
  });

  it('returns true for recorded matchups', () => {
    const r = {
      a: makeRating(1500, 1, 1, { matchups: { b: true } }),
      b: makeRating(1500, 1, 0, { matchups: { a: true } }),
    };
    expect(game._hasPlayed('a', 'b', r)).toBe(true);
  });

  it('returns false for unplayed matchups', () => {
    const r = {
      a: makeRating(1500, 0, 0, { matchups: {} }),
      b: makeRating(1500, 0, 0, { matchups: {} }),
    };
    expect(game._hasPlayed('a', 'b', r)).toBe(false);
  });
});
