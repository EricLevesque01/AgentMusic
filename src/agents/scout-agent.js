/**
 * TasteGraph — Scout Agent
 * "What's Out There" — Discovers candidate tracks by traversing the music graph.
 *
 * Perceives: TasteState (Elo rankings, top genres), slider values
 * Decides:   How many hops to take based on Discovery slider
 * Acts:      Builds a CandidatePool with source annotations
 *
 * Hop depth:
 *   Discovery < 0.3 → Hop-0 only (user's own top artists)
 *   Discovery 0.3–0.7 → Hop-0 + Hop-1 (Last.fm similar artists)
 *   Discovery > 0.7 → Hop-0 + Hop-1 + Hop-2 (deep exploration)
 */
import { getSimilarArtists, getArtistTags } from '../data/lastfm-api.js';
import { getArtistTopTracks, getRecommendations, searchTrack } from '../data/spotify-api.js';
import { DataStore } from '../data/data-store.js';

export class ScoutAgent {
  /**
   * Main entry point. Build a candidate pool from the user's taste graph.
   * @param {object} tasteState - From ProfilerAgent
   * @param {object} sliders    - Current session intent values
   * @param {object} context    - PipelineContext for inter-agent communication
   * @returns {Array} CandidatePool
   */
  async findCandidates(tasteState, sliders, context = null) {
    const discovery = sliders.discovery ?? 0.5;
    const hopDepth  = this.determineHopDepth(discovery);

    const { artists, eloRatings } = tasteState;

    // Merge Spotify top artists with any extra artists rated via the Taste Game
    // (related/discovery artists get added to eloRatings by the game)
    const allRatedIds = new Set(artists.map(a => a.id));
    const extraArtists = Object.entries(eloRatings)
      .filter(([id, data]) => !allRatedIds.has(id) && data.name)
      .map(([id, data]) => ({ id, name: data.name, genres: data.genres || [], images: data.imageUrl ? [{ url: data.imageUrl }] : [] }));

    const fullArtistPool = [...artists, ...extraArtists];

    // Rank ALL rated artists by Elo for seed priority
    const rankedArtists = fullArtistPool
      .slice()
      .sort((a, b) => (eloRatings[b.id]?.rating || 1500) - (eloRatings[a.id]?.rating || 1500));

    // Expand seeds: top 8 by Elo (up from 5) so game discoveries can seed Hop-0
    const seedArtists   = rankedArtists.slice(0, 8);
    const candidatePool = [];
    const seenTrackIds  = new Set();

    // --- Hop 0: Top tracks from top-Elo artists (incl. game discoveries) ---
    await this._addHop0Tracks(seedArtists, candidatePool, seenTrackIds, eloRatings);

    // --- Hop 1: Similar artists via Last.fm + Spotify recs ---
    if (hopDepth >= 1) {
      await this._addHop1Tracks(seedArtists, tasteState.topGenres, candidatePool, seenTrackIds, eloRatings);
    }

    // --- Hop 2: Genre exploration — bias toward coverage gaps if available ---
    if (hopDepth >= 2) {
      const gapGenres = (context?.coverageGaps || []).map(g => g.genre);
      const hop2Genres = gapGenres.length > 0 ? gapGenres : tasteState.topGenres;
      await this._addHop2Tracks(hop2Genres, seedArtists, candidatePool, seenTrackIds);
    }

    // --- Local Database: Semantic & Acoustic Matches ---
    // Query our new Python Local API (running on port 8000)
    await this._addLocalDatabaseTracks(tasteState, sliders, candidatePool, seenTrackIds);

    // Enrich all candidates with Last.fm tags
    await this._enrichWithTags(candidatePool);

    // Post-filter: remove candidates in genres the user is actively skipping this session
    const skipGenres = context?.sessionSignals?.skippedGenres || [];
    if (skipGenres.length > 0) {
      const skipSet = new Set(skipGenres.map(g => g.toLowerCase()));
      const before = candidatePool.length;
      const filtered = candidatePool.filter(c => {
        const tags = (c.tags || []).map(t => (typeof t === 'object' ? t.name : t).toLowerCase());
        return !tags.some(t => skipSet.has(t));
      });
      // Only apply filter if it doesn't remove everything
      if (filtered.length >= 5) {
        candidatePool.length = 0;
        candidatePool.push(...filtered);
      }
    }

    return candidatePool;
  }

  /**
   * Determine hop depth from Discovery slider.
   */
  determineHopDepth(discovery) {
    if (discovery < 0.3) return 0;
    if (discovery < 0.7) return 1;
    return 2;
  }

  // --- Private: Hop 0 ---
  async _addHop0Tracks(seedArtists, pool, seen, eloRatings) {
    for (const artist of seedArtists) {
      try {
        const tracks = await getArtistTopTracks(artist.id);
        for (const track of tracks.slice(0, 3)) {
          if (!seen.has(track.id)) {
            seen.add(track.id);
            pool.push({
              track,
              artistName:  artist.name,
              artistId:    artist.id,
              source:      'elo_top',
              hopDistance: 0,
              eloScore:    eloRatings[artist.id]?.rating || 1500,
              tags:        [],
            });
          }
        }
      } catch (err) {
        console.warn(`Scout: Hop-0 failed for "${artist.name}":`, err.message);
      }
    }
  }

