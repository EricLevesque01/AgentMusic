/**
 * TasteGraph — Curator Agent
 * "The Editor" — Scores, ranks, and assembles the final playlist.
 *
 * Perceives: CandidatePool, TasteState, sliders, sessionAdjustments
 * Decides:   Applies pre-filters, scores all candidates, applies post-filters
 * Acts:      Produces a ScoredPlaylist with adaptive length and quality verification
 */
import { callWithTools } from '../data/gemini-api.js';

import { buildSoulPrefix } from './soul.js';
import { UserModel } from './user-model.js';
import { DataStore } from '../data/data-store.js';
import { formatTasteBriefForPrompt } from './taste-brief.js';

/**
 * JSON Schema for the Curator's response.
 * Passed as the Ollama `format:` parameter to guarantee syntactically valid JSON
 * and eliminate the #1 source of Ollama pipeline failures (malformed output).
 * The Gemini path ignores this — it uses prompt instructions instead.
 *
 * Research basis: "Syntactically valid JSON is easy because Ollama supports
 * structured outputs with a JSON schema." (Deep Research, 2026)
 */
const CURATOR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reflection: {
      type: 'string',
      description: '2-3 sentence curator\'s reflection on the playlist theme and curation choices',
    },
    playlistName: {
      type: 'string',
      description: 'Evocative, specific playlist name (not generic)',
    },
    playlistSummary: {
      type: 'string',
      description: 'One compelling sentence describing the playlist\'s vibe and emotional arc',
    },
    playlist: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:     { type: 'string', description: 'Spotify track ID' },
          reason: { type: 'string', description: '1-2 sentences: why this track fits — reference specific user context, anchored artists, or stated preferences' },
        },
        required: ['id', 'reason'],
      },
      description: 'Ordered list of selected tracks',
    },
  },
  required: ['reflection', 'playlistName', 'playlistSummary', 'playlist'],
};

export class CuratorAgent {

  /**
   * Classify the session intent to determine adaptive playlist parameters.
   * This gives the LLM the right context to make intentional curation decisions.
   * If the user specifies a track count (e.g. "50 tracks", "give me 30 songs"),
   * that overrides the default range.
   */
  _analyzeIntent(sessionIntent) {
    const intent = (sessionIntent || '').toLowerCase();

    // --- Extract user-specified track count ---
    // Matches: "50 tracks", "give me 30 songs", "about 20", "at least 15", "make it 25"
    let userRequestedCount = null;
    const countMatch = intent.match(/(\d{1,3})\s*(?:tracks?|songs?|tunes?)/i)
      || intent.match(/(?:about|around|at\s+least|make\s+it|give\s+me|want)\s*(\d{1,3})/i)
      || intent.match(/(\d{1,3})\s*(?:long|big|extended)/i);
    if (countMatch) {
      const n = parseInt(countMatch[1], 10);
      if (n >= 5 && n <= 50) userRequestedCount = n;
    }

    let params;

    // Artist focus: "deep dive into Miles Davis", "check out Geese", "my friend told me to listen to X"
    if (/deep.?dive.*into|all\s+\w|only\s+\w|just\s+\w|discography|catalog|everything by|check.?out|listen to|try\s+\w|friend.*told|recommend|heard about|got.?into|playlist\s+for|playlist\s+of|playlist\s+by|\bartist\b|\bband\b/i.test(intent)) {
      params = {
        intentType: 'artist_focus',
        targetTracks: '15-25 — use your judgment based on the artist\'s catalog depth',
        diversityNote: 'The user wants to hear THIS artist. The PRIMARY artist should absolutely dominate the playlist (up to 100% of tracks if appropriate). If the overall track count is low, just stick to the requested artist. Supporting artists are only context and should be sparse.',
        eraNote: 'Span the artist\'s career — include early, peak, and recent work if available.',
      };
    }

    // Genre exploration: "explore jazz", "introduce me to electronic"
    else if (/explor|introduce|get.?into|new to|first time|haven.t listened|teach me|guide.*through/i.test(intent)) {
      params = {
        intentType: 'genre_exploration',
        targetTracks: '18-30 — enough to give a real tour of the genre',
        diversityNote: 'Genre exploration demands MAXIMUM DIVERSITY. Mix it up completely. Every track should ideally be from a different artist to provide a broad survey of the style.',
        eraNote: 'Span multiple decades and sub-styles.',
      };
    }

    // Mood/activity: "studying", "workout", "driving"
    else if (/stud|work.?out|gym|driv|cook|relax|sleep|focus|chill|party|dinner|morning|night|run|jog|meditat/i.test(intent)) {
      params = {
        intentType: 'mood_activity',
        targetTracks: '15-30 — choose a length that fits the mood (e.g. tight 15 for focus, 25+ for a party)',
        diversityNote: 'Be highly intentional about clustering. If an artist perfectly captures the mood, include a "mini-dive" of 3-5 tracks from them rather than artificially jumping around. If the playlist is short, it\'s perfectly fine if it only features 2 or 3 artists total.',
        eraNote: 'Era is less important than mood cohesion.',
      };
    }

    // Default / general
    else {
      params = {
        intentType: 'general',
        targetTracks: '15-25 — choose whatever length feels right for the intent',
        diversityNote: 'Balance familiarity with discovery. Do not artificially force diversity — if 3 or 4 tracks from a core artist anchor the vibe perfectly, group them together.',
        eraNote: 'No specific era constraints. Let the intent guide temporal choices.',
      };
    }

    // Override target tracks if the user specified a count
    if (userRequestedCount) {
      params.targetTracks = `exactly ${userRequestedCount} tracks — the user specifically requested this count`;
    }

    return params;
  }

