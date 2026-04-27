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

  describe('create() factory', () => {
    it('should accept a custom sessionId', () => {
      const ctx = PipelineContext.create('u', 'chill vibes', 'my-custom-session');
      expect(ctx.sessionId).toBe('my-custom-session');
    });

    it('should generate sessionId with timestamp format when not provided', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
    });

    it('should default sessionIntent when not provided', () => {
      const ctx = PipelineContext.create('u');
      expect(ctx.sessionIntent).toBe('A balanced mix of my top S-Tier artists and some similar discoveries.');
    });
  });
});
