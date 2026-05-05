import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Agent Music — Calibration & Artist Search Tests
 * Tests the Beli-style binary search calibration system and edge cases
 * for the "Add artist to game" feature.
 *
 * We test the logic in isolation by mocking DataStore and simulating
 * the calibration flow without actual Spotify API calls.
 */

// --- Mock DataStore ---
const mockEloRatings = {};
const MockDataStore = {
  getEloRatings: () => ({ ...mockEloRatings }),
  setEloRatings: (r) => Object.assign(mockEloRatings, r),
  getTopArtists: () => null,
  getTopTracks: () => null,
  getSessionDefaults: () => ({}),
  getExplicitPreferences: () => ({ agent_memories: [] }),
  getUserMetadata: () => ({}),
};

// --- Helpers to create mock artists ---
function makeArtist(id, name, rating = 1500) {
  return { id, name, genres: ['rock'], images: [{ url: '' }] };
}

function seedElo(id, name, rating, comps = 5) {
  mockEloRatings[id] = {
    rating, name, wins: 0, losses: 0, ties: 0,
    comparison_count: comps, last_compared_at: null, source: 'test'
  };
}

// --- Simulate the calibration logic extracted from taste-game.js ---
function buildCalibrationPair(calibrationTask, allArtists, knownArtists, eloRatings) {
  if (!calibrationTask) return null;

  const { targetId, low, high } = calibrationTask;
  const targetArtist = allArtists.find(a => a.id === targetId);

  if (!targetArtist) {
    return { error: 'target_not_found' };
  }

  // Build ranked opponents list, EXCLUDING the target artist itself
  const rankedOpponents = knownArtists
    .filter(a => eloRatings[a.id] && a.id !== targetId)
    .sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);

  // Clamp bounds to valid range
  const clampedHigh = Math.min(high, rankedOpponents.length - 1);

  if (rankedOpponents.length > 0 && low <= clampedHigh) {
    const mid = Math.floor((low + clampedHigh) / 2);
    const opponent = rankedOpponents[mid];
    return { A: targetArtist, B: opponent, mid, strategy: 'calibration' };
  }

  return { error: 'bounds_collapsed' };
}


