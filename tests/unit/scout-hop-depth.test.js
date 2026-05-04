/**
 * Scout Agent â€” Hop Depth & Skip Filter Unit Tests
 *
 * Tests the determineHopDepth() logic and session signal skip filtering
 * in isolation, without any API calls.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock everything the ScoutAgent imports to prevent network calls
vi.mock('../../src/data/lastfm-api.js', () => ({
  getSimilarArtists: vi.fn(() => Promise.resolve([])),
  getArtistTags: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/data/spotify-api.js', () => ({
  getRecommendations: vi.fn(() => Promise.resolve([])),
  searchTrack: vi.fn(() => Promise.resolve(null)),
  searchTracks: vi.fn(() => Promise.resolve([])),
  searchArtists: vi.fn(() => Promise.resolve([])),
  getArtistTopTracks: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn(() => Promise.resolve({ functionCalls: [], textReply: '' })),
}));
vi.mock('../../src/data/local-agent.js', () => ({
  runScoutWebSearch: vi.fn(() => Promise.resolve([])),
  isSearxngAvailable: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../../src/data/data-store.js', () => ({
  DataStore: {
    getExplicitPreferences: vi.fn(() => ({ agent_memories: [] })),
    getCachedResponse: vi.fn(() => null),
    cacheResponse: vi.fn(),
    getEloRatings: vi.fn(() => ({})),
    getSessionSignals: vi.fn(() => ({ skippedGenres: [], lovedGenres: [], skippedArtists: [] })),
  }
}));
vi.mock('../../src/data/musicbrainz-api.js', () => ({
  searchArtist: vi.fn(() => Promise.resolve(null)),
  getArtistRelationships: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/agents/user-model.js', () => ({
  UserModel: {
    loadTier1: vi.fn(() => ({
      tasteProfile: { musicDimensions: { mellow: 0, sophisticated: 0, _confidence: 0 } }
    })),
    buildScoutContext: vi.fn(() => ''),
  }
}));
vi.mock('../../src/data/embedding-store.js', () => ({
  EmbeddingStore: { findSimilar: vi.fn(() => []) }
}));
vi.mock('../../src/agents/soul.js', () => ({
  buildSoulPrefix: vi.fn(() => 'You are a music expert.'),
}));

import { ScoutAgent } from '../../src/agents/scout-agent.js';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// determineHopDepth â€” keyword analysis
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ScoutAgent â€” determineHopDepth', () => {
  const scout = new ScoutAgent();

  it('should return 0 for "only my favorites"', () => {
    expect(scout.determineHopDepth('only my favorites')).toBe(0);
  });

  it('should return 0 for "familiar vibes"', () => {
    expect(scout.determineHopDepth('familiar vibes')).toBe(0);
  });

  it('should return 2 for "discover new music"', () => {
    expect(scout.determineHopDepth('discover new music')).toBe(2);
  });

  it('should return 2 for "underground hip hop"', () => {
    expect(scout.determineHopDepth('underground hip hop')).toBe(2);
  });

  it('should return 2 for "adventurous mix"', () => {
    expect(scout.determineHopDepth('adventurous mix')).toBe(2);
  });

  it('should return 2 for "explore jazz"', () => {
    expect(scout.determineHopDepth('explore jazz')).toBe(2);
  });

  it('should return 2 for "deep dive into modal jazz"', () => {
    expect(scout.determineHopDepth('deep dive into modal jazz')).toBe(2);
  });

  it('should return 1 for generic "play something good"', () => {
    expect(scout.determineHopDepth('play something good')).toBe(1);
  });

  // DiscoveryProfile-driven hop depth
  it('should return 2 for low-mainstream specialist user on generic intent', () => {
    const ctx = {
      blackboard: {
        profiler: {
          discoveryProfile: { mainstreaminess: 0.2, specialistIndex: 0.7 },
        },
      },
    };
    expect(scout.determineHopDepth('', ctx)).toBe(2);
  });

  it('should return 1 for high-mainstream user on generic intent', () => {
    const ctx = {
      blackboard: {
        profiler: {
          discoveryProfile: { mainstreaminess: 0.8, specialistIndex: 0.2 },
        },
      },
    };
    expect(scout.determineHopDepth('', ctx)).toBe(1);
  });

  it('explicit keyword overrides discoveryProfile', () => {
    const ctx = {
      blackboard: {
        profiler: {
          discoveryProfile: { mainstreaminess: 0.9, specialistIndex: 0.1 },
        },
      },
    };
    // "discover" keyword forces hop 2 even for mainstream user
    expect(scout.determineHopDepth('discover underground gems', ctx)).toBe(2);
  });
});
