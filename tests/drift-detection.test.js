import { describe, it, expect } from 'vitest';
import { ProfilerAgent } from '../src/agents/profiler-agent.js';

/**
 * Extended Profiler tests — drift detection (Phase 4)
 *
 * These test the REAL ProfilerAgent.detectDriftPatterns() method,
 * not the portable copy in context-sharing.test.js.
 */

const profiler = new ProfilerAgent();

describe('ProfilerAgent.detectDriftPatterns() — full coverage', () => {
  it('should return empty for fewer than 5 rounds', () => {
    expect(profiler.detectDriftPatterns([])).toEqual([]);
    expect(profiler.detectDriftPatterns([
      { winnerGenres: ['rock'], loserGenres: ['pop'] },
      { winnerGenres: ['rock'], loserGenres: ['pop'] },
    ])).toEqual([]);
  });

  it('should return empty when no clear patterns exist', () => {
    const history = [
      { winnerGenres: ['rock'], loserGenres: ['pop'] },
      { winnerGenres: ['jazz'], loserGenres: ['rock'] },
      { winnerGenres: ['pop'], loserGenres: ['jazz'] },
      { winnerGenres: ['indie'], loserGenres: ['metal'] },
      { winnerGenres: ['metal'], loserGenres: ['indie'] },
    ];
    const patterns = profiler.detectDriftPatterns(history);
    // No genre reaches 3 wins, no discovery data, no genre reaches 3 losses
    expect(patterns).toEqual([]);
  });

  describe('genre momentum', () => {
    it('should detect genre momentum when one genre wins 3+ times', () => {
      const history = [];
      for (let i = 0; i < 5; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const momentum = patterns.find(p => p.type === 'genre_momentum');
      expect(momentum).toBeDefined();
      expect(momentum.data.genres).toContain('rock');
      expect(momentum.description).toContain('rock');
    });

    it('should detect multiple hot genres', () => {
      const history = [];
      for (let i = 0; i < 3; i++) history.push({ winnerGenres: ['rock', 'indie'], loserGenres: ['pop'] });
      for (let i = 0; i < 3; i++) history.push({ winnerGenres: ['jazz'], loserGenres: ['electronic'] });
      const patterns = profiler.detectDriftPatterns(history);
      const momentum = patterns.find(p => p.type === 'genre_momentum');
      expect(momentum).toBeDefined();
      expect(momentum.data.genres).toContain('rock');
      expect(momentum.data.genres).toContain('indie');
      expect(momentum.data.genres).toContain('jazz');
    });

    it('should only look at the last 10 rounds', () => {
      const history = [];
      // First 20 rounds: pop wins (should be ignored — only last 10 matter)
      for (let i = 0; i < 20; i++) history.push({ winnerGenres: ['pop'], loserGenres: ['rock'] });
      // Last 10 rounds: rock wins
      for (let i = 0; i < 10; i++) history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });

      const patterns = profiler.detectDriftPatterns(history);
      const momentum = patterns.find(p => p.type === 'genre_momentum');
      expect(momentum).toBeDefined();
      expect(momentum.data.genres).toContain('rock');
    });
  });

  describe('discovery drift', () => {
    it('should detect discovery drift when underdogs win 65%+', () => {
      const history = [];
      // 7 underdog wins
      for (let i = 0; i < 7; i++) {
        history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });
      }
      // 3 favorite wins
      for (let i = 0; i < 3; i++) {
        history.push({ winnerComps: 10, loserComps: 2, winnerGenres: ['rock'], loserGenres: ['indie'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const drift = patterns.find(p => p.type === 'discovery_drift');
      expect(drift).toBeDefined();
      expect(drift.data.ratio).toBeCloseTo(0.7, 1);
    });

    it('should NOT detect discovery drift at exactly 50/50', () => {
      const history = [];
      for (let i = 0; i < 5; i++) {
        history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });
      }
      for (let i = 0; i < 5; i++) {
        history.push({ winnerComps: 10, loserComps: 2, winnerGenres: ['rock'], loserGenres: ['indie'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const drift = patterns.find(p => p.type === 'discovery_drift');
      expect(drift).toBeUndefined();
    });

    it('should ignore rounds without comparison counts', () => {
      const history = [];
      // 7 rounds without comp data — should be excluded from ratio calc
      for (let i = 0; i < 7; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
      }
      // Only 2 rounds with comp data — below threshold of 5
      history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });
      history.push({ winnerComps: 2, loserComps: 10, winnerGenres: ['indie'], loserGenres: ['rock'] });

      const patterns = profiler.detectDriftPatterns(history);
      const drift = patterns.find(p => p.type === 'discovery_drift');
      expect(drift).toBeUndefined(); // Not enough comp-data rounds
    });
  });

  describe('rejection pattern', () => {
    it('should detect rejection when a genre loses 3+ times', () => {
      const history = [];
      for (let i = 0; i < 5; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const rejection = patterns.find(p => p.type === 'rejection_pattern');
      expect(rejection).toBeDefined();
      expect(rejection.data.genres).toContain('pop');
    });

    it('should NOT flag genre as rejected if it also wins frequently (mixed)', () => {
      const history = [];
      // Rock wins AND loses — contentious, not rejected
      for (let i = 0; i < 5; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['rock', 'pop'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const rejection = patterns.find(p => p.type === 'rejection_pattern');
      // Rock has 5 wins (hot) — should be excluded from cold list
      if (rejection) {
        expect(rejection.data.genres).not.toContain('rock');
      }
    });

    it('should detect multiple rejected genres', () => {
      const history = [];
      for (let i = 0; i < 5; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['pop', 'electronic'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const rejection = patterns.find(p => p.type === 'rejection_pattern');
      expect(rejection).toBeDefined();
      expect(rejection.data.genres).toContain('pop');
      expect(rejection.data.genres).toContain('electronic');
    });
  });

  describe('combined patterns', () => {
    it('can detect momentum + rejection simultaneously', () => {
      const history = [];
      for (let i = 0; i < 6; i++) {
        history.push({ winnerGenres: ['rock'], loserGenres: ['pop'] });
      }
      const patterns = profiler.detectDriftPatterns(history);
      expect(patterns.length).toBeGreaterThanOrEqual(2);
      expect(patterns.some(p => p.type === 'genre_momentum')).toBe(true);
      expect(patterns.some(p => p.type === 'rejection_pattern')).toBe(true);
    });

    it('can detect all three patterns at once', () => {
      const history = [];
      for (let i = 0; i < 7; i++) {
        history.push({
          winnerGenres: ['indie'],
          loserGenres: ['pop'],
          winnerComps: 2,
          loserComps: 12,
        });
      }
      for (let i = 0; i < 3; i++) {
        history.push({
          winnerGenres: ['rock'],
          loserGenres: ['electronic'],
          winnerComps: 8,
          loserComps: 1,
        });
      }
      const patterns = profiler.detectDriftPatterns(history);
      const types = patterns.map(p => p.type);
      expect(types).toContain('genre_momentum');     // indie wins 7x
      expect(types).toContain('discovery_drift');     // 70% underdogs
      expect(types).toContain('rejection_pattern');   // pop loses 7x
    });
  });
});
