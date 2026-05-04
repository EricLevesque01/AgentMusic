/**
 * TasteGraph — Cultural Scout Agent (Sprint 2)
 * "What's the World Saying?" — A dedicated agent for web-aware cultural intelligence.
 *
 * Runs BEFORE the Scout in the pipeline. Its job is to answer:
 *   "What is the music world saying that's relevant to this user RIGHT NOW?"
 *
 * Perceives: User's top artists, genres, drift trends, session intent
 * Decides:   What to search for (artist news, scene buzz, events, critical coverage)
 * Acts:      Populates context.blackboard.culturalIntelligence + context.currentEvents
 *
 * Output structure:
 *   context.blackboard.culturalIntelligence = {
 *     artistDiscoveries: [{ name, reason, source, freshness }],
 *     culturalContext: string,   // one paragraph injected into Curator + Concierge
 *     criticalConsensus: [{ artist, insight }],
 *     freshness: 'timely' | 'classic',
 *   }
 *   context.currentEvents = [{ type, description, artist, date }]
 *
 * Runs as a non-blocking background step — if it fails, the pipeline continues
 * with an empty culturalIntelligence field (graceful degradation).
 *
 * KNOWLEDGE LAYERS:
 *   Layer 1: Google Search grounding (Gemini) — real web data
 *   Layer 2: Structured extraction — parse grounded text into typed data
 */
import { callWithTools } from '../data/gemini-api.js';
import { buildSoulPrefix } from './soul.js';
import { DataStore } from '../data/data-store.js';

const CULTURAL_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours — stay current without hammering the API

export class CulturalScout {

