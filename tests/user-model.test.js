import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * UserModel tests — uses portable copies of logic to avoid DOM/localStorage deps.
 * Tests the core data transformations, not the persistence layer.
 */

// ─────────────────────────────────────
// Portable copies of UserModel logic
// ─────────────────────────────────────

import {
  computeMusicDimensions,
  computeGenreDistribution,
  computeMainstreaminess,
  computeSpecialistIndex,
  computeDiversityScore,
} from '../src/data/music-dimensions.js';

/** Simulate buildFromProfiler's anchor extraction */
function extractAnchorArtists(eloRatings) {
  return Object.entries(eloRatings)
    .filter(([, d]) => d.name && d.name !== 'undefined')
    .filter(([, d]) => {
      const comps = d.comparison_count || 0;
      const wins = d.wins || 0;
      const wr = comps > 0 ? wins / comps : 0;
      return comps >= 6 && (wr > 0.75 || wr < 0.25);
    })
    .sort((a, b) => b[1].rating - a[1].rating)
    .slice(0, 10)
    .map(([id, d]) => ({
      id, name: d.name, rating: d.rating,
      confidence: Math.min(0.95, 0.7 + (d.comparison_count - 6) * 0.03),
      genres: d.genres || [],
    }));
}

/** Simulate sophistication level computation */
function computeSophisticationLevel(eloRatings) {
  const allGenres = new Set();
  for (const data of Object.values(eloRatings)) {
    if (data.name && data.name !== 'undefined') {
      for (const g of (data.genres || [])) allGenres.add(g);
    }
  }
  if (allGenres.size >= 15) return 'expert';
  if (allGenres.size >= 8) return 'engaged';
  if (allGenres.size >= 3) return 'casual';
  return 'novice';
}

/** Simulate behavioral evidence management */
function createEvidenceStore() {
  const store = {
    fullListens: [], partialListens: [], skips: [], rapidSkips: [],
    saves: [], eloWins: [], eloLosses: [],
    boosts: [], dampens: [], blocks: [], chatPreferences: [],
  };

  const typeMap = {
    fullListen: 'fullListens', partialListen: 'partialListens',
    skip: 'skips', rapidSkip: 'rapidSkips', save: 'saves',
    eloWin: 'eloWins', eloLoss: 'eloLosses',
    boost: 'boosts', dampen: 'dampens', block: 'blocks',
    chatPreference: 'chatPreferences',
  };

  return {
    log(type, data) {
      const key = typeMap[type];
      if (!key || !store[key]) return;
      store[key].push({ ...data, ts: Date.now() });
      if (store[key].length > 500) store[key] = store[key].slice(-500);
    },
    get() { return store; },
  };
}

/** Simulate confidence decay */
function applyConfidenceDecay(confidence, lastEvidence) {
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const DECAY_RATE = 0.05;
  const monthsElapsed = (Date.now() - lastEvidence) / MONTH_MS;
  if (monthsElapsed > 1) {
    return Math.max(0, confidence - DECAY_RATE * Math.floor(monthsElapsed));
  }
  return confidence;
}

/** Simulate time-of-day classification */
function classifyTimeOfDay(hour) {
  if (hour < 6) return 'late_night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'late_night';
}

// ─────────────────────────────────────
// Fixtures
// ─────────────────────────────────────

function makeElo(rating, wins, comps, opts = {}) {
  return {
    rating, name: opts.name || 'Test Artist',
    genres: opts.genres || [], wins,
    losses: comps - wins, ties: 0,
    comparison_count: comps,
  };
}

// ─────────────────────────────────────
// Tests
// ─────────────────────────────────────

