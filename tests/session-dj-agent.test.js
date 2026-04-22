import { describe, it, expect, vi } from 'vitest';
import { SessionDJAgent } from '../src/agents/session-dj-agent.js';

const mockCandidate = (tags = ['rock']) => ({
  track:    { id: 't1', popularity: 60 },
  artistId: 'a1',
  tags:     tags.map(t => ({ name: t })),
});

describe('SessionDJAgent', () => {
  describe('skip detection', () => {
    it('should trigger intervention after 3 consecutive skips', () => {
      const onIntervention = vi.fn();
      const dj = new SessionDJAgent(onIntervention);
      const c = mockCandidate();

      dj.recordSkip(c, 5000);
      dj.recordSkip(c, 5000);
      expect(onIntervention).not.toHaveBeenCalled();
      dj.recordSkip(c, 5000);
      expect(onIntervention).toHaveBeenCalledTimes(1);
    });

    it('should reset consecutive skips on a full listen', () => {
      const dj = new SessionDJAgent();
      const c  = mockCandidate();

      dj.recordSkip(c, 5000);
      dj.recordSkip(c, 5000);
      dj.recordListen(c);
      expect(dj.consecutiveSkips).toBe(0);
    });

    it('should penalize genre on short skip (<10s)', () => {
      const dj = new SessionDJAgent();
      dj.recordSkip(mockCandidate(['metal']), 3000);
      expect(dj.adjustments.penalizedGenres).toContain('metal');
    });

    it('should not penalize genre on longer skip', () => {
      const dj = new SessionDJAgent();
      dj.recordSkip(mockCandidate(['metal']), 15000);
      expect(dj.adjustments.penalizedGenres).not.toContain('metal');
    });
  });

  describe('applyFeedback()', () => {
    it('too_energetic should lower energy override', () => {
      const dj = new SessionDJAgent();
      dj.applyFeedback('too_energetic');
      expect(dj.adjustments.intentOverride.energy).toBeLessThan(0.5);
    });

    it('wrong_genre should penalize the candidate genre', () => {
      const dj = new SessionDJAgent();
      dj.applyFeedback('wrong_genre', mockCandidate(['jazz']));
      expect(dj.adjustments.penalizedGenres).toContain('jazz');
    });

    it('something_different should boost discovery override', () => {
      const dj = new SessionDJAgent();
      dj.applyFeedback('something_different');
      expect(dj.adjustments.intentOverride.discovery).toBeGreaterThan(0.5);
    });

    it('should reset consecutive skips after feedback', () => {
      const dj = new SessionDJAgent();
      dj.recordSkip(mockCandidate(), 5000);
      dj.recordSkip(mockCandidate(), 5000);
      dj.applyFeedback('too_energetic');
      expect(dj.consecutiveSkips).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear all ephemeral state', () => {
      const dj = new SessionDJAgent();
      dj.recordSkip(mockCandidate(['jazz']), 5000);
      dj.applyFeedback('too_energetic');
      dj.reset();

      expect(dj.consecutiveSkips).toBe(0);
      expect(dj.adjustments.penalizedGenres).toEqual([]);
      expect(dj.adjustments.intentOverride).toEqual({});
      expect(dj.skipHistory).toEqual([]);
    });
  });
});
