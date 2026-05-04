/**
 * TasteGraph — Track Resolver
 * Resilient, agentic track resolution with multi-source fallback.
 *
 * Three retrieval modes:
 *   1. getTopTracks()          — Popular tracks (with Last.fm fallback on 429)
 *   2. resolveSpecificTracks() — LLM-named tracks (e.g. "Till There Was You")
 *   3. searchByIntent()        — Intent-filtered search ("Beatles love ballads")
 *
 * The Scout's LLM can choose which mode fits the session intent:
 *   - Generic/familiar → getTopTracks (the old behavior)
 *   - Specific request → resolveSpecificTracks (agentic: LLM picks the tracks)
 *   - Mood/theme → searchByIntent (query-based: reaches deep cuts)
 *
 * All three share per-run caching and rate-limit awareness.
 */

import { getArtistTopTracks as spotifyGetTopTracks, searchTrack, searchTracks, searchArtists } from './spotify-api.js';
import { getArtistTopTracksLastfm } from './lastfm-api.js';
import { DataStore } from './data-store.js';

// ════════════════════════════════════════════════════════════════
// Per-Run In-Memory Cache
// Dies when the page refreshes or a new pipeline run starts.
// ════════════════════════════════════════════════════════════════

let _artistCache = new Map();    // name (lowercase) → Spotify artist object
let _topTracksCache = new Map(); // artistId → track[]
let _spotifyDegraded = false;    // Flip to true on 429 → stay on Last.fm fallback
let _degradedSince = 0;         // Timestamp when degradation started
const DEGRADED_COOLDOWN_MS = 60_000; // Try Spotify again after 60s

/**
 * Reset per-run caches. Call at the start of each pipeline run.
 */
export function resetResolverCaches() {
  _artistCache.clear();
  _topTracksCache.clear();

  // Only clear degraded flag if enough time has passed
  if (_spotifyDegraded && Date.now() - _degradedSince > DEGRADED_COOLDOWN_MS) {
    _spotifyDegraded = false;
    _degradedSince = 0;
  }
}

/**
 * Check if Spotify is currently in degraded mode (rate-limited).
 */
export function isSpotifyDegraded() {
  // Auto-recover after cooldown
  if (_spotifyDegraded && Date.now() - _degradedSince > DEGRADED_COOLDOWN_MS) {
    _spotifyDegraded = false;
    _degradedSince = 0;
  }
  return _spotifyDegraded;
}

/**
 * Mark Spotify as rate-limited. All subsequent calls this run will
 * use the Last.fm fallback path until the cooldown expires.
 */
function _markSpotifyDegraded() {
  if (!_spotifyDegraded) {
    console.warn('TrackResolver: Spotify rate-limited — switching to Last.fm fallback path');
    _spotifyDegraded = true;
    _degradedSince = Date.now();
  }
}

// ════════════════════════════════════════════════════════════════
// Artist Resolution (with caching)
// ════════════════════════════════════════════════════════════════

/**
 * Resolve an artist name to a Spotify artist object.
 * Uses per-run cache to avoid redundant searches when the same
 * artist appears across intent override, web discovery, and MB relationships.
 *
 * @param {string} name — Artist name to search
 * @returns {object|null} — Spotify artist object or null
 */
export async function resolveArtist(name) {
  const key = name.toLowerCase().trim();
  if (_artistCache.has(key)) return _artistCache.get(key);

  try {
    const artists = await searchArtists(name, 1);
    const artist = artists?.[0] || null;
    _artistCache.set(key, artist);
    return artist;
  } catch (err) {
    if (err.message?.includes('429')) _markSpotifyDegraded();
    console.warn(`TrackResolver: Artist search failed for "${name}":`, err.message);

    // Ultimate fallback: build a minimal artist object so the pipeline
    // can still function when Spotify is completely unavailable (e.g. tests, offline).
    // The synthetic ID ensures tracks can be tracked through the pipeline.
    const minimalArtist = {
      id: `lastfm_${key.replace(/\s+/g, '_')}`,
      name,
      genres: [],
      images: [],
      _source: 'lastfm_fallback',
    };
    _artistCache.set(key, minimalArtist);
    return minimalArtist;
  }
}

// ════════════════════════════════════════════════════════════════
// Top Tracks Resolution (with multi-source fallback)
// ════════════════════════════════════════════════════════════════

