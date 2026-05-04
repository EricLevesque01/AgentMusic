import { describe, it, expect } from 'vitest';

/**
 * ProfilerAgent — Portable drift detection + genre extraction tests.
 * No mocks needed — tests pure logic extracted from the agent.
 */

// Portable _extractTopGenres
function extractTopGenres(artists) {
  const genreCount = {};
  for (const a of artists) {
    for (const g of (a.genres || [])) {
      genreCount[g] = (genreCount[g] || 0) + 1;
    }
  }
  return Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([g]) => g);
}

// Portable detectDriftPatterns
function detectDriftPatterns(history) {
  if (history.length < 5) return [];
  const patterns = [];
  const recent = history.slice(-10);
  const genreStreaks = {};
  for (const r of recent) {
    for (const g of (r.winnerGenres || [])) genreStreaks[g] = (genreStreaks[g] || 0) + 1;
  }
  const hot = Object.entries(genreStreaks).filter(([, c]) => c >= 3).map(([g]) => g);
  if (hot.length > 0) patterns.push({ type: 'genre_momentum', data: { genres: hot } });

  const genreLosses = {};
  for (const r of recent) {
    for (const g of (r.loserGenres || [])) genreLosses[g] = (genreLosses[g] || 0) + 1;
  }
  const cold = Object.entries(genreLosses).filter(([, c]) => c >= 3).filter(([g]) => !hot.includes(g)).map(([g]) => g);
  if (cold.length > 0) patterns.push({ type: 'rejection_pattern', data: { genres: cold } });

  const dp = recent.filter(r => r.winnerComps !== undefined && r.loserComps !== undefined);
  const bias = dp.filter(r => (r.winnerComps || 0) < (r.loserComps || 0)).length;
  if (dp.length >= 5 && bias / dp.length > 0.65) {
    patterns.push({ type: 'discovery_drift', data: { ratio: bias / dp.length } });
  }
  return patterns;
}

describe('ProfilerAgent — _extractTopGenres', () => {
  it('ranks genres by frequency', () => {
    const g = extractTopGenres([
      { genres: ['rock', 'indie'] }, { genres: ['rock', 'indie'] }, { genres: ['rock'] }, { genres: ['jazz'] },
    ]);
    expect(g[0]).toBe('rock');
    expect(g[1]).toBe('indie');
  });

  it('limits to 15', () => {
    const a = Array.from({ length: 20 }, (_, i) => ({ genres: [`g${i}`] }));
    expect(extractTopGenres(a).length).toBeLessThanOrEqual(15);
  });

  it('handles empty', () => {
    expect(extractTopGenres([])).toEqual([]);
    expect(extractTopGenres([{ genres: [] }])).toEqual([]);
  });
});

describe('ProfilerAgent — detectDriftPatterns', () => {
  it('returns empty for short history', () => {
    expect(detectDriftPatterns([])).toEqual([]);
    expect(detectDriftPatterns([{}, {}, {}])).toEqual([]);
  });

  it('detects genre momentum', () => {
    const h = Array.from({ length: 6 }, () => ({ winnerGenres: ['jazz'], loserGenres: ['pop'], winnerComps: 5, loserComps: 5 }));
    expect(detectDriftPatterns(h).find(p => p.type === 'genre_momentum')).toBeDefined();
  });

  it('detects rejection pattern', () => {
    const h = Array.from({ length: 6 }, () => ({ winnerGenres: ['indie'], loserGenres: ['pop'], winnerComps: 5, loserComps: 5 }));
    expect(detectDriftPatterns(h).find(p => p.type === 'rejection_pattern').data.genres).toContain('pop');
  });

  it('detects discovery drift', () => {
    const h = Array.from({ length: 6 }, () => ({ winnerGenres: ['x'], loserGenres: ['y'], winnerComps: 2, loserComps: 15 }));
    expect(detectDriftPatterns(h).find(p => p.type === 'discovery_drift')).toBeDefined();
  });
});
