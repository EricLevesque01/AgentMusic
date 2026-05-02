/**
 * TasteGraph — MusicBrainz API Wrapper
 * Used by the Scout Agent for genre metadata and artist relationships.
 *
 * Contact: ericlevesque22@gmail.com (from EchoDJ project)
 * Rate limit: 1 request/second (enforced)
 * Docs: https://musicbrainz.org/doc/MusicBrainz_API
 */

import { DataStore } from './data-store.js';

const MB_BASE       = 'https://musicbrainz.org/ws/2/';
const MB_USER_AGENT = 'TasteGraph/1.0 (ericlevesque22@gmail.com)';

// Rate limiter: MusicBrainz allows max 1 req/sec
let lastRequestTime = 0;

async function mbFetch(endpoint, params = {}) {
  // Enforce 1 req/sec
  const now = Date.now();
  const wait = 1000 - (now - lastRequestTime);
  if (wait > 0) {
    await new Promise(r => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();

  const url = new URL(MB_BASE + endpoint);
  url.search = new URLSearchParams({ ...params, fmt: 'json' }).toString();

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': MB_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Search for an artist MBID by name.
 * @param {string} name
 * @returns {string|null} MBID or null
 */
export async function searchArtist(name) {
  const cacheKey = `mb_mbid_${name.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  try {
    const data = await mbFetch('artist/', { query: `artist:"${name}"`, limit: '1' });
    const artist = data.artists?.[0];
    const mbid = artist?.id || null;
    DataStore.cacheResponse(cacheKey, mbid);
    return mbid;
  } catch (err) {
    console.warn(`MusicBrainz: searchArtist failed for "${name}":`, err.message);
    return null;
  }
}

/**
 * Get genre tags for an artist by MBID.
 * @param {string} mbid
 * @returns {string[]} genre names
 */
export async function getArtistGenres(mbid) {
  if (!mbid) return [];

  const cacheKey = `mb_genres_${mbid}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    const data = await mbFetch(`artist/${mbid}`, { inc: 'genres+tags' });
    const genres = [
      ...(data.genres || []),
      ...(data.tags || []),
    ]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 8)
      .map(g => g.name.toLowerCase());

    DataStore.cacheResponse(cacheKey, genres);
    return genres;
  } catch (err) {
    console.warn(`MusicBrainz: getArtistGenres failed for MBID "${mbid}":`, err.message);
    return [];
  }
}

/**
 * Get structural metadata (country, era) for an artist by name.
 * @param {string} name
 * @returns {object|null} { country, beginYear }
 */
/**
 * Discovery-relevant relationship types from MusicBrainz artist-artist rels.
 * These surface non-trivial connections like shared band membership or collaborations.
 */
const DISCOVERY_REL_TYPES = new Set([
  'member of band',
  'collaboration',
  'supporting musician',
  'vocal supporting musician',
  'instrumental supporting musician',
  'founder',
  'subgroup',
  'teacher',
]);

/**
 * Get artist-artist relationships for discovery purposes.
 * Finds band members, collaborators, supporting musicians, etc.
 * @param {string} mbid — MusicBrainz artist ID
 * @returns {Array<{ type: string, targetName: string, targetMbid: string, direction: string }>}
 */
export async function getArtistRelationships(mbid) {
  if (!mbid) return [];

  const cacheKey = `mb_rels_${mbid}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    const data = await mbFetch(`artist/${mbid}`, { inc: 'artist-rels' });
    const rels = (data.relations || [])
      .filter(r => DISCOVERY_REL_TYPES.has(r.type))
      .map(r => ({
        type: r.type,
        targetName: r.artist?.name || r.target?.name || null,
        targetMbid: r.artist?.id || r.target?.id || null,
        direction: r.direction || 'forward',
        beginYear: r.begin ? parseInt(r.begin.split('-')[0], 10) : null,
        endYear: r.end ? parseInt(r.end.split('-')[0], 10) : null,
        ended: r.ended || false,
      }))
      .filter(r => r.targetName); // Drop entries with no resolved name

    DataStore.cacheResponse(cacheKey, rels);
    return rels;
  } catch (err) {
    console.warn(`MusicBrainz: getArtistRelationships failed for MBID "${mbid}":`, err.message);
    return [];
  }
}

export async function getArtistMetadata(name) {
  const cacheKey = `mb_meta_${name.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  try {
    const data = await mbFetch('artist/', { query: `artist:"${name}"`, limit: '1' });
    const artist = data.artists?.[0];
    
    if (!artist) {
      DataStore.cacheResponse(cacheKey, null);
      return null;
    }

    const metadata = {
      mbid: artist.id,
      country: artist.country || null,
      beginYear: artist['life-span']?.begin ? parseInt(artist['life-span'].begin.split('-')[0], 10) : null,
    };

    DataStore.cacheResponse(cacheKey, metadata);
    return metadata;
  } catch (err) {
    console.warn(`MusicBrainz: getArtistMetadata failed for "${name}":`, err.message);
    return null;
  }
}
