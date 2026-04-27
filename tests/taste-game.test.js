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
global.localStorage = global.window.localStorage;
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

  it('1. should not pair a 1500 Elo contender against top artists', () => {
    const eloRatings = DataStore.getEloRatings();
    const knownRanked = game.knownArtists.slice().sort((a, b) => eloRatings[b.id].rating - eloRatings[a.id].rating);
    
    for (let i = 0; i < 20; i++) {
      const anchor = game._getClosestAnchor('new1', knownRanked, eloRatings);
      expect(anchor.id).not.toBe('top1');
      expect(anchor.id).not.toBe('bot1');
    }
  });
  
  it('2. should pair contenders against settled artists in selectStrategicPair', () => {
    for (let i = 0; i < 10; i++) {
      const pair = game._selectStrategicPair();
      const hasContender = pair.A.id === 'new1' || pair.B.id === 'new1';
      expect(hasContender).toBe(true);
      
      const other = pair.A.id === 'new1' ? pair.B : pair.A;
      const otherElo = DataStore.getEloRatings()[other.id].rating;
      expect(otherElo).toBeLessThan(1700);
      expect(otherElo).toBeGreaterThan(1300);
    }
  });

  it('3. should never pair two artists that have already matched', () => {
    const ratings = DataStore.getEloRatings();
    // Simulate they have played
    ratings['new1'].matchups = { 'mid2': true };
    DataStore.getEloRatings.mockReturnValue(ratings);

    for (let i = 0; i < 20; i++) {
      const pair = game._selectStrategicPair();
      const ids = [pair.A.id, pair.B.id];
      expect(ids.includes('new1') && ids.includes('mid2')).toBe(false);
    }
  });

  it('4. should correctly identify settled artists and exclude them from contenders', () => {
    const ratings = DataStore.getEloRatings();
    // mid1 has 10 comps. Make them settled by giving 8 wins (80% win rate)
    ratings['mid1'].wins = 8;
    
    expect(game._isSettled(ratings['mid1'])).toBe(true);
    expect(game._getInfoGainWeight(ratings['mid1'])).toBe(0);

    // new1 has 0 comps, should not be settled
    expect(game._isSettled(ratings['new1'])).toBe(false);
    expect(game._getInfoGainWeight(ratings['new1'])).toBe(3);
  });

  it('5. should immediately ignore artists if handleSkip is called with their ID', () => {
    game.pair = { A: { id: 'new1' }, B: { id: 'mid2' } };
    game.isLoading = false;
    
    // Stub nextRound to do nothing
    game.nextRound = vi.fn();
    const setEloSpy = vi.spyOn(DataStore, 'setEloRatings');
    
    game.handleSkip('new1');
    
    const updatedRatings = setEloSpy.mock.calls[0][0];
    
    expect(updatedRatings['new1'].ignored).toBe(true);
    expect(updatedRatings['new1'].skips).toBe(5);
  });

  it('6. should filter out explicitly ignored artists from the contender pool', () => {
    const ratings = DataStore.getEloRatings();
    ratings['new1'].ignored = true;
    DataStore.getEloRatings.mockReturnValue(ratings);
    
    expect(game._getInfoGainWeight(ratings['new1'])).toBe(0);
    
    const pair = game._selectStrategicPair();
    expect(pair.A.id).not.toBe('new1');
    expect(pair.B.id).not.toBe('new1');
  });

  it('7. should process concierge injection first before normal workflow', () => {
    game.injectedQueue = [{ id: 'injected1', name: 'Injected Artist' }];
    
    const pair = game._selectStrategicPair();
    expect(pair.strategy).toBe('injection');
    
    const ids = [pair.A.id, pair.B.id];
    expect(ids.includes('injected1')).toBe(true);
    expect(game.injectedQueue.length).toBe(0);
  });
  
  it('8. should fallback to random pairing if no benchmarks exist', () => {
    game.knownArtists = [];
    game.allArtists = [
      { id: 'random1', name: 'R1' },
      { id: 'random2', name: 'R2' }
    ];
    DataStore.getEloRatings.mockReturnValue({});
    
    const pair = game._selectStrategicPair();
    expect(pair.strategy).toBe('random');
    const ids = [pair.A.id, pair.B.id];
    expect(ids.includes('random1')).toBe(true);
    expect(ids.includes('random2')).toBe(true);
  });

  it('9. handleChoice should save matchups in both directions', () => {
    game.pair = { A: { id: 'new1' }, B: { id: 'mid2' } };
    game.isLoading = false;
    
    DataStore.getEloRatings.mockReturnValue({
      'new1': { rating: 1500, comparison_count: 0 },
      'mid2': { rating: 1500, comparison_count: 8 }
    });
    
    const setEloSpy = vi.spyOn(DataStore, 'setEloRatings');
    game.handleChoice('new1');
    
    const updatedRatings = setEloSpy.mock.calls[setEloSpy.mock.calls.length - 1][0];
    
    expect(updatedRatings['new1'].matchups['mid2']).toBe(true);
    expect(updatedRatings['mid2'].matchups['new1']).toBe(true);
  });
});
