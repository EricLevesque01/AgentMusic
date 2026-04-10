import { describe, it, expect } from 'vitest';
import { expectedScore, updateRatings } from '../src/engine/elo.js';

describe('Elo Engine', () => {
  describe('expectedScore()', () => {
    it('should return 0.5 for equal ratings', () => {
      expect(expectedScore(1500, 1500)).toBe(0.5);
    });

    it('should sum to 1.0 for both players', () => {
      const a = expectedScore(1600, 1400);
      const b = expectedScore(1400, 1600);
      expect(a + b).toBeCloseTo(1.0);
    });

    it('should favor the higher rated player', () => {
      expect(expectedScore(2000, 1000)).toBeGreaterThan(0.9);
      expect(expectedScore(1000, 2000)).toBeLessThan(0.1);
    });
  });

  describe('updateRatings()', () => {
    it('should increase winner and decrease loser ratings', () => {
      const { newA, newB } = updateRatings(1500, 1500, 'A');
      expect(newA).toBeGreaterThan(1500);
      expect(newB).toBeLessThan(1500);
    });

    it('should handle zero-sum changes for equal ratings', () => {
      const { newA, newB } = updateRatings(1500, 1500, 'A');
      const gainA = newA - 1500;
      const lossB = 1500 - newB;
      expect(gainA).toBe(lossB);
    });

    it('should award fewer points for a predictable win', () => {
      const { newA: strongWin } = updateRatings(2000, 1000, 'A');
      const { newA: weakWin } = updateRatings(1500, 1500, 'A');
      const gainStrong = strongWin - 2000;
      const gainWeak = weakWin - 1500;
      expect(gainStrong).toBeLessThan(gainWeak);
    });

    it('should penalize heavily for an upset', () => {
      const { newA: strongLoss } = updateRatings(2000, 1000, 'B');
      const { newA: equalLoss } = updateRatings(1500, 1500, 'B');
      const lossStrong = 2000 - strongLoss;
      const lossEqual = 1500 - equalLoss;
      expect(lossStrong).toBeGreaterThan(lossEqual);
    });

    it('should handle draws correctly', () => {
      const { newA, newB } = updateRatings(1600, 1400, 'DRAW');
      // Stronger player should lose a little, weaker should gain a little
      expect(newA).toBeLessThan(1600);
      expect(newB).toBeGreaterThan(1400);
    });
  });
});
