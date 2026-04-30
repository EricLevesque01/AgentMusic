import { describe, it, expect } from 'vitest';
import {
  GENRE_TO_MUSIC,
  computeMusicDimensions,
  computeGenreDistribution,
  computeMainstreaminess,
  computeSpecialistIndex,
  computeDiversityScore,
} from '../src/data/music-dimensions.js';

// ─────────────────────────────────────
// MUSIC Dimensions
// ─────────────────────────────────────

describe('computeMusicDimensions', () => {
  it('maps all macro genres to MUSIC dimensions', () => {
    const macros = Object.keys(GENRE_TO_MUSIC);
    expect(macros.length).toBeGreaterThanOrEqual(10);
    for (const genre of macros) {
      const weights = Object.values(GENRE_TO_MUSIC[genre]);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 1); // weights should sum to ~1
    }
  });

  it('pure jazz library → high Sophisticated', () => {
    const dims = computeMusicDimensions({ 'Jazz / Blues': 1.0 });
    expect(dims.sophisticated).toBeGreaterThan(0.7);
    expect(dims.contemporary).toBeLessThan(0.1);
  });

  it('pure metal library → high Intense, low Mellow', () => {
    const dims = computeMusicDimensions({ 'Metal': 1.0 });
    expect(dims.intense).toBeGreaterThan(0.8);
    expect(dims.mellow).toBe(0);
  });

  it('pure pop library → high Contemporary', () => {
    const dims = computeMusicDimensions({ 'Pop': 1.0 });
    expect(dims.contemporary).toBeGreaterThan(0.5);
  });

  it('mixed library produces blended dimensions', () => {
    const dims = computeMusicDimensions({ 'Rock': 0.5, 'Jazz / Blues': 0.3, 'Pop': 0.2 });
    expect(dims.intense).toBeGreaterThan(0.2);
    expect(dims.sophisticated).toBeGreaterThan(0.2);
    expect(dims.contemporary).toBeGreaterThan(0.1);
  });

  it('empty distribution returns zeros', () => {
    const dims = computeMusicDimensions({});
    expect(dims.mellow).toBe(0);
    expect(dims.sophisticated).toBe(0);
    expect(dims.intense).toBe(0);
  });

  it('skips metadata fields like _confidence', () => {
    const dims = computeMusicDimensions({ 'Rock': 0.5, '_confidence': 0.8 });
    // Should not crash — _confidence should be ignored
    expect(dims.intense).toBeGreaterThan(0);
  });

  it('all dimensions are clamped to 0–1', () => {
    const dims = computeMusicDimensions({ 'Rock': 1.0 });
    for (const [key, val] of Object.entries(dims)) {
      if (key.startsWith('_')) continue;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────
// Genre Distribution
// ─────────────────────────────────────

describe('computeGenreDistribution', () => {
  it('computes proportional distribution from artist genres', () => {
    const artists = [
      { genres: ['rock', 'indie rock'] },
      { genres: ['rock', 'grunge'] },
      { genres: ['jazz'] },
    ];
    const dist = computeGenreDistribution(artists);
    expect(dist['Rock']).toBeGreaterThan(0);
    expect(dist['Jazz / Blues']).toBeGreaterThan(0);
    // Rock appears in 2 artists, jazz in 1 — rock should be larger
    expect(dist['Rock']).toBeGreaterThan(dist['Jazz / Blues']);
  });

  it('returns empty object for empty artists', () => {
    const dist = computeGenreDistribution([]);
    expect(Object.keys(dist).length).toBe(0);
  });

  it('values sum to approximately 1.0', () => {
    const artists = [
      { genres: ['rock'] },
      { genres: ['jazz'] },
      { genres: ['pop'] },
    ];
    const dist = computeGenreDistribution(artists);
    const sum = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});

// ─────────────────────────────────────
// Mainstreaminess
// ─────────────────────────────────────

describe('computeMainstreaminess', () => {
  it('popular artists → high mainstreaminess', () => {
    const artists = [{ popularity: 90 }, { popularity: 85 }, { popularity: 92 }];
    expect(computeMainstreaminess(artists)).toBeGreaterThan(0.8);
  });

  it('niche artists → low mainstreaminess', () => {
    const artists = [{ popularity: 15 }, { popularity: 22 }, { popularity: 10 }];
    expect(computeMainstreaminess(artists)).toBeLessThan(0.3);
  });

  it('empty array → 0.5 default', () => {
    expect(computeMainstreaminess([])).toBe(0.5);
  });

  it('null input → 0.5 default', () => {
    expect(computeMainstreaminess(null)).toBe(0.5);
  });

  it('returns value between 0 and 1', () => {
    const result = computeMainstreaminess([{ popularity: 50 }]);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────
// Specialist Index
// ─────────────────────────────────────

describe('computeSpecialistIndex', () => {
  it('few genres with deep ratings → higher specialist', () => {
    const elo = {
      a1: { genres: ['jazz'], comparison_count: 20 },
      a2: { genres: ['jazz'], comparison_count: 15 },
      a3: { genres: ['jazz', 'blues'], comparison_count: 10 },
    };
    const idx = computeSpecialistIndex(elo);
    expect(idx).toBeGreaterThan(0.3);
  });

  it('many genres with shallow ratings → lower specialist', () => {
    const elo = {
      a1: { genres: ['jazz'], comparison_count: 2 },
      a2: { genres: ['rock'], comparison_count: 2 },
      a3: { genres: ['pop'], comparison_count: 2 },
      a4: { genres: ['metal'], comparison_count: 2 },
      a5: { genres: ['hip-hop'], comparison_count: 2 },
      a6: { genres: ['country'], comparison_count: 2 },
      a7: { genres: ['classical'], comparison_count: 2 },
      a8: { genres: ['r&b'], comparison_count: 2 },
      a9: { genres: ['electronic'], comparison_count: 2 },
      a10: { genres: ['folk'], comparison_count: 2 },
    };
    const broad = computeSpecialistIndex(elo);
    // Compare against the specialist case
    const deep = computeSpecialistIndex({
      a1: { genres: ['jazz'], comparison_count: 20 },
      a2: { genres: ['jazz'], comparison_count: 15 },
    });
    expect(deep).toBeGreaterThan(broad);
  });

  it('empty input → 0.5 default', () => {
    expect(computeSpecialistIndex({})).toBe(0.5);
    expect(computeSpecialistIndex(null)).toBe(0.5);
  });
});

// ─────────────────────────────────────
// Diversity Score
// ─────────────────────────────────────

describe('computeDiversityScore', () => {
  it('single genre → 0', () => {
    expect(computeDiversityScore({ 'Rock': 1.0 })).toBe(0);
  });

  it('uniform distribution → 1.0', () => {
    const dist = { 'Rock': 0.25, 'Jazz / Blues': 0.25, 'Pop': 0.25, 'Metal': 0.25 };
    expect(computeDiversityScore(dist)).toBeCloseTo(1.0, 1);
  });

  it('skewed distribution → moderate diversity', () => {
    const dist = { 'Rock': 0.8, 'Jazz / Blues': 0.1, 'Pop': 0.1 };
    const score = computeDiversityScore(dist);
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.9);
  });

  it('skips metadata fields', () => {
    const dist = { 'Rock': 0.5, 'Pop': 0.5, '_confidence': 0.8 };
    expect(computeDiversityScore(dist)).toBeCloseTo(1.0, 1);
  });
});