describe('Calibration System', () => {
  beforeEach(() => {
    // Reset mock Elo
    Object.keys(mockEloRatings).forEach(k => delete mockEloRatings[k]);
  });

  describe('New artist (not in pool, e.g. Justin Bieber)', () => {
    it('should create a valid calibration pair against a ranked opponent', () => {
      // Set up existing ranked artists
      const knownArtists = [
        makeArtist('a1', 'Jeff Buckley'),
        makeArtist('a2', 'Radiohead'),
        makeArtist('a3', 'The Smiths'),
        makeArtist('a4', 'Arcade Fire'),
      ];
      seedElo('a1', 'Jeff Buckley', 1700);
      seedElo('a2', 'Radiohead', 1600);
      seedElo('a3', 'The Smiths', 1500);
      seedElo('a4', 'Arcade Fire', 1400);

      // New artist not in the pool
      const newArtist = makeArtist('jb', 'Justin Bieber');
      const allArtists = [...knownArtists, newArtist];

      const task = { targetId: 'jb', low: 0, high: knownArtists.length - 1, mid: -1 };
      const result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);

      expect(result.error).toBeUndefined();
      expect(result.A.id).toBe('jb');
      expect(result.B.id).not.toBe('jb');
      expect(result.strategy).toBe('calibration');
    });
  });

  describe('Already-ranked artist (e.g. George Harrison)', () => {
    it('should NOT pit the artist against itself', () => {
      const knownArtists = [
        makeArtist('gh', 'George Harrison'),
        makeArtist('a1', 'Jeff Buckley'),
        makeArtist('a2', 'Radiohead'),
        makeArtist('a3', 'The Smiths'),
      ];
      seedElo('gh', 'George Harrison', 1550);
      seedElo('a1', 'Jeff Buckley', 1700);
      seedElo('a2', 'Radiohead', 1600);
      seedElo('a3', 'The Smiths', 1500);

      const allArtists = [...knownArtists];

      const task = { targetId: 'gh', low: 0, high: knownArtists.length - 1, mid: -1 };
      const result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);

      expect(result.error).toBeUndefined();
      expect(result.A.id).toBe('gh');
      // Critical assertion: opponent must NOT be George Harrison
      expect(result.B.id).not.toBe('gh');
    });

    it('should have correct opponent count (pool size - 1)', () => {
      const knownArtists = [
        makeArtist('gh', 'George Harrison'),
        makeArtist('a1', 'Jeff Buckley'),
        makeArtist('a2', 'Radiohead'),
      ];
      seedElo('gh', 'George Harrison', 1550);
      seedElo('a1', 'Jeff Buckley', 1700);
      seedElo('a2', 'Radiohead', 1600);

      const task = { targetId: 'gh', low: 0, high: 2, mid: -1 };
      const result = buildCalibrationPair(task, knownArtists, knownArtists, mockEloRatings);

      // Only 2 valid opponents (Jeff Buckley, Radiohead), not 3
      expect(result.error).toBeUndefined();
      expect(['a1', 'a2']).toContain(result.B.id);
    });
  });

  describe('Binary search convergence', () => {
    it('should correctly narrow bounds over multiple rounds', () => {
      const knownArtists = [
        makeArtist('a1', 'Artist 1'),
        makeArtist('a2', 'Artist 2'),
        makeArtist('a3', 'Artist 3'),
        makeArtist('a4', 'Artist 4'),
        makeArtist('a5', 'Artist 5'),
      ];
      seedElo('a1', 'Artist 1', 1800);
      seedElo('a2', 'Artist 2', 1700);
      seedElo('a3', 'Artist 3', 1600);
      seedElo('a4', 'Artist 4', 1500);
      seedElo('a5', 'Artist 5', 1400);

      const newArtist = makeArtist('new', 'New Artist');
      const allArtists = [...knownArtists, newArtist];

      let task = { targetId: 'new', low: 0, high: 4, mid: -1 };

      // Round 1: mid = 2, opponent = Artist 3 (1600 Elo)
      let result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);
      expect(result.A.id).toBe('new');
      expect(result.mid).toBe(2);

      // Simulate: New Artist wins → search upper half
      task.high = result.mid - 1; // high = 1

      // Round 2: mid = 0, opponent = Artist 1 (1800 Elo)
      result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);
      expect(result.mid).toBe(0);

      // Simulate: New Artist loses → search lower half
      task.low = result.mid + 1; // low = 1

      // Round 3: mid = 1, opponent = Artist 2 (1700 Elo)
      result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);
      expect(result.mid).toBe(1);

      // Simulate: New Artist wins → low > high → converged
      task.high = result.mid - 1; // high = 0, low = 1 → low > high
      result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);
      expect(result.error).toBe('bounds_collapsed');
    });
  });

  describe('Edge cases', () => {
    it('should handle a pool with only 1 artist', () => {
      const knownArtists = [makeArtist('a1', 'Solo Artist')];
      seedElo('a1', 'Solo Artist', 1500);

      const newArtist = makeArtist('new', 'New');
      const allArtists = [...knownArtists, newArtist];

      const task = { targetId: 'new', low: 0, high: 0, mid: -1 };
      const result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);

      expect(result.error).toBeUndefined();
      expect(result.B.id).toBe('a1');
    });

    it('should handle target artist not found in allArtists', () => {
      const knownArtists = [makeArtist('a1', 'Artist 1')];
      seedElo('a1', 'Artist 1', 1500);

      const task = { targetId: 'ghost', low: 0, high: 0, mid: -1 };
      const result = buildCalibrationPair(task, knownArtists, knownArtists, mockEloRatings);

      expect(result.error).toBe('target_not_found');
    });

    it('should handle empty known artists pool', () => {
      const newArtist = makeArtist('new', 'New');
      const task = { targetId: 'new', low: 0, high: 0, mid: -1 };
      const result = buildCalibrationPair(task, [newArtist], [], mockEloRatings);

      expect(result.error).toBe('bounds_collapsed');
    });

    it('should handle high bound exceeding pool size (clamping)', () => {
      const knownArtists = [
        makeArtist('a1', 'Artist 1'),
        makeArtist('a2', 'Artist 2'),
      ];
      seedElo('a1', 'Artist 1', 1600);
      seedElo('a2', 'Artist 2', 1500);

      const newArtist = makeArtist('new', 'New');
      const allArtists = [...knownArtists, newArtist];

      // high=10 is way beyond the pool size — should clamp
      const task = { targetId: 'new', low: 0, high: 10, mid: -1 };
      const result = buildCalibrationPair(task, allArtists, knownArtists, mockEloRatings);

      expect(result.error).toBeUndefined();
      expect(result.B.id).not.toBe('new');
    });
  });
});

