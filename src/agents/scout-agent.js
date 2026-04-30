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
import { getArtistTopTracks, getRecommendations } from '../data/spotify-api.js';
import { callWithTools } from '../data/gemini-api.js';
import { DataStore } from '../data/data-store.js';
import { buildSoulPrefix } from './soul.js';

export class ScoutAgent {
  /**
   * Main entry point. Build a candidate pool from the user's taste graph.
   * @param {object} tasteState - From ProfilerAgent
   * @param {string} sessionIntent - Natural language session vibe
   * @param {object} context    - PipelineContext for inter-agent communication
   * @returns {Array} CandidatePool
   */
  async findCandidates(tasteState, sessionIntent, context = null, onThought = null) {
    if (onThought) onThought("Scout: Assessing session constraints and building retrieval plan...");
    const hopDepth  = this.determineHopDepth(sessionIntent, context);
    if (onThought) onThought(`Scout: Graph traversal depth set to Hop-${hopDepth}`);

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

    // --- Intent Override: Multi-Source Agentic Search ---
    if (sessionIntent) {
      await this._addIntentOverrideTracks(sessionIntent, tasteState, candidatePool, seenTrackIds, onThought);
    }

    // --- Hop 0: Top tracks from top-Elo artists (incl. game discoveries) ---
    await this._addHop0Tracks(seedArtists, candidatePool, seenTrackIds, eloRatings, onThought);

    // --- Hop 1: Similar artists via Last.fm + Spotify recs ---
    if (hopDepth >= 1) {
      await this._addHop1Tracks(seedArtists, tasteState.topGenres, candidatePool, seenTrackIds, eloRatings, onThought);
    }

    // --- Hop 2: Genre exploration — bias toward coverage gaps if available ---
    if (hopDepth >= 2) {
      const gapGenres = (context?.coverageGaps || []).map(g => g.genre);
      const hop2Genres = gapGenres.length > 0 ? gapGenres : tasteState.topGenres;
      await this._addHop2Tracks(hop2Genres, seedArtists, candidatePool, seenTrackIds, onThought);
    }

    // Enrich all candidates with Last.fm tags
    if (onThought) onThought("Scout: Enriching pool with Last.fm structural tags...");
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

    // --- Write handoff note to blackboard (Phase 5, Task 5.2) ---
    if (context?.blackboard) {
      const hop0Artists = candidatePool.filter(c => (c.hopDistance || 0) === 0).map(c => c.artistName);
      const hop2Artists = candidatePool.filter(c => (c.hopDistance || 0) >= 2).map(c => c.artistName);
      context.blackboard.scout = {
        searchStrategy: `Hop depth ${hopDepth}. ${candidatePool.length} candidates sourced from ${new Set(candidatePool.map(c => c.source)).size} sources.`,
        totalCandidates: candidatePool.length,
        hopDepthUsed: hopDepth,
        highConfidence: [...new Set(hop0Artists)].slice(0, 5),
        riskyBets: [...new Set(hop2Artists)].slice(0, 5),
        gaps: (context.coverageGaps || []).map(g => g.genre),
      };
    }

    return candidatePool;
  }

  /**
   * Determine hop depth from natural language session intent + discoveryProfile.
   * Task 4.5: Factor in mainstreaminess and specialist index.
   */
  determineHopDepth(sessionIntent, context = null) {
    const intent = (sessionIntent || '').toLowerCase();

    // Explicit intent keywords always override
    if (intent.includes('familiar') || intent.includes('favorite') || intent.includes('only my')) return 0;
    if (intent.includes('new') || intent.includes('discover') || intent.includes('underground') || intent.includes('adventurous')) return 2;

    // Genre exploration always gets max depth
    if (/explor|introduce|get.?into|deep.?dive/.test(intent)) return 2;

    // Factor in discoveryProfile from UserModel if available
    const dp = context?.blackboard?.profiler?.discoveryProfile;
    if (dp) {
      // Low mainstream + high specialist = already deep — go deeper
      if (dp.mainstreaminess < 0.3 && dp.specialistIndex > 0.5) return 2;
      // Very mainstream listener — keep exploration moderate
      if (dp.mainstreaminess > 0.7) return 1;
    }

    return 1;
  }

