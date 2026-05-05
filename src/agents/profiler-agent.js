/**
 * Agent Music — Profiler Agent
 * "Who You Are" — Builds and maintains the user's taste identity.
 * 
 * Perceives: Spotify history, Elo ratings, past session patterns
 * Decides:   How to weight long-term vs. contextual preferences
 */
import { 
  getTopArtists, 
  getTopTracks, 
  getSavedTracksArtists,
  getFollowedArtists,
  getRecentlyPlayedArtists
} from '../data/spotify-api.js';
import { DataStore } from '../data/data-store.js';
import {
  computeMusicDimensions,
  computeGenreDistribution,
  computeMainstreaminess,
  computeSpecialistIndex,
  computeDiversityScore,
} from '../data/music-dimensions.js';
import {
  updateBradleyTerry,
  initBradleyTerry,
  btStrengthToRating,
  getModelForArtist,
  BRADLEY_TERRY_THRESHOLD,
} from '../engine/elo.js';
import { EmbeddingStore } from '../data/embedding-store.js';

const DEFAULT_ELO = 1500;

export class ProfilerAgent {
  /**
   * Build the full TasteState by ingesting Spotify data and Elo ratings.
   * This is the main pipeline entry point.
   *
   * Note: Spotify deprecated the audio-features endpoint for new apps (2024).
   * We derive an audio profile from track popularity + artist follower counts
   * as a proxy for energy/valence. Scout Agent will handle richer enrichment
   * via Last.fm tags in Phase 5.
   */
  async buildTasteState(onThought = null) {
    if (onThought) onThought("Profiler: Compiling long-term user taste state...");
    // --- Perceive: Fetch data ---
    let artists = DataStore.getTopArtists();
    let tracks  = DataStore.getTopTracks();

    // Only hit the Spotify API if we have no cached data or insufficient data (< 50)
    if (!artists || !tracks || artists.length < 50) {
      try {
        if (onThought) onThought("Profiler: Fetching fresh top entities from Spotify...");
        const [
          shortArtists, 
          mediumArtists, 
          longArtists, 
          savedArtists, 
          followedArtists,
          recentArtists,
          mediumTracks
        ] = await Promise.all([
          getTopArtists('short_term', 50),
          getTopArtists('medium_term', 50),
          getTopArtists('long_term', 50),
          getSavedTracksArtists(5), // 250 latest liked songs
          getFollowedArtists(50),   // Explicitly followed artists
          getRecentlyPlayedArtists(), // Last 50 listens
          getTopTracks('medium_term', 50),
        ]);
        
        // --- Task 3.1: Preserve temporal layers before merging ---
        this._temporalLayers = {
          identity: (longArtists || []).map(a => ({ id: a.id, name: a.name })),
          evolution: (mediumArtists || []).map(a => ({ id: a.id, name: a.name })),
          mood: (shortArtists || []).map(a => ({ id: a.id, name: a.name })),
        };

        const artistMap = new Map();
        const addArtists = (list) => {
          if (!list) return;
          for (const a of list) {
            if (!artistMap.has(a.id)) artistMap.set(a.id, a);
          }
        };
        
        // Order determines Elo linear distribution logic (Medium is standard baseline)
        addArtists(mediumArtists);
        addArtists(shortArtists);
        addArtists(longArtists);
        addArtists(savedArtists);    // Extracted from your personal library
        addArtists(followedArtists); // Explicitly followed
        addArtists(recentArtists);   // Just played today
        
        const stripHeavyMetadata = (obj) => {
          if (!obj) return obj;
          const clone = { ...obj };
          if (clone.available_markets) delete clone.available_markets;
          if (clone.album) {
            clone.album = { ...clone.album };
            if (clone.album.available_markets) delete clone.album.available_markets;
          }
          if (clone.followers) delete clone.followers;
          if (clone.external_urls) delete clone.external_urls;
          return clone;
        };

        artists = Array.from(artistMap.values()).map(stripHeavyMetadata);
        tracks = mediumTracks ? mediumTracks.map(stripHeavyMetadata) : [];

        DataStore.setTopArtists(artists);
        DataStore.setTopTracks(tracks);
      } catch (err) {
        console.warn("Failed to fetch fresh data from Spotify (is the backend running?). Falling back to cache.", err);
        if (!artists) artists = [];
        if (!tracks) tracks = [];
      }
    }

    // Guard: If we have no artist data at all (no Spotify, no cache), return early
    // with a minimal taste state that the UI can detect and handle gracefully.
    if (!artists || artists.length === 0) {
      console.warn("ProfilerAgent: No artist data available — cold start with no connectivity.");
      return {
        error: 'no_data',
        eloRatings: DataStore.getEloRatings(),
        topRankedArtists: [],
        totalRatedArtists: 0,
        tasteTiers: { coreIdentity: [], activeObsessions: [], fringeDiscovery: [], activelyDismissed: [] },
        topGenres: [],
        artists: [],
        tracks: [],
        temporalLayers: { identity: [], evolution: [], mood: [] },
        genreDistribution: {},
        musicDimensions: { mellow: 0, unpretentious: 0, sophisticated: 0, intense: 0, contemporary: 0 },
        discoveryProfile: { mainstreaminess: 0.5, specialistIndex: 0.5, diversityScore: 0 },
        userMetadata: DataStore.getUserMetadata(),
        explicitPreferences: DataStore.getExplicitPreferences(),
        sessionDefaults: DataStore.getSessionDefaults(),
      };
    }

    // --- Decide: Merge with existing Elo ratings ---
    const eloRatings = this._initializeEloRatings(artists);

    // --- Act: Produce TasteState ---
    const topGenres = this._extractTopGenres(artists);
    
    // Sort all artists by confidence-weighted Elo ratings.
    // Artists with very few comparisons are regressed toward 1500 (the mean) so that
    // a single lucky win doesn't catapult them to #1. Confidence grows with comparisons.
    const _confidenceElo = (data) => {
      const raw = data.rating || 1500;
      const comps = data.comparison_count || 0;
      // Bayesian-style: blend raw Elo with the prior (1500) weighted by confidence.
      // After ~6 comparisons the confidence is ~0.86; after 10 it's ~0.91.
      const confidence = 1 - Math.exp(-comps / 5);
      return 1500 * (1 - confidence) + raw * confidence;
    };
    const allRanked = Object.values(eloRatings)
      .filter(a => a.name && a.name !== 'undefined')
      .sort((a, b) => _confidenceElo(b) - _confidenceElo(a) || (a.name || '').localeCompare(b.name || ''));
    
    // Build highly actionable Taste Tiers for the LLM
    const tasteTiers = {
      coreIdentity: allRanked.filter(a => a.rating >= 1600).slice(0, 10).map(a => a.name),
      activeObsessions: allRanked.filter(a => a.rating >= 1500 && a.rating < 1600).slice(0, 10).map(a => a.name),
      fringeDiscovery: allRanked.filter(a => a.rating >= 1400 && a.rating < 1500).slice(0, 10).map(a => a.name),
      activelyDismissed: [...allRanked].reverse().filter(a => a.rating < 1400).slice(0, 10).map(a => a.name)
    };

    // --- Task 3.4: Compute proportional genre distribution ---
    const genreDistribution = computeGenreDistribution(
      allRanked.map(a => ({ genres: a.genres || [], macroGenres: a.macroGenres || [], id: null })),
      eloRatings
    );

    // --- Task 3.2: Compute MUSIC psychological dimensions ---
    const musicDimensions = computeMusicDimensions(genreDistribution);

    // --- Task 3.3: Compute discovery profile metrics ---
    const discoveryProfile = {
      mainstreaminess: computeMainstreaminess(artists),
      specialistIndex: computeSpecialistIndex(eloRatings),
      diversityScore: computeDiversityScore(genreDistribution),
    };

    const tasteState = {
      eloRatings,
      topRankedArtists: allRanked.slice(0, 50), // Exposed for UI Leaderboard rendering
      totalRatedArtists: allRanked.length,
      tasteTiers,
      topGenres,
      artists,
      tracks,
      // --- Phase 3: Research-backed enrichments ---
      temporalLayers: this._temporalLayers || { identity: [], evolution: [], mood: [] },
      genreDistribution,
      musicDimensions,
      discoveryProfile,
      // --- Existing metadata ---
      userMetadata: DataStore.getUserMetadata(),
      explicitPreferences: DataStore.getExplicitPreferences(),
      sessionDefaults: DataStore.getSessionDefaults()
    };

    // --- Background: index artists into the embedding store (fire-and-forget) ---
    // This runs asynchronously and never delays the pipeline. On first run it
    // downloads the ~23MB all-MiniLM-L6-v2 model; subsequent runs are instant.
    const LLM_BACKEND = typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_LLM_BACKEND || 'gemini')
      : 'gemini';
    if (LLM_BACKEND === 'ollama') {
      // Only index in Ollama mode — Gemini mode uses Last.fm which doesn't need embeddings
      const allArtistsForIndex = Object.entries(eloRatings)
        .filter(([, d]) => d.name && d.name !== 'undefined')
        .map(([id, d]) => ({ id, name: d.name, genres: d.genres || [], macroGenres: d.macroGenres || [] }));

      EmbeddingStore.indexArtists(allArtistsForIndex).catch(err =>
        console.debug('EmbeddingStore: Background index skipped:', err.message)
      );
    }

