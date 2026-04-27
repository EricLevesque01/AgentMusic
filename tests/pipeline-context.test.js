import { describe, it, expect } from 'vitest';
import { PipelineContext } from '../src/agents/pipeline-context.js';

describe('PipelineContext', () => {
  describe('create()', () => {
    it('should create a context with a default session intent', () => {
      const ctx = PipelineContext.create('user123');
      expect(ctx.userId).toBe('user123');
      expect(ctx.sessionIntent).toBe('A balanced mix of my top S-Tier artists and some similar discoveries.');
      expect(ctx.sessionId).toBeTruthy();
    });

    it('should accept custom session intent', () => {
      const ctx = PipelineContext.create('user123', 'A rainy day indie mix');
      expect(ctx.sessionIntent).toBe('A rainy day indie mix');
    });

    it('should generate a unique session ID', () => {
      const a = PipelineContext.create('user1');
      const b = PipelineContext.create('user1');
      expect(a.sessionId).not.toBe(b.sessionId);
    });
  });

  describe('validateForStage()', () => {
    it('should pass profiler validation with userId', () => {
      const ctx = PipelineContext.create('user1');
      expect(ctx.validateForStage('profiler')).toBe(true);
    });

    it('should fail scout validation without tasteState', () => {
      const ctx = PipelineContext.create('user1');
      expect(() => ctx.validateForStage('scout')).toThrow('tasteState');
    });

    it('should pass scout validation with tasteState', () => {
      const ctx = PipelineContext.create('user1');
      ctx.tasteState = { eloRatings: new Map(), topGenres: [], audioProfile: {} };
      expect(ctx.validateForStage('scout')).toBe(true);
    });

    it('should fail curator validation without candidates', () => {
      const ctx = PipelineContext.create('user1');
      ctx.tasteState = { eloRatings: new Map() };
      expect(() => ctx.validateForStage('curator')).toThrow('candidatePool');
    });
  });

  describe('initial state', () => {
    it('should have empty arrays and maps by default', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.candidatePool).toEqual([]);
      expect(ctx.scoredPlaylist).toEqual([]);
      expect(ctx.conciergeActions).toEqual([]);
      expect(ctx.chatHistory).toEqual([]);
      expect(ctx.sessionAdjustments.penalizedGenres).toEqual([]);
      expect(ctx.sessionAdjustments.boostedGenres).toEqual([]);
    });
  });
});
