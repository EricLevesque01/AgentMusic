/**
 * Curator Agent â€” Granular Unit Tests
 *
 * Tests the intent classification edge cases, _verifyPlaylist enforcement,
 * and the empty pool fallback behavior in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all network dependencies
vi.mock('../../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn(() => Promise.resolve({ functionCalls: [], textReply: '{}' })),
}));
vi.mock('../../src/data/musicbrainz-api.js', () => ({
  getArtistMetadata: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../../src/data/lastfm-api.js', () => ({
  getSimilarArtists: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/data/spotify-api.js', () => ({
  searchTrack: vi.fn(() => Promise.resolve([])),
  searchArtists: vi.fn(() => Promise.resolve([])),
  getArtistTopTracks: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/data/data-store.js', () => ({
  DataStore: {
    getExplicitPreferences: vi.fn(() => ({ agent_memories: [] })),
    getSessionSignals: vi.fn(() => ({ skippedGenres: [], lovedGenres: [], skippedArtists: [] })),
  }
}));
vi.mock('../../src/agents/user-model.js', () => ({
  UserModel: {
    buildCuratorContext: vi.fn(() => ''),
  }
}));

import { CuratorAgent } from '../../src/agents/curator-agent.js';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Intent Classification â€” Edge Cases
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('CuratorAgent â€” _analyzeIntent edge cases', () => {
  const curator = new CuratorAgent();

  it('should classify "check out Geese" as artist_focus', () => {
    expect(curator._analyzeIntent('check out Geese').intentType).toBe('artist_focus');
  });

  it('should classify "my friend told me to listen to Alvvays" as artist_focus', () => {
    expect(curator._analyzeIntent('my friend told me to listen to Alvvays').intentType).toBe('artist_focus');
  });

  it('should classify "got into Fontaines DC recently" as artist_focus', () => {
    expect(curator._analyzeIntent('got into Fontaines DC recently').intentType).toBe('artist_focus');
  });

  it('should classify "teach me about post-punk" as genre_exploration', () => {
    expect(curator._analyzeIntent('teach me about post-punk').intentType).toBe('genre_exploration');
  });

  it('should classify "guide me through 70s prog rock" as genre_exploration', () => {
    expect(curator._analyzeIntent('guide me through 70s prog rock').intentType).toBe('genre_exploration');
  });

  it('should classify "late night driving music" as mood_activity', () => {
    expect(curator._analyzeIntent('late night driving music').intentType).toBe('mood_activity');
  });

  it('should classify "morning run" as mood_activity', () => {
    expect(curator._analyzeIntent('morning run').intentType).toBe('mood_activity');
  });

  it('should classify "meditation sounds" as mood_activity', () => {
    expect(curator._analyzeIntent('meditation sounds').intentType).toBe('mood_activity');
  });

  it('should classify "dinner party background" as mood_activity', () => {
    expect(curator._analyzeIntent('dinner party background').intentType).toBe('mood_activity');
  });

  it('should return general for ambiguous intent', () => {
    expect(curator._analyzeIntent('something good').intentType).toBe('general');
    expect(curator._analyzeIntent('mix it up').intentType).toBe('general');
    expect(curator._analyzeIntent('surprise me').intentType).toBe('general');
  });

  // Intent priority â€” when multiple keywords match, which wins?
  it('should prioritize artist_focus over mood_activity ("deep dive into workout music")', () => {
    // "deep dive into" triggers artist_focus first (regex order matters)
    const result = curator._analyzeIntent('deep dive into workout music');
    expect(result.intentType).toBe('artist_focus');
  });

  it('should prioritize artist_focus over genre_exploration ("check out exploratory jazz")', () => {
    const result = curator._analyzeIntent('check out exploratory jazz');
    expect(result.intentType).toBe('artist_focus');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// _verifyPlaylist â€” Enforcement
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('CuratorAgent â€” _verifyPlaylist edge cases', () => {
  const curator = new CuratorAgent();

  it('should preserve track order when removing duplicates', () => {
    const params = { maxPerArtistNum: 1 };
    const playlist = [
      { artistName: 'A', track: { id: '1' } },
      { artistName: 'B', track: { id: '2' } },
      { artistName: 'A', track: { id: '3' } }, // removed
      { artistName: 'C', track: { id: '4' } },
    ];
    const result = curator._verifyPlaylist(playlist, params);
    expect(result.map(t => t.track.id)).toEqual(['1', '2', '4']);
  });

  it('should handle empty playlist gracefully', () => {
    const result = curator._verifyPlaylist([], { maxPerArtistNum: 2 });
    expect(result).toEqual([]);
  });

  it('should handle single-track playlist', () => {
    const result = curator._verifyPlaylist(
      [{ artistName: 'Solo', track: { id: '1' } }],
      { maxPerArtistNum: 1 }
    );
    expect(result.length).toBe(1);
  });

  it('should count enforcement actions correctly', () => {
    const params = { maxPerArtistNum: 1 };
    const playlist = [
      { artistName: 'A', track: { id: '1' } },
      { artistName: 'A', track: { id: '2' } },
      { artistName: 'A', track: { id: '3' } },
    ];
    const thoughts = [];
    curator._verifyPlaylist(playlist, params, (msg) => thoughts.push(msg));
    expect(thoughts.length).toBe(1);
    expect(thoughts[0]).toContain('A');
  });
});

// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
// Empty pool fallback
// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 

describe('CuratorAgent â€” rankAndSelect fallback', () => {
  const curator = new CuratorAgent();
  const mockTaste = { topGenres: ['rock'], topRankedArtists: [{ name: 'Test' }] };

  it('should return empty array for null candidate pool', async () => {
    const result = await curator.rankAndSelect(mockTaste, null, 'test');
    expect(result).toEqual([]);
  });

  it('should return empty array for empty candidate pool', async () => {
    const result = await curator.rankAndSelect(mockTaste, [], 'test');
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// _filterAISpam — Hard pre-filter
// ═══════════════════════════════════════════════════════════════

describe('CuratorAgent — _filterAISpam', () => {
  const curator = new CuratorAgent();

  function makeCandidate(artistName, trackName = 'Test Track') {
    return { artistName, track: { id: 'x', name: trackName } };
  }

  it('should remove ambient content farm artists', () => {
    const pool = [
      makeCandidate('Relaxing Jazz Ensemble'),
      makeCandidate('Chill Music Studio'),
      makeCandidate('Sleep Sounds Collective'),
      makeCandidate('Miles Davis'),
    ];
    const result = curator._filterAISpam(pool);
    expect(result).toHaveLength(1);
    expect(result[0].artistName).toBe('Miles Davis');
  });

  it('should remove tracks with binaural/hz in the name', () => {
    const pool = [
      makeCandidate('Some Artist', '432 Hz Deep Focus Meditation'),
      makeCandidate('Radiohead', 'Karma Police'),
    ];
    const result = curator._filterAISpam(pool);
    expect(result).toHaveLength(1);
    expect(result[0].artistName).toBe('Radiohead');
  });

  it('should not false-positive real artists', () => {
    const pool = [
      makeCandidate('DJ Shadow'),
      makeCandidate('Beach House'),
      makeCandidate('Chill Music Collective'),
    ];
    const result = curator._filterAISpam(pool);
    const names = result.map(c => c.artistName);
    expect(names).toContain('DJ Shadow');
    expect(names).toContain('Beach House');
    expect(names).not.toContain('Chill Music Collective');
  });

  it('should return empty for all-spam pool', () => {
    const pool = [makeCandidate('Focus Music Beats'), makeCandidate('Study Beats Playlist')];
    expect(curator._filterAISpam(pool)).toHaveLength(0);
  });

  it('should pass through clean pool unchanged', () => {
    const pool = [makeCandidate('The Cure'), makeCandidate('Arcade Fire'), makeCandidate('Sufjan Stevens')];
    expect(curator._filterAISpam(pool)).toHaveLength(3);
  });
});
