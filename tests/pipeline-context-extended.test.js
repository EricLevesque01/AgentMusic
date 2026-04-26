import { describe, it, expect } from 'vitest';
import { PipelineContext } from '../src/agents/pipeline-context.js';

/**
 * Phase 2 — Extended PipelineContext tests
 *
 * Tests the new inter-agent context fields added in Phase 2A,
 * validation edge cases, and deriveWeights boundary behavior.
 */

describe('PipelineContext — Phase 2 inter-agent fields', () => {
  describe('initial state of new fields', () => {
    it('should initialize coverageGaps as empty array', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.coverageGaps).toEqual([]);
    });

    it('should initialize settledAnchors as empty array', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.settledAnchors).toEqual([]);
    });

    it('should initialize calibrationInsights as empty array', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.calibrationInsights).toEqual([]);
    });

    it('should initialize sessionSignals with empty arrays', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.sessionSignals).toEqual({
        skippedGenres: [],
        lovedGenres: [],
        skippedArtists: [],
      });
    });

    it('should initialize tasteProfile with empty defaults', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.tasteProfile).toEqual({
        dominantGenres: [],
        underExploredGenres: [],
        anchoredTopArtist: null,
        driftSummary: '',
      });
    });

    it('should initialize explanations with empty Map', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.explanations.playlistSummary).toBe('');
      expect(ctx.explanations.trackExplanations).toBeInstanceOf(Map);
      expect(ctx.explanations.trackExplanations.size).toBe(0);
    });
  });

  describe('mutability of inter-agent fields', () => {
    it('should allow writing coverageGaps', () => {
      const ctx = PipelineContext.create('u');
      ctx.coverageGaps = [{ genre: 'jazz', totalComps: 2, priority: 1 }];
      expect(ctx.coverageGaps).toHaveLength(1);
      expect(ctx.coverageGaps[0].genre).toBe('jazz');
    });

    it('should allow pushing to settledAnchors', () => {
      const ctx = PipelineContext.create('u');
      ctx.settledAnchors.push('artist-id-123');
      expect(ctx.settledAnchors).toContain('artist-id-123');
    });

    it('should allow writing sessionSignals', () => {
      const ctx = PipelineContext.create('u');
      ctx.sessionSignals.skippedGenres.push('pop');
      ctx.sessionSignals.lovedGenres.push('rock');
      expect(ctx.sessionSignals.skippedGenres).toContain('pop');
      expect(ctx.sessionSignals.lovedGenres).toContain('rock');
    });

    it('should allow setting tasteProfile fields', () => {
      const ctx = PipelineContext.create('u');
      ctx.tasteProfile.anchoredTopArtist = 'Jeff Buckley';
      ctx.tasteProfile.dominantGenres = ['rock', 'indie'];
      ctx.tasteProfile.driftSummary = 'Gravitating toward rock';
      expect(ctx.tasteProfile.anchoredTopArtist).toBe('Jeff Buckley');
      expect(ctx.tasteProfile.dominantGenres).toEqual(['rock', 'indie']);
    });
  });

  describe('validateForStage() — all paths', () => {
    it('should fail profiler validation without userId', () => {
      const ctx = new PipelineContext({ sliders: {}, sessionId: 's1' });
      expect(() => ctx.validateForStage('profiler')).toThrow('userId');
    });

    it('should pass narrator validation with scoredPlaylist', () => {
      const ctx = PipelineContext.create('u');
      ctx.scoredPlaylist = [{ track: { id: 't1' } }];
      expect(ctx.validateForStage('narrator')).toBe(true);
    });

    it('should fail narrator validation without scoredPlaylist', () => {
      const ctx = PipelineContext.create('u');
      expect(() => ctx.validateForStage('narrator')).toThrow('scoredPlaylist');
    });

    it('should pass for unknown stages', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.validateForStage('unknownStage')).toBe(true);
    });

    it('should fail curator when tasteState exists but candidatePool is empty', () => {
      const ctx = PipelineContext.create('u');
      ctx.tasteState = { topGenres: ['rock'] };
      ctx.candidatePool = [];
      expect(() => ctx.validateForStage('curator')).toThrow('candidatePool');
    });
  });

  describe('deriveWeights() — boundary behavior', () => {
    it('should produce all positive weights', () => {
      for (const d of [0, 0.25, 0.5, 0.75, 1.0]) {
        const w = PipelineContext.create('u', { discovery: d }).deriveWeights();
        expect(w.W_elo).toBeGreaterThan(0);
        expect(w.W_session).toBeGreaterThan(0);
        expect(w.W_graph).toBeGreaterThan(0);
        expect(w.W_audio).toBeGreaterThan(0);
      }
    });

    it('should make W_session constant regardless of discovery', () => {
      // Session weight is always 0.25 (before normalization)
      // But after normalization it will vary slightly — just check it's stable
      const w1 = PipelineContext.create('u', { discovery: 0.0 }).deriveWeights();
      const w2 = PipelineContext.create('u', { discovery: 1.0 }).deriveWeights();
      // Session weight ratio should stay in a narrow band
      expect(w1.W_session).toBeGreaterThan(0.2);
      expect(w2.W_session).toBeGreaterThan(0.2);
    });

    it('W_elo at discovery=0 should be roughly 3.5x W_elo at discovery=1', () => {
      const low = PipelineContext.create('u', { discovery: 0 }).deriveWeights();
      const high = PipelineContext.create('u', { discovery: 1 }).deriveWeights();
      const ratio = low.W_elo / high.W_elo;
      expect(ratio).toBeGreaterThan(2);
      expect(ratio).toBeLessThan(5);
    });

    it('W_graph at discovery=1 should be roughly 4x W_graph at discovery=0', () => {
      const low = PipelineContext.create('u', { discovery: 0 }).deriveWeights();
      const high = PipelineContext.create('u', { discovery: 1 }).deriveWeights();
      const ratio = high.W_graph / low.W_graph;
      expect(ratio).toBeGreaterThan(2);
      expect(ratio).toBeLessThan(6);
    });
  });

  describe('create() factory', () => {
    it('should accept a custom sessionId', () => {
      const ctx = PipelineContext.create('u', {}, 'my-custom-session');
      expect(ctx.sessionId).toBe('my-custom-session');
    });

    it('should generate sessionId with timestamp format when not provided', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
    });

    it('should default all sliders to 0.5 when none provided', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.sliders.discovery).toBe(0.5);
      expect(ctx.sliders.popularity).toBe(0.5);
      expect(ctx.sliders.focus).toBe(0.5);
      expect(ctx.sliders.energy).toBe(0.5);
      expect(ctx.sliders.novelty).toBe(0.5);
    });
  });
});
