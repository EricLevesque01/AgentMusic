import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the external dependencies so tests work offline
vi.mock('../src/data/musicbrainz-api.js', () => ({
  getArtistMetadata: vi.fn().mockResolvedValue(null),
  getArtistGenres:   vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/gemini-api.js', () => ({
  callWithTools: vi.fn().mockRejectedValue(new Error('offline')),
}));

const { NarratorAgent } = await import('../src/agents/narrator-agent.js');

const tasteState = {
  topGenres: ['rock', 'indie', 'alternative'],
  artists:   [{ id: 'a1', name: 'Radiohead' }],
  topRankedArtists: [{ id: 'a1', name: 'Radiohead' }],
  audioProfile: { avgEnergy: 0.6 },
};
const sliders = { discovery: 0.5, energy: 0.7, popularity: 0.4, novelty: 0.3, focus: 0.5 };

function mockPlaylist(dominantFactor) {
  return [{
    track:          { id: 't1', name: 'Creep', popularity: 72 },
    artistId:       'a2',
    artistName:     'Radiohead',
    source:         'elo_top',
    hopDistance:    1,
    dominantFactor,
    finalScore:     0.82,
    breakdown:      { eloComponent: 0.9, graphComponent: 0.7, audioComponent: 0.6, sessionComponent: 0.5 },
    tags:           [{ name: 'alternative rock' }],
  }];
}

describe('NarratorAgent', () => {
  const narrator = new NarratorAgent();

  it('should return empty for empty playlist', async () => {
    const { playlistSummary, trackExplanations } = await narrator.generate([], tasteState, sliders);
    expect(playlistSummary).toBe('No tracks to explain.');
    expect(trackExplanations.size).toBe(0);
  });

  it('should generate one explanation per track', async () => {
    const playlist = mockPlaylist('elo');
    const { trackExplanations } = await narrator.generate(playlist, tasteState, sliders);
    expect(trackExplanations.size).toBe(1);
    expect(trackExplanations.has('t1')).toBe(true);
  });

  it('should produce a non-empty playlist summary', async () => {
    const { playlistSummary } = await narrator.generate(mockPlaylist('graph'), tasteState, sliders);
    expect(typeof playlistSummary).toBe('string');
    expect(playlistSummary.length).toBeGreaterThan(10);
  });

  it('should generate explanations for each dominant factor type', async () => {
    for (const factor of ['elo', 'graph', 'audio', 'session']) {
      const { trackExplanations } = await narrator.generate(mockPlaylist(factor), tasteState, sliders);
      const explanation = trackExplanations.get('t1');
      expect(typeof explanation).toBe('string');
      expect(explanation.length).toBeGreaterThan(10);
    }
  });

  it('should produce a meaningful playlist summary', async () => {
    const { playlistSummary } = await narrator.generate(mockPlaylist('elo'), tasteState, sliders);
    // Summary should be a non-trivial sentence (fallback produces 30+ chars)
    expect(playlistSummary.length).toBeGreaterThan(25);
    expect(typeof playlistSummary).toBe('string');
  });
});
