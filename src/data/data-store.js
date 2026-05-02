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
    const playlists = this.load('saved_playlists') || [];
    for (const p of playlists) {
      this._rehydrateContext(p.context);
    }
    return playlists;
  }

  /**
   * Rehydrate a serialized playlist context: convert trackExplanations
   * from plain Object back to Map (JSON doesn't serialize Maps).
   */
  static _rehydrateContext(context) {
    if (!context?.explanations?.trackExplanations) return;
    if (!(context.explanations.trackExplanations instanceof Map)) {
      context.explanations.trackExplanations = new Map(
        Object.entries(context.explanations.trackExplanations)
      );
    }
  }

  static saveGeneratedPlaylist(context) {
    // Deep-clone context and convert Map → plain object for JSON serialization
    const serializable = JSON.parse(JSON.stringify(context, (key, value) => {
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      return value;
    }));

    const playlists = this.getSavedPlaylists();
    const newPlaylist = {
      id: Date.now().toString(),
      createdAt: Date.now(),
      context: serializable
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

  // --- Playlist Library (Phase 3: Scheduler-managed, enriched metadata) ---

  /**
   * Get the playlist library (scheduler-managed playlists with listen tracking).
   * Falls back to migrating old saved_playlists format.
   */
  static getPlaylistLibrary() {
    let library = this.load('playlist_library') || [];

    // Rehydrate Maps
    for (const p of library) {
      this._rehydrateContext(p.context);
    }
    return library;
  }

  /**
   * Save a playlist to the library (used by scheduler and manual generation).
   * @param {object} context — PipelineContext
   * @param {string} intent — the seed intent used to generate
   * @param {string} source — 'scheduler' | 'manual' | 'concierge'
   * @returns {string} playlist ID
   */
  static saveToLibrary(context, intent = '', source = 'manual') {
    const serializable = JSON.parse(JSON.stringify(context, (key, value) => {
      if (value instanceof Map) return Object.fromEntries(value);
      return value;
    }));

    const library = this.getPlaylistLibrary();
    const entry = {
      id: Date.now().toString(),
      createdAt: Date.now(),
      listenedAt: null,
      intent,
      source,
      title: context.explanations?.playlistTitle || context.playlistName || intent.slice(0, 60) || 'Curated Mix',
      trackCount: context.scoredPlaylist?.length || 0,
      curatorReflection: context.curatorReflection || '',
      context: serializable,
    };
    library.unshift(entry);

    // Cap at 20 playlists to manage storage
    if (library.length > 20) library.length = 20;

    this.save('playlist_library', library);

    // Also save to legacy format for backward compat
    this.saveGeneratedPlaylist(context);

    return entry.id;
  }

  /**
   * Mark a playlist as listened.
   */
  static markPlaylistListened(id) {
    const library = this.getPlaylistLibrary();
    const entry = library.find(p => p.id === id);
    if (entry) {
      entry.listenedAt = Date.now();
      this.save('playlist_library', library);
    }
  }

  /**
   * Count unlistened playlists in the library.
   */
  static getUnlistenedCount() {
    return this.getPlaylistLibrary().filter(p => !p.listenedAt).length;
  }

  // --- Suggested Artists Cache ---

  static getSuggestedArtistsCache() {
    return this.load('suggested_artists');
  }

  static setSuggestedArtistsCache(artists) {
    this.save('suggested_artists', artists, 24 * 60 * 60 * 1000); // 24h TTL
  }

  static clearSuggestedArtistsCache() {
    this.clear('suggested_artists');
  }

  // --- Scheduler State ---

  static getSchedulerState() {
    return this.load('scheduler_state') || { lastRunAt: null, isRunning: false };
  }

  static setSchedulerState(state) {
    this.save('scheduler_state', state);
  }
}
