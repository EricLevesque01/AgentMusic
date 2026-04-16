/**
 * TasteGraph — Narrator Agent
 * "The Storyteller" — Explains why every track was chosen.
 *
 * Perceives: ScoredPlaylist, TasteState, sliders
 * Decides:   Which explanation template to use per track's dominant factor
 * Acts:      Produces per-track explanations and a playlist summary
 */

import { getArtistMetadata, getArtistGenres } from '../data/musicbrainz-api.js';
import { callWithTools } from '../data/gemini-api.js';

export class NarratorAgent {
  /**
   * Generate explanations for the full playlist using Gemini + MusicBrainz context.
   * @param {Array}  scoredPlaylist
   * @param {object} tasteState
   * @param {object} sliders
   * @param {object} context - PipelineContext for inter-agent communication
   * @returns {Promise<{ playlistSummary, trackExplanations: Map }>}
   */
  async generate(scoredPlaylist, tasteState, sliders, context = null) {
    if (!scoredPlaylist || scoredPlaylist.length === 0) {
      return {
        playlistSummary: 'No tracks to explain.',
        trackExplanations: new Map(),
      };
    }

    // 1. Enrich the top 5 unique artists with MusicBrainz structural data
    // (We limit to 5 to respect the 1 req/sec limit and avoid long loading times)
    const uniqueArtists = [...new Set(scoredPlaylist.map(t => t.artistName))].slice(0, 5);
    const mbDataStr = [];
    
    for (const name of uniqueArtists) {
      const meta = await getArtistMetadata(name);
      if (meta && meta.mbid) {
        const genres = await getArtistGenres(meta.mbid);
        const origin = meta.country ? `from ${meta.country}` : '';
        const era    = meta.beginYear ? `started ~${meta.beginYear}` : '';
        const tags   = genres.length ? `Tags: ${genres.slice(0, 3).join(', ')}` : '';
        mbDataStr.push(`- ${name}: ${origin} ${era}. ${tags}`);
      }
    }

    // 2. Build track list context for the LLM
    const trackContext = scoredPlaylist.map(c => 
      `- [ID: ${c.track.id}] "${c.track.name}" by ${c.artistName} (Source: ${c.source}, Reason: ${c.dominantFactor})`
    ).join('\n');

    // 3. Inter-agent context for richer narration
    const anchoredArtist = context?.tasteProfile?.anchoredTopArtist;
    const underExplored = context?.tasteProfile?.underExploredGenres || [];
    const skippedGenres = context?.sessionSignals?.skippedGenres || [];

    // 4. Build the prompt
    const systemPrompt = `You are the Narrator for TasteGraph, a sophisticated music engine.
Your job is to explain the generated playlist to the user.
Current user taste (Calibrated via Active Learning): 
- Top Genres: ${(tasteState.topGenres || []).slice(0, 3).join(', ')}
- Top Artists: ${(tasteState.topRankedArtists || []).slice(0, 5).map(a=>a.name).join(', ')}
- Acoustic Vibe: ${((tasteState.audioProfile?.avgEnergy || 0.5)*100).toFixed(0)}% Energy
${anchoredArtist ? `- North Star: ${anchoredArtist} is the user's confirmed #1. Reference their sound when explaining why tracks fit.` : ''}

Session intent: Discovery=${sliders.discovery?.toFixed(2)}, Energy=${sliders.energy?.toFixed(2)}.
${skippedGenres.length > 0 ? `Note: The user skipped ${skippedGenres.join(', ')} tracks earlier. If you kept one anyway, explain why it's different.` : ''}
${underExplored.length > 0 ? `Note: Tracks in ${underExplored.join(', ')} are there to expand the user's taste map into areas they haven't explored much yet. Frame these as discoveries.` : ''}

Playlist Tracks:
${trackContext}

MusicBrainz Structural Data (for deep context):
${mbDataStr.join('\n') || 'None available.'}

Analyze the tracks and the MusicBrainz data. Call the 'submit_explanations' tool with:
1. A concise 1-sentence 'playlistSummary' describing the overall vibe and origins of the music.
2. An array of 'trackExplanations', where each object has the trackId and a 1-sentence explanation of why it fits. If a track's source is a 'trending_signal' (like Reddit), YOU MUST explicitly mention that it is currently trending in cultural spaces alongside fitting their taste.`;

    const toolDeclarations = [{
      name: 'submit_explanations',
      description: 'Submit the final explanations for the playlist.',
      parameters: {
        type: 'object',
        properties: {
          playlistSummary: { type: 'string' },
          trackExplanations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackId: { type: 'string' },
                explanation: { type: 'string' }
              },
              required: ['trackId', 'explanation']
            }
          }
        },
        required: ['playlistSummary', 'trackExplanations']
      }
    }];

    try {
      const result = await callWithTools(systemPrompt, [], toolDeclarations);
      const submitCall = result.functionCalls.find(fc => fc.name === 'submit_explanations');
      
      if (submitCall && submitCall.args) {
        const trackMap = new Map();
        for (const item of submitCall.args.trackExplanations || []) {
          trackMap.set(item.trackId, item.explanation);
        }
        return {
          playlistSummary: submitCall.args.playlistSummary || 'A custom mix based on your taste graph.',
          trackExplanations: trackMap
        };
      }
    } catch (err) {
      console.warn("NarratorAgent: Gemini failed, returning basic explanations.", err);
    }

    // Fallback if LLM fails
    const fallbackMap = new Map();
    for (const c of scoredPlaylist) {
      fallbackMap.set(c.track.id, `Selected due to its strong ${c.dominantFactor} affinity with your profile.`);
    }
    return {
      playlistSummary: `A custom mix of ${scoredPlaylist.length} tracks based on your taste graph.`,
      trackExplanations: fallbackMap,
    };
  }

  /**
   * Generates a multi-faceted Agentic Profile Analysis for the Profile tab.
   */
  async generateAgenticProfile(tasteState) {
    const topGenres = (tasteState.topGenres || []).slice(0, 5).join(', ');
    const topArtists = (tasteState.topRankedArtists || []).slice(0, 5).map(a => a.name).join(', ');
    
    if (!topArtists || topArtists.length === 0) {
      return "Your taste identity is a blank canvas, waiting to be painted by the Taste Game. Play a few rounds to unlock your personalized analysis!";
    }

    // Dynamic RAG: Fetch Wikipedia Context for the Top 3 Artists
    const { getArtistWikiSummary } = await import('../data/wikipedia-api.js');
    const top3Names = (tasteState.topRankedArtists || []).slice(0, 3).map(a => a.name);
    const wikiContexts = await Promise.all(top3Names.map(async name => {
      const summary = await getArtistWikiSummary(name);
      return summary ? `${name}: ${summary}` : null;
    }));
    const wikiText = wikiContexts.filter(Boolean).join('\n\n');

    const prompt = `You are the user's highly opinionated, incredibly knowledgeable best friend who happens to be a music historian and cultural critic. You know their music taste better than they know themselves.
Your tone should be warm, conversational, and direct—like you're sitting on a couch listening to records together. Speak to them as a close friend ("You know I've always noticed you gravitate toward...", "It's so classic you to...").

USER DOSSIER (Calibrated via the Taste Arena):
- Core Obsessions (S-Tier Favorites): ${(tasteState.tasteTiers?.coreIdentity || []).join(', ') || 'None'}
- Heavy Rotation (A-Tier): ${(tasteState.tasteTiers?.activeObsessions || []).join(', ') || 'None'}
- Exploring (B-Tier): ${(tasteState.tasteTiers?.fringeDiscovery || []).join(', ') || 'None'}
- Actively Dismissed (Dislikes): ${(tasteState.tasteTiers?.activelyDismissed || []).join(', ') || 'None'}
- Defining Genres: ${topGenres}
- Permanent Personal Facts: ${(tasteState.explicitPreferences?.agent_memories || []).join(', ') || 'None'}

CULTURAL/HISTORICAL CONTEXT (Wikipedia RAG):
${wikiText || 'No biographical context available.'}

YOUR TASK:
Write a beautifully crafted, highly personalized, 3-4 paragraph "Musical Vibe" breakdown analyzing your friend's taste.

CRITICAL RULES:
1. TONE: Warm, friendly, slightly teasing but deeply appreciative. You are their friend. Speak directly to them using "you". 
2. SYNTHESIZE THE CULTURE: Use the Wikipedia RAG context to identify exactly *what* era, scene, or production style ties their favorite artists together. Say something of real substance about why these sounds connect on a human level.
3. USE THE DISLIKES: If they have 'Actively Dismissed' artists, playfully roast them for what they reject (e.g., "I know you can't stand the over-produced sheen of...").
4. BE BOLD & SPECIFIC: Use a highly specific, metaphorical example. For instance, "Your taste feels like you're trying to recreate the exact feeling of walking home in the rain in 2005 listening to [Artist A], but with the bass of [Artist B]."
5. LENGTH & STRUCTURE: Write 3 to 4 substantial paragraphs. Make it feel like a meaningful, deep-dive text message or conversation. Do not use generic fluff like "You have a diverse mix of sounds."
6. Do not use markdown, just write the plain text paragraphs.`;

    try {
      const result = await callWithTools(prompt, [{ role: 'user', parts: [{text: 'Analyze my taste identity.'}] }]);
      if (result.textReply) {
        return result.textReply.trim();
      }
    } catch (err) {
      console.warn("NarratorAgent: Agentic Profile LLM failed.", err);
    }
    
    const fallbackGenresList = tasteState.topGenres || [];
    const fallbackGenres = fallbackGenresList.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const fallbackArtists = (tasteState.topRankedArtists || []).slice(0, 3).map(a => a.name).join(', ').replace(/, ([^,]*)$/, ' and $1');
    
    let vibe = "Eclectic & Unpredictable";
    const gStr = fallbackGenresList.join(' ').toLowerCase();
    if (gStr.includes('indie') || gStr.includes('dream') || gStr.includes('shoegaze') || gStr.includes('alternative')) vibe = "Atmospheric & Nostalgic";
    else if (gStr.includes('rock') || gStr.includes('metal') || gStr.includes('punk')) vibe = "Heavy & High-Energy";
    else if (gStr.includes('pop') || gStr.includes('r&b') || gStr.includes('soul')) vibe = "Catchy & Soulful";
    else if (gStr.includes('electronic') || gStr.includes('dance') || gStr.includes('house')) vibe = "Rhythmic & Driving";
    else if (gStr.includes('hip hop') || gStr.includes('rap')) vibe = "Beat-Driven & Lyrical";
    else if (fallbackGenresList.length > 5) vibe = "Broad & Experimental";

    if (fallbackArtists && fallbackGenres) {
      return `<strong>Your musical vibe: ${vibe}</strong><br><br>I've always noticed you gravitate toward ${fallbackGenres}. It's so classic you to keep artists like ${fallbackArtists} in heavy rotation. Your taste feels like you're trying to recreate the exact feeling of discovering those core sounds, but you're not afraid to mix it up. Your sonic identity is unmistakably yours—it feels less like an algorithm and more like a handwritten mixtape you've been putting together for years.`;
    }

    return "You have an eclectic blend of sonic textures. Based on your current trajectory, you seem to be searching for something rhythmic and adventurous, pushing the boundaries of what you normally keep on repeat.";
  }
}
