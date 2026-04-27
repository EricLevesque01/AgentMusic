/**
 * TasteGraph — Curator Agent
 * "The Editor" — Scores, ranks, and assembles the final playlist.
 *
 * Perceives: CandidatePool, TasteState, sliders, sessionAdjustments
 * Decides:   Applies pre-filters, scores all candidates, applies post-filters
 * Acts:      Produces a ScoredPlaylist of 20 tracks with breakdowns
 */
import { callWithTools } from '../data/gemini-api.js';
import { getArtistMetadata } from '../data/musicbrainz-api.js';
import { getSimilarArtists } from '../data/lastfm-api.js';
import { searchTrack, getArtistTopTracks } from '../data/spotify-api.js';

export class CuratorAgent {
  /**
   * Main entry point for the Agentic Curator.
   * Runs a ReAct loop with Gemini to dynamically research and assemble a playlist.
   */
  async rankAndSelect(tasteState, candidatePool, sessionIntent, sessionAdjustments = {}, context = null) {
    const playlist = [];
    const MAX_TRACKS = 25;
    const MAX_PER_ARTIST = 3;
    const artistCounts = {}; // track per-artist count
    
    // Convert top genres and favorite artists into a prompt
    const topGenres = (tasteState.topGenres || []).slice(0, 5).join(', ');
    const topArtistsArray = (tasteState.topRankedArtists || tasteState.artists || []).slice(0, 5);
    const topArtists = topArtistsArray.map(a => a.name).join(', ');
    
    // Dynamic RAG: Fetch Wikipedia Context for the Top 3 Artists
    const { getArtistWikiSummary } = await import('../data/wikipedia-api.js');
    const wikiContexts = await Promise.all(topArtistsArray.slice(0, 3).map(async a => {
      const summary = await getArtistWikiSummary(a.name);
      return summary ? `${a.name}: ${summary}` : null;
    }));
    const wikiText = wikiContexts.filter(Boolean).join('\n\n');

    // Inter-agent context enrichment
    const anchoredArtist = context?.tasteProfile?.anchoredTopArtist;
    const coverageGaps = (context?.coverageGaps || []).map(g => g.genre);
    const underExplored = context?.tasteProfile?.underExploredGenres || [];
    const skippedGenres = context?.sessionSignals?.skippedGenres || [];
    
    let systemPrompt = `You are a Music Curator Agent that DISCOVERS new music by exploring the music graph.

YOUR MISSION: Build a ${MAX_TRACKS}-track playlist by RESEARCHING outward from the user's taste anchors. Do NOT just list tracks you already know — use your tools to explore connections, find artists the user hasn't heard of, and verify every track exists on Spotify before adding it.

USER TASTE PROFILE (calibrated via head-to-head comparisons):
- Favorite Artists (S-Tier): ${(tasteState.tasteTiers?.coreIdentity || []).join(', ') || 'Not calibrated yet'}
- Artists They're Into (A-Tier): ${(tasteState.tasteTiers?.activeObsessions || []).join(', ') || 'Not calibrated yet'}
- Artists They Dislike: ${(tasteState.tasteTiers?.activelyDismissed || []).join(', ') || 'None'}
- Top Genres: ${topGenres || 'Various'}
${anchoredArtist ? `- #1 Artist: ${anchoredArtist} — their confirmed absolute favorite.` : ''}

EXPLICIT RULES:
- Banned Artists: ${(tasteState.explicitPreferences?.banned_artists || []).join(', ') || 'None'}
- Banned Tracks: ${(tasteState.explicitPreferences?.banned_tracks || []).join(', ') || 'None'}
- Preferred Decades: ${(tasteState.explicitPreferences?.preferred_decades || []).join(', ') || 'Any'}
- Concierge Memories: ${(tasteState.explicitPreferences?.agent_memories || []).join('; ') || 'None'}

SESSION INTENT / TASK: "${sessionIntent || 'General playlist based on my taste'}"
(Treat this intent as a strict directive. If it is a specific task—like "find songs with horns", "give me 5 tracks from the 90s"—you MUST execute that exact task using your tools, while still ensuring it aligns with their Taste Profile.)

${skippedGenres.length > 0 ? `SESSION FEEDBACK: User skipped ${skippedGenres.join(', ')} tracks recently. Deprioritize.` : ''}

CULTURAL CONTEXT (from Wikipedia):
${wikiText || 'No deep context available — use MusicBrainz to research artists.'}

YOUR RESEARCH STRATEGY (follow this step by step):
1. START from 2-3 of the user's favorite artists as "seed" anchors.
2. Use get_similar_artists on each seed to discover RELATED artists the user may not know.
3. For promising discoveries, use search_musicbrainz to understand their background, era, and genre tags — decide if they fit the session intent.
4. Use search_spotify_track to find specific tracks from artists that pass your quality check.
5. Add tracks that genuinely fit the vibe. Explain WHY each track belongs.
6. REPEAT: use get_similar_artists on your DISCOVERIES to explore further out from the user's core taste. This is how you find truly novel picks.

CRITICAL RULES:
- You MUST use tools to discover and verify. Do not hallucinate track names.
- At least 50% of the playlist should be from artists NOT in the user's S-tier or A-tier.
- Maximum ${MAX_PER_ARTIST} tracks per artist.
- After adding ${MAX_TRACKS} tracks, call finish_playlist.
- Think out loud about why each artist and track fits the session vibe.`;

    const tools = [
      {
        name: 'search_musicbrainz',
        description: 'Research an artist: get their country of origin, active years, and genre tags. Use this to decide if an unfamiliar artist fits the session vibe.',
        parameters: {
          type: 'object',
          properties: { artist_name: { type: 'string' } },
          required: ['artist_name']
        }
      },
      {
        name: 'get_similar_artists',
        description: 'Explore outward: find 5 artists similar to a given seed. This is your PRIMARY discovery tool — use it to find artists the user hasn\'t heard of yet.',
        parameters: {
          type: 'object',
          properties: { artist_name: { type: 'string' } },
          required: ['artist_name']
        }
      },
      {
        name: 'get_artist_top_tracks',
        description: 'Get the top tracks for an artist on Spotify. Use this AFTER discovering an artist to see what tracks they have available.',
        parameters: {
          type: 'object',
          properties: { artist_name: { type: 'string' } },
          required: ['artist_name']
        }
      },
      {
        name: 'search_spotify_track',
        description: 'Search Spotify for a specific track by name and artist. Returns the track ID needed for add_track_to_playlist. Use this to verify a track exists.',
        parameters: {
          type: 'object',
          properties: { track_name: { type: 'string' }, artist_name: { type: 'string' } },
          required: ['track_name', 'artist_name']
        }
      },
      {
        name: 'add_track_to_playlist',
        description: 'Add a verified track to the final playlist. You MUST have a valid track_id from search_spotify_track or get_artist_top_tracks first.',
        parameters: {
          type: 'object',
          properties: {
            track_id: { type: 'string', description: 'The Spotify Track ID (from a previous tool call)' },
            track_name: { type: 'string' },
            artist_name: { type: 'string' },
            reason: { type: 'string', description: 'Why this track fits the playlist — reference the session intent and how you discovered this artist' }
          },
          required: ['track_id', 'track_name', 'artist_name', 'reason']
        }
      },
      {
        name: 'finish_playlist',
        description: 'Call this when you have successfully added the required number of tracks.',
        parameters: { type: 'object', properties: {} }
      }
    ];

    let messages = [{ role: 'user', parts: [{ text: 'Begin curating the playlist.' }] }];
    let finished = false;
    let loopCount = 0;
    const MAX_LOOPS = 40;
    const TIMEOUT_MS = 60000; // 60s for larger playlists
    const trackCache = {};

    if (sessionAdjustments.injectedQueue && sessionAdjustments.injectedQueue.length > 0) {
      systemPrompt += `\n\nNOTE: The Concierge specifically requested you consider these artists: ${sessionAdjustments.injectedQueue.map(a => a.name).join(', ')}`;
    }

    console.log("🤖 CuratorAgent: Starting Agentic ReAct Loop...");
    const startTime = Date.now();

    while (!finished && loopCount < MAX_LOOPS && playlist.length < MAX_TRACKS) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.warn(`CuratorAgent: Hit ${TIMEOUT_MS / 1000}s timeout with ${playlist.length} tracks.`);
        break;
      }

      loopCount++;
      try {
        const { functionCalls, textReply } = await callWithTools(systemPrompt, messages, tools, 'reasoning');
        
        if (textReply) {
          messages.push({ role: 'model', parts: [{ text: textReply }] });
        }

        if (!functionCalls || functionCalls.length === 0) {
          messages.push({ role: 'user', parts: [{ text: `You currently have ${playlist.length}/${MAX_TRACKS} tracks. Please use your tools to find and add more tracks.` }] });
          continue;
        }

        const toolResponses = [];

        for (const call of functionCalls) {
          let result = '';
          const args = call.args || {};

          try {
            if (call.name === 'search_musicbrainz') {
              const meta = await getArtistMetadata(args.artist_name);
              result = meta 
                ? `Artist: ${args.artist_name}. Country: ${meta.country || 'Unknown'}. Active since: ${meta.beginYear || 'Unknown'}. Genre tags: ${(meta.tags||[]).join(', ') || 'None found'}. ${meta.disambiguation || ''}` 
                : `"${args.artist_name}" not found on MusicBrainz. Try a different spelling or artist.`;
            } 
            else if (call.name === 'get_similar_artists') {
              const similar = await getSimilarArtists(args.artist_name, 8);
              if (similar.length > 0) {
                result = `Artists similar to ${args.artist_name}:\n` + similar.map((a, i) => 
                  `${i+1}. ${a.name} (match: ${a.match ? (a.match * 100).toFixed(0) + '%' : 'unknown'})`
                ).join('\n') + '\n\nUse get_artist_top_tracks or search_musicbrainz on any of these to explore further.';
              } else {
                result = `No similar artists found for "${args.artist_name}". Try a different seed.`;
              }
            } 
            else if (call.name === 'get_artist_top_tracks') {
              // First, search for the artist to get their Spotify ID
              const { searchArtist } = await import('../data/spotify-api.js');
              const artist = await searchArtist(args.artist_name);
              if (artist && artist.id) {
                const tracks = await getArtistTopTracks(artist.id);
                if (tracks && tracks.length > 0) {
                  tracks.forEach(t => { trackCache[t.id] = t; });
                  result = `Top tracks for ${artist.name} (${artist.genres?.slice(0,3).join(', ') || 'no genre tags'}):\n` + tracks.slice(0, 8).map((t, i) => 
                    `${i+1}. "${t.name}" (ID: ${t.id}) — Album: ${t.album?.name || 'Unknown'}`
                  ).join('\n') + '\n\nUse add_track_to_playlist with any of these track IDs.';
                } else {
                  result = `Found ${artist.name} on Spotify but they have no top tracks available.`;
                }
              } else {
                result = `"${args.artist_name}" not found on Spotify. They may not be on the platform — try a different artist.`;
              }
            }
            else if (call.name === 'search_spotify_track') {
              const track = await searchTrack(args.track_name, args.artist_name);
              if (track) {
                trackCache[track.id] = track;
                result = `Found: "${track.name}" by ${track.artists?.map(a=>a.name).join(', ')} (ID: ${track.id}). Album: ${track.album?.name || 'Unknown'}.`;
              } else {
                result = `"${args.track_name}" by ${args.artist_name} not found on Spotify. Try get_artist_top_tracks to see what's available.`;
              }
            } 
            else if (call.name === 'add_track_to_playlist') {
              if (playlist.some(t => t.track.id === args.track_id)) {
                result = "Track already in playlist. Pick a different one.";
              } else if ((artistCounts[args.artist_name] || 0) >= MAX_PER_ARTIST) {
                result = `Already have ${MAX_PER_ARTIST} tracks from ${args.artist_name}. Pick a different artist for variety.`;
              } else {
                const fullTrack = trackCache[args.track_id] || { id: args.track_id, name: args.track_name };
                playlist.push({
                  track: fullTrack,
                  artistName: args.artist_name,
                  artistId: fullTrack.artists?.[0]?.id || '',
                  source: 'agentic_research',
                  finalScore: 0.99,
                  dominantFactor: args.reason,
                  tags: []
                });
                artistCounts[args.artist_name] = (artistCounts[args.artist_name] || 0) + 1;
                result = `Track '${args.track_name}' added. Playlist size: ${playlist.length}/${MAX_TRACKS}. (${artistCounts[args.artist_name]}/${MAX_PER_ARTIST} from ${args.artist_name})`;
              }
            } 
            else if (call.name === 'finish_playlist') {
              finished = true;
              result = "Finished.";
            }
          } catch (e) {
            result = `Error executing tool: ${e.message}`;
          }

          toolResponses.push({
            functionResponse: {
              name: call.name,
              response: { result }
            }
          });
        }

        messages.push({
          role: 'model',
          parts: functionCalls.map(c => ({ functionCall: c }))
        });
        messages.push({
          role: 'user',
          parts: toolResponses
        });

      } catch (err) {
        console.error("CuratorAgent Loop Error:", err);
        break;
      }
    }

    console.log(`🤖 CuratorAgent: Finished. ${playlist.length} tracks in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
    
    // Fallback: if LLM failed or timed out, use deterministic Elo-ranked candidate pool
    if (playlist.length === 0 && candidatePool && candidatePool.length > 0) {
      console.warn("CuratorAgent: Falling back to Elo-ranked selection from Scout pool.");
      const eloRatings = tasteState?.eloRatings || {};
      const sorted = [...candidatePool].sort((a, b) => {
        const eloA = eloRatings[a.artistId]?.rating || 1500;
        const eloB = eloRatings[b.artistId]?.rating || 1500;
        return eloB - eloA;
      });
      const seenArtists = new Set();
      const deduped = sorted.filter(c => {
        if (seenArtists.has(c.artistId || c.artistName)) return false;
        seenArtists.add(c.artistId || c.artistName);
        return true;
      });
      return deduped.slice(0, MAX_TRACKS).map(c => ({...c, finalScore: 0.8, dominantFactor: 'Elo-ranked from your taste profile'}));
    }

    return playlist;
  }
}