  /**
   * Run cultural research and populate the context blackboard.
   * This is the main pipeline entry point, called by the Orchestrator.
   *
   * @param {object} context  - PipelineContext (must have tasteState + tier1 populated)
   * @param {function} onThought - thought callback for UI status display
   */
  async research(context, onThought = null) {
    const topArtists = (context.tasteState?.topRankedArtists || []).slice(0, 6).map(a => a.name);
    const topGenres  = (context.tasteState?.topGenres || []).slice(0, 4);
    const intent     = context.sessionIntent || '';

    if (topArtists.length === 0) {
      // Can't do cultural research without taste anchor — skip gracefully
      this._writeEmptyResult(context);
      return;
    }

    // Check cache — cultural context doesn't need to refresh every pipeline run
    const cacheKey = `cultural_intel_${topArtists.slice(0, 3).join('_').replace(/\s+/g, '')}`;
    try {
      const cached = DataStore.load(cacheKey);
      if (cached && (Date.now() - cached.generatedAt) < CULTURAL_CACHE_TTL) {
        context.blackboard.culturalIntelligence = cached.data;
        context.currentEvents = cached.events || [];
        if (onThought) onThought('CulturalScout: Using cached cultural intelligence (< 4h old)');
        return;
      }
    } catch (e) { /* cache miss — proceed */ }

    if (onThought) onThought(`CulturalScout: Scanning music press, forums, and event listings…`);

    // Phase 1: Web research (grounded, broad)
    const researchText = await this._webResearch(topArtists, topGenres, intent, onThought);
    if (!researchText || researchText.length < 100) {
      this._writeEmptyResult(context);
      return;
    }

    // Phase 2: Structured extraction (fast, no grounding)
    const structured = await this._extractStructured(researchText, topArtists, onThought);

    // Phase 3: Event search (targeted)
    const events = await this._searchEvents(topArtists, topGenres, onThought);

    // Write to context
    const intel = {
      artistDiscoveries: structured.artistDiscoveries || [],
      culturalContext:   structured.culturalContext   || '',
      criticalConsensus: structured.criticalConsensus || [],
      recentReleases:    structured.recentReleases    || [],
      freshness:         this._assessFreshness(researchText),
      generatedAt:       Date.now(),
    };

    context.blackboard.culturalIntelligence = intel;
    context.currentEvents = events;

    if (onThought) {
      const discoveryCount = intel.artistDiscoveries.length;
      const eventCount = events.length;
      onThought(`CulturalScout: Found ${discoveryCount} discovery leads, ${eventCount} events`);
    }

    // Cache the result
    try {
      DataStore.save(cacheKey, {
        data:        intel,
        events,
        generatedAt: Date.now(),
      });
    } catch (e) { /* cache write failure is non-critical */ }
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Broad web research with Google Search grounding
  // ---------------------------------------------------------------------------

  async _webResearch(topArtists, topGenres, intent, onThought) {
    const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

    const researchPrompt = `${buildSoulPrefix()}

You are a music researcher with access to live web search. Conduct a focused research session.

USER'S MUSICAL WORLD:
- Artists they love: ${topArtists.join(', ')}
- Genres: ${topGenres.join(', ')}
- What they're looking for today: "${intent || 'general discovery'}"

RESEARCH TASKS (search for all of these):

1. ARTIST NEWS — Any new releases, tours, critical reassessments, or collaborations involving:
   ${topArtists.slice(0, 4).join(', ')}
   Include release dates and album/single names if found.

2. ADJACENT SCENE BUZZ — What are critics and fans saying RIGHT NOW about the broader 
   ${topGenres.slice(0, 2).join(' and ')} scene? Any breakthrough artists? Any trend shifts?

3. "IF YOU LIKE" DISCOVERIES — Search Reddit (r/ifyoulikeblank, r/indieheads, r/listentothis),
   Pitchfork, Stereogum for: "if you like ${topArtists.slice(0, 2).join(' or ')}"
   Name the specific artists recommended.

4. RECENT CRITICAL PRAISE — Any albums from the last 6 months getting strong critical 
   coverage that match this musical taste profile?

5. LIVE EVENTS — Any upcoming concerts, tours, or festivals featuring ${topArtists.slice(0, 3).join(', ')} 
   or similar artists? Include dates if available.

Search broadly. Be specific — name real artists, real albums, real events. 
This is ${month}. Prioritize recent information.`;

    try {
      const result = await callWithTools(
        researchPrompt,
        [{ role: 'user', parts: [{ text: `Research the music world for someone who loves ${topArtists.slice(0, 3).join(', ')}.` }] }],
        [],     // No function calling — pure text + grounding
        'fast',
        true,   // Google Search grounding ENABLED
        'scout'
      );
      return result.textReply || '';
    } catch (err) {
      console.warn('CulturalScout: Web research failed:', err.message);
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Extract structured data from the research text
  // ---------------------------------------------------------------------------

  async _extractStructured(researchText, topArtists, onThought) {
    if (!researchText || researchText.length < 50) {
      return { artistDiscoveries: [], culturalContext: '', criticalConsensus: [], recentReleases: [] };
    }

    const knownSet = new Set(topArtists.map(a => a.toLowerCase()));

    const extractPrompt = `Extract structured data from this music research. Return ONLY valid JSON.

Research text:
${researchText.slice(0, 4000)}

Known artists (exclude from discoveries): ${topArtists.join(', ')}

Extract:
{
  "artistDiscoveries": [
    { "name": "Artist Name", "reason": "Why relevant — from the research context", "source": "pitchfork|reddit|stereogum|nme|other", "freshness": "timely|classic" }
  ],
  "culturalContext": "One paragraph synthesizing what's interesting in this musical world right now. Be specific — name albums, trends, cultural moments.",
  "criticalConsensus": [
    { "artist": "Artist Name", "insight": "What critics are saying — specific claim" }
  ],
  "recentReleases": [
    { "artist": "Artist Name", "title": "Album/Single title", "type": "album|single|ep", "approximate_date": "month year if known" }
  ]
}

Rules:
- artistDiscoveries: only REAL artists the user probably hasn't heard. Max 8.
- Exclude already-known artists: ${topArtists.join(', ')}
- culturalContext: must reference specific artists/albums/trends from the research
- recentReleases: only include if a specific title was mentioned in the research
- Return ONLY the JSON object, no markdown fences`;

    try {
      const result = await callWithTools(
        extractPrompt,
        [{ role: 'user', parts: [{ text: 'Extract the structured data.' }] }],
        [],
        'fast',
        false,
        'scout'
      );

      const raw = result.textReply || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { artistDiscoveries: [], culturalContext: '', criticalConsensus: [], recentReleases: [] };

      const parsed = JSON.parse(jsonMatch[0]);

      // Deduplicate and filter known artists from discoveries
      const uniqueDiscoveries = (parsed.artistDiscoveries || [])
        .filter(d => d.name && !knownSet.has(d.name.toLowerCase()))
        .slice(0, 8);

      return {
        artistDiscoveries: uniqueDiscoveries,
        culturalContext:   parsed.culturalContext   || '',
        criticalConsensus: parsed.criticalConsensus || [],
        recentReleases:    parsed.recentReleases    || [],
      };
    } catch (err) {
      console.warn('CulturalScout: Structured extraction failed:', err.message);
      return { artistDiscoveries: [], culturalContext: '', criticalConsensus: [], recentReleases: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Targeted event search
  // ---------------------------------------------------------------------------

  async _searchEvents(topArtists, topGenres, onThought) {
    const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

    const eventPrompt = `Search for upcoming live music events.

Artists to check: ${topArtists.slice(0, 4).join(', ')}
Genres: ${topGenres.slice(0, 2).join(', ')}
Current month: ${month}

Find:
1. Any announced tours, concerts, or festival appearances for these specific artists
2. Any major ${topGenres[0] || 'indie'} festivals coming up in the next 3 months
3. Any album releases announced that fans of these artists should know about

Return ONLY valid JSON:
{
  "events": [
    {
      "type": "concert|tour|festival|release|anniversary",
      "description": "Clear, specific description",
      "artist": "Primary artist name (or null for multi-artist events)",
      "date": "Approximate date or time period if found, else null"
    }
  ]
}

Only include events you found concrete evidence for. Max 5 events. Return ONLY the JSON.`;

    try {
      const result = await callWithTools(
        eventPrompt,
        [{ role: 'user', parts: [{ text: `Find upcoming events for fans of ${topArtists.slice(0, 2).join(', ')}.` }] }],
        [],
        'fast',
        true,  // Google Search grounding for events
        'scout'
      );

      const raw = result.textReply || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return (parsed.events || []).filter(e => e.description && e.description.length > 5).slice(0, 5);
    } catch (err) {
      console.warn('CulturalScout: Event search failed:', err.message);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _assessFreshness(text) {
    // If the research mentions recent temporal markers, it's timely
    const now = new Date();
    const thisYear = now.getFullYear().toString();
    const lastYear = (now.getFullYear() - 1).toString();
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const currentMonth = months[now.getMonth()];
    const prevMonth = months[(now.getMonth() - 1 + 12) % 12];

    const textLower = text.toLowerCase();
    if (textLower.includes(thisYear) || textLower.includes(currentMonth) || textLower.includes(prevMonth)) {
      return 'timely';
    }
    if (textLower.includes(lastYear)) return 'recent';
    return 'classic';
  }

  _writeEmptyResult(context) {
    context.blackboard.culturalIntelligence = {
      artistDiscoveries: [],
      culturalContext: '',
      criticalConsensus: [],
      recentReleases: [],
      freshness: 'classic',
      generatedAt: Date.now(),
    };
    context.currentEvents = [];
  }
}
