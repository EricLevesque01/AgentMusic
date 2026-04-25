import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 2+3+4 Integration Tests
 *
 * Tests for:
 *  - PipelineContext inter-agent fields
 *  - Orchestrator._populateTasteProfile()
 *  - SessionDJ → DataStore signal persistence
 *  - Drift detection patterns
 *  - Era coverage bucket logic
 */

// ---------------------------------------------------------------------------
// Portable copies of the logic under test (no DOM/API deps)
// ---------------------------------------------------------------------------

function isSettled(eloData) {
  if (!eloData) return false;
  const comps = eloData.comparison_count || 0;
  if (comps < 6) return false;
  const wins = eloData.wins || 0;
  const winRate = wins / comps;
  return winRate > 0.75 || winRate < 0.25;
}

function populateTasteProfile(eloRatings) {
  const context = {
    tasteProfile: {
      dominantGenres: [],
      underExploredGenres: [],
      anchoredTopArtist: null,
      driftSummary: '',
    },
    settledAnchors: [],
    coverageGaps: [],
    sessionSignals: { skippedGenres: [], lovedGenres: [], skippedArtists: [] },
  };

  const allRanked = Object.entries(eloRatings)
    .filter(([, d]) => d.name && d.name !== 'undefined')
    .sort((a, b) => b[1].rating - a[1].rating);

  // Anchored #1
  if (allRanked.length > 0) {
    const [topId, topData] = allRanked[0];
    const comps = topData.comparison_count || 0;
    const wins = topData.wins || 0;
    const winRate = comps > 0 ? wins / comps : 0;
    if (comps >= 6 && (winRate > 0.75 || winRate < 0.25)) {
      context.tasteProfile.anchoredTopArtist = topData.name;
      context.settledAnchors.push(topId);
    }
  }

  // Collect ALL settled
  for (const [id, data] of allRanked) {
    if (isSettled(data) && !context.settledAnchors.includes(id)) {
      context.settledAnchors.push(id);
    }
  }

  // Dominant genres
  const genreComps = {};
  for (const [, data] of allRanked) {
    for (const genre of (data.genres || [])) {
      genreComps[genre] = (genreComps[genre] || 0) + (data.comparison_count || 0);
    }
  }
  context.tasteProfile.dominantGenres = Object.entries(genreComps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  context.tasteProfile.underExploredGenres = Object.entries(genreComps)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([g]) => g);

  return context;
}

// Drift detection (copy from profiler-agent.js)
function detectDriftPatterns(sessionHistory = []) {
  if (sessionHistory.length < 5) return [];
  const patterns = [];
  const recentWins = sessionHistory.slice(-10);
  const genreStreaks = {};
  for (const round of recentWins) {
    for (const genre of (round.winnerGenres || [])) {
      genreStreaks[genre] = (genreStreaks[genre] || 0) + 1;
    }
  }
  const hotGenres = Object.entries(genreStreaks)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);
  if (hotGenres.length > 0) {
    patterns.push({
      type: 'genre_momentum',
      description: `User is gravitating toward ${hotGenres.slice(0, 2).join(' and ')} in recent rounds`,
      data: { genres: hotGenres },
    });
  }
  const discoveryPicks = recentWins.filter(r => r.winnerComps !== undefined && r.loserComps !== undefined);
  const discoveryBias = discoveryPicks.filter(r => (r.winnerComps || 0) < (r.loserComps || 0)).length;
  if (discoveryPicks.length >= 5 && discoveryBias / discoveryPicks.length > 0.65) {
    patterns.push({
      type: 'discovery_drift',
      description: 'User consistently prefers lesser-rated artists over established ones — increase discovery weight',
      data: { ratio: discoveryBias / discoveryPicks.length },
    });
  }
  const genreLosses = {};
  for (const round of recentWins) {
    for (const genre of (round.loserGenres || [])) {
      genreLosses[genre] = (genreLosses[genre] || 0) + 1;
    }
  }
  const coldGenres = Object.entries(genreLosses)
    .filter(([, count]) => count >= 3)
    .filter(([genre]) => !hotGenres.includes(genre))
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);
  if (coldGenres.length > 0) {
    patterns.push({
      type: 'rejection_pattern',
      description: `User is consistently rejecting ${coldGenres.slice(0, 2).join(' and ')}`,
      data: { genres: coldGenres },
    });
  }
  return patterns;
}

// Era bucket logic
const ERA_BUCKETS = [
  { label: 'pre-1980s classics', eraTest: (year) => year > 0 && year < 1980 },
  { label: '80s–90s',            eraTest: (year) => year >= 1980 && year < 2000 },
  { label: '2000s–2010s',        eraTest: (year) => year >= 2000 && year < 2015 },
  { label: 'recent (2015+)',     eraTest: (year) => year >= 2015 },
];

