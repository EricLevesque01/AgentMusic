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
    
    let systemPrompt = `You are an expert Music Curator Agent for TasteGraph.
Your goal is to curate a highly cohesive, strategic ${MAX_TRACKS}-track playlist.

USER TASTE PROFILE (Calibrated via Active Learning):
- Core Identity (S-Tier): ${(tasteState.tasteTiers?.coreIdentity || []).join(', ') || 'None'}
- Active Obsessions (A-Tier): ${(tasteState.tasteTiers?.activeObsessions || []).join(', ') || 'None'}
- Actively Disliked: ${(tasteState.tasteTiers?.activelyDismissed || []).join(', ') || 'None'}
- Top Genres: ${topGenres}
${anchoredArtist ? `- North Star Artist (Settled #1): ${anchoredArtist} — this is the user's confirmed absolute favorite. Use their emotional register and sonic texture as a guiding reference.` : ''}

EXPLICIT PREFERENCES (Permanent Rules):
- Banned Artists: ${(tasteState.explicitPreferences?.banned_artists || []).join(', ') || 'None'}
- Banned Tracks: ${(tasteState.explicitPreferences?.banned_tracks || []).join(', ') || 'None'}
- Preferred Decades: ${(tasteState.explicitPreferences?.preferred_decades || []).join(', ') || 'Any'}
- Concierge Memories (Facts to obey): ${(tasteState.explicitPreferences?.agent_memories || []).join(', ') || 'None'}

CURRENT SESSION INTENT:
"${sessionIntent}"

${skippedGenres.length > 0 ? `- SESSION FEEDBACK: The user skipped multiple ${skippedGenres.join(', ')} tracks this session. Deprioritize these genres.` : ''}
${underExplored.length > 0 ? `- TASTE GAPS TO FILL: The user hasn't rated much in these genres: ${underExplored.join(', ')}. Try to include 1-2 tracks from these areas if quality candidates exist.` : ''}

CULTURAL CONTEXT (Wikipedia RAG):
${wikiText || 'No deep biographical context available.'}

Instead of picking from a massive database, you must actively research and curate tracks using your tools.
You can:
1. Search MusicBrainz for artist background and deep tags.
2. Find similar artists on Last.fm.
3. Search Spotify to find specific tracks.
4. Add a track to the playlist when you are confident it fits perfectly.

CRITICAL RULES:
- Only use REAL artists and tracks. Use the tools to verify they exist before adding.
- You must add exactly ${MAX_TRACKS} tracks.
- MAXIMUM ${MAX_PER_ARTIST} tracks per artist to ensure variety. Spread across many artists.
- After adding ${MAX_TRACKS} tracks, call the 'finish_playlist' tool.
- Think step-by-step. Research an artist, find similar artists, verify tracks, then add them.
- Work in batches: research 3-4 artists, add their best tracks, then move to the next batch.`;

    const tools = [
      {
        name: 'search_musicbrainz',
        description: 'Get deep background info and tags for an artist to see if they fit the vibe.',
        parameters: {
          type: 'object',
          properties: { artist_name: { type: 'string' } },
          required: ['artist_name']
        }
      },
      {
        name: 'get_similar_artists',
        description: 'Find artists similar to a given seed artist using Last.fm data.',
        parameters: {
          type: 'object',
          properties: { artist_name: { type: 'string' } },
          required: ['artist_name']
        }
      },
      {
        name: 'search_spotify_track',
        description: 'Search Spotify to find a playable track ID and metadata.',
        parameters: {
          type: 'object',
          properties: { track_name: { type: 'string' }, artist_name: { type: 'string' } },
          required: ['track_name', 'artist_name']
        }
      },
      {
        name: 'add_track_to_playlist',
        description: 'Add a verified track to the final playlist.',
        parameters: {
          type: 'object',
          properties: {
            track_id: { type: 'string', description: 'The Spotify Track ID' },
            track_name: { type: 'string' },
            artist_name: { type: 'string' },
            reason: { type: 'string', description: 'Why you chose this track' }
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
              result = meta ? `Found: ${meta.country}, Era: ${meta.beginYear}. Tags: ${(meta.tags||[]).join(', ')}` : "Artist not found on MusicBrainz.";
            } 
            else if (call.name === 'get_similar_artists') {
              const similar = await getSimilarArtists(args.artist_name, 5);
              result = similar.length > 0 ? similar.map(a => a.name).join(', ') : "No similar artists found.";
            } 
            else if (call.name === 'search_spotify_track') {
              const track = await searchTrack(args.track_name, args.artist_name);
              if (track) {
                trackCache[track.id] = track;
                result = `SUCCESS: Track ID is ${track.id}. Artist ID is ${track.artists[0]?.id}.`;
              } else {
                result = "Track not found on Spotify. Try another.";
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
