import { getSimilarArtists, getArtistTags } from '../data/lastfm-api.js';
import { getArtistTopTracks, getRecommendations, searchTracks, searchArtist, searchTrack } from '../data/spotify-api.js';

export class ScoutAgent {
  /**
   * Executes the Planner's JSON strategy in parallel.
   */
  async executePlan(plan, tasteState, context) {
    const candidatePool = [];
    const seenTrackIds = new Set();
    const { artists, eloRatings } = tasteState;

    if (!plan || !plan.tool_calls) {
      console.warn("ScoutAgent: No tool_calls found in plan. Returning empty pool.");
      return candidatePool;
    }

    // Execute all tools concurrently (ReWOO Worker Execution)
    const promises = plan.tool_calls.map(async (call) => {
      try {
        if (call.tool === 'getTopArtists') {
          const rankedArtists = artists.slice().sort((a,b) => (eloRatings[b.id]?.rating || 1500) - (eloRatings[a.id]?.rating || 1500));
          await this._addHop0Tracks(rankedArtists.slice(0, 8), candidatePool, seenTrackIds, eloRatings);
        }
        else if (call.tool === 'searchArtist' && call.args.query) {
          const artist = await searchArtist(call.args.query);
          if (artist) {
            const tracks = await getArtistTopTracks(artist.id);
            for (const track of tracks.slice(0, 5)) {
              this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_searchArtist', 2000);
            }
          }
        }
        else if (call.tool === 'getSimilarArtists' && call.args.artist) {
          const similar = await getSimilarArtists(call.args.artist, 3);
          for (const sim of similar) {
            const artist = await searchArtist(sim.name);
            if (artist) {
              const tracks = await getArtistTopTracks(artist.id);
              for (const track of tracks.slice(0, 3)) {
                this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_getSimilarArtists', 1900);
              }
            }
          }
        }
        else if (call.tool === 'getRecommendations' && call.args.seed_genres) {
          const recs = await getRecommendations({ seedGenres: call.args.seed_genres.slice(0,3), limit: 15 });
          for (const track of recs) {
            this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_getRecommendations', 1800);
          }
        }
        else if (call.tool === 'getTrendingSignals') {
          await this._addTrendingTracks(candidatePool, seenTrackIds);
        }
      } catch (err) {
        console.warn(`ScoutAgent: Worker failed executing ${call.tool}`, err.message);
      }
    });

    await Promise.all(promises);

    // Enrich with Last.fm tags
    await this._enrichWithTags(candidatePool);

    return candidatePool;
  }

  _addTrackToPool(track, pool, seen, source, eloScore) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      pool.push({
        track,
        artistName: track.artists?.[0]?.name || '',
        artistId: track.artists?.[0]?.id || '',
        source,
        hopDistance: 1,
        eloScore,
        tags: []
      });
    }
  }

  // --- Private Helpers ---
  async _addHop0Tracks(seedArtists, pool, seen, eloRatings) {
    for (const artist of seedArtists) {
      try {
        const tracks = await getArtistTopTracks(artist.id);
        for (const track of tracks.slice(0, 3)) {
          this._addTrackToPool(track, pool, seen, 'elo_top', eloRatings[artist.id]?.rating || 1500);
        }
      } catch (err) {}
    }
  }

  async _enrichWithTags(pool) {
    const artistsToFetch = [...new Set(pool.map(c => c.artistName))].slice(0, 20);
    const tagMap = {};
    for (const name of artistsToFetch) {
      tagMap[name] = await getArtistTags(name);
    }
    for (const candidate of pool) {
      candidate.tags = tagMap[candidate.artistName] || [];
    }
  }

  async _addTrendingTracks(pool, seen) {
    try {
      const trendingRes = await fetch('http://127.0.0.1:8000/trending?limit=5');
      if (trendingRes.ok) {
        const trendingTracks = await trendingRes.json();
        for (const t of trendingTracks) {
          const spotifyTrack = await searchTrack(t.track_name, t.artist_name);
          if (spotifyTrack) {
            this._addTrackToPool(spotifyTrack, pool, seen, t.source || 'trending_signal', 1500);
          }
        }
      }
    } catch (err) {
      console.warn('ScoutAgent: Local trending fetch failed.', err.message);
    }
  }
}