  /**
   * Hard pre-filter: remove AI-generated / spam / ambient content farm tracks
   * from the candidate pool BEFORE the LLM sees them.
   * These patterns match artist names used by content farms on streaming platforms.
   */
  _filterAISpam(pool) {
    const AI_SPAM_PATTERNS = [
      // Descriptive ensemble names (content farms)
      /\b(relaxing|chill|lo.?fi|study|sleep|focus|meditation|ambient|spa|yoga|nature|rain|white\s*noise|binaural|solfeggio|healing|calming|peaceful|sleep|dreamy)\s+(music|sounds?|beats?|vibes?|jazz|piano|guitar|ensemble|collective|studio|records?|project|mix|playlist)/i,
      // Generic instrument + genre combos
      /^(smooth jazz|chill hop|lofi|lo-fi|deep house|chillout|chillwave)\s+(collective|studio|music|beats|ensemble)/i,
      // Content farm suffixes
      /\b(study beats|bedroom pop collective|ambient sounds|nature sounds|sleep music|rain sounds|white noise|piano covers|acoustic covers|workout music|gym music|focus music)/i,
      // Year/number spam channels
      /^(top\s+\d+|best\s+\d+|\d{4}\s+hits)/i,
      // Generic "Playlist" or "Beats" in name
      /\b(playlist|beats?|instrumentals?|vibes?\s+only)\b/i,
      // DJ-prefixed spam accounts (not real DJ artists)
      /^dj\s+\w+\s+(beats|instrumentals|music|sounds)/i,
    ];

    const before = pool.length;
    const filtered = pool.filter(c => {
      const artist = (c.artistName || '').trim();
      const trackName = (c.track?.name || '').trim();
      // Check artist name against spam patterns
      if (AI_SPAM_PATTERNS.some(p => p.test(artist))) return false;
      // Also reject if track name itself looks like spam
      if (/\b(hz|hertz|binaural|solfeggio|isochronic|subliminal)\b/i.test(trackName)) return false;
      return true;
    });

    if (filtered.length < before) {
      console.info(`CuratorAgent: AI/spam pre-filter removed ${before - filtered.length} tracks (${before} → ${filtered.length})`);
    }
    return filtered;
  }