    return tasteState;
  }

  /**
   * Initialize Elo ratings for all artists. Existing ratings are preserved.
   */
  _initializeEloRatings(artists) {
    const existing = DataStore.getEloRatings();
    
    // Purge legacy "undefined" entries from the datastore so they never reappear
    Object.keys(existing).forEach(key => {
      if (!existing[key].name || existing[key].name === 'undefined') {
        delete existing[key];
      }
    });

    const len = artists.length;

    artists.forEach((artist, index) => {
      if (!(artist.id in existing)) {
        // Linearly distribute initial Elo from 1600 (top) to 1400 (bottom) based on listen rank
        const initialRating = len > 1 
          ? Math.round(1600 - (index * 200 / (len - 1)))
          : DEFAULT_ELO;
          
        existing[artist.id] = {
          rating: initialRating,
          name: artist.name,
          imageUrl: artist.images?.[0]?.url || null,
          genres: artist.genres || [],
          macroGenres: artist.macroGenres || [],
          wins: 0,
          losses: 0,
          ties: 0,
          comparison_count: 0,
          last_compared_at: null,
          source: 'spotify_seeded'
        };
      }
    });

    DataStore.setEloRatings(existing);
    return existing;
  }


  /**
   * Aggregate genres from a list of artists to find the most dominant macro-genres.
   */
  _extractTopGenres(artists) {
    const genreCounts = {};
    artists.forEach(a => {
      // Prefer macroGenres if they exist (via our new Taxonomy), otherwise fallback to raw genres
      const genresToCount = (a.macroGenres && a.macroGenres.length > 0) ? a.macroGenres : (a.genres || []);
      genresToCount.forEach(g => {
        if (g === 'Unclassified' || g === 'Eclectic / Other') return;
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    });

    return Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(entry => entry[0]);
  }

  /**
   * Process a Taste Game result (called from the game UI).
   * Updates Elo ratings and Affinity Metadata (wins, losses, etc.).
   */
  processGameResult(artistAId, artistBId, winnerId, eloEngine, artistA = null, artistB = null) {
    const ratings = DataStore.getEloRatings();

    // Ensure both artists exist with defaults
    [[artistAId, artistA], [artistBId, artistB]].forEach(([id, meta]) => {
      if (!ratings[id]) {
        ratings[id] = {
          rating: DEFAULT_ELO,
          name: meta?.name || null,
          imageUrl: meta?.images?.[0]?.url || null,
          genres: meta?.genres || [],
          macroGenres: meta?.macroGenres || [],
          wins: 0, losses: 0, ties: 0,
          comparison_count: 0,
          source: 'game',
          ...initBradleyTerry(),  // Initialize BT fields from the start
        };
      } else {
        // Patch any previously-stored entry that's missing a name (legacy data)
        if (!ratings[id].name && meta?.name) {
          ratings[id].name    = meta.name;
          ratings[id].imageUrl = ratings[id].imageUrl || meta?.images?.[0]?.url || null;
          ratings[id].genres  = ratings[id].genres?.length ? ratings[id].genres : (meta?.genres || []);
        }
        // Migrate legacy entries that don't yet have BT fields
        if (ratings[id].bt_strength === undefined) {
          Object.assign(ratings[id], initBradleyTerry());
        }
      }
    });

    const winner = winnerId === artistAId ? 'A' : (winnerId === artistBId ? 'B' : 'DRAW');
    const dataA  = ratings[artistAId];
    const dataB  = ratings[artistBId];

    // Choose rating model:
    //   - Elo during cold start (< BRADLEY_TERRY_THRESHOLD comparisons)
    //   - Bradley-Terry once both artists are past the threshold
    // Research basis: "Bradley-Terry models are superior because they can accommodate
    // the inherent noise and uncertainty of human taste while providing a more stable
    // global representation of the preference hierarchy."
    const usesBT = getModelForArtist(dataA) === 'bradley-terry'
                && getModelForArtist(dataB) === 'bradley-terry';

    if (usesBT) {
      // --- Bradley-Terry Update ---
      const { newA, newB } = updateBradleyTerry(dataA, dataB, winner);
      Object.assign(ratings[artistAId], newA);
      Object.assign(ratings[artistBId], newB);
      // Keep rating field in sync for backward-compatible leaderboard sorting
      ratings[artistAId].rating = btStrengthToRating(newA.bt_strength);
      ratings[artistBId].rating = btStrengthToRating(newB.bt_strength);
    } else {
      // --- Elo Update (cold start) ---
      const { newA, newB } = eloEngine.updateRatings(dataA.rating, dataB.rating, winner);
      ratings[artistAId].rating = newA;
      ratings[artistBId].rating = newB;
      // Also update BT strength fields using the simpler Elo-based estimate
      // so the transition to full BT is smooth
      ratings[artistAId].bt_strength = (newA - 1500) / 100;
      ratings[artistBId].bt_strength = (newB - 1500) / 100;
    }

    // --- Update shared affinity stats (same for both models) ---
    const now = Date.now();
    ratings[artistAId].comparison_count = (ratings[artistAId].comparison_count || 0) + 1;
    ratings[artistBId].comparison_count = (ratings[artistBId].comparison_count || 0) + 1;
    ratings[artistAId].last_compared_at = now;
    ratings[artistBId].last_compared_at = now;

    if (winner === 'A') {
      ratings[artistAId].wins   = (ratings[artistAId].wins   || 0) + 1;
      ratings[artistBId].losses = (ratings[artistBId].losses || 0) + 1;
    } else if (winner === 'B') {
      ratings[artistBId].wins   = (ratings[artistBId].wins   || 0) + 1;
      ratings[artistAId].losses = (ratings[artistAId].losses || 0) + 1;
    } else {
      ratings[artistAId].ties = (ratings[artistAId].ties || 0) + 1;
      ratings[artistBId].ties = (ratings[artistBId].ties || 0) + 1;
    }

    // Record matchup to prevent exact repeats
    if (!ratings[artistAId].matchups) ratings[artistAId].matchups = {};
    if (!ratings[artistBId].matchups) ratings[artistBId].matchups = {};
    ratings[artistAId].matchups[artistBId] = true;
    ratings[artistBId].matchups[artistAId] = true;

    DataStore.setEloRatings(ratings);
    return ratings;
  }

  /**
   * Get the top N ranked artists by Elo.
   */
  getTopRankedArtists(n = 20) {
    const ratings = DataStore.getEloRatings();
    // Confidence-weighted sort: regress toward 1500 for low-comparison artists
    // so a single lucky win doesn't make someone appear as #1.
    const _confidenceElo = (data) => {
      const raw = data.rating || 1500;
      const comps = data.comparison_count || 0;
      const confidence = 1 - Math.exp(-comps / 5);
      return 1500 * (1 - confidence) + raw * confidence;
    };
    return Object.entries(ratings)
      .sort((a, b) => _confidenceElo(b[1]) - _confidenceElo(a[1]) || (a[1].name || '').localeCompare(b[1].name || ''))
      .slice(0, n)
      .map(([id, data]) => ({ id, ...data }));
  }

  /**
   * Detect drift patterns from session history.
   *
   * Analyzes recent TasteGame results + listening session data to identify
   * recurring patterns the Curator can use to adapt playlists.
   *
   * @param {Array} sessionHistory - Array of { winnerId, loserId, winnerGenres, loserGenres, round }
   * @returns {Array<{ type, description, data }>}
   */
  detectDriftPatterns(sessionHistory = []) {
    if (sessionHistory.length < 5) return [];

    const patterns = [];

    // --- Pattern 1: Genre momentum ---
    // If the same genre has won 3+ rounds in a row recently, the user is gravitating there
    const recentWins = sessionHistory.slice(-10);
    const genreStreaks = {};
    for (const round of recentWins) {
      for (const genre of (round.winnerGenres || [])) {
        genreStreaks[genre] = (genreStreaks[genre] || 0) + 1;
      }
    }
    const hotGenres = Object.entries(genreStreaks)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre);
    if (hotGenres.length > 0) {
      patterns.push({
        type: 'genre_momentum',
        description: `User is gravitating toward ${hotGenres.slice(0, 2).join(' and ')} in recent rounds`,
        data: { genres: hotGenres },
      });
    }

    // --- Pattern 2: Discovery drift ---
    // If user keeps picking lesser-known artists over established ones (high Elo losing)
    const discoveryPicks = recentWins.filter(r => r.winnerComps !== undefined && r.loserComps !== undefined);
    const discoveryBias = discoveryPicks.filter(r => (r.winnerComps || 0) < (r.loserComps || 0)).length;
    if (discoveryPicks.length >= 5 && discoveryBias / discoveryPicks.length > 0.65) {
      patterns.push({
        type: 'discovery_drift',
        description: 'User consistently prefers lesser-rated artists over established ones — increase discovery weight',
        data: { ratio: discoveryBias / discoveryPicks.length },
      });
    }

    // --- Pattern 3: Rejection pattern ---
    // If the same genre keeps losing, the user may be souring on it
    const genreLosses = {};
    for (const round of recentWins) {
      for (const genre of (round.loserGenres || [])) {
        genreLosses[genre] = (genreLosses[genre] || 0) + 1;
      }
    }
    const coldGenres = Object.entries(genreLosses)
      .filter(([, count]) => count >= 3)
      .filter(([genre]) => !hotGenres.includes(genre)) // Don't flag genres that also win
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre);
    if (coldGenres.length > 0) {
      patterns.push({
        type: 'rejection_pattern',
        description: `User is consistently rejecting ${coldGenres.slice(0, 2).join(' and ')}`,
        data: { genres: coldGenres },
      });
    }

    return patterns;
  }
}