/**
 * Get top tracks for an artist with resilient multi-source fallback.
 *
 * Priority:
 *   1. Per-run memory cache
 *   2. DataStore response cache (24h TTL)
 *   3. Spotify /artists/{id}/top-tracks (if not rate-limited)
 *   4. Last.fm artist.getTopTracks → Spotify search (fallback)
 *
 * The fallback path gets track NAMES from Last.fm (free, generous limits),
 * then resolves each to a playable Spotify track object via search. This
 * uses the search endpoint (different quota bucket from top-tracks).
 *
 * @param {string} artistId — Spotify artist ID
 * @param {string} artistName — Artist name (needed for Last.fm fallback)
 * @param {number} limit — Max tracks to return
 * @returns {object[]} — Spotify track objects (or track-shaped objects from fallback)
 */
export async function getTopTracks(artistId, artistName, limit = 10) {
  // 1. Per-run memory cache
  const cacheKey = `${artistId}_${limit}`;
  if (_topTracksCache.has(cacheKey)) {
    return _topTracksCache.get(cacheKey).slice(0, limit);
  }

  // 2. DataStore response cache (persists across page reloads, 24h TTL)
  const storedCacheKey = `top_tracks_${artistId}`;
  const stored = DataStore.getCachedResponse(storedCacheKey);
  if (stored) {
    _topTracksCache.set(cacheKey, stored);
    return stored.slice(0, limit);
  }

  // 3. Spotify primary path (skip if rate-limited)
  if (!isSpotifyDegraded()) {
    try {
      const tracks = await spotifyGetTopTracks(artistId);
      if (tracks && tracks.length > 0) {
        _topTracksCache.set(cacheKey, tracks);
        DataStore.cacheResponse(storedCacheKey, tracks);
        return tracks.slice(0, limit);
      }
    } catch (err) {
      if (err.message?.includes('429') || err.message?.includes('Rate')) {
        _markSpotifyDegraded();
      } else {
        console.warn(`TrackResolver: Spotify top-tracks failed for "${artistName}":`, err.message);
      }
      // Fall through to Last.fm fallback
    }
  }

  // 4. Last.fm fallback: get track names → resolve via Spotify search
  const fallbackTracks = await _lastfmFallback(artistId, artistName, limit);

  // 5. Ultimate fallback: if even Last.fm→Spotify search failed, build
  //    minimal tracks from Last.fm data alone (no Spotify resolution).
  if (fallbackTracks.length === 0 && artistName) {
    return _lastfmOnlyFallback(artistId, artistName, limit);
  }
  return fallbackTracks;
}

/**
 * Last.fm fallback path: gets track names from Last.fm, then resolves
 * each to a Spotify track object via the search endpoint.
 *
 * The search endpoint is in a different rate-limit bucket than top-tracks,
 * and we're doing fewer calls (just the top N tracks by name).
 */
async function _lastfmFallback(artistId, artistName, limit) {
  try {
    const lastfmTracks = await getArtistTopTracksLastfm(artistName, limit);
    if (!lastfmTracks || lastfmTracks.length === 0) return [];

    const resolved = [];
    // Process in small batches to be gentle on Spotify search
    for (const lfTrack of lastfmTracks.slice(0, limit)) {
      if (isSpotifyDegraded()) {
        resolved.push(_buildMinimalTrack(lfTrack, artistId));
        continue;
      }
      try {
        const spotifyTrack = await searchTrack(lfTrack.name, lfTrack.artistName);
        if (spotifyTrack) {
          resolved.push(spotifyTrack);
        }
      } catch (err) {
        if (err.message?.includes('429')) {
          _markSpotifyDegraded();
          // If even search is rate-limited, build a minimal track shape
          // so the pipeline can still see the candidate (just not playable)
          resolved.push(_buildMinimalTrack(lfTrack, artistId));
        }
        // Otherwise silently skip this track
      }
    }

    // Cache whatever we resolved
    if (resolved.length > 0) {
      const cacheKey = `${artistId}_${limit}`;
      _topTracksCache.set(cacheKey, resolved);
      // Only write to DataStore if we got real Spotify objects (have IDs)
      if (resolved[0].id) {
        DataStore.cacheResponse(`top_tracks_${artistId}`, resolved);
      }
    }

    return resolved;
  } catch (err) {
    console.warn(`TrackResolver: Last.fm fallback failed for "${artistName}":`, err.message);
    return [];
  }
}

