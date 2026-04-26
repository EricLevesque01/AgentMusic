import { describe, it, expect } from 'vitest';
import { expectedScore, updateRatings } from '../src/engine/elo.js';

/**
 * Extended Elo tests — edge cases and mathematical properties
 *
 * Covers:
 *  - Extreme rating differences
 *  - Symmetry property (zero-sum)
 *  - K-factor sensitivity
 *  - Rating stability over many rounds
 *  - Convergence behavior
 */

describe('Elo Engine — extended', () => {
  describe('expectedScore edge cases', () => {
    it('should return ~0.99 for a 400-point advantage', () => {
      const es = expectedScore(1800, 1400);
      expect(es).toBeGreaterThan(0.9);
      expect(es).toBeLessThan(1.0);
    });

    it('should return ~0.01 for a 400-point deficit', () => {
      const es = expectedScore(1400, 1800);
      expect(es).toBeGreaterThan(0);
      expect(es).toBeLessThan(0.1);
    });

    it('should return near 1.0 for a massive 1000-point advantage', () => {
      const es = expectedScore(2500, 1500);
      expect(es).toBeGreaterThan(0.99);
    });

    it('should return near 0 for a massive 1000-point deficit', () => {
      const es = expectedScore(1500, 2500);
      expect(es).toBeLessThan(0.01);
    });

    it('should handle negative ratings', () => {
      const es = expectedScore(-100, -100);
      expect(es).toBeCloseTo(0.5);
    });

    it('should handle zero ratings', () => {
      const es = expectedScore(0, 0);
      expect(es).toBeCloseTo(0.5);
    });

    it('expected scores for A vs B and B vs A should sum to 1.0', () => {
      for (const [a, b] of [[1500, 1600], [1000, 2000], [1500, 1500], [800, 1200]]) {
        const esA = expectedScore(a, b);
        const esB = expectedScore(b, a);
        expect(esA + esB).toBeCloseTo(1.0, 10);
      }
    });
  });

  describe('updateRatings — zero-sum property', () => {
    it('total rating points should be conserved after a win', () => {
      const { newA, newB } = updateRatings(1500, 1500, 'A');
      expect(newA + newB).toBe(3000);
    });

    it('total rating points should be conserved after an upset', () => {
      const { newA, newB } = updateRatings(1200, 1800, 'A');
      expect(newA + newB).toBe(3000);
    });

    it('total rating points should be conserved after a draw', () => {
      const { newA, newB } = updateRatings(1500, 1500, 'DRAW');
      expect(newA + newB).toBe(3000);
    });

    it('total rating points conserved for unequal ratings + draw', () => {
      const { newA, newB } = updateRatings(1600, 1400, 'DRAW');
      expect(newA + newB).toBe(3000);
    });
  });

  describe('updateRatings — K-factor sensitivity', () => {
    it('higher K-factor should produce larger rating changes', () => {
      const low  = updateRatings(1500, 1500, 'A', 16);
      const high = updateRatings(1500, 1500, 'A', 64);
      const changeLow  = low.newA - 1500;
      const changeHigh = high.newA - 1500;
      expect(changeHigh).toBeGreaterThan(changeLow);
      expect(changeHigh).toBe(changeLow * 4);
    });

    it('K-factor=0 should produce no rating change', () => {
      const { newA, newB } = updateRatings(1500, 1500, 'A', 0);
      expect(newA).toBe(1500);
      expect(newB).toBe(1500);
    });

    it('default K-factor should be 32', () => {
      const result = updateRatings(1500, 1500, 'A');
      // With equal ratings and K=32: change = 32 * (1.0 - 0.5) = 16
      expect(result.newA).toBe(1516);
      expect(result.newB).toBe(1484);
    });
  });

  describe('updateRatings — convergence behavior', () => {
    it('should converge: repeated winner keeps gaining less each time', () => {
      let a = 1500, b = 1500;
      const gains = [];
      for (let i = 0; i < 10; i++) {
        const result = updateRatings(a, b, 'A');
        gains.push(result.newA - a);
        a = result.newA;
        b = result.newB;
      }
      // Each successive gain should be smaller (diminishing returns)
      for (let i = 1; i < gains.length; i++) {
        expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]);
      }
    });

    it('a huge upset should award near-maximum K points', () => {
      const { newA } = updateRatings(1000, 2000, 'A', 32);
      const gain = newA - 1000;
      // Expected score for 1000 vs 2000 is ~0.003, so gain ≈ 32 * (1 - 0.003) ≈ 31.9
      expect(gain).toBeGreaterThanOrEqual(31);
      expect(gain).toBeLessThanOrEqual(32);
    });

    it('a predictable win by the favorite should award near-zero points', () => {
      const { newA } = updateRatings(2000, 1000, 'A', 32);
      const gain = newA - 2000;
      // Expected score for 2000 vs 1000 is ~0.997, so gain ≈ 32 * (1 - 0.997) ≈ 0.1
      expect(gain).toBeLessThanOrEqual(1);
      expect(gain).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateRatings — symmetry', () => {
    it('for equal ratings, A winning should produce mirror of B winning', () => {
      const resultA = updateRatings(1500, 1500, 'A');
      const resultB = updateRatings(1500, 1500, 'B');

      // With equal ratings, gains and losses should be perfectly symmetric
      expect(resultA.newA).toBe(resultB.newB); // winner gets same
      expect(resultA.newB).toBe(resultB.newA); // loser gets same
    });

    it('gain from upset should be larger than gain from expected win', () => {
      // Underdog (1400) beating favorite (1600) should gain more
      // than favorite (1600) beating underdog (1400)
      const upset    = updateRatings(1400, 1600, 'A');
      const expected = updateRatings(1600, 1400, 'A');
      const upsetGain    = upset.newA - 1400;
      const expectedGain = expected.newA - 1600;
      expect(upsetGain).toBeGreaterThan(expectedGain);
    });
  });
});
