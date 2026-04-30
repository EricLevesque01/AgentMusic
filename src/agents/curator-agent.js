/**
 * TasteGraph — Curator Agent
 * "The Editor" — Scores, ranks, and assembles the final playlist.
 *
 * Perceives: CandidatePool, TasteState, sliders, sessionAdjustments
 * Decides:   Applies pre-filters, scores all candidates, applies post-filters
 * Acts:      Produces a ScoredPlaylist with adaptive length and quality verification
 */
import { callWithTools } from '../data/gemini-api.js';
import { getArtistMetadata } from '../data/musicbrainz-api.js';
import { getSimilarArtists } from '../data/lastfm-api.js';
import { searchTrack, searchArtists, getArtistTopTracks } from '../data/spotify-api.js';
import { buildSoulPrefix } from './soul.js';
import { UserModel } from './user-model.js';
import { DataStore } from '../data/data-store.js';

export class CuratorAgent {

  /**
   * Classify the session intent to determine adaptive playlist parameters.
   * This gives the LLM the right context to make intentional curation decisions.
   */
  _analyzeIntent(sessionIntent) {
    const intent = (sessionIntent || '').toLowerCase();

    // Artist deep-dive: "deep dive into Miles Davis", "all Radiohead", "only Beatles"
    if (/deep.?dive.*into|all\s+\w|only\s+(by|from)|discography|catalog|everything by/i.test(intent)) {
      return {
        intentType: 'artist_focus',
        targetTracks: '8-15',
        maxPerArtist: 'no limit — this is an artist deep-dive',
        maxPerArtistNum: 99,
        diversityNote: 'This is an artist-focused request. Multiple tracks from the target artist are expected and welcome.',
        eraNote: 'Span the artist\'s career — include early, peak, and recent work.',
      };
    }

    // Genre exploration: "explore jazz", "introduce me to electronic", "help me get into classical"
    if (/explor|introduce|get.?into|new to|first time|haven.t listened|teach me|guide.*through/i.test(intent)) {
      return {
        intentType: 'genre_exploration',
        targetTracks: '12-15',
        maxPerArtist: '1 — genre exploration demands maximum artist diversity',
        maxPerArtistNum: 1,
        diversityNote: 'MAXIMUM DIVERSITY REQUIRED: Every track must be from a DIFFERENT artist. The user wants to explore broadly across the genre. Prioritize canonical, universally respected artists alongside interesting deep cuts.',
        eraNote: 'Span multiple decades and sub-styles. Include foundational classics, peak-era masterpieces, and modern torchbearers. Do NOT cluster everything in one era.',
      };
    }

    // Mood/activity: "studying", "workout", "driving", "cooking", "relaxing"
    if (/stud|work.?out|gym|driv|cook|relax|sleep|focus|chill|party|dinner|morning|night|run|jog|meditat/i.test(intent)) {
      return {
        intentType: 'mood_activity',
        targetTracks: '10-18',
        maxPerArtist: '2',
        maxPerArtistNum: 2,
        diversityNote: 'Balance is key. Mix familiar favorites with new discoveries that match the mood. Enough variety to keep it interesting without jarring transitions.',
        eraNote: 'Era is less important than mood cohesion. Pick whatever era best serves the vibe.',
      };
    }

    // Default / general
    return {
      intentType: 'general',
      targetTracks: '12-18',
      maxPerArtist: '2',
      maxPerArtistNum: 2,
      diversityNote: 'Balance familiarity with discovery. Mix known favorites with new finds.',
      eraNote: 'No specific era constraints. Let the intent guide temporal choices.',
    };
  }

  /**
   * Post-selection verification. Enforces hard constraints that the LLM may violate.
   * Returns the verified playlist and a log of enforcement actions.
   */
  _verifyPlaylist(playlist, params, onThought) {
    const enforced = [];
    const maxPerArtist = params.maxPerArtistNum;

    // 1. Enforce per-artist cap
    const artistCounts = {};
    const verified = [];
    for (const track of playlist) {
      const artist = track.artistName;
      artistCounts[artist] = (artistCounts[artist] || 0) + 1;
      if (artistCounts[artist] <= maxPerArtist) {
        verified.push(track);
      } else {
        enforced.push(`Removed extra track by ${artist} (limit: ${maxPerArtist} per artist)`);
      }
    }

    if (enforced.length > 0 && onThought) {
      onThought(`Curator QA: Enforced artist diversity — ${enforced.join('; ')}`);
    }

    return verified;
  }