/**
 * Build a minimal Spotify-shaped track object from Last.fm data.
 * Used as a last resort when both Spotify top-tracks AND search are down.
 * These tracks won't be playable but will carry enough metadata for
 * the Curator to make selection decisions.
 */
function _buildMinimalTrack(lastfmTrack, artistId) {
  return {
    id: `lastfm_${lastfmTrack.artistName}_${lastfmTrack.name}`.replace(/\s+/g, '_').toLowerCase(),
    name: lastfmTrack.name,
    artists: [{ id: artistId, name: lastfmTrack.artistName }],
    album: { name: 'Unknown Album', images: [] },
    duration_ms: 0,
    popularity: Math.min(100, Math.round(lastfmTrack.listeners / 1000)),
    preview_url: null,
    external_urls: {},
    _source: 'lastfm_fallback', // Flag so the UI can handle gracefully
  };
}

/**
 * Pure Last.fm fallback: gets track names and builds minimal track objects
 * WITHOUT any Spotify calls. Used when Spotify is completely unavailable.
 */
async function _lastfmOnlyFallback(artistId, artistName, limit) {
  try {
    const lastfmTracks = await getArtistTopTracksLastfm(artistName, limit);
    if (!lastfmTracks || lastfmTracks.length === 0) return [];
    const tracks = lastfmTracks.map(t => _buildMinimalTrack(t, artistId));
    const cacheKey = `${artistId}_${limit}`;
    _topTracksCache.set(cacheKey, tracks);
    return tracks;
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════
// Intent-Aware Retrieval (Agentic Modes)
// ════════════════════════════════════════════════════════════════

/**
 * Resolve specific track names chosen by the LLM.
 * This is the most agentic mode — the LLM knows the artist's catalog
 * and picks tracks that serve the session intent (e.g. deep cuts,
 * mood-specific songs, lesser-known gems).
 *
 * @param {Array<{trackName: string, artistName: string}>} trackRequests — LLM-specified tracks
 * @returns {object[]} — Resolved Spotify track objects
 */
export async function resolveSpecificTracks(trackRequests) {
  const resolved = [];

  for (const req of trackRequests) {
    // Check per-run cache first (keyed on "artist|track")
    const cacheKey = `specific_${req.artistName}_${req.trackName}`.toLowerCase();
    if (_topTracksCache.has(cacheKey)) {
      const cached = _topTracksCache.get(cacheKey);
      if (cached) resolved.push(cached);
      continue;
    }

    if (isSpotifyDegraded()) {
      resolved.push({
        id: `lastfm_${req.artistName}_${req.trackName}`.replace(/\s+/g, '_').toLowerCase(),
        name: req.trackName,
        artists: [{ name: req.artistName }],
        album: { name: 'Unknown Album', images: [] },
        popularity: 50,
        _source: 'lastfm_fallback'
      });
      continue;
    }

    try {
      const track = await searchTrack(req.trackName, req.artistName);
      _topTracksCache.set(cacheKey, track);
      if (track) resolved.push(track);
    } catch (err) {
      if (err.message?.includes('429')) _markSpotifyDegraded();
      console.warn(`TrackResolver: Specific track search failed for "${req.trackName}" by "${req.artistName}":`, err.message);
    }
  }

  return resolved;
}

/**
 * Search for tracks matching an intent-filtered query.
 * Uses Spotify's search with query modifiers to reach deep cuts
 * that top-tracks would never surface.
 *
 * Examples:
 *   searchByIntent('artist:"The Beatles" love ballad')
 *   searchByIntent('artist:"Miles Davis" modal jazz')
 *   searchByIntent('genre:shoegaze dreamy atmospheric')
 *
 * @param {string} query — Spotify search query (can include field filters)
 * @param {number} limit — Max results
 * @returns {object[]} — Spotify track objects
 */
export async function searchByIntent(query, limit = 10) {
  // Check per-run cache
  const cacheKey = `intent_${query}_${limit}`.toLowerCase();
  if (_topTracksCache.has(cacheKey)) {
    return _topTracksCache.get(cacheKey);
  }

  if (isSpotifyDegraded()) return [];

  try {
    const tracks = await searchTracks(query, limit);
    _topTracksCache.set(cacheKey, tracks);
    return tracks;
  } catch (err) {
    if (err.message?.includes('429')) _markSpotifyDegraded();
    console.warn(`TrackResolver: Intent search failed for "${query}":`, err.message);
    return [];
  }
}

