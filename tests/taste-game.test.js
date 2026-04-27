import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataStore } from '../src/data/data-store.js';

// We need to mock window for taste-game.js
global.window = {
  playTrackHybrid: vi.fn(),
  pauseTrack: vi.fn(),
  location: { hash: '' },
  addEventListener: vi.fn(),
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn()
  }
};
global.document = {
  getElementById: vi.fn(() => null),
  querySelectorAll: vi.fn(() => []),
  createElement: vi.fn(() => ({ style: {}, addEventListener: vi.fn() }))
};

// Now import TasteGame
import { TasteGame } from '../src/ui/components/taste-game.js';

describe('TasteGame Pairing Logic', () => {
  let game;

  beforeEach(() => {
    vi.resetAllMocks();
    
    // Setup a fake DataStore with a hierarchy of known artists
    const mockRatings = {
      'top1': { rating: 1800, comparison_count: 20 },
      'top2': { rating: 1750, comparison_count: 18 },
      'top3': { rating: 1700, comparison_count: 15 },
      'mid1': { rating: 1550, comparison_count: 10 },
      'mid2': { rating: 1500, comparison_count: 8 }, // Benchmark
      'mid3': { rating: 1480, comparison_count: 9 }, // Benchmark
      'bot1': { rating: 1200, comparison_count: 20 },
      
      // Contender (0 comparisons)
      'new1': { rating: 1500, comparison_count: 0 }
    };
    
    vi.spyOn(DataStore, 'getEloRatings').mockReturnValue(mockRatings);
    
    game = new TasteGame(document.createElement('div'));
    
    // Manually inject state
    game.knownArtists = [
      { id: 'top1', name: 'Top 1' },
      { id: 'top2', name: 'Top 2' },
      { id: 'top3', name: 'Top 3' },
      { id: 'mid1', name: 'Mid 1' },
      { id: 'mid2', name: 'Mid 2' },
      { id: 'mid3', name: 'Mid 3' },
      { id: 'bot1', name: 'Bot 1' }
    ];
    game.allArtists = [...game.knownArtists, { id: 'new1', name: 'New 1' }];
  });

  it('should not pair a 1500 Elo contender against top artists', () => {
    // Run the selection multiple times to test randomness
    const eloRatings = DataStore.getEloRatings();
    const knownRanked = game.knownArtists.slice().sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);
    
    // We are getting an anchor for 'new1' (Elo 1500)
    for (let i = 0; i < 20; i++) {
      const anchor = game._getClosestAnchor('new1', knownRanked, eloRatings);
      
      // The anchor should be 'mid1', 'mid2', or 'mid3'
      // It should NOT be 'top1' (1800)
      expect(anchor.id).not.toBe('top1');
      expect(anchor.id).not.toBe('bot1');
    }
  });
  
  it('should pair contenders against settled artists in selectStrategicPair', () => {
    for (let i = 0; i < 10; i++) {
      const pair = game._selectStrategicPair();
      // One of them must be the contender (new1)
      const hasContender = pair.A.id === 'new1' || pair.B.id === 'new1';
      expect(hasContender).toBe(true);
      
      // The other must be a benchmark (mid1, mid2, or mid3)
      const other = pair.A.id === 'new1' ? pair.B : pair.A;
      const otherElo = DataStore.getEloRatings()[other.id].rating;
      
      // It should definitely not be pitting them against the 1800 Elo top artist!
      expect(otherElo).toBeLessThan(1700);
      expect(otherElo).toBeGreaterThan(1300);
    }
  });
});
