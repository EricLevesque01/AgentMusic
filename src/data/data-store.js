/**
 * TasteGraph — Data Store
 * localStorage persistence layer with TTL-based caching.
 */

const PREFIX = 'tg_';

export class DataStore {
  /**
   * Save data to localStorage with optional TTL (in milliseconds).
   */
  static save(key, data, ttlMs = null) {
    const entry = {
      data,
      savedAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    };
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch (e) {
      console.warn(`DataStore: Failed to save "${key}"`, e);
    }
  }

  /**
   * Load data from localStorage. Returns null if expired or missing.
   */
  static load(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;

      const entry = JSON.parse(raw);

      // Check TTL expiration
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        localStorage.removeItem(PREFIX + key);
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Remove a specific key.
   */
  static clear(key) {
    localStorage.removeItem(PREFIX + key);
  }

  /**
   * Clear all TasteGraph data from localStorage.
   */
  static clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        keys.push(k);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
  }

  // --- Convenience methods ---

  static getEloRatings() {
    return this.load('elo_ratings') || {};
  }

  static setEloRatings(ratings) {
    this.save('elo_ratings', ratings);
  }

  // --- Core User Metadata ---
  static getUserMetadata() {
    return this.load('user_metadata') || {
      user_id: 'local_user',
      created_at: Date.now(),
      updated_at: Date.now(),
      onboarding_completed: true,
      spotify_connected: true,
      preferred_playlist_length: 10,
      explicit_content_allowed: true,
    };
  }

  static setUserMetadata(meta) {
    meta.updated_at = Date.now();
    this.save('user_metadata', meta);
  }

  // --- Explicit Preferences ---
  static getExplicitPreferences() {
    return this.load('explicit_preferences') || {
      favorite_artists: [],
      disliked_artists: [],
      favorite_genres: [],
      disliked_genres: [],
      banned_tracks: [],
      banned_artists: [],
      preferred_decades: [],
      avoided_decades: [],
      agent_memories: [], // Extracted facts from Concierge chat
    };
  }

  static setExplicitPreferences(prefs) {
    this.save('explicit_preferences', prefs);
  }

  // --- Session Preference Defaults ---
  static getSessionDefaults() {
    return this.load('session_defaults') || {
      familiarity: 0.65,
      adventurousness: 0.35,
      popularity: 0.4,
      critic_weight: 0.2,
      cohesion: 0.75,
      energy: 0.55,
      novelty: 0.5
    };
  }

  static setSessionDefaults(defaults) {
    this.save('session_defaults', defaults);
  }

  // --- Legacy Convenience ---
  static getTopArtists() {
    return this.load('top_artists');
  }

  static setTopArtists(artists) {
    this.save('top_artists', artists);
  }

  static getTopTracks() {
    return this.load('top_tracks');
  }

  static setTopTracks(tracks) {
    this.save('top_tracks', tracks);
  }

  /**
   * Cache an API response with a 24-hour TTL.
   */
  static cacheResponse(cacheKey, data) {
    this.save(`cache_${cacheKey}`, data, 24 * 60 * 60 * 1000);
  }

  static getCachedResponse(cacheKey) {
    return this.load(`cache_${cacheKey}`);
  }

  // --- Session Signals (Phase 2E: SessionDJ ↔ TasteGame feedback loop) ---

  /**
   * Get ephemeral session signals (skipped/loved genres, skipped artists).
   * These are written by the SessionDJ and read by the TasteGame + Scout.
   */
  static getSessionSignals() {
    return this.load('session_signals') || {
      skippedGenres: [],
      lovedGenres: [],
      skippedArtists: [],
    };
  }

  static setSessionSignals(signals) {
    this.save('session_signals', signals);
  }

  /**
   * Clear session signals (called on session end / new game start).
   */
  static clearSessionSignals() {
    this.clear('session_signals');
  }

  // --- Saved Playlists ---
  static getSavedPlaylists() {
    return this.load('saved_playlists') || [];
  }

  static saveGeneratedPlaylist(context) {
    const playlists = this.getSavedPlaylists();
    const newPlaylist = {
      id: Date.now().toString(),
      createdAt: Date.now(),
      context: context
    };
    playlists.unshift(newPlaylist);
    this.save('saved_playlists', playlists);
    return newPlaylist.id;
  }

  static deleteSavedPlaylist(id) {
    let playlists = this.getSavedPlaylists();
    playlists = playlists.filter(p => p.id !== id);
    this.save('saved_playlists', playlists);
  }
}