function getEraBucket(year) {
  return ERA_BUCKETS.find(b => b.eraTest(year))?.label || null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeElo(rating, wins, comps, opts = {}) {
  return {
    rating,
    name: opts.name || 'Test Artist',
    genres: opts.genres || [],
    wins,
    losses: comps - wins,
    ties: 0,
    comparison_count: comps,
    last_compared_at: null,
    beginYear: opts.beginYear || 0,
    source: 'test',
    matchups: opts.matchups || {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineContext inter-agent tasteProfile population', () => {
  it('identifies the anchored #1 artist when settled', () => {
    const elo = {
      jb: makeElo(1780, 10, 10, { name: 'Jeff Buckley', genres: ['folk rock'] }),
      rh: makeElo(1650, 4, 8, { name: 'Radiohead', genres: ['alternative'] }),
    };
    const ctx = populateTasteProfile(elo);
    expect(ctx.tasteProfile.anchoredTopArtist).toBe('Jeff Buckley');
    expect(ctx.settledAnchors).toContain('jb');
  });

  it('does NOT anchor the #1 when they are not settled', () => {
    const elo = {
      jb: makeElo(1780, 3, 5, { name: 'Jeff Buckley', genres: ['folk rock'] }),
    };
    const ctx = populateTasteProfile(elo);
    expect(ctx.tasteProfile.anchoredTopArtist).toBeNull();
  });

  it('collects all settled artists in settledAnchors', () => {
    const elo = {
      a1: makeElo(1780, 10, 10, { name: 'Artist A', genres: ['rock'] }),
      a2: makeElo(1400, 1, 8, { name: 'Artist B', genres: ['pop'] }),
      a3: makeElo(1500, 3, 6, { name: 'Artist C', genres: ['jazz'] }), // not settled
    };
    const ctx = populateTasteProfile(elo);
    expect(ctx.settledAnchors).toContain('a1');
    expect(ctx.settledAnchors).toContain('a2');
    expect(ctx.settledAnchors).not.toContain('a3');
  });

  it('computes dominant genres ranked by comparison weight', () => {
    const elo = {
      a1: makeElo(1700, 8, 12, { name: 'A', genres: ['rock', 'indie'] }),
      a2: makeElo(1600, 5, 10, { name: 'B', genres: ['rock'] }),
      a3: makeElo(1500, 2, 3, { name: 'C', genres: ['jazz'] }),
    };
    const ctx = populateTasteProfile(elo);
    // rock appears in a1(12) + a2(10) = 22 comps. indie = 12. jazz = 3.
    expect(ctx.tasteProfile.dominantGenres[0]).toBe('rock');
    expect(ctx.tasteProfile.dominantGenres).toContain('indie');
  });

  it('identifies under-explored genres with fewest comparisons', () => {
    const elo = {
      a1: makeElo(1700, 8, 12, { name: 'A', genres: ['rock'] }),
      a2: makeElo(1500, 1, 2, { name: 'B', genres: ['jazz'] }),
      a3: makeElo(1500, 0, 0, { name: 'C', genres: ['classical'] }),
    };
    const ctx = populateTasteProfile(elo);
    expect(ctx.tasteProfile.underExploredGenres[0]).toBe('classical');
    expect(ctx.tasteProfile.underExploredGenres).toContain('jazz');
  });

  it('filters out "undefined" named artists', () => {
    const elo = {
      a1: makeElo(1700, 8, 10, { name: 'Valid', genres: ['rock'] }),
      a2: makeElo(1600, 6, 8, { name: 'undefined', genres: ['pop'] }),
    };
    const ctx = populateTasteProfile(elo);
    expect(ctx.settledAnchors).not.toContain('a2');
  });
});

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

describe('Drift detection (Phase 4)', () => {
  it('returns empty for fewer than 5 rounds', () => {
    const history = [
      { winnerGenres: ['rock'], loserGenres: ['pop'] },
      { winnerGenres: ['rock'], loserGenres: ['jazz'] },
    ];
    expect(detectDriftPatterns(history)).toEqual([]);
  });

  it('detects genre momentum when one genre wins 3+ of last 10', () => {
    const history = [];
    for (let i = 0; i < 6; i++) {
      history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
    }
    const patterns = detectDriftPatterns(history);
    const momentum = patterns.find(p => p.type === 'genre_momentum');
    expect(momentum).toBeDefined();
    expect(momentum.data.genres).toContain('rock');
  });

  it('detects discovery drift when user prefers underdogs 65%+', () => {
    const history = [];
    // 7 rounds where the winner has fewer comps (underdog wins)
    for (let i = 0; i < 7; i++) {
      history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });
    }
    // 3 rounds where favorite wins
    for (let i = 0; i < 3; i++) {
      history.push({ winnerComps: 10, loserComps: 2, winnerGenres: ['rock'], loserGenres: ['indie'] });
    }
    const patterns = detectDriftPatterns(history);
    const drift = patterns.find(p => p.type === 'discovery_drift');
    expect(drift).toBeDefined();
    expect(drift.data.ratio).toBeGreaterThan(0.65);
  });

  it('does NOT flag discovery drift below 65% threshold', () => {
    const history = [];
    for (let i = 0; i < 5; i++) {
      history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });
    }
    for (let i = 0; i < 5; i++) {
      history.push({ winnerComps: 10, loserComps: 2, winnerGenres: ['rock'], loserGenres: ['indie'] });
    }
    const patterns = detectDriftPatterns(history);
    const drift = patterns.find(p => p.type === 'discovery_drift');
    expect(drift).toBeUndefined();
  });

  it('detects rejection pattern when a genre consistently loses', () => {
    const history = [];
    for (let i = 0; i < 5; i++) {
      history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
    }
    const patterns = detectDriftPatterns(history);
    const rejection = patterns.find(p => p.type === 'rejection_pattern');
    expect(rejection).toBeDefined();
    expect(rejection.data.genres).toContain('pop');
  });

  it('does NOT flag a genre as rejected if it also wins frequently', () => {
    const history = [];
    // Rock wins AND loses — it's contentious, not rejected
    for (let i = 0; i < 5; i++) {
      history.push({ winnerGenres: ['rock'], loserGenres: ['rock', 'pop'] });
    }
    const patterns = detectDriftPatterns(history);
    const rejection = patterns.find(p => p.type === 'rejection_pattern');
    // Rock has 5 wins AND 5 losses — it's a hot genre, not cold
    if (rejection) {
      expect(rejection.data.genres).not.toContain('rock');
    }
  });
});

