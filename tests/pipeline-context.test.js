import { describe, it, expect } from 'vitest';
import { PipelineContext } from '../src/agents/pipeline-context.js';

describe('PipelineContext', () => {
  describe('create()', () => {
    it('should create a context with default slider values', () => {
      const ctx = PipelineContext.create('user123');
      expect(ctx.userId).toBe('user123');
      expect(ctx.sliders.discovery).toBe(0.5);
      expect(ctx.sliders.energy).toBe(0.5);
      expect(ctx.sessionId).toBeTruthy();
    });

    it('should accept custom slider values', () => {
      const ctx = PipelineContext.create('user123', { discovery: 0.9, energy: 0.2 });
      expect(ctx.sliders.discovery).toBe(0.9);
      expect(ctx.sliders.energy).toBe(0.2);
      expect(ctx.sliders.popularity).toBe(0.5); // default for unspecified
    });

    it('should generate a unique session ID', () => {
      const a = PipelineContext.create('user1');
      const b = PipelineContext.create('user1');
      expect(a.sessionId).not.toBe(b.sessionId);
    });
  });

  describe('deriveWeights()', () => {
    it('should return weights that sum to 1.0', () => {
      const ctx = PipelineContext.create('user1', { discovery: 0.5 });
      const w = ctx.deriveWeights();
      const sum = w.W_elo + w.W_session + w.W_graph + w.W_audio;
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should increase W_graph when discovery is high', () => {
      const low  = PipelineContext.create('u', { discovery: 0.0 }).deriveWeights();
      const high = PipelineContext.create('u', { discovery: 1.0 }).deriveWeights();
      expect(high.W_graph).toBeGreaterThan(low.W_graph);
    });

    it('should increase W_elo when discovery is low', () => {
      const low  = PipelineContext.create('u', { discovery: 0.0 }).deriveWeights();
      const high = PipelineContext.create('u', { discovery: 1.0 }).deriveWeights();
      expect(low.W_elo).toBeGreaterThan(high.W_elo);
    });

    it('should always sum to 1.0 at extreme slider values', () => {
      for (const d of [0, 0.25, 0.5, 0.75, 1.0]) {
        const w = PipelineContext.create('u', { discovery: d }).deriveWeights();
        const sum = w.W_elo + w.W_session + w.W_graph + w.W_audio;
        expect(sum).toBeCloseTo(1.0, 5);
      }
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