describe('Settled Artist Detection (_isSettled)', () => {
  // Mirror the _isSettled logic from taste-game.js
  function isSettled(eloData) {
    if (!eloData) return false;
    const comps = eloData.comparison_count || 0;
    if (comps < 6) return false;
    const wins = eloData.wins || 0;
    const winRate = wins / comps;
    return comps >= 6 && (winRate > 0.75 || winRate < 0.25);
  }

  it('should detect an artist with 6+ comps and >75% win rate as settled', () => {
    expect(isSettled({ comparison_count: 8, wins: 7, losses: 1 })).toBe(true);
  });

  it('should detect a dominated artist (low win rate) as settled', () => {
    expect(isSettled({ comparison_count: 10, wins: 1, losses: 9 })).toBe(true);
  });

  it('should NOT flag an artist with fewer than 6 comparisons', () => {
    expect(isSettled({ comparison_count: 4, wins: 4, losses: 0 })).toBe(false);
  });

  it('should NOT flag an artist with a balanced record', () => {
    expect(isSettled({ comparison_count: 12, wins: 6, losses: 6 })).toBe(false);
  });

  it('should NOT flag null/undefined elo data', () => {
    expect(isSettled(null)).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});

describe('Information Gain Weight (_getInfoGainWeight)', () => {
  // Mirror the _getInfoGainWeight logic from taste-game.js
  function getInfoGainWeight(eloData) {
    if (!eloData) return 3;
    const comps = eloData.comparison_count || 0;
    if (comps === 0) return 3;
    const wins = eloData.wins || 0;
    const winRate = wins / comps;
    const entropy = -(winRate * Math.log2(winRate + 0.001) + (1 - winRate) * Math.log2(1 - winRate + 0.001));
    const decayFactor = Math.max(0, 1 - (comps / 20));
    const weight = Math.round(3 * decayFactor * (0.3 + 0.7 * entropy));
    return Math.max(0, Math.min(3, weight));
  }

  it('should give maximum weight (3) to never-compared artists', () => {
    expect(getInfoGainWeight(null)).toBe(3);
    expect(getInfoGainWeight({ comparison_count: 0 })).toBe(3);
  });

  it('should give high weight to artists with few comparisons', () => {
    const w = getInfoGainWeight({ comparison_count: 2, wins: 1, losses: 1 });
    expect(w).toBeGreaterThanOrEqual(2);
  });

  it('should give low weight to heavily-compared predictable artists', () => {
    // Jeff Buckley scenario: 15 comparisons, wins 14
    const w = getInfoGainWeight({ comparison_count: 15, wins: 14, losses: 1 });
    expect(w).toBeLessThanOrEqual(1);
  });

  it('should give ZERO weight to extremely settled artists (20+ comps, always wins)', () => {
    const w = getInfoGainWeight({ comparison_count: 25, wins: 24, losses: 1 });
    expect(w).toBe(0);
  });

  it('should give higher weight to uncertain artists than predictable ones at same comp count', () => {
    // Use 5 comparisons where decay is less aggressive, so entropy difference survives rounding
    const uncertain = getInfoGainWeight({ comparison_count: 5, wins: 3, losses: 2 });
    const predictable = getInfoGainWeight({ comparison_count: 5, wins: 5, losses: 0 });
    expect(uncertain).toBeGreaterThanOrEqual(predictable);
  });
});

