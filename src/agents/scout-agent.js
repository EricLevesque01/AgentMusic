/**
 * Agent Music — Scout Agent
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
import { getRecommendations } from '../data/spotify-api.js';
import {
  resolveArtist,
  getTopTracks,
  resolveSpecificTracks,
  searchByIntent,
  resetResolverCaches,
  isSpotifyDegraded,
} from '../data/track-resolver.js';
import { callWithTools } from '../data/gemini-api.js';
import { runScoutWebSearch, isSearxngAvailable } from '../data/local-agent.js';
import { DataStore } from '../data/data-store.js';
import { buildSoulPrefix } from './soul.js';
import { searchArtist as searchMbArtist, getArtistRelationships } from '../data/musicbrainz-api.js';
import { UserModel } from './user-model.js';
import { EmbeddingStore } from '../data/embedding-store.js';

const LLM_BACKEND = import.meta.env?.VITE_LLM_BACKEND || 'gemini';

export class ScoutAgent {
  /**
   * Classify intent type synchronously (no LLM cost).
   * Used to gate intentOverrideActive before and after the LLM retrieval plan.
   * Returns: 'specific' | 'broad' | 'exploration' | 'general'
   */
  _classifyIntentType(intent) {
    const text = (intent || '').toLowerCase();
    // Specific artist/track request — user named something they want to hear
    if (/check.?out|listen to|heard about|friend.*told|try\s+\w|got.?into|looking for|want to hear|play me|show me|find me|introduce me to\s+\w|give me some|just\s+\w|only\s+\w|\bcheck\b|\btry\b|playlist\s+for|playlist\s+of|playlist\s+by|\bartist\b|\bband\b/i.test(text)) return 'specific';
    // Broad requests — use full graph traversal with seed artists
    if (/familiar|favorites|my usual|top artists|what i know|same as always|my go-to|nothing new/.test(text)) return 'broad';
    // Exploration — deep hop traversal requested
    if (/explore|discover|new|underground|adventurous|\bintroduce me\b|haven.t heard|branch out|expand/.test(text)) return 'exploration';
    return 'general';
  }

  /**
   * Main entry point. Build a candidate pool from the user's taste graph.
   * @param {object} tasteState - From ProfilerAgent
   * @param {string} sessionIntent - Natural language session vibe
   * @param {object} context    - PipelineContext for inter-agent communication
   * @returns {Array} CandidatePool
   */
  async findCandidates(tasteState, sessionIntent, context = null, onThought = null) {
    // Reset per-run caches so stale data doesn't bleed between pipeline runs
    resetResolverCaches();

    if (onThought) onThought("Scout: Assessing session constraints and building retrieval plan...");

    // --- Fast intent classification (synchronous, no LLM cost) ---
    // This gates intentOverrideActive BEFORE the LLM call, so even if the LLM
    // returns an empty array for a specific request, we still suppress seed expansion.
    const intentType = this._classifyIntentType(sessionIntent);
    const isSpecificRequest = intentType === 'specific';
    this._isSpecificRequest = isSpecificRequest; // Store for _addIntentOverrideTracks
    if (isSpecificRequest && onThought) onThought(`Scout: Detected specific artist/track request — seed expansion will be suppressed`);

    const hopDepth  = this.determineHopDepth(sessionIntent, context);
    if (onThought) onThought(`Scout: Graph traversal depth set to Hop-${hopDepth}`);
    if (isSpotifyDegraded() && onThought) onThought('Scout: ⚠ Spotify rate-limited — using Last.fm fallback for track data');

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
    // Gate: intentOverrideActive if EITHER the fast classifier detected a specific
    // request OR the LLM retrieval plan produced a meaningful pool.
    // This prevents the LLM's empty-array edge case from silently disabling the gate.
    let intentOverrideActive = isSpecificRequest; // pre-set from synchronous classifier
    if (sessionIntent) {
      await this._addIntentOverrideTracks(sessionIntent, tasteState, candidatePool, seenTrackIds, context, onThought);
      // For ANY non-general intent, if the LLM produced even 1 track, suppress seed
      // expansion. The old threshold (>= 5) caused genre exploration requests like
      // "jazz, soul, bossa nova deep cuts" to get flooded by seed-expansion artists
      // (Geese, Erykah Badu) that had nothing to do with the intent.
      if (candidatePool.length > 0 && intentType !== 'general') {
        intentOverrideActive = true;
      }
    }

    // --- Direct Spotify fallback for specific requests with empty pools ---
    // If the LLM retrieval plan failed/returned nothing but we know the user named
    // an artist, try a direct Spotify search. No LLM needed — just name → search → top tracks.
    if (isSpecificRequest && candidatePool.length === 0 && sessionIntent) {
      if (onThought) onThought('Scout: LLM retrieval returned empty — trying direct Spotify lookup…');
      try {
        // Extract likely artist names from the intent
        const { searchArtists: spotifySearch, getArtistTopTracks } = await import('../data/spotify-api.js');
        // Try the raw intent words as an artist search
        const intentClean = sessionIntent
          .replace(/^(build|make|create|give me|play|find|get|show)\s+(a\s+)?(playlist|mix|tracks?|songs?)\s*(for|of|by|around|with|from)?\s*/i, '')
          .replace(/^(my friend.*(?:listen to|check out|try)|i (?:want to|should) (?:listen to|check out|hear|try))\s*/i, '')
          .replace(/[,.].*$/, '') // everything after comma/period is usually context
          .replace(/\s*(?:more|what|some|tracks|songs|should|check out).*$/i, '')
          .trim();

        if (intentClean.length > 1) {
          const artists = await spotifySearch(intentClean, 3);
          for (const artist of artists) {
            try {
              const tracks = await getArtistTopTracks(artist.id);
              for (const track of (tracks || []).slice(0, 15)) {
                if (!seenTrackIds.has(track.id)) {
                  seenTrackIds.add(track.id);
                  candidatePool.push({
                    track,
                    artistName: artist.name,
                    artistId: artist.id,
                    source: 'direct_spotify_fallback',
                    hopDistance: 0,
                    eloScore: 1900,
                    tags: artist.genres || [],
                  });
                }
              }
              if (candidatePool.length > 0) {
                if (onThought) onThought(`Scout: Direct Spotify lookup found ${candidatePool.length} tracks from "${artist.name}"`);
                break; // Found tracks for the first matching artist — stop
              }
            } catch (trackErr) {
              console.debug(`Scout: Failed to get top tracks for ${artist.name}:`, trackErr.message);
            }
          }
        }
      } catch (fallbackErr) {
        console.warn('Scout: Direct Spotify fallback failed:', fallbackErr.message);
      }
    }

    // --- Targeted intent-aware expansion for small pools ---
    // If the intent override produced some tracks but not enough for a full playlist,
    // expand from the INTENT-SOURCED artists via Last.fm similar artists.
    // This is different from seed expansion: it finds more artists in the same vein
    // as what the LLM identified, not the user's top-Elo library artists.
    const MIN_POOL_FOR_PLAYLIST = 15;
    if (intentOverrideActive && candidatePool.length > 0 && candidatePool.length < MIN_POOL_FOR_PLAYLIST) {
      if (onThought) onThought(`Scout: Pool has ${candidatePool.length} tracks — expanding from intent-sourced artists via Last.fm…`);
      // Get unique artist names from the current pool
      const poolArtistNames = [...new Set(candidatePool.map(c => c.artistName).filter(Boolean))];
      const expansionSeeds = poolArtistNames.slice(0, 4); // Expand from up to 4 seed artists

      for (const seedName of expansionSeeds) {
        try {
          const similar = await getSimilarArtists(seedName, 8);
          for (const simArtist of similar) {
            try {
              const resolved = await resolveArtist(simArtist.name);
              if (!resolved) continue;
              const tracks = await getTopTracks(resolved.id, resolved.name);
              for (const track of (tracks || []).slice(0, 3)) {
                if (!seenTrackIds.has(track.id)) {
                  seenTrackIds.add(track.id);
                  candidatePool.push({
                    track,
                    artistName: resolved.name,
                    artistId: resolved.id,
                    source: 'intent_similar_expansion',
                    hopDistance: 1,
                    eloScore: 1700,
                    tags: [],
                  });
                }
              }
            } catch (e) {
              // Skip individual artist failures
            }
            // Stop expanding once we have enough
            if (candidatePool.length >= MIN_POOL_FOR_PLAYLIST * 2) break;
          }
        } catch (err) {
          console.debug(`Scout: Similar expansion from "${seedName}" failed:`, err.message);
        }
        if (candidatePool.length >= MIN_POOL_FOR_PLAYLIST * 2) break;
      }
      if (onThought) onThought(`Scout: Expanded pool to ${candidatePool.length} candidates via similar-artist discovery`);
    }

    // --- Web-Grounded Discovery: Search the real internet for topical connections ---
    // Only run if the intent override didn't already produce a focused pool
    if (!intentOverrideActive && seedArtists.length > 0) {
      if (LLM_BACKEND === 'ollama') {
        await this._searchWebLocalAgent(seedArtists, sessionIntent, tasteState, candidatePool, seenTrackIds, onThought);
      } else {
        await this._searchWebGemini(seedArtists, sessionIntent, tasteState, candidatePool, seenTrackIds, onThought);
      }
    }

    // --- Seed artist expansions: SKIP when intent override is active ---
    // When someone says "check out Geese", adding The Strokes' top tracks
    // just guarantees the Curator picks what's familiar. The intent override
    // already found the right tracks.
    if (!intentOverrideActive) {
      // --- MusicBrainz Relationship Expansion ---
      if (hopDepth >= 1 && seedArtists.length > 0) {
        await this._addRelationshipTracks(seedArtists.slice(0, 3), candidatePool, seenTrackIds, onThought);
      }

      // --- Hop 0: Top tracks from top-Elo artists ---
      await this._addHop0Tracks(seedArtists, candidatePool, seenTrackIds, eloRatings, onThought);

      // --- Hop 1: Similar artists via Last.fm + Spotify recs ---
      if (hopDepth >= 1) {
        await this._addHop1Tracks(seedArtists, tasteState.topGenres, candidatePool, seenTrackIds, eloRatings, onThought);
      }

      // --- Hop 2: Genre exploration ---
      if (hopDepth >= 2) {
        const gapGenres = (context?.coverageGaps || []).map(g => g.genre);
        const hop2Genres = gapGenres.length > 0 ? gapGenres : tasteState.topGenres;
        await this._addHop2Tracks(hop2Genres, seedArtists, candidatePool, seenTrackIds, onThought);
      }
    }

    // --- Cultural Discoveries: inject CulturalScout's web-researched artists into the pool ---
    // These run regardless of intentOverrideActive — cultural intelligence always enriches the pool.
    const culturalIntel = context?.blackboard?.culturalIntelligence;
    if (culturalIntel?.artistDiscoveries?.length > 0) {
      if (onThought) onThought(`Scout: Adding ${culturalIntel.artistDiscoveries.length} cultural discovery leads to pool...`);
      await this._addCulturalDiscoveries(culturalIntel.artistDiscoveries, eloRatings, candidatePool, seenTrackIds, onThought);
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

    // Anti-repetition: throttle artists that appeared in recent playlists (7-day TTL)
    // Source-tagged cultural discoveries and intent-override tracks are exempt — they're
    // specifically requested or freshly researched.
    const recentArtists = new Set(context?.recentPlaylistArtists || []);
    if (recentArtists.size > 0) {
      const exemptSources = new Set(['cultural_discovery', 'llm_primary_artist', 'llm_specific', 'intent_search']);
      const filtered = candidatePool.filter(c => {
        if (exemptSources.has(c.source)) return true;
        return !recentArtists.has((c.artistName || '').toLowerCase());
      });
      // Only apply if we don't over-prune
      if (filtered.length >= 8) {
        candidatePool.length = 0;
        candidatePool.push(...filtered);
        if (onThought) onThought(`Scout: Anti-repetition removed recently-played artists, ${candidatePool.length} candidates remain`);
      }
    }

    // --- Write handoff note to blackboard (Phase 5, Task 5.2) ---
    if (context?.blackboard) {
      const hop0Artists = candidatePool.filter(c => (c.hopDistance || 0) === 0).map(c => c.artistName);
      const hop2Artists = candidatePool.filter(c => (c.hopDistance || 0) >= 2).map(c => c.artistName);

      // Source breakdown: tells the Curator exactly how this pool was assembled
      const sourceBreakdown = {};
      for (const c of candidatePool) {
        sourceBreakdown[c.source] = (sourceBreakdown[c.source] || 0) + 1;
      }

      context.blackboard.scout = {
        searchStrategy: `Hop depth ${hopDepth}. ${candidatePool.length} candidates sourced from ${new Set(candidatePool.map(c => c.source)).size} sources.`,
        totalCandidates: candidatePool.length,
        hopDepthUsed: hopDepth,
        highConfidence: [...new Set(hop0Artists)].slice(0, 5),
        riskyBets: [...new Set(hop2Artists)].slice(0, 5),
        gaps: (context.coverageGaps || []).map(g => g.genre),
        sourceBreakdown,
        usedAgenticRetrieval: (sourceBreakdown['llm_specific'] || 0) + (sourceBreakdown['intent_search'] || 0) + (sourceBreakdown['llm_primary_artist'] || 0) + (sourceBreakdown['intent_override'] || 0) > 0,
        intentOverrideActive,
        spotifyDegraded: isSpotifyDegraded(),
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

  // --- Private: Cultural Discoveries (from CulturalScout web research) ---
  /**
   * Resolve CulturalScout's artist discoveries into actual tracks.
   * Each discovery is [{ name, reason, source, freshness }].
   * We fetch top tracks from Spotify for each discovered artist and inject
   * them into the pool marked as 'cultural_discovery'.
   */
  async _addCulturalDiscoveries(discoveries, eloRatings, pool, seen, onThought) {
    const knownNames = new Set(
      Object.values(eloRatings).map(a => (a.name || '').toLowerCase()).filter(Boolean)
    );

    // Only process artists the user doesn't already know well (not in their Elo graph)
    const newDiscoveries = discoveries.filter(d =>
      d.name && !knownNames.has(d.name.toLowerCase())
    ).slice(0, 5); // Cap at 5 to avoid pool bloat

    if (newDiscoveries.length === 0) return;

    // Use resolveArtist + getTopTracks from track-resolver (imported at top of file)
    // NOT the raw spotify-api — that bypasses the request queue and rate-limit protection.
    for (const discovery of newDiscoveries) {
      try {
        const artist = await resolveArtist(discovery.name);
        if (!artist) continue;
        const tracks = await getTopTracks(artist.id, artist.name, 3);
        if (!tracks || tracks.length === 0) continue;

        for (const track of tracks) {
          if (seen.has(track.id)) continue;
          seen.add(track.id);
          pool.push({
            track,
            artistName: discovery.name,
            score: 0.6, // Moderate initial score — Curator calibrates from here
            source: 'cultural_discovery',
            hopDistance: 1,
            dominantFactor: discovery.reason || 'Trending in your musical world',
            culturalFreshness: discovery.freshness || 'timely',
            culturalSource: discovery.source || 'web',
          });
        }
        if (onThought) onThought(`Scout: Added ${tracks.length} tracks from cultural discovery: ${discovery.name}`);
      } catch (err) {
        // Non-critical — skip this discovery if resolution fails
        console.debug(`Scout: Cultural discovery failed for ${discovery.name}:`, err.message);
      }
    }
  }

  // --- Private: Intent Override (LLM-Guided Multi-Source Retrieval) ---
  async _addIntentOverrideTracks(sessionIntent, tasteState, pool, seen, context, onThought) {
    if (!sessionIntent || sessionIntent.trim() === '') return;

    if (onThought) onThought(`Scout: Analyzing semantic intent: "${sessionIntent}"`);

    // Step 1: Ask the LLM for a structured retrieval plan.
    // Use the full Taste DNA Brief (built by Orchestrator after Profiler) instead of
    // ad-hoc "top genres / top artists" lists. This gives the LLM a rich narrative
    // understanding: north star artist, core identity, momentum, sophistication, etc.
    const intentType = this._classifyIntentType(sessionIntent);
    const isExploration = intentType === 'exploration';

    // Import and format the taste brief
    let tasteBriefText = '';
    try {
      const { formatTasteBriefForPrompt } = await import('./taste-brief.js');
      tasteBriefText = formatTasteBriefForPrompt(context?.tasteBrief);
    } catch (e) {}

    // For exploration intents, include the brief as background but tell the LLM
    // to search independently — don't constrain to the user's existing library.
    const userContextBlock = isExploration
      ? `${tasteBriefText ? tasteBriefText + '\n\n' : ''}IMPORTANT: The user is asking to EXPLORE genres they don't know well. Do NOT recommend artists from their existing library or taste profile above. Use it only to understand their sophistication level and what they already know. Instead, use your own deep musical knowledge to find canonical, essential artists in the requested genres. Think like a record store clerk recommending the real deal, not approximations.`
      : (tasteBriefText || `User's top genres: ${(tasteState.topGenres || []).join(', ')}\nUser's top artists: ${(tasteState.topRankedArtists || []).slice(0, 5).map(a => a.name).join(', ')}`);

    const prompt = `${buildSoulPrefix()}

You are the Scout — a music discovery agent. Given the session intent, decide:
1. WHAT to search for (specific artists, albums, tracks)
2. WHERE to look (which sources matter for this intent)
3. WHY these choices serve the intent

Session intent: "${sessionIntent}"
${userContextBlock}

Think about what kind of request this is and adapt your retrieval strategy.
You have THREE ways to find tracks — use whichever combination best serves the intent:

1. **artists** — Artist names for top-tracks lookup. Good for broad discovery.
2. **specificTracks** — Exact track names YOU choose from your knowledge of the artist's catalog. Use this for mood-specific, thematic, or deep-cut requests where top tracks won't reach the right songs. Example: for "Beatles love songs", don't just list The Beatles — specify "Till There Was You", "I Will", "Something", "Here, There and Everywhere".
3. **searchQueries** — Spotify search queries for intent-filtered discovery. Use field filters like artist:"Name" plus mood/theme keywords. Example: 'artist:"Miles Davis" ballad', 'genre:shoegaze dreamy'.

When to use each:
- **Scene/geographic** ("Connecticut indie scene", "local NYC punk bands", "UK post-punk"): Use 'artists' with 8-12 bands that represent that sound/region/era from your training knowledge. If you can't name hyper-local acts, use well-known acts from that genre and region as a proxy. Also use 'searchQueries' like 'genre:indie rock northeast' to cast a wider net.
- **Genre exploration** ("explore jazz", "jazz, soul, bossa nova deep cuts"): Use 'artists' with 8-12 CANONICAL artists from the requested genre — the legends, the must-knows, spanning different eras and subgenres. Do NOT pick artists adjacent to the user's existing taste. Also use 'searchQueries' with genre tags and 'specificTracks' for iconic deep cuts.
- **Artist focus** ("check out Geese"): Use 'artists' with the target first + 5-8 related artists. Consider adding 'specificTracks' if you know standout tracks.
- **Mood/theme** ("Beatles love songs", "late night drive"): PREFER 'specificTracks' (name 10-15 songs) and 'searchQueries' — top tracks are too generic for mood-specific requests. Name the exact songs that fit the mood.
- **Deep dive** ("deep cuts from Radiohead"): Use 'specificTracks' exclusively — name 10-15 lesser-known gems, not the hits.
- **Generic** ("play my favorites"): Return empty artists list — let the graph traversal handle it.

Also provide 1-2 "seed" artists for Last.fm graph expansion — slightly outside the user's core.

You MUST call the 'submit_retrieval_plan' tool.`;

    const toolDecls = [{
      name: 'submit_retrieval_plan',
      description: 'Submit the structured retrieval plan. Use specificTracks for mood/theme requests where top tracks would be too generic.',
      parameters: {
        type: 'object',
        properties: {
          artists: {
            type: 'array',
            items: { type: 'string' },
            description: 'Artist names for top-tracks lookup (e.g. ["Miles Davis", "John Coltrane"])'
          },
          specificTracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackName: { type: 'string', description: 'Exact track name' },
                artistName: { type: 'string', description: 'Artist who performs it' }
              },
              required: ['trackName', 'artistName']
            },
            description: 'Specific tracks chosen by you for this intent. Use for deep cuts, mood-specific songs, or thematic requests.'
          },
          searchQueries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Spotify search queries with field filters (e.g. ["artist:\\"The Beatles\\" love ballad", "genre:bossa nova mellow"])'
          },
          lastfmSeeds: {
            type: 'array',
            items: { type: 'string' },
            description: '1-2 canonical artist names for Last.fm similar-artist expansion'
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
    let specificTracks = [];
    let searchQueries = [];
    let lastfmSeeds = [];

    try {
      const result = await callWithTools(
        prompt,
        [{ role: 'user', parts: [{ text: 'Generate the retrieval plan.' }] }],
        toolDecls,
        'fast',
        false,
        'scout'   // Route to qwen3:8b for local
      );
      const planCall = result.functionCalls.find(fc => fc.name === 'submit_retrieval_plan');

      if (planCall?.args) {
        artistsToLookup = planCall.args.artists || [];
        specificTracks = planCall.args.specificTracks || [];
        searchQueries = planCall.args.searchQueries || [];
        lastfmSeeds = planCall.args.lastfmSeeds || [];
        if (planCall.args.reasoning && onThought) {
          onThought(`Scout strategy: ${planCall.args.reasoning}`);
        }
      }
    } catch (err) {
      console.warn("Scout: LLM retrieval plan failed:", err.message);
    }

    // If the LLM gave us nothing (generic intent or failure), skip
    if (artistsToLookup.length === 0 && specificTracks.length === 0 && searchQueries.length === 0 && lastfmSeeds.length === 0) return;

    // --- Agentic Track Resolution: specific tracks chosen by the LLM ---
    if (specificTracks.length > 0) {
      if (onThought) onThought(`Scout: Resolving ${specificTracks.length} LLM-chosen tracks...`);
      const resolved = await resolveSpecificTracks(specificTracks);
      for (const track of resolved) {
        if (track && !seen.has(track.id)) {
          seen.add(track.id);
          pool.push({
            track,
            artistName: track.artists?.[0]?.name || '',
            artistId: track.artists?.[0]?.id || '',
            source: 'llm_specific',
            hopDistance: 0,
            eloScore: 1900, // High priority — the LLM hand-picked these
            tags: [],
          });
        }
      }
      if (onThought) onThought(`Scout: Resolved ${resolved.length} specific tracks`);
    }

    // --- Agentic Track Resolution: intent-filtered search queries ---
    if (searchQueries.length > 0) {
      if (onThought) onThought(`Scout: Running ${searchQueries.length} intent-filtered searches...`);
      for (const query of searchQueries.slice(0, 5)) {
        const tracks = await searchByIntent(query, 5);
        for (const track of tracks) {
          if (track && !seen.has(track.id)) {
            seen.add(track.id);
            pool.push({
              track,
              artistName: track.artists?.[0]?.name || '',
              artistId: track.artists?.[0]?.id || '',
              source: 'intent_search',
              hopDistance: 0,
              eloScore: 1800,
              tags: [],
            });
          }
        }
      }
    }

    // --- Last.fm graph expansion (skip for specific artist requests to avoid pool dilution) ---
    if (lastfmSeeds.length > 0 && !this._isSpecificRequest) {
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

    // --- Artist-level top-tracks lookup (via resilient resolver) ---
    if (artistsToLookup.length > 0) {
      if (onThought) onThought(`Scout: Looking up ${artistsToLookup.length} artists via resolver...`);

      // Process in parallel batches of 5 to balance speed vs rate limiting
      const batchSize = 5;
      for (let i = 0; i < artistsToLookup.length; i += batchSize) {
        const batch = artistsToLookup.slice(i, i + batchSize);
        const lookups = batch.map(async (artistName) => {
          try {
            const artist = await resolveArtist(artistName);
            if (!artist) return;

            // Primary artist gets more tracks; supporting artists get a few for context.
            const artistIndex = artistsToLookup.indexOf(artistName);
            const trackLimit = (artistIndex === 0 && this._isSpecificRequest) ? 20 : (artistIndex === 0 ? 12 : 4);
            // Pass trackLimit into resolver — don't rely on the default-10 cap
            const tracks = await getTopTracks(artist.id, artist.name, trackLimit);
            for (const track of tracks.slice(0, trackLimit)) {
              if (!seen.has(track.id)) {
                seen.add(track.id);
                pool.push({
                  track,
                  artistName: artist.name,
                  artistId: artist.id,
                  source: artistIndex === 0 ? 'llm_primary_artist' : 'intent_override',
                  hopDistance: 0,
                  eloScore: artistIndex === 0 ? 2000 : 1800,
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
    }

    if (onThought) onThought(`Scout: Intent override sourced ${pool.length} candidates from ${artistsToLookup.length} artists, ${specificTracks.length} specific tracks, ${searchQueries.length} search queries`);
  }

  // --- Private: Hop 0 ---
  async _addHop0Tracks(seedArtists, pool, seen, eloRatings, onThought) {
    if (onThought && seedArtists.length > 0) onThought(`Scout: Expanding candidate pool from known core artists (Hop-0)...`);
    for (const artist of seedArtists) {
      try {
        const tracks = await getTopTracks(artist.id, artist.name);
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
    // Collect similar artists — strategy depends on LLM backend:
    //   Ollama path: use local cosine embeddings (EmbeddingStore) — no API call needed
    //   Gemini path: use Last.fm similar artists API (unchanged)
    const similarArtistNames = new Set();
    const eloIds = new Set(Object.keys(eloRatings));

    if (LLM_BACKEND === 'ollama' && EmbeddingStore.isReady) {
      if (onThought) onThought('Scout: Finding similar artists via local embeddings (Hop-1)...');
      // For each seed, find the top-8 most semantically similar artists by cosine distance
      for (const seed of seedArtists.slice(0, 3)) {
        try {
          const results = await EmbeddingStore.findSimilarToArtist(
            seed.id,
            8,
            seedArtists.map(a => a.id) // Exclude seeds from results
          );
          for (const r of results) {
            if (r.score > 0.6) { // Only high-confidence matches
              similarArtistNames.add(r.name);
            }
          }
        } catch (err) {
          console.debug('Scout: Embedding similarity failed for', seed.name, err.message);
        }
      }
    } else {
      // Last.fm path (Gemini mode or embedding store not yet ready)
      for (const seed of seedArtists.slice(0, 3)) {
        const similar = await getSimilarArtists(seed.name, 10);
        for (const a of similar) {
          similarArtistNames.add(a.name);
        }
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
          const artistName = track.artists?.[0]?.name || '';
          const isEmbedding = LLM_BACKEND === 'ollama' && EmbeddingStore.isReady;
          const isMatch     = similarArtistNames.has(artistName);
          pool.push({
            track,
            artistName,
            artistId:    track.artists?.[0]?.id || '',
            source:      isMatch ? (isEmbedding ? 'embedding_hop' : 'graph_hop') : 'spotify_rec',
            hopDistance: 1,
            eloScore:    1500, // unknown artist
            tags:        [],
          });
        }
      }
    } catch (err) {
      console.warn('Scout: Hop-1 Spotify recs failed, falling back to Last.fm artist resolution:', err.message);
      // Fallback: resolve tracks from similar artists via Last.fm
      // This ensures candidate diversity even without Spotify
      const similarNames = [...similarArtistNames].slice(0, 8);
      for (const artistName of similarNames) {
        try {
          const artist = await resolveArtist(artistName);
          if (!artist) continue;
          const tracks = await getTopTracks(artist.id, artist.name);
          for (const track of tracks.slice(0, 3)) {
            if (!seen.has(track.id)) {
              seen.add(track.id);
              pool.push({
                track,
                artistName: artist.name,
                artistId: artist.id,
                source: 'graph_hop',
                hopDistance: 1,
                eloScore: 1500,
                tags: [],
              });
            }
          }
        } catch (innerErr) {
          console.warn(`Scout: Hop-1 fallback failed for "${artistName}":`, innerErr.message);
        }
      }
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

  // --- Private: Web-Grounded Discovery — Gemini (Google Search grounding) ---
  // Two-phase approach:
  //   Phase 1: google_search grounding (text-only, no function calling) — gets real web data
  //   Phase 2: fast LLM call — extracts artist names from the grounded research
  async _searchWebGemini(seedArtists, sessionIntent, tasteState, pool, seen, onThought) {
    const topNames = seedArtists.slice(0, 5).map(a => a.name);
    if (topNames.length === 0) return;

    if (onThought) onThought('Scout: Researching music sources online…');

    let userContext = '';
    try { userContext = UserModel.buildScoutContext(); } catch (e) {}

    // --- Phase 1: Web Research ---
    // Use google_search grounding with NO tool declarations (avoids the API conflict).
    // Formulate the query like a real music researcher would.
    const intent = sessionIntent || 'general discovery';
    const genres = (tasteState.topGenres || []).slice(0, 4).join(', ');

    const researchPrompt = `${buildSoulPrefix()}

You are a music researcher. Search for specific, real artist and album recommendations.

User's context:
- Favorite artists: ${topNames.join(', ')}
- Genres: ${genres}
- What they're looking for: "${intent}"
${userContext}

Search for recommendations from these kinds of sources:
- Reddit threads (r/ifyoulikeblank, r/listentothis, r/indieheads)
- Music criticism (Pitchfork, The Quietus, Stereogum reviews)
- Rate Your Music lists and charts
- "If you like X, try Y" recommendations
- Recent album reviews and year-end lists
- Forum discussions about these specific artists

Be specific. Name real artists, real albums, real songs. Cite where you found them if possible.
Focus on artists the user probably hasn't heard — avoid the most obvious picks.`;

    let webResearchText = '';
    try {
      // google_search grounding + empty tool declarations = no conflict
      const researchResult = await callWithTools(
        researchPrompt,
        [{ role: 'user', parts: [{ text: `Find music recommendations for someone who loves ${topNames.slice(0, 3).join(', ')} and wants: "${intent}"` }] }],
        [],          // No function calling — pure text + grounding
        'fast',
        true,        // google_search grounding ENABLED
        'scout'
      );
      webResearchText = researchResult.textReply || '';
    } catch (err) {
      console.warn('Scout: Web research grounding failed:', err.message);
      return;
    }

    if (!webResearchText || webResearchText.length < 50) return;

    // --- Phase 2: Extract artist names from the research ---
    // A fast LLM call to parse the unstructured web research into structured data.
    const extractPrompt = `Extract artist names from this music research. Return ONLY a JSON array of objects.

Research text:
${webResearchText.slice(0, 3000)}

Rules:
- Only include REAL artists that would have a Spotify page
- Skip the user's known artists: ${topNames.join(', ')}
- Include a brief reason for each (from the research context)
- Maximum 10 artists

Return format: [{"name": "Artist Name", "reason": "brief reason from research"}]
Return ONLY the JSON array.`;

    let webArtists = [];
    try {
      const extractResult = await callWithTools(
        extractPrompt,
        [{ role: 'user', parts: [{ text: 'Extract the artist names.' }] }],
        [],
        'fast',
        false,
        'scout'
      );

      const jsonMatch = (extractResult.textReply || '').match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        webArtists = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.warn('Scout: Artist extraction failed:', err.message);
      return;
    }

    if (webArtists.length === 0) return;

    if (onThought) onThought(`Scout strategy: Found ${webArtists.length} artists from music press, forums, and critic reviews`);

    // --- Phase 3: Validate against Spotify and add to pool ---
    for (const wa of webArtists.slice(0, 8)) {
      try {
        const artist = await resolveArtist(wa.name);
        if (!artist) continue;

        // Loose name validation — skip clear mismatches
        if (artist.name.toLowerCase() !== wa.name.toLowerCase() &&
            !artist.name.toLowerCase().includes(wa.name.toLowerCase()) &&
            !wa.name.toLowerCase().includes(artist.name.toLowerCase())) continue;

        const tracks = await getTopTracks(artist.id, artist.name);
        for (const track of tracks.slice(0, 2)) {
          if (!seen.has(track.id)) {
            seen.add(track.id);
            pool.push({
              track,
              artistName: artist.name,
              artistId:   artist.id,
              source:     'web_discovery',
              hopDistance: 1,
              eloScore:   1600,
              tags:       [],
              connectionReason: wa.reason,
            });
          }
        }
      } catch (err) {
        console.warn(`Scout: Web discovery lookup failed for "${wa.name}":`, err.message);
      }
    }
  }

  // --- Private: Web-Grounded Discovery — Ollama + SearXNG (local, zero-cost) ---
  async _searchWebLocalAgent(seedArtists, sessionIntent, tasteState, pool, seen, onThought) {
    const topNames = seedArtists.slice(0, 4).map(a => a.name);
    if (topNames.length === 0) return;

    const searxngUp = await isSearxngAvailable();
    if (!searxngUp) {
      if (onThought) onThought('Scout: SearXNG not available — skipping local web search (start with: docker run -d -p 8080:8080 searxng/searxng)');
      return;
    }

    if (onThought) onThought('Scout: Searching the internet via local SearXNG + Ollama ReAct loop...');

    try {
      const { content } = await runScoutWebSearch(seedArtists, sessionIntent, onThought);

      // Parse LLM output: "Artist Name — Reason" or "1. Artist Name — Reason"
      const lines = content.split('\n').filter(l => l.trim().length > 10);
      const webArtists = [];

      for (const line of lines) {
        const match = line.match(/^\d*\.?\s*(.+?)\s+[—–-]+\s+(.+)$/);
        if (match) {
          const name   = match[1].replace(/\*+/g, '').trim();
          const reason = match[2].trim();
          if (name && reason && name.length < 60) {
            webArtists.push({ name, reason });
          }
        }
      }

      if (webArtists.length === 0) {
        if (onThought) onThought('Scout: Local web search completed but could not parse artist list');
        return;
      }

      if (onThought) onThought(`Scout: Local web search found ${webArtists.length} artists via SearXNG`);

      for (const wa of webArtists.slice(0, 8)) {
        try {
          const artist = await resolveArtist(wa.name);
          if (!artist) continue;

          const tracks = await getTopTracks(artist.id, artist.name);
          for (const track of tracks.slice(0, 2)) {
            if (!seen.has(track.id)) {
              seen.add(track.id);
              pool.push({
                track,
                artistName: artist.name,
                artistId:   artist.id,
                source:     'web_discovery_local',
                hopDistance: 1,
                eloScore:   1600,
                tags:       [],
                connectionReason: wa.reason,
              });
            }
          }
        } catch (err) {
          console.warn(`Scout: Local web lookup failed for "${wa.name}":`, err.message);
        }
      }

      const webCount = pool.filter(c => c.source === 'web_discovery_local').length;
      if (onThought) onThought(`Scout: Local web-grounded discovery added ${webCount} candidates`);

    } catch (err) {
      console.warn('Scout: Local web discovery failed (continuing):', err.message);
    }
  }

  // --- Private: MusicBrainz Relationship Expansion (Phase 6.1) ---

  // Finds artists connected through band membership, collaboration, etc.
  async _addRelationshipTracks(seedArtists, pool, seen, onThought) {
    if (onThought) onThought('Scout: Checking MusicBrainz for structural connections (shared bands, collaborators)...');

    const relatedArtists = new Map(); // name → connectionReason

    for (const seed of seedArtists) {
      try {
        const mbid = await searchMbArtist(seed.name);
        if (!mbid) continue;

        const rels = await getArtistRelationships(mbid);
        for (const rel of rels.slice(0, 5)) {
          if (rel.targetName && !relatedArtists.has(rel.targetName)) {
            const reason = this._formatRelationshipReason(rel, seed.name);
            relatedArtists.set(rel.targetName, reason);
          }
        }
      } catch (err) {
        console.warn(`Scout: MB relationship lookup failed for "${seed.name}":`, err.message);
      }
    }

    if (relatedArtists.size === 0) return;
    if (onThought) onThought(`Scout: Found ${relatedArtists.size} structurally connected artists`);

    // Resolve top results to Spotify tracks
    let added = 0;

    for (const [name, reason] of [...relatedArtists.entries()].slice(0, 6)) {
      try {
        const artist = await resolveArtist(name);
        if (!artist) continue;

        const tracks = await getTopTracks(artist.id, artist.name);
        for (const track of tracks.slice(0, 2)) {
          if (!seen.has(track.id)) {
            seen.add(track.id);
            pool.push({
              track,
              artistName: artist.name,
              artistId: artist.id,
              source: 'relationship_graph',
              hopDistance: 1,
              eloScore: 1550,
              tags: [],
              connectionReason: reason,
            });
            added++;
          }
        }
      } catch (err) {
        console.warn(`Scout: Relationship track lookup failed for "${name}":`, err.message);
      }
    }

    if (onThought && added > 0) onThought(`Scout: Added ${added} tracks from structural connections`);
  }

  /**
   * Format a MusicBrainz relationship into a human-readable connection reason.
   */
  _formatRelationshipReason(rel, seedName) {
    switch (rel.type) {
      case 'member of band':
        return rel.direction === 'backward'
          ? `Member of ${seedName}`
          : `${seedName} was a member of ${rel.targetName}`;
      case 'collaboration':
        return `Collaborated with ${seedName}`;
      case 'supporting musician':
      case 'vocal supporting musician':
      case 'instrumental supporting musician':
        return rel.direction === 'backward'
          ? `Session/touring musician for ${seedName}`
          : `${seedName} performed with ${rel.targetName}`;
      case 'founder':
        return `Founded by a member of ${seedName}`;
      case 'subgroup':
        return `Side project of ${seedName}`;
      case 'teacher':
        return rel.direction === 'backward'
          ? `Studied under ${seedName}`
          : `Taught by ${rel.targetName}`;
      default:
        return `Connected to ${seedName}`;
    }
  }

  // --- Private: Enrich with Last.fm tags ---
  async _enrichWithTags(pool) {
    // Group by artist to minimize API calls
    const artistsToFetch = [...new Set(pool.map(c => c.artistName))].slice(0, 20);

    const tagMap = {};
    // Fetch in parallel batches of 5 to avoid overwhelming Last.fm
    const batchSize = 5;
    for (let i = 0; i < artistsToFetch.length; i += batchSize) {
      const batch = artistsToFetch.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async name => ({ name, tags: await getArtistTags(name) }))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          tagMap[r.value.name] = r.value.tags;
        }
      }
    }

    for (const candidate of pool) {
      candidate.tags = tagMap[candidate.artistName] || [];
    }
  }

}
