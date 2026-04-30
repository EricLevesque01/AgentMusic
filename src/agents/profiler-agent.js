/**
 * TasteGraph — Profiler Agent
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

    if (!artists || !tracks || artists.length <= 50) {
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
        
        artists = Array.from(artistMap.values());
        tracks = mediumTracks;

        DataStore.setTopArtists(artists);
        DataStore.setTopTracks(tracks);
      } catch (err) {
        console.warn("Failed to fetch fresh data from Spotify (is the backend running?). Falling back to cache.", err);
        if (!artists) artists = [];
        if (!tracks) tracks = [];
      }
    }

    // --- Decide: Merge with existing Elo ratings ---
    const eloRatings = this._initializeEloRatings(artists);

    // --- Act: Produce TasteState ---
    const topGenres = this._extractTopGenres(artists);
    
    // Sort all artists by their live Elo ratings to establish true dynamic taste
    const allRanked = Object.values(eloRatings)
      .filter(a => a.name && a.name !== 'undefined')
      .sort((a, b) => b.rating - a.rating);
    
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

    return {
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
   * Compute aggregate audio profile from audio feature objects.
   * (Kept for tests and future use if audio features become available.)
   */
  computeAudioProfile(audioFeatures) {
    if (!audioFeatures || audioFeatures.length === 0) {
      return { avgEnergy: 0.5, avgValence: 0.5, avgTempo: 120, avgDanceability: 0.5 };
    }

    const sum = audioFeatures.reduce(
      (acc, f) => ({
        energy:       acc.energy + (f.energy || 0),
        valence:      acc.valence + (f.valence || 0),
        tempo:        acc.tempo + (f.tempo || 0),
        danceability: acc.danceability + (f.danceability || 0),
      }),
      { energy: 0, valence: 0, tempo: 0, danceability: 0 },
    );

    const n = audioFeatures.length;
    return {
      avgEnergy:       sum.energy / n,
      avgValence:      sum.valence / n,
      avgTempo:        sum.tempo / n,
      avgDanceability: sum.danceability / n,
    };
  }

  /**
   * Derive a proxy audio profile from Spotify track objects.
   * Uses track.popularity (0–100) as a proxy since the audio-features
   * endpoint was deprecated for new apps in 2024.
   *
   * Popularity → normalized to 0–1 as a rough energy/mainstream proxy.
   * This will be enriched with Last.fm tags by the Scout Agent in Phase 5.
   */
  computeAudioProfileFromTracks(tracks) {
    if (!tracks || tracks.length === 0) {
      return { avgEnergy: 0.5, avgValence: 0.5, avgTempo: 120, avgDanceability: 0.5 };
    }

    const avgPopularity = tracks.reduce((sum, t) => sum + (t.popularity || 50), 0) / tracks.length;
    const normalizedPop = avgPopularity / 100;

    // Use popularity as a broad mainstream/energy proxy
    return {
      avgEnergy:       normalizedPop,
      avgValence:      0.5, // unknown without audio features
      avgTempo:        120, // unknown without audio features
      avgDanceability: normalizedPop,
    };
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
    
    // Ensure both exist with defaults — include name/imageUrl so the leaderboard never shows "undefined"
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
          source: 'game'
        };
      } else {
        // Patch any previously-stored entry that's missing a name (legacy data)
        if (!ratings[id].name && meta?.name) {
          ratings[id].name = meta.name;
          ratings[id].imageUrl = ratings[id].imageUrl || meta?.images?.[0]?.url || null;
          ratings[id].genres = ratings[id].genres?.length ? ratings[id].genres : (meta?.genres || []);
        }
      }
    });

    const rA = ratings[artistAId].rating;
    const rB = ratings[artistBId].rating;
    const winner = winnerId === artistAId ? 'A' : (winnerId === artistBId ? 'B' : 'DRAW');

    const { newA, newB } = eloEngine.updateRatings(rA, rB, winner);

    // Update Rating
    ratings[artistAId].rating = newA;
    ratings[artistBId].rating = newB;

    // Update Affinity Stats
    const now = Date.now();
    ratings[artistAId].comparison_count = (ratings[artistAId].comparison_count || 0) + 1;
    ratings[artistBId].comparison_count = (ratings[artistBId].comparison_count || 0) + 1;
    ratings[artistAId].last_compared_at = now;
    ratings[artistBId].last_compared_at = now;

    if (winner === 'A') {
      ratings[artistAId].wins = (ratings[artistAId].wins || 0) + 1;
      ratings[artistBId].losses = (ratings[artistBId].losses || 0) + 1;
    } else if (winner === 'B') {
      ratings[artistBId].wins = (ratings[artistBId].wins || 0) + 1;
      ratings[artistAId].losses = (ratings[artistAId].losses || 0) + 1;
    } else {
      ratings[artistAId].ties = (ratings[artistAId].ties || 0) + 1;
      ratings[artistBId].ties = (ratings[artistBId].ties || 0) + 1;
    }

    // Record the matchup to prevent exact repeats
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
    return Object.entries(ratings)
      .sort((a, b) => b[1].rating - a[1].rating)
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