  // --- Private: Intent Override (LLM-Guided Multi-Source Retrieval) ---
  async _addIntentOverrideTracks(sessionIntent, tasteState, pool, seen, onThought) {
    if (!sessionIntent || sessionIntent.trim() === '') return;

    if (onThought) onThought(`Scout: Analyzing semantic intent: "${sessionIntent}"`);
    const topGenres = tasteState.topGenres || [];
    const topArtistNames = (tasteState.topRankedArtists || []).slice(0, 5).map(a => a.name);

    // Step 1: Ask the LLM for a structured retrieval plan (single call, no multi-turn)
    const prompt = `${buildSoulPrefix()}

You are acting as the Scout — a music discovery agent. Given the user's session intent, generate a retrieval plan of SPECIFIC, REAL artists to look up.

Session intent: "${sessionIntent}"
User's top genres: ${topGenres.join(', ')}
User's top artists: ${topArtistNames.join(', ')}
${(() => { const prefs = DataStore.getExplicitPreferences(); const mems = prefs.agent_memories || []; return mems.length > 0 ? `\nPERMANENT USER NOTES:\n${mems.map(m => '- ' + m).join('\n')}` : ''; })()}

You MUST call the 'submit_retrieval_plan' tool with your plan.

RULES:
- For genre exploration (e.g. "explore jazz"): Name 10-15 SPECIFIC canonical artists spanning different eras and sub-styles. Use your deep music knowledge. For Jazz, don't just say "Miles Davis" — also include Thelonious Monk, John Coltrane, Bill Evans, Charles Mingus, Herbie Hancock, Wayne Shorter, etc.
- For artist-specific requests: Name the requested artist plus 3-5 similar artists.
- For mood/vibe requests: Name 8-10 artists that match the mood from the user's taste neighborhood.
- If the intent is generic (e.g. "play my favorites"): Return an empty artists array.
- Only name REAL, established, acclaimed artists. Never invent fake names.
- Also provide 1-2 "seed" artist names for Last.fm similar-artist graph expansion.`;

    const toolDecls = [{
      name: 'submit_retrieval_plan',
      description: 'Submit the structured retrieval plan with specific artist names to look up.',
      parameters: {
        type: 'object',
        properties: {
          artists: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of specific artist names to look up on Spotify (e.g. ["Miles Davis", "John Coltrane", "Thelonious Monk"])'
          },
          lastfmSeeds: {
            type: 'array',
            items: { type: 'string' },
            description: '1-2 canonical artist names to use as seeds for Last.fm similar-artist expansion'
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of the retrieval strategy'
          }
        },
        required: ['artists']
      }
    }];

    let artistsToLookup = [];
    let lastfmSeeds = [];

    try {
      const result = await callWithTools(prompt, [{ role: 'user', parts: [{ text: 'Generate the retrieval plan.' }] }], toolDecls);
      const planCall = result.functionCalls.find(fc => fc.name === 'submit_retrieval_plan');

      if (planCall?.args) {
        artistsToLookup = planCall.args.artists || [];
        lastfmSeeds = planCall.args.lastfmSeeds || [];
        if (planCall.args.reasoning && onThought) {
          onThought(`Scout strategy: ${planCall.args.reasoning}`);
        }
      }
    } catch (err) {
      console.warn("Scout: LLM retrieval plan failed:", err.message);
    }

    // If the LLM didn't give us artists (generic intent or failure), skip
    if (artistsToLookup.length === 0 && lastfmSeeds.length === 0) return;

    // Step 2: Expand via Last.fm similar-artist graph
    if (lastfmSeeds.length > 0) {
      for (const seed of lastfmSeeds.slice(0, 2)) {
        if (onThought) onThought(`Scout: Expanding from "${seed}" via Last.fm graph...`);
        try {
          const similar = await getSimilarArtists(seed, 10);
          for (const a of similar) {
            if (!artistsToLookup.includes(a.name)) {
              artistsToLookup.push(a.name);
            }
          }
        } catch (err) {
          console.warn(`Scout: Last.fm expansion from "${seed}" failed:`, err.message);
        }
      }
    }

    // Step 3: Look up each artist's top tracks on Spotify
    if (onThought) onThought(`Scout: Looking up ${artistsToLookup.length} artists across Spotify...`);
    const { searchArtists: searchSpotifyArtists } = await import('../data/spotify-api.js');

    // Process in parallel batches of 5 to balance speed vs rate limiting
    const batchSize = 5;
    for (let i = 0; i < artistsToLookup.length; i += batchSize) {
      const batch = artistsToLookup.slice(i, i + batchSize);
      const lookups = batch.map(async (artistName) => {
        try {
          const artists = await searchSpotifyArtists(artistName, 1);
          if (!artists || artists.length === 0) return;
          const artist = artists[0];

          const tracks = await getArtistTopTracks(artist.id);
          // Take top 3 tracks per artist for diversity
          for (const track of tracks.slice(0, 3)) {
            if (!seen.has(track.id)) {
              seen.add(track.id);
              pool.push({
                track,
                artistName: artist.name,
                artistId: artist.id,
                source: 'intent_override',
                hopDistance: 0,
                eloScore: 1800,
                tags: [],
              });
            }
          }
        } catch (err) {
          console.warn(`Scout: Lookup failed for "${artistName}":`, err.message);
        }
      });
      await Promise.all(lookups);
    }

    if (onThought) onThought(`Scout: Intent override sourced ${pool.length} candidates from ${artistsToLookup.length} artists`);
  }

  // --- Private: Hop 0 ---
  async _addHop0Tracks(seedArtists, pool, seen, eloRatings, onThought) {
    if (onThought && seedArtists.length > 0) onThought(`Scout: Expanding candidate pool from known core artists (Hop-0)...`);
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
  async _addHop1Tracks(seedArtists, topGenres, pool, seen, eloRatings, onThought) {
    if (onThought) onThought(`Scout: Pulling adjacent artists from Last.fm graph (Hop-1)...`);
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
  async _addHop2Tracks(topGenres, seedArtists, pool, seen, onThought) {
    if (onThought) onThought(`Scout: Exploring deep genre gaps via Spotify constraints (Hop-2)...`);
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

}
