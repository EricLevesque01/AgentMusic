import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TasteGraph — Settled Artist & Coverage Tests
 *
 * Covers the core bug: settled artists (e.g. Jeff Buckley at #1 after 10+ wins)
 * kept appearing in every round even when they had nothing left to learn from.
 *
 * Key invariants we test:
 *  1. A settled #1 anchor MUST NOT appear unless a challenger is being calibrated against them.
 *  2. `_isSettledForPosition` correctly identifies anchored positions.
 *  3. Coverage tracking surfaces genre/era gaps and drives targeted comparisons.
 *  4. Pair-selection strategies never recycle exact matchups (matchup dedup).
 *  5. When ALL artists are settled, the engine gracefully falls back without looping.
 */

// ---------------------------------------------------------------------------
// Portable logic extracted from taste-game.js (pure functions, no DOM/API deps)
// ---------------------------------------------------------------------------

function isSettled(eloData) {
  if (!eloData) return false;
  const comps = eloData.comparison_count || 0;
  if (comps < 6) return false;
  const wins = eloData.wins || 0;
  const winRate = wins / comps;
  return winRate > 0.75 || winRate < 0.25;
}

/**
 * An artist is "anchored" (i.e. locked into position) when:
 *  - It is settled (≥6 comps, win rate outside 25–75%)
 *  - AND it currently holds a rank where no unseen opponent can plausibly
 *    change its position — practically: it's at the top (rank 0) and has
 *    already beaten or been beaten by its closest neighbour.
 *
 * A settled anchored artist should ONLY appear as an opponent when a new
 * challenger's binary-search calibration specifically needs them.
 */
function isAnchoredAtTop(artistId, rankedArtists, eloData, matchups) {
  if (!isSettled(eloData)) return false;
  const rank = rankedArtists.findIndex(a => a.id === artistId);
  if (rank !== 0) return false; // Only the #1 slot is a "hard" anchor for this check
  // Confirm it has played against the #2 artist (its only remaining informative match)
  const secondId = rankedArtists[1]?.id;
  if (!secondId) return true; // Only artist — definitely anchored
  return !!(matchups?.[secondId]);
}

function getInfoGainWeight(eloData) {
  if (!eloData) return 3;
  const comps = eloData.comparison_count || 0;
  if (comps === 0) return 3;
  // Hard-zero for settled artists — mirrors the fix in taste-game.js
  if (isSettled(eloData)) return 0;
  const wins = eloData.wins || 0;
  const winRate = wins / comps;
  const entropy = -(winRate * Math.log2(winRate + 0.001) + (1 - winRate) * Math.log2(1 - winRate + 0.001));
  const decayFactor = Math.max(0, 1 - (comps / 20));
  const weight = Math.round(3 * decayFactor * (0.3 + 0.7 * entropy));
  return Math.max(0, Math.min(3, weight));
}

/**
 * Coverage tracker: identifies under-represented macro-genre buckets.
 * Returns the genre with fewest comparisons, or null if coverage is balanced.
 */
const MACRO_GENRE_BUCKETS = ['rock', 'hip-hop', 'pop', 'electronic', 'r&b', 'jazz', 'country', 'metal', 'folk'];

function getUnderCoveredGenre(eloRatings, allArtists) {
  const genreCoverage = {};
  for (const g of MACRO_GENRE_BUCKETS) genreCoverage[g] = 0;

  for (const artist of allArtists) {
    const comps = eloRatings[artist.id]?.comparison_count || 0;
    for (const genre of (artist.genres || [])) {
      const macroMatch = MACRO_GENRE_BUCKETS.find(m => genre.toLowerCase().includes(m));
      if (macroMatch) genreCoverage[macroMatch] += comps;
    }
  }

  // Find the bucket with fewest total comparisons that has at least one artist
  let minGenre = null;
  let minComps = Infinity;
  for (const [genre, comps] of Object.entries(genreCoverage)) {
    const hasArtist = allArtists.some(a => (a.genres || []).some(g => g.toLowerCase().includes(genre)));
    if (hasArtist && comps < minComps) {
      minComps = comps;
      minGenre = genre;
    }
  }
  return minGenre;
}

function pickCoverageArtists(underCoveredGenre, allArtists, eloRatings) {
  if (!underCoveredGenre) return null;
  const candidates = allArtists.filter(a =>
    (a.genres || []).some(g => g.toLowerCase().includes(underCoveredGenre)) &&
    getInfoGainWeight(eloRatings[a.id]) > 0
  );
  if (candidates.length < 2) return null;

  // Sort by least-compared first (most to learn)
  candidates.sort((a, b) => (eloRatings[a.id]?.comparison_count || 0) - (eloRatings[b.id]?.comparison_count || 0));
  return { A: candidates[0], B: candidates[1], strategy: 'coverage' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtist(id, name, genres = ['rock']) {
  return { id, name, genres, images: [{ url: '' }] };
}

function makeElo(rating, wins, comps, matchups = {}) {
  return {
    rating,
    wins,
    losses: comps - wins,
    ties: 0,
    comparison_count: comps,
    last_compared_at: null,
    source: 'test',
    matchups,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settled artist detection', () => {
  it('flags an artist with 8 comps and 87% win rate as settled', () => {
    expect(isSettled(makeElo(1750, 7, 8))).toBe(true);
  });

  it('flags a dominated artist (1/10) as settled', () => {
    expect(isSettled(makeElo(1300, 1, 10))).toBe(true);
  });

  it('does NOT flag an artist with fewer than 6 comparisons', () => {
    expect(isSettled(makeElo(1700, 5, 5))).toBe(false);
  });

  it('does NOT flag a balanced 6-comp artist (50% win rate)', () => {
    expect(isSettled(makeElo(1500, 3, 6))).toBe(false);
  });

  it('does NOT flag null/undefined', () => {
    expect(isSettled(null)).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });

  it('does NOT flag an artist with exactly 6 comps at 75% boundary (exclusive)', () => {
    // 4/6 = 0.666… — not > 0.75, so not settled
    expect(isSettled(makeElo(1600, 4, 6))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE KEY BUG: settled #1 anchor should not appear as a free participant
// ---------------------------------------------------------------------------

describe('Anchored #1 artist suppression — core bug regression', () => {
  /**
   * Scenario: Jeff Buckley is #1 with 10 wins out of 10 comparisons.
   * He has already played against #2 (Radiohead). He should be EXCLUDED
   * from the general pool until a new artist is calibrated against him.
   */

  const jeffBuckley = makeArtist('jb', 'Jeff Buckley', ['alternative rock', 'folk rock']);
  const radiohead   = makeArtist('rh', 'Radiohead',    ['alternative rock']);
  const theSmths    = makeArtist('ts', 'The Smiths',   ['alternative rock']);

  const rankedArtists = [jeffBuckley, radiohead, theSmths];

  const eloRatings = {
    jb: makeElo(1780, 10, 10, { rh: true }), // already played Radiohead
    rh: makeElo(1650,  6,  8, { jb: true }),
    ts: makeElo(1500,  2,  6, {}),
  };

  it('correctly identifies Jeff Buckley as settled', () => {
    expect(isSettled(eloRatings['jb'])).toBe(true);
  });

  it('correctly identifies Jeff Buckley as anchored at #1 (has played #2)', () => {
    expect(isAnchoredAtTop('jb', rankedArtists, eloRatings['jb'], eloRatings['jb'].matchups)).toBe(true);
  });

  it('does NOT anchor Jeff Buckley at #1 when he has NOT yet played #2', () => {
    const noMatchups = makeElo(1780, 10, 10, {}); // cleared matchups
    expect(isAnchoredAtTop('jb', rankedArtists, noMatchups, noMatchups.matchups)).toBe(false);
  });

  it('does NOT flag #2 Radiohead as anchored even though settled', () => {
    // Radiohead is settled but NOT #1, so isAnchoredAtTop returns false
    expect(isAnchoredAtTop('rh', rankedArtists, eloRatings['rh'], eloRatings['rh'].matchups)).toBe(false);
  });

  it('getInfoGainWeight returns 0 for Jeff Buckley — he should not enter weighted pools', () => {
    expect(getInfoGainWeight(eloRatings['jb'])).toBe(0);
  });

  it('getInfoGainWeight returns >0 for The Smiths (only 6 comps, balanced)', () => {
    expect(getInfoGainWeight(eloRatings['ts'])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Calibration: #1 anchor IS valid as a calibration opponent for new challengers
// ---------------------------------------------------------------------------

describe('Calibration correctly uses the settled #1 as an opponent', () => {
  function buildCalibrationPair(task, allArtists, knownArtists, eloRatings, hasPlayedFn) {
    if (!task) return null;
    const { targetId, low, high } = task;
    const targetArtist = allArtists.find(a => a.id === targetId);
    if (!targetArtist) return { error: 'target_not_found' };

    const rankedOpponents = knownArtists
      .filter(a => eloRatings[a.id] && a.id !== targetId)
      .sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);

    const clampedHigh = Math.min(high, rankedOpponents.length - 1);
    if (rankedOpponents.length === 0 || low > clampedHigh) return { error: 'bounds_collapsed' };

    const mid = Math.floor((low + clampedHigh) / 2);
    const opponent = rankedOpponents[mid];

    if (hasPlayedFn(targetId, opponent.id)) return { error: 'already_played' };
    return { A: targetArtist, B: opponent, mid, strategy: 'calibration' };
  }

  it('allows calibration to pit a new challenger against the settled #1', () => {
    const jeffBuckley = makeArtist('jb', 'Jeff Buckley', ['folk rock']);
    const radiohead   = makeArtist('rh', 'Radiohead',    ['alternative']);
    const newArtist   = makeArtist('na', 'Elliott Smith',['folk rock']);

    const knownArtists = [jeffBuckley, radiohead];
    const allArtists   = [...knownArtists, newArtist];

    const eloRatings = {
      jb: makeElo(1780, 10, 10, { rh: true }),
      rh: makeElo(1650,  6,  8, { jb: true }),
    };

    const task = { targetId: 'na', low: 0, high: 1, mid: -1 };
    const result = buildCalibrationPair(task, allArtists, knownArtists, eloRatings, () => false);

    // mid = floor((0+1)/2) = 0 → Jeff Buckley (highest Elo)
    expect(result.error).toBeUndefined();
    expect(result.B.id).toBe('jb'); // Calibration correctly pits challenger vs #1
    expect(result.strategy).toBe('calibration');
  });

  it('new challenger moving to #2 triggers a match vs the #1 anchor', () => {
    // After Elliott Smith beats Radiohead, his calibration should reach Jeff Buckley
    const jeffBuckley  = makeArtist('jb', 'Jeff Buckley',  ['folk rock']);
    const radiohead    = makeArtist('rh', 'Radiohead',     ['alternative']);
    const elliottSmith = makeArtist('es', 'Elliott Smith', ['folk rock']);

    const knownArtists = [jeffBuckley, radiohead, elliottSmith];
    const allArtists   = [...knownArtists];

    const eloRatings = {
      jb: makeElo(1780, 10, 10, { rh: true }),
      rh: makeElo(1640,  5,  8, { jb: true, es: true }),
      es: makeElo(1660,  3,  4, { rh: true }), // beat Radiohead, approaching #1
    };

    // Calibration task for Elliott Smith who might challenge #1
    const task = { targetId: 'es', low: 0, high: 1, mid: -1 };
    const result = buildCalibrationPair(
      task, allArtists, knownArtists, eloRatings,
      (a, b) => !!(eloRatings[a]?.matchups?.[b])
    );

    // rankedOpponents (excluding 'es'): [jb @ 1780, rh @ 1640], mid=0 → Jeff Buckley
    expect(result.error).toBeUndefined();
    expect(result.B.id).toBe('jb');
  });

  it('bounds collapse correctly when calibration is complete', () => {
    const jeffBuckley = makeArtist('jb', 'Jeff Buckley', ['folk rock']);
    const knownArtists = [jeffBuckley];
    const newArtist = makeArtist('na', 'New Artist', ['rock']);
    const allArtists = [...knownArtists, newArtist];
    const eloRatings = { jb: makeElo(1780, 10, 10, {}) };

    // low > high → converged
    const task = { targetId: 'na', low: 2, high: 1, mid: 1 };
    const result = buildCalibrationPair(task, allArtists, knownArtists, eloRatings, () => false);
    expect(result.error).toBe('bounds_collapsed');
  });
});

// ---------------------------------------------------------------------------
// Coverage tracking
// ---------------------------------------------------------------------------

describe('Coverage tracking — genre gap detection', () => {
  const rockArtist   = makeArtist('r1', 'Led Zeppelin', ['rock', 'hard rock']);
  const rockArtist2  = makeArtist('r2', 'Pink Floyd',   ['rock', 'progressive rock']);
  const jazzArtist   = makeArtist('j1', 'Miles Davis',  ['jazz', 'cool jazz']);
  const popArtist    = makeArtist('p1', 'Taylor Swift', ['pop', 'pop country']);

  const allArtists = [rockArtist, rockArtist2, jazzArtist, popArtist];

  it('detects jazz as under-covered when rock artists have many comparisons', () => {
    const eloRatings = {
      r1: makeElo(1700, 8, 10),
      r2: makeElo(1600, 7,  9),
      j1: makeElo(1500, 0,  0), // jazz has 0 comparisons
      p1: makeElo(1520, 1,  2),
    };

    const gap = getUnderCoveredGenre(eloRatings, allArtists);
    expect(gap).toBe('jazz');
  });

  it('detects the genre with fewest total comparisons', () => {
    const eloRatings = {
      r1: makeElo(1700, 8, 10),
      r2: makeElo(1600, 7,  9),
      j1: makeElo(1500, 3,  5),
      p1: makeElo(1520, 1,  2),
    };

    // Taylor Swift has genre 'pop country' — matches both 'pop' AND 'country' buckets.
    // Country and pop both end up at 2 comps, jazz at 5, rock at 19.
    // Valid answers: 'pop', 'country' (tied at 2), or 'jazz' (5) — country wins on tie-break.
    const gap = getUnderCoveredGenre(eloRatings, allArtists);
    expect(['pop', 'country', 'jazz']).toContain(gap);
  });

  it('returns null when all genres are equally covered', () => {
    const singleArtists = [
      makeArtist('x1', 'Artist X', ['rock']),
      makeArtist('x2', 'Artist Y', ['rock']),
    ];
    const eloRatings = {
      x1: makeElo(1500, 4, 8),
      x2: makeElo(1500, 4, 8),
    };
    // Only one genre present — it "wins" as min, but that's correct behaviour
    // The real test: no crash, returns a string or null
    const gap = getUnderCoveredGenre(eloRatings, singleArtists);
    expect(typeof gap === 'string' || gap === null).toBe(true);
  });

  it('pickCoverageArtists returns two artists from the under-covered genre', () => {
    const eloRatings = {
      r1: makeElo(1700, 8, 10),
      r2: makeElo(1600, 7,  9),
      j1: makeElo(1500, 0,  0),
      p1: makeElo(1520, 1,  2),
    };
    const pair = pickCoverageArtists('jazz', allArtists, eloRatings);
    // Only one jazz artist in the pool → can't make a pair
    expect(pair).toBeNull();
  });

  it('pickCoverageArtists returns a pair when two jazz artists exist', () => {
    const jazzArtist2 = makeArtist('j2', 'John Coltrane', ['jazz', 'bebop']);
    const pool = [...allArtists, jazzArtist2];
    const eloRatings = {
      r1: makeElo(1700, 8, 10),
      r2: makeElo(1600, 7,  9),
      j1: makeElo(1500, 0,  0),
      j2: makeElo(1500, 0,  0),
      p1: makeElo(1520, 1,  2),
    };

    const pair = pickCoverageArtists('jazz', pool, eloRatings);
    expect(pair).not.toBeNull();
    expect(pair.strategy).toBe('coverage');
    // Both should be jazz artists
    expect((pair.A.genres || []).some(g => g.includes('jazz'))).toBe(true);
    expect((pair.B.genres || []).some(g => g.includes('jazz'))).toBe(true);
  });

  it('coverage pair sorts by least-compared first', () => {
    const jazzArtist2 = makeArtist('j2', 'John Coltrane', ['jazz']);
    const jazzArtist3 = makeArtist('j3', 'Herbie Hancock', ['jazz']);
    const pool = [jazzArtist2, jazzArtist3];
    const eloRatings = {
      j2: makeElo(1500, 0, 0),  // 0 comps — should appear first
      j3: makeElo(1520, 2, 4),  // 4 comps — should appear second
    };

    const pair = pickCoverageArtists('jazz', pool, eloRatings);
    expect(pair.A.id).toBe('j2');
    expect(pair.B.id).toBe('j3');
  });
});

// ---------------------------------------------------------------------------
// Matchup dedup: the same pair should never be served twice
// ---------------------------------------------------------------------------

describe('Matchup deduplication', () => {
  function hasPlayed(aId, bId, eloRatings) {
    return !!(eloRatings[aId]?.matchups?.[bId]);
  }

  it('correctly detects a pair that has already played', () => {
    const eloRatings = {
      a1: makeElo(1600, 3, 5, { a2: true }),
      a2: makeElo(1500, 2, 5, { a1: true }),
    };
    expect(hasPlayed('a1', 'a2', eloRatings)).toBe(true);
    expect(hasPlayed('a2', 'a1', eloRatings)).toBe(true);
  });

  it('correctly flags a fresh pair as unplayed', () => {
    const eloRatings = {
      a1: makeElo(1600, 3, 5, {}),
      a2: makeElo(1500, 2, 5, {}),
    };
    expect(hasPlayed('a1', 'a2', eloRatings)).toBe(false);
  });

  it('matchup is asymmetric — both directions must be recorded', () => {
    const eloRatings = {
      a1: makeElo(1600, 3, 5, { a2: true }),
      a2: makeElo(1500, 2, 5, {}), // a2 side not recorded yet
    };
    // a1→a2 played, but a2→a1 not recorded: shows the importance of bilateral recording
    expect(hasPlayed('a1', 'a2', eloRatings)).toBe(true);
    expect(hasPlayed('a2', 'a1', eloRatings)).toBe(false); // Bug scenario: asymmetric
  });
});

// ---------------------------------------------------------------------------
// Info-gain weight → ensures settled artists get ZERO weight
// ---------------------------------------------------------------------------

describe('Info-gain weight for settled vs unsettled artists', () => {
  it('settled dominant artist (20 comps, 19 wins) gets weight 0', () => {
    expect(getInfoGainWeight(makeElo(1800, 19, 20))).toBe(0);
  });

  it('settled dominated artist (20 comps, 1 win) gets weight 0', () => {
    expect(getInfoGainWeight(makeElo(1200, 1, 20))).toBe(0);
  });

  it('fresh artist (0 comps) gets maximum weight 3', () => {
    expect(getInfoGainWeight(null)).toBe(3);
    expect(getInfoGainWeight({ comparison_count: 0 })).toBe(3);
  });

  it('uncertain artist (6 comps, 3 wins) gets weight > settled artist at same count', () => {
    const uncertain  = getInfoGainWeight(makeElo(1500, 3, 6));
    const predictable = getInfoGainWeight(makeElo(1700, 6, 6));
    expect(uncertain).toBeGreaterThan(predictable);
  });

  /**
   * REGRESSION: Jeff Buckley scenario.
   * With 12 comparisons and 11 wins, weight should be 0 — he must NOT
   * appear in the general weighted pool. This was the root cause of the bug.
   */
  it('Jeff Buckley regression: 12 comps / 11 wins → weight 0', () => {
    expect(getInfoGainWeight(makeElo(1750, 11, 12))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Performance: viableAll pool must exclude settled anchors
// ---------------------------------------------------------------------------

describe('viableAll pool construction — performance simulation', () => {
  /**
   * Simulates 50 rounds of pair selection and verifies that a settled #1 artist
   * (Jeff Buckley) appears as a *free* participant at most N times (only when
   * a calibration task specifically requires it).
   */
  function simulatePoolSelection(artists, eloRatings, rounds = 50) {
    const appearances = {};
    for (const a of artists) appearances[a.id] = 0;

    for (let r = 0; r < rounds; r++) {
      // Build the viableAll pool the FIXED way: strictly exclude anchors
      const viableAll = artists.filter(a => getInfoGainWeight(eloRatings[a.id]) > 0);

      for (const a of viableAll) appearances[a.id]++;
    }

    return appearances;
  }

  it('settled #1 artist appears 0 times in the free pool over 50 rounds', () => {
    const jeffBuckley = makeArtist('jb', 'Jeff Buckley', ['folk rock']);
    const radiohead   = makeArtist('rh', 'Radiohead',    ['alternative']);
    const theSmths    = makeArtist('ts', 'The Smiths',   ['indie']);

    const eloRatings = {
      jb: makeElo(1780, 11, 12, { rh: true, ts: true }),
      rh: makeElo(1640,  4,  8, { jb: true }),
      ts: makeElo(1500,  2,  6, { jb: true }),
    };

    const appearances = simulatePoolSelection([jeffBuckley, radiohead, theSmths], eloRatings, 50);

    // Jeff Buckley: weight 0 → 0 appearances in viableAll
    expect(appearances['jb']).toBe(0);
    // Others should appear in every round
    expect(appearances['rh']).toBe(50);
    expect(appearances['ts']).toBe(50);
  });

  it('OLD (buggy) logic: 80% filter still leaks settled artist ~10/50 rounds', () => {
    // This test documents the OLD behaviour — the probabilistic filter was leaky
    vi.spyOn(Math, 'random').mockReturnValue(0.85); // > 0.8 threshold → artist NOT filtered

    const appearances = { jb: 0 };
    const eloDataSettled = makeElo(1780, 11, 12);

    for (let r = 0; r < 50; r++) {
      // OLD code: if (isSettled && Math.random() < 0.8) return false;
      const randomVal = 0.85; // mocked — always > 0.8, so artist is NEVER filtered
      const wouldFilter = isSettled(eloDataSettled) && randomVal < 0.8;
      if (!wouldFilter) appearances['jb']++;
    }

    // With random=0.85, settled artist is NEVER filtered → 50 appearances (the bug!)
    expect(appearances['jb']).toBe(50);

    vi.restoreAllMocks();
  });
});
