/**
 * TasteGraph — Scout Agent
 * "What's Out There" — Discovers candidate tracks by traversing the music graph.
 *
 * Perceives: TasteState (Elo rankings, top genres), session intent
 * Decides:   How many hops to take based on the session's exploration level
 * Acts:      Builds a CandidatePool with source annotations
 *
 * Hop depth is determined by semantic intent analysis:
 *   Familiar/safe vibes → Hop-0 only (user's own top artists)
 *   Moderate exploration → Hop-0 + Hop-1 (Last.fm similar artists)
 *   Adventurous/discover → Hop-0 + Hop-1 + Hop-2 (deep exploration)
 */
import { getSimilarArtists, getArtistTags } from '../data/lastfm-api.js';
import { getArtistTopTracks, getRecommendations, searchTrack } from '../data/spotify-api.js';
import { callWithTools } from '../data/gemini-api.js';
import { DataStore } from '../data/data-store.js';

export class ScoutAgent {
  /**
   * Main entry point. Build a candidate pool from the user's taste graph.
   * @param {object} tasteState - From ProfilerAgent
   * @param {string} sessionIntent - Natural language session vibe
   * @param {object} context    - PipelineContext for inter-agent communication
   * @returns {Array} CandidatePool
   */
  async findCandidates(tasteState, sessionIntent, context = null) {
    const hopDepth  = this.determineHopDepth(sessionIntent);

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

    // --- Intent Override: Semantic Search ---
    if (sessionIntent) {
      await this._addIntentOverrideTracks(sessionIntent, tasteState, candidatePool, seenTrackIds);
    }

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
    await this._addLocalDatabaseTracks(tasteState, sessionIntent, candidatePool, seenTrackIds);

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
   * Determine hop depth from natural language session intent.
   */
  determineHopDepth(sessionIntent) {
    const intent = (sessionIntent || '').toLowerCase();
    if (intent.includes('familiar') || intent.includes('favorite') || intent.includes('only my')) return 0;
    if (intent.includes('new') || intent.includes('discover') || intent.includes('underground') || intent.includes('adventurous')) return 2;
    return 1;
  }

  // --- Private: Intent Override ---
  async _addIntentOverrideTracks(sessionIntent, tasteState, pool, seen) {
    if (!sessionIntent || sessionIntent.trim() === '') return;

    const topGenres = tasteState.topGenres || [];
    
    const prompt = `You are a music discovery agent. The user's current session intent is: "${sessionIntent}". 
Their top genres are: ${topGenres.join(', ')}. 
If the user is asking for specific genres, vibes, or artists that are significantly different from their top genres, you MUST call 'submit_search_queries' with up to 3 Spotify search queries (e.g. "genre:jazz", "artist:miles davis") to satisfy their request.
If their request is generic (e.g., "play my favorites", "give me a mix"), return an empty array.`;

    const toolDecls = [{
      name: 'submit_search_queries',
      description: 'Submit search queries to pull targeted tracks.',
      parameters: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' } }
        },
        required: ['queries']
      }
    }];

    try {
      const result = await callWithTools(prompt, [{ role: 'user', parts: [{ text: 'Extract search queries if needed.' }] }], toolDecls);
      const submitCall = result.functionCalls.find(fc => fc.name === 'submit_search_queries');
      if (submitCall && submitCall.args && submitCall.args.queries) {
        for (const query of submitCall.args.queries) {
          try {
            const tracks = await searchTrack(query, 5);
            for (const track of tracks) {
              if (!seen.has(track.id)) {
                seen.add(track.id);
                pool.push({
                  track,
                  artistName: track.artists?.[0]?.name || '',
                  artistId: track.artists?.[0]?.id || '',
                  source: 'intent_override',
                  hopDistance: 0,
                  eloScore: 2000, // Artificially high to prioritize these candidates
                  tags: [],
                });
              }
            }
          } catch (err) {
            console.warn(\`Scout: Intent search failed for query \${query}\`, err.message);
          }
        }
      }
    } catch (err) {
      console.warn("Scout: Gemini intent override failed:", err.message);
    }
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
  async _addLocalDatabaseTracks(tasteState, sessionIntent, pool, seen) {
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
