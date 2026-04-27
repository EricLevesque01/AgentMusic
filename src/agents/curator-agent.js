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
import { searchTrack, searchArtists, getArtistTopTracks } from '../data/spotify-api.js';

export class CuratorAgent {
  /**
   * Main entry point for the Agentic Curator.
   * Runs a ReAct loop with Gemini to dynamically research and assemble a playlist.
   */
  async rankAndSelect(tasteState, candidatePool, sessionIntent, sessionAdjustments = {}, context = null, onThought = null) {
    if (onThought) onThought("Analyzing taste graph and candidate pool...");
    
    const MAX_TRACKS = 20;
    const MAX_PER_ARTIST = 2;
    
    // Fallback if pool is empty
    if (!candidatePool || candidatePool.length === 0) {
      console.warn("CuratorAgent: Empty candidate pool, returning empty playlist.");
      return [];
    }

    if (onThought) onThought("Evaluating tracks against session intent...");

    const topGenres = (tasteState.topGenres || []).slice(0, 5).join(', ');
    const topArtistsArray = (tasteState.topRankedArtists || tasteState.artists || []).slice(0, 5);
    const topArtists = topArtistsArray.map(a => a.name).join(', ');

    // Prepare a condensed pool for the LLM to review
    // We send up to 60 tracks to give it plenty of options
    const poolForPrompt = candidatePool.slice(0, 60).map(c => ({
      id: c.track.id,
      name: c.track.name,
      artist: c.artistName,
      genres: c.tags?.slice(0, 3).join(', ') || 'Unknown'
    }));

    const systemPrompt = `You are a Fast Music Curator Agent.
Your job is to select exactly ${MAX_TRACKS} tracks from the provided Candidate Pool that best fit the user's Session Intent.

USER TASTE PROFILE:
- Top Artists: ${topArtists}
- Top Genres: ${topGenres}

SESSION INTENT: "${sessionIntent || 'General vibe'}"
(CRITICAL: If the intent specifies a genre like 'Jazz', you MUST prioritize tracks that fit that genre over the user's top artists).

RULES:
1. Select exactly ${MAX_TRACKS} tracks.
2. Max ${MAX_PER_ARTIST} tracks per artist.
3. Return ONLY a valid JSON array of objects.
4. Each object must have:
   - "id": the track ID
   - "reason": a short, 1-sentence explanation of why it fits the intent or the user's taste.

Return ONLY the JSON array, no markdown blocks.`;

    const userMessage = `Candidate Pool:\n${JSON.stringify(poolForPrompt, null, 2)}`;

    let selectedIds = [];
    let reasonsMap = {};

    try {
      if (onThought) onThought("Generating final playlist structure...");
      const { callWithTools } = await import('../data/gemini-api.js');
      // We use callWithTools but with no tools, just to get a text response
      const result = await callWithTools(systemPrompt, [{ role: 'user', parts: [{ text: userMessage }] }], [], 'fast');
      
      let rawText = result.textReply.trim();
      if (rawText.startsWith('\`\`\`json')) {
        rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      }
      
      const parsed = JSON.parse(rawText);
      selectedIds = parsed.map(p => p.id);
      parsed.forEach(p => { reasonsMap[p.id] = p.reason; });

    } catch (err) {
      console.error("CuratorAgent: Fast selection failed, falling back to top Elo.", err);
      // Fallback: Just take the top 20
      selectedIds = poolForPrompt.slice(0, MAX_TRACKS).map(p => p.id);
    }

    if (onThought) onThought("Mixing and assembling tracks...");

    // Filter the actual candidate objects based on selected IDs
    let playlist = candidatePool.filter(c => selectedIds.includes(c.track.id));
    
    // Add reasons
    playlist = playlist.map(c => ({
      ...c,
      dominantFactor: reasonsMap[c.track.id] || c.dominantFactor || 'Selected based on your taste profile.'
    }));

    // Weighted shuffle to mix up the order
    playlist = playlist.map(value => ({ value, sort: Math.random() }))
                       .sort((a, b) => a.sort - b.sort)
                       .map(({ value }) => value);

    // Limit to max just in case
    return playlist.slice(0, MAX_TRACKS);
  }
}