  // --- Private: Hop 1 ---
  async _addHop1Tracks(seedArtists, topGenres, pool, seen, eloRatings) {
    // Collect similar artists from Last.fm for top 3 seeds
    const similarArtistNames = new Set();

    for (const seed of seedArtists.slice(0, 3)) {
      const similar = await getSimilarArtists(seed.name, 10);
      for (const a of similar) {
        similarArtistNames.add(a.name);
      }
    }

    // Use Spotify recommendations with seeds
    const seedArtistIds = seedArtists.slice(0, 3).map(a => a.id);
    const seedGenres    = topGenres.slice(0, 2);

    try {
      const recTracks = await getRecommendations({
        seedArtists: seedArtistIds,
        seedGenres,
        limit: 30,
      });

      for (const track of recTracks) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          // Check if this track's artist was among the Last.fm similar results
          const artistName = track.artists?.[0]?.name || '';
          const isLastfm   = similarArtistNames.has(artistName);
          pool.push({
            track,
            artistName,
            artistId:    track.artists?.[0]?.id || '',
            source:      isLastfm ? 'graph_hop' : 'spotify_rec',
            hopDistance: 1,
            eloScore:    1500, // unknown artist
            tags:        [],
          });
        }
      }
    } catch (err) {
      console.warn('Scout: Hop-1 Spotify recs failed:', err.message);
    }
  }

  // --- Private: Hop 2 ---
  async _addHop2Tracks(topGenres, seedArtists, pool, seen) {
    const explorationGenres = topGenres.slice(2, 7); // genres beyond top 2

    try {
      const recTracks = await getRecommendations({
        seedGenres:   explorationGenres.slice(0, 3),
        seedArtists:  seedArtists.slice(0, 2).map(a => a.id),
        limit:        30,
      });

      for (const track of recTracks) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          pool.push({
            track,
            artistName:  track.artists?.[0]?.name || '',
            artistId:    track.artists?.[0]?.id || '',
            source:      'genre_explore',
            hopDistance: 2,
            eloScore:    1500,
            tags:        [],
          });
        }
      }
    } catch (err) {
      console.warn('Scout: Hop-2 genre exploration failed:', err.message);
    }
  }

  // --- Private: Enrich with Last.fm tags ---
  async _enrichWithTags(pool) {
    // Group by artist to minimize API calls
    const artistsToFetch = [...new Set(pool.map(c => c.artistName))].slice(0, 20);

    const tagMap = {};
    for (const name of artistsToFetch) {
      tagMap[name] = await getArtistTags(name);
    }

    for (const candidate of pool) {
      candidate.tags = tagMap[candidate.artistName] || [];
    }
  }

  // --- Private: Query Local Python API ---
  async _addLocalDatabaseTracks(tasteState, sliders, pool, seen) {
    try {
      // 1. Fetch tracks with deep audio features
      const res = await fetch('http://127.0.0.1:8000/tracks?limit=20');
      if (res.ok) {
        const localTracks = await res.json();
        for (const t of localTracks) {
          if (!seen.has(t.spotify_id)) {
            seen.add(t.spotify_id);
            pool.push({
              track: {
                id: t.spotify_id,
                name: t.track_name || 'Unknown Track',
                popularity: 50,
                artists: [{ name: t.artist_name || 'Unknown Artist', id: '' }]
              },
              artistName: t.artist_name || 'Unknown Artist',
              artistId: '',
              source: 'local_database',
              hopDistance: 3, // Out-of-graph discovery
              eloScore: 1500,
              tags: [],
              audioFeatures: {
                danceability: t.danceability,
                energy: t.energy,
                acousticness: t.acousticness
              }
            });
          }
        }
      }

      // 2. Fetch Trending Signals (e.g., from Reddit scrapers)
      const trendingRes = await fetch('http://127.0.0.1:8000/trending?limit=5');
      if (trendingRes.ok) {
        const trendingTracks = await trendingRes.json();
        for (const t of trendingTracks) {
          // These were scraped by name, so we must resolve them to Spotify IDs
          const spotifyTrack = await searchTrack(t.track_name, t.artist_name);
          if (spotifyTrack && !seen.has(spotifyTrack.id)) {
            seen.add(spotifyTrack.id);
            pool.push({
              track: spotifyTrack,
              artistName: t.artist_name,
              artistId: spotifyTrack.artists?.[0]?.id || '',
              source: t.source || 'trending_signal', // Will say "reddit_r_indieheads"
              hopDistance: 4, // Wildcard discovery
              eloScore: 1500,
              tags: []
            });
          }
        }
      }
    } catch (err) {
      console.warn('Scout: Failed to reach local Python database (is the API running on 8000?)', err.message);
    }
  }
}