  /**
   * Post-selection verification. Enforces hard constraints that the LLM may violate.
   * Returns the verified playlist and a log of enforcement actions.
   */
  _verifyPlaylist(playlist, params, onThought) {
    // For artist_focus intents, enforce that the primary artist dominates the playlist.
    // This is a safety net for when the LLM ignores the prompt constraint.
    if (params.intentType === 'artist_focus' && playlist.length > 0 && params._rawIntent) {
      // Extract the target artist name from the intent
      const intentMatch = params._rawIntent.match(
        /(?:playlist\s+(?:for|of|by|around)|check.?out|listen to|deep.?dive.*into|build.*(?:playlist|mix).*around)\s+(.+?)(?:\s*[\u2014\u2013—-]|\s*$)/i
      );
      if (intentMatch) {
        const targetArtist = intentMatch[1].trim().toLowerCase();
        const targetTracks = playlist.filter(t =>
          (t.artistName || '').toLowerCase().includes(targetArtist)
        );
        const ratio = targetTracks.length / playlist.length;

        if (ratio < 0.5 && targetTracks.length > 0) {
          // LLM failed to honor the constraint — reorder to put target tracks first
          // and trim non-target tracks to enforce dominance
          const nonTarget = playlist.filter(t =>
            !(t.artistName || '').toLowerCase().includes(targetArtist)
          );
          const maxNonTarget = Math.max(2, Math.floor(targetTracks.length * 0.4));
          const enforced = [...targetTracks, ...nonTarget.slice(0, maxNonTarget)];
          if (onThought) onThought(`Curator: Enforced artist focus — ${targetTracks.length} target tracks, trimmed ${nonTarget.length} → ${Math.min(nonTarget.length, maxNonTarget)} supporting`);
          return enforced;
        }
      }
    }
    return playlist;
  }

