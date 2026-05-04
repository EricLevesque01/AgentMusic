/**
 * TasteGraph — Narrator Agent
 * "The Storyteller" — Explains why every track was chosen.
 *
 * Perceives: ScoredPlaylist, TasteState, sliders
 * Decides:   Which explanation template to use per track's dominant factor
 * Acts:      Produces per-track explanations and a playlist summary
 */


import { callWithTools } from '../data/gemini-api.js';
import { buildSoulPrefix } from './soul.js';
import { formatTasteBriefForPrompt } from './taste-brief.js';

export class NarratorAgent {

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

    const prompt = `You are the user's enthusiastic, deeply knowledgeable music companion — like a trusted friend who is also a music historian and cultural critic. You celebrate their taste with genuine warmth and specificity.

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
Return a JSON object analyzing the user's taste with exactly these four keys:
1. "tagline": A punchy, 3-5 word capitalized tagline for their music taste. Use musical and cultural vocabulary — genre descriptors, scene references, artist archetypes, era markers. Avoid loaded emotional or suggestive adjectives. Examples of good taglines: "Post-Punk Classicist", "Indie Folk Archivist", "Art Rock True Believer", "Guitar-Driven Deep Diver".
2. "heroDescription": A 1-2 sentence warm, celebratory summary of their top artist and overall vibe — enthusiastic, never ironic or edgy.
3. "vibeAnalysis": 1 concise paragraph (max 4 sentences) analyzing their taste based on the dossier.
4. "dynamicTiers": An object with keys "S", "A", "B", "C", "F" mapping to arrays of string artist names drawn ONLY from the User Dossier. Choose a highly dynamic, varying number of artists per tier that truly fit. For example, your S-Tier might only have 1 or 2 absolute favorites, while your B-Tier might have 5 or 6 exploring artists. Do not artificially fill 4 slots per tier — make it asymmetrical and realistic.

CRITICAL RULES for vibeAnalysis:
1. TONE: Warm, enthusiastic, and celebratory. Speak directly to them using "you". Be genuinely appreciative of their taste. Keep the register accessible and age-appropriate — avoid edgy, dark, or suggestive framings even if the music itself is melancholic.
2. SYNTHESIZE THE CULTURE: Use the Wikipedia RAG context to identify exactly *what* ties their favorite artists together — scene, era, sound, influence chain.
3. BE SPECIFIC: Reference a specific sonic quality, scene, era, or cultural moment that defines their taste. Ground the analysis in musical vocabulary.
4. LENGTH: Must be 1 paragraph, absolutely no more. Concise and punchy.

Output ONLY raw JSON. Do not use markdown backticks.`;

    try {
      const result = await callWithTools(
        prompt,
        [{ role: 'user', parts: [{ text: 'Return JSON profile analysis.' }] }],
        [],
        'reasoning',
        false,
        'narrator'
      );

      if (result.textReply) {
        // Strip markdown backticks if the model ignores the instruction
        const cleanJson = result.textReply.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        return JSON.parse(cleanJson);
      }
      throw new Error("Empty text reply from LLM");
    } catch (err) {
      console.warn("NarratorAgent: Agentic Profile LLM failed.", err);
      throw new Error("Failed to generate agentic profile: " + err.message);
    }
  }

  /**
   * Sprint 3.3: Enrich discovery tracks with deep music-history context.
   * Runs as background enrichment after the Curator finishes.
   * For each discovery track, generates a 2-3 sentence explanation that
   * connects the artist's cultural lineage to the user's known taste.
   *
   * @param {Array} discoveryTracks - Tracks with hopDistance >= 1 or web/cultural sources
   * @param {PipelineContext} context - Full pipeline context for taste brief
   * @returns {Object} Map of trackId -> enriched explanation string
   */
  async enrichDiscoveryTracks(discoveryTracks, context) {
    if (!discoveryTracks || discoveryTracks.length === 0) return {};

    const tasteBriefStr = formatTasteBriefForPrompt(context?.tasteBrief);
    const coreArtists = context?.tasteState?.tasteTiers?.coreIdentity?.join(', ') || 'unknown';

    // Build a compact list of tracks to enrich
    const tracksForPrompt = discoveryTracks.map(c => ({
      id: c.track.id,
      name: c.track.name,
      artist: c.artistName,
      source: c.source || 'unknown',
      curatorReason: c.dominantFactor || '',
    }));

    const systemPrompt = `${buildSoulPrefix()}

You are the Narrator — a music historian enriching discovery tracks with cultural context.
The user has never heard these artists. Your job: explain WHY they should care, using
music history, cultural lineage, and specific connections to their known favorites.

${tasteBriefStr || `User's core artists: ${coreArtists}`}

For each track below, write a 2-3 sentence enrichment that:
1. Places the artist in a scene/era/movement (e.g., "emerged from the 2010s Brooklyn DIY scene")
2. Draws a SPECIFIC sonic bridge to one of the user's core artists (shared producer, influence chain, genre lineage)
3. Names what makes THIS track a good entry point ("the lead single that...", "a deep cut with...")

Tone: Warm, knowledgeable insider — like a friend who knows music history deeply.
Do NOT use generic phrases like "fits your vibe" or "you might enjoy".

Return a JSON object: { "trackId": "enriched explanation string", ... }
Return ONLY the JSON object.`;

    try {
      const result = await callWithTools(
        systemPrompt,
        [{ role: 'user', parts: [{ text: `Enrich these discovery tracks:\n${JSON.stringify(tracksForPrompt, null, 2)}` }] }],
        [],
        'fast',
        false,
        'narrator'
      );

      if (result.textReply) {
        const cleaned = result.textReply.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end > start) {
          return JSON.parse(cleaned.substring(start, end + 1));
        }
      }
      return {};
    } catch (err) {
      console.warn('NarratorAgent: Discovery enrichment failed:', err.message);
      return {};
    }
  }
}
