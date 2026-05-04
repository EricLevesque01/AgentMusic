/**
 * TasteGraph — Spotify API Wrapper
 * Wraps the Spotify Web API endpoints needed by TasteGraph agents.
 */
import { getValidAccessToken, refreshAccessToken } from '../auth/spotify-auth.js';

const BASE_URL = 'https://api.spotify.com/v1';

// Strict request queue to prevent concurrent blasts that trigger 429s
let _requestQueue = Promise.resolve();
const MIN_REQUEST_INTERVAL_MS = 100; // Max 10 requests per second

/**
 * Make an authenticated request to the Spotify API.
 * Automatically refreshes the token on 401.
 * Retries with backoff on 429 (rate limit).
 * Guarantees strict sequential execution via a Promise queue.
 */
async function spotifyFetch(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    _requestQueue = _requestQueue.then(async () => {
      try {
        let token = await getValidAccessToken();
        if (!token) throw new Error('Not authenticated with Spotify');

        const doFetch = async (t) => fetch(`${BASE_URL}${endpoint}`, {
          ...options,
          headers: { 'Authorization': `Bearer ${t}`, ...options.headers },
        });

        let response = await doFetch(token);

        // Auto-refresh on 401
        if (response.status === 401) {
          token = await refreshAccessToken();
          response = await doFetch(token);
        }

        // Retry on 429 with Retry-After header
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
          console.warn(`Spotify: Rate limited. Queue pausing for ${retryAfter}s...`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          response = await doFetch(token);
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
          // Pass 429 back out if it still fails so TrackResolver can degrade gracefully
          const errorObj = new Error(`Spotify API error: ${err.error?.message || response.statusText}`);
          if (response.status === 429) errorObj.message += ' (429 Rate Limit)';
          throw errorObj;
        }

        resolve(await response.json());
      } catch (err) {
        reject(err);
      }

      // Enforce the minimum gap BEFORE the next queued item can execute
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS));
    });
  });
}

// --- User's Top Items (for Profiler Agent) ---

/**
 * Get the user's top artists.
 * @param {string} timeRange - 'short_term' | 'medium_term' | 'long_term'
 * @param {number} limit - 1-50
 */
export async function getTopArtists(timeRange = 'medium_term', limit = 50) {
  const params = new URLSearchParams({ time_range: timeRange, limit: String(limit) });
  const data = await spotifyFetch(`/me/top/artists?${params}`);
  return data.items;
}

/**
 * Get the user's top tracks.
 * @param {string} timeRange - 'short_term' | 'medium_term' | 'long_term'
 * @param {number} limit - 1-50
 */
export async function getTopTracks(timeRange = 'medium_term', limit = 50) {
  const params = new URLSearchParams({ time_range: timeRange, limit: String(limit) });
  const data = await spotifyFetch(`/me/top/tracks?${params}`);
  return data.items;
}

// --- Audio Features (for Session Intent matching) ---

/**
 * Get audio features for multiple tracks (batch, up to 100).
 * @param {string[]} trackIds
 */
export async function getAudioFeatures(trackIds) {
  if (!trackIds.length) return [];

  // Batch in chunks of 100
  const results = [];
  for (let i = 0; i < trackIds.length; i += 100) {
    const chunk = trackIds.slice(i, i + 100);
    const params = new URLSearchParams({ ids: chunk.join(',') });
    const data = await spotifyFetch(`/audio-features?${params}`);
    results.push(...(data.audio_features || []));
  }

  return results.filter(Boolean); // Remove nulls
}

// --- Artist Data (for Scout Agent) ---

/**
 * Get an artist's top tracks.
 * @param {string} artistId
 * @param {string} market - ISO 3166-1 alpha-2 country code
 */
export async function getArtistTopTracks(artistId, market = 'US') {
  const params = new URLSearchParams({ market });
  const data = await spotifyFetch(`/artists/${artistId}/top-tracks?${params}`);
  return data.tracks;
}