  /**
   * Main entry point for the Agentic Curator.
   * Uses intent analysis for adaptive playlist parameters, then LLM selection with verification.
   */
  async rankAndSelect(tasteState, candidatePool, sessionIntent, sessionAdjustments = {}, context = null, onThought = null) {
    if (onThought) onThought("Analyzing taste graph and candidate pool...");

    // --- Adaptive parameters based on intent ---
    const params = this._analyzeIntent(sessionIntent);
    params._rawIntent = sessionIntent; // Pass raw intent for _verifyPlaylist artist extraction
    if (onThought) onThought(`Curator: Intent → "${params.intentType}" | Target: ${params.targetTracks} tracks`);

    // Fallback if pool is empty
    if (!candidatePool || candidatePool.length === 0) {
      console.warn("CuratorAgent: Empty candidate pool, returning empty playlist.");
      return [];
    }

    // --- Hard pre-filter: remove AI/spam content BEFORE the LLM sees the pool ---
    const cleanPool = this._filterAISpam(candidatePool);
    if (onThought && cleanPool.length < candidatePool.length) {
      onThought(`Curator: Filtered ${candidatePool.length - cleanPool.length} AI/spam tracks from pool`);
    }

    if (onThought) onThought("Evaluating tracks against session intent...");

    const topGenres = (tasteState.topGenres || []).slice(0, 5).join(', ');
    const topArtistsArray = (tasteState.topRankedArtists || tasteState.artists || []).slice(0, 5);
    const topArtists = topArtistsArray.map(a => a.name).join(', ');

    // Prepare a condensed pool for the LLM to review (use clean pool)
    const poolForPrompt = cleanPool.slice(0, 80).map(c => ({
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

    const memories = context?.agentMemories || [];
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

    // --- Scout's handoff note (blackboard) — placed at TOP of prompt for LLM anchoring ---
    let scoutHandoff = '';
    let intentOverrideConstraint = '';
    if (context?.blackboard?.scout) {
      const s = context.blackboard.scout;
      const parts = [`\nSCOUT'S HANDOFF (how this pool was assembled):`];
      parts.push(`- Strategy: ${s.searchStrategy}`);
      if (s.sourceBreakdown) {
        const sources = Object.entries(s.sourceBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ');
        parts.push(`- Source breakdown: ${sources}`);
      }
      if (s.usedAgenticRetrieval) {
        parts.push(`- ⚡ EXPLICIT USER REQUEST IN POOL: Tracks with source "llm_primary_artist", "intent_override", "llm_specific", or "intent_search" are the EXACT targets of the session intent. You MUST include these tracks. Prioritize them above all algorithmically-chosen candidates.`);
      }
      if (s.intentOverrideActive) {
        intentOverrideConstraint = `\n⚠ CRITICAL CONSTRAINT: The user made a SPECIFIC REQUEST. Honor it unconditionally.\n- Do NOT replace the requested artist/tracks with familiar S-Tier artists.\n- Familiar favorites belong in a SUPPORTING role only — max 30% of the playlist.\n- If you see tracks from the requested artist in the pool, they MUST appear.\n- Filling the playlist with existing favorites when they asked for something new is a failure.\n`;
      }
      if (s.highConfidence?.length) parts.push(`- High-confidence (from user taste): ${s.highConfidence.join(', ')}`);
      if (s.riskyBets?.length) parts.push(`- Risky bets (exploration): ${s.riskyBets.join(', ')}`);
      if (s.gaps?.length) parts.push(`- Coverage gaps being addressed: ${s.gaps.join(', ')}`);
      if (s.spotifyDegraded) parts.push(`- ⚠ Spotify was rate-limited — some tracks may be from Last.fm fallback data`);
      scoutHandoff = parts.join('\n');
    }

    // --- Sprint 3.1: Centralized Taste DNA Brief ---
    const tasteBriefStr = formatTasteBriefForPrompt(context?.tasteBrief);

    const systemPrompt = `${buildSoulPrefix()}
${intentOverrideConstraint}
${scoutHandoff}

${(() => {
  const intel = context?.blackboard?.culturalIntelligence;
  if (!intel?.culturalContext) return '';
  const releaseNotes = (intel.recentReleases || [])
    .slice(0, 3)
    .map(r => `- ${r.artist}: "${r.title}" (${r.type}${r.approximate_date ? ', ' + r.approximate_date : ''})`)
    .join('\n');
  return `CURRENT MUSIC WORLD CONTEXT (from live web research):
${intel.culturalContext}${releaseNotes ? '\n\nRecent Releases:\n' + releaseNotes : ''}
Freshness: ${intel.freshness || 'unknown'}. Use this cultural context to make your per-track reasons feel timely and specific.\n`;
})()}
You are acting as the Curator — the playlist assembler. Assemble a cohesive, high-quality playlist from the Candidate Pool that authentically serves the Session Intent.

${tasteBriefStr || `USER TASTE PROFILE:
- Top Artists: ${topArtists}
- Top Genres: ${topGenres}`}

${userModelContext}
${memoriesStr}
${signalsStr}

${(() => {
  const history = context?.playlistHistory;
  if (!history || history.length === 0) return '';
  const lines = history.map((p, i) => {
    const artists = p.topArtists.length > 0 ? ` — dominated by: ${p.topArtists.join(', ')}` : '';
    return `  ${i + 1}. "${p.title}"${p.intent && p.intent !== p.title ? ` (intent: "${p.intent.slice(0, 60)}")` : ''}${artists}`;
  });
  return `PREVIOUSLY CURATED PLAYLISTS (your recent history — DO NOT repeat these directions):
${lines.join('\n')}

VARIETY MANDATE: The above playlists were already generated. For this new playlist:
- Choose a DIFFERENT anchor artist than those that dominated recent playlists
- Choose a DIFFERENT genre angle or emotional register than the ones above
- If the same artist appears repeatedly in history, treat them as over-represented and deprioritize them
- The goal is a collection of playlists that covers diverse territory, not multiple deep-dives into the same artist\n`;
})()}
SESSION INTENT: "${sessionIntent || 'General vibe'}"

PLAYLIST PARAMETERS (determined by intent analysis):
- Suggested track count: ${params.targetTracks}
- ${params.diversityNote}
- ${params.eraNote}

QUALITY GATES — ENFORCE STRICTLY:
1. ZERO TOLERANCE FOR AI/SPAM: Reject ANY track where the artist name sounds like an AI content farm (e.g. "Relaxing Jazz Ensemble", "Chill Vibes Studio", "Ambient Sounds", "Lo-fi Study Beats", names with "Playlist" or "Beats" or years in them). Only include tracks by real, established artists with verifiable careers and cultural significance.
2. GENRE INTEGRITY: If the intent requests a specific genre, EVERY track must authentically belong to it. The user's pop/rock favorites do NOT belong in a Jazz or Classical playlist.
3. ARTIST DIVERSITY: ${params.diversityNote}
4. ERA AWARENESS: ${params.eraNote}

CURATION METHOD — TWO-STEP SELECTION THESIS:
Step 1 — THESIS: Before selecting ANY tracks, state in your "reflection" field:
  a) What is the emotional/sonic arc of this playlist? (e.g., "opens introspective, builds to cathartic, closes with warmth")
  b) What discovery ratio am I targeting and why? (e.g., "40% discovery because the user's skip rate is low and trajectory is expanding")
  c) What will I deliberately EXCLUDE from the pool and why? (e.g., "dropping all ambient tracks because the intent is energetic")
Step 2 — SELECTION: Choose tracks that execute the thesis. For each track, explain its specific ROLE in the arc, not just why it fits.

SELF-CHECK — Before finalizing, verify each track:
- "Is this a real, acclaimed artist I can confidently name?" — If unsure, reject it.
- "Does this track authentically fit the requested genre/mood?" — If borderline, reject it.
- "Have I already included a track by this artist?" — Enforce the per-artist limit.

PERSONALIZATION RULES FOR PER-TRACK REASONS:
- Reference the user's #1 artist by name when a track shares sonic DNA with them
- If a track was chosen because it mirrors a stated user preference (e.g., "melancholy but not defeatist"), say so explicitly
- For discovery tracks, explain what sonic bridge connects them to the user's known taste
- Never write generic filler like "fits the vibe" — every reason must be specific to THIS user and THIS intent

OUTPUT FORMAT:
Return a single JSON object:
{
  "playlistName": "A creative, evocative 2-6 word title for this playlist",
  "playlistSummary": "One compelling sentence describing the playlist's emotional arc and sonic identity.",
  "reflection": "Your selection THESIS first (arc, discovery ratio, exclusions), then 2-3 sentences analyzing tradeoffs.",
  "playlist": [
    { "id": "track_id", "reason": "1-2 sentences: this track's ROLE in the arc + connection to user's taste context." }
  ]
}

TRACK COUNT GUIDANCE — USE JUDGMENT:
The target range is ${params.targetTracks}. Choose the right length for the intent:
- Deep dives, artist focus, or rich exploratory intents → lean toward the upper end (more is better)
- Focused mood/vibe sessions or specific genre cuts → a tighter 10-12 track playlist can be more powerful than a padded 18-track one
- If the pool has 20+ high-quality tracks that all fit, use them. If the pool thins out below your standard after 12 tracks, stop there.
- NEVER pad with mediocre tracks to hit a number. Quality over quantity.
${params.intentType === 'artist_focus' ? `
ARTIST FOCUS HARD RULE — THIS IS YOUR PRIMARY OBJECTIVE:
- PRIMARY REQUESTED ARTIST MUST DOMINATE: Include ALL tracks from the requested artist that appear in the pool. The playlist MUST be at least 70% tracks by the requested artist.
- Supporting/context artists: Include at most 2-3 tracks for sonic context. If the requested artist has 8+ tracks in the pool, supporting artists should represent less than 20% of the final playlist.
- If you return a playlist where the majority of tracks are NOT by the requested artist, you have FAILED the task.
- Count your tracks before submitting: how many are by the primary artist vs. others? If the ratio is below 70%, remove non-target tracks.
` : ''}
Return ONLY valid JSON.`;

    const userMessage = `Candidate Pool (${cleanPool.length} tracks available — choose liberally):\n${JSON.stringify(poolForPrompt, null, 2)}`;

    let selectedIds = [];
    let reasonsMap = {};
    let curatorReflection = "Curated automatically based on intent and taste profile.";
    let playlistName = null;
    let playlistSummary = null;

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
      const result = await callWithTools(systemPrompt, messages, [], 'fast', false, 'curator', null);
      const parsed = extractJSON(result.textReply);

      if (parsed.reflection) {
        curatorReflection = parsed.reflection;
        if (onThought) onThought(`Curator Reflection: ${curatorReflection}`);
      }
      if (parsed.playlistName) {
        playlistName = parsed.playlistName;
      }
      if (parsed.playlistSummary) {
        playlistSummary = parsed.playlistSummary;
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
        const result = await callWithTools(systemPrompt, messages, [], 'fast', false, 'curator', null);

        const parsed = extractJSON(result.textReply);

        if (parsed.reflection) {
          curatorReflection = parsed.reflection;
        }
        if (parsed.playlistName) {
          playlistName = parsed.playlistName;
        }
        if (parsed.playlistSummary) {
          playlistSummary = parsed.playlistSummary;
        }
        const tracksArray = parsed.playlist || parsed;
        selectedIds = tracksArray.map(p => p.id);
        tracksArray.forEach(p => { reasonsMap[p.id] = p.reason; });

      } catch (retryErr) {
        console.error("CuratorAgent: Both LLM attempts failed.", retryErr);
        throw new Error('The AI curation service is currently unavailable. Please try again in a moment.');
      }
    }

    if (onThought) onThought("Mixing and assembling tracks...");

    // Filter the actual candidate objects based on selected IDs (search clean pool)
    let playlist = cleanPool.filter(c => selectedIds.includes(c.track.id));

    // Add reasons
    playlist = playlist.map(c => ({
      ...c,
      dominantFactor: reasonsMap[c.track.id] || 'Selected based on your taste profile.'
    }));

    // --- Post-selection verification: enforce hard constraints ---
    playlist = this._verifyPlaylist(playlist, params, onThought);

    // --- Enforce minimum playable length ---
    // We trust the LLM's judgment on length (e.g. returning 10 tight tracks instead of padding to 15),
    // but we need a hard floor so the playlist isn't completely empty.
    const hardFloor = 6;
    if (playlist.length < hardFloor) {
      const usedIds = new Set(playlist.map(c => c.track.id));
      const artistCounts = {};
      for (const c of playlist) {
        artistCounts[c.artistName] = (artistCounts[c.artistName] || 0) + 1;
      }
      // Pull from clean pool, respecting per-artist cap
      for (const c of cleanPool) {
        if (playlist.length >= hardFloor) break;
        if (usedIds.has(c.track.id)) continue;
        const count = artistCounts[c.artistName] || 0;
        if (count >= params.maxPerArtistNum) continue;
        playlist.push({ ...c, dominantFactor: c.dominantFactor || 'Added to reach minimum playable length.' });
        usedIds.add(c.track.id);
        artistCounts[c.artistName] = count + 1;
      }
      if (onThought && playlist.length > selectedIds.length) {
        onThought(`Curator: Padded playlist from ${selectedIds.length} → ${playlist.length} tracks to meet hard floor`);
      }
    }

    // Weighted shuffle to mix up the order
    playlist = playlist.map(value => ({ value, sort: Math.random() }))
                       .sort((a, b) => a.sort - b.sort)
                       .map(({ value }) => value);

    // Attach metadata to the final array so the Orchestrator can grab it
    playlist.curatorReflection = curatorReflection;
    playlist.playlistName = playlistName;
    playlist.playlistSummary = playlistSummary;

    if (onThought) onThought(`Curator: Final playlist — ${playlist.length} tracks from ${new Set(playlist.map(t => t.artistName)).size} artists`);

    return playlist;
  }
}
