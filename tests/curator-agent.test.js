/**
 * Curator Agent Tests — Phase E
 *
 * Tests the adaptive intent analysis, playlist verification, and quality gates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all network dependencies
vi.mock('../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn(() => Promise.resolve({ functionCalls: [], textReply: '{}' })),
}));
vi.mock('../src/data/musicbrainz-api.js', () => ({
  getArtistMetadata: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../src/data/lastfm-api.js', () => ({
  getSimilarArtists: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/data/spotify-api.js', () => ({
  searchTrack: vi.fn(() => Promise.resolve([])),
  searchArtists: vi.fn(() => Promise.resolve([])),
  getArtistTopTracks: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/data/data-store.js', () => ({
  DataStore: {
    getExplicitPreferences: vi.fn(() => ({ agent_memories: [] })),
    getSessionSignals: vi.fn(() => ({ skippedGenres: [], lovedGenres: [], skippedArtists: [] })),
  }
}));
vi.mock('../src/agents/user-model.js', () => ({
  UserModel: {
    buildCuratorContext: vi.fn(() => ''),
  }
}));

import { CuratorAgent } from '../src/agents/curator-agent.js';

describe('CuratorAgent — _analyzeIntent', () => {
  let curator;

  beforeEach(() => {
    curator = new CuratorAgent();
  });

  it('should classify "explore jazz" as genre_exploration', () => {
    const result = curator._analyzeIntent('explore jazz');
    expect(result.intentType).toBe('genre_exploration');
    expect(result.maxPerArtistNum).toBe(1);
  });

  it('should classify "introduce me to classical" as genre_exploration', () => {
    const result = curator._analyzeIntent('introduce me to classical music');
    expect(result.intentType).toBe('genre_exploration');
  });

  it('should classify "get into electronic" as genre_exploration', () => {
    const result = curator._analyzeIntent("help me get into electronic");
    expect(result.intentType).toBe('genre_exploration');
  });

  it('should classify "deep dive into Miles Davis" as artist_focus', () => {
    const result = curator._analyzeIntent('deep dive into Miles Davis');
    expect(result.intentType).toBe('artist_focus');
    expect(result.maxPerArtistNum).toBe(99);
  });

  it('should classify "only Radiohead" as artist_focus', () => {
    const result = curator._analyzeIntent('only Radiohead');
    expect(result.intentType).toBe('artist_focus');
  });

  it('should classify "studying" as mood_activity', () => {
    const result = curator._analyzeIntent('music for studying');
    expect(result.intentType).toBe('mood_activity');
    expect(result.maxPerArtistNum).toBe(2);
  });

  it('should classify "workout" as mood_activity', () => {
    const result = curator._analyzeIntent('workout playlist');
    expect(result.intentType).toBe('mood_activity');
  });

  it('should classify "chill vibes" as mood_activity', () => {
    const result = curator._analyzeIntent('chill vibes for the evening');
    expect(result.intentType).toBe('mood_activity');
  });

  it('should default to general for unmatched intents', () => {
    const result = curator._analyzeIntent('play something good');
    expect(result.intentType).toBe('general');
    expect(result.maxPerArtistNum).toBe(2);
  });

  it('should handle empty/null intent gracefully', () => {
    expect(curator._analyzeIntent('').intentType).toBe('general');
    expect(curator._analyzeIntent(null).intentType).toBe('general');
    expect(curator._analyzeIntent(undefined).intentType).toBe('general');
  });
});

describe('CuratorAgent — _verifyPlaylist', () => {
  let curator;

  beforeEach(() => {
    curator = new CuratorAgent();
  });

  it('should enforce per-artist cap for genre exploration (max 1)', () => {
    const params = { maxPerArtistNum: 1, intentType: 'genre_exploration' };
    const playlist = [
      { artistName: 'Miles Davis', track: { id: '1' } },
      { artistName: 'Miles Davis', track: { id: '2' } },
      { artistName: 'John Coltrane', track: { id: '3' } },
    ];

    const result = curator._verifyPlaylist(playlist, params);
    expect(result.length).toBe(2);
    expect(result.filter(t => t.artistName === 'Miles Davis').length).toBe(1);
    expect(result.filter(t => t.artistName === 'John Coltrane').length).toBe(1);
  });

  it('should allow unlimited per artist for artist_focus', () => {
    const params = { maxPerArtistNum: 99, intentType: 'artist_focus' };
    const playlist = Array.from({ length: 10 }, (_, i) => ({
      artistName: 'Radiohead', track: { id: `${i}` },
    }));

    const result = curator._verifyPlaylist(playlist, params);
    expect(result.length).toBe(10);
  });

  it('should enforce cap of 2 for general intent', () => {
    const params = { maxPerArtistNum: 2, intentType: 'general' };
    const playlist = [
      { artistName: 'Artist A', track: { id: '1' } },
      { artistName: 'Artist A', track: { id: '2' } },
      { artistName: 'Artist A', track: { id: '3' } }, // should be removed
      { artistName: 'Artist B', track: { id: '4' } },
    ];

    const result = curator._verifyPlaylist(playlist, params);
    expect(result.length).toBe(3);
    expect(result.filter(t => t.artistName === 'Artist A').length).toBe(2);
  });

  it('should report enforcement actions via onThought callback', () => {
    const params = { maxPerArtistNum: 1 };
    const playlist = [
      { artistName: 'Test', track: { id: '1' } },
      { artistName: 'Test', track: { id: '2' } },
    ];
    const thoughts = [];
    curator._verifyPlaylist(playlist, params, (msg) => thoughts.push(msg));
    expect(thoughts.length).toBeGreaterThan(0);
    expect(thoughts[0]).toContain('Enforced artist diversity');
  });

  it('should not modify a playlist that already meets constraints', () => {
    const params = { maxPerArtistNum: 2 };
    const playlist = [
      { artistName: 'A', track: { id: '1' } },
      { artistName: 'B', track: { id: '2' } },
      { artistName: 'C', track: { id: '3' } },
    ];
    const result = curator._verifyPlaylist(playlist, params);
    expect(result.length).toBe(3);
  });
});
