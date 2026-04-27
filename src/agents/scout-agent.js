import { getSimilarArtists, getArtistTags } from '../data/lastfm-api.js';
import { getArtistTopTracks, getRecommendations, searchTracks, searchArtist, searchTrack } from '../data/spotify-api.js';
import { callWithTools } from '../data/gemini-api.js';

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
          const query = Array.isArray(call.args.query) ? call.args.query[0] : call.args.query;
          const artist = await searchArtist(query);
          if (artist) {
            const tracks = await getArtistTopTracks(artist.id);
            for (const track of tracks.slice(0, 5)) {
              this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_searchArtist', 2000);
            }
          }
        }
        else if (call.tool === 'getSimilarArtists' && call.args.artist) {
          const artistName = Array.isArray(call.args.artist) ? call.args.artist[0] : call.args.artist;
          const similar = await getSimilarArtists(artistName, 3);
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
          const genres = Array.isArray(call.args.seed_genres) ? call.args.seed_genres : [call.args.seed_genres];
          const options = { seedGenres: genres.slice(0,3).map(g => g.toLowerCase()), limit: 15 };
          
          if (call.args.target_features && typeof call.args.target_features === 'object') {
            Object.assign(options, call.args.target_features);
          }
          
          const recs = await getRecommendations(options);
          for (const track of recs) {
            this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_getRecommendations', 1800);
          }
        }
        else if (call.tool === 'searchTracks' && call.args.query) {
          const query = Array.isArray(call.args.query) ? call.args.query[0] : call.args.query;
          const tracks = await searchTracks(query, 10);
          for (const track of tracks) {
            this._addTrackToPool(track, candidatePool, seenTrackIds, 'planner_searchTracks', 1700);
          }
        }
        else if (call.tool === 'searchCulturalWeb' && call.args.query) {
          const query = Array.isArray(call.args.query) ? call.args.query[0] : call.args.query;
          try {
            const prompt = `Search the live web for the following query: "${query}". \nFind specific musical artists or tracks mentioned in articles, forums, or reviews. Return ONLY a JSON array of objects with { "artist": "Artist Name", "track": "Track Name" (optional) }. Return maximum 5 items. DO NOT return markdown formatting.`;
            const { textReply } = await callWithTools(prompt, [{ role: 'user', parts: [{ text: "Search and extract JSON." }] }], [], 'fast', true);
            
            let rawText = textReply.trim();
            if (rawText.startsWith('```json')) rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            if (rawText.startsWith('```')) rawText = rawText.replace(/```/g, '').trim();
            
            const extractions = JSON.parse(rawText);
            for (const item of extractions) {
              if (item.artist && item.track) {
                const spotifyTrack = await searchTrack(item.track, item.artist);
                if (spotifyTrack) this._addTrackToPool(spotifyTrack, candidatePool, seenTrackIds, 'planner_searchCulturalWeb', 1850);
              } else if (item.artist) {
                const spotifyArtist = await searchArtist(item.artist);
                if (spotifyArtist) {
                  const tracks = await getArtistTopTracks(spotifyArtist.id);
                  for (const t of tracks.slice(0, 2)) {
                    this._addTrackToPool(t, candidatePool, seenTrackIds, 'planner_searchCulturalWeb', 1850);
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`ScoutAgent: searchCulturalWeb failed:`, err.message);
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