describe('UserModel — Anchor Artist Extraction', () => {
  it('extracts settled artists with high win rate', () => {
    const elo = {
      jb: makeElo(1780, 10, 10, { name: 'Jeff Buckley', genres: ['folk rock'] }),
      rh: makeElo(1650, 4, 8, { name: 'Radiohead', genres: ['alternative'] }),
    };
    const anchors = extractAnchorArtists(elo);
    expect(anchors).toHaveLength(1); // Only Jeff (100% WR). Radiohead 50% doesn't qualify.
    expect(anchors[0].name).toBe('Jeff Buckley');
  });

  it('extracts artists with low win rate (settled at bottom)', () => {
    const elo = {
      bad: makeElo(1200, 0, 8, { name: 'Disliked Band', genres: ['pop'] }),
    };
    const anchors = extractAnchorArtists(elo);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].name).toBe('Disliked Band');
  });

  it('filters out artists with fewer than 6 comparisons', () => {
    const elo = {
      new: makeElo(1700, 4, 4, { name: 'Newcomer', genres: ['rock'] }),
    };
    expect(extractAnchorArtists(elo)).toHaveLength(0);
  });

  it('filters out undefined artist names', () => {
    const elo = {
      bad: makeElo(1700, 8, 8, { name: 'undefined', genres: ['rock'] }),
    };
    expect(extractAnchorArtists(elo)).toHaveLength(0);
  });

  it('computes confidence based on comparison count', () => {
    const elo = {
      a: makeElo(1780, 10, 10, { name: 'A', genres: [] }),
      b: makeElo(1700, 20, 20, { name: 'B', genres: [] }),
    };
    const anchors = extractAnchorArtists(elo);
    const aConf = anchors.find(x => x.name === 'A').confidence;
    const bConf = anchors.find(x => x.name === 'B').confidence;
    expect(bConf).toBeGreaterThan(aConf); // More comparisons = higher confidence
  });

  it('limits to 10 anchors', () => {
    const elo = {};
    for (let i = 0; i < 15; i++) {
      elo[`a${i}`] = makeElo(1700 + i, 8, 8, { name: `Artist ${i}` });
    }
    expect(extractAnchorArtists(elo).length).toBeLessThanOrEqual(10);
  });
});

describe('UserModel — Sophistication Level', () => {
  it('expert when 15+ unique genres', () => {
    const elo = {};
    for (let i = 0; i < 15; i++) {
      elo[`a${i}`] = { name: `A${i}`, genres: [`genre_${i}`] };
    }
    expect(computeSophisticationLevel(elo)).toBe('expert');
  });

  it('engaged when 8-14 genres', () => {
    const elo = {};
    for (let i = 0; i < 10; i++) {
      elo[`a${i}`] = { name: `A${i}`, genres: [`genre_${i}`] };
    }
    expect(computeSophisticationLevel(elo)).toBe('engaged');
  });

  it('casual when 3-7 genres', () => {
    const elo = {
      a: { name: 'A', genres: ['rock'] },
      b: { name: 'B', genres: ['jazz'] },
      c: { name: 'C', genres: ['pop'] },
    };
    expect(computeSophisticationLevel(elo)).toBe('casual');
  });

  it('novice when <3 genres', () => {
    const elo = {
      a: { name: 'A', genres: ['rock'] },
      b: { name: 'B', genres: ['rock'] },
    };
    expect(computeSophisticationLevel(elo)).toBe('novice');
  });

  it('filters undefined names', () => {
    const elo = {
      a: { name: 'A', genres: ['rock', 'jazz', 'pop'] },
      b: { name: 'undefined', genres: ['metal', 'classical', 'folk'] },
    };
    expect(computeSophisticationLevel(elo)).toBe('casual'); // Only 3 genres from A
  });
});