  /**
   * Main entry point for the Agentic Curator.
   * Uses intent analysis for adaptive playlist parameters, then LLM selection with verification.
   */
  async rankAndSelect(tasteState, candidatePool, sessionIntent, sessionAdjustments = {}, context = null, onThought = null) {
    if (onThought) onThought("Analyzing taste graph and candidate pool...");

    // --- Adaptive parameters based on intent ---
    const params = this._analyzeIntent(sessionIntent);
    if (onThought) onThought(`Curator: Intent → "${params.intentType}" | Target: ${params.targetTracks} tracks, max ${params.maxPerArtist} per artist`);

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
    const poolForPrompt = candidatePool.slice(0, 60).map(c => ({
      id: c.track.id,
      name: c.track.name,
      artist: c.artistName,
      genres: c.tags?.slice(0, 3).join(', ') || 'Unknown',
      source: c.source || 'unknown'
    }));

    // --- Build enriched context from UserModel + agent_memories + session signals ---
    let userModelContext = '';
    try {
      userModelContext = UserModel.buildCuratorContext();
    } catch (e) { /* UserModel not yet populated — that's ok for first run */ }

    const prefs = DataStore.getExplicitPreferences();
    const memories = prefs.agent_memories || [];
    const memoriesStr = memories.length > 0
      ? `\nPERMANENT USER NOTES (from past conversations):\n${memories.map(m => `- ${m}`).join('\n')}` : '';

    const signals = context?.sessionSignals || DataStore.getSessionSignals();
    let signalsStr = '';
    if (signals.skippedGenres?.length || signals.lovedGenres?.length) {
      signalsStr = `\nSESSION FEEDBACK (from listening behavior):`;
      if (signals.skippedGenres?.length) signalsStr += `\n- User has been SKIPPING: ${signals.skippedGenres.join(', ')} — deprioritize these`;
      if (signals.lovedGenres?.length)   signalsStr += `\n- User has been LOVING: ${signals.lovedGenres.join(', ')} — prioritize these`;
      if (signals.skippedArtists?.length) signalsStr += `\n- Skipped artists: ${signals.skippedArtists.join(', ')}`;
    }

    const systemPrompt = `${buildSoulPrefix()}

You are acting as the Curator — the playlist assembler. Assemble a cohesive, high-quality playlist from the Candidate Pool that authentically serves the Session Intent.

USER TASTE PROFILE:
- Top Artists: ${topArtists}
- Top Genres: ${topGenres}

${userModelContext}
${memoriesStr}
${signalsStr}

SESSION INTENT: "${sessionIntent || 'General vibe'}"

PLAYLIST PARAMETERS (determined by intent analysis):
- Target track count: ${params.targetTracks} (choose an intentional number within this range)
- Max tracks per artist: ${params.maxPerArtist}
- ${params.diversityNote}
- ${params.eraNote}

QUALITY GATES — ENFORCE STRICTLY:
1. ZERO TOLERANCE FOR AI/SPAM: Reject ANY track where the artist name sounds like an AI content farm (e.g. "Relaxing Jazz Ensemble", "Chill Vibes Studio", "Ambient Sounds", "Lo-fi Study Beats", names with "Playlist" or "Beats" or years in them). Only include tracks by real, established artists with verifiable careers and cultural significance.
2. GENRE INTEGRITY: If the intent requests a specific genre, EVERY track must authentically belong to it. The user's pop/rock favorites do NOT belong in a Jazz or Classical playlist.
3. ARTIST DIVERSITY: ${params.diversityNote}
4. ERA AWARENESS: ${params.eraNote}

SELF-CHECK — Before finalizing, verify each track:
- "Is this a real, acclaimed artist I can confidently name?" — If unsure, reject it.
- "Does this track authentically fit the requested genre/mood?" — If borderline, reject it.
- "Have I already included a track by this artist?" — Enforce the per-artist limit.

OUTPUT FORMAT:
Return a single JSON object:
{
  "playlistName": "A creative, evocative 2-6 word title for this playlist",
  "reflection": "2-3 sentences analyzing your curation decisions — what you prioritized, what you rejected from the pool, and why. Be specific about tradeoffs.",
  "playlist": [
    { "id": "track_id", "reason": "1-2 sentences: the track's specific sonic qualities and why it earns its place in THIS playlist." }
  ]
}

The playlist array length should be within your target range (${params.targetTracks}).
Return ONLY valid JSON.`;

    const userMessage = `Candidate Pool:\n${JSON.stringify(poolForPrompt, null, 2)}`;

    let selectedIds = [];
    let reasonsMap = {};
    let curatorReflection = "Curated automatically based on intent and taste profile.";
    let playlistName = null;

    // Helper: extract JSON from an LLM reply that may be wrapped in markdown fences
    const extractJSON = (text) => {
      let raw = text.trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        raw = raw.substring(start, end + 1);
      } else if (raw.startsWith('```')) {
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      return JSON.parse(raw);
    };

    const messages = [{ role: 'user', parts: [{ text: userMessage }] }];

    // Attempt 1: reasoning model at default temperature
    try {
      if (onThought) onThought("Curator: Reflecting on constraints and selecting tracks...");
      const { callWithTools } = await import('../data/gemini-api.js');
      const result = await callWithTools(systemPrompt, messages, [], 'reasoning');
      const parsed = extractJSON(result.textReply);

      if (parsed.reflection) {
        curatorReflection = parsed.reflection;
        if (onThought) onThought(`Curator Reflection: ${curatorReflection}`);
      }
      if (parsed.playlistName) {
        playlistName = parsed.playlistName;
      }
      const tracksArray = parsed.playlist || parsed;
      selectedIds = tracksArray.map(p => p.id);
      tracksArray.forEach(p => { reasonsMap[p.id] = p.reason; });

    } catch (firstErr) {
      console.warn("CuratorAgent: First attempt failed, retrying with lower temperature.", firstErr.message);

      // Attempt 2: retry once with fast model (more reliable JSON output)
      try {
        if (onThought) onThought("Curator: Retrying selection...");
        const { callWithTools } = await import('../data/gemini-api.js');
        const result = await callWithTools(systemPrompt, messages, [], 'fast');
        const parsed = extractJSON(result.textReply);

        if (parsed.reflection) {
          curatorReflection = parsed.reflection;
        }
        if (parsed.playlistName) {
          playlistName = parsed.playlistName;
        }
        const tracksArray = parsed.playlist || parsed;
        selectedIds = tracksArray.map(p => p.id);
        tracksArray.forEach(p => { reasonsMap[p.id] = p.reason; });

      } catch (retryErr) {
        console.error("CuratorAgent: Both attempts failed, falling back to top Elo.", retryErr);
        // Fallback: take up to the lower bound of the target range
        const fallbackCount = parseInt(params.targetTracks) || 12;
        selectedIds = poolForPrompt.slice(0, fallbackCount).map(p => p.id);
      }
    }

    if (onThought) onThought("Mixing and assembling tracks...");

    // Filter the actual candidate objects based on selected IDs
    let playlist = candidatePool.filter(c => selectedIds.includes(c.track.id));

    // Add reasons
    playlist = playlist.map(c => ({
      ...c,
      dominantFactor: reasonsMap[c.track.id] || 'Selected based on your taste profile.'
    }));

    // --- Post-selection verification: enforce hard constraints ---
    playlist = this._verifyPlaylist(playlist, params, onThought);

    // Weighted shuffle to mix up the order
    playlist = playlist.map(value => ({ value, sort: Math.random() }))
                       .sort((a, b) => a.sort - b.sort)
                       .map(({ value }) => value);

    // Attach metadata to the final array so the Orchestrator can grab it
    playlist.curatorReflection = curatorReflection;
    playlist.playlistName = playlistName;

    if (onThought) onThought(`Curator: Final playlist — ${playlist.length} tracks from ${new Set(playlist.map(t => t.artistName)).size} artists`);

    return playlist;
  }
}
