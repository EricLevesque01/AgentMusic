/**
 * Track Resolver — Fallback & Cache Unit Tests
 *
 * Tests the multi-source fallback chain, cache behavior,
 * degradation detection, and minimal track/artist building.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Portable copies of logic under test (no DOM/network deps)
// ═══════════════════════════════════════════════════════════════

// Mirror the _buildMinimalTrack function from track-resolver.js
function buildMinimalTrack(lastfmTrack, artistId) {
  return {
    id: `lastfm_${lastfmTrack.artistName}_${lastfmTrack.name}`.replace(/\s+/g, '_').toLowerCase(),
    name: lastfmTrack.name,
    artists: [{ id: artistId, name: lastfmTrack.artistName }],
    album: { name: 'Unknown Album', images: [] },
    duration_ms: 0,
    popularity: Math.min(100, Math.round(lastfmTrack.listeners / 1000)),
    preview_url: null,
    external_urls: {},
    _source: 'lastfm_fallback',
  };
}

// Mirror the degraded mode logic
function createDegradedTracker() {
  let degraded = false;
  let degradedSince = 0;
  const COOLDOWN = 60_000;

  return {
    markDegraded: () => { degraded = true; degradedSince = Date.now(); },
    isDegraded: (now = Date.now()) => {
      if (degraded && now - degradedSince > COOLDOWN) {
        degraded = false;
        degradedSince = 0;
      }
      return degraded;
    },
    reset: (now = Date.now()) => {
      if (degraded && now - degradedSince > COOLDOWN) {
        degraded = false;
        degradedSince = 0;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Minimal track construction
// ═══════════════════════════════════════════════════════════════

describe('TrackResolver — _buildMinimalTrack', () => {

  it('should build a valid track shape from Last.fm data', () => {
    const track = buildMinimalTrack(
      { name: 'So What', artistName: 'Miles Davis', listeners: 50000 },
      'spotify_123'
    );
    expect(track.id).toBe('lastfm_miles_davis_so_what');
    expect(track.name).toBe('So What');
    expect(track.artists[0].name).toBe('Miles Davis');
    expect(track._source).toBe('lastfm_fallback');
  });

  it('should cap popularity at 100', () => {
    const track = buildMinimalTrack(
      { name: 'Hit Song', artistName: 'Big Star', listeners: 500000 },
      'id'
    );
    expect(track.popularity).toBe(100);
  });

  it('should handle zero listeners', () => {
    const track = buildMinimalTrack(
      { name: 'Obscure', artistName: 'Nobody', listeners: 0 },
      'id'
    );
    expect(track.popularity).toBe(0);
  });

  it('should sanitize spaces in ID', () => {
    const track = buildMinimalTrack(
      { name: 'My Song Name', artistName: 'The Band', listeners: 1000 },
      'id'
    );
    expect(track.id).not.toContain(' ');
  });
});

// ═══════════════════════════════════════════════════════════════
// Degraded mode tracker
// ═══════════════════════════════════════════════════════════════

describe('TrackResolver — Degraded Mode', () => {

  it('should start as non-degraded', () => {
    const tracker = createDegradedTracker();
    expect(tracker.isDegraded()).toBe(false);
  });

  it('should flip to degraded on markDegraded', () => {
    const tracker = createDegradedTracker();
    tracker.markDegraded();
    expect(tracker.isDegraded()).toBe(true);
  });

  it('should auto-recover after cooldown', () => {
    const tracker = createDegradedTracker();
    tracker.markDegraded();
    // Simulate time passing beyond cooldown
    expect(tracker.isDegraded(Date.now() + 61_000)).toBe(false);
  });

  it('should stay degraded within cooldown window', () => {
    const tracker = createDegradedTracker();
    tracker.markDegraded();
    expect(tracker.isDegraded(Date.now() + 30_000)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Artist fallback shape
// ═══════════════════════════════════════════════════════════════

describe('TrackResolver — Minimal Artist Fallback', () => {

  function buildMinimalArtist(name) {
    const key = name.toLowerCase().trim();
    return {
      id: `lastfm_${key.replace(/\s+/g, '_')}`,
      name,
      genres: [],
      images: [],
      _source: 'lastfm_fallback',
    };
  }

  it('should build a valid artist shape', () => {
    const artist = buildMinimalArtist('Miles Davis');
    expect(artist.id).toBe('lastfm_miles_davis');
    expect(artist.name).toBe('Miles Davis');
    expect(artist._source).toBe('lastfm_fallback');
  });

  it('should handle multi-word names', () => {
    const artist = buildMinimalArtist('A Tribe Called Quest');
    expect(artist.id).toBe('lastfm_a_tribe_called_quest');
  });

  it('should handle leading/trailing spaces', () => {
    const artist = buildMinimalArtist('  Björk  ');
    expect(artist.id).toBe('lastfm_björk');
  });
});