describe('UserModel — Behavioral Evidence (Separated Events)', () => {
  it('separates skips from listens into different buckets', () => {
    const store = createEvidenceStore();
    store.log('skip', { trackId: 't1', genres: ['jazz'], listenMs: 8000 });
    store.log('fullListen', { trackId: 't2', genres: ['rock'] });
    store.log('rapidSkip', { trackId: 't3', genres: ['pop'] });

    const evidence = store.get();
    expect(evidence.skips).toHaveLength(1);
    expect(evidence.fullListens).toHaveLength(1);
    expect(evidence.rapidSkips).toHaveLength(1);
    expect(evidence.skips[0].trackId).toBe('t1');
    expect(evidence.fullListens[0].trackId).toBe('t2');
  });

  it('enforces rolling window at 500 events', () => {
    const store = createEvidenceStore();
    for (let i = 0; i < 600; i++) {
      store.log('fullListen', { trackId: `t${i}` });
    }
    expect(store.get().fullListens.length).toBeLessThanOrEqual(500);
  });

  it('ignores unknown event types', () => {
    const store = createEvidenceStore();
    store.log('totallyFakeType', { data: 1 });
    // Should not crash, and no bucket should be affected
    const evidence = store.get();
    const totalEvents = Object.values(evidence).reduce((s, arr) => s + arr.length, 0);
    expect(totalEvents).toBe(0);
  });

  it('timestamps each event', () => {
    const store = createEvidenceStore();
    const before = Date.now();
    store.log('boost', { genre: 'jazz' });
    const after = Date.now();
    const ts = store.get().boosts[0].ts;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('UserModel — Confidence Decay', () => {
  it('no decay within 1 month', () => {
    const lastEvidence = Date.now() - 20 * 24 * 60 * 60 * 1000; // 20 days ago
    expect(applyConfidenceDecay(0.8, lastEvidence)).toBe(0.8);
  });

  it('decays by 0.05 after 1 month', () => {
    const lastEvidence = Date.now() - 45 * 24 * 60 * 60 * 1000; // 45 days ago
    expect(applyConfidenceDecay(0.8, lastEvidence)).toBeCloseTo(0.75, 2);
  });

  it('decays by 0.15 after 3 months', () => {
    const lastEvidence = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(applyConfidenceDecay(0.8, lastEvidence)).toBeCloseTo(0.65, 2);
  });

  it('never drops below 0', () => {
    const lastEvidence = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
    expect(applyConfidenceDecay(0.3, lastEvidence)).toBeGreaterThanOrEqual(0);
  });
});

describe('UserModel — Session State', () => {
  it('classifies time of day correctly', () => {
    expect(classifyTimeOfDay(3)).toBe('late_night');
    expect(classifyTimeOfDay(9)).toBe('morning');
    expect(classifyTimeOfDay(14)).toBe('afternoon');
    expect(classifyTimeOfDay(20)).toBe('evening');
    expect(classifyTimeOfDay(23)).toBe('late_night');
  });

  it('classifies boundary hours correctly', () => {
    expect(classifyTimeOfDay(0)).toBe('late_night');
    expect(classifyTimeOfDay(6)).toBe('morning');
    expect(classifyTimeOfDay(12)).toBe('afternoon');
    expect(classifyTimeOfDay(18)).toBe('evening');
    expect(classifyTimeOfDay(22)).toBe('late_night');
  });
});

describe('UserModel — Tier 1 Build Pipeline', () => {
  it('full pipeline: artists → genreDist → musicDims → discovery', () => {
    const artists = [
      { genres: ['jazz', 'bebop'], popularity: 25 },
      { genres: ['jazz', 'cool jazz'], popularity: 30 },
      { genres: ['rock', 'indie rock'], popularity: 60 },
    ];
    const eloRatings = {
      a1: { name: 'Miles Davis', genres: ['jazz', 'bebop'], comparison_count: 15, wins: 12, rating: 1780 },
      a2: { name: 'Bill Evans', genres: ['jazz', 'cool jazz'], comparison_count: 10, wins: 8, rating: 1700 },
      a3: { name: 'Radiohead', genres: ['rock', 'indie rock'], comparison_count: 8, wins: 5, rating: 1600 },
    };

    // Step 1: Genre distribution
    const dist = computeGenreDistribution(
      Object.values(eloRatings).map(a => ({ genres: a.genres, id: null }))
    );
    expect(dist['Jazz / Blues']).toBeGreaterThan(0);
    expect(dist['Rock']).toBeGreaterThan(0);

    // Step 2: MUSIC dimensions from distribution
    const dims = computeMusicDimensions(dist);
    expect(dims.sophisticated).toBeGreaterThan(dims.contemporary); // jazz-heavy → sophisticated

    // Step 3: Discovery metrics
    const mainstream = computeMainstreaminess(artists);
    expect(mainstream).toBeLessThan(0.5); // low popularity = niche

    const specialist = computeSpecialistIndex(eloRatings);
    expect(specialist).toBeGreaterThan(0.2); // jazz-dominated = specialist-leaning

    // Step 4: Anchors
    const anchors = extractAnchorArtists(eloRatings);
    expect(anchors[0].name).toBe('Miles Davis'); // highest Elo, settled (12/15 = 80%)
  });
});