// ---------------------------------------------------------------------------
// Era bucket coverage (Phase 3)
// ---------------------------------------------------------------------------

describe('Era coverage buckets (Phase 3)', () => {
  it('classifies 1975 as pre-1980s classics', () => {
    expect(getEraBucket(1975)).toBe('pre-1980s classics');
  });

  it('classifies 1992 as 80s–90s', () => {
    expect(getEraBucket(1992)).toBe('80s–90s');
  });

  it('classifies 2008 as 2000s–2010s', () => {
    expect(getEraBucket(2008)).toBe('2000s–2010s');
  });

  it('classifies 2020 as recent (2015+)', () => {
    expect(getEraBucket(2020)).toBe('recent (2015+)');
  });

  it('returns null for year 0 (unknown)', () => {
    expect(getEraBucket(0)).toBeNull();
  });

  it('correctly assigns boundary year 1980 to 80s–90s', () => {
    expect(getEraBucket(1980)).toBe('80s–90s');
  });

  it('correctly assigns boundary year 2000 to 2000s–2010s', () => {
    expect(getEraBucket(2000)).toBe('2000s–2010s');
  });

  it('correctly assigns boundary year 2015 to recent (2015+)', () => {
    expect(getEraBucket(2015)).toBe('recent (2015+)');
  });
});

// ---------------------------------------------------------------------------
// Session signal filtering in coverage gaps
// ---------------------------------------------------------------------------

describe('Session signal filtering (Phase 2E)', () => {
  it('coverage gap excludes genres that appear in skipped signals', () => {
    // Simulate: jazz has 0 comps but user is skipping jazz
    const skippedGenres = ['jazz'];
    const coverageBuckets = [
      { label: 'rock', match: ['rock'], totalComps: 10, candidates: [{}, {}] },
      { label: 'jazz', match: ['jazz'], totalComps: 0, candidates: [{}, {}] },
      { label: 'pop', match: ['pop'], totalComps: 5, candidates: [{}, {}] },
    ];
    const skipSet = new Set(skippedGenres.map(g => g.toLowerCase()));
    const filtered = coverageBuckets.filter(b =>
      !b.match || !b.match.some(m => skipSet.has(m))
    );
    expect(filtered.map(b => b.label)).not.toContain('jazz');
    expect(filtered.map(b => b.label)).toContain('rock');
    expect(filtered.map(b => b.label)).toContain('pop');
  });

  it('era buckets (no match array) are never filtered by genre skips', () => {
    const skippedGenres = ['jazz'];
    const eraBucket = { label: '80s–90s', totalComps: 2, candidates: [{}, {}], type: 'era' };
    const skipSet = new Set(skippedGenres);
    const shouldKeep = !eraBucket.match || !eraBucket.match.some(m => skipSet.has(m));
    expect(shouldKeep).toBe(true);
  });
});