/**
 * Get Spotify recommendations based on seed artists/genres.
 * @param {object} params
 */
export async function getRecommendations({ seedArtists = [], seedGenres = [], seedTracks = [], limit = 20, ...targetParams } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (seedArtists.length)  params.set('seed_artists', seedArtists.slice(0, 5).join(','));
  if (seedGenres.length)   params.set('seed_genres', seedGenres.slice(0, 5).join(','));
  if (seedTracks.length)   params.set('seed_tracks', seedTracks.slice(0, 5).join(','));

  // Add target audio features (e.g., target_energy, min_tempo)
  for (const [key, value] of Object.entries(targetParams)) {
    params.set(key, String(value));
  }

  const data = await spotifyFetch(`/recommendations?${params}`);
  return data.tracks;
}

/**
 * Get the current user's profile.
 */
export async function getCurrentUser() {
  return spotifyFetch('/me');
}

/**
 * Create a new playlist for the current user.
 * @param {string} userId
 * @param {string} name
 * @param {string} description
 */
export async function createPlaylist(userId, name, description = '') {
  return spotifyFetch(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      public: false
    })
  });
}

/**
 * Add tracks to a playlist.
 * @param {string} playlistId
 * @param {string[]} uris - Spotify track URIs (e.g. ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh'])
 */
export async function addTracksToPlaylist(playlistId, uris) {
  if (!uris || uris.length === 0) return;
  
  // Spotify allows max 100 tracks per request
  const chunks = [];
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    const result = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk })
    });
    chunks.push(result);
  }
  return chunks;
}

/**
 * Search Spotify for an artist by name.
 * Returns the best matching artist object, or null if not found.
 * Used by the Taste Game to resolve Last.fm artist names into Spotify objects.
 * @param {string} name
 */
export async function searchArtist(name) {
  try {
    const params = new URLSearchParams({ q: name, type: 'artist', limit: '1' });
    const data = await spotifyFetch(`/search?${params}`);
    const artist = data.artists?.items?.[0] || null;

    // Prioritize Last.fm crowdsourced tags over Spotify's generic genres
    if (artist) {
      try {
        const { getArtistTags } = await import('./lastfm-api.js');
        const tags = await getArtistTags(artist.name);
        
        // Filter out useless meta-tags from Last.fm
        const validTags = tags.filter(t => 
          !t.name.includes('seen live') && 
          !t.name.includes('under 2000 listeners')
        );

        if (validTags.length > 0) {
          artist.genres = validTags.slice(0, 3).map(t => t.name);
        } else if (!artist.genres || artist.genres.length === 0) {
          artist.genres = ['Unclassified'];
        }
      } catch (err) {
        if (!artist.genres || artist.genres.length === 0) {
          artist.genres = ['Unclassified'];
        }
      }

      // Add standardized macro-genres for the LLM and Profile UI
      const { mapToMacroGenres } = await import('./genre-taxonomy.js');
      artist.macroGenres = mapToMacroGenres(artist.genres);
    }

    return artist;
  } catch (err) {
    console.error("Failed to search artist:", err);
    return null;
  }
}

/**
 * Search Spotify for multiple artists by name (for autocomplete).
 * Returns up to 5 matching artists.
 * @param {string} query
 * @param {number} limit
 */
export async function searchArtists(query, limit = 5) {
  try {
    const params = new URLSearchParams({ q: query, type: 'artist', limit: String(limit) });
    const data = await spotifyFetch(`/search?${params}`);
    return data.artists?.items || [];
  } catch (err) {
    console.error("Failed to search artists autocomplete:", err);
    return [];
  }
}


/**
 * Search Spotify for a track by name and artist.
 * Returns the best matching track object, or null if not found.
 * Used to resolve external scraped signals (Reddit/Pitchfork) into playable Spotify tracks.
 * @param {string} trackName
 * @param {string} artistName
 */
