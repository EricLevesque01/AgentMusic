/**
 * TasteGraph — Last.fm API Wrapper
 * Used by the Scout Agent for similar artists and genre tags.
 *
 * API Key loaded from .env (VITE_LASTFM_API_KEY)
 * Docs: https://www.last.fm/api
 */

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_KEY  = import.meta.env?.VITE_LASTFM_API_KEY;

import { DataStore } from './data-store.js';

async function lastfmFetch(params) {
  const url = new URL(LASTFM_BASE);
  url.search = new URLSearchParams({
    ...params,
    api_key: LASTFM_KEY,
    format:  'json',
  }).toString();

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Last.fm API error: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(`Last.fm error ${data.error}: ${data.message}`);
  }
  return data;
}

/**
 * Get similar artists for a given artist name.
 * @param {string} artistName
 * @param {number} limit
 * @returns {Array<{ name, similarity, url }>}
 */
export async function getSimilarArtists(artistName, limit = 20) {
  const cacheKey = `lastfm_similar_${artistName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    const data = await lastfmFetch({
      method: 'artist.getSimilar',
      artist: artistName,
      limit:  String(limit),
      autocorrect: '1',
    });

    const artists = (data.similarartists?.artist || []).map(a => ({
      name:       a.name,
      similarity: parseFloat(a.match),
      url:        a.url,
    }));

    DataStore.cacheResponse(cacheKey, artists);
    return artists;
  } catch (err) {
    console.warn(`Last.fm: getSimilarArtists failed for "${artistName}":`, err.message);
    return [];
  }
}

/**
 * Get genre/mood tags for a given artist.
 * @param {string} artistName
 * @returns {Array<{ name, count }>}
 */
export async function getArtistTags(artistName) {
  const cacheKey = `lastfm_tags_${artistName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    const data = await lastfmFetch({
      method: 'artist.getTopTags',
      artist: artistName,
      autocorrect: '1',
    });

    const tags = (data.toptags?.tag || []).slice(0, 10).map(t => ({
      name:  t.name.toLowerCase(),
      count: parseInt(t.count, 10),
    }));

    DataStore.cacheResponse(cacheKey, tags);
    return tags;
  } catch (err) {
    console.warn(`Last.fm: getArtistTags failed for "${artistName}":`, err.message);
    return [];
  }
}

/**
 * Get top tracks for an artist from Last.fm (crowdsourced play counts).
 * Returns track names + play stats — NOT playable Spotify objects.
 * Used as a fallback when Spotify's top-tracks endpoint is rate-limited.
 * @param {string} artistName
 * @param {number} limit
 * @returns {Array<{ name, playcount, listeners, artistName }>}
 */
export async function getArtistTopTracksLastfm(artistName, limit = 10) {
  const cacheKey = `lastfm_toptracks_${artistName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = DataStore.getCachedResponse(cacheKey);
  if (cached) return cached;

  try {
    const data = await lastfmFetch({
      method: 'artist.getTopTracks',
      artist: artistName,
      limit: String(limit),
      autocorrect: '1',
    });

    const tracks = (data.toptracks?.track || []).map(t => ({
      name: t.name,
      playcount: parseInt(t.playcount, 10) || 0,
      listeners: parseInt(t.listeners, 10) || 0,
      artistName: t.artist?.name || artistName,
    }));

    DataStore.cacheResponse(cacheKey, tracks);
    return tracks;
  } catch (err) {
    console.warn(`Last.fm: getArtistTopTracks failed for "${artistName}":`, err.message);
    return [];
  }
}
