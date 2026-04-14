import { describe, it, expect } from 'vitest';
import { ProfilerAgent } from '../src/agents/profiler-agent.js';

describe('ProfilerAgent', () => {
  const profiler = new ProfilerAgent();

  describe('computeAudioProfile()', () => {
    it('should compute correct averages from audio features', () => {
      const features = [
        { energy: 0.8, valence: 0.6, tempo: 140, danceability: 0.7 },
        { energy: 0.4, valence: 0.2, tempo: 100, danceability: 0.3 },
      ];

      const profile = profiler.computeAudioProfile(features);

      expect(profile.avgEnergy).toBeCloseTo(0.6);
      expect(profile.avgValence).toBeCloseTo(0.4);
      expect(profile.avgTempo).toBeCloseTo(120);
      expect(profile.avgDanceability).toBeCloseTo(0.5);
    });

    it('should return defaults for empty features', () => {
      const profile = profiler.computeAudioProfile([]);
      expect(profile.avgEnergy).toBe(0.5);
      expect(profile.avgTempo).toBe(120);
    });

    it('should return defaults for null features', () => {
      const profile = profiler.computeAudioProfile(null);
      expect(profile.avgEnergy).toBe(0.5);
    });

    it('should handle single-track features', () => {
      const features = [{ energy: 0.9, valence: 0.7, tempo: 160, danceability: 0.8 }];
      const profile = profiler.computeAudioProfile(features);
      expect(profile.avgEnergy).toBeCloseTo(0.9);
      expect(profile.avgTempo).toBeCloseTo(160);
    });
  });

  describe('_extractTopGenres()', () => {
    it('should extract and rank genres by frequency', () => {
      const artists = [
        { genres: ['rock', 'indie', 'alternative'] },
        { genres: ['rock', 'indie'] },
        { genres: ['rock'] },
        { genres: ['jazz'] },
      ];

      const genres = profiler._extractTopGenres(artists);

      expect(genres[0]).toBe('rock');      // 3 occurrences
      expect(genres[1]).toBe('indie');     // 2 occurrences
      expect(genres).toContain('alternative');
      expect(genres).toContain('jazz');
    });

    it('should limit to 15 genres', () => {
      const artists = Array.from({ length: 20 }, (_, i) => ({
        genres: [`genre-${i}`],
      }));

      const genres = profiler._extractTopGenres(artists);
      expect(genres.length).toBeLessThanOrEqual(15);
    });

    it('should handle artists with no genres', () => {
      const artists = [{ genres: [] }, { name: 'test' }];
      const genres = profiler._extractTopGenres(artists);
      expect(genres).toEqual([]);
    });
  });

  describe('getTopRankedArtists()', () => {
    it('should return artists sorted by Elo rating', () => {
      // This would need localStorage mocking for a full test
      // For now, just verify the method exists and doesn't throw
      const top = profiler.getTopRankedArtists(5);
      expect(Array.isArray(top)).toBe(true);
    });
  });

  describe('detectDriftPatterns()', () => {
    it('should return empty array for empty history', () => {
      const patterns = profiler.detectDriftPatterns([]);
      expect(patterns).toEqual([]);
    });
  });
});