export async function searchTrack(trackName, artistName) {
  try {
    const query = `track:${trackName} artist:${artistName}`;
    const params = new URLSearchParams({ q: query, type: 'track', limit: '1' });
    const data = await spotifyFetch(`/search?${params}`);
    return data.tracks?.items?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Search Spotify for tracks using a raw query string.
 * Returns up to \`limit\` matching tracks.
 * @param {string} query - Raw query (e.g. "genre:jazz")
 * @param {number} limit 
 */
export async function searchTracks(query, limit = 5) {
  try {
    const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit) });
    const data = await spotifyFetch(`/search?${params}`);
    return data.tracks?.items || [];
  } catch {
    return [];
  }
}

/**
 * Get multiple artists by their Spotify IDs (batch, up to 50).
 * @param {string[]} ids
 */
export async function getArtistsByIds(ids) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({ ids: chunk.join(',') });
    const data = await spotifyFetch(`/artists?${params}`);
    chunks.push(...(data.artists || []));
  }
  return chunks.filter(Boolean);
}

/**
 * Check if the current user follows a list of artists.
 * @param {string[]} artistIds (max 50 per chunk)
 * @returns {boolean[]} Array of booleans in the same order as artistIds
 */
export async function checkUserFollowsArtists(artistIds) {
  if (!artistIds.length) return [];
  const chunks = [];
  for (let i = 0; i < artistIds.length; i += 50) {
    const chunk = artistIds.slice(i, i + 50);
    const params = new URLSearchParams({ type: 'artist', ids: chunk.join(',') });
    try {
      const data = await spotifyFetch(`/me/following/contains?${params}`);
      chunks.push(...data);
    } catch {
      chunks.push(...new Array(chunk.length).fill(false));
    }
  }
  return chunks;
}

/**
 * Get a massive pool of artists from the user's Liked Songs (Saved Tracks).
 * Fetches up to `pages` * 50 tracks and extracts unique artist IDs.
 * Then fetches the full artist objects for those IDs.
 * @param {number} pages
 */
export async function getSavedTracksArtists(pages = 5) {
  const uniqueArtistIds = new Set();
  
  // Fetch pages in parallel to be fast
  const requests = [];
  for (let i = 0; i < pages; i++) {
    const params = new URLSearchParams({ limit: '50', offset: String(i * 50) });
    requests.push(spotifyFetch(`/me/tracks?${params}`).catch(() => ({ items: [] })));
  }
  
  const responses = await Promise.all(requests);
  
  responses.forEach(page => {
    (page.items || []).forEach(item => {
      (item.track?.artists || []).forEach(artist => {
        if (artist.id) uniqueArtistIds.add(artist.id);
      });
    });
  });

  const idsArray = Array.from(uniqueArtistIds);
  if (idsArray.length === 0) return [];

  // Fetch full artist objects (required because track objects only have "simplified" artists without genres/images)
  return getArtistsByIds(idsArray);
}

/**
 * Get the artists the user explicitly follows on Spotify.
 * @param {number} limit Max 50 per request
 */
export async function getFollowedArtists(limit = 50) {
  try {
    const params = new URLSearchParams({ type: 'artist', limit: String(limit) });
    const data = await spotifyFetch(`/me/following?${params}`);
    return data.artists?.items || [];
  } catch {
    return [];
  }
}

/**
 * Get unique artists from the user's 50 most recently played tracks.
 */
export async function getRecentlyPlayedArtists() {
  try {
    const params = new URLSearchParams({ limit: '50' });
    const data = await spotifyFetch(`/me/player/recently-played?${params}`);
    
    const uniqueArtistIds = new Set();
    (data.items || []).forEach(item => {
      (item.track?.artists || []).forEach(artist => {
        if (artist.id) uniqueArtistIds.add(artist.id);
      });
    });

    const idsArray = Array.from(uniqueArtistIds);
    if (idsArray.length === 0) return [];

    return getArtistsByIds(idsArray);
  } catch {
    return [];
  }
}

